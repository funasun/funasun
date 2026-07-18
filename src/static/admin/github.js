/* ============================================================
   admin/github.js — GitHub にファイルを読み書きする共通部品
   ------------------------------------------------------------
   編集ツール（index.html）から使う。data.json と images/ を
   読み書きするが、GitHub を直接叩くのではなく Cloudflare Worker
   （保存代行サーバー）経由で行う。
   ・利用者は GitHub トークンを一切持たない。
     代わりに「Googleログインの本人証明（IDトークン）」を Worker に送り、
     Worker 側が本人確認したうえで、秘密に持つトークンで保存を実行する。
   ・data 構造（{sha,text,b64} など）は以前と同じなので app.js は変更不要。
   ============================================================ */
(function (global) {
  'use strict';

  var OWNER = 'funasun';
  var REPO = 'funasun';
  var BRANCH = 'main';

  function workerUrl() { return (global.ADMIN_CONFIG && global.ADMIN_CONFIG.workerUrl) || ''; }

  // UTF-8 文字列 → base64（日本語を安全に）
  function utf8ToB64(str) { return btoa(unescape(encodeURIComponent(str))); }
  // base64 → UTF-8 文字列
  function b64ToUtf8(b64) { return decodeURIComponent(escape(atob((b64 || '').replace(/\n/g, '')))); }

  // Blob（画像など）→ base64（プレフィックスなし）
  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('画像の読み込みに失敗しました')); };
      r.readAsDataURL(blob);
    });
  }

  // 現在の Google ログインから本人証明（IDトークン）を取得
  function idToken() {
    if (!global.AdminAuth || !global.AdminAuth.getIdToken) {
      return Promise.reject(new Error('ログイン機能が初期化されていません'));
    }
    return global.AdminAuth.getIdToken();
  }

  // Worker 経由で GitHub API を呼ぶ
  function request(method, path, body) {
    var url = workerUrl();
    if (!url) return Promise.reject(new Error('保存サーバーのURLが未設定です（admin/config.js の workerUrl）'));
    return idToken().then(function (tok) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: tok, method: method, path: path, body: body || null })
      });
    }).then(function (res) {
      if (res.status === 401) throw new Error('ログインが無効です。ログインし直してください。');
      if (res.status === 403) throw new Error('このアカウントには編集権限がありません。');
      if (res.status === 404) { var e = new Error('見つかりません'); e.notFound = true; throw e; }
      if (res.status === 409) throw new Error('保存が競合しました。「再読み込み」してからやり直してください。');
      if (res.status === 422) throw new Error('内容が不正で保存できませんでした。');
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json && json.message) || ('エラー ' + res.status));
        return json;
      });
    });
  }

  // ログイン中の Google アカウント（メール）を返す
  function me() {
    var email = global.AdminAuth && global.AdminAuth.currentEmail && global.AdminAuth.currentEmail();
    return email ? Promise.resolve(email) : Promise.reject(new Error('未ログイン'));
  }

  // ファイルを取得 → { sha, text, b64 }。無ければ notFound=true の error。
  function getFile(repoPath) {
    var p = '/repos/' + OWNER + '/' + REPO + '/contents/' + encodePath(repoPath) + '?ref=' + BRANCH + '&_=' + Date.now();
    return request('GET', p).then(function (j) {
      return { sha: j.sha, b64: j.content || '', text: j.content ? b64ToUtf8(j.content) : '' };
    });
  }

  // テキスト（data.json など）を保存。sha を渡すと上書き、無ければ新規。
  function putText(repoPath, text, message, sha) {
    return putB64(repoPath, utf8ToB64(text), message, sha);
  }

  // base64 の中身をそのまま保存（画像用）
  function putB64(repoPath, b64, message, sha) {
    var body = { message: message, content: b64, branch: BRANCH };
    if (sha) body.sha = sha;
    return request('PUT', '/repos/' + OWNER + '/' + REPO + '/contents/' + encodePath(repoPath), body)
      .then(function (j) { return j.content ? j.content.sha : null; });
  }

  // ファイル削除
  function del(repoPath, message, sha) {
    var body = { message: message, sha: sha, branch: BRANCH };
    return request('DELETE', '/repos/' + OWNER + '/' + REPO + '/contents/' + encodePath(repoPath), body);
  }

  // パスの各セグメントをエンコード（/ は残す）
  function encodePath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
  }

  global.GH = {
    OWNER: OWNER, REPO: REPO, BRANCH: BRANCH,
    me: me, getFile: getFile, putText: putText, putB64: putB64, del: del,
    blobToB64: blobToB64
  };
})(window);
