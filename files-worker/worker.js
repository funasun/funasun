/* ============================================================
   funasun-files — ファイル共有 Worker（ギガファイル便ふう）
   ------------------------------------------------------------
   ・保管先は Google ドライブ（船越さんの15GB無料・カード不要）。
   ・使う権限は drive.file（このアプリが作ったファイルだけ）。安全な最小権限。
   ・アップロードは「合言葉（env.UPLOAD_CODE）」を知っている人だけ。
   ・大きいファイルは分割（レジューム式）でアップロードするので GB 級もOK。
     分割データはブラウザ →(この Worker)→ Google と中継する。
   ・各ファイルに任意の「ダウンロード合言葉」と「有効期限」を付けられる。
     期限切れは毎日の cron ＋ アクセス時チェックで自動削除。
   ・ダウンロードは必ず添付（強制ダウンロード）で返し、ブラウザ上で
     実行されないようにする（悪用対策）。
   ・保管庫の合計上限（TOTAL_CAP）を超えるアップロードは断る＝無駄に
     Google の容量（＝Gmail 等と共有）を埋めない。

   必要な Worker シークレット:
     UPLOAD_CODE           … アップロード用の合言葉
     GOOGLE_CLIENT_ID      … OAuth クライアントID
     GOOGLE_CLIENT_SECRET  … OAuth クライアントシークレット
     GOOGLE_REFRESH_TOKEN  … 一度だけ取得するリフレッシュトークン

   エンドポイント（すべて JSON。ファイル本体だけ生バイト）:
     POST /create      … アップロード開始（合言葉チェック＋レジューム枠作成）
     PUT  /part        … 分割データを1つ中継する（?session=&start=&end=&total=）
     GET  /f/:id       … ダウンロード用のページ（見た目つき）
     GET  /dl/:id      … ファイル本体を返す（?h=合言葉のハッシュ）
   ============================================================ */

const ALLOW_ORIGINS = [
  'https://tsutsumufunakoshi.com',
  'https://www.tsutsumufunakoshi.com'
];
const MAX_BYTES = 2 * 1024 * 1024 * 1024;      // 1ファイル上限 2GB
const TOTAL_CAP = 10 * 1024 * 1024 * 1024;     // 保管庫の合計上限 10GB（15GBの手前で止める）
const PART_SIZE = 10 * 1024 * 1024;            // 分割サイズ 10MB（Google の 256KB 倍数条件を満たす）
const ALLOWED_DAYS = [1, 3, 7, 30];            // 選べる有効期限（日）
const APP_TAG = 'funasun';                     // 自分のファイルを見分ける印

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
  // Google の fileId は英数と - _ のみ
  return String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

/* ---------- Google OAuth / Drive API ---------- */

async function getAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Googleの設定が未完了です（認証情報が未登録）');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const j = await res.json().catch(function () { return {}; });
  if (!res.ok || !j.access_token) {
    throw new Error('Google認証に失敗しました' + (j.error_description ? '（' + j.error_description + '）' : ''));
  }
  return j.access_token;
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
      if (path === '/create' && request.method === 'POST') return await create(request, env, origin);
      if (path === '/part' && request.method === 'PUT') return await uploadPart(request, env, url, origin);
      if (path.startsWith('/f/') && request.method === 'GET') return await landing(env, path.slice(3), url);
      if (path.startsWith('/dl/') && request.method === 'GET') return await download(env, path.slice(4), url);
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
  if (!env.UPLOAD_CODE) return json({ message: 'アップロードの設定が未完了です（合言葉が未登録）' }, 500, origin);
  let b;
  try { b = await request.json(); } catch (e) { return json({ message: 'リクエストが不正です' }, 400, origin); }

  if (!b || b.code !== env.UPLOAD_CODE) return json({ message: 'アップロード用の合言葉が違います。' }, 403, origin);

  const size = Number(b.size) || 0;
  if (size <= 0) return json({ message: 'ファイルが空です。' }, 400, origin);
  if (size > MAX_BYTES) return json({ message: 'ファイルが大きすぎます（上限 2GB）。' }, 413, origin);

  const token = await getAccessToken(env);

  // 保管庫の合計上限チェック（無料枠の手前で必ず止める）
  const used = await currentUsage(env, token);
  if (used + size > TOTAL_CAP) {
    return json({ message: '保管庫の空き容量が不足しています。古いファイルが自動削除されるまで、しばらく待ってからお試しください。' }, 507, origin);
  }

  const days = ALLOWED_DAYS.indexOf(Number(b.expiryDays)) !== -1 ? Number(b.expiryDays) : 7;
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;

  const filename = (String(b.filename || 'file')).slice(0, 200);
  const pw = typeof b.pwHash === 'string' ? b.pwHash.slice(0, 128) : '';
  const contentType = (String(b.contentType || 'application/octet-stream')).slice(0, 120);

  // レジューム式アップロードのセッションを作る
  const metadata = {
    name: filename,
    appProperties: {
      app: APP_TAG,
      pw: pw,
      expiresAt: String(expiresAt),
      ctype: contentType
    }
  };
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
      body: JSON.stringify(metadata)
    }
  );
  const sessionUri = init.headers.get('Location');
  if (!init.ok || !sessionUri) {
    return json({ message: 'アップロードを開始できませんでした。' }, 502, origin);
  }

  return json({ sessionUri: sessionUri, partSize: PART_SIZE, size: size }, 200, origin);
}

async function uploadPart(request, env, url, origin) {
  const session = url.searchParams.get('session') || '';
  const start = Number(url.searchParams.get('start') || '-1');
  const end = Number(url.searchParams.get('end') || '-1');    // この分割の「次のバイト」= 排他的終端
  const total = Number(url.searchParams.get('total') || '-1');
  // セッションURIは必ず Google のアップロード先だけ許可（SSRF 防止）
  if (!/^https:\/\/[a-z0-9.-]*\.googleapis\.com\//i.test(session)) {
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
  if (res.ok) {
    // 最後の分割：ファイルが確定した
    const f = await res.json().catch(function () { return {}; });
    const id = f && f.id ? f.id : '';
    if (!id) return json({ message: '保存の確定に失敗しました' }, 502, origin);
    return json({ done: true, id: id, url: new URL(request.url).origin + '/f/' + id }, 200, origin);
  }
  return json({ message: 'アップロード中にエラーが発生しました' }, 502, origin);
}

/* ---------- ダウンロード ---------- */

function expired(meta) {
  const exp = Number((meta && meta.expiresAt) || 0);
  return exp > 0 && Date.now() > exp;
}

async function landing(env, id, url) {
  const fileId = safeId(id);
  const token = await getAccessToken(env);
  const file = await driveMeta(token, fileId);
  if (!file) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しないか、期限切れで削除されました。</p>', 404);
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しません。</p>', 404);
  if (expired(meta)) {
    await driveDelete(token, fileId);
    return htmlPage('期限切れ', '<p class="muted">このファイルは有効期限が切れて削除されました。</p>', 410);
  }
  const filename = file.name || 'file';
  const size = humanSize(file.size);
  const needsPw = !!meta.pw;
  const expDate = new Date(Number(meta.expiresAt || 0));
  const expStr = expDate.getFullYear() + '/' + ('0' + (expDate.getMonth() + 1)).slice(-2) + '/' + ('0' + expDate.getDate()).slice(-2);
  const dlBase = url.origin + '/dl/' + encodeURIComponent(id);

  const body = `
    <div class="card">
      <p class="eyebrow">Download — ダウンロード</p>
      <h1 class="fname">${esc(filename)}</h1>
      <p class="meta">${esc(size)}　·　有効期限 ${esc(expStr)} まで</p>
      ${needsPw
        ? `<label class="lb">合言葉</label>
           <input id="pw" type="password" autocomplete="off" placeholder="合言葉を入力">
           <button id="dl" class="btn">ダウンロード</button>
           <p id="msg" class="msg"></p>`
        : `<a class="btn" href="${esc(dlBase)}">ダウンロード</a>`}
    </div>
    <script>
      (function () {
        var btn = document.getElementById('dl');
        if (!btn) return;
        var msg = document.getElementById('msg');
        async function sha256hex(s) {
          var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
          return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        }
        btn.addEventListener('click', async function () {
          var pw = document.getElementById('pw').value;
          if (!pw) { msg.textContent = '合言葉を入力してください。'; return; }
          msg.textContent = '確認中…';
          var h = await sha256hex(pw);
          location.href = ${JSON.stringify(dlBase)} + '?h=' + h;
        });
        document.getElementById('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
      })();
    </script>`;
  return htmlPage(filename, body, 200);
}

async function download(env, id, url) {
  const fileId = safeId(id);
  const token = await getAccessToken(env);
  const file = await driveMeta(token, fileId);
  if (!file) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しないか、削除されました。</p>', 404);
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しません。</p>', 404);
  if (expired(meta)) {
    await driveDelete(token, fileId);
    return htmlPage('期限切れ', '<p class="muted">このファイルは有効期限が切れて削除されました。</p>', 410);
  }
  if (meta.pw) {
    const h = url.searchParams.get('h') || '';
    if (h !== meta.pw) return htmlPage('合言葉が違います', '<p class="muted">合言葉が正しくありません。<a href="/f/' + esc(id) + '">戻る</a></p>', 403);
  }

  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (!res.ok || !res.body) return htmlPage('ファイルが見つかりません', '<p class="muted">削除された可能性があります。</p>', 404);

  const filename = file.name || 'file';
  const headers = new Headers();
  // 必ず添付（強制ダウンロード）＋汎用タイプで、ブラウザ上での実行を防ぐ
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename));
  if (file.size) headers.set('Content-Length', String(file.size));
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: 200, headers: headers });
}

/* ---------- 見た目つきHTML ---------- */

function htmlPage(title, inner, status) {
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — ファイル共有</title>
<style>
  :root { --accent:#6f8cff; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:#060608; color:#f4f4f5; font-family:'Noto Sans JP',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .card { width:100%; max-width:460px; padding:38px 34px; border:1px solid rgba(255,255,255,.12);
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
</style></head><body>${inner.indexOf('class="card"') === -1 ? '<div class="card">' + inner + '</div>' : inner}</body></html>`;
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------- 使用量集計 / 期限切れ掃除 ---------- */

async function listOwnFiles(token, onFile) {
  let pageToken;
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' } and trashed=false";
  do {
    const u = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent('nextPageToken,files(id,size,appProperties)')
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

// 現在の使用量（バイト）を合計。ついでに期限切れは掃除する。
async function currentUsage(env, token) {
  let total = 0;
  const now = Date.now();
  await listOwnFiles(token, async function (f) {
    const meta = f.appProperties || {};
    const exp = Number(meta.expiresAt || 0);
    if (exp > 0 && now > exp) {
      await driveDelete(token, f.id);
      return; // 期限切れは数えない
    }
    total += Number(f.size) || 0;
  });
  return total;
}

async function cleanup(env) {
  const token = await getAccessToken(env);
  const now = Date.now();
  await listOwnFiles(token, async function (f) {
    const meta = f.appProperties || {};
    const exp = Number(meta.expiresAt || 0);
    if (exp > 0 && now > exp) await driveDelete(token, f.id);
  });
}
