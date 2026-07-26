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
  function idToken(force) {
    if (!global.AdminAuth || !global.AdminAuth.getIdToken) {
      return Promise.reject(new Error('ログイン機能が初期化されていません'));
    }
    return global.AdminAuth.getIdToken(force);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* GitHub は同じブランチへ短い間に何度も書き込むと、混雑と見なして
     409（衝突）や 403（書き込みすぎ）を返す。写真を続けてアップすると
     ここに当たりやすい。人が押し直せば通る類の失敗なので、機械が待って
     やり直す。待ち時間はだんだん長くする（ミリ秒）。                  */
  var RETRY_WAIT = [900, 2200, 4500];

  // 「待てば直る」種類の失敗か。403 は権限ぎれと書き込みすぎの両方で来るので本文で見分ける
  function isBusy(status, msg) {
    if (status === 409 || status === 429 || status >= 500) return true;
    return status === 403 && /rate limit|secondary|abuse|retry|too quickly/i.test(msg);
  }

  // 利用者に見せる言葉に直す（GitHub の英語メッセージをそのまま出さない）
  function friendly(status, msg) {
    if (status === 403 && /rate limit|secondary|abuse|retry|too quickly/i.test(msg)) {
      return 'GitHub 側が「短時間に書き込みすぎ」と判断しました。1分ほど待ってから、もう一度お試しください。';
    }
    if (status === 403) return 'このアカウントには編集権限がありません。';
    if (status === 401) return 'ログインの期限が切れました。ページを再読み込みして、ログインし直してください。';
    if (status === 409) return '書き込みが重なりました。少し待ってから、もう一度お試しください。';
    if (status === 422) return '保存を受け付けてもらえませんでした' + (msg ? '（' + msg + '）' : '') + '。';
    if (status >= 500) return 'GitHub 側が一時的に不調のようです。少し待ってから、もう一度お試しください。';
    return msg || ('エラー ' + status);
  }

  // Worker 経由で GitHub API を呼ぶ。混雑による失敗は自動でやり直す。
  function request(method, path, body, attempt, refreshed) {
    attempt = attempt || 0;
    var url = workerUrl();
    if (!url) return Promise.reject(new Error('保存サーバーのURLが未設定です（admin/config.js の workerUrl）'));
    return idToken(!!refreshed).then(function (tok) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: tok, method: method, path: path, body: body || null })
      }).catch(function () {
        // 通信そのものが失敗＝回線が切れている等。これも待てば直ることがある
        var e = new Error('通信できませんでした。ネットワークを確認してください。');
        e.busy = true;
        throw e;
      });
    }).then(function (res) {
      // 先に本文を読む。GitHub が理由を書いてくれているので、それを捨てない
      return res.text().then(function (raw) {
        var json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) { /* JSON でなければ無視 */ }
        if (res.ok) return json;
        var msg = (json && json.message) || '';
        if (res.status === 404) { var e = new Error('見つかりません'); e.notFound = true; throw e; }
        // トークンの期限切れは、取り直せば通ることがあるので1回だけ試す
        if (res.status === 401 && !refreshed) return request(method, path, body, attempt, true);
        if (isBusy(res.status, msg) && attempt < RETRY_WAIT.length) {
          return sleep(RETRY_WAIT[attempt]).then(function () {
            return request(method, path, body, attempt + 1, refreshed);
          });
        }
        throw new Error(friendly(res.status, msg));
      });
    }).catch(function (e) {
      if (e && e.busy && attempt < RETRY_WAIT.length) {
        return sleep(RETRY_WAIT[attempt]).then(function () {
          return request(method, path, body, attempt + 1, refreshed);
        });
      }
      throw e;
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
