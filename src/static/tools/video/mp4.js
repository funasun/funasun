/* ============================================================
   mp4.js — MP4/MOV を読み書きする部品（外部ライブラリなし）
   ------------------------------------------------------------
   なぜ自前か: このサイトは外部の部品を読み込まない方針のため。
   なにをするか:
     parse()    … 動画ファイルの「目次」（どのコマがどこにあるか）を読む
     buildMp4() … 選んだコマをそのまま並べ直して、新しいMP4を組み立てる
   コマの中身（映像データそのもの）には手を付けない＝画質は変わらない。
   スマホでも動くように、中身はメモリへ全部載せず Blob の部品参照でつなぐ。

   対応: ふつうのMP4/MOV（iPhone撮影・画面収録・このサイトのNAS変換品）。
   非対応: 断片化MP4（配信用の特殊な形）。見つけたら日本語で断る。
   ============================================================ */
(function (global) {
  'use strict';

  var TXT = new TextDecoder();

  /* ---------- 読み口 ----------
     File でもネットワークでも「offset から length 読む」を同じ形にする。
     ここを揃えておくと、上の処理は置き場所を気にしなくて済む。 */
  function readerForFile(file) {
    return {
      size: file.size,
      name: file.name,
      read: function (off, len) {
        return file.slice(off, off + len).arrayBuffer().then(function (b) {
          return new Uint8Array(b);
        });
      },
      // 書き出し時に「中身そのもの」を Blob の部品として渡す（メモリに読まない）
      part: function (off, len) { return file.slice(off, off + len); }
    };
  }

  function readerForUrl(url) {
    var size = 0;
    /* 置き場所（NAS の中継）はたまに Range を無視して全体(200)を返してくることがある。
       そのまま受け取ると何百MBも落としてしまうので、本文は捨てて少し待ってやり直す。 */
    function rangeFetch(off, len, tries) {
      tries = tries || 0;
      return fetch(url, { headers: { Range: 'bytes=' + off + '-' + (off + len - 1) } })
        .then(function (r) {
          if (!(r.status === 206 || r.status === 200)) {
            throw new Error('読み込めませんでした（' + r.status + '）');
          }
          var cr = r.headers.get('Content-Range');
          if (cr) { var m = cr.match(/\/(\d+)/); if (m) size = Number(m[1]); }
          if (r.status === 200 && !cr) {
            // Range が効いていない。本文を止めて、少し待ってからもう一度
            try { if (r.body && r.body.cancel) r.body.cancel(); } catch (e) { }
            if (tries < 3) {
              return new Promise(function (res) { setTimeout(res, 400 * (tries + 1)); })
                .then(function () { return rangeFetch(off, len, tries + 1); });
            }
            throw new Error('この置き場所は途中読み(Range)に対応していません');
          }
          return r.arrayBuffer().then(function (b) { return new Uint8Array(b).slice(0, len); });
        });
    }
    return {
      get size() { return size; },
      name: url,
      init: function () {
        // 先頭を少しだけ読んで、全体の大きさ（Content-Range の分母）を知る。
        // 1バイトだけだと Content-Range を返さないサーバーがあるので数バイト読む。
        return rangeFetch(0, 16).then(function () {
          if (!size) throw new Error('この置き場所は途中読み(Range)に対応していません');
        });
      },
      read: function (off, len) { return rangeFetch(off, len); },
      part: function (off, len) { return rangeFetch(off, len).then(function (u) { return u; }); }
    };
  }

  /* ---------- 箱（box）歩き ----------
     MP4 は「大きさ＋名前＋中身」の箱が入れ子になった形。 */
  function walkBoxes(u8, start, end, cb) {
    var off = start;
    while (off + 8 <= end) {
      var size = (u8[off] << 24 | u8[off + 1] << 16 | u8[off + 2] << 8 | u8[off + 3]) >>> 0;
      var type = TXT.decode(u8.subarray(off + 4, off + 8));
      var head = 8;
      if (size === 1) {
        // 64bit の大きさ。上位が 0 でない巨大ファイルはここでは扱わない
        var hi = (u8[off + 8] << 24 | u8[off + 9] << 16 | u8[off + 10] << 8 | u8[off + 11]) >>> 0;
        var lo = (u8[off + 12] << 24 | u8[off + 13] << 16 | u8[off + 14] << 8 | u8[off + 15]) >>> 0;
        size = hi * 4294967296 + lo;
        head = 16;
      } else if (size === 0) {
        size = end - off;          // 末尾まで
      }
      if (size < head) return;     // 壊れている
      cb(type, off + head, off + size, off);
      off += size;
    }
  }

  function findBox(u8, start, end, name) {
    var found = null;
    walkBoxes(u8, start, end, function (type, s, e, o) {
      if (!found && type === name) found = { start: s, end: e, boxStart: o };
    });
    return found;
  }

  function u32(u8, o) { return (u8[o] << 24 | u8[o + 1] << 16 | u8[o + 2] << 8 | u8[o + 3]) >>> 0; }
  function u64(u8, o) { return u32(u8, o) * 4294967296 + u32(u8, o + 4); }

  /* ---------- 目次（moov）を探す ----------
     先頭から箱の名前だけ拾って進む。mdat（中身の塊）は飛ばす。 */
  function locateMoov(reader) {
    var offset = 0;
    function step() {
      return reader.read(offset, 16).then(function (h) {
        if (h.length < 8) throw new Error('動画の目次(moov)が見つかりませんでした');
        var size = u32(h, 0);
        var type = TXT.decode(h.subarray(4, 8));
        var boxSize = size;
        if (size === 1) boxSize = u64(h, 8);
        else if (size === 0) boxSize = reader.size - offset;
        if (type === 'moov') return { offset: offset, size: boxSize };
        offset += boxSize;
        if (offset >= reader.size) throw new Error('動画の目次(moov)が見つかりませんでした');
        return step();
      });
    }
    return step();
  }

  /* ---------- 目次を表に起こす ---------- */
  function parseTrack(u8, s, e) {
    var tkhd = findBox(u8, s, e, 'tkhd');
    var mdia = findBox(u8, s, e, 'mdia');
    if (!mdia) return null;
    var mdhd = findBox(u8, mdia.start, mdia.end, 'mdhd');
    var hdlr = findBox(u8, mdia.start, mdia.end, 'hdlr');
    var minf = findBox(u8, mdia.start, mdia.end, 'minf');
    if (!mdhd || !hdlr || !minf) return null;
    var stbl = findBox(u8, minf.start, minf.end, 'stbl');
    if (!stbl) return null;

    var ver = u8[mdhd.start];
    var timescale = ver === 1 ? u32(u8, mdhd.start + 20) : u32(u8, mdhd.start + 12);
    var durUnits = ver === 1 ? u64(u8, mdhd.start + 24) : u32(u8, mdhd.start + 16);
    var handler = TXT.decode(u8.subarray(hdlr.start + 8, hdlr.start + 12));
    var kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : handler;

    var stsd = findBox(u8, stbl.start, stbl.end, 'stsd');
    var stts = findBox(u8, stbl.start, stbl.end, 'stts');
    var ctts = findBox(u8, stbl.start, stbl.end, 'ctts');
    var stss = findBox(u8, stbl.start, stbl.end, 'stss');
    var stsz = findBox(u8, stbl.start, stbl.end, 'stsz');
    var stsc = findBox(u8, stbl.start, stbl.end, 'stsc');
    var stco = findBox(u8, stbl.start, stbl.end, 'stco');
    var co64 = findBox(u8, stbl.start, stbl.end, 'co64');
    if (!stsd || !stts || !stsz || !stsc || (!stco && !co64)) return null;

    // 中身の種類（avc1/hvc1/mp4a…）。書き出しでは stsd をまるごと使い回す
    var codec = TXT.decode(u8.subarray(stsd.start + 12, stsd.start + 16));
    var stsdBytes = u8.slice(stsd.boxStart, stsd.end);
    var width = 0, height = 0;
    if (kind === 'video') {
      width = (u8[stsd.start + 40] << 8 | u8[stsd.start + 41]);
      height = (u8[stsd.start + 42] << 8 | u8[stsd.start + 43]);
    }

    // 大きさの表
    var count = u32(u8, stsz.start + 8);
    var fixedSize = u32(u8, stsz.start + 4);
    var sizes = new Array(count);
    for (var i = 0; i < count; i++) sizes[i] = fixedSize || u32(u8, stsz.start + 12 + i * 4);

    // 継続時間の表（run-length を展開）
    var durs = new Array(count);
    var n = u32(u8, stts.start + 4), p = stts.start + 8, idx = 0;
    for (i = 0; i < n; i++) {
      var c = u32(u8, p); var d = u32(u8, p + 4); p += 8;
      for (var k = 0; k < c && idx < count; k++) durs[idx++] = d;
    }
    while (idx < count) durs[idx++] = durs[idx - 2] || 1;

    // 表示ずらし（Bフレームのある映像だけ持っている）
    var ctsOff = null;
    if (ctts) {
      ctsOff = new Array(count);
      n = u32(u8, ctts.start + 4); p = ctts.start + 8; idx = 0;
      var v1 = u8[ctts.boxStart + 8] === 1;
      for (i = 0; i < n; i++) {
        c = u32(u8, p);
        var off = u32(u8, p + 4);
        if (v1 && off > 0x7FFFFFFF) off = off - 4294967296;  // 符号つき
        p += 8;
        for (k = 0; k < c && idx < count; k++) ctsOff[idx++] = off;
      }
      while (idx < count) ctsOff[idx++] = 0;
    }

    // キーフレーム（無ければ全部がキーフレーム）
    var sync = null;
    if (stss) {
      sync = new Uint8Array(count);
      n = u32(u8, stss.start + 4); p = stss.start + 8;
      for (i = 0; i < n; i++) { var sn = u32(u8, p); p += 4; if (sn >= 1 && sn <= count) sync[sn - 1] = 1; }
    }

    // 置き場所の表（chunk → 各サンプルのファイル内位置）
    var offsets = new Array(count);
    var chunkCount = stco ? u32(u8, stco.start + 4) : u32(u8, co64.start + 4);
    var entries = [];
    n = u32(u8, stsc.start + 4); p = stsc.start + 8;
    for (i = 0; i < n; i++) { entries.push([u32(u8, p), u32(u8, p + 4)]); p += 12; }
    idx = 0;
    for (i = 0; i < chunkCount && idx < count; i++) {
      var chunkOff = stco ? u32(u8, stco.start + 8 + i * 4) : u64(u8, co64.start + 8 + i * 8);
      var per = entries.length ? entries[0][1] : 1;
      for (k = 0; k < entries.length; k++) if (entries[k][0] <= i + 1) per = entries[k][1];
      var pos = chunkOff;
      for (k = 0; k < per && idx < count; k++) { offsets[idx] = pos; pos += sizes[idx]; idx++; }
    }

    // 再生順の時刻（秒）とキーフレーム時刻の一覧
    var dts = new Array(count);
    var t = 0;
    var keyTimes = [];
    for (i = 0; i < count; i++) {
      dts[i] = t;
      if (!sync || sync[i]) keyTimes.push(t / timescale);
      t += durs[i];
    }

    return {
      kind: kind, codec: codec, timescale: timescale,
      duration: durUnits / timescale,
      stsdBytes: stsdBytes, width: width, height: height,
      count: count, sizes: sizes, offsets: offsets,
      durs: durs, dts: dts, ctsOff: ctsOff, sync: sync,
      keyTimes: keyTimes
    };
  }

  /* ---------- 断片化MP4（moof）の目次 ----------
     iPhone実機は非断片化だが、画面収録・ブラウザ録画・配信動画はこの形。
     moov には各トラックの「素性」だけがあり、コマの表は moof に分かれて
     散らばっている。ファイル全体を舐めて moof をぜんぶ拾い、表を作り直す。 */
  function parseFragmented(reader, moov) {
    // 各トラックの素性（timescale・種類・stsd・既定値）を moov から拾う
    var protos = {};
    var mvex = findBox(moov, 8, moov.length, 'mvex');
    var trexById = {};
    if (mvex) {
      walkBoxes(moov, mvex.start, mvex.end, function (type, s) {
        if (type !== 'trex') return;
        trexById[u32(moov, s + 4)] = {
          descIndex: u32(moov, s + 8), dur: u32(moov, s + 12),
          size: u32(moov, s + 16), flags: u32(moov, s + 20)
        };
      });
    }
    /* トラックを識別する id は3か所（tkhd / trex / moof の tfhd）に出てくるが、
       録画によっては tkhd が 0 で trex と食い違う。moof が実際に指す id を
       信じたいので、素性は「種類（映像/音声）」で引けるようにも作っておき、
       あとで moof の trackId をこの素性へ結び付ける。 */
    var trexList = Object.keys(trexById).map(function (k) { return { id: Number(k), trex: trexById[k] }; });
    var protoSeq = [];        // moov に出てきた順のトラック素性
    walkBoxes(moov, 8, moov.length, function (type, s, e) {
      if (type !== 'trak') return;
      var tkhd = findBox(moov, s, e, 'tkhd');
      var id = tkhd ? u32(moov, tkhd.start + 12) : 0;
      var mdia = findBox(moov, s, e, 'mdia');
      if (!mdia) return;
      var mdhd = findBox(moov, mdia.start, mdia.end, 'mdhd');
      var hdlr = findBox(moov, mdia.start, mdia.end, 'hdlr');
      var minf = findBox(moov, mdia.start, mdia.end, 'minf');
      if (!mdhd || !hdlr || !minf) return;
      var stbl = findBox(moov, minf.start, minf.end, 'stbl');
      var stsd = stbl && findBox(moov, stbl.start, stbl.end, 'stsd');
      if (!stsd) return;
      var ver = moov[mdhd.start];
      var timescale = ver === 1 ? u32(moov, mdhd.start + 20) : u32(moov, mdhd.start + 12);
      var handler = TXT.decode(moov.subarray(hdlr.start + 8, hdlr.start + 12));
      var kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : handler;
      var codec = TXT.decode(moov.subarray(stsd.start + 12, stsd.start + 16));
      var width = 0, height = 0;
      if (kind === 'video') {
        width = (moov[stsd.start + 40] << 8 | moov[stsd.start + 41]);
        height = (moov[stsd.start + 42] << 8 | moov[stsd.start + 43]);
      }
      var proto = {
        kind: kind, codec: codec, timescale: timescale,
        stsdBytes: moov.slice(stsd.boxStart, stsd.end), width: width, height: height,
        trex: trexById[id] || { dur: 0, size: 0, flags: 0 },
        sizes: [], offsets: [], durs: [], ctsOff: [], sync: [], hasCts: false, hasSync: false
      };
      if (id) protos[id] = proto;
      protoSeq.push(proto);
    });

    /* moof が指す trackId を素性に結び付ける。まず id で引き、無ければ
       moov に出てきた順（trak と trex/moof の並びは普通そろっている）で当てる。 */
    function protoFor(trackId) {
      if (protos[trackId]) return protos[trackId];
      // trex の並びから何番目のトラックかを割り出す
      for (var i = 0; i < trexList.length; i++) {
        if (trexList[i].id === trackId && protoSeq[i]) { protos[trackId] = protoSeq[i]; return protoSeq[i]; }
      }
      if (protoSeq.length === 1) { protos[trackId] = protoSeq[0]; return protoSeq[0]; }
      return null;
    }

    // moof を1つ読み取って、各サンプルの位置・大きさ・時間を足していく
    function readMoof(u8, moofStart, moofEnd, moofFileOffset) {
      walkBoxes(u8, moofStart + 8, moofEnd, function (type, s, e, o) {
        if (type !== 'traf') return;
        var tfhd = findBox(u8, s, e, 'tfhd');
        if (!tfhd) return;
        var flags = u32(u8, tfhd.boxStart + 8) & 0xffffff;
        var trackId = u32(u8, tfhd.start + 4);
        var proto = protoFor(trackId);
        if (!proto) return;
        var p = tfhd.start + 8;
        var baseOffset = moofFileOffset;    // 既定は moof の先頭から
        if (flags & 0x01) { baseOffset = u64(u8, p); p += 8; }
        var sampleDescIndex = (flags & 0x02) ? (p += 4, u32(u8, p - 4)) : 0;
        var defDur = (flags & 0x08) ? (p += 4, u32(u8, p - 4)) : proto.trex.dur;
        var defSize = (flags & 0x10) ? (p += 4, u32(u8, p - 4)) : proto.trex.size;
        var defFlags = (flags & 0x20) ? (p += 4, u32(u8, p - 4)) : proto.trex.flags;
        var durTotal = 0;

        walkBoxes(u8, s, e, function (t2, s2, e2, o2) {
          if (t2 !== 'trun') return;
          var tflags = u32(u8, o2 + 8) & 0xffffff;
          var count = u32(u8, s2 + 4);
          var q = s2 + 8;
          var dataOffset = (tflags & 0x01) ? (q += 4, (u32(u8, q - 4) | 0)) : 0;
          var firstFlags = (tflags & 0x04) ? (q += 4, u32(u8, q - 4)) : 0;
          var pos = baseOffset + dataOffset;
          for (var i = 0; i < count; i++) {
            var sDur = (tflags & 0x100) ? (q += 4, u32(u8, q - 4)) : defDur;
            var sSize = (tflags & 0x200) ? (q += 4, u32(u8, q - 4)) : defSize;
            var sFlags = (tflags & 0x400) ? (q += 4, u32(u8, q - 4)) : (i === 0 && (tflags & 0x04) ? firstFlags : defFlags);
            var sCts = (tflags & 0x800) ? (q += 4, (u32(u8, q - 4) | 0)) : 0;
            proto.offsets.push(pos);
            proto.sizes.push(sSize);
            proto.durs.push(sDur);
            proto.ctsOff.push(sCts);
            if (sCts) proto.hasCts = true;
            // sample_flags の bit16 が「非キーフレーム」
            var isKey = !((sFlags >> 16) & 0x1);
            proto.sync.push(isKey ? 1 : 0);
            if (!isKey) proto.hasSync = true;
            pos += sSize;
          }
        });
      });
    }

    // ファイル全体を舐めて moof を集める。moof の中身は最大数MBずつ読む
    var pos = 0;
    function step() {
      return reader.read(pos, 16).then(function (h) {
        if (h.length < 8) return finish();
        var size = u32(h, 0);
        var type = TXT.decode(h.subarray(4, 8));
        var boxSize = size === 1 ? u64(h, 8) : (size === 0 ? reader.size - pos : size);
        if (type === 'moof') {
          var moofFileOffset = pos;
          return reader.read(pos, boxSize).then(function (mb) {
            readMoof(mb, 0, mb.length, moofFileOffset);
            pos += boxSize;
            return pos < reader.size ? step() : finish();
          });
        }
        pos += boxSize;
        if (pos >= reader.size || boxSize < 8) return finish();
        return step();
      });
    }
    function finish() {
      // protoSeq は moov の順。moof が結び付いた（サンプルの入った）ものだけ使う
      var tracks = protoSeq.filter(function (t) { return t.sizes.length > 0; });
      tracks.forEach(function (t) {
        t.count = t.sizes.length;
        if (!t.hasCts) t.ctsOff = null;
        if (!t.hasSync) t.sync = null;    // 全部キーフレーム扱い
        var dts = new Array(t.count), acc = 0, keyTimes = [];
        for (var i = 0; i < t.count; i++) {
          dts[i] = acc;
          if (!t.sync || t.sync[i]) keyTimes.push(acc / t.timescale);
          acc += t.durs[i];
        }
        t.dts = dts; t.duration = acc / t.timescale; t.keyTimes = keyTimes;
      });
      var video = tracks.filter(function (t) { return t.kind === 'video'; })[0] || null;
      var audio = tracks.filter(function (t) { return t.kind === 'audio'; })[0] || null;
      if (!video) throw new Error('映像が見つかりませんでした');
      return { video: video, audio: audio, reader: reader };
    }
    return step();
  }

  function parse(reader) {
    var pre = reader.init ? reader.init() : Promise.resolve();
    return pre.then(function () { return locateMoov(reader); })
      .then(function (loc) {
        if (loc.size > 64 * 1024 * 1024) throw new Error('目次が大きすぎます');
        return reader.read(loc.offset, loc.size);
      })
      .then(function (moov) {
        // 断片化MP4（mvex あり）は、コマの表が本文に散っているので別処理
        if (findBox(moov, 8, moov.length, 'mvex')) {
          return parseFragmented(reader, moov);
        }
        var tracks = [];
        walkBoxes(moov, 8, moov.length, function (type, s, e) {
          if (type !== 'trak') return;
          var t = parseTrack(moov, s, e);
          if (t && t.count > 0) tracks.push(t);
        });
        var video = tracks.filter(function (t) { return t.kind === 'video'; })[0] || null;
        var audio = tracks.filter(function (t) { return t.kind === 'audio'; })[0] || null;
        if (!video) throw new Error('映像が見つかりませんでした');
        return { video: video, audio: audio, reader: reader };
      });
  }

  /* ---------- 切り出しの範囲を決める ----------
     映像は「キーフレームから」しか切れない（そこからしか絵を組み立てられない）。
     開始は指定時刻の直前のキーフレームへ丸める。 */
  function cutVideo(track, inSec, outSec) {
    var ts = track.timescale;
    var start = 0;
    for (var i = 0; i < track.count; i++) {
      if ((!track.sync || track.sync[i]) && track.dts[i] <= inSec * ts + 1) start = i;
      if (track.dts[i] > inSec * ts) break;
    }
    var end = track.count;
    for (i = start + 1; i < track.count; i++) {
      if (track.dts[i] >= outSec * ts - 1) { end = i; break; }
    }
    if (end <= start) end = Math.min(start + 1, track.count);
    return {
      start: start, end: end,
      actualIn: track.dts[start] / ts,
      actualOut: end < track.count ? track.dts[end] / ts : track.duration
    };
  }

  // 音声は映像に合わせた窓で。端は一番近い区切りに寄せる（±12ms程度）
  function cutAudio(track, inSec, outSec) {
    var ts = track.timescale;
    var start = 0, best = Infinity;
    for (var i = 0; i < track.count; i++) {
      var d = Math.abs(track.dts[i] - inSec * ts);
      if (d < best) { best = d; start = i; }
      if (track.dts[i] > inSec * ts) break;
    }
    var want = (outSec - inSec) * ts;
    var end = start, acc = 0;
    while (end < track.count && acc + track.durs[end] / 2 < want) { acc += track.durs[end]; end++; }
    return { start: start, end: Math.max(end, start) };
  }

  /* ---------- 書き出し ---------- */
  function be32(v) { return [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255]; }
  function be16(v) { return [v >>> 8 & 255, v & 255]; }
  function str(s4) { return [s4.charCodeAt(0), s4.charCodeAt(1), s4.charCodeAt(2), s4.charCodeAt(3)]; }
  function box(type, payloadArrays) {
    var len = 8;
    payloadArrays.forEach(function (a) { len += a.length; });
    var out = new Uint8Array(len);
    out.set(be32(len), 0); out.set(str(type), 4);
    var o = 8;
    payloadArrays.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function full(type, ver, flags, payloadArrays) {
    return box(type, [[ver, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255]].concat(payloadArrays));
  }
  function runs(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (out.length && out[out.length - 1][1] === arr[i]) out[out.length - 1][0]++;
      else out.push([1, arr[i]]);
    }
    return out;
  }

  /* tracks: [{ stsdBytes, timescale, samples:[{size, dur, ctsOff, sync, off?}], kind, width, height }]
     partsOf(trackIndex, sampleIndex) -> Blob/Uint8Array …中身のかけら
     戻り値: Blob（video/mp4） */
  function buildMp4(tracks, partsOf, onProgress) {
    // 出力の並び: 時刻順に映像と音声を混ぜる（再生しながら読める形）
    var order = [];
    tracks.forEach(function (t, ti) {
      var dts = 0;
      t.samples.forEach(function (s, si) {
        order.push({ t: ti, i: si, at: dts / t.timescale });
        dts += s.dur;
      });
      t._durUnits = dts;
    });
    order.sort(function (a, b) { return a.at - b.at || a.t - b.t; });

    function buildMoov(offsetsPerTrack) {
      var movieTs = 1000;
      var movieDur = 0;
      tracks.forEach(function (t) {
        movieDur = Math.max(movieDur, Math.round(t._durUnits / t.timescale * movieTs));
      });
      var mvhd = full('mvhd', 0, 0, [
        be32(0), be32(0), be32(movieTs), be32(movieDur),
        be32(0x00010000), be16(0x0100), be16(0),
        be32(0), be32(0),
        be32(0x00010000), be32(0), be32(0), be32(0), be32(0x00010000), be32(0), be32(0), be32(0), be32(0x40000000),
        be32(0), be32(0), be32(0), be32(0), be32(0), be32(0),
        be32(tracks.length + 1)
      ]);

      var traks = tracks.map(function (t, ti) {
        var isV = t.kind === 'video';
        var tkDur = Math.round(t._durUnits / t.timescale * movieTs);
        /* tkhd の並びは決まっている。1つでもずれると iPhone / Mac の再生機構が
           「開けない」と言って丸ごと拒否するので、項目を省略しないこと。
           作成/更新/ID/予備/長さ → 予備8 → 層・組・音量・予備 → 行列36 → 幅・高さ */
        var tkhd = full('tkhd', 0, 3, [
          be32(0), be32(0), be32(ti + 1), be32(0), be32(tkDur),
          be32(0), be32(0),
          be16(0), be16(0), be16(isV ? 0 : 0x0100), be16(0),
          be32(0x00010000), be32(0), be32(0), be32(0), be32(0x00010000), be32(0), be32(0), be32(0), be32(0x40000000),
          be32(isV ? (t.width << 16) : 0), be32(isV ? (t.height << 16) : 0)
        ]);
        var mdhd = full('mdhd', 0, 0, [
          be32(0), be32(0), be32(t.timescale), be32(t._durUnits), be16(0x55C4), be16(0)
        ]);
        var name = isV ? 'VideoHandler' : 'SoundHandler';
        var hdlr = full('hdlr', 0, 0, [
          be32(0), str(isV ? 'vide' : 'soun'), be32(0), be32(0), be32(0),
          Array.from(new TextEncoder().encode(name)), [0]
        ]);
        var mhd = isV
          ? full('vmhd', 0, 1, [be16(0), be16(0), be16(0), be16(0)])
          : full('smhd', 0, 0, [be16(0), be16(0)]);
        var dinf = box('dinf', [full('dref', 0, 0, [be32(1), full('url ', 0, 1, [])])]);

        var durList = t.samples.map(function (s) { return s.dur; });
        var stts = full('stts', 0, 0, [be32(runs(durList).length)].concat(
          runs(durList).map(function (r) { return be32(r[0]).concat(be32(r[1])); })));

        var stblKids = [t.stsdBytes, stts];

        var hasCts = t.samples.some(function (s) { return s.ctsOff; });
        if (hasCts) {
          // 版0は正の値しか書けないので、必要なら全体を底上げする
          var minOff = Infinity;
          t.samples.forEach(function (s) { minOff = Math.min(minOff, s.ctsOff || 0); });
          var shift = minOff < 0 ? -minOff : 0;
          var offList = t.samples.map(function (s) { return (s.ctsOff || 0) + shift; });
          stblKids.push(full('ctts', 0, 0, [be32(runs(offList).length)].concat(
            runs(offList).map(function (r) { return be32(r[0]).concat(be32(r[1])); }))));
        }

        if (isV) {
          var keys = [];
          t.samples.forEach(function (s, i) { if (s.sync) keys.push(i + 1); });
          if (keys.length && keys.length !== t.samples.length) {
            stblKids.push(full('stss', 0, 0, [be32(keys.length)].concat(keys.map(be32))));
          }
        }

        stblKids.push(full('stsc', 0, 0, [be32(1), be32(1), be32(1), be32(1)]));
        stblKids.push(full('stsz', 0, 0, [be32(0), be32(t.samples.length)].concat(
          t.samples.map(function (s) { return be32(s.size); }))));
        var co = offsetsPerTrack[ti];
        stblKids.push(full('co64', 0, 0, [be32(co.length)].concat(
          co.map(function (v) { return be32(Math.floor(v / 4294967296)).concat(be32(v >>> 0)); }))));

        var stbl = box('stbl', stblKids);
        var minf = box('minf', [mhd, dinf, stbl]);
        var mdia = box('mdia', [mdhd, hdlr, minf]);
        return box('trak', [tkhd, mdia]);
      });

      return box('moov', [mvhd].concat(traks));
    }

    var ftyp = box('ftyp', [str('isom'), be32(512), str('isom'), str('iso2'), str('avc1'), str('mp41')]);

    // 1回目: 位置ゼロで組んで moov の大きさだけ知る
    var zeroOffsets = tracks.map(function (t) { return t.samples.map(function () { return 0; }); });
    var moovLen = buildMoov(zeroOffsets).length;

    var mdatPayload = 0;
    tracks.forEach(function (t) { t.samples.forEach(function (s) { mdatPayload += s.size; }); });
    var mdatHeaderLen = 16;                        // 64bit の大きさで書く
    var base = ftyp.length + moovLen + mdatHeaderLen;

    // 2回目: 本当の位置を入れて組み直す（大きさは1回目と同じになる）
    var offsets = tracks.map(function (t) { return new Array(t.samples.length); });
    var cursor = base;
    order.forEach(function (o) {
      offsets[o.t][o.i] = cursor;
      cursor += tracks[o.t].samples[o.i].size;
    });
    var moov = buildMoov(offsets);
    if (moov.length !== moovLen) throw new Error('内部エラー: 目次の大きさが揃いません');

    var mdatSize = mdatHeaderLen + mdatPayload;
    var mdatHeader = new Uint8Array(16);
    mdatHeader.set(be32(1), 0); mdatHeader.set(str('mdat'), 4);
    mdatHeader.set(be32(Math.floor(mdatSize / 4294967296)), 8);
    mdatHeader.set(be32(mdatSize >>> 0), 12);

    // 中身を順に集める。Blob の部品として持てば、全体をメモリに並べずに済む
    var parts = [ftyp, moov, mdatHeader];
    var done = 0, total = order.length;
    function next(idx) {
      if (idx >= order.length) {
        return Promise.resolve(new Blob(parts, { type: 'video/mp4' }));
      }
      var o = order[idx];
      return Promise.resolve(partsOf(o.t, o.i)).then(function (piece) {
        parts.push(piece);
        done++;
        if (onProgress && (done % 200 === 0 || done === total)) onProgress(done / total);
        return next(idx + 1);
      });
    }
    return next(0);
  }

  /* ---------- 作り直し（再エンコード）用の道具 ----------
     無劣化のときは stsd をまるごと写せばよいが、作り直したときは
     中身が変わるので「これはこういう映像です」という説明書きを
     こちらで組み立て直す必要がある。 */

  /* 元の stsd から、ブラウザの復号器に渡す設定を取り出す。
     description は avcC / hvcC / esds の中身そのもの。 */
  function codecConfigFrom(track) {
    var u8 = track.stsdBytes;
    // stsdBytes は stsd 箱の先頭から。中の最初の sample entry を探す
    var entryStart = 8 + 4 + 4;      // 箱ヘッダ8 + version/flags4 + entry_count4
    var entryEnd = u8.length;
    var type = TXT.decode(u8.subarray(entryStart + 4, entryStart + 8));
    var kid = null;
    /* sample entry の中の子箱（avcC/hvcC/esds）を探す。
       固定部の長さ: 箱ヘッダ8 ＋ 共通部8 ＋ 映像70 / 音声20 */
    var payloadStart = entryStart + 8 + 8 + (track.kind === 'video' ? 70 : 20);
    walkBoxes(u8, payloadStart, entryEnd, function (t, s, e) {
      if (t === 'avcC' || t === 'hvcC' || t === 'esds') kid = { type: t, start: s, end: e };
    });
    if (!kid) return null;
    var desc = u8.slice(kid.start, kid.end);

    if (kid.type === 'avcC') {
      var hex = [desc[1], desc[2], desc[3]].map(function (b) {
        return (b < 16 ? '0' : '') + b.toString(16);
      }).join('');
      return { codec: 'avc1.' + hex, description: desc };
    }
    if (kid.type === 'hvcC') {
      // HEVC は文字列が複雑。よくある形（Main profile）で組む
      return { codec: 'hvc1.1.6.L93.B0', description: desc };
    }
    // esds の中の DecoderSpecificInfo（AACの設定）だけ取り出す
    var asc = findDescriptor(desc, 0x05);
    /* 音の「1秒あたりの本数（サンプリング周波数）」と「何チャンネルか」。
       時間の刻み（mdhd の timescale）と同じとは限らないので、
       sample entry の中の値と、AACの設定そのものから読む。 */
    var chs = (u8[entryStart + 24] << 8) | u8[entryStart + 25];
    var sr = (u8[entryStart + 32] << 8) | u8[entryStart + 33];
    var fromAsc = ascInfo(asc);
    return {
      codec: 'mp4a.40.2', description: asc,
      sampleRate: (fromAsc && fromAsc.rate) || sr || track.timescale || 48000,
      channels: (fromAsc && fromAsc.channels) || chs || 2
    };
  }

  /* AACの設定（AudioSpecificConfig）の頭を読む。
     5ビット: 種類 / 4ビット: 周波数の番号 / 4ビット: チャンネル構成 */
  var AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  function ascInfo(asc) {
    if (!asc || asc.length < 2) return null;
    var bitPos = 0;
    function bits(n) {
      var v = 0;
      for (var i = 0; i < n; i++) {
        var byteI = bitPos >> 3, bitI = 7 - (bitPos & 7);
        v = (v << 1) | ((asc[byteI] >> bitI) & 1);
        bitPos++;
      }
      return v;
    }
    var objType = bits(5);
    if (objType === 31) objType = 32 + bits(6);
    var freqIdx = bits(4);
    var rate = freqIdx === 15 ? bits(24) : AAC_RATES[freqIdx];
    var channels = bits(4);
    if (!rate) return null;
    return { rate: rate, channels: channels || 0, objType: objType };
  }

  // MPEG-4 の記述子（tag で探す）。長さは可変長（上位ビットが続きの印）
  function findDescriptor(u8, wantTag) {
    var i = 4;   // esds の version/flags を飛ばす
    function walk(start, end) {
      var p = start;
      while (p < end) {
        var tag = u8[p++];
        var len = 0, b;
        do { b = u8[p++]; len = (len << 7) | (b & 0x7f); } while (b & 0x80);
        if (tag === wantTag) return u8.slice(p, p + len);
        // ES_Descriptor(3) と DecoderConfig(4) は中に入れ子がある
        if (tag === 0x03) {
          var q = p + 3;                      // ES_ID(2) + flags(1)
          var r = walk(q, p + len); if (r) return r;
        } else if (tag === 0x04) {
          var q2 = p + 13;                    // objectType(1)+streamType等(12)
          var r2 = walk(q2, p + len); if (r2) return r2;
        }
        p += len;
      }
      return null;
    }
    return walk(i, u8.length);
  }

  /* 作り直した映像用の説明書き（stsd）を組み立てる。
     description はブラウザの符号器がくれる avcC の中身。 */
  function buildVideoStsd(width, height, description) {
    var name = new Uint8Array(32);   // compressorname（32バイト固定・空でよい）
    var entry = box('avc1', [
      [0, 0, 0, 0, 0, 0], be16(1),                       // reserved + data_reference_index
      be16(0), be16(0), be32(0), be32(0), be32(0),       // pre_defined / reserved
      be16(width), be16(height),
      be32(0x00480000), be32(0x00480000),                // 72dpi
      be32(0), be16(1),                                  // reserved, frame_count
      name, be16(0x0018), be16(0xFFFF),                  // depth, pre_defined(-1)
      box('avcC', [description])
    ]);
    return full('stsd', 0, 0, [be32(1), entry]);
  }

  /* 作り直した音声用の説明書き（stsd）。AAC の設定は esds に包む必要がある。 */
  function buildAudioStsd(sampleRate, channels, asc) {
    // 記述子は「タグ＋長さ＋中身」。長さは127以下なら1バイトで書ける
    function desc(tag, body) {
      var out = [tag];
      var len = body.length;
      if (len < 128) out.push(len);
      else { out.push(0x80 | ((len >> 7) & 0x7f), len & 0x7f); }
      return out.concat(Array.from(body));
    }
    var dsi = desc(0x05, asc);                                  // DecoderSpecificInfo
    // 種類(AAC)＋音声ストリーム＋緩衝の大きさ＋最大/平均ビットレート
    var br = 128000;
    var dcd = desc(0x04, [0x40, 0x15,
      0x00, 0x18, 0x00,                                         // bufferSizeDB
      (br >>> 24) & 255, (br >>> 16) & 255, (br >>> 8) & 255, br & 255,
      (br >>> 24) & 255, (br >>> 16) & 255, (br >>> 8) & 255, br & 255
    ].concat(dsi));
    var sl = desc(0x06, [0x02]);
    var es = desc(0x03, [0, 1, 0].concat(dcd, sl));             // ES_ID=1, flags=0
    var esds = full('esds', 0, 0, [es]);

    var entry = box('mp4a', [
      [0, 0, 0, 0, 0, 0], be16(1),
      be32(0), be32(0),
      be16(channels), be16(16),
      be16(0), be16(0),
      be32(Math.round(sampleRate) << 16 >>> 0),
      esds
    ]);
    return full('stsd', 0, 0, [be32(1), entry]);
  }

  global.MP4 = {
    readerForFile: readerForFile,
    readerForUrl: readerForUrl,
    parse: parse,
    cutVideo: cutVideo,
    cutAudio: cutAudio,
    buildMp4: buildMp4,
    codecConfigFrom: codecConfigFrom,
    buildVideoStsd: buildVideoStsd,
    buildAudioStsd: buildAudioStsd
  };
})(window);
