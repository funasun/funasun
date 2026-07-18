/* ============================================================
   admin-worker/worker.js — 保存を代行する Cloudflare Worker
   ------------------------------------------------------------
   /admin の編集ツールから呼ばれる小さなサーバー。役割は3つ：
     1) 送られてきた「本人証明（Firebase の IDトークン）」を確認する
     2) 本人（船越さんの Google アカウント）だけを許可する
     3) OK なら、この Worker が秘密に持つ GitHub トークンで
        funasun/funasun のファイルを読み書きする

   ・GitHub トークンは Cloud だけに保存（環境変数 GH_TOKEN のシークレット）。
     ブラウザにも公開リポジトリにも出さない＝利用者はトークンを触らない。
   ・Firebase の apiKey / プロジェクトIDは公開情報なのでここに直書きでOK。
   ============================================================ */

const OWNER_EMAIL = 'tsutsumufunakoshi@gmail.com';      // これ以外は拒否
const FIREBASE_API_KEY = 'AIzaSyCbi7N4rV7L04rusvzVHQ2SjPoKdqaNg2k';
const GH_API = 'https://api.github.com';
// 触ってよいのは funasun/funasun の src/ 配下のみ
const ALLOW_PREFIX = '/repos/funasun/funasun/contents/src/';
const ALLOW_ORIGINS = [
  'https://tsutsumufunakoshi.com',
  'https://www.tsutsumufunakoshi.com'
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ message: 'POST only' }, 405, origin);
    }

    let payload;
    try { payload = await request.json(); }
    catch (e) { return json({ message: 'リクエストが不正です' }, 400, origin); }

    const idToken = payload && payload.idToken;
    const method = payload && payload.method;
    const path = payload && payload.path;
    const body = payload && payload.body;

    if (!idToken) return json({ message: 'ログインが必要です' }, 401, origin);

    // --- 1) 本人証明（Firebase IDトークン）を確認 ---
    let email, verified;
    try {
      const r = await fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken })
        }
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

    // --- 2) 本人だけ許可 ---
    if (email !== OWNER_EMAIL || !verified) {
      return json({ message: 'このアカウントには編集権限がありません。' }, 403, origin);
    }

    // --- 3) 対象を検証して GitHub へ中継 ---
    if (['GET', 'PUT', 'DELETE'].indexOf(method) === -1) {
      return json({ message: '許可されていない操作です' }, 400, origin);
    }
    if (typeof path !== 'string' || path.indexOf(ALLOW_PREFIX) !== 0) {
      return json({ message: '許可されていない場所です' }, 400, origin);
    }
    if (!env.GH_TOKEN) {
      return json({ message: 'サーバーに GitHub トークンが設定されていません（GH_TOKEN）' }, 500, origin);
    }

    let ghRes, text;
    try {
      ghRes = await fetch(GH_API + path, {
        method: method,
        headers: {
          'Authorization': 'Bearer ' + env.GH_TOKEN,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'funasun-admin-worker',
          'Content-Type': 'application/json'
        },
        body: method === 'GET' ? undefined : JSON.stringify(body || {})
      });
      text = await ghRes.text();
    } catch (e) {
      return json({ message: 'GitHub への接続に失敗しました' }, 502, origin);
    }

    // GitHub の応答（ステータス・本文）をそのまま返す
    return new Response(text, {
      status: ghRes.status,
      headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(origin))
    });
  }
};
