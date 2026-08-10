/* ============================================================
   qr.js — QRコードを自分で描く
   ------------------------------------------------------------
   受け取りURLをスマホに渡すために使う。外から部品を読み込めない
   （このサイトは外部スクリプトを一切読まない方針）ので、規格どおりに
   自分で組み立てる。作れるのは「バイトモード・誤り訂正M・型番1〜10」まで。
   URL は長くても200文字ほどなので、これで足りる。

   使い方: qrSvg('https://...') → <svg> の文字列
   ============================================================ */

/* 型番ごとの決まり（誤り訂正 M のときだけ）。
   [データ語数, 1ブロックあたりの訂正語数, 組1のブロック数, 組1のデータ語数,
    組2のブロック数, 組2のデータ語数] */
const SPEC_M = {
  1: [16, 10, 1, 16, 0, 0],
  2: [28, 16, 1, 28, 0, 0],
  3: [44, 26, 1, 44, 0, 0],
  4: [64, 18, 2, 32, 0, 0],
  5: [86, 24, 2, 43, 0, 0],
  6: [108, 16, 4, 27, 0, 0],
  7: [124, 18, 4, 31, 0, 0],
  8: [154, 22, 2, 38, 2, 39],
  9: [182, 22, 3, 36, 2, 37],
  10: [216, 26, 4, 43, 1, 44]
};

// 位置合わせパターンの中心座標（型番ごと）
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

// 形式情報（誤り訂正M＋マスク番号）。規格の表そのまま
const FORMAT_M = [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0];
// 型番情報（型番7以上だけ入れる）
const VERSION_BITS = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };

/* ガロア体 GF(256) の掛け算表。誤り訂正の計算に要る */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// 訂正語を作るための割る数（生成多項式）
function rsPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// データ語から訂正語を計算する
function ecc(data, n) {
  const gen = rsPoly(n);
  const rem = new Array(data.length + n).fill(0);
  for (let i = 0; i < data.length; i++) rem[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const factor = rem[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) rem[i + j] ^= gmul(gen[j], factor);
  }
  return rem.slice(data.length);
}

/* 文字列を UTF-8 のバイト列にする。QRの「バイトモード」はこれを入れる */
function utf8(s) {
  return Array.from(new TextEncoder().encode(s));
}

// 収まる一番小さい型番を選ぶ
function pickVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const [dataWords] = SPEC_M[v];
    const countBits = v <= 9 ? 8 : 16;
    // 4bit(モード) + 文字数 + 本体
    if (4 + countBits + len * 8 <= dataWords * 8) return v;
  }
  return 0;   // 入らない
}

// ビット列を組み立てて、ブロックに分けて訂正語を付け、並べ替える
function makeCodewords(bytes, version) {
  const [dataWords, ecPer, g1, d1, g2, d2] = SPEC_M[version];
  const countBits = version <= 9 ? 8 : 16;

  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);              // バイトモード
  push(bytes.length, countBits);
  bytes.forEach((b) => push(b, 8));
  // 終端（入るだけ）
  for (let i = 0; i < 4 && bits.length < dataWords * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  // 余りは決められた2種類の詰め物で埋める
  const pads = [0xEC, 0x11];
  for (let i = 0; bits.length < dataWords * 8; i++) push(pads[i % 2], 8);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    words.push(b);
  }

  // ブロックに分ける
  const blocks = [];
  let at = 0;
  for (let i = 0; i < g1; i++) { blocks.push(words.slice(at, at + d1)); at += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(words.slice(at, at + d2)); at += d2; }
  const eccs = blocks.map((b) => ecc(b, ecPer));

  // 交互に並べ替える（規格どおり）
  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const e of eccs) out.push(e[i]);
  }
  return out;
}

/* 升目を作る。値: null=まだ、0=白、1=黒。fixed は「動かせない場所」の印 */
function makeMatrix(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, v) => { m[r][c] = v; fixed[r][c] = true; };

  // 位置検出パターン（3隅）と、そのまわりの余白
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, on ? 1 : 0);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // タイミングパターン（点線）
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // 位置合わせパターン
  const cs = ALIGN[version];
  for (const r0 of cs) {
    for (const c0 of cs) {
      // 位置検出パターンと重なるところには置かない
      if ((r0 <= 8 && c0 <= 8) || (r0 <= 8 && c0 >= size - 9) || (r0 >= size - 9 && c0 <= 8)) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          set(r0 + r, c0 + c, on ? 1 : 0);
        }
      }
    }
  }

  // 必ず黒にする1マス
  set(size - 8, 8, 1);

  // 形式情報の場所を先に押さえる（中身はあとで入れる）
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) set(8, i, 0);
    if (m[i][8] === null) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) set(8, size - 1 - i, 0);
    if (m[size - 1 - i][8] === null) set(size - 1 - i, 8, 0);
  }

  // 型番情報（7以上）
  if (version >= 7) {
    const bits = VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), b);
      set(size - 11 + (i % 3), Math.floor(i / 3), b);
    }
  }
  return { m, fixed, size };
}

// データを右下から蛇行して詰める
function placeData(m, fixed, size, words) {
  const bits = [];
  words.forEach((w) => { for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1); });
  let bi = 0, up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;            // タイミングの列は飛ばす
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (fixed[row][c]) continue;
        m[row][c] = bi < bits.length ? bits[bi++] : 0;
      }
    }
    up = !up;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

// 読み取りにくい並びに罰点を付ける。一番低いマスクを選ぶ
function penalty(m, size) {
  let p = 0;
  // 同じ色が5つ以上続く
  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let last = -1, len = 0;
      for (let b = 0; b < size; b++) {
        const v = get(a, b);
        if (v === last) { len++; if (len === 5) p += 3; else if (len > 5) p += 1; }
        else { last = v; len = 1; }
      }
    }
  };
  run((a, b) => m[a][b]);
  run((a, b) => m[b][a]);
  // 2x2 の同色
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }
  // 位置検出パターンに似た並び
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const rev = pat.slice().reverse();
  const match = (get, a, b) => {
    for (let i = 0; i < 11; i++) if (get(a, b + i) !== pat[i]) return false;
    return true;
  };
  const matchR = (get, a, b) => {
    for (let i = 0; i < 11; i++) if (get(a, b + i) !== rev[i]) return false;
    return true;
  };
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 11 <= size; b++) {
      if (match((x, y) => m[x][y], a, b) || matchR((x, y) => m[x][y], a, b)) p += 40;
      if (match((x, y) => m[y][x], a, b) || matchR((x, y) => m[y][x], a, b)) p += 40;
    }
  }
  // 白黒の偏り
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return p;
}

/* 形式情報（誤り訂正の種類とマスク番号）を2か所に置く。
   置き場所は規格で1マスずつ決まっていて、ここを間違えると
   「見た目はQRなのに1つも読めない」になる（実際になった）。 */
function putFormat(m, size, mask) {
  const bits = FORMAT_M[mask];
  for (let i = 0; i < 15; i++) {
    const b = (bits >> i) & 1;
    // 縦向きの並び（左上の縦 → 左下）
    if (i < 6) m[i][8] = b;
    else if (i < 8) m[i + 1][8] = b;
    else m[size - 15 + i][8] = b;
    // 横向きの並び（右上 → 左上の横）
    if (i < 8) m[8][size - 1 - i] = b;
    else if (i === 8) m[8][7] = b;
    else m[8][14 - i] = b;
  }
}

/* 文字列からQRコードのSVGを作る。入らない長さなら null を返す。 */
export function qrSvg(text, opts) {
  const o = opts || {};
  const bytes = utf8(String(text));
  const version = pickVersion(bytes.length);
  if (!version) return null;

  const words = makeCodewords(bytes, version);
  const { m, fixed, size } = makeMatrix(version);
  placeData(m, fixed, size, words);

  // 8通りのマスクを試して、一番読み取りやすいものを選ぶ
  let best = null, bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    const t = m.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!fixed[r][c] && MASKS[k](r, c)) t[r][c] ^= 1;
      }
    }
    putFormat(t, size, k);
    const p = penalty(t, size);
    if (p < bestP) { bestP = p; best = t; }
  }

  // まわりの余白は規格で4マス以上と決まっている（これが無いと読めない）
  const quiet = 4;
  const total = size + quiet * 2;
  const fg = o.fg || '#060608';
  const bg = o.bg || '#ffffff';
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (best[r][c]) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" '
    + 'shape-rendering="crispEdges" role="img" aria-label="受け取りURLのQRコード">'
    + '<rect width="' + total + '" height="' + total + '" fill="' + bg + '"/>'
    + '<path d="' + d + '" fill="' + fg + '"/></svg>';
}
