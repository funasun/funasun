/* ============================================================
   保管先の Google アカウントを1つ増やすための道具
   ------------------------------------------------------------
   ファイル共有の置き場所を増やしたいときに、1回だけ使う。

   【この道具の約束】
   鍵になるものを画面に出さない。
     ・シークレットは打っても表示されない（画面にも、コマンドの履歴にも残らない）
     ・受け取った許可証は表示せず、そのまま Cloudflare に登録する
   だから、この道具が出した文字は**そのまま人に見せても安全**。
   困ったときは、出力をまるごと貼って相談してよい。

   （前は許可証を画面に出していた。それを貼ってしまう事故が起きたので、
     人が鍵に触らなくて済む形に変えた。）

   【使い方】
     1) 増やしたいアカウントで、ブラウザにログインしておく
     2) こう打つ（番号は2つめの保管先なら 2、3つめなら 3）:

          cd files-worker
          node get-token.js 2

     3) シークレットを聞かれるので貼る（表示されないので、貼れているか
        不安でもそのまま Enter を押してよい）
     4) ブラウザが開くので「続行」を押す
     5) 「登録しました」と出たら完了

   【うまくいかないとき】
     ・「リダイレクト URI が一致しません」→ Google Cloud コンソールのこの
       認証情報に、下に出る http://localhost:8721 を承認済みリダイレクトURIとして足す
     ・「このアプリは確認されていません」→ 身内でしか使っていないためで、
       詳細 → 安全でないページに移動、で進んでよい
   ============================================================ */
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

const SLOT = String(process.argv[2] || '2').replace(/[^0-9]/g, '') || '2';
const SECRET_NAME = 'GOOGLE_REFRESH_TOKEN_' + SLOT;
const HINT = process.argv[3] || '';                 // 使いたいアカウントのメール（任意）
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '878050641636-u96om8rbv7gtuosr85nauekdvgmp45g6.apps.googleusercontent.com';
// このアプリが作ったファイルだけを触れる、いちばん弱い権限
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PORT = Number(process.env.PORT || 8721);
const REDIRECT = 'http://localhost:' + PORT;

if (SLOT === '1') {
  console.error('1つめ（GOOGLE_REFRESH_TOKEN）は今動いているものです。上書きしないでください。');
  process.exit(1);
}

/* 打った文字を中身が分からない形で聞く。
   コマンドに書かせると、シェルの履歴と画面に残ってしまうため。

   readline は使わない。行を消し直す動きがあって、聞いている文言まで
   消えてしまい「何も出ずに固まった」ように見えるため。
   1文字ずつ自分で受け取り、代わりに * を出す（受け取っていることが見える）。 */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);

    if (!stdin.isTTY) {                      // パイプで渡されたときは普通に読む
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => resolve(data.trim()));
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const CTRL_C = String.fromCharCode(3);      // 中止
    const BACKSPACE = String.fromCharCode(127);  // 1文字消す
    const done = () => {
      stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(buf.trim());
    };
    const onData = (chunk) => {
      // 貼り付けは、まとめて1回で届く。1文字ずつ見て改行を拾う
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { done(); return; }
        if (ch === CTRL_C) {                              // Ctrl+C
          stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130);
        }
        if (ch === BACKSPACE || ch === '\b') {               // 打ち間違いを1つ消す
          if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (ch >= ' ') {
          buf += ch; process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

// 許可証を、画面を通さずにそのまま Cloudflare へ渡す
function saveToCloudflare(refreshToken) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', 'wrangler', 'secret', 'put', SECRET_NAME],
      { cwd: __dirname, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.write(refreshToken + '\n');
    child.stdin.end();
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

(async () => {
  console.log('保管先を増やします（' + SECRET_NAME + '）。');
  console.log('※ この道具は鍵を画面に出しません。出た文字はそのまま人に見せて構いません。\n');

  const clientSecret = await askHidden('クライアントシークレットを貼って Enter（表示されません）: ');
  if (!clientSecret) { console.error('入力がありませんでした。'); process.exit(1); }

  // 途中で別のページに割り込まれていないかを確かめるための、使い捨ての合言葉
  const state = crypto.randomBytes(16).toString('hex');
  const params = {
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE,
    access_type: 'offline',      // 許可証（リフレッシュトークン）を出してもらう
    prompt: 'consent',           // すでに許可済みでも、もう一度出してもらう
    state: state
  };
  if (HINT) params.login_hint = HINT;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/') { res.writeHead(404).end(); return; }
    const page = (msg) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">'
        + msg + '<p>このタブは閉じて、ターミナルに戻ってください。</p>');
    };
    const stop = (code) => setTimeout(() => { server.close(); process.exit(code); }, 300);

    if (u.searchParams.get('state') !== state) { page('<h2>やり直してください</h2>'); return; }
    if (u.searchParams.get('error')) {
      page('<h2>許可されませんでした</h2>');
      console.error('\n許可されませんでした（' + u.searchParams.get('error') + '）。');
      stop(1); return;
    }
    const code = u.searchParams.get('code');
    if (!code) { page('<h2>コードが受け取れませんでした</h2>'); stop(1); return; }

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code, client_id: CLIENT_ID, client_secret: clientSecret,
        redirect_uri: REDIRECT, grant_type: 'authorization_code'
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) {
      page('<h2>受け取れませんでした</h2>');
      console.error('\n失敗しました: ' + (j.error_description || j.error || r.status));
      if (j.error === 'invalid_client') console.error('（シークレットが違うかもしれません）');
      stop(1); return;
    }
    page('<h2>受け取りました</h2>');

    // どのアカウントの許可証かを見せる（別のアカウントで取ってしまう事故を防ぐ）
    let who = '', space = '';
    try {
      const a = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota',
        { headers: { Authorization: 'Bearer ' + j.access_token } });
      const info = await a.json();
      const q = info.storageQuota || {};
      who = (info.user && info.user.emailAddress) || '';
      if (q.limit) {
        space = Math.round((q.limit - q.usage) / 1073741824 * 10) / 10 + 'GB 空き（全体 '
          + Math.round(q.limit / 1073741824) + 'GB）';
      }
    } catch (e) { /* 見せられなくても本題ではない */ }

    console.log('\n──────────────────────────────────────');
    console.log('アカウント : ' + (who || '(取得できず)'));
    if (space) console.log('空き容量   : ' + space);
    console.log('──────────────────────────────────────');
    console.log('\n' + SECRET_NAME + ' として登録します…\n');

    const ok = await saveToCloudflare(j.refresh_token);
    console.log(ok
      ? '\n登録しました。管理画面の「預かりファイル」で保管先が増えているか見てください。'
      : '\n登録できませんでした。Cloudflare にログインしているか確かめて、もう一度どうぞ。');
    stop(ok ? 0 : 1);
  });

  server.listen(PORT, () => {
    console.log('ブラウザを開きます。増やしたいアカウントで「続行」を押してください。');
    console.log('（開かないときは、次のURLを自分で開いてください）\n');
    console.log(authUrl + '\n');
    // NO_OPEN=1 のときは開かない（動かして試すときに、勝手にブラウザが立ち上がらないように）
    if (!process.env.NO_OPEN) spawn('open', [authUrl], { stdio: 'ignore' }).on('error', () => {});
  });
})();
