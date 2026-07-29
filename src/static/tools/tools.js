/* ============================================================
   tools/tools.js — ファイルを加工する道具の中身
   ------------------------------------------------------------
   ・PDFをまとめる／ばらす、画像を webp にする、の3つ。
   ・すべて閲覧者のブラウザの中だけで処理する。ファイルはどこにも送らない
     （＝人の資料を預からないので、漏れようがない）。
   ・PDF の読み書きには pdf-lib を使う。ただし 500KB ほどあるので、
     PDF の道具を実際に使うまで読み込まない（ページを開いただけでは重くしない）。

   使う側からは window.FileTools として見える:
     FileTools.mergePdf(files, onProgress)        → Blob（1つのPDF）
     FileTools.splitPdf(file, spec, onProgress)   → [{name, blob}]
     FileTools.toWebp(file, opts)                 → {name, blob, before, after}
     FileTools.parsePages(spec, pageCount)        → [0始まりのページ番号]
     FileTools.pdfPageCount(file)                 → 数値
   ============================================================ */
(function (global) {
  'use strict';

  var PDFLIB_SRC = '/tools/pdf-lib.min.js';
  var libPromise = null;

  // pdf-lib を必要になったときだけ読み込む
  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFLIB_SRC;
      s.onload = function () {
        if (global.PDFLib) resolve(global.PDFLib);
        else reject(new Error('PDFの部品を読み込めませんでした'));
      };
      s.onerror = function () {
        libPromise = null;
        reject(new Error('PDFの部品を読み込めませんでした。通信環境を確かめて、ページを再読み込みしてください。'));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function readBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('ファイルを読み込めませんでした')); };
      r.readAsArrayBuffer(file);
    });
  }

  function isPdf(file) {
    return /pdf$/i.test(file.name || '') || /application\/pdf/i.test(file.type || '');
  }
  function isImage(file) {
    return /^image\//i.test(file.type || '') || /\.(png|jpe?g|gif|bmp|webp|avif|tiff?|heic|heif)$/i.test(file.name || '');
  }
  function baseName(name) {
    return String(name || 'file').replace(/\.[^.]+$/, '') || 'file';
  }

  /* PDF を1つ開く。壊れている・鍵がかかっている場合は日本語で理由を返す。 */
  function openPdf(PDFLib, buf, label) {
    return PDFLib.PDFDocument.load(buf, { ignoreEncryption: false }).catch(function (e) {
      var msg = String((e && e.message) || e);
      if (/encrypt/i.test(msg)) {
        throw new Error('「' + label + '」はパスワードで保護されています。保護を外してからお試しください。');
      }
      throw new Error('「' + label + '」を開けませんでした。PDFが壊れている可能性があります。');
    });
  }

  // ---- PDFをまとめる ----
  function mergePdf(files, onProgress) {
    if (!files || files.length < 2) return Promise.reject(new Error('まとめるには、PDFを2つ以上選んでください。'));
    var bad = files.filter(function (f) { return !isPdf(f); });
    if (bad.length) return Promise.reject(new Error('PDF以外が混ざっています：' + bad[0].name));

    return loadPdfLib().then(function (PDFLib) {
      return PDFLib.PDFDocument.create().then(function (out) {
        return files.reduce(function (chain, f, i) {
          return chain.then(function () {
            if (onProgress) onProgress(i, files.length, f.name);
            return readBuffer(f)
              .then(function (buf) { return openPdf(PDFLib, buf, f.name); })
              .then(function (src) {
                return out.copyPages(src, src.getPageIndices()).then(function (pages) {
                  pages.forEach(function (p) { out.addPage(p); });
                });
              });
          });
        }, Promise.resolve()).then(function () {
          if (onProgress) onProgress(files.length, files.length, '');
          return out.save().then(function (bytes) {
            return new Blob([bytes], { type: 'application/pdf' });
          });
        });
      });
    });
  }

  /* ページ指定を読み解く。"1-3,5,8-" のような書き方に対応。
     返すのは0始まりの番号の配列（重複は除き、書かれた順を保つ）。 */
  function parsePages(spec, count) {
    var text = String(spec || '').trim();
    if (!text) { // 空なら全ページ
      var all = [];
      for (var i = 0; i < count; i++) all.push(i);
      return all;
    }
    var out = [];
    var seen = {};
    text.split(/[,、\s]+/).forEach(function (part) {
      if (!part) return;
      var m = /^(\d+)?\s*[-–~ー]\s*(\d+)?$/.exec(part);
      if (m) {
        var from = m[1] ? parseInt(m[1], 10) : 1;
        var to = m[2] ? parseInt(m[2], 10) : count;
        if (from > to) { var t = from; from = to; to = t; }
        for (var n = from; n <= to; n++) push(n);
        return;
      }
      if (/^\d+$/.test(part)) { push(parseInt(part, 10)); return; }
      throw new Error('ページの指定が読み取れません：「' + part + '」（例：1-3,5）');
    });
    function push(n) {
      if (n < 1 || n > count) throw new Error(n + 'ページ目はありません（全' + count + 'ページ）');
      if (!seen[n]) { seen[n] = true; out.push(n - 1); }
    }
    if (!out.length) throw new Error('取り出すページがありません。');
    return out;
  }

  function pdfPageCount(file) {
    return loadPdfLib().then(function (PDFLib) {
      return readBuffer(file)
        .then(function (buf) { return openPdf(PDFLib, buf, file.name); })
        .then(function (doc) { return doc.getPageCount(); });
    });
  }

  /* PDF をばらす。
       spec.mode = 'each'    … 1ページずつ別々のPDFにする
       spec.mode = 'pick'    … spec.pages で指定したページだけを1つのPDFにする
       spec.mode = 'split'   … spec.pages で指定したページと、それ以外に分ける */
  function splitPdf(file, spec, onProgress) {
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    var mode = (spec && spec.mode) || 'each';

    return loadPdfLib().then(function (PDFLib) {
      return readBuffer(file)
        .then(function (buf) { return openPdf(PDFLib, buf, file.name); })
        .then(function (src) {
          var count = src.getPageCount();
          var base = baseName(file.name);
          var wanted = parsePages(spec && spec.pages, count);

          if (mode === 'each') {
            // 1ページずつ
            return wanted.reduce(function (chain, idx, i) {
              return chain.then(function (acc) {
                if (onProgress) onProgress(i, wanted.length, (idx + 1) + 'ページ目');
                return makeDoc(PDFLib, src, [idx]).then(function (blob) {
                  acc.push({ name: base + '_p' + pad(idx + 1, count) + '.pdf', blob: blob });
                  return acc;
                });
              });
            }, Promise.resolve([]));
          }

          if (mode === 'pick') {
            if (onProgress) onProgress(0, 1, '取り出し中');
            return makeDoc(PDFLib, src, wanted).then(function (blob) {
              return [{ name: base + '_抜き出し.pdf', blob: blob }];
            });
          }

          // split：指定したページと、残りの2つに分ける
          var rest = [];
          for (var i = 0; i < count; i++) if (wanted.indexOf(i) === -1) rest.push(i);
          if (!rest.length) throw new Error('全ページを指定しているので、分けられません。');
          return makeDoc(PDFLib, src, wanted).then(function (a) {
            return makeDoc(PDFLib, src, rest).then(function (b) {
              return [
                { name: base + '_指定したページ.pdf', blob: a },
                { name: base + '_残り.pdf', blob: b }
              ];
            });
          });
        });
    });

    function pad(n, total) {
      var w = String(total).length;
      var s = String(n);
      while (s.length < w) s = '0' + s;
      return s;
    }
  }

  function makeDoc(PDFLib, src, indices) {
    return PDFLib.PDFDocument.create().then(function (out) {
      return out.copyPages(src, indices).then(function (pages) {
        pages.forEach(function (p) { out.addPage(p); });
        return out.save().then(function (bytes) { return new Blob([bytes], { type: 'application/pdf' }); });
      });
    });
  }

  // ---- 画像を webp にする ----
  //   opts.maxEdge … 長辺の上限(px)。0 なら縮小しない
  //   opts.quality … 0〜1
  function toWebp(file, opts) {
    opts = opts || {};
    var maxEdge = Number(opts.maxEdge) || 0;
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.82;

    if (!isImage(file)) return Promise.reject(new Error('「' + file.name + '」は画像ではありません。'));

    return createBitmap(file).catch(function (e) {
      if (/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '')) {
        throw new Error('「' + file.name + '」は HEIC 形式です。iPhone の写真そのままの形式で、このブラウザでは開けません。写真アプリの「書き出す」で JPEG にしてからお試しください。');
      }
      throw new Error('「' + file.name + '」を画像として読み込めませんでした。');
    }).then(function (bitmap) {
      var w = bitmap.width, h = bitmap.height;
      if (maxEdge && Math.max(w, h) > maxEdge) {
        var scale = maxEdge / Math.max(w, h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('「' + file.name + '」は変換できませんでした。')); return; }
          resolve({
            name: baseName(file.name) + '.webp',
            blob: blob,
            before: file.size,
            after: blob.size,
            width: w, height: h
          });
        }, 'image/webp', quality);
      });
    });
  }

  function createBitmap(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImgElement(file); });
    }
    return viaImgElement(file);
  }
  function viaImgElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }

  // ---- 共通の小道具 ----
  function humanSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  // Blob をその場で保存させる
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Blob を File に変える（そのままアップロードに回せるように）
  function toFile(blob, name) {
    try { return new File([blob], name, { type: blob.type, lastModified: Date.now() }); }
    catch (e) { blob.name = name; return blob; }
  }

  global.FileTools = {
    mergePdf: mergePdf,
    splitPdf: splitPdf,
    pdfPageCount: pdfPageCount,
    parsePages: parsePages,
    toWebp: toWebp,
    isPdf: isPdf,
    isImage: isImage,
    humanSize: humanSize,
    download: download,
    toFile: toFile,
    baseName: baseName,
    loadPdfLib: loadPdfLib
  };
})(window);
