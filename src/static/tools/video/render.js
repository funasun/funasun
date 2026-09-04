/* ============================================================
   render.js — 動画を「作り直して」書き出す
   ------------------------------------------------------------
   1段階目（切る・つなぐ）は中身に触らないので一瞬・無劣化だった。
   ここは中身を作り直す道。そのかわり次のことができる:
     ・テロップ（文字）を焼き込む
     ・1コマ単位の正確なカット（キーフレームに丸めない）
     ・音量を変える／消す
     ・速さを変える
     ・始まりと終わりのフェード
   処理はぜんぶこの端末の中。ブラウザの映像用回路を使うので、
   スマホでもそれなりの速さで書き出せる。
   ============================================================ */
(function (global) {
  'use strict';

  function supported() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
  }

  /* この端末で書き出せるか（形式ごと）を先に確かめる。
     できないのに始めてしまうと、長く待たせた末に失敗するので。 */
  /* H.264 の「レベル」は絵の大きさで決まる（1280×720 までなら 3.1、フルHD は 4.0、
     4K は 5.1）。小さいレベルのまま大きい絵を頼むと、符号器が断る端末がある。
     大きさから必要なレベルを選び、Baseline → Main → High の順に使えるものを探す。 */
  var LEVELS = [['1f', 3600, 108000], ['20', 5120, 216000], ['28', 8192, 245760], ['2a', 8704, 522240],
    ['32', 22080, 589824], ['33', 22080, 983040], ['34', 36864, 2073600], ['3c', 139264, 4177920]];
  function levelFor(w, h, fps) {
    var mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * (fps || 30);
    for (var i = 0; i < LEVELS.length; i++) if (mbs <= LEVELS[i][1] && rate <= LEVELS[i][2]) return LEVELS[i][0];
    return LEVELS[LEVELS.length - 1][0];
  }
  function pickCodec(width, height) {
    var lv = levelFor(width, height, 30);
    var cands = ['avc1.4200' + lv, 'avc1.4d00' + lv, 'avc1.6400' + lv, 'avc1.42001f'];
    return cands.reduce(function (chain, codec) {
      return chain.then(function (found) {
        if (found) return found;
        return VideoEncoder.isConfigSupported({ codec: codec, width: even(width), height: even(height), bitrate: 4000000 })
          .then(function (r) { return r.supported ? codec : null; }).catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function checkSupport(width, height) {
    if (!supported()) {
      return Promise.resolve({ ok: false, why: 'この端末のブラウザは動画の作り直しに対応していません。Chrome か Safari の新しい版でお試しください。' });
    }
    return pickCodec(width, height).then(function (codec) {
      if (!codec) return { ok: false, why: 'この端末では、この大きさの動画を書き出せませんでした。書き出しの大きさを小さくしてお試しください。' };
      return { ok: true, codec: codec };
    }).catch(function () {
      return { ok: false, why: 'この端末では動画の作り直しに対応していないようです。' };
    });
  }

  function even(n) { return Math.max(2, Math.round(n / 2) * 2); }   // 幅・高さは偶数でないと符号器が嫌がる

  /* 遠くの置き場所（NASの中継）のコマを1つずつ取りに行くと、往復だけで日が暮れる。
     近い場所にあるコマを束ねて、少し先まで先回りして取り寄せる。
     端末のファイルは切り出すだけなので、束ねずそのまま。 */
  function samplePrefetcher(reader, track, startIdx, endIdx) {
    var remote = !!reader.init;             // readerForUrl だけが init を持つ
    if (!remote) return function (i) { return Promise.resolve(reader.part(track.offsets[i], track.sizes[i])); };
    var GROUP = 6 * 1024 * 1024, GAP = 256 * 1024;
    var groups = [], g = null;
    for (var i = startIdx; i < endIdx; i++) {
      var off = track.offsets[i], size = track.sizes[i];
      if (g && off >= g.off && off - (g.off + g.len) <= GAP && (off + size - g.off) <= GROUP) {
        g.len = Math.max(g.len, off + size - g.off); g.last = i;
      } else {
        g = { off: off, len: size, first: i, last: i, p: null }; groups.push(g);
      }
    }
    var byIdx = {};
    groups.forEach(function (gr, gi) { for (var k = gr.first; k <= gr.last; k++) byIdx[k] = gi; });
    function fetchGroup(gi) {
      var gr = groups[gi];
      if (!gr.p) gr.p = reader.read(gr.off, gr.len);
      return gr.p;
    }
    return function (i) {
      var gi = byIdx[i];
      if (gi === undefined) return Promise.resolve(reader.part(track.offsets[i], track.sizes[i]));
      // 次の束も先に頼んでおく（2つ先まで）。復号している間に届く
      if (gi + 1 < groups.length) fetchGroup(gi + 1);
      if (gi + 2 < groups.length) fetchGroup(gi + 2);
      return fetchGroup(gi).then(function (buf) {
        var gr = groups[gi];
        var st = track.offsets[i] - gr.off;
        var out = buf.subarray(st, st + track.sizes[i]);
        if (i === gr.last) gr.p = null;   // 使い切った束は手放す（メモリを溜めない）
        return out;
      });
    };
  }

  /* 1つのクリップの映像コマを、順番に取り出して渡す。
     切り出しは「直前のキーフレームから復号し、要らない前半は捨てる」。
     こうすると1コマ単位で正確に切れる。 */
  function decodeClipFrames(clip, onFrame, onProgress) {
    var v = clip.movie.video;
    var cfg = MP4.codecConfigFrom(v);
    if (!cfg) return Promise.reject(new Error('この動画の形式を読み取れませんでした。'));

    // 開始位置の直前のキーフレームを探す（そこから復号しないと絵が作れない）
    var startIdx = 0;
    for (var i = 0; i < v.count; i++) {
      if ((!v.sync || v.sync[i]) && v.dts[i] / v.timescale <= clip.in) startIdx = i;
      if (v.dts[i] / v.timescale > clip.in) break;
    }
    var endIdx = v.count;
    for (i = startIdx; i < v.count; i++) {
      if (v.dts[i] / v.timescale >= clip.out) { endIdx = i; break; }
    }

    var getV = samplePrefetcher(clip.reader, v, startIdx, endIdx);
    return new Promise(function (resolve, reject) {
      var done = 0, total = endIdx - startIdx, closed = false;
      var pending = [];
      var dec = new VideoDecoder({
        output: function (frame) {
          // 表示時刻（秒）。要る範囲の外なら捨てる
          var t = frame.timestamp / 1e6;
          if (t + 1e-6 < clip.in || t >= clip.out) { frame.close(); return; }
          pending.push(onFrame(frame, t));
        },
        error: function (e) { if (!closed) { closed = true; reject(new Error('動画を読み解けませんでした：' + e.message)); } }
      });
      try {
        dec.configure({
          codec: cfg.codec, codedWidth: v.width, codedHeight: v.height,
          description: cfg.description
        });
      } catch (e) { reject(new Error('この動画の形式には対応していません（' + cfg.codec + '）。')); return; }

      // コマの中身を取り寄せながら、順に復号器へ入れる
      (function feed(i) {
        if (closed) return;
        if (i >= endIdx) {
          dec.flush().then(function () {
            return Promise.all(pending);
          }).then(function () {
            dec.close();
            resolve();
          }).catch(function (e) { reject(e); });
          return;
        }
        getV(i).then(function (piece) {
          return piece instanceof Uint8Array ? piece
            : piece.arrayBuffer().then(function (b) { return new Uint8Array(b); });
        }).then(function (bytes) {
          if (closed) return;
          var ctsOff = v.ctsOff ? v.ctsOff[i] : 0;
          dec.decode(new EncodedVideoChunk({
            type: (!v.sync || v.sync[i]) ? 'key' : 'delta',
            timestamp: Math.round((v.dts[i] + ctsOff) / v.timescale * 1e6),
            duration: Math.round(v.durs[i] / v.timescale * 1e6),
            data: bytes
          }));
          done++;
          if (onProgress && (done % 12 === 0 || done === total)) onProgress(done / total);
          // 復号器を詰まらせない（待ち行列が長すぎたら少し待つ）
          if (dec.decodeQueueSize > 24) {
            var wait = function () {
              if (dec.decodeQueueSize > 8) { setTimeout(wait, 12); return; }
              feed(i + 1);
            };
            wait();
          } else {
            feed(i + 1);
          }
        }).catch(function (e) { if (!closed) { closed = true; reject(e); } });
      })(startIdx);
    });
  }

  /* テロップやフェードを1コマに描く */
  function paint(cx, frame, W, H, clip, tRel, dur) {
    cx.clearRect(0, 0, W, H);
    // 元のコマを、はみ出さないように中央へ
    if (clip.project) {
      /* 360°の切り出しなど、コマを別の絵に作り替えてから描く道
         （返ってきた絵は出力と同じ大きさで、そのまま全面に敷く） */
      cx.drawImage(clip.project(frame, tRel, dur), 0, 0, W, H);
    } else {
      var fw = frame.displayWidth || frame.codedWidth;
      var fh = frame.displayHeight || frame.codedHeight;
      var k = Math.min(W / fw, H / fh);
      var dw = fw * k, dh = fh * k;
      cx.drawImage(frame, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    var ef = clip.effects || {};

    // テロップ
    if (ef.text) {
      var size = Math.round(H * ((Number(ef.textSize) || 6) / 100));
      cx.font = '600 ' + size + "px 'Noto Sans JP', 'Hiragino Sans', sans-serif";
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      var lines = String(ef.text).split('\n');
      var lineH = Math.round(size * 1.3);
      var posY = ef.textPos === 'top' ? H * 0.14
        : ef.textPos === 'middle' ? H * 0.5
        : H * 0.86;
      var startY = posY - (lines.length - 1) * lineH / 2;
      lines.forEach(function (ln, i) {
        var y = startY + i * lineH;
        // 縁取り（背景が明るくても暗くても読めるように）
        cx.lineWidth = Math.max(2, size * 0.14);
        cx.strokeStyle = 'rgba(0,0,0,.72)';
        cx.lineJoin = 'round';
        cx.strokeText(ln, W / 2, y);
        cx.fillStyle = ef.textColor || '#ffffff';
        cx.fillText(ln, W / 2, y);
      });
    }

    // フェード（黒への重ね）
    var fi = Number(ef.fadeIn) || 0, fo = Number(ef.fadeOut) || 0;
    var a = 0;
    if (fi > 0 && tRel < fi) a = Math.max(a, 1 - tRel / fi);
    if (fo > 0 && tRel > dur - fo) a = Math.max(a, 1 - (dur - tRel) / fo);
    if (a > 0) {
      cx.fillStyle = 'rgba(0,0,0,' + Math.min(1, a) + ')';
      cx.fillRect(0, 0, W, H);
    }
  }

  /* ---- 音声を作り直す（音量・速さ） ---- */
  function renderAudio(clips, outRate, onProgress) {
    var haveAll = clips.every(function (c) { return c.movie.audio && c.movie.audio.codec === 'mp4a'; });
    if (!haveAll || typeof AudioDecoder === 'undefined' || typeof AudioEncoder === 'undefined') {
      return Promise.resolve(null);
    }
    var allSilent = clips.every(function (c) { return Number((c.effects || {}).volume) === 0; });
    if (allSilent) return Promise.resolve(null);

    var channels = 2;
    var pcm = [[], []];      // 出来上がりのPCM（チャンネルごとの Float32Array の列）

    // クリップを順に復号して、音量と速さを反映しながらPCMに積む
    return clips.reduce(function (chain, clip, ci) {
      return chain.then(function () {
        return decodeClipAudio(clip, outRate, function (p) {
          if (onProgress) onProgress((ci + p) / clips.length);
        }).then(function (buf) {
          if (!buf) return;
          for (var ch = 0; ch < channels; ch++) pcm[ch].push(buf[Math.min(ch, buf.length - 1)]);
        });
      });
    }, Promise.resolve()).then(function () {
      var total = pcm[0].reduce(function (s, a) { return s + a.length; }, 0);
      if (!total) return null;
      var merged = [];
      for (var ch = 0; ch < channels; ch++) {
        var out = new Float32Array(total), at = 0;
        pcm[ch].forEach(function (a) { out.set(a, at); at += a.length; });
        merged.push(out);
      }
      return encodeAudio(merged, outRate, channels);
    });
  }

  function decodeClipAudio(clip, outRate, onProgress) {
    var a = clip.movie.audio;
    var cfg = MP4.codecConfigFrom(a);
    if (!cfg || !cfg.description) return Promise.resolve(null);
    /* 音の1秒あたりの本数は、時間の刻み（timescale）とは別物。
       元の設定から読んだ値を使わないと、復号器が受け付けてくれない。 */
    var srcRate = cfg.sampleRate || a.timescale || 48000;
    var srcCh = Math.max(1, Math.min(2, cfg.channels || 2));
    var ef = clip.effects || {};
    var gain = ef.volume === undefined ? 1 : Number(ef.volume);
    var speed = Number(ef.speed) || 1;

    // 使う範囲（映像に合わせる）
    var ts = a.timescale;
    var startIdx = 0;
    for (var i = 0; i < a.count; i++) { if (a.dts[i] / ts <= clip.in) startIdx = i; else break; }
    var endIdx = a.count;
    for (i = startIdx; i < a.count; i++) { if (a.dts[i] / ts >= clip.out) { endIdx = i; break; } }

    var getA = samplePrefetcher(clip.reader, a, startIdx, endIdx);
    return new Promise(function (resolve, reject) {
      var chunks = [];     // [{t, data:[Float32Array per ch]}]
      var closed = false;
      var dec = new AudioDecoder({
        output: function (data) {
          var t = data.timestamp / 1e6;
          var n = data.numberOfFrames;
          var chs = data.numberOfChannels;
          var planes = [];
          for (var c = 0; c < chs; c++) {
            var f = new Float32Array(n);
            try { data.copyTo(f, { planeIndex: c, format: 'f32-planar' }); } catch (e) { }
            planes.push(f);
          }
          data.close();
          if (t + n / srcRate > clip.in && t < clip.out) chunks.push({ t: t, planes: planes });
        },
        error: function (e) { if (!closed) { closed = true; resolve(null); } }
      });
      try {
        dec.configure({ codec: 'mp4a.40.2', sampleRate: srcRate, numberOfChannels: srcCh, description: cfg.description });
      } catch (e) { resolve(null); return; }

      (function feed(i) {
        if (closed) return;
        if (i >= endIdx) {
          dec.flush().then(function () {
            dec.close();
            resolve(assemble(chunks, clip, srcRate, outRate, gain, speed));
          }).catch(function () { resolve(null); });
          return;
        }
        getA(i).then(function (piece) {
          return piece instanceof Uint8Array ? piece : piece.arrayBuffer().then(function (b) { return new Uint8Array(b); });
        }).then(function (bytes) {
          if (closed) return;
          dec.decode(new EncodedAudioChunk({
            type: 'key',
            timestamp: Math.round(a.dts[i] / ts * 1e6),
            duration: Math.round(a.durs[i] / ts * 1e6),
            data: bytes
          }));
          if (onProgress && i % 20 === 0) onProgress((i - startIdx) / Math.max(1, endIdx - startIdx));
          if (dec.decodeQueueSize > 24) {
            var wait = function () { if (dec.decodeQueueSize > 8) { setTimeout(wait, 10); return; } feed(i + 1); };
            wait();
          } else feed(i + 1);
        }).catch(function () { if (!closed) { closed = true; resolve(null); } });
      })(startIdx);
    });
  }

  /* 復号した音を、必要な範囲だけ切り出して1本につなぐ。
     速さを変えるときは、間を取って作り直す（音の高さも変わる＝早送りの音）。
     元と書き出しで1秒あたりの本数が違うときも、同じ「間を取る」処理で合わせる。 */
  function assemble(chunks, clip, srcRate, outRate, gain, speed) {
    if (!chunks.length) return null;
    chunks.sort(function (x, y) { return x.t - y.t; });
    var want = Math.max(0, Math.round((clip.out - clip.in) * srcRate));
    var chs = Math.max(1, chunks[0].planes.length);
    var src = [];
    for (var c = 0; c < chs; c++) src.push(new Float32Array(want));
    chunks.forEach(function (ck) {
      var at = Math.round((ck.t - clip.in) * srcRate);
      for (var c2 = 0; c2 < chs; c2++) {
        var p = ck.planes[Math.min(c2, ck.planes.length - 1)];
        for (var j = 0; j < p.length; j++) {
          var k = at + j;
          if (k >= 0 && k < want) src[c2][k] = p[j];
        }
      }
    });
    // 速さ（と、元と書き出しの本数のちがい）
    var step = (srcRate / outRate) * (speed || 1);
    var outLen = Math.max(1, Math.round(want / step));
    var out = [];
    for (c = 0; c < chs; c++) {
      var o = new Float32Array(outLen);
      for (var i = 0; i < outLen; i++) {
        var pos = i * step;
        var i0 = Math.floor(pos), i1 = Math.min(want - 1, i0 + 1), fr = pos - i0;
        var s = (src[c][i0] || 0) * (1 - fr) + (src[c][i1] || 0) * fr;
        o[i] = s * gain;
      }
      out.push(o);
    }
    return out;
  }

  function encodeAudio(planes, rate, channels) {
    return new Promise(function (resolve) {
      var chunks = [], desc = null, closed = false;
      var enc = new AudioEncoder({
        output: function (chunk, meta) {
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc) {
            desc = new Uint8Array(meta.decoderConfig.description);
          }
          var b = new Uint8Array(chunk.byteLength);
          chunk.copyTo(b);
          chunks.push({ data: b, timestamp: chunk.timestamp, duration: chunk.duration });
        },
        error: function () { if (!closed) { closed = true; resolve(null); } }
      });
      try {
        enc.configure({ codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: channels, bitrate: 128000 });
      } catch (e) { resolve(null); return; }

      var total = planes[0].length;
      var BLK = 1024;
      for (var at = 0; at < total; at += BLK) {
        var n = Math.min(BLK, total - at);
        var inter = new Float32Array(n * channels);
        for (var c = 0; c < channels; c++) {
          var p = planes[Math.min(c, planes.length - 1)];
          for (var j = 0; j < n; j++) inter[j * channels + c] = p[at + j];
        }
        enc.encode(new AudioData({
          format: 'f32', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels,
          timestamp: Math.round(at / rate * 1e6), data: inter
        }));
      }
      enc.flush().then(function () {
        enc.close();
        if (!chunks.length || !desc) { resolve(null); return; }
        resolve({ chunks: chunks, description: desc, rate: rate, channels: channels });
      }).catch(function () { resolve(null); });
    });
  }

  /* ---- 本体：クリップを順に作り直して1本のMP4にする ---- */
  function render(clips, opts, onProgress) {
    opts = opts || {};
    var v0 = clips[0].movie.video;
    var maxW = Number(opts.maxWidth) || 1920;
    var scale = Math.min(1, maxW / v0.width);
    // 出力の大きさを直接指定できる（360°の切り出しは元と別の縦横比になる）
    var W = opts.width ? even(Number(opts.width)) : even(v0.width * scale);
    var H = opts.height ? even(Number(opts.height)) : even(v0.height * scale);
    var bitrate = Number(opts.bitrate) || Math.min(12000000, Math.max(2000000, W * H * 4));

    return checkSupport(W, H).then(function (sup) {
      if (!sup.ok) throw new Error(sup.why);

      var canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(W, H) : document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var cx = canvas.getContext('2d');

      var vChunks = [], vDesc = null;
      var outT = 0;                      // 書き出し側の時刻（µs）。速さを反映して自分で進める
      var encErr = null;

      var enc = new VideoEncoder({
        output: function (chunk, meta) {
          if (meta && meta.decoderConfig && meta.decoderConfig.description && !vDesc) {
            vDesc = new Uint8Array(meta.decoderConfig.description);
          }
          var b = new Uint8Array(chunk.byteLength);
          chunk.copyTo(b);
          vChunks.push({ data: b, timestamp: chunk.timestamp, type: chunk.type });
        },
        error: function (e) { encErr = e; }
      });
      enc.configure({
        codec: sup.codec || 'avc1.42001f', width: W, height: H, bitrate: bitrate,
        framerate: 30, latencyMode: 'quality'
      });

      var totalDur = clips.reduce(function (s, c) {
        return s + (c.out - c.in) / (Number((c.effects || {}).speed) || 1);
      }, 0);
      var doneDur = 0;

      return clips.reduce(function (chain, clip, ci) {
        return chain.then(function () {
          var speed = Number((clip.effects || {}).speed) || 1;
          var clipDur = clip.out - clip.in;
          var frameCount = 0;
          return decodeClipFrames(clip, function (frame, t) {
            if (encErr) { frame.close(); return; }
            var tRel = t - clip.in;
            paint(cx, frame, W, H, clip, tRel, clipDur);
            frame.close();
            var ts = Math.round(outT + (tRel / speed) * 1e6);
            var vf = new VideoFrame(canvas, { timestamp: ts, duration: Math.round(33333 / speed) });
            enc.encode(vf, { keyFrame: frameCount === 0 });
            vf.close();
            frameCount++;
            if (onProgress && frameCount % 10 === 0) {
              onProgress(Math.min(0.95, (doneDur + tRel / speed) / totalDur), '作り直しています');
            }
          }, null).then(function () {
            outT += Math.round(clipDur / speed * 1e6);
            doneDur += clipDur / speed;
          });
        });
      }, Promise.resolve()).then(function () {
        return enc.flush();
      }).then(function () {
        enc.close();
        if (encErr) throw new Error('書き出しの途中で問題が起きました：' + encErr.message);
        if (!vChunks.length || !vDesc) throw new Error('コマを1枚も書き出せませんでした。');
        if (onProgress) onProgress(0.96, '音を作り直しています');
        var a0 = clips[0].movie.audio;
        var a0cfg = a0 ? MP4.codecConfigFrom(a0) : null;
        var rate = (a0cfg && a0cfg.sampleRate) || 48000;
        return renderAudio(clips, rate, null).then(function (audio) {
          return { audio: audio };
        });
      }).then(function (r) {
        if (onProgress) onProgress(0.98, 'まとめています');
        // 映像トラック
        vChunks.sort(function (a, b) { return a.timestamp - b.timestamp; });
        var vSamples = vChunks.map(function (c, i) {
          var next = vChunks[i + 1];
          var dur = next ? (next.timestamp - c.timestamp) : 33333;
          return { size: c.data.length, dur: Math.max(1, dur), ctsOff: 0, sync: c.type === 'key' };
        });
        var tracks = [{
          kind: 'video', stsdBytes: MP4.buildVideoStsd(W, H, vDesc),
          timescale: 1000000, width: W, height: H, samples: vSamples
        }];
        var aChunks = null;
        if (r.audio) {
          aChunks = r.audio.chunks;
          var aSamples = aChunks.map(function (c, i) {
            var next = aChunks[i + 1];
            var dur = next ? (next.timestamp - c.timestamp) : (c.duration || 21333);
            return { size: c.data.length, dur: Math.max(1, Math.round(dur)), ctsOff: 0, sync: true };
          });
          tracks.push({
            kind: 'audio',
            stsdBytes: MP4.buildAudioStsd(r.audio.rate, r.audio.channels, r.audio.description),
            timescale: 1000000, width: 0, height: 0, samples: aSamples
          });
        }
        return MP4.buildMp4(tracks, function (ti, i) {
          return ti === 0 ? vChunks[i].data : aChunks[i].data;
        }, null).then(function (blob) {
          if (onProgress) onProgress(1, '完了');
          return blob;
        });
      });
    });
  }

  global.MP4Render = { render: render, supported: supported, checkSupport: checkSupport };
})(window);
