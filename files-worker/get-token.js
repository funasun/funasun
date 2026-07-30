/* ============================================================
   保管先の Google アカウントを1つ増やすための道具
   ------------------------------------------------------------
   ファイル共有の置き場所を増やしたいときに、1回だけ使う。
   「そのアカウントの引き出しを使ってよい」という許可証（リフレッシュトークン）を
   受け取って、画面に出すだけ。どこにも保存しないし、どこにも送らない。

   【使い方】
     1) このパソコンのブラウザで、増やしたい Google アカウントにログインしておく。
        （別のアカウントで入っていると、そちらの許可証が出てしまう）
     2) 合言葉と同じ場所に置いてある2つを控えて、こう打つ:

          cd files-worker
          GOOGLE_CLIENT_ID=xxxx GOOGLE_CLIENT_SECRET=yyyy node get-token.js

        この2つは Cloudflare に登録済みのものと同じ値。分からなければ
        Google Cloud コンソールの「APIとサービス → 認証情報」で見られる。
     3) 画面に出たURLをブラウザで開いて、許可する。
     4) ターミナルに出てきた長い文字列（1//… で始まる）を、そのまま次に貼る:

          npx wrangler secret put GOOGLE_REFRESH_TOKEN_2

        （3つめを足すときは _3、4つめは _4。_5 まで使える）

   【うまくいかないとき】
     ・「リダイレクト URI が一致しません」と出たら、Google Cloud コンソールの
       その認証情報に、承認済みリダイレクトURIとして下に出る http://localhost:… を
       足す（クライアントの種類が「デスクトップ」なら足さなくてよい）。
     ・「このアプリは確認されていません」と出るのは、身内でしか使っていない
       ためで、詳細 → 安全でないページに移動、で進んでよい。
     ・それでも弾かれるなら、OAuth 同意画面の「テストユーザー」に、増やしたい
       アカウントのメールアドレスを足す。

   ※ 出てきた許可証は、そのアカウントの引き出しを開けられる鍵と同じもの。
      人に見せない、チャットに貼らない、ファイルに保存しない。
   ============================================================ */
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// このアプリが作ったファイルだけを触れる、いちばん弱い権限
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PORT = Number(process.env.PORT || 8721);
const REDIRECT = 'http://localhost:' + PORT;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を渡してください。');
  console.error('例) GOOGLE_CLIENT_ID=xxxx GOOGLE_CLIENT_SECRET=yyyy node get-token.js');
  process.exit(1);
}

// 途中で別のページに割り込まれていないかを確かめるための、使い捨ての合言葉
const state = crypto.randomBytes(16).toString('hex');

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',      // 許可証（リフレッシュトークン）を出してもらう
  prompt: 'consent',           // すでに許可済みでも、もう一度出してもらう
  state: state
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/') { res.writeHead(404).end(); return; }

  const done = (msg) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">'
      + msg + '<p>このタブは閉じて、ターミナルに戻ってください。</p>');
  };

  if (u.searchParams.get('state') !== state) { done('<h2>やり直してください</h2>'); return; }
  const err = u.searchParams.get('error');
  if (err) { done('<h2>許可されませんでした</h2><p>' + err + '</p>'); finish(1); return; }

  const code = u.searchParams.get('code');
  if (!code) { done('<h2>コードが受け取れませんでした</h2>'); finish(1); return; }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code'
    })
  });
  const j = await r.json().catch(() => ({}));

  if (!r.ok || !j.refresh_token) {
    done('<h2>受け取れませんでした</h2>');
    console.error('\n失敗しました: ' + (j.error_description || j.error || r.status));
    if (j.error === 'invalid_grant') console.error('（同意画面で「許可」を押したか確かめてください）');
    finish(1);
    return;
  }

  // どのアカウントの許可証かを、念のため見せる（別のアカウントで取ってしまう事故を防ぐ）
  let who = '', space = '';
  try {
    const a = await fetch('https://www.googleapis.com/drive/v3/about?fields=user,storageQuota',
      { headers: { Authorization: 'Bearer ' + j.access_token } });
    const info = await a.json();
    const q = info.storageQuota || {};
    who = (info.user && info.user.emailAddress) || '';
    space = q.limit
      ? Math.round((q.limit - q.usage) / 1073741824 * 10) / 10 + 'GB 空き（全体 '
        + Math.round(q.limit / 1073741824) + 'GB）'
      : '上限なし';
  } catch (e) { /* 見せられなくても本題ではない */ }

  done('<h2>受け取りました</h2>');
  console.log('\n──────────────────────────────────────');
  console.log('アカウント : ' + (who || '(取得できず)'));
  if (space) console.log('空き容量   : ' + space);
  console.log('──────────────────────────────────────');
  console.log('\n次のコマンドを打って、下の1行を貼り付けてください:\n');
  console.log('  npx wrangler secret put GOOGLE_REFRESH_TOKEN_2\n');
  console.log(j.refresh_token);
  console.log('\n※ この文字列は鍵と同じです。人に見せない・貼り付けない・保存しない。');
  finish(0);
});

function finish(code) {
  setTimeout(() => { server.close(); process.exit(code); }, 300);
}

server.listen(PORT, () => {
  console.log('増やしたいアカウントでログインした状態で、次のURLを開いてください:\n');
  console.log(authUrl + '\n');
  console.log('（承認済みリダイレクトURIを聞かれたら ' + REDIRECT + ' を足してください）');
});
