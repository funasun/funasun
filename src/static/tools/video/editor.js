/* ============================================================
   editor.js — 動画編集（切る・つなぐ）の画面
   ------------------------------------------------------------
   mp4.js が読んだ「目次」をもとに、クリップ（使う範囲）を並べて
   1本のMP4に組み直す。中身のコマはそのまま写すので画質は落ちない。
   すべてこの端末の中だけ。どこにも送らない。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  /* clips: [{ movie, reader, name, srcUrl, in, out, vDur }] */
  var clips = [];
  var current = -1;          // いま「切る」で開いているクリップ
  var playingAll = false;

  function setMsg(el, text, cls) {
    el.textContent = text || '';
    el.className = 'msg' + (cls ? ' ' + cls : '');
  }
  function fmt(t) { return (Math.round(t * 100) / 100).toFixed(2); }
  function humanSize(n) {
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB']; var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n >= 10 ? 0 : 1) + ' ' + u[i];
  }
  function hex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }

  /* ---------- 読み込み ---------- */

  // 共有URL（/f/ /dl/ /pv/ どれでも）→ 中身を読み出すURLへ。
  // /pv/ を使うのは、NASの動画は「どこでも再生できる控え(mp4)」が
  // そちらから返ってくるため（編集もその控えに対して行うのが自然）。
  function toFetchUrl(raw) {
    var m = String(raw || '').match(/^https:\/\/[^/]+\/(f|dl|pv)\/([A-Za-z0-9_-]{10,})(\?h=[0-9a-f]+)?$/);
    if (!m) return null;
    return raw.replace('/f/', '/pv/').replace('/dl/', '/pv/');
  }

  function addFromFile(file) {
    var reader = MP4.readerForFile(file);
    return addClip(reader, file.name, URL.createObjectURL(file));
  }

  function addFromUrl(raw) {
    var u = toFetchUrl(raw);
    if (!u) throw new Error('このサイトの受け取りURL（…/f/○○）を入れてください。');
    var reader = MP4.readerForUrl(u);
    return addClip(reader, '共有された動画', u);
  }

  function addClip(reader, name, srcUrl) {
    return MP4.parse(reader).then(function (movie) {
      var clip = {
        movie: movie, reader: reader, name: name, srcUrl: srcUrl,
        in: 0, out: movie.video.duration, vDur: movie.video.duration
      };
      clips.push(clip);
      renderClips();
      selectClip(clips.length - 1);
      return clip;
    });
  }

  /* ---------- クリップ一覧 ---------- */
  function renderClips() {
    var ol = $('clips');
    ol.innerHTML = '';
    clips.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'clip' + (i === current ? ' on' : '');
      var cv = document.createElement('canvas');
      cv.width = 192; cv.height = 108;
      var inf = document.createElement('div');
      inf.className = 'inf';
      inf.innerHTML = '<div class="nm"></div><div class="rg"></div>';
      inf.querySelector('.nm').textContent = (i + 1) + '. ' + c.name;
      inf.querySelector('.rg').textContent =
        fmt(c.in) + '秒 〜 ' + fmt(c.out) + '秒（' + fmt(c.out - c.in) + '秒）';
      var ops = document.createElement('div');
      ops.className = 'ops';
      [['↑', function () { move(i, -1); }],
       ['↓', function () { move(i, 1); }],
       ['複製', function () { dup(i); }],
       ['削除', function () { del(i); }]].forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'mini'; btn.textContent = b[0];
        btn.addEventListener('click', function (e) { e.stopPropagation(); b[1](); });
        ops.appendChild(btn);
      });
      li.appendChild(cv); li.appendChild(inf); li.appendChild(ops);
      li.addEventListener('click', function () { selectClip(i); });
      ol.appendChild(li);
      drawThumb(c, cv);
    });
    var total = clips.reduce(function (s, c) { return s + (c.out - c.in); }, 0);
    $('total').textContent = fmt(total) + '秒';
    $('clips-card').hidden = clips.length === 0;
    $('export-card').hidden = clips.length === 0;
    if (clips.length === 0) $('edit-card').hidden = true;
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= clips.length) return;
    var t = clips[i]; clips[i] = clips[j]; clips[j] = t;
    if (current === i) current = j; else if (current === j) current = i;
    renderClips();
  }
  function dup(i) {
    var c = clips[i];
    clips.splice(i + 1, 0, { movie: c.movie, reader: c.reader, name: c.name, srcUrl: c.srcUrl, in: c.in, out: c.out, vDur: c.vDur });
    if (current > i) current++;
    renderClips();
  }
  function del(i) {
    clips.splice(i, 1);
    if (current === i) { current = -1; $('edit-card').hidden = true; }
    else if (current > i) current--;
    renderClips();
  }

  // サムネイル。よそのドメインの動画は canvas に描けないことがあるので、失敗したら無地のまま
  function drawThumb(clip, cv) {
    var v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'metadata';
    v.muted = true;
    v.src = clip.srcUrl;
    v.addEventListener('loadeddata', function () { v.currentTime = clip.in + 0.1; });
    v.addEventListener('seeked', function () {
      try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); } catch (e) { }
      v.removeAttribute('src'); v.load();
    });
    v.addEventListener('error', function () { });
  }

  /* ---------- 切る ---------- */
  var player = $('player');

  function selectClip(i) {
    current = i;
    var c = clips[i];
    $('edit-card').hidden = false;
    $('edit-name').textContent = '— ' + (i + 1) + '. ' + c.name;
    if (player.getAttribute('src') !== c.srcUrl) {
      player.crossOrigin = 'anonymous';
      player.src = c.srcUrl;
    }
    $('in').value = fmt(c.in);
    $('out').value = fmt(c.out);
    updateSnapNote();
    renderClips();
    $('edit-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function applyTrim() {
    if (current < 0) return;
    var c = clips[current];
    var vin = Math.max(0, Number($('in').value) || 0);
    var vout = Math.min(c.vDur, Number($('out').value) || c.vDur);
    if (vout <= vin) vout = Math.min(c.vDur, vin + 0.5);
    c.in = vin; c.out = vout;
    $('in').value = fmt(vin); $('out').value = fmt(vout);
    updateSnapNote();
    renderClips();
  }

  // 実際にどこから切れるか（直前のキーフレーム）を見せておく
  function updateSnapNote() {
    if (current < 0) return;
    var c = clips[current];
    var r = MP4.cutVideo(c.movie.video, c.in, c.out);
    $('snap').textContent = '実際の切り出し: ' + fmt(r.actualIn) + '秒 〜 ' + fmt(r.actualOut)
      + '秒（開始は直前のキーフレームに合わせます）';
  }

  $('in').addEventListener('change', applyTrim);
  $('out').addEventListener('change', applyTrim);
  $('set-in').addEventListener('click', function () {
    $('in').value = fmt(player.currentTime); applyTrim();
  });
  $('set-out').addEventListener('click', function () {
    $('out').value = fmt(player.currentTime); applyTrim();
  });
  player.addEventListener('timeupdate', function () {
    $('now').textContent = fmt(player.currentTime) + '秒';
    if (playingAll && current >= 0 && player.currentTime >= clips[current].out - 0.05) {
      var next = current + 1;
      if (next < clips.length) {
        selectClip(next);
        player.currentTime = clips[next].in;
        player.play();
      } else {
        playingAll = false;
        player.pause();
      }
    } else if (!playingAll && current >= 0 && player.currentTime >= clips[current].out) {
      player.pause();
    }
  });

  $('preview-clip').addEventListener('click', function () {
    if (current < 0) return;
    playingAll = false;
    player.currentTime = clips[current].in;
    player.play();
  });
  $('preview-all').addEventListener('click', function () {
    if (!clips.length) return;
    playingAll = true;
    selectClip(0);
    player.currentTime = clips[0].in;
    player.play();
  });

  /* ---------- 入力 ---------- */
  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () {
    var files = Array.from($('file').files || []);
    $('file').value = '';
    if (!files.length) return;
    setMsg($('in-msg'), '読み込んでいます…', 'info');
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return addFromFile(f); });
    });
    chain.then(function () { setMsg($('in-msg'), files.length + '本を読み込みました。', 'ok'); })
      .catch(function (e) { setMsg($('in-msg'), e.message || '読み込めませんでした。', 'err'); });
  });
  $('load-url').addEventListener('click', function () {
    var raw = $('url').value.trim();
    if (!raw) return;
    setMsg($('in-msg'), '読み込んでいます…（大きい動画でも目次だけなのですぐです）', 'info');
    Promise.resolve().then(function () { return addFromUrl(raw); })
      .then(function () { setMsg($('in-msg'), '読み込みました。', 'ok'); $('url').value = ''; })
      .catch(function (e) { setMsg($('in-msg'), e.message || '読み込めませんでした。', 'err'); });
  });

  /* ---------- 書き出し ---------- */

  /* 選んだ範囲のコマを、置き場所ごとにまとめて取り寄せる。
     1コマずつ取りに行くと回線の往復だけで日が暮れるので、
     近い場所（256KB以内の隙間）はひとつの取り寄せに束ねる。 */
  function collectRemote(reader, wants, onProgress) {
    var sorted = wants.slice().sort(function (a, b) { return a.off - b.off; });
    var groups = [];
    sorted.forEach(function (w) {
      var g = groups[groups.length - 1];
      if (g && w.off - (g.off + g.len) < 256 * 1024) {
        g.len = Math.max(g.len, w.off + w.size - g.off);
        g.items.push(w);
      } else {
        groups.push({ off: w.off, len: w.size, items: [w] });
      }
    });
    var got = 0, total = groups.reduce(function (s, g) { return s + g.len; }, 0);
    var out = {};
    var chain = Promise.resolve();
    groups.forEach(function (g) {
      chain = chain.then(function () {
        return reader.read(g.off, g.len).then(function (buf) {
          g.items.forEach(function (w) {
            out[w.key] = buf.subarray(w.off - g.off, w.off - g.off + w.size);
          });
          got += g.len;
          onProgress(got / total);
        });
      });
    });
    return chain.then(function () { return out; });
  }

  $('export').addEventListener('click', function () {
    if (!clips.length) return;
    var exMsg = $('ex-msg');
    var bar = $('bar'), barI = $('bar-i');
    $('export').disabled = true;
    $('result').textContent = '';
    bar.style.display = 'block'; barI.style.width = '0%';

    Promise.resolve().then(function () {
      // 形式が揃っているかを先に見る（揃っていないと1本にできない）
      var vHex = hex(clips[0].movie.video.stsdBytes);
      clips.forEach(function (c) {
        if (hex(c.movie.video.stsdBytes) !== vHex) {
          throw new Error('クリップの映像の形式が揃っていません。同じ動画（または同じ設定で撮った動画）同士ならつなげられます。');
        }
      });
      var useAudio = clips.every(function (c) {
        return c.movie.audio && c.movie.audio.codec === 'mp4a';
      });
      if (useAudio) {
        var aHex = hex(clips[0].movie.audio.stsdBytes);
        useAudio = clips.every(function (c) { return hex(c.movie.audio.stsdBytes) === aHex; });
      }
      var dropNote = '';
      if (!useAudio && clips.some(function (c) { return c.movie.audio; })) {
        if (!window.confirm('音声の形式が扱えない（または揃っていない）ため、音なしで書き出します。よろしいですか？')) {
          throw new Error('中止しました。');
        }
        dropNote = '（音なし）';
      }

      // クリップごとに使うコマを決めて、1本分の表につなぐ
      var vSamples = [], aSamples = [];
      var jobs = [];           // 取り寄せの一覧（クリップ単位）
      clips.forEach(function (c, ci) {
        var v = c.movie.video;
        var r = MP4.cutVideo(v, c.in, c.out);
        var wants = [];
        for (var i = r.start; i < r.end; i++) {
          var key = 'v' + ci + '_' + i;
          vSamples.push({ size: v.sizes[i], dur: v.durs[i],
            ctsOff: v.ctsOff ? v.ctsOff[i] : 0,
            sync: !v.sync || !!v.sync[i], key: key, clip: ci, idx: i, track: 'v' });
          wants.push({ key: key, off: v.offsets[i], size: v.sizes[i] });
        }
        if (useAudio) {
          var a = c.movie.audio;
          var ar = MP4.cutAudio(a, r.actualIn, r.actualOut);
          for (i = ar.start; i < ar.end; i++) {
            key = 'a' + ci + '_' + i;
            aSamples.push({ size: a.sizes[i], dur: a.durs[i], ctsOff: 0, sync: true,
              key: key, clip: ci, idx: i, track: 'a' });
            wants.push({ key: key, off: a.offsets[i], size: a.sizes[i] });
          }
        }
        jobs.push({ clip: c, wants: wants });
      });

      var v0 = clips[0].movie.video;
      var tracks = [{
        kind: 'video', stsdBytes: v0.stsdBytes, timescale: v0.timescale,
        width: v0.width, height: v0.height, samples: vSamples
      }];
      if (useAudio && aSamples.length) {
        var a0 = clips[0].movie.audio;
        tracks.push({ kind: 'audio', stsdBytes: a0.stsdBytes, timescale: a0.timescale,
          width: 0, height: 0, samples: aSamples });
      }

      // 中身を取り寄せる。端末のファイルは切り出すだけ（メモリに読まない）
      var pieces = {};
      var chain = Promise.resolve();
      var doneJobs = 0;
      jobs.forEach(function (job) {
        chain = chain.then(function () {
          if (job.clip.reader.part && !job.clip.reader.init) {
            // 端末のファイル: Blob の切り出し参照で足りる
            job.wants.forEach(function (w) {
              pieces[w.key] = job.clip.reader.part(w.off, w.size);
            });
            doneJobs++;
            barI.style.width = Math.round(doneJobs / jobs.length * 60) + '%';
            return;
          }
          setMsg(exMsg, '取り寄せ中… ' + (doneJobs + 1) + '/' + jobs.length, 'info');
          return collectRemote(job.clip.reader, job.wants, function (p) {
            barI.style.width = Math.round((doneJobs + p) / jobs.length * 60) + '%';
          }).then(function (out) {
            Object.keys(out).forEach(function (k) { pieces[k] = out[k]; });
            doneJobs++;
          });
        });
      });

      return chain.then(function () {
        setMsg(exMsg, '組み立て中…', 'info');
        return MP4.buildMp4(tracks, function (t, i) {
          return pieces[tracks[t].samples[i].key];
        }, function (p) {
          barI.style.width = (60 + Math.round(p * 40)) + '%';
        });
      }).then(function (blob) {
        var name = ($('outname').value.trim() || '編集した動画') + '';
        if (!/\.mp4$/i.test(name)) name += '.mp4';
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        a.textContent = name + '（' + humanSize(blob.size) + '）をダウンロード';
        $('result').innerHTML = '';
        $('result').appendChild(a);
        a.click();
        setMsg(exMsg, '書き出しました' + dropNote + '。保存が始まらないときは上のリンクを押してください。', 'ok');
      });
    }).catch(function (e) {
      setMsg(exMsg, e.message || '書き出せませんでした。', 'err');
    }).then(function () {
      $('export').disabled = false;
      setTimeout(function () { bar.style.display = 'none'; }, 800);
    });
  });
})();
