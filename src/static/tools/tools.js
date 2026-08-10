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

  /* ============================================================
     ここから下は、あとから足した道具
     ============================================================ */

  /* ---- pdf.js（PDFを絵として描く部品）----
     pdf-lib は PDF を「組み替える」ことはできるが「見た目を描く」ことはできない。
     ページの小さな見本（サムネイル）を出したり、PDF を画像にしたりするには
     描ける部品が要るので pdf.js を使う。こちらは 1.7MB ほどあるので、
     やはり必要になるまで読み込まない。 */
  var PDFJS_SRC = '/tools/pdf.min.mjs';
  var jsPromise = null;

  function loadPdfjs() {
    if (jsPromise) return jsPromise;
    jsPromise = import(PDFJS_SRC).then(function (mod) {
      var lib = mod.getDocument ? mod : (mod.default || mod);
      // 描画は別スレッド（ワーカー）にやらせる。こうしないと重いPDFで画面が固まる。
      lib.GlobalWorkerOptions.workerSrc = '/tools/pdf.worker.min.mjs';
      return lib;
    }).catch(function (e) {
      jsPromise = null;
      throw new Error('PDFを描く部品を読み込めませんでした。通信環境を確かめて、ページを再読み込みしてください。');
    });
    return jsPromise;
  }

  /* pdf.js で PDF を開く。
     cMapUrl / standardFontDataUrl を渡さないと、日本語のPDFが真っ白になる
     （日本語の字の対応表とフォントが別ファイルになっているため）。 */
  function openForRender(file) {
    return loadPdfjs().then(function (lib) {
      return readBuffer(file).then(function (buf) {
        return lib.getDocument({
          data: new Uint8Array(buf),
          cMapUrl: '/tools/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/tools/standard_fonts/'
        }).promise.catch(function (e) {
          var msg = String((e && e.message) || e);
          if (/password/i.test(msg)) {
            throw new Error('「' + (file.name || 'PDF') + '」はパスワードで保護されています。保護を外してからお試しください。');
          }
          throw new Error('「' + (file.name || 'PDF') + '」を開けませんでした。PDFが壊れている可能性があります。');
        });
      });
    });
  }

  /* ページを1枚ずつ描いて渡す。
       opts.scale   … 倍率（1 = 72dpi 相当）
       opts.maxEdge … 長辺の上限px（scale より優先。見本用）
       opts.pages   … 0始まりの番号の配列。省略で全ページ
       opts.type / opts.quality … 出力形式
     onPage(結果, i, 全体数) を1枚描くたびに呼ぶので、
     全部そろう前から画面に出せる（枚数が多いときに待たされた感じが減る）。 */
  function renderPages(file, opts, onPage) {
    opts = opts || {};
    var type = opts.type || 'image/png';
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.85;

    return openForRender(file).then(function (doc) {
      var list = opts.pages && opts.pages.length ? opts.pages.slice() : (function () {
        var a = []; for (var i = 0; i < doc.numPages; i++) a.push(i); return a;
      })();

      return list.reduce(function (chain, idx, i) {
        return chain.then(function (acc) {
          return doc.getPage(idx + 1).then(function (page) {
            // 1倍の大きさを見てから、望む大きさになる倍率を決める
            var base = page.getViewport({ scale: 1 });
            var scale = Number(opts.scale) || 1.5;
            if (opts.maxEdge) {
              scale = Number(opts.maxEdge) / Math.max(base.width, base.height);
            }
            var vp = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(vp.width));
            canvas.height = Math.max(1, Math.floor(vp.height));
            var cx = canvas.getContext('2d');
            // PDFに背景色の指定はない。白で塗らないと、JPEGにしたとき真っ黒になる。
            cx.fillStyle = '#ffffff';
            cx.fillRect(0, 0, canvas.width, canvas.height);
            return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
              return new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                  var r = {
                    index: idx,
                    page: idx + 1,
                    blob: blob,
                    width: canvas.width,
                    height: canvas.height,
                    /* 紙そのものの大きさ(pt)。回転を入れたあとの、見えている向きでの値。
                       ページ番号の見本が「何ptのところに置くか」を計算するのに要る。 */
                    ptWidth: base.width,
                    ptHeight: base.height,
                    url: URL.createObjectURL(blob)
                  };
                  acc.push(r);
                  if (onPage) onPage(r, i, list.length);
                  resolve(acc);
                }, type, quality);
              });
            });
          });
        });
      }, Promise.resolve([])).then(function (acc) {
        doc.destroy();
        return acc;
      });
    });
  }

  /* ---- PDF を画像にする ---- */
  function pdfToImages(file, opts, onProgress) {
    opts = opts || {};
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    var jpeg = opts.format === 'jpeg';
    var base = baseName(file.name);
    // 「dpi」で言われた方が分かりやすいので、内部で倍率に直す（PDFの1倍は72dpi）
    var scale = (Number(opts.dpi) || 144) / 72;

    return renderPages(file, {
      scale: scale,
      pages: opts.pages,
      type: jpeg ? 'image/jpeg' : 'image/png',
      quality: typeof opts.quality === 'number' ? opts.quality : 0.9
    }, function (r, i, n) {
      if (onProgress) onProgress(i, n, r.page + 'ページ目');
    }).then(function (pages) {
      var w = String(pages.length).length;
      return pages.map(function (r) {
        var num = String(r.page);
        while (num.length < w) num = '0' + num;
        return { name: base + '_p' + num + (jpeg ? '.jpg' : '.png'), blob: r.blob, width: r.width, height: r.height };
      });
    });
  }

  /* ---- ページを見本つきで整理する（並べ替え・回転・削除）----
     ops は [{src: 元の0始まりページ番号, rot: 0/90/180/270}, ...]。
     並んでいる順がそのまま新しいページの順になり、
     ops に入っていないページは消える。 */
  function organizePdf(file, ops) {
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    if (!ops || !ops.length) return Promise.reject(new Error('残すページが1つもありません。'));

    return loadPdfLib().then(function (PDFLib) {
      return readBuffer(file)
        .then(function (buf) { return openPdf(PDFLib, buf, file.name); })
        .then(function (src) {
          var count = src.getPageCount();
          var idx = ops.map(function (o) {
            var n = Number(o.src);
            if (!(n >= 0 && n < count)) throw new Error('ページの指定が正しくありません。');
            return n;
          });
          return PDFLib.PDFDocument.create().then(function (out) {
            return out.copyPages(src, idx).then(function (pages) {
              pages.forEach(function (p, i) {
                // 回転は「今の向きからの足し算」。元から横向きのPDFがあるので、
                // 決め打ちで 90 にすると元の向きを無視してしまう。
                var add = Number(ops[i].rot) || 0;
                if (add) {
                  var now = 0;
                  try { now = p.getRotation().angle || 0; } catch (e) { now = 0; }
                  p.setRotation(PDFLib.degrees(((now + add) % 360 + 360) % 360));
                }
                out.addPage(p);
              });
              return out.save().then(function (bytes) {
                return new Blob([bytes], { type: 'application/pdf' });
              });
            });
          });
        });
    });
  }

  /* ---- 画像をPDFにする ----
       opts.size   … 'fit'（画像と同じ大きさ）/ 'a4' / 'letter'
       opts.orient … 'auto' / 'portrait' / 'landscape'（size が fit 以外のとき）
       opts.margin … 余白(pt)
       opts.quality… 中に入れるJPEGの画質 */
  var PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], b5: [498.9, 708.66] };

  /* ---- 画像1枚を紙のどこに置くかを決める ----
     joinLayout と同じ考えで、本番とプレビューが同じ答えを使うために外に出してある。
     返す座標は PDF の単位(pt)。y は紙の下からの高さ（PDFの数え方）。 */
  function pageLayout(imgW, imgH, opts) {
    opts = opts || {};
    var size = opts.size || 'fit';
    var orient = opts.orient || 'auto';
    var margin = Math.max(0, Number(opts.margin) || 0);
    var pw, ph;
    if (size === 'fit') {
      pw = imgW + margin * 2;
      ph = imgH + margin * 2;
    } else {
      var base = PAGE_SIZES[size] || PAGE_SIZES.a4;
      var tall = orient === 'portrait' ? true
        : orient === 'landscape' ? false
        : imgH >= imgW;               // auto: 画像の形に合わせる
      pw = tall ? base[0] : base[1];
      ph = tall ? base[1] : base[0];
    }
    // 余白の内側に、縦横比を保ったまま目一杯入れて中央に置く
    var boxW = Math.max(1, pw - margin * 2);
    var boxH = Math.max(1, ph - margin * 2);
    var k = Math.min(boxW / imgW, boxH / imgH);
    var dw = imgW * k, dh = imgH * k;
    return { pw: pw, ph: ph, x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh, margin: margin };
  }

  function imagesToPdf(files, opts, onProgress) {
    opts = opts || {};
    if (!files || !files.length) return Promise.reject(new Error('画像を1つ以上選んでください。'));
    var bad = files.filter(function (f) { return !isImage(f); });
    if (bad.length) return Promise.reject(new Error('画像でないものが混ざっています：' + bad[0].name));

    var quality = typeof opts.quality === 'number' ? opts.quality : 0.9;

    return loadPdfLib().then(function (PDFLib) {
      return PDFLib.PDFDocument.create().then(function (out) {
        return files.reduce(function (chain, f, i) {
          return chain.then(function () {
            if (onProgress) onProgress(i, files.length, f.name);
            return toJpegBytes(f, quality).then(function (r) {
              return out.embedJpg(r.bytes).then(function (img) {
                var L = pageLayout(r.width, r.height, opts);
                var page = out.addPage([L.pw, L.ph]);
                page.drawImage(img, { x: L.x, y: L.y, width: L.w, height: L.h });
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

  /* 画像をJPEGのバイト列にそろえる。
     PNG の透明な部分は、白で塗ってから変換する（塗らないと黒くなる）。
     PDF には JPEG だけを入れる：形式をひとつに絞ると、
     どんな画像を選んでも同じ結果になり、ファイルも小さくなる。 */
  function toJpegBytes(file, quality) {
    return createBitmap(file).catch(function () {
      if (/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '')) {
        throw new Error('「' + file.name + '」は HEIC 形式です。写真アプリの「書き出す」で JPEG にしてからお試しください。');
      }
      throw new Error('「' + file.name + '」を画像として読み込めませんでした。');
    }).then(function (bitmap) {
      var w = bitmap.width, h = bitmap.height;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var cx = canvas.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, w, h);
      cx.drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('「' + file.name + '」を変換できませんでした。')); return; }
          readBuffer(blob).then(function (buf) {
            resolve({ bytes: new Uint8Array(buf), width: w, height: h });
          });
        }, 'image/jpeg', quality);
      });
    });
  }

  /* ---- 画像をつなげて1枚にする ----
       opts.dir   … 'v'（縦に積む）/ 'h'（横に並べる）
       opts.align … 'start' / 'center' / 'end' / 'fit'（幅または高さをそろえる）
       opts.gap   … すき間(px)
       opts.bg    … 背景色（'#ffffff' など。'transparent' で透明）
       opts.format… 'image/png' / 'image/jpeg' / 'image/webp' */
  /* ---- つないだときの配置を決める ----
     ここ1か所だけで計算して、本番の joinImages と、画面のプレビューの
     両方が同じ答えを使う。別々に計算すると、見えている絵と出来上がりが
     少しずつずれていき、あとで原因が分からなくなる。
     sizes は [{width, height}, ...]（画像そのものは要らない）。 */
  var MAX_CANVAS_PIXELS = 268435456;   // これを超えるとブラウザが描けない

  function joinLayout(sizes, opts) {
    opts = opts || {};
    var dir = opts.dir === 'h' ? 'h' : 'v';
    var align = opts.align || 'fit';
    var gap = Math.max(0, Number(opts.gap) || 0);

    // 'fit' は、縦につなぐなら幅を、横に並べるなら高さを、いちばん大きいものにそろえる
    var target = 0;
    sizes.forEach(function (s) {
      target = Math.max(target, dir === 'v' ? s.width : s.height);
    });
    var boxes = sizes.map(function (s) {
      if (align !== 'fit') return { w: s.width, h: s.height };
      var k = dir === 'v' ? target / s.width : target / s.height;
      return { w: Math.round(s.width * k), h: Math.round(s.height * k) };
    });

    var total = 0, cross = 0;
    boxes.forEach(function (bx) {
      total += (dir === 'v' ? bx.h : bx.w);
      cross = Math.max(cross, dir === 'v' ? bx.w : bx.h);
    });
    if (boxes.length) total += gap * (boxes.length - 1);

    var pos = 0;
    var placed = boxes.map(function (bx) {
      var off = align === 'center' ? Math.round((cross - (dir === 'v' ? bx.w : bx.h)) / 2)
        : align === 'end' ? (cross - (dir === 'v' ? bx.w : bx.h))
        : 0;
      var r = dir === 'v' ? { x: off, y: pos, w: bx.w, h: bx.h }
        : { x: pos, y: off, w: bx.w, h: bx.h };
      pos += (dir === 'v' ? bx.h : bx.w) + gap;
      return r;
    });

    var W = dir === 'v' ? cross : total;
    var H = dir === 'v' ? total : cross;
    return {
      boxes: placed, width: W, height: H, dir: dir,
      tooBig: W * H > MAX_CANVAS_PIXELS
    };
  }

  function joinImages(files, opts, onProgress) {
    opts = opts || {};
    if (!files || files.length < 2) return Promise.reject(new Error('つなげるには、画像を2つ以上選んでください。'));
    var bad = files.filter(function (f) { return !isImage(f); });
    if (bad.length) return Promise.reject(new Error('画像でないものが混ざっています：' + bad[0].name));

    var bg = opts.bg || '#ffffff';
    var format = opts.format || 'image/png';
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.9;

    return files.reduce(function (chain, f, i) {
      return chain.then(function (acc) {
        if (onProgress) onProgress(i, files.length, f.name);
        return createBitmap(f).catch(function () {
          throw new Error('「' + f.name + '」を画像として読み込めませんでした。');
        }).then(function (b) { acc.push(b); return acc; });
      });
    }, Promise.resolve([])).then(function (bitmaps) {
      var lay = joinLayout(bitmaps, opts);
      var W = lay.width, H = lay.height;
      // ブラウザが扱える大きさには限りがある。超えるなら、はっきり伝えて止める。
      if (lay.tooBig) {
        throw new Error('つないだ画像が大きすぎます（' + W + '×' + H + 'px）。枚数を減らすか、先に「画像を軽くする」で小さくしてからお試しください。');
      }

      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var cx = canvas.getContext('2d');
      if (bg !== 'transparent') { cx.fillStyle = bg; cx.fillRect(0, 0, W, H); }

      bitmaps.forEach(function (b, i) {
        var bx = lay.boxes[i];
        cx.drawImage(b, bx.x, bx.y, bx.w, bx.h);
        if (b.close) b.close();
      });

      // 透明を残したいのに JPEG だと白くなってしまうので、その組み合わせは PNG に直す
      var fmt = (bg === 'transparent' && format === 'image/jpeg') ? 'image/png' : format;
      var ext = fmt === 'image/jpeg' ? '.jpg' : fmt === 'image/webp' ? '.webp' : '.png';

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('画像をつなげられませんでした。')); return; }
          resolve({
            name: baseName(files[0].name) + '_つなげた' + ext,
            blob: blob, width: W, height: H,
            before: files.reduce(function (s, f) { return s + f.size; }, 0),
            after: blob.size
          });
        }, fmt, quality);
      });
    });
  }

  /* ---- ページ番号をつける ----
       opts.pos    … 'bc'(下中央) 'br' 'bl' 'tc' 'tr' 'tl'
       opts.start  … 最初のページに振る番号
       opts.from   … 何ページ目から入れるか（1始まり）
       opts.style  … '1' / '1 / 10' / '- 1 -'
       opts.size   … 文字の大きさ(pt) */
  /* ---- 番号の「文字」と「置き場所」を決める ----
     ここも本番とプレビューで共有する。プレビューだけ別に計算すると、
     置き場所や書き方がずれて、確認の意味がなくなる。 */
  function numberOpts(opts) {
    opts = opts || {};
    var start = Number(opts.start); if (!isFinite(start)) start = 1;
    return {
      pos: opts.pos || 'bc',
      start: start,
      from: Math.max(1, Number(opts.from) || 1),
      style: opts.style || '1',
      size: Math.max(6, Math.min(48, Number(opts.size) || 11)),
      margin: Math.max(0, Number(opts.margin) || 24)
    };
  }
  // i は0始まりのページ番号、count はPDFの総ページ数
  function numberTextFor(i, count, o) {
    if (i + 1 < o.from) return null;              // ここより前には付けない
    var total = count - (o.from - 1);
    var n = o.start + (i - (o.from - 1));
    return o.style === '1 / 10' ? (n + ' / ' + (o.start + total - 1))
      : o.style === '- 1 -' ? ('- ' + n + ' -')
      : String(n);
  }
  /* 見えている紙（回転を考えたあと）の中での置き場所。
     vw,vh は見えている紙の幅と高さ、tw は文字の横幅。
     y は下からの高さ（PDFの数え方）。 */
  function numberSpot(vw, vh, tw, o) {
    var side = o.pos.charAt(1);
    return {
      x: side === 'l' ? o.margin : side === 'r' ? (vw - o.margin - tw) : (vw - tw) / 2,
      y: o.pos.charAt(0) === 't' ? (vh - o.margin - o.size) : o.margin
    };
  }

  function addPageNumbers(file, opts) {
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    var o = numberOpts(opts);

    return loadPdfLib().then(function (PDFLib) {
      return readBuffer(file)
        .then(function (buf) { return openPdf(PDFLib, buf, file.name); })
        .then(function (doc) {
          return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (font) {
            var pages = doc.getPages();
            pages.forEach(function (page, i) {
              var text = numberTextFor(i, pages.length, o);
              if (text === null) return;

              // ページの向きを見て、見える通りの「下」「右」に置く
              var r = 0;
              try { r = ((page.getRotation().angle || 0) % 360 + 360) % 360; } catch (e) { r = 0; }
              var pw = page.getWidth(), ph = page.getHeight();
              var vw = (r === 90 || r === 270) ? ph : pw;   // 見えている幅
              var vh = (r === 90 || r === 270) ? pw : ph;   // 見えている高さ

              var tw = font.widthOfTextAtSize(text, o.size);
              var spot = numberSpot(vw, vh, tw, o);

              // 見えている位置を、回転前の紙の座標に戻す
              var p = unrotate(spot.x, spot.y, r, pw, ph);
              page.drawText(text, {
                x: p.x, y: p.y, size: o.size, font: font,
                rotate: PDFLib.degrees(r),
                color: PDFLib.rgb(0.25, 0.25, 0.28)
              });
            });
            return doc.save().then(function (bytes) {
              return new Blob([bytes], { type: 'application/pdf' });
            });
          });
        });
    });
  }

  /* 「見た目の座標」→「紙そのものの座標」。ページが回転していると
     この2つがずれるので、戻してから置かないと番号が紙の外に出てしまう。 */
  function unrotate(vx, vy, r, pw, ph) {
    if (r === 90) return { x: pw - vy, y: vx };
    if (r === 180) return { x: pw - vx, y: ph - vy };
    if (r === 270) return { x: vy, y: ph - vx };
    return { x: vx, y: vy };
  }

  /* ---- 複数のファイルを1つの zip にまとめる ----
     PDF も JPEG も、もともと圧縮済みで、これ以上縮めても意味がない。
     なので「圧縮しない zip（格納のみ）」で作る。こうすると
     外の部品を足さずに、この数十行だけで済む。 */
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }

  function zipBlobs(items) {
    if (!items || !items.length) return Promise.reject(new Error('まとめるファイルがありません。'));
    var enc = new TextEncoder();
    var used = {};

    return items.reduce(function (chain, it, i) {
      return chain.then(function (acc) {
        return readBuffer(it.blob).then(function (buf) {
          // 同じ名前が2つあると、開いたときに片方しか出てこない
          var name = String(it.name || ('file' + (i + 1)));
          if (used[name]) {
            var n = 2;
            var stem = name.replace(/\.[^.]+$/, '');
            var ext = name.slice(stem.length);
            while (used[stem + '(' + n + ')' + ext]) n++;
            name = stem + '(' + n + ')' + ext;
          }
          used[name] = true;
          acc.push({ name: enc.encode(name), data: new Uint8Array(buf) });
          return acc;
        });
      });
    }, Promise.resolve([])).then(function (entries) {
      var parts = [];
      var central = [];
      var offset = 0;

      entries.forEach(function (e) {
        var crc = crc32(e.data);
        var lh = new Uint8Array(30 + e.name.length);
        var v = new DataView(lh.buffer);
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 0x0800, true);   // 名前は UTF-8（日本語のファイル名が化けないように）
        v.setUint16(8, 0, true);        // 圧縮しない
        v.setUint16(10, 0, true); v.setUint16(12, 0x2821, true);  // 日時（固定）
        v.setUint32(14, crc, true);
        v.setUint32(18, e.data.length, true);
        v.setUint32(22, e.data.length, true);
        v.setUint16(26, e.name.length, true);
        v.setUint16(28, 0, true);
        lh.set(e.name, 30);
        parts.push(lh, e.data);

        var ch = new Uint8Array(46 + e.name.length);
        var cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true); cv.setUint16(14, 0x2821, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, e.data.length, true);
        cv.setUint32(24, e.data.length, true);
        cv.setUint16(28, e.name.length, true);
        cv.setUint32(42, offset, true);
        ch.set(e.name, 46);
        central.push(ch);

        offset += lh.length + e.data.length;
      });

      var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0);
      var end = new Uint8Array(22);
      var ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(8, entries.length, true);
      ev.setUint16(10, entries.length, true);
      ev.setUint32(12, cdSize, true);
      ev.setUint32(16, offset, true);

      return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
    });
  }

  /* ---- 共有URLからファイルを取ってくる ----
     このサイトで共有しているファイルのURLだけを受け付ける。
     よそのURLも取れるようにすると「他人のサーバーを踏み台にする道具」に
     なってしまうし、そもそも普通のサイトは外からの読み取りを許していない。 */
  var SHARE_HOST = 'funasun-files.takakouseitokai.workers.dev';

  function shareUrlToDownload(input) {
    var raw = String(input || '').trim();
    if (!raw) throw new Error('URLを入れてください。');
    var u;
    try { u = new URL(raw); } catch (e) { throw new Error('URLの形になっていません：' + raw); }
    if (u.protocol !== 'https:') throw new Error('https で始まるURLを入れてください。');
    if (u.hostname !== SHARE_HOST) {
      throw new Error('このサイトで共有したファイルのURLだけ使えます（よそのURLは、その相手先が読み取りを許していないため取り込めません）。ダウンロードしてから選んでください。');
    }
    var m = /^\/(f|dl|pv)\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    if (!m) {
      if (/^\/g\//.test(u.pathname)) throw new Error('まとめて共有したURLです。そのページを開いて、ファイルを1つずつのURLで入れてください。');
      throw new Error('共有ファイルのURLではないようです：' + raw);
    }
    return 'https://' + SHARE_HOST + '/dl/' + m[2] + (u.search || '');
  }

  function fetchShared(input, onProgress) {
    var url;
    try { url = shareUrlToDownload(input); } catch (e) { return Promise.reject(e); }
    if (onProgress) onProgress(url);

    return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
      if (res.status === 403) throw new Error('このファイルには合言葉がかかっています。一度ダウンロードしてから選んでください。');
      if (res.status === 404) throw new Error('見つかりませんでした。URLが間違っているか、すでに消されています。');
      if (res.status === 410) throw new Error('このファイルは有効期限が切れています。');
      if (!res.ok) throw new Error('取り込めませんでした（' + res.status + '）。しばらく待ってからお試しください。');
      var name = nameFromHeaders(res.headers) || 'file';
      return res.blob().then(function (blob) { return toFile(blob, name); });
    }, function () {
      throw new Error('取り込めませんでした。通信環境を確かめてください。');
    });
  }

  // Content-Disposition から元のファイル名を取り出す
  function nameFromHeaders(headers) {
    var cd = headers.get('Content-Disposition') || '';
    var m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    m = /filename="?([^";]+)"?/i.exec(cd);
    return m ? m[1] : '';
  }

  /* ---- PDFを軽くする（圧縮） ----
     各ページを画像として描き直し、その画像だけのPDFに作り替える。
     文字は画像になる（選べなくなる）が、写真の多い資料はよく縮む。
       opts.dpi     … ページの解像度（大きいほどきれい・重い）
       opts.quality … JPEGの画質（0〜1）
     元より大きくなってしまったら、元をそのまま返す（軽くする道具なので）。 */
  function compressPdf(file, opts, onProgress) {
    opts = opts || {};
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    var scale = (Number(opts.dpi) || 120) / 72;
    var quality = typeof opts.quality === 'number' ? opts.quality : 0.72;

    return Promise.all([loadPdfLib(), openForRender(file)]).then(function (r) {
      var PDFLib = r[0], doc = r[1];
      return PDFLib.PDFDocument.create().then(function (out) {
        var n = doc.numPages;
        return (function loop(i) {
          if (i >= n) return Promise.resolve();
          if (onProgress) onProgress(i, n);
          return doc.getPage(i + 1).then(function (page) {
            var base = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: scale });
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(vp.width));
            canvas.height = Math.max(1, Math.floor(vp.height));
            var cx = canvas.getContext('2d');
            cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, canvas.width, canvas.height);
            return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
              return new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', quality); });
            }).then(function (blob) {
              return readBuffer(blob).then(function (buf) {
                return out.embedJpg(new Uint8Array(buf)).then(function (img) {
                  // 紙の大きさ(pt)は元のページと同じにする＝見た目の寸法が変わらない
                  var pg = out.addPage([base.width, base.height]);
                  pg.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
                });
              });
            });
          }).then(function () { return loop(i + 1); });
        })(0).then(function () {
          if (onProgress) onProgress(n, n);
          doc.destroy();
          return out.save().then(function (bytes) {
            return { blob: new Blob([bytes], { type: 'application/pdf' }), newSize: bytes.length };
          });
        });
      });
    }).then(function (made) {
      // 軽くならなかった（もともと文字だけ等）なら、元をそのまま返して知らせる
      return readBuffer(file).then(function (orig) {
        if (made.newSize >= orig.byteLength) {
          return { blob: new Blob([orig], { type: 'application/pdf' }), origSize: orig.byteLength, newSize: orig.byteLength, notShrunk: true };
        }
        return { blob: made.blob, origSize: orig.byteLength, newSize: made.newSize, notShrunk: false };
      });
    });
  }

  /* ---- 余白を切る（トリミング） ----
     margins: { t,b,l,r } は 0〜1 の割合（そのページの高さ・幅に対して）。
     PDF の CropBox を動かすだけ＝中身は描き直さないので、文字も画質もそのまま。
       perPage: { ページ番号(0始まり): {t,b,l,r} } を渡すと、そのページだけ別の切り方。 */
  function cropPdf(file, opts) {
    opts = opts || {};
    var m = opts.margins || { t: 0, b: 0, l: 0, r: 0 };
    var perPage = opts.perPage || null;
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));

    return Promise.all([loadPdfLib(), readBuffer(file)]).then(function (r) {
      var PDFLib = r[0];
      return PDFLib.PDFDocument.load(r[1]).then(function (pdf) {
        var pages = pdf.getPages();
        pages.forEach(function (page, i) {
          var mg = (perPage && perPage[i]) || m;
          // いまの「見えている枠」（CropBox が無ければ MediaBox）を基準に切る
          var box = page.getCropBox();
          var x = box.x, y = box.y, w = box.width, h = box.height;
          var nx = x + w * (mg.l || 0);
          var ny = y + h * (mg.b || 0);
          var nw = w * (1 - (mg.l || 0) - (mg.r || 0));
          var nh = h * (1 - (mg.t || 0) - (mg.b || 0));
          if (nw > 1 && nh > 1) page.setCropBox(nx, ny, nw, nh);
        });
        return pdf.save().then(function (bytes) {
          return new Blob([bytes], { type: 'application/pdf' });
        });
      });
    });
  }

  /* 白い余白を自動で見つける。ページを一度描いて、外側から
     「ほぼ白い行・列」がどこまで続くかを数える。返り値は割合 {t,b,l,r}。 */
  function detectMargins(file, pageIndex) {
    return renderPages(file, { maxEdge: 700, pages: [pageIndex || 0], type: 'image/png' }, null)
      .then(function (rs) {
        var r = rs[0];
        var cv = document.createElement('canvas');
        cv.width = r.width; cv.height = r.height;
        var cx = cv.getContext('2d');
        return new Promise(function (res) {
          var img = new Image();
          img.onload = function () {
            cx.drawImage(img, 0, 0);
            var d = cx.getImageData(0, 0, cv.width, cv.height).data;
            var W = cv.width, H = cv.height;
            var THRESH = 244;   // これより明るければ「白」とみなす
            function rowWhite(yy) {
              for (var xx = 0; xx < W; xx++) {
                var o = (yy * W + xx) * 4;
                if (d[o] < THRESH || d[o + 1] < THRESH || d[o + 2] < THRESH) return false;
              }
              return true;
            }
            function colWhite(xx) {
              for (var yy = 0; yy < H; yy++) {
                var o = (yy * W + xx) * 4;
                if (d[o] < THRESH || d[o + 1] < THRESH || d[o + 2] < THRESH) return false;
              }
              return true;
            }
            var top = 0; while (top < H && rowWhite(top)) top++;
            var bot = 0; while (bot < H && rowWhite(H - 1 - bot)) bot++;
            var left = 0; while (left < W && colWhite(left)) left++;
            var right = 0; while (right < W && colWhite(W - 1 - right)) right++;
            // 少しだけ余白を残す（詰めすぎると窮屈）。画像上の座標→割合へ
            var pad = 0.01;
            res({
              t: Math.max(0, top / H - pad), b: Math.max(0, bot / H - pad),
              l: Math.max(0, left / W - pad), r: Math.max(0, right / W - pad)
            });
          };
          img.onerror = function () { res({ t: 0, b: 0, l: 0, r: 0 }); };
          img.src = r.url;
        });
      });
  }

  /* ---- ページを抜き出す ----
     0始まりの番号配列 indices の順に、そのページだけの新しいPDFを作る。
     makeDoc が並べ替え・複製にも対応しているので、それをそのまま使う。 */
  function extractPdf(file, indices) {
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    if (!indices || !indices.length) return Promise.reject(new Error('抜き出すページを選んでください。'));
    return Promise.all([loadPdfLib(), readBuffer(file)]).then(function (r) {
      return openPdf(r[0], r[1], file.name).then(function (src) {
        // makeDoc は copyPages→addPage→save まで一括で Blob を返す
        return makeDoc(r[0], src, indices);
      });
    });
  }

  /* ---- 書き込み（署名・文字・線・枠）を焼き込む ----
     items: そのページに置くものの配列。座標は「割合(0〜1)」で持つ。
       画面プレビューの canvas と PDF の紙で寸法が違っても、割合なら一致する。
       共通: { page(0始まり), type }
       image … { x,y,w,h, dataUrl }         手書き署名・文字画像・図形の画像
       line  … { x1,y1,x2,y2, color, width } 直線・矢印の軸
       rect  … { x,y,w,h, color, width, fill } 枠
     日本語の文字はフォントを積まずに済むよう、呼ぶ側で画像(dataUrl)にしてから image で渡す。 */
  function annotatePdf(file, itemsByPage) {
    if (!isPdf(file)) return Promise.reject(new Error('PDFを選んでください。'));
    return Promise.all([loadPdfLib(), readBuffer(file)]).then(function (r) {
      var PDFLib = r[0];
      return PDFLib.PDFDocument.load(r[1]).then(function (pdf) {
        var pages = pdf.getPages();
        // まず使う画像を全部埋め込む（同じ画像は1回だけ）
        var cache = {};
        var embeds = [];
        Object.keys(itemsByPage).forEach(function (pi) {
          itemsByPage[pi].forEach(function (it) {
            if (it.type === 'image' && it.dataUrl && !(it.dataUrl in cache)) {
              cache[it.dataUrl] = true;
              embeds.push(dataUrlToBytes(it.dataUrl).then(function (b) {
                var isPng = /^data:image\/png/i.test(it.dataUrl);
                return (isPng ? pdf.embedPng(b.bytes) : pdf.embedJpg(b.bytes)).then(function (img) {
                  cache[it.dataUrl] = img;
                });
              }));
            }
          });
        });
        return Promise.all(embeds).then(function () {
          Object.keys(itemsByPage).forEach(function (pi) {
            var page = pages[Number(pi)];
            if (!page) return;
            var box = page.getCropBox();
            var W = box.width, H = box.height, X0 = box.x, Y0 = box.y;
            // 画面は「左上が原点・下向き」、PDFは「左下が原点・上向き」。yを反転する
            function px(fx) { return X0 + fx * W; }
            function py(fy) { return Y0 + (1 - fy) * H; }
            itemsByPage[pi].forEach(function (it) {
              if (it.type === 'image') {
                var img = cache[it.dataUrl];
                if (!img || !img.width) return;
                page.drawImage(img, { x: px(it.x), y: py(it.y + it.h), width: it.w * W, height: it.h * H });
              } else if (it.type === 'line') {
                var c = hexRgb(PDFLib, it.color || '#e23b3b');
                page.drawLine({
                  start: { x: px(it.x1), y: py(it.y1) }, end: { x: px(it.x2), y: py(it.y2) },
                  thickness: (it.width || 2), color: c
                });
              } else if (it.type === 'rect') {
                var c2 = hexRgb(PDFLib, it.color || '#e23b3b');
                var o = { x: px(it.x), y: py(it.y + it.h), width: it.w * W, height: it.h * H,
                  borderColor: c2, borderWidth: (it.width || 2) };
                if (it.fill) o.color = c2;
                page.drawRectangle(o);
              }
            });
          });
          return pdf.save().then(function (bytes) {
            return new Blob([bytes], { type: 'application/pdf' });
          });
        });
      });
    });
  }

  function dataUrlToBytes(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return { bytes: new Uint8Array(b) }; });
  }
  function hexRgb(PDFLib, hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return PDFLib.rgb(0.89, 0.23, 0.23);
    return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
  }

  /* 文字を画像にする（日本語フォントを積まないため）。透明背景のPNGを返す。
     戻り値 { dataUrl, w, h }（w,hは px）。呼ぶ側は紙に対する割合に直して置く。 */
  function textToImage(text, opts) {
    opts = opts || {};
    var size = Number(opts.size) || 48;
    var color = opts.color || '#111111';
    var font = size + "px 'Noto Sans JP', 'Hiragino Sans', sans-serif";
    var pad = Math.round(size * 0.25);
    var cv = document.createElement('canvas');
    var mcx = cv.getContext('2d');
    mcx.font = font;
    var lines = String(text).split('\n');
    var wMax = 1;
    lines.forEach(function (ln) { wMax = Math.max(wMax, mcx.measureText(ln).width); });
    var lineH = Math.round(size * 1.3);
    cv.width = Math.ceil(wMax) + pad * 2;
    cv.height = lineH * lines.length + pad * 2;
    var cx = cv.getContext('2d');
    cx.font = font;
    cx.textBaseline = 'top';
    cx.fillStyle = color;
    lines.forEach(function (ln, i) { cx.fillText(ln, pad, pad + i * lineH); });
    return { dataUrl: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
  }

  global.FileTools = {
    mergePdf: mergePdf,
    annotatePdf: annotatePdf,
    textToImage: textToImage,
    compressPdf: compressPdf,
    cropPdf: cropPdf,
    detectMargins: detectMargins,
    extractPdf: extractPdf,
    splitPdf: splitPdf,
    organizePdf: organizePdf,
    addPageNumbers: addPageNumbers,
    pdfToImages: pdfToImages,
    imagesToPdf: imagesToPdf,
    joinImages: joinImages,
    // 配置の計算だけを取り出したもの。画面のプレビューがこれを使うので、
    // 見えている絵と出来上がりが必ず一致する。
    joinLayout: joinLayout,
    pageLayout: pageLayout,
    numberOpts: numberOpts,
    numberTextFor: numberTextFor,
    numberSpot: numberSpot,
    createBitmap: createBitmap,
    renderPages: renderPages,
    pdfPageCount: pdfPageCount,
    parsePages: parsePages,
    toWebp: toWebp,
    zipBlobs: zipBlobs,
    fetchShared: fetchShared,
    shareUrlToDownload: shareUrlToDownload,
    isPdf: isPdf,
    isImage: isImage,
    humanSize: humanSize,
    download: download,
    toFile: toFile,
    baseName: baseName,
    loadPdfLib: loadPdfLib,
    loadPdfjs: loadPdfjs
  };
})(window);
