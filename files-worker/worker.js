/* ============================================================
   funasun-files — ファイル共有 Worker（ギガファイル便ふう）
   ------------------------------------------------------------
   ・保管先は Google ドライブ（無料15GB・カード不要）。複数アカウント可。
   ・使う権限は drive.file（このアプリが作ったファイルだけ）。安全な最小権限。
   ・アップロードは「合言葉（env.UPLOAD_CODE）」を知っている人だけ。
   ・大きいファイルは分割（レジューム式）でアップロードするので GB 級もOK。
     分割データはブラウザ →(この Worker)→ Google と中継する。
     途中で切れても /where で「どこまで届いたか」を聞き、続きから送り直せる。
   ・複数ファイルは「まとめID（grp）」で束ね、/g/:id の1つのURLで渡せる。
   ・各ファイルに任意の「ダウンロード合言葉」と「有効期限」を付けられる。
     期限切れは毎日の cron ＋ アクセス時チェックで自動削除。
   ・どれだけ預かってよいかは Google に実際の空きを聞いて決める。
     RESERVE の分だけは必ず残す＝Gmail 等の枠を食い潰さない。

   【中身のプレビューについて】
   ダウンロードは今までどおり必ず添付（強制ダウンロード）で返す。
   そのうえで、安全だと分かっている種類だけを /pv/:id で「そのまま表示」する。
   安全の担保は次の3段構え。1つ破られても他で止まる:
     1. 拡張子のホワイトリストだけを許可（html/svg/xml などは絶対に含めない）。
        送った人が申告した種類は一切信用せず、この表だけで種類を決める。
     2. X-Content-Type-Options: nosniff — 中身を見て種類を勝手に変えさせない。
        画像として返したものは、中身がHTMLでも画像としてしか扱われない。
     3. Content-Security-Policy: sandbox — 万一動いても隔離された出所として
        扱われ、この Worker のドメインの何にも触れない。
   なお PDF を表示する枠（iframe）にだけは sandbox 属性を付けていない。
   付けると Chrome が PDF ビューアごと止めてしまうため。詳しくは PREVIEW_JS の中に。

   必要な Worker シークレット:
     UPLOAD_CODE           … アップロード用の合言葉
     GOOGLE_CLIENT_ID      … OAuth クライアントID
     GOOGLE_CLIENT_SECRET  … OAuth クライアントシークレット
     GOOGLE_REFRESH_TOKEN  … 一度だけ取得するリフレッシュトークン
     GOOGLE_REFRESH_TOKEN_2 … 保管先を増やしたいとき（_5 まで。任意）

   エンドポイント（すべて JSON。ファイル本体だけ生バイト）:
     POST /create      … アップロード開始（合言葉チェック＋レジューム枠作成）
     PUT  /part        … 分割データを1つ中継する（?session=&start=&end=&total=）
     GET  /f/:id       … 1ファイルのダウンロード用ページ（見た目つき）
     GET  /g/:gid      … まとめたファイル一覧のページ
     GET  /dl/:id      … ファイル本体を返す（強制ダウンロード / ?h=合言葉のハッシュ）
     GET  /pv/:id      … ファイル本体を返す（そのまま表示・安全な種類のみ）
     GET  /ok/:id      … 合言葉が合っているかだけ答える（?h=）
     POST /admin/list  … 預かっている全ファイルとURLの一覧（本人のみ）
     POST /admin/del   … ファイルを1つ消す（本人のみ）

   【管理用（/admin/*）について】
   /admin の編集ツールから呼ぶ。合言葉ではなく Google ログイン（Firebase の
   IDトークン）で本人確認する。合言葉はアップロードする人みんなで共有する
   ものなので、「全ファイルの一覧」や「削除」を任せるには弱すぎるため。
   ============================================================ */

const ALLOW_ORIGINS = [
  'https://tsutsumufunakoshi.com',
  'https://www.tsutsumufunakoshi.com'
];
// 管理用エンドポイントを使えるのはこの人だけ（/admin と同じ持ち主）
const OWNER_EMAIL = 'tsutsumufunakoshi@gmail.com';
const FIREBASE_API_KEY = 'AIzaSyCbi7N4rV7L04rusvzVHQ2SjPoKdqaNg2k';
// 1ファイルの上限。断るときの文にもこの数を使う（数字と文がずれないように）
const MAX_GB = 5;
const MAX_BYTES = MAX_GB * 1024 * 1024 * 1024;
/* ---- 保管先について ----
   置き場所は Google ドライブ。無料の15GBは Gmail や写真と共用なので、
   「あとどれだけ預かってよいか」は自分が預かった分を数えても分からない。
   （メールが増えれば、こちらが何もしなくても空きは減る。）
   そこで Google に本当の使用量を聞き、そこから RESERVE を必ず残す。

   保管先は複数登録できる。env に GOOGLE_REFRESH_TOKEN, GOOGLE_REFRESH_TOKEN_2,
   … と入れた順に使い、前のが埋まったら次へ送る。1本しか無ければ今までと同じ動き。 */
const TOKEN_KEYS = [
  'GOOGLE_REFRESH_TOKEN', 'GOOGLE_REFRESH_TOKEN_2', 'GOOGLE_REFRESH_TOKEN_3',
  'GOOGLE_REFRESH_TOKEN_4', 'GOOGLE_REFRESH_TOKEN_5'
];
/* メールと写真のために必ず空けておく量。ここには絶対に手を付けない。
   保管庫が満杯でメールが受け取れない、が一番困る壊れ方なので。 */
const RESERVE = 3 * 1024 * 1024 * 1024;

/* 有料プランで増えた容量は当てにしない。
   増量はいつか終わる。終わったときに預かったものが上限を超えていると、
   新しい保存ができなくなるだけでなくメールも受け取れなくなる。
   「お金を払わなくても残る分」までしか使わないでおけば、そうならない。
   有料分も使いたくなったら、この数字を上げればよい（戻すときは要注意）。 */
const PLAN_FLOOR = 15 * 1024 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;            // 分割サイズ 10MB（Google の 256KB 倍数条件を満たす）
const ALLOWED_DAYS = [1, 3, 7, 30];            // 選べる有効期限（日）
const APP_TAG = 'funasun';                     // 自分のファイルを見分ける印
const CONFIG_TAG = 'config';                   // 設定の入れ物を見分ける印（預かりものと区別する）
const MAX_GROUP = 30;                          // 1回のまとめに入れられるファイル数

/* プレビューを許す拡張子だけの表。ここに無いものは一切そのまま表示しない。
   html / htm / svg / xml / xhtml などは「書いた通りに動いてしまう」ため、
   意図的に入れていない（入れると、この Worker のドメイン上で他人の書いた
   ページが動くことになり、なりすましなどに使われる）。 */
const PREVIEW_TYPES = {
  // 画像（svg は動くので除外）
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  // 動画
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  // 音声
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac',
  // 書類
  pdf: 'application/pdf',
  // 文字だけのファイル（すべて text/plain として返す＝HTMLとしては解釈されない）
  txt: 'text/plain', md: 'text/plain', csv: 'text/plain', tsv: 'text/plain',
  log: 'text/plain', json: 'text/plain', yml: 'text/plain', yaml: 'text/plain',
  ini: 'text/plain', conf: 'text/plain', js: 'text/plain', ts: 'text/plain',
  css: 'text/plain', py: 'text/plain', rb: 'text/plain', c: 'text/plain',
  h: 'text/plain', cpp: 'text/plain', java: 'text/plain', go: 'text/plain',
  rs: 'text/plain', sh: 'text/plain', sql: 'text/plain'
};
const TEXT_PREVIEW_LIMIT = 300 * 1024;         // 文字ファイルの先読み上限 300KB

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(origin))
  });
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function humanSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function safeId(id) {
  // Google の fileId・まとめID は英数と - _ のみ
  return String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}
/* <script> の中に値を書き込むための変換。JSON.stringify だけでは、
   ファイル名に </script> が入っていたときにそこでスクリプトが切れてしまい、
   続きを地の文（＝HTML）として書けてしまう。< > & を必ず escape 表記にする。 */
function jsStr(v) {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
function extOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
// 送った人の申告ではなく、拡張子だけから種類を決める（なりすまし対策）
function previewType(filename) {
  return PREVIEW_TYPES[extOf(filename)] || null;
}
function previewKind(mime) {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/plain') return 'text';
  return null;
}
function fmtDate(ms) {
  const d = new Date(Number(ms) || 0);
  return d.getFullYear() + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2);
}

/* 期限の見せ方。0 は「無期限」（expired() が exp>0 のときだけ切れると
   判定するので、0 のファイルは切れない＝掃除でも消えない）。 */
function expiryText(exp) {
  const n = Number(exp) || 0;
  return n ? '有効期限 ' + fmtDate(n) + ' まで' : '無期限';
}

/* ---------- Google OAuth / Drive API ---------- */

async function getAccessToken(env, key) {
  key = key || TOKEN_KEYS[0];
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env[key]) {
    throw new Error('Googleの設定が未完了です（認証情報が未登録）');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env[key],
      grant_type: 'refresh_token'
    })
  });
  const j = await res.json().catch(function () { return {}; });
  if (!res.ok || !j.access_token) {
    throw new Error('Google認証に失敗しました' + (j.error_description ? '（' + j.error_description + '）' : ''));
  }
  return j.access_token;
}

/* 登録されている保管先すべての鍵。登録した順に返す。
   1つのアカウントの鍵が切れていても、そこだけ飛ばして他は使えるようにしておく
   （1本の失効で、他のアカウントに預けたファイルまで見えなくなると困るため）。
   ぜんぶ駄目なときだけ、はっきり失敗させる。 */
async function allTokens(env) {
  const out = [];
  const bad = [];
  for (const key of TOKEN_KEYS) {
    if (!env[key]) continue;
    try { out.push({ key: key, token: await getAccessToken(env, key) }); }
    catch (e) { bad.push(key); }
  }
  if (!out.length) {
    throw new Error(bad.length ? 'Google認証に失敗しました' : 'Googleの設定が未完了です（認証情報が未登録）');
  }
  out.bad = bad;
  return out;
}

/* ---- 空き容量を Google 自身に聞く ----
   預かったファイルを数え上げるのではなく、アカウント全体の使用量を聞く。
   15GB は Gmail や写真と共用なので、そちらの増減も込みで見ないと
   「まだ空いている」と思って預かった結果メールが止まる、が起こる。 */
async function freeSpace(token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota',
    { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const q = (await res.json().catch(function () { return {}; })).storageQuota || {};
  const usage = Number(q.usage || 0);
  const limit = Number(q.limit || 0);        // 上限なしのアカウントでは値が来ない
  // 実際の上限と PLAN_FLOOR の小さいほう＝安心して使える量
  const safe = limit ? Math.min(limit, PLAN_FLOOR) : PLAN_FLOOR;
  return { limit: limit, safe: safe, usage: usage, free: Math.max(0, safe - usage - RESERVE) };
}

/* ---- そのファイルがどのアカウントにあるかを探す ----
   URLには置き場所が書いていない。権限が drive.file なので、各アカウントは
   自分が預かった分しか見えない＝「知りません」＝そこには無い、と言い切れる。
   順に聞けば必ず当たる。すでに配ったURLをそのまま使い続けられるのが利点。 */
// size バイトを置ける保管先の鍵を返す。どこにも入らなければ null。
async function pickAccount(accounts, size) {
  for (const a of accounts) {
    const sp = await freeSpace(a.token);
    if (sp && sp.free >= size) return a.token;
  }
  return null;
}

/* ---- 設定（アップロード用の合言葉）----
   Worker のシークレットは外から書き換えられない。書き換えられるようにするには
   Cloudflare の管理用の鍵をこの中に持たせることになり、そちらのほうが危ない。
   そこで、設定だけは保管先の Google ドライブに置く。

   置き方は「中身の無いファイルの付箋（appProperties）」。読み書きが1往復で済み、
   中身を取りに行く手間が要らないため。合言葉そのものは保存しない。
   取り返しのつかない形（SHA-256）に潰してから比べる。 */
let cfgCache = null, cfgAt = 0;
const CFG_TTL = 30 * 1000;   // 30秒だけ覚えておく。毎回聞くと、送るたびに1往復増える

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// 設定の入れ物を探す。1つめのアカウントにだけ置く（どこにあるか迷わないように）
async function configFile(token) {
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' }"
    + " and appProperties has { key='kind' and value='" + CONFIG_TAG + "' } and trashed=false";
  const res = await fetch('https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(q)
    + '&fields=' + encodeURIComponent('files(id,appProperties)') + '&pageSize=1',
    { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('設定を読めませんでした');
  const j = await res.json();
  return (j.files && j.files[0]) || null;
}

async function loadConfig(env) {
  if (cfgCache && Date.now() - cfgAt < CFG_TTL) return cfgCache;
  /* 読めなかったときは「合言葉が要る」に倒す。
     設定が読めないことを理由に誰でも上げられるようになる、は絶対に避ける。 */
  let cfg = { requireCode: true, codeHash: '' };
  try {
    const token = await getAccessToken(env, TOKEN_KEYS[0]);
    const p = ((await configFile(token)) || {}).appProperties || {};
    cfg = { requireCode: p.requireCode !== '0', codeHash: p.codeHash || '' };
  } catch (e) { /* 既定のまま＝合言葉が要る */ }
  cfgCache = cfg; cfgAt = Date.now();
  return cfg;
}

async function saveConfig(env, cfg) {
  const token = await getAccessToken(env, TOKEN_KEYS[0]);
  const props = {
    app: APP_TAG, kind: CONFIG_TAG,
    requireCode: cfg.requireCode ? '1' : '0',
    codeHash: cfg.codeHash || ''
  };
  const found = await configFile(token);
  const res = found
    ? await fetch('https://www.googleapis.com/drive/v3/files/' + found.id + '?fields=id', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: props })
    })
    : await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'funasun-settings', appProperties: props })
    });
  if (!res.ok) throw new Error('設定を保存できませんでした');
  cfgCache = null; cfgAt = 0;   // 次に聞かれたら取り直す
}

async function findFile(env, fileId) {
  let trouble = false;
  for (const a of await allTokens(env)) {
    try {
      const file = await driveMeta(a.token, fileId);
      if (file) return { token: a.token, file: file };
    } catch (e) { trouble = true; }
  }
  // 「どこにも無い」と言い切ってよいのは、全部のアカウントがちゃんと答えたときだけ
  if (trouble) throw new Error('ファイル情報の取得に失敗しました');
  return null;
}

async function driveMeta(token, id) {
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      '?fields=id,name,size,appProperties',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('ファイル情報の取得に失敗しました');
  return res.json();
}

async function driveDelete(token, id) {
  try {
    await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (e) { /* ignore */ }
}

/* ---------- ルーティング ---------- */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (path === '/admin/list' && request.method === 'POST') return await adminList(request, env, origin);
      if (path === '/admin/del' && request.method === 'POST') return await adminDelete(request, env, origin);
      if (path === '/admin/config' && request.method === 'POST') return await adminConfig(request, env, origin);
      if (path === '/admin/expiry' && request.method === 'POST') return await adminExpiry(request, env, origin);
      if (path === '/admin/rename' && request.method === 'POST') return await adminRename(request, env, origin);
      if (path === '/archive/list' && request.method === 'GET') return await archiveList(request, env, origin);
      if (path === '/archive/take' && request.method === 'GET') return await archiveTake(request, env, url, origin);
      if (path === '/archive/linkless' && request.method === 'GET') return await archiveLinkless(request, env, origin);
      if (path === '/archive/mark' && request.method === 'POST') return await archiveMark(request, env, origin);
      if (path === '/create' && request.method === 'POST') return await create(request, env, origin);
      if (path === '/part' && request.method === 'PUT') return await uploadPart(request, env, url, origin);
      if (path === '/where' && request.method === 'POST') return await uploadWhere(request, env, url, origin);
      /* 送る画面が「合言葉の欄を出すかどうか」を決めるために聞く。
         合言葉そのものは返さない。要るか要らないかは、試せば分かることなので隠さない。 */
      if (path === '/config' && request.method === 'GET') {
        return json({ requireCode: (await loadConfig(env)).requireCode }, 200, origin);
      }
      if (path.startsWith('/f/') && request.method === 'GET') return await landing(env, path.slice(3), url);
      if (path.startsWith('/g/') && request.method === 'GET') return await groupLanding(env, path.slice(3), url);
      if (path.startsWith('/ok/') && request.method === 'GET') return await checkPw(env, path.slice(4), url, origin);
      if (path.startsWith('/dl/')) return await serveFile(env, path.slice(4), url, request, false, origin);
      if (path.startsWith('/pv/')) return await serveFile(env, path.slice(4), url, request, true, origin);
      if (path === '/') return new Response('funasun-files', { status: 200, headers: corsHeaders(origin) });
    } catch (e) {
      return json({ message: (e && e.message) || 'サーバーでエラーが発生しました' }, 500, origin);
    }
    return json({ message: '見つかりません' }, 404, origin);
  },

  // 毎日: 期限切れを削除
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
};

/* ---------- アップロード ---------- */

async function create(request, env, origin) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ message: 'リクエストが不正です' }, 400, origin); }
  if (!b) return json({ message: 'リクエストが不正です' }, 400, origin);

  /* 置き場所を作ってよい人かを確かめる。入り口は2つある。
       ・合言葉（UPLOAD_CODE）… ファイルを送ってもらう人に教えるふつうの入り口
       ・Googleログイン        … 持ち主だけ。/admin で、まとめ直したPDFを
                                置き直すときに使う。こうしておけば管理画面に
                                合言葉を埋め込まずに済み、合言葉を変えても壊れない。 */
  if (b.idToken) {
    const bad = await verifyOwner(b.idToken, origin);
    if (bad) return bad;
  } else {
    const cfg = await loadConfig(env);
    if (cfg.requireCode) {
      /* 管理画面で決めた合言葉があればそれを使う。まだ決めていなければ、
         今までどおりシークレットの合言葉で照合する（切り替えの前後で止めないため）。 */
      const ok = cfg.codeHash
        ? (await sha256hex(b.code || '')) === cfg.codeHash
        : (!!env.UPLOAD_CODE && b.code === env.UPLOAD_CODE);
      if (!cfg.codeHash && !env.UPLOAD_CODE) {
        return json({ message: 'アップロードの設定が未完了です（合言葉が未登録）' }, 500, origin);
      }
      if (!ok) return json({ message: 'アップロード用の合言葉が違います。' }, 403, origin);
    }
  }

  const size = Number(b.size) || 0;
  if (size <= 0) return json({ message: 'ファイルが空です。' }, 400, origin);
  if (size > MAX_BYTES) return json({ message: 'ファイルが大きすぎます（上限 ' + MAX_GB + 'GB）。' }, 413, origin);

  /* 空きのある保管先を、登録した順に探す。
     どれも足りなければ、期限切れを片付けてから一度だけ探し直す。
     （毎回片付けようとすると、全ファイルを見に行くので重い。詰まった時だけでよい。） */
  const accounts = await allTokens(env);
  let token = await pickAccount(accounts, size);
  if (!token) {
    await cleanup(env);
    token = await pickAccount(accounts, size);
  }
  if (!token) {
    return json({ message: '保管庫の空き容量が不足しています。古いファイルが自動削除されるまで、しばらく待ってからお試しください。' }, 507, origin);
  }

  /* 無期限(0)を選べるのは持ち主だけ（この分岐に来た時点で idToken は検証済み）。
     公開画面から無期限を作れると、合言葉を知る誰かが保管庫を埋めきったまま
     永久に空かない、が起こるため。それ以外は決められた日数だけ。 */
  const wantDays = Number(b.expiryDays);
  let expiresAt;
  if (b.idToken && wantDays === 0) {
    expiresAt = 0;
  } else {
    const days = ALLOWED_DAYS.indexOf(wantDays) !== -1 ? wantDays : 7;
    expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  }

  const filename = (String(b.filename || 'file')).slice(0, 200);
  const pw = typeof b.pwHash === 'string' ? b.pwHash.slice(0, 128) : '';
  const contentType = (String(b.contentType || 'application/octet-stream')).slice(0, 120);
  // 複数ファイルを1つのURLで渡すための「まとめID」。ブラウザ側が乱数で作る。
  const grp = safeId(b.group || '').slice(0, 40);
  const idx = Math.max(0, Math.min(MAX_GROUP - 1, Number(b.index) || 0));

  const props = {
    app: APP_TAG,
    pw: pw,
    expiresAt: String(expiresAt),
    ctype: contentType
  };
  if (grp) { props.grp = grp; props.idx = String(idx); }

  // レジューム式アップロードのセッションを作る
  const init = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/octet-stream',
        'X-Upload-Content-Length': String(size)
      },
      body: JSON.stringify({ name: filename, appProperties: props })
    }
  );
  const sessionUri = init.headers.get('Location');
  if (!init.ok || !sessionUri) {
    return json({ message: 'アップロードを開始できませんでした。' }, 502, origin);
  }

  return json({ sessionUri: sessionUri, partSize: PART_SIZE, size: size }, 200, origin);
}

// セッションURIは必ず Google のアップロード先だけ許可（SSRF 防止）
function okSession(s) {
  return /^https:\/\/[a-z0-9.-]*\.googleapis\.com\//i.test(s);
}

/* 最後の分割が通ったときの返事。Google がファイルの情報を返してくる。 */
async function finished(res, request, origin) {
  const f = await res.json().catch(function () { return {}; });
  const id = f && f.id ? f.id : '';
  if (!id) return json({ message: '保存の確定に失敗しました' }, 502, origin);
  return json({ done: true, id: id, url: new URL(request.url).origin + '/f/' + id }, 200, origin);
}

/* ---- 「どこまで届いた？」を Google に聞く ----
   通信が切れたとき、送った側は「その分割が届いたのかどうか」が分からない。
   届いていたのにもう一度 0 から送り直すと、大きいファイルでは何時間も無駄になる。
   中身のない PUT を送って「範囲は未定、全体はこの大きさ」と伝えると、Google は
   「ここまで受け取った」と答えてくれる。そこから続ければよい。 */
async function uploadWhere(request, env, url, origin) {
  const session = url.searchParams.get('session') || '';
  const total = Number(url.searchParams.get('total') || '-1');
  if (!okSession(session) || total <= 0) return json({ message: 'パラメータが不正です' }, 400, origin);

  const res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + total } });
  if (res.status === 308) {
    // Range: bytes=0-1234 …「1234 番目まで受け取った」＝次に送るのは 1235 から。
    // まだ1バイトも届いていないときは Range そのものが付かない。
    const r = res.headers.get('Range') || '';
    const m = r.match(/bytes=0-(\d+)/);
    return json({ done: false, received: m ? Number(m[1]) + 1 : 0 }, 200, origin);
  }
  if (res.ok) return await finished(res, request, origin);       // すでに全部届いて確定していた
  return json({ message: 'アップロードの状態を確認できませんでした' }, 502, origin);
}

async function uploadPart(request, env, url, origin) {
  const session = url.searchParams.get('session') || '';
  const start = Number(url.searchParams.get('start') || '-1');
  const end = Number(url.searchParams.get('end') || '-1');    // この分割の「次のバイト」= 排他的終端
  const total = Number(url.searchParams.get('total') || '-1');
  if (!okSession(session)) {
    return json({ message: 'パラメータが不正です' }, 400, origin);
  }
  if (start < 0 || end <= start || total <= 0 || end > total) {
    return json({ message: 'パラメータが不正です' }, 400, origin);
  }
  if (!request.body) return json({ message: 'データがありません' }, 400, origin);

  const buf = await request.arrayBuffer();
  const range = 'bytes ' + start + '-' + (end - 1) + '/' + total;
  const res = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Range': range },
    body: buf
  });

  if (res.status === 308) {
    // まだ途中（正常）
    return json({ done: false }, 200, origin);
  }
  if (res.ok) return await finished(res, request, origin);   // 最後の分割：ファイルが確定した
  /* ここに来たら送り直してよいのかどうかを、送る側が判断できるようにしておく。
     Google が 5xx を返したときは待ってやり直せば通ることが多い。 */
  return json({ message: 'アップロード中にエラーが発生しました', retry: res.status >= 500 }, 502, origin);
}

/* ---------- ファイル本体を返す（ダウンロード／プレビュー共通）---------- */

function expired(meta) {
  const exp = Number((meta && meta.expiresAt) || 0);
  return exp > 0 && Date.now() > exp;
}

// 合言葉のチェック。合っていれば null、違えば返すべき Response
function pwGate(meta, url, id, asJson) {
  if (!meta.pw) return null;
  const h = url.searchParams.get('h') || '';
  if (h === meta.pw) return null;
  if (asJson) return new Response(JSON.stringify({ ok: false }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return htmlPage('合言葉が違います',
    '<p class="muted">合言葉が正しくありません。<a href="/f/' + esc(id) + '">戻る</a></p>', 403);
}

async function serveFile(env, rawId, url, request, inline, origin) {
  const fileId = safeId(rawId);
  const found = await findFile(env, fileId);
  if (!found) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しないか、削除されました。</p>', 404);
  const token = found.token;
  const file = found.file;
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しません。</p>', 404);
  if (expired(meta)) {
    await driveDelete(token, fileId);
    return htmlPage('期限切れ', '<p class="muted">このファイルは有効期限が切れて削除されました。</p>', 410);
  }
  const gate = pwGate(meta, url, rawId, false);
  if (gate) return gate;

  /* 本体が自宅の保管庫(NAS)へ引っ越し済みなら、そちらの受け取りリンクへ転送する。
     合言葉の確認(pwGate)を通ったあとでしか転送しないので、守りは今までと同じ。
     Drive 側は付箋だけの空ファイルになっている。 */
  if (meta.nasUrl) {
    return new Response(null, { status: 302,
      headers: Object.assign({ Location: meta.nasUrl }, corsHeaders(origin)) });
  }

  const filename = file.name || 'file';

  // プレビューは「安全だと分かっている拡張子」だけ。種類も拡張子だけから決める。
  let type = 'application/octet-stream';
  if (inline) {
    const t = previewType(filename);
    if (!t) return htmlPage('プレビューできません', '<p class="muted">この種類のファイルは、そのまま表示できません。ダウンロードしてご覧ください。</p>', 415);
    type = t;
  }

  // 途中から再開できるように Range をそのまま Google に渡す。
  // Cloudflare は流しっぱなしの応答から Content-Length を外してしまうため、
  // これが無いと途中で切れたダウンロードを再開できない（＝やり直しになる）。
  const range = request.headers.get('Range') || '';
  const gh = { Authorization: 'Bearer ' + token };
  if (range) gh.Range = range;

  const base = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media';
  let res = await fetch(base, { headers: gh });

  // Google が「あやしい」と判定したファイル（zip や実行ファイルで起きやすい）は
  // 403 で落ちる。これが「ダウンロードできないことがある」の主因。
  // acknowledgeAbuse を付ければ持ち主は取り出せる。ただし普通のファイルにまで
  // 付けて回るのは避けたいので、断られたときだけ付け直して1回やり直す。
  if (res.status === 403) {
    res = await fetch(base + '&acknowledgeAbuse=true', { headers: gh });
  }

  if (!res.ok && res.status !== 206) {
    // 何が起きたのか分かる形で返す（今までは全部「見つかりません」だった）
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) ? j.error.message : '';
    } catch (e) { /* 本文がJSONでないこともある */ }
    if (res.status === 403) {
      return htmlPage('ダウンロードできません',
        '<p class="muted">Google 側でこのファイルの取得が拒否されました。<br>時間をおいて、もう一度お試しください。</p>'
        + (detail ? '<p class="muted" style="font-size:12px;opacity:.7">' + esc(detail) + '</p>' : ''), 403);
    }
    if (res.status === 404) {
      return htmlPage('ファイルが見つかりません', '<p class="muted">削除された可能性があります。</p>', 404);
    }
    return htmlPage('ダウンロードできません',
      '<p class="muted">一時的にファイルを取り出せませんでした（' + esc(String(res.status)) + '）。<br>少し待ってから、もう一度お試しください。</p>'
      + (detail ? '<p class="muted" style="font-size:12px;opacity:.7">' + esc(detail) + '</p>' : ''), 502);
  }
  if (!res.body) return htmlPage('ダウンロードできません', '<p class="muted">ファイルの中身を取り出せませんでした。</p>', 502);

  const headers = new Headers();
  headers.set('Content-Type', type);
  headers.set('Content-Disposition',
    (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(filename));
  // 中身を見て種類を勝手に判断させない。画像として返したものは画像としてしか扱われない。
  headers.set('X-Content-Type-Options', 'nosniff');
  // 万一なにかが動いても、隔離された出所として扱わせる（このドメインに触れない）
  headers.set('Content-Security-Policy', "default-src 'none'; media-src 'self'; img-src 'self'; object-src 'none'; sandbox");
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Accept-Ranges', 'bytes');
  // 部分取得のときは、どこからどこまでかを必ずそのまま伝える
  const cr = res.headers.get('Content-Range');
  if (cr) headers.set('Content-Range', cr);
  const cl = res.headers.get('Content-Length') || (range ? '' : file.size);
  if (cl) headers.set('Content-Length', String(cl));

  /* 自分のサイト（/tools/ や /admin/）からは、このファイルを JavaScript で
     読めるようにする。「共有URLを貼るだけでPDFをまとめる」ためには、
     ブラウザがファイルの中身を読めないと始まらない。
     許すのは自分のドメインだけ。URLを知っている人は元々ダウンロードできるので、
     これで新しく見える人が増えるわけではない。
     元のファイル名を JavaScript 側から使えるように、その見出しも公開する。 */
  if (ALLOW_ORIGINS.indexOf(origin) !== -1) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    headers.set('Vary', 'Origin');
  }

  return new Response(res.body, { status: res.status === 206 ? 206 : 200, headers: headers });
}

// 合言葉が合っているかだけを answer する（プレビュー前の確認用）
async function checkPw(env, rawId, url, origin) {
  const fileId = safeId(rawId);
  const found = await findFile(env, fileId);
  if (!found) return json({ ok: false, gone: true }, 404, origin);
  const meta = found.file.appProperties || {};
  if (meta.app !== APP_TAG) return json({ ok: false, gone: true }, 404, origin);
  if (expired(meta)) return json({ ok: false, gone: true }, 410, origin);
  if (!meta.pw) return json({ ok: true }, 200, origin);
  const h = url.searchParams.get('h') || '';
  return json({ ok: h === meta.pw }, h === meta.pw ? 200 : 403, origin);
}

/* ---------- ダウンロード用ページ ---------- */

async function landing(env, id, url) {
  const fileId = safeId(id);
  const found = await findFile(env, fileId);
  if (!found) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しないか、期限切れで削除されました。</p>', 404);
  const token = found.token;
  const file = found.file;
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しません。</p>', 404);
  if (expired(meta)) {
    await driveDelete(token, fileId);
    return htmlPage('期限切れ', '<p class="muted">このファイルは有効期限が切れて削除されました。</p>', 410);
  }

  const filename = file.name || 'file';
  const needsPw = !!meta.pw;
  /* 本体がNASへ引っ越し済みなら、その場のプレビューはやめる
     （中継の仕組み上、絵や動画の枠の中では開けない）。ダウンロードは
     /dl/ 経由で NAS へ転送されるので今までどおり。大きさは引っ越し前の値を出す
     （Drive上は空になっていて 0 B と出てしまうため）。 */
  const onNas = !!meta.nasUrl;
  const kind = onNas ? null : previewKind(previewType(filename));
  const shownSize = Number(meta.origSize || 0) || Number(file.size) || 0;

  const body = `
    <div class="card">
      <p class="eyebrow">Download — ダウンロード</p>
      <h1 class="fname">${esc(filename)}</h1>
      <p class="meta">${esc(humanSize(shownSize))}　·　${esc(expiryText(meta.expiresAt))}</p>
      ${needsPw
        ? `<label class="lb">合言葉</label>
           <input id="pw" type="password" autocomplete="off" placeholder="合言葉を入力">
           <button id="unlock" class="btn">開く</button>
           <p id="msg" class="msg"></p>`
        : ''}
      <div id="area" ${needsPw ? 'hidden' : ''}>
        ${kind ? '<div id="pv" class="pv"></div>'
          : (onNas
            ? '<p class="muted nopv">保管庫からのお渡しになります。ダウンロードを押してから始まるまで、少し待つことがあります。</p>'
            : '<p class="muted nopv">この種類のファイルは、そのまま表示できません。</p>')}
        <a id="dlbtn" class="btn" href="#">ダウンロード</a>
      </div>
    </div>
    <script>
    (function () {
      var ID = ${jsStr(encodeURIComponent(id))};
      var KIND = ${jsStr(kind || '')};
      var NAME = ${jsStr(filename)};
      var NEEDS = ${needsPw ? 'true' : 'false'};
      ${PREVIEW_JS}
      function show(h) {
        var q = h ? '?h=' + h : '';
        document.getElementById('dlbtn').setAttribute('href', '/dl/' + ID + q);
        document.getElementById('area').hidden = false;
        var box = document.getElementById('pv');
        if (box) renderPreview(box, '/pv/' + ID + q, KIND, NAME);
      }
      if (!NEEDS) { show(''); return; }
      var btn = document.getElementById('unlock');
      var msg = document.getElementById('msg');
      btn.addEventListener('click', async function () {
        var v = document.getElementById('pw').value;
        if (!v) { msg.textContent = '合言葉を入力してください。'; return; }
        msg.textContent = '確認中…';
        var h = await sha256hex(v);
        var r = await fetch('/ok/' + ID + '?h=' + h);
        if (!r.ok) { msg.textContent = '合言葉が正しくありません。'; return; }
        msg.textContent = '';
        document.getElementById('pw').disabled = true;
        btn.hidden = true;
        show(h);
      });
      document.getElementById('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    })();
    </script>`;
  return htmlPage(filename, body, 200, !!kind);
}

/* ---------- まとめたファイル一覧のページ ---------- */

async function groupLanding(env, gid, url) {
  const groupId = safeId(gid);
  if (!groupId) return htmlPage('見つかりません', '<p class="muted">このURLは正しくありません。</p>', 404);
  const files = await listByGroup(env, groupId);

  const now = Date.now();
  const alive = [];
  for (const f of files) {
    const m = f.appProperties || {};
    const exp = Number(m.expiresAt || 0);
    if (exp > 0 && now > exp) { await driveDelete(f._tok, f.id); continue; }
    alive.push(f);
  }
  if (!alive.length) {
    return htmlPage('見つかりません', '<p class="muted">このファイルは存在しないか、期限切れで削除されました。</p>', 404);
  }
  alive.sort(function (a, b) {
    return (Number((a.appProperties || {}).idx) || 0) - (Number((b.appProperties || {}).idx) || 0);
  });

  const needsPw = !!(alive[0].appProperties || {}).pw;
  const exp = expiryText((alive[0].appProperties || {}).expiresAt);
  // 引っ越し済みのものは Drive 上では空なので、元の大きさで数える
  const sizeOf = function (f) {
    const m = f.appProperties || {};
    return Number(m.origSize || 0) || Number(f.size) || 0;
  };
  const totalSize = alive.reduce(function (s, f) { return s + sizeOf(f); }, 0);

  const rows = alive.map(function (f) {
    const name = f.name || 'file';
    // NASへ引っ越し済みは「見る」を出さない（中継の枠の中では開けない）
    const kind = (f.appProperties || {}).nasUrl ? null : previewKind(previewType(name));
    return `<li class="row" data-id="${esc(encodeURIComponent(f.id))}" data-kind="${esc(kind || '')}" data-name="${esc(name)}">
        <div class="rtop">
          <div class="rinfo">
            <span class="rname">${esc(name)}</span>
            <span class="rsize">${esc(humanSize(sizeOf(f)))}</span>
          </div>
          <div class="racts">
            ${kind ? '<button class="mini pvbtn" type="button">見る</button>' : ''}
            <a class="mini dl" href="#">保存</a>
          </div>
        </div>
        <div class="pv"></div>
      </li>`;
  }).join('\n');

  const body = `
    <div class="card wide">
      <p class="eyebrow">Download — ダウンロード</p>
      <h1 class="fname">${alive.length}個のファイル</h1>
      <p class="meta">合計 ${esc(humanSize(totalSize))}　·　${esc(exp)}</p>
      ${needsPw
        ? `<label class="lb">合言葉</label>
           <input id="pw" type="password" autocomplete="off" placeholder="合言葉を入力">
           <button id="unlock" class="btn">開く</button>
           <p id="msg" class="msg"></p>`
        : ''}
      <ul id="list" class="list" ${needsPw ? 'hidden' : ''}>${rows}</ul>
    </div>
    <script>
    (function () {
      var NEEDS = ${needsPw ? 'true' : 'false'};
      var FIRST = ${jsStr(encodeURIComponent(alive[0].id))};
      ${PREVIEW_JS}
      function wire(h) {
        var q = h ? '?h=' + h : '';
        document.getElementById('list').hidden = false;
        [].forEach.call(document.querySelectorAll('.row'), function (row) {
          var id = row.getAttribute('data-id');
          var kind = row.getAttribute('data-kind');
          var name = row.getAttribute('data-name');
          row.querySelector('.dl').setAttribute('href', '/dl/' + id + q);
          var btn = row.querySelector('.pvbtn');
          if (!btn) return;
          var box = row.querySelector('.pv');
          var open = false;
          btn.addEventListener('click', function () {
            open = !open;
            btn.textContent = open ? '閉じる' : '見る';
            if (!open) { box.innerHTML = ''; return; }
            renderPreview(box, '/pv/' + id + q, kind, name);
          });
        });
      }
      if (!NEEDS) { wire(''); return; }
      var btn = document.getElementById('unlock');
      var msg = document.getElementById('msg');
      btn.addEventListener('click', async function () {
        var v = document.getElementById('pw').value;
        if (!v) { msg.textContent = '合言葉を入力してください。'; return; }
        msg.textContent = '確認中…';
        var h = await sha256hex(v);
        var r = await fetch('/ok/' + FIRST + '?h=' + h);
        if (!r.ok) { msg.textContent = '合言葉が正しくありません。'; return; }
        msg.textContent = '';
        document.getElementById('pw').disabled = true;
        btn.hidden = true;
        wire(h);
      });
      document.getElementById('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    })();
    </script>`;
  return htmlPage(alive.length + '個のファイル', body, 200, true);
}

/* まとめの中身を集める。1回の送信の途中で保管先が満杯になると、
   ひとまとまりが2つのアカウントに分かれて入ることがある。だから全部から集めて合わせる。
   どのアカウントから来たかを _tok に添える（消すときにその鍵が要る）。 */
async function listByGroup(env, groupId) {
  const out = [];
  for (const a of await allTokens(env)) {
    let files = [];
    try { files = await groupIn(a.token, groupId); } catch (e) { continue; }
    for (const f of files) { f._tok = a.token; out.push(f); }
  }
  return out;
}

async function groupIn(token, groupId) {
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' }"
    + " and appProperties has { key='grp' and value='" + groupId + "' }"
    + ' and trashed=false';
  const u = 'https://www.googleapis.com/drive/v3/files'
    + '?q=' + encodeURIComponent(q)
    + '&fields=' + encodeURIComponent('files(id,name,size,appProperties)')
    + '&pageSize=' + MAX_GROUP;
  const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('ファイル一覧の取得に失敗しました');
  const j = await res.json();
  return (j && j.files) || [];
}

/* ---------- プレビューを描くための共通スクリプト ----------
   ダウンロードページとまとめページの両方に埋め込む。
   文字ファイルは textContent で入れるので、中身がHTMLでも絶対に解釈されない。 */

const PREVIEW_JS = `
      async function sha256hex(s) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
      function renderPreview(box, src, kind, name) {
        box.innerHTML = '';
        if (kind === 'image') {
          var img = document.createElement('img');
          img.src = src; img.alt = name; img.loading = 'lazy';
          img.onerror = function () { box.textContent = 'プレビューを読み込めませんでした。'; };
          box.appendChild(img);
        } else if (kind === 'video') {
          var v = document.createElement('video');
          v.src = src; v.controls = true; v.preload = 'metadata'; v.playsInline = true;
          /* iPhone の「高効率」形式(HEVC)などは、Android や Windows に
             再生できない端末がある。黙って黒い枠を見せるのが一番不親切なので、
             だめだった理由と、それでも受け取れる道を言葉で出す。 */
          v.onerror = function () {
            box.innerHTML = '';
            var p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'この端末では再生できない形式の動画です'
              + '（iPhoneで撮ったままの「高効率(HEVC)」などがこれにあたります）。'
              + '「保存」なら中身はそのまま受け取れて、対応アプリで見られます。';
            box.appendChild(p);
          };
          box.appendChild(v);
        } else if (kind === 'audio') {
          var a = document.createElement('audio');
          a.src = src; a.controls = true; a.preload = 'metadata';
          a.onerror = function () {
            box.innerHTML = '';
            var p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'この端末では再生できない形式の音声です。「保存」なら中身はそのまま受け取れます。';
            box.appendChild(p);
          };
          box.appendChild(a);
        } else if (kind === 'pdf') {
          /* ここに sandbox 属性を付けてはいけない。
             Chrome は sandbox の付いた枠の中では PDF ビューアを動かさず、
             「このページは Chrome によってブロックされています」になってしまう。
             どの値を入れてもだめで（"" も allow-scripts も allow-same-origin も）、
             付けないこと以外に表示させる方法がない。
             安全のほうは、これが無くても次の3つで守られている:
               ・そもそも pdf 以外はこの枠に来ない（拡張子の表で決めている）
               ・応答に nosniff と Content-Type: application/pdf を付けている
               ・PDF の中のスクリプトは Chrome の PDF ビューアの中に閉じていて、
                 このページの中身には触れられない */
          var f = document.createElement('iframe');
          f.src = src; f.title = name; f.referrerPolicy = 'no-referrer';
          box.appendChild(f);
        } else if (kind === 'text') {
          var pre = document.createElement('pre');
          pre.textContent = '読み込み中…';
          box.appendChild(pre);
          var cut = false;
          fetch(src, { headers: { Range: 'bytes=0-' + ${TEXT_PREVIEW_LIMIT} } })
            .then(function (r) {
              if (!r.ok && r.status !== 206) throw new Error();
              // 「bytes 0-307200/1234567」の形。最後まで取れていなければ途中表示と分かる
              var m = /bytes (\\d+)-(\\d+)\\/(\\d+)/.exec(r.headers.get('Content-Range') || '');
              if (m) cut = Number(m[2]) + 1 < Number(m[3]);
              return r.text();
            })
            .then(function (t) {
              pre.textContent = t + (cut ? '\\n\\n…（長いので途中まで表示しています。全部見るには保存してください）' : '');
            })
            .catch(function () { pre.textContent = 'プレビューを読み込めませんでした。'; });
        }
      }`;

/* ---------- 見た目つきHTML ---------- */

function htmlPage(title, inner, status, wide) {
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — ファイル共有</title>
<style>
  :root { --accent:#6f8cff; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:#060608; color:#f4f4f5; font-family:'Noto Sans JP',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .card { width:100%; max-width:${wide ? '720px' : '460px'}; padding:38px 34px; border:1px solid rgba(255,255,255,.12);
    border-radius:18px; background:linear-gradient(160deg,#0c0c11,#08080b); text-align:center; }
  .eyebrow { margin:0 0 14px; font-size:11px; letter-spacing:.34em; text-transform:uppercase; color:rgba(244,244,245,.45); }
  .fname { margin:0 0 8px; font-size:20px; font-weight:600; word-break:break-word; }
  .meta { margin:0 0 26px; font-size:12.5px; color:rgba(244,244,245,.5); }
  .lb { display:block; text-align:left; margin:0 0 8px; font-size:12px; color:rgba(244,244,245,.6); }
  input { width:100%; padding:13px 15px; margin-bottom:16px; border-radius:12px; border:1px solid rgba(255,255,255,.16);
    background:#0a0a0e; color:#f4f4f5; font-size:15px; outline:none; }
  input:focus { border-color:var(--accent); }
  .btn { display:inline-block; width:100%; padding:14px 20px; border-radius:999px; border:1px solid var(--accent);
    background:var(--accent); color:#060608; font-size:15px; font-weight:500; text-decoration:none; cursor:pointer; }
  .btn:hover { opacity:.9; }
  .msg { margin:14px 0 0; font-size:13px; min-height:18px; color:#ff8a8a; }
  .muted { color:rgba(244,244,245,.55); font-size:14px; line-height:1.9; }
  a { color:var(--accent); }
  /* プレビュー */
  .pv:empty { display:none; }
  .pv { margin:0 0 20px; }
  .pv img, .pv video { max-width:100%; max-height:56vh; border-radius:12px; display:block; margin:0 auto; background:#000; }
  .pv audio { width:100%; }
  .pv iframe { width:100%; height:56vh; border:0; border-radius:12px; background:#fff; }
  .pv pre { max-height:44vh; overflow:auto; text-align:left; margin:0; padding:16px 18px; border-radius:12px;
    background:#08080c; border:1px solid rgba(255,255,255,.1); font:400 12.5px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace;
    color:#dcdce0; white-space:pre-wrap; word-break:break-word; }
  .nopv { margin:0 0 20px; font-size:13px; }
  /* まとめ一覧 */
  .list { list-style:none; margin:0; padding:0; text-align:left; }
  .row { padding:16px 0; border-top:1px solid rgba(255,255,255,.1); }
  .rtop { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
  .rinfo { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1 1 200px; }
  .rname { font-size:14px; word-break:break-all; }
  .rsize { font-size:11.5px; color:rgba(244,244,245,.5); }
  .racts { display:flex; gap:8px; flex:none; }
  .mini { padding:8px 16px; border-radius:999px; font-size:12.5px; cursor:pointer; text-decoration:none;
    border:1px solid rgba(255,255,255,.22); background:none; color:#f4f4f5; }
  .mini.dl { border-color:var(--accent); color:var(--accent); }
  .mini:hover { background:rgba(255,255,255,.06); }
  .row .pv { margin:16px 0 0; }
</style></head><body>${inner.indexOf('class="card') === -1 ? '<div class="card">' + inner + '</div>' : inner}</body></html>`;
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------- 使用量集計 / 期限切れ掃除 ---------- */

async function listOwnFiles(token, onFile, extraFields) {
  let pageToken;
  // 設定の入れ物は預かりものではないので、数にも一覧にも出さない
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' }"
    + " and not appProperties has { key='kind' and value='" + CONFIG_TAG + "' } and trashed=false";
  const fields = 'nextPageToken,files(id,size,appProperties' + (extraFields ? ',' + extraFields : '') + ')';
  do {
    const u = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent(fields)
      + '&pageSize=1000'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const res = await fetch(u, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('ファイル一覧の取得に失敗しました');
    const j = await res.json();
    const files = (j && j.files) || [];
    for (const f of files) await onFile(f);
    pageToken = j && j.nextPageToken ? j.nextPageToken : undefined;
  } while (pageToken);
}


/* ============================================================
   管理用（/admin から呼ばれる）
   ============================================================ */

/* Google ログインの証明書（IDトークン）が本物か、Google 自身に問い合わせて確かめる。
   自前で中身を読むのではなく Google に聞くので、偽造されたものは必ず弾かれる。
   返り値は「本人ならnull／だめなら返すべきエラー応答」。 */
async function requireOwner(request, env, origin) {
  let body;
  try { body = await request.json(); }
  catch (e) { return { err: json({ message: 'リクエストが不正です' }, 400, origin) }; }

  const idToken = body && body.idToken;
  if (!idToken) return { err: json({ message: 'ログインが必要です' }, 401, origin) };

  const bad = await verifyOwner(idToken, origin);
  if (bad) return { err: bad };
  return { body: body };
}

/* IDトークンが本当に持ち主のものか、Google に聞いて確かめる。
   自分で中身を読まずに聞きに行くので、偽物のトークンは必ず弾かれる。
   合っていれば null、だめならそのまま返せるエラー応答を返す。 */
async function verifyOwner(idToken, origin) {
  let email, verified;
  try {
    const r = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: idToken }) }
    );
    const j = await r.json();
    if (!r.ok || !j.users || !j.users[0]) {
      return json({ message: 'ログインの確認に失敗しました。ログインし直してください。' }, 401, origin);
    }
    email = j.users[0].email;
    verified = j.users[0].emailVerified;
  } catch (e) {
    return json({ message: 'ログイン確認でエラーが発生しました' }, 502, origin);
  }

  if (email !== OWNER_EMAIL || !verified) {
    return json({ message: 'このアカウントには権限がありません。' }, 403, origin);
  }
  return null;
}

// 預かっている全ファイルを、渡すためのURL付きで返す
async function adminList(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;

  const accounts = await allTokens(env);
  const base = new URL(request.url).origin;
  const now = Date.now();
  const items = [];
  let used = 0;

  const onFile = function (f) {
    const p = f.appProperties || {};
    const exp = Number(p.expiresAt || 0);
    /* 大きさは2つの意味を持つようになった。
       表示する大きさ＝元のファイルの大きさ（引っ越し後も相手が受け取る量）。
       使用量メーター＝Drive を実際に占めている量（引っ越し済みはほぼ0）。 */
    const size = Number(p.origSize || 0) || Number(f.size) || 0;
    const driveSize = Number(f.size) || 0;
    const isExpired = exp > 0 && now > exp;
    if (!isExpired) used += driveSize;
    items.push({
      id: f.id,
      name: f.name || '(名前なし)',
      size: size,
      sizeText: humanSize(size),
      createdTime: f.createdTime || '',
      expiresAt: exp,
      expiresText: exp ? fmtDate(exp) : '',
      expired: isExpired,
      locked: !!p.pw,                       // 合言葉つきか（合言葉そのものは返さない）
      nas: p.nas === '1',                   // NASに控えが取れているか
      nasServed: !!p.nasUrl,                // 本体がNASへ引っ越し済み（Driveは付箋だけ）
      group: p.grp || '',
      pageUrl: base + '/f/' + f.id,
      downloadUrl: base + '/dl/' + f.id,
      previewUrl: previewType(f.name) ? base + '/pv/' + f.id : '',
      groupUrl: p.grp ? base + '/g/' + p.grp : ''
    });
  };

  /* 保管先ごとに、預かっているものと本当の空きを見る。
     cap（あとどれだけ預かれるか）は決め打ちの数字ではなく、Google に聞いた
     実際の空きから RESERVE を引いたもの。メールが増えれば自動で減る。 */
  const stores = [];
  let room = 0;
  for (const a of accounts) {
    let n = 0;
    const before = items.length;
    try { await listOwnFiles(a.token, function (f) { onFile(f); n++; }, 'name,createdTime'); }
    catch (e) { items.length = before; }
    const sp = await freeSpace(a.token);
    if (sp) room += sp.free;
    stores.push({
      key: a.key, files: n,
      limitText: sp ? (sp.limit ? humanSize(sp.limit) : '上限なし') : '不明',
      // 有料で増えている間は limit と食い違う。使ってよい量はこちら
      safeText: sp ? humanSize(sp.safe) : '不明',
      capped: !!(sp && sp.limit && sp.limit > sp.safe),
      usedText: sp ? humanSize(sp.usage) : '不明',        // メール・写真も含めた全体
      freeText: sp ? humanSize(sp.free) : '不明',
      ok: !!sp
    });
  }
  // 鍵はあるのに使えなかった保管先も隠さず出す
  for (const key of (accounts.bad || [])) {
    stores.push({ key: key, files: 0, limitText: '—', usedText: '—', freeText: '—', ok: false });
  }

  // 新しい順（作成日が取れないものは末尾）
  items.sort(function (a, b) { return String(b.createdTime).localeCompare(String(a.createdTime)); });

  return json({
    files: items,
    used: used, usedText: humanSize(used),               // この道具が預かっている分
    cap: used + room, capText: humanSize(used + room),   // 預かれる見込みの合計
    reserveText: humanSize(RESERVE),
    stores: stores
  }, 200, origin);
}

// ファイルを1つ消す
async function adminDelete(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;

  const id = safeId(String((gate.body && gate.body.id) || ''));
  if (!id) return json({ message: '消すファイルが指定されていません' }, 400, origin);

  // このアプリが作ったファイルかを必ず確かめてから消す
  const found = await findFile(env, id);
  if (!found || !found.file.appProperties || found.file.appProperties.app !== APP_TAG) {
    return json({ message: 'そのファイルは見つかりませんでした' }, 404, origin);
  }
  await driveDelete(found.token, id);
  return json({ ok: true }, 200, origin);
}

/* アップロード用の合言葉の設定。読むのも変えるのも持ち主だけ。
   save が無ければ「今どうなっているか」を答えるだけ。
   合言葉そのものは、保存もせず、返しもしない（潰した形だけを持つ）。 */
async function adminConfig(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;
  const b = gate.body || {};

  if (b.save) {
    const cur = await loadConfig(env);
    const code = typeof b.code === 'string' ? b.code : '';
    const next = {
      requireCode: !!b.requireCode,
      // 空のまま送られたら、今の合言葉をそのまま残す（うっかり消させない）
      codeHash: code ? await sha256hex(code) : cur.codeHash
    };
    if (next.requireCode && !next.codeHash && !env.UPLOAD_CODE) {
      return json({ message: '合言葉が空です。合言葉を決めるか、「合言葉なし」を選んでください。' }, 400, origin);
    }
    await saveConfig(env, next);
  }

  const cfg = await loadConfig(env);
  return json({
    requireCode: cfg.requireCode,
    hasCode: !!cfg.codeHash,
    // まだ管理画面で決めていない＝Cloudflare に登録した合言葉が使われている
    usingSecret: !cfg.codeHash && !!env.UPLOAD_CODE
  }, 200, origin);
}

/* 預かり中のファイルの期限を変える。持ち主だけ。
   days は「今からの日数」。0 は無期限（作れるのも持ち主だけ、と揃えてある）。
   Drive の appProperties は書いた鍵だけが差し替わるので、
   合言葉や まとめID など他の付箋はそのまま残る。 */
async function adminExpiry(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;

  const id = safeId(String((gate.body && gate.body.id) || ''));
  if (!id) return json({ message: '対象のファイルが指定されていません' }, 400, origin);
  const days = Number((gate.body || {}).days);
  if (days !== 0 && ALLOWED_DAYS.indexOf(days) === -1) {
    return json({ message: '期限は 1・3・7・30日 か 無期限 だけです' }, 400, origin);
  }

  const found = await findFile(env, id);
  if (!found || !found.file.appProperties || found.file.appProperties.app !== APP_TAG) {
    return json({ message: 'そのファイルは見つかりませんでした' }, 404, origin);
  }

  const expiresAt = days === 0 ? 0 : Date.now() + days * 24 * 60 * 60 * 1000;
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + found.file.id + '?fields=id', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties: { expiresAt: String(expiresAt) } })
  });
  if (!res.ok) return json({ message: '期限を変えられませんでした' }, 502, origin);
  return json({ ok: true, expiresAt: expiresAt,
    expiresText: expiresAt ? fmtDate(expiresAt) : '' }, 200, origin);
}

/* 預かり中のファイルの名前を変える。持ち主だけ。
   受け取りページの表示も、保存されるときの名前も、これで変わる。
   「見る」が働くかどうかは拡張子で決めているので、新しい名前に拡張子が
   無ければ元の拡張子を付け足す（うっかり消して開けなくなるのを防ぐ）。 */
async function adminRename(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;

  const id = safeId(String((gate.body && gate.body.id) || ''));
  if (!id) return json({ message: '対象のファイルが指定されていません' }, 400, origin);
  let name = String((gate.body || {}).name || '').trim()
    .replace(/[\/\\]/g, '').slice(0, 200);
  if (!name) return json({ message: '新しい名前を入力してください' }, 400, origin);

  const found = await findFile(env, id);
  if (!found || !found.file.appProperties || found.file.appProperties.app !== APP_TAG) {
    return json({ message: 'そのファイルは見つかりませんでした' }, 404, origin);
  }

  const oldExt = extOf(found.file.name);
  if (!extOf(name) && oldExt) name += '.' + oldExt;

  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + found.file.id + '?fields=id,name', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  });
  if (!res.ok) return json({ message: '名前を変えられませんでした' }, 502, origin);
  return json({ ok: true, name: name }, 200, origin);
}

/* ============================================================
   NAS 用の窓口（/archive/*）
   ------------------------------------------------------------
   自宅の NAS が定期的に取りに来て、預かりものの控えを作るための窓口。
   NAS はインターネットに出ていないので、こちらから押し付けることはできず、
   向こうから取りに来る（ポーリング）しかない。

   認証は NAS 専用の合言葉 NAS_KEY 1本（X-Nas-Key ヘッダ）。
   Google の鍵を NAS に置かずに済ませるための間仕切りで、
   この鍵で出来るのは「一覧を見る・中身を読む・控え済み印を付ける」だけ。
   消す・書き換える類いは一切できない。
   ============================================================ */

function nasGate(env, request, origin) {
  // 鍵が未登録のうちは、窓口ごと閉じておく（誰も通れない）
  if (!env.NAS_KEY) return json({ message: 'NASの窓口は準備中です' }, 503, origin);
  if ((request.headers.get('X-Nas-Key') || '') !== env.NAS_KEY) {
    return json({ message: '鍵が違います' }, 403, origin);
  }
  return null;
}

/* まだ控えの無いファイルの一覧。JSONではなくタブ区切りの行で返す。
   NAS のシェル(BusyBox)には jq が無く、JSONを安全に読めないため。
   形: <ID>タブ<バイト数>タブ<期限日>タブ<名前>。
   期限日は「NASの受け取りリンクに付ける有効期限」(YYYY-MM-DD)。ページの期限の
   翌日にしてある（リンクは日単位でしか切れないので、早すぎて先に死ぬより
   1日長生きするほうに倒す。ページ自体の期限は今までどおり分単位で効く）。
   無期限のファイルは空欄。NAS側で日付計算をさせないための列。
   名前の中のタブ・改行は空白に潰す。名前は最後の列（名前に何が入っていても
   前の列がずれないように）。 */
async function archiveList(request, env, origin) {
  const gate = nasGate(env, request, origin);
  if (gate) return gate;
  const lines = [];
  for (const a of await allTokens(env)) {
    try {
      // 'name' を頼まないと Google は名前を返さない（頼んだ項目しか来ない）
      await listOwnFiles(a.token, (f) => {
        const p = f.appProperties || {};
        if (p.nas === '1') return;   // 控え済みはもう出さない
        const exp = Number(p.expiresAt || 0);
        const linkExp = exp ? fmtDate(exp + 24 * 60 * 60 * 1000).replace(/\//g, '-') : '';
        lines.push([f.id, Number(f.size) || 0, linkExp,
          String(f.name || 'file').replace(/[\t\r\n]/g, ' ')].join('\t'));
      }, 'name');
    } catch (e) { /* この保管先は次の回に */ }
  }
  return new Response(lines.length ? lines.join('\n') + '\n' : '',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/* 控えは取れているが、まだ受け取りリンクが無いもの（＝引っ越しが済んでいないもの）。
   形: <ID>タブ<期限日>タブ<名前>。NAS 側はこの一覧を見て、手元の控えに
   リンクを作って mark(link付き) で完了届を出す。中身の取り直しは要らない。 */
async function archiveLinkless(request, env, origin) {
  const gate = nasGate(env, request, origin);
  if (gate) return gate;
  const lines = [];
  for (const a of await allTokens(env)) {
    try {
      await listOwnFiles(a.token, (f) => {
        const p = f.appProperties || {};
        if (p.nas !== '1' || p.nasUrl) return;
        const exp = Number(p.expiresAt || 0);
        const linkExp = exp ? fmtDate(exp + 24 * 60 * 60 * 1000).replace(/\//g, '-') : '';
        lines.push([f.id, linkExp,
          String(f.name || 'file').replace(/[\t\r\n]/g, ' ')].join('\t'));
      }, 'name');
    } catch (e) { /* この保管先は次の回に */ }
  }
  return new Response(lines.length ? lines.join('\n') + '\n' : '',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// 1ファイルの中身。合言葉(pw)の確認はしない＝NAS_KEY そのものが持ち主の証。
async function archiveTake(request, env, url, origin) {
  const gate = nasGate(env, request, origin);
  if (gate) return gate;
  const id = safeId(url.searchParams.get('id') || '');
  const found = await findFile(env, id);
  if (!found || (found.file.appProperties || {}).app !== APP_TAG) {
    return json({ message: '見つかりません' }, 404, origin);
  }
  const r = await fetch('https://www.googleapis.com/drive/v3/files/'
    + encodeURIComponent(found.file.id) + '?alt=media',
    { headers: { Authorization: 'Bearer ' + found.token } });
  if (!r.ok) return json({ message: '取り出せませんでした' }, 502, origin);
  const headers = { 'Content-Type': 'application/octet-stream' };
  const len = r.headers.get('Content-Length');
  if (len) headers['Content-Length'] = len;
  return new Response(r.body, { status: 200, headers: headers });
}

/* 「NASに控えました」の印を付ける。付くと一覧に出なくなり、
   管理画面に「NAS済み」と表示される。
   undo:true なら印を外す＝次の回にもう一度取りに来る
   （NAS側の控えを捨てて取り直したいときに使う）。

   link 付き＝引っ越しの完了届。NASが作った受け取りリンクを記録し、
   Drive の中身を空にして容量を返す（付箋とID＝URLは残るので、
   配ったリンクはそのまま生きて、以後は NAS へ転送される）。
   順番が大事: 先にリンクと元の大きさを付箋に書き、それが成功してから
   中身を空にする。逆だと、空にしたのに行き先が書けなかったとき
   相手が何も受け取れなくなる。 */
async function archiveMark(request, env, origin) {
  const gate = nasGate(env, request, origin);
  if (gate) return gate;
  let body = {};
  try { body = await request.json(); } catch (e) { }
  const id = safeId(String(body.id || ''));
  if (!id) return json({ message: '対象が指定されていません' }, 400, origin);

  const link = String(body.link || '').trim();
  // 転送先にできるのは Synology の受け取りリンクだけ（他所へ飛ばす窓口にしない）
  if (link && !/^https:\/\/(gofile\.me\/|[a-z0-9-]+\.quickconnect\.to\/)/i.test(link)) {
    return json({ message: 'リンクの形が想定と違います' }, 400, origin);
  }
  if (link && link.length > 120) return json({ message: 'リンクが長すぎます' }, 400, origin);

  const found = await findFile(env, id);
  const p = (found && found.file.appProperties) || {};
  if (!found || p.app !== APP_TAG || p.kind === CONFIG_TAG) {
    return json({ message: '見つかりません' }, 404, origin);
  }

  const props = body.undo
    ? { nas: null, nasUrl: null, origSize: null }
    : (link
      ? { nas: '1', nasUrl: link, origSize: String(found.file.size || 0) }
      : { nas: '1' });
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + found.file.id + '?fields=id', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties: props })
  });
  if (!res.ok) return json({ message: '印を付けられませんでした' }, 502, origin);

  // 行き先が書けたので、中身を空にして容量を返す
  let emptied = false;
  if (link && !body.undo) {
    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files/'
      + encodeURIComponent(found.file.id) + '?uploadType=media&fields=id,size', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + found.token, 'Content-Type': 'application/octet-stream' },
      body: ''
    });
    emptied = up.ok;   // 失敗しても配布は生きている（NASへ転送される）。容量だけ返り損ね
  }
  return json({ ok: true, undone: !!body.undo, emptied: emptied }, 200, origin);
}

async function cleanup(env) {
  const now = Date.now();
  for (const a of await allTokens(env)) {
    // 1つのアカウントで転んでも、残りの片付けは続ける
    try {
      await listOwnFiles(a.token, async function (f) {
        const meta = f.appProperties || {};
        const exp = Number(meta.expiresAt || 0);
        if (exp > 0 && now > exp) await driveDelete(a.token, f.id);
      });
    } catch (e) { /* このアカウントは次の機会に */ }
  }
}
