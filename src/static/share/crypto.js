/* ============================================================
   share/crypto.js — 合言葉でリンク集を暗号化／復号する共通部品
   ------------------------------------------------------------
   ブラウザ標準の Web Crypto API だけを使う（外部ライブラリ不要）。
   ・鍵の作り方: PBKDF2（合言葉＋ランダムな塩、20万回）→ AES-GCM 256bit
   ・暗号文の中身: { 塩, 初期ベクトル, 暗号本体 } を JSON にして base64
   viewer（index.html）と編集ツール（edit.html）の両方が読み込む。
   ============================================================ */
(function (global) {
  'use strict';

  var PBKDF2_ITERATIONS = 200000;

  function bytesToB64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function deriveKey(password, salt, iterations) {
    var enc = new TextEncoder();
    return crypto.subtle
      .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (material) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  // 任意のオブジェクト → 貼り付け用の暗号文字列（base64）
  function encryptToBlob(obj, password) {
    var enc = new TextEncoder();
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, PBKDF2_ITERATIONS).then(function (key) {
      return crypto.subtle
        .encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(obj)))
        .then(function (ct) {
          var pkg = {
            v: 1,
            it: PBKDF2_ITERATIONS,
            salt: bytesToB64(salt),
            iv: bytesToB64(iv),
            ct: bytesToB64(ct)
          };
          return btoa(unescape(encodeURIComponent(JSON.stringify(pkg))));
        });
    });
  }

  // 暗号文字列 ＋ 合言葉 → 元のオブジェクト（失敗時は reject）
  function decryptBlob(blobStr, password) {
    var pkg;
    try {
      pkg = JSON.parse(decodeURIComponent(escape(atob(blobStr.trim()))));
    } catch (e) {
      return Promise.reject(new Error('データの形式が不正です'));
    }
    var salt = b64ToBytes(pkg.salt);
    var iv = b64ToBytes(pkg.iv);
    var ct = b64ToBytes(pkg.ct);
    return deriveKey(password, salt, pkg.it || PBKDF2_ITERATIONS).then(function (key) {
      return crypto.subtle
        .decrypt({ name: 'AES-GCM', iv: iv }, key, ct)
        .then(function (pt) {
          return JSON.parse(new TextDecoder().decode(pt));
        });
    });
  }

  global.ShareCrypto = {
    encryptToBlob: encryptToBlob,
    decryptBlob: decryptBlob
  };
})(window);
