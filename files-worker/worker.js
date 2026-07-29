/* ============================================================
   funasun-files — ファイル共有 Worker（ギガファイル便ふう）
   ------------------------------------------------------------
   ・保管先は Google ドライブ（船越さんの15GB無料・カード不要）。
   ・使う権限は drive.file（このアプリが作ったファイルだけ）。安全な最小権限。
   ・アップロードは「合言葉（env.UPLOAD_CODE）」を知っている人だけ。
   ・大きいファイルは分割（レジューム式）でアップロードするので GB 級もOK。
     分割データはブラウザ →(この Worker)→ Google と中継する。
   ・複数ファイルは「まとめID（grp）」で束ね、/g/:id の1つのURLで渡せる。
   ・各ファイルに任意の「ダウンロード合言葉」と「有効期限」を付けられる。
     期限切れは毎日の cron ＋ アクセス時チェックで自動削除。
   ・保管庫の合計上限（TOTAL_CAP）を超えるアップロードは断る＝無駄に
     Google の容量（＝Gmail 等と共有）を埋めない。

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
const MAX_BYTES = 2 * 1024 * 1024 * 1024;      // 1ファイル上限 2GB
const TOTAL_CAP = 10 * 1024 * 1024 * 1024;     // 保管庫の合計上限 10GB（15GBの手前で止める）
const PART_SIZE = 10 * 1024 * 1024;            // 分割サイズ 10MB（Google の 256KB 倍数条件を満たす）
const ALLOWED_DAYS = [1, 3, 7, 30];            // 選べる有効期限（日）
const APP_TAG = 'funasun';                     // 自分のファイルを見分ける印
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
      if (path === '/admin/list' && request.method === 'POST') return await adminList(request, env, origin);
      if (path === '/admin/del' && request.method === 'POST') return await adminDelete(request, env, origin);
      if (path === '/create' && request.method === 'POST') return await create(request, env, origin);
      if (path === '/part' && request.method === 'PUT') return await uploadPart(request, env, url, origin);
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
    if (!env.UPLOAD_CODE) return json({ message: 'アップロードの設定が未完了です（合言葉が未登録）' }, 500, origin);
    if (b.code !== env.UPLOAD_CODE) return json({ message: 'アップロード用の合言葉が違います。' }, 403, origin);
  }

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
  const token = await getAccessToken(env);
  const file = await driveMeta(token, fileId);
  if (!file) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しないか、削除されました。</p>', 404);
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return htmlPage('ファイルが見つかりません', '<p class="muted">このファイルは存在しません。</p>', 404);
  if (expired(meta)) {
    await driveDelete(token, fileId);
    return htmlPage('期限切れ', '<p class="muted">このファイルは有効期限が切れて削除されました。</p>', 410);
  }
  const gate = pwGate(meta, url, rawId, false);
  if (gate) return gate;

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
  const token = await getAccessToken(env);
  const file = await driveMeta(token, fileId);
  if (!file) return json({ ok: false, gone: true }, 404, origin);
  const meta = file.appProperties || {};
  if (meta.app !== APP_TAG) return json({ ok: false, gone: true }, 404, origin);
  if (expired(meta)) return json({ ok: false, gone: true }, 410, origin);
  if (!meta.pw) return json({ ok: true }, 200, origin);
  const h = url.searchParams.get('h') || '';
  return json({ ok: h === meta.pw }, h === meta.pw ? 200 : 403, origin);
}

/* ---------- ダウンロード用ページ ---------- */

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
  const needsPw = !!meta.pw;
  const kind = previewKind(previewType(filename));

  const body = `
    <div class="card">
      <p class="eyebrow">Download — ダウンロード</p>
      <h1 class="fname">${esc(filename)}</h1>
      <p class="meta">${esc(humanSize(file.size))}　·　有効期限 ${esc(fmtDate(meta.expiresAt))} まで</p>
      ${needsPw
        ? `<label class="lb">合言葉</label>
           <input id="pw" type="password" autocomplete="off" placeholder="合言葉を入力">
           <button id="unlock" class="btn">開く</button>
           <p id="msg" class="msg"></p>`
        : ''}
      <div id="area" ${needsPw ? 'hidden' : ''}>
        ${kind ? '<div id="pv" class="pv"></div>' : '<p class="muted nopv">この種類のファイルは、そのまま表示できません。</p>'}
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
  const token = await getAccessToken(env);
  const files = await listByGroup(token, groupId);

  const now = Date.now();
  const alive = [];
  for (const f of files) {
    const m = f.appProperties || {};
    const exp = Number(m.expiresAt || 0);
    if (exp > 0 && now > exp) { await driveDelete(token, f.id); continue; }
    alive.push(f);
  }
  if (!alive.length) {
    return htmlPage('見つかりません', '<p class="muted">このファイルは存在しないか、期限切れで削除されました。</p>', 404);
  }
  alive.sort(function (a, b) {
    return (Number((a.appProperties || {}).idx) || 0) - (Number((b.appProperties || {}).idx) || 0);
  });

  const needsPw = !!(alive[0].appProperties || {}).pw;
  const exp = fmtDate((alive[0].appProperties || {}).expiresAt);
  const totalSize = alive.reduce(function (s, f) { return s + (Number(f.size) || 0); }, 0);

  const rows = alive.map(function (f) {
    const name = f.name || 'file';
    const kind = previewKind(previewType(name));
    return `<li class="row" data-id="${esc(encodeURIComponent(f.id))}" data-kind="${esc(kind || '')}" data-name="${esc(name)}">
        <div class="rtop">
          <div class="rinfo">
            <span class="rname">${esc(name)}</span>
            <span class="rsize">${esc(humanSize(f.size))}</span>
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
      <p class="meta">合計 ${esc(humanSize(totalSize))}　·　有効期限 ${esc(exp)} まで</p>
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

async function listByGroup(token, groupId) {
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
          box.appendChild(v);
        } else if (kind === 'audio') {
          var a = document.createElement('audio');
          a.src = src; a.controls = true; a.preload = 'metadata';
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
  const q = "appProperties has { key='app' and value='" + APP_TAG + "' } and trashed=false";
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

  const token = await getAccessToken(env);
  const base = new URL(request.url).origin;
  const now = Date.now();
  const items = [];
  let used = 0;

  await listOwnFiles(token, function (f) {
    const p = f.appProperties || {};
    const exp = Number(p.expiresAt || 0);
    const size = Number(f.size) || 0;
    const isExpired = exp > 0 && now > exp;
    if (!isExpired) used += size;
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
      group: p.grp || '',
      pageUrl: base + '/f/' + f.id,
      downloadUrl: base + '/dl/' + f.id,
      previewUrl: previewType(f.name) ? base + '/pv/' + f.id : '',
      groupUrl: p.grp ? base + '/g/' + p.grp : ''
    });
  }, 'name,createdTime');

  // 新しい順（作成日が取れないものは末尾）
  items.sort(function (a, b) { return String(b.createdTime).localeCompare(String(a.createdTime)); });

  return json({ files: items, used: used, usedText: humanSize(used), cap: TOTAL_CAP, capText: humanSize(TOTAL_CAP) }, 200, origin);
}

// ファイルを1つ消す
async function adminDelete(request, env, origin) {
  const gate = await requireOwner(request, env, origin);
  if (gate.err) return gate.err;

  const id = safeId(String((gate.body && gate.body.id) || ''));
  if (!id) return json({ message: '消すファイルが指定されていません' }, 400, origin);

  const token = await getAccessToken(env);
  // このアプリが作ったファイルかを必ず確かめてから消す
  const meta = await driveMeta(token, id);
  if (!meta || !meta.appProperties || meta.appProperties.app !== APP_TAG) {
    return json({ message: 'そのファイルは見つかりませんでした' }, 404, origin);
  }
  await driveDelete(token, id);
  return json({ ok: true }, 200, origin);
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
