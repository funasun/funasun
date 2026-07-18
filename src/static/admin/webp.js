/* ============================================================
   admin/webp.js — 画像を webp に変換する部品
   ------------------------------------------------------------
   ・webp 以外の画像（jpg / png / heic など）を選んだら、ブラウザ内で
     webp に変換する。元ファイルはアップロードしない（＝元画像は残さない）。
   ・すでに webp のものはそのまま使う（無駄な再圧縮をしない）。
   ・大きすぎる画像は長辺を上限まで縮小してから変換（軽量化）。
   変換はすべてこのブラウザの中だけで完結する。
   ============================================================ */
(function (global) {
  'use strict';

  var MAX_EDGE = 1800;   // 長辺の上限（px）。これより大きい画像は縮小する
  var QUALITY = 0.82;    // webp の画質（0〜1）

  function isWebp(file) {
    return /image\/webp/i.test(file.type || '') || /\.webp$/i.test(file.name || '');
  }

  // ファイル名を安全なスラッグにする（英数字とハイフンのみ、拡張子は付けない）
  function slugifyBase(name) {
    var base = String(name || 'image').replace(/\.[^.]+$/, '');
    base = base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || 'image';
  }

  // File → { blob, ext, converted }
  //   converted=true なら webp に変換済み、false なら元が webp でそのまま
  function toWebp(file) {
    if (isWebp(file)) {
      return Promise.resolve({ blob: file, ext: 'webp', converted: false });
    }
    return createBitmap(file).then(function (bitmap) {
      var w = bitmap.width, h = bitmap.height;
      if (Math.max(w, h) > MAX_EDGE) {
        var scale = MAX_EDGE / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('この画像は変換できませんでした（対応していない形式かもしれません）')); return; }
          resolve({ blob: blob, ext: 'webp', converted: true });
        }, 'image/webp', QUALITY);
      });
    });
  }

  function createBitmap(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImgElement(file); });
    }
    return viaImgElement(file);
  }

  // createImageBitmap が使えない環境向けのフォールバック
  function viaImgElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }

  global.Webp = { toWebp: toWebp, slugifyBase: slugifyBase, isWebp: isWebp };
})(window);
