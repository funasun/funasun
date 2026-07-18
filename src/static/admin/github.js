/* ============================================================
   admin/github.js — GitHub にファイルを読み書きする共通部品
   ------------------------------------------------------------
   編集ツール（index.html）から使う。data.json と images/ を
   GitHub の REST API で直接読み書きする。
   ・カギ（トークン）は「このブラウザの中だけ」に保存（localStorage）。
     コードにも公開ページにも埋め込まない＝公開リポジトリでも安全。
   ・GitHub の API はブラウザから直接呼べる（CORS 対応済み）。
   ============================================================ */
(function (global) {
  'use strict';

  var OWNER = 'funasun';
  var REPO = 'funasun';
  var BRANCH = 'main';
  var API = 'https://api.github.com';
  var TOKEN_KEY = 'funasun_admin_gh_token';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, (t || '').trim()); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }
  function hasToken() { return !!getToken(); }
  function tokenTail() { var t = getToken(); return t ? '…' + t.slice(-4) : ''; }

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

  function request(method, path, body) {
    var token = getToken();
    if (!token) return Promise.reject(new Error('カギ（トークン）が設定されていません'));
    return fetch(API + path, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 401) throw new Error('カギが無効です（期限切れ・権限不足の可能性）。設定し直してください。');
      if (res.status === 404) { var e = new Error('見つかりません'); e.notFound = true; throw e; }
      if (res.status === 409) throw new Error('保存が競合しました。「再読み込み」してからやり直してください。');
      if (res.status === 422) throw new Error('内容が不正で保存できませんでした。');
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json && json.message) || ('エラー ' + res.status));
        return json;
      });
    });
  }

  // ログイン中の GitHub ユーザー名を返す（カギの検証にも使う）
  function me() {
    return request('GET', '/user').then(function (u) { return u.login; });
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
    getToken: getToken, setToken: setToken, clearToken: clearToken,
    hasToken: hasToken, tokenTail: tokenTail,
    me: me, getFile: getFile, putText: putText, putB64: putB64, del: del,
    blobToB64: blobToB64
  };
})(window);
