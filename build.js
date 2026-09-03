#!/usr/bin/env node
/**
 * 静的サイトビルド:
 *   src/data.json（ソースオブトゥルース）+ src/templates + src/partials
 *   → dist/（コンテンツを HTML に焼き込んだ静的サイト。AI クローラーは JS を実行しないため）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data.json'), 'utf8'));
const SITE = data.site.url; // https://tsutsumufunakoshi.com

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

/* ---------------- 文言（テンプレート内の見出し・本文） ----------------
   テンプレートに直接書いていた日本語は data.json の texts に移してある。
   テンプレート側は {{T:works.h1}} のように書き、ここで差し替える。
   こうしておくと /admin の「文章」タブから本人が書き換えられる。
   改行はそのまま <br> になるので、見出しの折り返し位置も指定できる。  */
const usedTextKeys = new Set();
const missingTextKeys = [];

function textOf(key) {
  usedTextKeys.add(key);
  const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data.texts);
  if (typeof v !== 'string') { missingTextKeys.push(key); return ''; }
  return escLines(v);
}

function resolveTexts(html) {
  return html.replace(/\{\{T:([A-Za-z0-9_.]+)\}\}/g, (_, key) => textOf(key));
}

/* 使われていない文言が残っていると、編集画面に「直しても何も変わらない欄」が
   できてしまう。ビルドのたびに知らせる（消し忘れに気づけるように）。 */
function reportUnusedTextKeys() {
  const all = [];
  const walk = (o, prefix) => Object.entries(o || {}).forEach(([k, v]) => {
    if (v && typeof v === 'object') walk(v, prefix + k + '.');
    else all.push(prefix + k);
  });
  walk(data.texts, '');
  /* ホームは2つの見せ方があり、いま作っていない方の文言は当然「使われていない」。
     それを毎回並べると本当の消し忘れが埋もれるので、ホームの文言だけ除く。 */
  const otherHome = homeStyle === 'classic';
  // brand 版の本文は Story ページでも使うので、ホームにしか無い枠（掲載・新着）だけ除く
  const homeOnly = (k) => k.startsWith('index.media.') || k.startsWith('index.news.');
  const unused = all.filter((k) => !usedTextKeys.has(k) && !(otherHome && homeOnly(k)));
  if (unused.length) console.warn(`注意: どこにも使われていない文言 ${unused.length}件: ${unused.join(', ')}`);
}

/* ---------------- partials ---------------- */

/* prefix は「そのページから見たサイト直下までの戻り道」。直下のページは ''、
   udon/ の中の詳細ページは '../'。ナビとフッターは全ページ共通なので、
   リンク先をここで補正しないと階層の違うページからリンクが切れる。 */
function navHtml(active, isHome, prefix = '') {
  const on = '#f4f4f5';
  // 選択中との差は残しつつ、単体でも十分読める明るさにする
  const off = '#d8d8da';
  return read('partials/nav.html')
    .replaceAll('{{P}}', prefix)
    .replaceAll('{{HOME_HREF}}', isHome ? '#top' : prefix + 'index.html')
    .replace('{{C_HOME}}', active === 'Home' ? on : off)
    .replace('{{C_ABOUT}}', active === 'About' ? on : off)
    .replace('{{C_RESEARCH}}', active === 'Research' ? on : off)
    .replace('{{C_WORKS}}', active === 'Works' ? on : off)
    .replace('{{C_ARCHIVE}}', active === 'Archive' ? on : off)
    .replace('{{C_HENRO}}', active === 'Henro' ? on : off)
    .replace('{{C_CONTACT}}', active === 'Contact' ? on : off);
}

function footerHtml(isHome, prefix = '') {
  return read('partials/footer.html')
    .replaceAll('{{P}}', prefix)
    .replaceAll('{{HOME_HREF}}', isHome ? '#top' : prefix + 'index.html');
}

/* ---------------- head / meta / JSON-LD ---------------- */

const personLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: '船越温',
  alternateName: 'Tsutsumu Funakoshi',
  url: SITE + '/',
  email: 'mailto:' + data.contact.email,
  affiliation: { '@type': 'EducationalOrganization', name: '香川県立高松高等学校' },
  award: data.research.awards.map((a) => a.name),
  sameAs: [
    'https://x.com/funa_sun273',
    'https://github.com/funasun/',
    'https://www.instagram.com/funa_sun273/'
  ],
  /* 取り上げられた記事・番組。検索エンジンや AI に「第三者がこの人物を
     どう扱ったか」を伝える枠。自己申告の経歴より重みを持つ情報になる。 */
  subjectOf: (data.media || []).map((m) => {
    const w = {
      '@type': m.kind === 'テレビ' ? 'CreativeWork' : 'NewsArticle',
      name: m.title,
      datePublished: String(m.date || '').replaceAll('.', '-'),
      about: { '@type': 'Person', name: '船越温' }
    };
    if (m.url) w.url = m.url;
    if (m.outlet) w.publisher = { '@type': 'Organization', name: m.outlet };
    return w;
  })
};

function headHtml({ title, desc, canonicalPath, extraLd, prefix = '', ogImage }) {
  const url = SITE + canonicalPath;
  const lds = [personLd].concat(extraLd || []);
  const ldTags = lds
    .map((ld) => `<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
    .join('\n');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(data.site.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage ? SITE + '/' + ogImage : SITE + '/images/og.png'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#060608">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Noto+Serif+JP:wght@500;600&family=Noto+Sans+JP:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${prefix}css/site.css">
${ldTags}
<noscript><style>
/* JS なし環境の保険: 演出を止めて、全コンテンツを縦に流して読めるようにする */
[data-reveal] { opacity: 1 !important; transform: none !important; }
[data-scene] { height: auto !important; }
[data-scene] > div { display: block !important; overflow: visible !important; padding: 8vh 7vw !important; }
[data-scene] > div, [data-scene] > div * { position: static !important; height: auto !important; opacity: 1 !important; transform: none !important; }
[data-scene] > div > * { margin: 22px auto !important; max-width: 760px; }
.nav-links { display: flex !important; }
.nav-burger { display: none !important; }
.acc-body { display: block !important; }
</style></noscript>`;
}

/* ---------------- fragments ---------------- */

function gameTiles() {
  // Home の帯カード: 同名の worksItems から liveUrl を探してリンクにする。
  // 見つからなければ Works ページへ誘導（クリックしても何も起きない、を防ぐ）
  return data.home.gameTiles.map((g) => {
    const work = data.worksItems.find((w) => w.title === g.title);
    const url = (work && work.liveUrl) || '';
    const linkAttrs = url ? `href="${esc(url)}" target="_blank" rel="noopener"` : 'href="works.html"';
    const thumb = (work && work.thumbnail)
      ? `<img src="${esc(work.thumbnail)}" alt="${esc(g.title)}のスクリーンショット" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11.5px ui-monospace, Menlo, monospace; color: #c4c4c6">app screenshot</span>`;
    return `      <a ${linkAttrs} class="gcard" style="--tilt: ${g.tilt}; flex: none; width: clamp(240px, 24vw, 360px); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; display: block; text-decoration: none; color: #f4f4f5">
        <div style="aspect-ratio: 16 / 10; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
          ${thumb}
        </div>
        <div style="padding: 16px 18px 20px">
          <h3 style="margin: 0 0 5px; font: 500 15px 'Noto Sans JP', sans-serif">${esc(g.title)}</h3>
          <p style="margin: 0; font: 400 14px/1.7 'Noto Sans JP', sans-serif; color: #cfcfd1">${esc(g.desc)}</p>
        </div>
      </a>`;
  }).join('\n');
}

function newsRows() {
  return data.home.newsItems.map((n) => `    <a href="archive.html" data-reveal data-m="wrap" class="hbg" style="display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; border-top: 1px solid rgba(255,255,255,.1); text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .08em; color: #cfcfd1; white-space: nowrap">${esc(n.date)}</span>
      <span style="flex: none; font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #d8d8da">${esc(n.cat)}</span>
      <span style="flex: 1; font: 400 17px/1.7 'Noto Sans JP', sans-serif">${esc(n.title)}</span>
      <span style="color: var(--accent-text, #adbcff)">→</span>
    </a>`).join('\n');
}

// " / " 区切りの値は、各項目を折り返し禁止にして区切りでのみ改行させる
// （モバイルで「ヴァイオリン」等が単語の途中で不自然に折り返すのを防ぐ）
function metaValue(v) {
  if (v.indexOf(' / ') === -1) return esc(v);
  return v
    .split(' / ')
    .map((s) => `<span style="white-space: nowrap">${esc(s)}</span>`)
    .join('<span style="color: #c4c4c6"> / </span>');
}

function metaRows() {
  return data.about.meta.map((m) => `    <div data-reveal data-m="stack6" class="rline" style="position: relative; display: grid; grid-template-columns: 160px 1fr; gap: 24px; padding: 20px 6px; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
      <span style="font: 500 13px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: #cfcfd1">${esc(m.label)}</span>
      <span style="font: 400 16px/1.75 'Noto Sans JP', sans-serif; color: #e2e2e4">${metaValue(m.value)}</span>
    </div>`).join('\n');
}

function timelineItems() {
  return data.about.timeline.map((t) => `      <div data-reveal style="position: relative; display: flex; align-items: baseline; gap: 26px; flex-wrap: wrap; opacity: calc(var(--r, 0)); transform: translateX(calc((1 - var(--r, 0)) * 24px)); transition: opacity .9s ease, transform .9s cubic-bezier(.2,.7,.2,1)">
        <span style="position: absolute; left: -36px; top: 6px; width: 11px; height: 11px; border-radius: 50%; background: #0c0c10; border: 1.5px solid rgba(111,140,255,.8)"></span>
        <span style="font: 500 15px 'EB Garamond', serif; letter-spacing: .1em; color: #cfcfd1; width: 90px; white-space: nowrap">${esc(t.year)}</span>
        <span style="flex: 1; min-width: 240px; font: 400 17px/1.7 'Noto Sans JP', sans-serif">${esc(t.label)}</span>
      </div>`).join('\n');
}

function aboutVideo() {
  const v = (data.about && data.about.video) || {};
  if (!v.ytid) return '';
  // 軽量埋め込み: 普段はポスター画像＋再生ボタンだけ（画像1枚分の重さ）。
  // クリックした瞬間に site.js が youtube-nocookie の iframe に差し替える。
  return `<section data-reveal style="padding: 0 7vw 16vh; max-width: 1080px; margin: 0 auto; box-sizing: border-box; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
  <p style="margin: 0 0 34px; font: 500 12px 'EB Garamond', serif; letter-spacing: .4em; text-transform: uppercase; color: #cfcfd1">Music — 演奏</p>
  <div class="yt-lite" data-ytid="${esc(v.ytid)}"${ytStartAttr(v.ytstart)} data-title="${esc(v.title || '')}" style="background-image: linear-gradient(rgba(6,6,8,.05), rgba(6,6,8,.45)), url('${esc(v.poster || '')}')">
    <button class="yt-play" type="button" aria-label="演奏動画を再生"></button>
  </div>
  <p style="margin: 16px 0 0; font: 400 12.5px ui-monospace, Menlo, monospace; color: #c4c4c6">${esc(v.caption || '')}</p>
</section>`;
}

function statCards() {
  return data.research.stats.map((s) => `    <div data-reveal data-m="statrow" style="padding: 34px 32px 30px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: linear-gradient(160deg, #0c0c11, #08080b); opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 26px)); transition: opacity 1s ease, transform 1s ease">
      <div style="display: flex; align-items: baseline; gap: 4px">
        <span data-count="${s.value}" style="font: 500 clamp(44px, 4.2vw, 64px)/1 'EB Garamond', serif">${s.value.toLocaleString('ja-JP')}</span>
        <span style="font: 500 18px 'Noto Sans JP', sans-serif; color: #d8d8da">${esc(s.suffix)}</span>
      </div>
      <p style="margin: 14px 0 0; font: 400 15px/1.7 'Noto Sans JP', sans-serif; color: #cfcfd1">${esc(s.label)}</p>
    </div>`).join('\n');
}

function storyParas() {
  return data.research.story.map((p) => `    <p data-reveal style="margin: 0; font: 400 17px/1.8 'Noto Sans JP', sans-serif; color: #e2e2e4; max-width: 34em; text-wrap: pretty; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">${esc(p)}</p>`).join('\n');
}

function keywordChips() {
  return data.research.keywords.map((kw) => `    <span style="font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .1em; padding: 6px 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #d8d8da">${esc(kw)}</span>`).join('\n');
}

function awardRows() {
  return data.research.awards.map((a) => `    <a href="archive.html" data-reveal data-m="wrap" class="rline hbg" style="position: relative; display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .06em; color: #cfcfd1; white-space: nowrap; width: 100px">${esc(a.year)}</span>
      <span style="flex: 1; display: flex; flex-direction: column; gap: 3px">
        <span style="font: 400 17px/1.7 'Noto Sans JP', sans-serif">${esc(a.name)}</span>
        <span style="font: 400 12.5px 'Noto Sans JP', sans-serif; color: #cfcfd1">${esc(a.org)}</span>
      </span>
      <span style="color: var(--accent-text, #adbcff)">→</span>
    </a>`).join('\n');
}

function workCards() {
  return data.worksItems.map((w) => {
    const url = w.liveUrl || '';
    const statusStyle = w.status === 'live'
      ? "font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(111,140,255,.5); color: var(--accent-text, #adbcff)"
      : "font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); color: #cfcfd1";
    const thumb = w.thumbnail
      ? `<img src="${esc(w.thumbnail)}" alt="${esc(w.title)}のスクリーンショット" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11.5px ui-monospace, Menlo, monospace; color: #c4c4c6">app screenshot</span>`;
    // liveUrl が空の作品はリンクにしない（href="#" だと「押しても飛ばない」リンクになる）
    const tag = url ? 'a' : 'div';
    const linkAttrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener"` : '';
    return `    <${tag}${linkAttrs} data-type="${esc(w.type)}" class="wcard" style="display: block; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; text-decoration: none; color: #f4f4f5">
      <div style="aspect-ratio: 16 / 10; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
        ${thumb}
      </div>
      <div style="padding: 18px 20px 22px">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px">
          <span style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #d8d8da">${esc(w.type)}</span>
          <span style="${statusStyle}">${w.status === 'live' ? '公開中' : '開発中'}</span>
        </div>
        <h3 style="margin: 0 0 6px; font: 500 16px 'Noto Sans JP', sans-serif">${esc(w.title)}</h3>
        <p style="margin: 0; font: 400 14.5px/1.7 'Noto Sans JP', sans-serif; color: #cfcfd1">${esc(w.description)}</p>
      </div>
    </${tag}>`;
  }).join('\n');
}

/* ---------------- うどん遍路 ---------------- */

// 県内（讃岐）か県外（遠征）か。data 側は area:'遠征' のときだけ県外扱い。
function isAway(u) { return String(u.area || '').trim() === '遠征'; }

/* 同じ店に何度も行ったときは、カードを1枚にまとめて訪問履歴を積む
   （食べログの店ページと同じ考え方）。入力側は「1回＝1件」のままでよく、
   再訪したら同じ店名・同じ場所でもう1件足すだけ。店名と場所の両方で
   照合するので、チェーン店の別の支店は別の店として扱われる。          */
function shopKey(u) {
  const norm = (s) => String(s || '').trim().replace(/\s+/g, '').toLowerCase();
  return norm(u.shop) + ' ' + norm(u.town);
}

// 店ごとにまとめる。番号は初訪問の古い順（再訪しても番号がずれない）、
// 並び順は最終訪問の新しい順。
function henroShops(away) {
  const map = new Map();
  data.udonItems.filter((u) => isAway(u) === away).forEach((u) => {
    const k = shopKey(u);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(u);
  });

  const groups = Array.from(map.values()).map((list) => {
    const visits = list.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const latest = visits[visits.length - 1];
    const tags = [];
    visits.forEach((v) => (v.tags || []).forEach((t) => { if (t && tags.indexOf(t) < 0) tags.push(t); }));
    return {
      visits,
      shop: latest.shop,
      town: latest.town,
      mapQuery: latest.mapQuery,
      /* 店のかたち（セルフ／一般店／製麺所）は店の性質なので、訪問ごとに
         入れ直させない。どれか1回でも入っていればそれを店の情報として使う。 */
      shopType: visits.slice().reverse().map((v) => v.shopType).find(Boolean) || '',
      // 詳細ページの URL を手で決めたいときの逃げ道（普段は空でよい）
      slug: visits.map((v) => v.slug).find(Boolean) || '',
      tags,
      first: String(visits[0].date || ''),
      last: String(latest.date || ''),
      // 表紙の写真は「写真がある訪問のうち一番新しいもの」
      cover: visits.slice().reverse().find((v) => v.photo) || latest
    };
  });

  groups.sort((a, b) => a.first.localeCompare(b.first));
  groups.forEach((g, i) => { g._no = i + 1; });
  return groups.slice().sort((a, b) => b.last.localeCompare(a.last));
}

/* 詳細ページの URL。店名をそのまま使う（日本語のままで読める URL になる）。
   ファイル名に使えない記号だけ落とし、重複したら場所を足す。slug を手で
   入れてあればそれを優先。店名を変えると URL も変わる点だけ注意。      */
function udonSlug(g) {
  const base = String(g.slug || g.shop || '').trim()
    .replace(/[\/\\?#%:*"<>|]/g, '')
    .replace(/\s+/g, '-');
  return base || 'udon';
}

// 全店（県内＋遠征）を、詳細ページ用に URL 付きで返す。
// 何度も呼ぶので結果を覚えておく（呼ぶたびに slug が振り直されると URL がぶれる）
let _udonShops = null;
function udonShops() {
  if (_udonShops) return _udonShops;
  const all = henroShops(false).map((g) => Object.assign({}, g, { away: false }))
    .concat(henroShops(true).map((g) => Object.assign({}, g, { away: true })));
  const used = new Map();
  all.forEach((g) => {
    let s = udonSlug(g);
    if (used.has(s)) {
      const withTown = s + '-' + String(g.town || '').replace(/\s+/g, '-');
      s = used.has(withTown) ? withTown + '-' + (used.size + 1) : withTown;
    }
    used.set(s, true);
    g.slug = s;
    g.href = 'udon/' + encodeURIComponent(s) + '.html';   // 一覧から見た相対パス
    g.path = '/udon/' + encodeURIComponent(s) + '.html';   // サイト直下から見た絶対パス
    g.file = path.join('udon', s + '.html');
  });
  _udonShops = all;
  return all;
}

function henroCount(away) { return data.udonItems.filter((u) => isAway(u) === away).length; }

// 軒数（同じ店への再訪は1軒として数える）
function henroShopCount() { return henroShops(false).length + henroShops(true).length; }

// 訪問済みの市町（県内のみ）
function visitedTowns() {
  const set = new Set();
  data.udonItems.filter((u) => !isAway(u)).forEach((u) => {
    const t = String(u.town || '').trim();
    if (t) set.add(t);
  });
  return set;
}

function visitedTownCount() {
  const v = visitedTowns();
  return data.henro.kagawaTowns.filter((t) => v.has(t)).length;
}

// 香川の全17市町を並べ、訪問済みを点灯させる「制覇状況」
function henroTownMap() {
  const v = visitedTowns();
  return data.henro.kagawaTowns.map((t) => {
    const on = v.has(t);
    const style = on
      ? "font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .04em; padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(111,140,255,.55); background: rgba(111,140,255,.12); color: var(--accent-text, #adbcff)"
      : "font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .04em; padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); color: #c4c4c6";
    return `      <span style="${style}">${esc(t)}</span>`;
  }).join('\n');
}

// 絞り込みチップ。県内は市町、県外は都道府県などの場所。
// カードは店ごとに1枚なので、数え方も「軒数」に合わせる。
function henroChips(away) {
  const counts = {};
  henroShops(away).forEach((g) => {
    const t = String(g.town || '').trim();
    if (t) counts[t] = (counts[t] || 0) + 1;
  });
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'ja'));
  if (!keys.length) return '';
  return ['    <button class="chip on" data-filter="All">すべて</button>']
    .concat(keys.map((t) => `    <button class="chip" data-filter="${esc(t)}">${esc(t)}（${counts[t]}）</button>`))
    .join('\n');
}

/* 地図。店名＋場所から検索クエリを組み立てる（mapQuery があればそれを優先）。

   埋め込みには /maps/embed?pb=… を使う。よく紹介される
   「maps.google.com/maps?q=…&output=embed」は、途中のリダイレクトに
   X-Frame-Options: SAMEORIGIN が付くため今の Chrome では表示できない
   （実際に試して確認済み）。pb は「!1m2!2m1!1z＋検索語のbase64url」なので
   ここで組み立てられる。API キーは不要＝料金は一切発生しない。          */
function mapPb(q) {
  const b64 = Buffer.from(q, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `!1m2!2m1!1z${b64}!3m1!1sja!5m1!1sja`;
}

/* 記録カード。店ごとに1枚、最終訪問が新しい順に並べる。
   カード自体が詳細ページへのリンク。訪問の全履歴・メモ・地図は詳細ページに置き、
   一覧では「写真・店名・場所・直近の一杯」だけを見せて流し読みできるようにする。 */
function henroCards(away) {
  const items = udonShops().filter((g) => g.away === away);
  if (!items.length) {
    const msg = away
      ? 'まだ県外での記録がありません。<br>遠征したときの一杯を残していきます。'
      : 'まだ記録がありません。<br>これから一杯ずつ増やしていきます。';
    return `    <p style="grid-column: 1 / -1; margin: 0; padding: 60px 0; text-align: center; font: 400 15.5px/1.75 'Noto Sans JP', sans-serif; color: #cfcfd1">${msg}</p>`;
  }
  return items.map((g) => {
    const n = g.visits.length;
    const thumb = g.cover.photo
      ? `<img src="${esc(g.cover.photo)}" alt="${esc(g.shop)}の${esc(g.cover.menu || 'うどん')}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11.5px ui-monospace, Menlo, monospace; color: #c4c4c6">no photo</span>`;
    const tags = g.tags.length
      ? `\n        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px">${g.tags.map((t) =>
          `<span style="font: 400 11px 'Noto Sans JP', sans-serif; letter-spacing: .08em; padding: 2px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #cfcfd1">${esc(t)}</span>`).join('')}</div>`
      : '';
    const badge = (away ? '遠征 ' : '') + 'No.' + g._no;
    // 2回以上の店は回数バッジを出す。日付は「直近いつ行ったか」を見せる。
    const times = n > 1
      ? `<span style="position: absolute; top: 12px; right: 12px; font: 500 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .06em; padding: 4px 10px; border-radius: 999px; background: rgba(111,140,255,.9); color: #060608">${n}回</span>`
      : '';
    const dateLabel = n > 1 ? `最新 ${g.last}` : g.last;
    // 直近の一杯だけ添える（残りは詳細ページで）
    const latest = g.visits[n - 1];
    const menu = latest.menu
      ? `\n        <p style="margin: 0; font: 400 13px 'Noto Sans JP', sans-serif; color: var(--accent-text, #adbcff)">${esc(latest.menu)}</p>`
      : '';
    return `    <a href="${esc(g.href)}" data-type="${esc(g.town || '')}" class="wcard" style="display: block; text-decoration: none; color: #f4f4f5; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f">
      <div style="aspect-ratio: 4 / 3; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
        ${thumb}
        <span style="position: absolute; top: 12px; left: 12px; font: 500 11.5px 'EB Garamond', serif; letter-spacing: .1em; padding: 4px 10px; border-radius: 999px; background: rgba(6,6,8,.72); backdrop-filter: blur(8px); color: var(--accent-text, #adbcff)">${esc(badge)}</span>
        ${times}
      </div>
      <div style="padding: 18px 20px 22px">
        <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px">
          <span style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #d8d8da">${esc(g.town || '—')}</span>
          <span style="font: 400 12px 'EB Garamond', serif; letter-spacing: .06em; color: #c4c4c6">${esc(dateLabel)}</span>
        </div>
        <h3 style="margin: 0 0 4px; font: 500 16px 'Noto Sans JP', sans-serif">${esc(g.shop || '')}</h3>${menu}${tags}
        <span style="display: inline-block; margin-top: 14px; font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: #cfcfd1">詳しく見る →</span>
      </div>
    </a>`;
  }).join('\n');
}

/* ---------------- うどん詳細ページ ---------------- */

/* 詳細ページは /udon/ の中にあるので、サイト直下を指す相対パスは一段戻す。
   http… や / で始まるものはそのまま（もう行き先が確定している）。 */
function up(src) {
  const s = String(src || '');
  if (!s || /^(https?:)?\/\//.test(s) || s.startsWith('/')) return s;
  return '../' + s;
}

// 見出しの下の「場所・店のかたち・訪問回数・初訪問・最新」
function udonMeta(g) {
  const n = g.visits.length;
  const rows = [['場所', g.town || '—']];
  // 店のかたちは入っているときだけ。空の「—」を並べても意味がない
  if (g.shopType) rows.push(['店のかたち', g.shopType]);
  // 1回だけの店は、回数も「初訪問／最新」も要らない（同じ日付が二度出るだけ）
  if (n > 1) rows.push(['訪問', n + ' 回'], ['初訪問', g.first || '—'], ['最新', g.last || '—']);
  else rows.push(['訪問日', g.last || '—']);
  const use = rows;
  return `  <div style="display: flex; gap: clamp(22px, 5vw, 52px); flex-wrap: wrap; margin-bottom: 26px">
${use.map(([k, v]) => `    <div>
      <span style="display: block; margin-bottom: 5px; font: 500 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .16em; color: #c4c4c6">${esc(k)}</span>
      <span style="font: 400 15px 'Noto Sans JP', sans-serif; color: #e2e2e4">${esc(v)}</span>
    </div>`).join('\n')}
  </div>`;
}

function udonTagsBlock(g) {
  if (!g.tags.length) return '';
  return `  <div style="display: flex; gap: 7px; flex-wrap: wrap">${g.tags.map((t) =>
    `<span style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .08em; padding: 3px 11px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: #d8d8da">${esc(t)}</span>`).join('')}</div>`;
}

/* 詳細ページの地図は最初から出す。一覧と違ってページが1軒ぶんしかなく、
   「この店どこ？」がまさに知りたいことなので、押させる手間を挟まない。 */
function udonMapEmbed(g) {
  const q = String(g.mapQuery || [g.shop, g.town].filter(Boolean).join(' ')).trim();
  if (!q) return '';
  const link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return `  <section style="margin-bottom: clamp(48px, 8vw, 76px)">
    <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px">
      <p style="margin: 0; font: 500 11.5px 'EB Garamond', serif; letter-spacing: .34em; text-transform: uppercase; color: #c4c4c6">Map — 場所</p>
      <a href="${esc(link)}" target="_blank" rel="noopener" class="hw" style="font: 400 12.5px 'Noto Sans JP', sans-serif; letter-spacing: .06em; color: #d8d8da; text-decoration: none">マップで開く ↗</a>
    </div>
    <iframe src="https://www.google.com/maps/embed?pb=${esc(mapPb(q))}" title="${esc(g.shop)}の地図" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen style="display: block; width: 100%; height: min(46vh, 380px); border: 1px solid rgba(255,255,255,.12); border-radius: 16px"></iframe>
  </section>`;
}

/* メモは編集画面で改行して書ける。HTML はそのままだと改行を無視して
   一続きにしてしまうので、書いたとおりに改行させる。                */
function escLines(s) {
  return esc(String(s || '')).replace(/\r?\n/g, '<br>');
}

/* その日の一杯の中身（麺・出汁・値段）。書いた項目だけを並べる。
   全部空なら丸ごと出さない＝空欄が並んで「書き忘れ」に見えるのを防ぐ。 */
function udonSpec(v) {
  const rows = [['麺', v.noodle], ['出汁', v.broth], ['値段', v.price]].filter(([, val]) => String(val || '').trim());
  if (!rows.length) return '';
  return `
      <dl style="display: grid; grid-template-columns: auto 1fr; gap: 8px 18px; margin: 16px 0 0; max-width: 640px">
${rows.map(([k, val]) => `        <dt style="margin: 0; font: 500 12.5px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: #c4c4c6">${esc(k)}</dt>
        <dd style="margin: 0; font: 400 15.5px/1.7 'Noto Sans JP', sans-serif; color: #e2e2e4">${esc(val)}</dd>`).join('\n')}
      </dl>`;
}

// 訪問ごとのブロック。新しい順に、大きい写真とメモを添える。
function udonVisitBlocks(g) {
  const n = g.visits.length;
  return g.visits.slice().reverse().map((v, i) => {
    const times = n - i;
    const photo = v.photo
      ? `\n      <img src="${esc(up(v.photo))}" alt="${esc(g.shop)}の${esc(v.menu || 'うどん')}" loading="lazy" style="display: block; width: 100%; height: auto; margin-bottom: 18px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: #0b0b0f">`
      : '';
    const note = v.note
      ? `\n      <p style="margin: 12px 0 0; font: 400 15.5px/1.75 'Noto Sans JP', sans-serif; color: #d8d8da; max-width: 34em">${escLines(v.note)}</p>`
      : '';
    // 1回だけの店に「1回目」と書いても情報が増えないので、複数回のときだけ出す
    const label = n > 1
      ? `<span style="font: 500 12px 'Noto Sans JP', sans-serif; letter-spacing: .1em; padding: 3px 11px; border-radius: 999px; background: rgba(111,140,255,.9); color: #060608">${times}回目</span>`
      : '';
    return `    <article style="margin-bottom: clamp(44px, 7vw, 70px)">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px">
        ${label}<span style="font: 400 14px 'EB Garamond', serif; letter-spacing: .08em; color: #d8d8da">${esc(v.date || '日付未記入')}</span>
      </div>${photo}
      <h2 style="margin: 0; font: 600 clamp(20px, 2.6vw, 27px)/1.5 'Noto Serif JP', serif">${esc(v.menu || '（食べたものは未記入）')}</h2>${udonSpec(v)}${note}
    </article>`;
  }).join('\n');
}

// 詳細ページをページ一覧に足すための入れ物を作る
function udonDetailPages() {
  return udonShops().map((g) => {
    const n = g.visits.length;
    const latest = g.visits[n - 1];
    const desc = [
      g.town ? g.town + 'の' + g.shop : g.shop,
      latest.menu ? '。' + latest.menu : '',
      n > 1 ? `。これまで ${n} 回訪問。` : '。',
      'うどん遍路の記録。'
    ].join('');
    return {
      file: g.file,
      template: 'udon-detail.html',
      active: 'Henro',
      prefix: '../',
      canonicalPath: g.path,
      title: `${g.shop} — うどん遍路 / 船越温`,
      desc,
      ogImage: g.cover.photo || '',
      tokens: {
        '{{UDON_SHOP}}': esc(g.shop || ''),
        '{{UDON_BADGE}}': esc((g.away ? '遠征 ' : '讃岐 ') + 'No.' + g._no),
        '{{UDON_META}}': udonMeta(g),
        '{{UDON_TAGS}}': udonTagsBlock(g),
        '{{UDON_MAP}}': udonMapEmbed(g),
        '{{UDON_VISITS}}': udonVisitBlocks(g)
      }
    };
  });
}

function archiveSections() {
  const byYear = {};
  data.articles.forEach((a) => {
    const y = a.date.slice(0, 4);
    (byYear[y] = byYear[y] || []).push(a);
  });
  return Object.keys(byYear).sort().reverse().map((y) => {
    const items = byYear[y].map((a) => {
      const images = a.images.length ? `
          <div style="display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 18px">
${a.images.map((im) => `            <figure style="margin: 0; display: flex; flex-direction: column; gap: 8px; max-width: 300px">
              <img src="${esc(im.src)}" alt="${esc(a.title)} — ${esc(im.caption)}" style="display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: #0a0a0e" loading="lazy">
              <figcaption style="font: 400 11.5px ui-monospace, Menlo, monospace; color: #c4c4c6">${esc(im.caption)}</figcaption>
            </figure>`).join('\n')}
          </div>` : '';
      const links = a.links.length ? `
          <div style="display: flex; gap: 24px; flex-wrap: wrap">
${a.links.map((lk) => `            <a href="${esc(lk.url)}" target="_blank" rel="noopener" style="font: 400 13px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: var(--accent-text, #adbcff); text-decoration: none">${esc(lk.label)}　↗</a>`).join('\n')}
          </div>` : '';
      return `      <article class="arch-item" id="${esc(a.slug)}" data-type="${esc(a.category)}" style="border-top: 1px solid rgba(255,255,255,.1)">
        <div class="arch-row hbg" data-m="wrap" style="display: flex; align-items: baseline; gap: clamp(14px, 2.6vw, 30px); padding: 20px 6px; cursor: pointer">
          <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .06em; color: #cfcfd1; white-space: nowrap; width: 52px">${esc(a.date.slice(5) || '—')}</span>
          <span style="flex: none; font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: #d8d8da">${esc(a.category)}</span>
          <span style="flex: 1; display: flex; flex-direction: column; gap: 4px">
            <span style="font: 400 17px/1.6 'Noto Sans JP', sans-serif">${esc(a.title)}</span>
            <span style="font: 400 14.5px/1.7 'Noto Sans JP', sans-serif; color: #cfcfd1">${esc(a.excerpt)}</span>
          </span>
          <span class="chev">↓</span>
        </div>
        <div class="acc-body" data-m="pad0" style="padding: 6px 6px 30px calc(52px + clamp(14px, 2.6vw, 30px))">
          <p style="margin: 0 0 20px; font: 400 16px/1.8 'Noto Sans JP', sans-serif; color: #e2e2e4; max-width: 34em; white-space: pre-line; text-wrap: pretty">${esc(a.body)}</p>${images}${links}
        </div>
      </article>`;
    }).join('\n');
    return `  <section data-m="stack" data-year-group style="display: grid; grid-template-columns: 110px 1fr; gap: 30px; padding: 34px 0 6px; align-items: start">
    <h2 data-m="ystick" style="margin: 0; font: 500 clamp(28px, 3vw, 40px) 'EB Garamond', serif; color: #e2e2e4; position: sticky; top: 80px">${y}</h2>
    <div style="display: flex; flex-direction: column">
${items}
    </div>
  </section>`;
  }).join('\n');
}

/* ---------------- Article JSON-LD (Archive) ---------------- */

function articleLds() {
  return data.articles.map((a) => {
    const iso = a.date.replaceAll('.', '-');
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: a.title,
      description: a.excerpt,
      datePublished: iso,
      articleSection: a.category,
      url: SITE + '/archive.html#' + a.slug,
      author: { '@type': 'Person', name: '船越温', url: SITE + '/' }
    };
    if (a.images.length) ld.image = a.images.map((im) => SITE + '/' + im.src);
    return ld;
  });
}

/* ---------------- Press kit ---------------- */

function pressFacts() {
  const p = data.press || {};
  return (p.facts || []).map((f) => `      <div class="rline" data-reveal data-m="stack6" style="position: relative; display: grid; grid-template-columns: 120px 1fr; gap: 20px; padding: 18px 6px; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
        <span style="font: 500 12px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: #cfcfd1">${esc(f.label)}</span>
        <span style="font: 400 16px/1.75 'Noto Sans JP', sans-serif; color: #e2e2e4">${esc(f.value)}</span>
      </div>`).join('\n');
}

function pressPhotos() {
  const p = data.press || {};
  return (p.photos || []).map((ph) => `      <figure data-reveal style="margin: 0; display: flex; flex-direction: column; gap: 12px; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">
        <div style="border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); aspect-ratio: 4 / 5; background: #0a0a0e">
          <img src="${esc(ph.src)}" alt="${esc(p.name || '')} — ${esc(ph.caption || '')}" style="width: 100%; height: 100%; object-fit: cover; object-position: top" loading="lazy">
        </div>
        <figcaption style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
          <span style="font: 400 12px ui-monospace, Menlo, monospace; color: #cfcfd1">${esc(ph.caption || '')}</span>
          <a href="${esc(ph.src)}" download class="hw" style="font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .06em; color: var(--accent-text, #adbcff); text-decoration: none; white-space: nowrap">ダウンロード ↓</a>
        </figcaption>
      </figure>`).join('\n');
}

function pressAwards() {
  return data.research.awards.map((a) => `      <div data-reveal style="display: flex; align-items: baseline; gap: clamp(14px, 3vw, 30px); padding: 16px 6px; border-top: 1px solid rgba(255,255,255,.1); opacity: calc(var(--r, 0)); transition: opacity .9s ease">
        <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .06em; color: #cfcfd1; white-space: nowrap; width: 96px">${esc(a.year)}</span>
        <span style="flex: 1; font: 400 16px/1.7 'Noto Sans JP', sans-serif">${esc(a.name)}</span>
      </div>`).join('\n');
}

/* ---------------- メディア掲載（取材された記事・番組） ----------------
   自分の活動記録（articles）とは別物として持つ。あちらは「やったこと」、
   こちらは「外から取り上げられたこと」で、性質も出どころも違うため。
   新しい順に並べる（日付は 2025.12.29 のような文字列なので辞書順で足りる）。 */
/* 長い番組の一部で取り上げられたときは、その場面から再生を始める。
   秒数が入っていなければ何も足さない（頭から再生）。 */
function ytStartAttr(sec) {
  const n = Math.floor(Number(sec) || 0);
  return n > 0 ? ` data-ytstart="${n}"` : '';
}

function mediaSorted() {
  return (data.media || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// 「TBS『THE TIME,』／全国！中高生ニュース」のように、番組名があれば添える
function mediaOutlet(m) {
  return [m.outlet, m.program].filter((s) => String(s || '').trim()).join('／');
}

/* プレスキット用の詳しいカード。動画（ytid）があるときは、カード全体を
   リンクにできない（動画の再生ボタンが押せなくなる）ので div にして、
   下のリンクだけを押せるようにする。 */
function mediaCards() {
  const items = mediaSorted();
  if (!items.length) return '';
  return items.map((m) => {
    const url = String(m.url || '').trim();
    const hasVideo = !!String(m.ytid || '').trim();
    const tag = (url && !hasVideo) ? 'a' : 'div';
    const linkAttrs = tag === 'a' ? ` href="${esc(url)}" target="_blank" rel="noopener"` : '';

    // カードの角丸は外側（16px）で付いているので、中の動画の角丸と枠は消す
    const video = hasVideo
      ? `\n      <div class="yt-lite" data-ytid="${esc(m.ytid)}"${ytStartAttr(m.ytstart)} data-title="${esc(m.title || '')}" style="border-radius: 0; border: 0; border-bottom: 1px solid rgba(255,255,255,.1); background-image: linear-gradient(rgba(6,6,8,.05), rgba(6,6,8,.45)), url('${esc(m.thumb || '')}')">
        <button class="yt-play" type="button" aria-label="${esc(m.title || '動画')}を再生"></button>
      </div>`
      : (m.thumb ? `\n      <div style="aspect-ratio: 16 / 9; overflow: hidden; border-bottom: 1px solid rgba(255,255,255,.1)">
        <img src="${esc(m.thumb)}" alt="${esc(m.title || '')}" style="width: 100%; height: 100%; object-fit: cover" loading="lazy">
      </div>` : '');

    const quote = String(m.quote || '').trim()
      ? `\n        <blockquote style="margin: 16px 0 0; padding: 2px 0 2px 16px; border-left: 2px solid rgba(111,140,255,.55); font: 400 15px/1.8 'Noto Serif JP', serif; color: #e2e2e4; max-width: 34em">「${escLines(m.quote)}」</blockquote>`
      : '';

    const linkLine = url
      ? `\n        <${tag === 'a' ? 'span' : 'a'}${tag === 'a' ? '' : ` href="${esc(url)}" target="_blank" rel="noopener"`} style="display: inline-block; margin-top: 18px; font: 400 13px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: var(--accent-text, #adbcff); text-decoration: none">${esc(m.kind === 'テレビ' ? '番組の告知を見る' : '記事を読む')}　↗</${tag === 'a' ? 'span' : 'a'}>`
      : '';

    return `      <${tag}${linkAttrs} data-reveal class="wcard" style="display: block; text-decoration: none; color: #f4f4f5; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">${video}
      <div style="padding: 24px 26px 28px">
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
          <span style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(111,140,255,.5); border-radius: 999px; color: var(--accent-text, #adbcff)">${esc(m.kind || '記事')}</span>
          <span style="font: 400 13.5px 'Noto Sans JP', sans-serif; color: #d8d8da">${esc(mediaOutlet(m))}</span>
          <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .08em; color: #c4c4c6">${esc(m.date || '')}</span>
        </div>
        <h3 style="margin: 0 0 10px; font: 500 clamp(17px, 1.9vw, 21px)/1.6 'Noto Sans JP', sans-serif">${esc(m.title || '')}</h3>
        <p style="margin: 0; font: 400 15px/1.8 'Noto Sans JP', sans-serif; color: #cfcfd1; max-width: 34em; text-wrap: pretty">${escLines(m.summary || '')}</p>${quote}${linkLine}
      </div>
    </${tag}>`;
  }).join('\n');
}

/* ホーム用。すぐ下の「新着ニュース」が日付＋ラベル＋見出しの行リストなので、
   ここも同じ形にすると、似た一覧が2つ続いて見分けがつかなくなる。
   カードにして形を変え、媒体名を主役にする（誰が取り上げたかが要点なので）。 */
function mediaCardsHome() {
  const items = mediaSorted();
  if (!items.length) return '';
  return items.map((m) => {
    const at = Math.floor(Number(m.ytstart) || 0);
    const url = String(m.ytid || '').trim()
      ? 'https://youtu.be/' + String(m.ytid).trim() + (at > 0 ? '?t=' + at : '')
      : String(m.url || '').trim();
    const tag = url ? 'a' : 'div';
    const linkAttrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener"` : '';
    const cue = url
      ? `\n        <span style="display: inline-block; margin-top: 16px; font: 400 12.5px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: var(--accent-text, #adbcff)">${esc(m.ytid ? '映像を見る' : '記事を読む')}　↗</span>`
      : '';
    return `      <${tag}${linkAttrs} data-reveal class="wcard" style="display: flex; flex-direction: column; padding: 26px 24px 24px; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: linear-gradient(160deg, #0c0c11, #08080b); text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease, background .3s ease">
        <div style="display: flex; align-items: center; gap: 9px; margin-bottom: 14px">
          <span style="font: 400 11px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 2px 9px; border: 1px solid rgba(111,140,255,.5); border-radius: 999px; color: var(--accent-text, #adbcff)">${esc(m.kind || '記事')}</span>
          <span style="font: 400 12px 'EB Garamond', serif; letter-spacing: .08em; color: #c4c4c6">${esc(m.date || '')}</span>
        </div>
        <p style="margin: 0 0 10px; font: 500 14px/1.6 'Noto Sans JP', sans-serif; color: #e2e2e4">${esc(mediaOutlet(m))}</p>
        <p style="margin: 0; font: 400 15.5px/1.75 'Noto Sans JP', sans-serif; color: #cfcfd1; text-wrap: pretty">${esc(m.title || '')}</p>${cue}
      </${tag}>`;
  }).join('\n');
}

/* 掲載が0件のときは、見出しだけの空っぽの欄が残らないよう丸ごと出さない。
   （{{T:…}} は差し替えのあとに処理されるので、ここに書いても編集画面から直せる） */
function mediaSectionPress() {
  if (!mediaSorted().length) return '';
  return `<section style="padding: 0 7vw 12vh; max-width: 1080px; margin: 0 auto; box-sizing: border-box">
  <p data-reveal style="margin: 0 0 12px; font: 500 12px 'EB Garamond', serif; letter-spacing: .4em; text-transform: uppercase; color: #cfcfd1; opacity: calc(var(--r, 0)); transition: opacity 1s ease">{{T:press.mediaEyebrow}}</p>
  <p data-reveal style="margin: 0 0 34px; font: 400 14.5px/1.75 'Noto Sans JP', sans-serif; color: #cfcfd1; max-width: 34em; opacity: calc(var(--r, 0)); transition: opacity 1s ease">{{T:press.mediaLead}}</p>
  <div data-m="stack" style="display: grid; grid-template-columns: 1fr; gap: 22px">
${mediaCards()}
  </div>
</section>`;
}

function mediaSectionHome() {
  if (!mediaSorted().length) return '';
  return `<section id="media" style="border-top: 1px solid rgba(255,255,255,.08); padding: 12vh 7vw 11vh; max-width: 1280px; margin: 0 auto; box-sizing: border-box">
  <div data-reveal style="display: flex; align-items: baseline; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 10px; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
    <p style="margin: 0; font: 500 12px 'EB Garamond', serif; letter-spacing: .38em; text-transform: uppercase; color: #cfcfd1">{{T:index.media.eyebrow}}</p>
    <a href="press.html" style="font: 400 14px 'Noto Sans JP', sans-serif; letter-spacing: .1em; color: var(--accent-text, #adbcff); text-decoration: none">{{T:index.media.link}}</a>
  </div>
  <p data-reveal style="margin: 0 0 30px; font: 400 14.5px/1.75 'Noto Sans JP', sans-serif; color: #cfcfd1; max-width: 34em; opacity: calc(var(--r, 0)); transition: opacity 1s ease">{{T:index.media.lead}}</p>
  <div data-m="stack" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px">
${mediaCardsHome()}
  </div>
</section>`;
}

function pillarPhoto(key) {
  const p = (data.home.pillarPhotos || {})[key] || {};
  if (p.src) {
    return `      <img src="${esc(p.src)}" alt="${esc(p.alt || '')}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`;
  }
  return `      <div data-slot="photo-${key}" style="position: absolute; inset: 0"></div>`;
}

/* ---------------- ホーム（情報重視版 classic） ----------------
   brand 版は「読ませる」作りなので、探し物には向かない。こちらは
   最初の画面で全体が見え、どこに何があるかが分かることを優先する。
   演出（data-reveal 等）は使わず、開いた瞬間に文字が出ている状態にする。 */

const homeStyle = data.home.style === 'classic' ? 'classic' : 'brand';

function classicNews() {
  const items = data.home.newsItems || [];
  if (!items.length) return '      <p class="c-row-note">（まだありません）</p>';
  return items.map((n) => `      <a href="archive.html" class="c-row">
        <span class="c-row-date">${esc(n.date)}</span>
        <span><span class="c-row-title">${esc(n.title)}</span><span class="c-row-sub">${esc(n.cat)}</span></span>
      </a>`).join('\n');
}

/* 各ページへの入口。ラベル＋1行の説明＋矢印だけ、という元のホームの形。
   説明文は data.json の texts から取るので /admin から書き換えられる。 */
const CLASSIC_PREVIEWS = [
  { label: 'About', href: 'about.html', t: null, fallback: '研究・政治・芸術を守備範囲とする高校生' },
  { label: 'Research', href: 'research.html', t: 'index.research.lead', photo: 'research' },
  { label: 'Archive', href: 'archive.html', t: null, fallback: '政治・生徒会・音楽。活動の記録はこちら。', photo: 'politics' }
];

function classicPreviews() {
  return CLASSIC_PREVIEWS.map((p) => {
    /* 写真は brand 版の「柱の背景写真」と同じ場所から取る。
       どちらの見せ方でも同じ写真が出るし、差し替えも1回で済む。 */
    const photo = p.photo ? ((data.home.pillarPhotos || {})[p.photo] || {}) : {};
    const thumb = photo.src
      ? `<span class="c-preview-thumb"><img src="${esc(photo.src)}" alt="${esc(photo.alt || '')}" loading="lazy"></span>`
      : '';
    return `      <a href="${p.href}" class="c-preview">
        ${thumb}<span class="c-preview-body">
          <span class="c-preview-label">${esc(p.label)}</span>
          <span class="c-preview-text">${p.t ? textOf(p.t) : esc(p.fallback)}</span>
        </span>
        <span class="c-preview-arrow">→</span>
      </a>`;
  }).join('\n');
}

// 作品は「公開中のもの」を先に4本まで。残りは Works ページへ
function classicWorks() {
  const items = (data.worksItems || []).slice()
    .sort((a, b) => (b.status === 'live' ? 1 : 0) - (a.status === 'live' ? 1 : 0))
    .slice(0, 3);
  return items.map((w) => {
    const url = w.liveUrl || '';
    const tag = url ? 'a' : 'div';
    const attrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener"` : '';
    return `      <${tag}${attrs} class="c-row">
        <span class="c-row-date">${esc(w.type)}</span>
        <span><span class="c-row-title">${esc(w.title)}</span><span class="c-row-note">${esc(w.description)}</span></span>
      </${tag}>`;
  }).join('\n');
}

function classicMedia() {
  const n = (data.media || []).length;
  if (!n) return '';
  return `  <section class="c-block c-media-line">
    <p class="c-label">Media</p>
    <p class="c-media-text">テレビ・記事で${n}件、取り上げていただきました。</p>
    <p class="c-more"><a href="press.html">${textOf('index.media.link')}</a></p>
  </section>`;
}

/* ホームの顔写真。紹介重視版・情報重視版のどちらもこの1か所を見る。
   /admin で差し替えれば両方に反映される（片方だけ古い、が起きない）。 */
function homePortrait(style) {
  const p = data.home.portrait || {};
  const src = p.src || 'images/jigazo2.webp';
  const alt = p.alt || '船越温のポートレート';
  return `<img src="${esc(src)}" alt="${esc(alt)}" style="${style}" loading="lazy">`;
}

/* ---------------- クラウドファンディングの札 ----------------
   CAMPFIRE が配っている widget を、そのまま iframe で載せる。
   ・URL を空にすると、ホームから丸ごと消える（募集が終わったら空にすればいい）
   ・載せるのは camp-fire.jp のページだけ。他所のURLは無視する（うっかり
     知らないサイトを自分のページの中で開かせない）
   ・widget は 245x365 の決め打ちなので、狭い画面でもこの幅のまま置く */
/* ---------------- 政策甲子園の国民投票の呼びかけ ----------------
   期間が決まっている話なので、日付でボタンの文言が変わる（site.js が見る）。
   終わったあとに消し忘れても「投票は終了しました」に切り替わる。
   pageUrl を空にすると、ホームから丸ごと消える。 */
function campaignBlock(style) {
  const c = data.home.campaign || {};
  const page = String(c.pageUrl || '').trim();
  const vote = String(c.voteUrl || '').trim();
  // 外へ送り出す先なので、https のリンクだけを載せる
  if (!/^https:\/\//.test(page)) return '';
  const voteOk = /^https:\/\//.test(vote);
  const attrs = ` data-campaign data-vote-start="${esc(c.voteStart || '')}" data-vote-end="${esc(c.voteEnd || '')}"`
    + ` data-vote-url="${esc(voteOk ? vote : '')}" data-page-url="${esc(page)}"`;
  /* JSが動かない場合にも正しい文が出るよう、既定は期間の告知にしておく
     （期間前でも「友だち追加」で入口には行けるので、押して困らない） */
  const period = [c.voteStart, c.voteEnd].every(Boolean)
    ? `投票期間：${jpDate(c.voteStart)}〜${jpDate(c.voteEnd)}`
    : '';
  const ctaHref = voteOk ? vote : page;
  /* 主役は公式サイトの1枚絵。読ませるより先に、ひと目で伝える。
     画像の中に賞・見出し・期間が入っているので、こちらは文字を足しすぎない。 */
  const img = String(c.image || '').trim();
  const alt = c.imageAlt || '一票打線 — 政策甲子園2026 全国大会 副会頭賞（2位）。ようこそ、政治界隈へ。';

  if (style === 'classic') {
    const visual = img
      ? `\n    <a class="c-camp-vis" href="${esc(page)}" target="_blank" rel="noopener">
      <img src="${esc(img)}" alt="${esc(alt)}" loading="lazy" decoding="async">
    </a>`
      : '';
    return `  <section class="c-camp"${attrs}>${visual}
    <div class="c-camp-body">
      <p class="c-camp-state" data-camp-state>${esc(period)}</p>
      <p class="c-camp-act">
        <a class="c-camp-btn" data-camp-cta href="${esc(ctaHref)}" target="_blank" rel="noopener">LINEから投票する</a>
        <a class="c-camp-sub" href="${esc(page)}" target="_blank" rel="noopener">${esc(c.linkText || '政策の中身を読む　→')}</a>
      </p>
    </div>
  </section>`;
  }
  const visualB = img
    ? `\n  <a href="${esc(page)}" target="_blank" rel="noopener" style="display: block; border-radius: 18px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); margin-bottom: 26px">
    <img src="${esc(img)}" alt="${esc(alt)}" loading="lazy" decoding="async" style="display: block; width: 100%; height: auto">
  </a>`
    : '';
  return `<section id="vote" data-reveal${attrs} style="border-top: 1px solid rgba(255,255,255,.08); padding: 12vh 7vw; max-width: 1000px; margin: 0 auto; box-sizing: border-box; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 24px)); transition: opacity 1s ease, transform 1s ease">${visualB}
  <p data-camp-state style="margin: 0 0 20px; font: 500 15.5px/1.7 'Noto Sans JP', sans-serif; color: #f4f4f5">${esc(period)}</p>
  <p style="margin: 0; display: flex; gap: 24px; align-items: center; flex-wrap: wrap">
    <a data-camp-cta href="${esc(ctaHref)}" target="_blank" rel="noopener" style="font: 500 15px 'Noto Sans JP', sans-serif; letter-spacing: .06em; padding: 14px 30px; border-radius: 999px; background: #6f8cff; color: #060608; text-decoration: none">LINEから投票する</a>
    <a href="${esc(page)}" target="_blank" rel="noopener" style="font: 400 14px 'Noto Sans JP', sans-serif; letter-spacing: .1em; color: var(--accent-text, #adbcff); text-decoration: none">${esc(c.linkText || '政策の中身を読む　→')}</a>
  </p>
</section>`;
}

/* 2026-09-01 → 2026年9月1日（火） */
function jpDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const w = '日月火水木金土'[d.getUTCDay()];
  return `${+m[1]}年${+m[2]}月${+m[3]}日（${w}）`;
}

function campfireBlock(style) {
  const c = data.home.campfire || {};
  const url = String(c.url || '').trim();
  if (!/^https:\/\/camp-fire\.jp\//.test(url)) return '';
  // widget の中の「プロジェクトを見る」用に、/widget を外した見せ用URLも作る
  const pageUrl = url.replace(/\/widget\/?$/, '');
  const frame = `<iframe title="クラウドファンディングの状況" src="${esc(url)}" width="245" height="365" frameborder="0" scrolling="no" loading="lazy" style="border: 0; max-width: 100%"></iframe>`;

  if (style === 'classic') {
    return `  <section class="c-cf">
    <div class="c-cf-body">
      <p class="c-label">Crowdfunding</p>
      <p class="c-cf-h">${esc(c.heading || '')}</p>
      <p class="c-cf-note">${esc(c.note || '')}</p>
      <p class="c-more"><a href="${esc(pageUrl)}" target="_blank" rel="noopener">${esc(c.linkText || 'プロジェクトを見る　→')}</a></p>
    </div>
    <div class="c-cf-frame">${frame}</div>
  </section>`;
  }
  return `<section id="support" data-m="stack" style="border-top: 1px solid rgba(255,255,255,.08); padding: 12vh 7vw; display: grid; grid-template-columns: 1fr 245px; gap: 56px; align-items: center; max-width: 1280px; margin: 0 auto; box-sizing: border-box">
  <div data-reveal style="opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 24px)); transition: opacity 1s ease, transform 1s ease">
    <p style="margin: 0 0 14px; font: 500 12px 'EB Garamond', serif; letter-spacing: .38em; text-transform: uppercase; color: #cfcfd1">Crowdfunding</p>
    <h2 style="margin: 0 0 18px; font: 600 clamp(26px, 2.6vw, 36px)/1.5 'Noto Serif JP', serif">${esc(c.heading || '')}</h2>
    <p style="margin: 0 0 28px; font: 400 17px/1.8 'Noto Sans JP', sans-serif; color: #d8d8da; max-width: 520px; text-wrap: pretty">${esc(c.note || '')}</p>
    <a href="${esc(pageUrl)}" target="_blank" rel="noopener" style="font: 400 14px 'Noto Sans JP', sans-serif; letter-spacing: .1em; color: var(--accent-text, #adbcff); text-decoration: none">${esc(c.linkText || 'プロジェクトを見る　→')}</a>
  </div>
  <div data-reveal style="justify-self: center; opacity: calc(var(--r, 0)); transition: opacity 1.1s ease .15s">${frame}</div>
</section>`;
}

/* ---------------- Story（スクロールで読む紹介） ----------------
   ホームを「情報重視」にしても、読み物として強い brand 版を失わないための
   別ページ。index.html の雛形をそのまま使い、ホーム専用の枠（投票の呼びかけ・
   クラファン・掲載・新着）だけを切り落として、終わりに About へ戻る案内を足す。
   複製を持たないので、brand 版を直せば Story も一緒に直る。 */
function storyTransform(html) {
  // ホーム専用の枠（{{CAMPAIGN}} から </main> の手前まで）を、Story の結びに差し替える
  const a = html.indexOf('{{CAMPAIGN}}');
  const b = html.indexOf('</main>');
  if (a < 0 || b < 0 || b < a) throw new Error('story: index.html の切り出し位置が見つかりません');
  html = html.slice(0, a) + '{{STORY_END}}\n' + html.slice(b);
  // 旧サイトからの飛び先の付け替えはホームだけの仕事
  html = html.replace(/<script>\s*\/\/ 旧サイト[\s\S]*?<\/script>\s*/, '');
  // 読み進み具合の線と、演出を飛ばして最後へ行ける道（キーボード・読み上げ向け）
  html = html.replace('<body class="p-home"', '<body class="p-home p-story"');
  html = html.replace('<main>', `<a class="story-skip" href="#story-end">演出を飛ばして最後へ</a>
<div class="story-progress" aria-hidden="true"></div>
<main>`);
  return html;
}

function storyEnd() {
  return `<section id="story-end" style="border-top: 1px solid rgba(255,255,255,.08); padding: 14vh 7vw 16vh; text-align: center; max-width: 1080px; margin: 0 auto; box-sizing: border-box">
  <p data-reveal style="margin: 0 0 18px; font: 500 12px 'EB Garamond', serif; letter-spacing: .4em; text-transform: uppercase; color: #cfcfd1; opacity: calc(var(--r, 0)); transition: opacity 1s ease">{{T:story.endEyebrow}}</p>
  <p data-reveal style="margin: 0 0 34px; font: 500 clamp(18px, 2vw, 26px)/1.9 'Noto Serif JP', serif; letter-spacing: .1em; opacity: calc(var(--r, 0)); transition: opacity 1s ease .1s">{{T:story.endLine}}</p>
  <div data-reveal style="display: flex; gap: 22px; justify-content: center; flex-wrap: wrap; opacity: calc(var(--r, 0)); transition: opacity 1s ease .2s">
    <a href="about.html" style="font: 500 14px 'Noto Sans JP', sans-serif; letter-spacing: .08em; padding: 13px 26px; border-radius: 999px; background: #6f8cff; color: #060608; text-decoration: none">{{T:story.link1}}</a>
    <a href="research.html" style="font: 400 14px 'Noto Sans JP', sans-serif; letter-spacing: .1em; color: var(--accent-text, #adbcff); text-decoration: none; align-self: center">{{T:story.link2}}</a>
    <a href="archive.html" style="font: 400 14px 'Noto Sans JP', sans-serif; letter-spacing: .1em; color: var(--accent-text, #adbcff); text-decoration: none; align-self: center">{{T:story.link3}}</a>
  </div>
</section>`;
}

/* About に置く Story への入口。写真を敷いた1枚のカードで、押す場所を迷わせない。
   写真はホームの柱写真（研究）→ 顔写真 の順で、あるものを使う。 */
function aboutStoryCard() {
  const pp = (data.home.pillarPhotos || {});
  const pick = ['research', 'music', 'politics', 'governance'].map((k) => (pp[k] || {}).src).find(Boolean)
    || ((data.home.portrait || {}).src) || 'images/jigazo2.webp';
  return `<section style="padding: 0 7vw 12vh; max-width: 1080px; margin: 0 auto; box-sizing: border-box">
  <a href="story.html" class="story-card" data-reveal style="opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 24px)); transition: opacity 1s ease, transform 1s ease">
    <img src="${esc(pick)}" alt="" aria-hidden="true" loading="lazy" decoding="async">
    <span class="story-card-body">
      <span class="story-card-eyebrow">{{T:about.storyEyebrow}}</span>
      <span class="story-card-title">{{T:about.storyTitle}}</span>
      <span class="story-card-lead">{{T:about.storyLead}}</span>
      <span class="story-card-link">{{T:about.storyLink}}</span>
    </span>
  </a>
</section>`;
}

/* ---------------- pages ---------------- */

const pages = [
  {
    file: 'index.html',
    active: 'Home',
    isHome: true,
    canonicalPath: '/',
    /* ホームだけ2つの見せ方を用意してある（/admin の「ホーム」タブで切り替え）。
         brand   … 今までの、スクロールで読ませる紹介（読み物として強い）
         classic … 情報を先に出す普通のホームページ（探しやすさ優先）
       中身はどちらも同じ data.json から作るので、切り替えても内容はずれない。 */
    template: homeStyle === 'classic' ? 'index-classic.html' : 'index.html',
    title: '船越温 / Tsutsumu Funakoshi — 社会のためのイノベーション。',
    desc: data.home.tagline,
    tokens: {
      '{{GAME_TILES}}': gameTiles(),
      '{{MEDIA_SECTION}}': mediaSectionHome(),
      '{{NEWS_ROWS}}': newsRows(),
      '{{PHOTO_RESEARCH}}': pillarPhoto('research'),
      '{{PHOTO_POLITICS}}': pillarPhoto('politics'),
      '{{PHOTO_GOVERNANCE}}': pillarPhoto('governance'),
      '{{PHOTO_MUSIC}}': pillarPhoto('music'),
      // ここから下は classic だけが使う（brand 側には無いので素通りする）
      '{{CAMPAIGN}}': campaignBlock(homeStyle),
      '{{CAMPFIRE}}': campfireBlock(homeStyle),
      '{{C_NEWS}}': classicNews(),
      '{{C_PREVIEWS}}': classicPreviews(),
      '{{C_WORKS}}': classicWorks(),
      '{{C_MEDIA}}': classicMedia(),
      '{{C_TAGLINE}}': esc(data.home.tagline),
      '{{C_PORTRAIT}}': homePortrait('object-position: top'),
      '{{HOME_PORTRAIT}}': homePortrait('width: 100%; height: 100%; object-fit: cover; object-position: top')
    }
  },
  {
    file: 'about.html',
    active: 'About',
    canonicalPath: '/about.html',
    title: 'About — 船越温 / Tsutsumu Funakoshi',
    desc: data.about.prose,
    tokens: {
      '{{ABOUT_PROSE}}': esc(data.about.prose),
      '{{META_ROWS}}': metaRows(),
      '{{ABOUT_STORY}}': aboutStoryCard(),
      '{{ABOUT_VIDEO}}': aboutVideo(),
      '{{TIMELINE_ITEMS}}': timelineItems()
    }
  },
  {
    /* About の下に置く「読み物」。brand 版ホームと同じ雛形から切り出す
       （複製を持たない）。ナビでは About の仲間として光らせる。 */
    file: 'story.html',
    template: 'index.html',
    transform: storyTransform,
    active: 'About',
    canonicalPath: '/story.html',
    title: 'Story — 船越温 / Tsutsumu Funakoshi',
    desc: '研究・政治・制度設計・音楽。船越温の4つの顔を、写真と言葉でスクロールしながら読む紹介。',
    tokens: {
      '{{GAME_TILES}}': gameTiles(),
      '{{PHOTO_RESEARCH}}': pillarPhoto('research'),
      '{{PHOTO_POLITICS}}': pillarPhoto('politics'),
      '{{PHOTO_GOVERNANCE}}': pillarPhoto('governance'),
      '{{PHOTO_MUSIC}}': pillarPhoto('music'),
      '{{HOME_PORTRAIT}}': homePortrait('width: 100%; height: 100%; object-fit: cover; object-position: top'),
      '{{STORY_END}}': storyEnd()
    }
  },
  {
    file: 'research.html',
    active: 'Research',
    canonicalPath: '/research.html',
    title: 'Research 研究 — 船越温 / Tsutsumu Funakoshi',
    desc: data.research.heading + ' ' + data.research.problem,
    tokens: {
      '{{RESEARCH_PROBLEM}}': esc(data.research.problem),
      '{{STAT_CARDS}}': statCards(),
      '{{STORY_PARAS}}': storyParas(),
      '{{KEYWORD_CHIPS}}': keywordChips(),
      '{{AWARD_ROWS}}': awardRows()
    }
  },
  {
    file: 'works.html',
    active: 'Works',
    canonicalPath: '/works.html',
    title: 'Works 開発 — 船越温 / Tsutsumu Funakoshi',
    // 本数は数え直さなくていいように data から取る（手で書くと必ず古くなる）
    desc: `個人で開発した Web アプリ・ゲームと、学校で実際に使われているサイト、${data.worksItems.length}本。高松高校生徒会公式サイト、高高祭2026、主権者教育アプリなど。`,
    tokens: { '{{WORK_CARDS}}': workCards() }
  },
  {
    file: 'henro.html',
    active: 'Henro',
    canonicalPath: '/henro.html',
    title: 'うどん遍路 — 船越温 / Tsutsumu Funakoshi',
    desc: '讃岐うどんの食べ歩き記録。香川県内17市町を巡り、県外遠征で食べた一杯も記録する。',
    tokens: {
      '{{HENRO_HEADING}}': esc(data.henro.heading),
      '{{HENRO_LEAD}}': esc(data.henro.lead),
      '{{HENRO_TOTAL}}': String(data.udonItems.length),
      '{{HENRO_SHOP_COUNT}}': String(henroShopCount()),
      '{{HENRO_HOME_COUNT}}': String(henroCount(false)),
      '{{HENRO_AWAY_COUNT}}': String(henroCount(true)),
      '{{HENRO_TOWN_DONE}}': String(visitedTownCount()),
      '{{HENRO_TOWN_ALL}}': String(data.henro.kagawaTowns.length),
      '{{HENRO_TOWN_PERCENT}}': String(Math.round(visitedTownCount() / data.henro.kagawaTowns.length * 100)),
      '{{HENRO_TOWN_MAP}}': henroTownMap(),
      '{{HENRO_HOME_CHIPS}}': henroChips(false),
      '{{HENRO_AWAY_CHIPS}}': henroChips(true),
      '{{HENRO_HOME_CARDS}}': henroCards(false),
      '{{HENRO_AWAY_CARDS}}': henroCards(true)
    }
  },
  {
    file: 'archive.html',
    active: 'Archive',
    canonicalPath: '/archive.html',
    title: 'Archive 活動記録 — 船越温 / Tsutsumu Funakoshi',
    desc: '受賞、議員訪問、発表、演奏会。船越温の活動の時系列記録。',
    tokens: { '{{ARCHIVE_SECTIONS}}': archiveSections() },
    extraLd: articleLds()
  },
  {
    file: 'press.html',
    active: 'Press',
    canonicalPath: '/press.html',
    title: 'Press プレスキット — 船越温 / Tsutsumu Funakoshi',
    desc: '報道・取材のためのプロフィール、経歴、ポートレート写真、連絡先。',
    tokens: {
      '{{PRESS_CATCH}}': esc(data.press.catch),
      '{{PRESS_NAME}}': esc(data.press.name),
      '{{PRESS_NAME_ROMAJI}}': esc(data.press.nameRomaji),
      '{{PRESS_NAME_KANA}}': esc(data.press.nameKana),
      '{{PRESS_FACTS}}': pressFacts(),
      '{{PRESS_BIO_SHORT}}': esc(data.press.bioShort),
      '{{PRESS_BIO_LONG}}': esc(data.press.bioLong),
      '{{MEDIA_SECTION}}': mediaSectionPress(),
      '{{PRESS_PHOTOS}}': pressPhotos(),
      '{{PRESS_AWARDS}}': pressAwards(),
      '{{PRESS_EMAIL}}': esc(data.contact.email)
    }
  },
  {
    file: 'contact.html',
    active: 'Contact',
    canonicalPath: '/contact.html',
    title: 'Contact お問い合わせ — 船越温 / Tsutsumu Funakoshi',
    desc: 'ご意見・ご要望、取材や出演のご依頼などのお問い合わせ。フォーム・メール・SNS（Instagram / X）から連絡できます。',
    tokens: {
      '{{CONTACT_EMAIL}}': esc(data.contact.email),
      '{{CONTACT_ACCESS_KEY}}': esc((data.contact && data.contact.web3formsKey) || '')
    }
  }
// 店ごとの詳細ページ（/udon/○○.html）。data.json の記録から自動で増える
].concat(udonDetailPages());

/* ---------------- write dist ---------------- */

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// static assets
fs.cpSync(path.join(SRC, 'static'), DIST, { recursive: true });
fs.cpSync(path.join(SRC, 'images'), path.join(DIST, 'images'), { recursive: true });

/* static の中の HTML にも {{NAV}} と {{FOOTER}} を差し込む。
   /tools/ のような道具のページには、検索や共有からいきなり来る人がいる。
   そこで行き止まりだと、道具だけがぽつんと存在してサイトへ戻れない。
   上のナビと下のフッターがあれば、道具からサイト全体を知ってもらえる。

   中身は他のページと同じ partials なので、片方だけ古くなることがない。
   使わないページはそのまま素通りする。
   注意: {{NAV}} を使うページは <head> で /css/site.css も読むこと
   （ナビの畳み方・ハンバーガーの見た目がそこにあるため）。 */

/* ナビは上に貼り付く(52px)ので、その分だけ本文を下げる。
   ハンバーガーの開け閉めは site.js の仕事だが、道具のページに site.js を
   丸ごと入れると演出まで付いてくるので、開け閉めだけをここに置く。 */
const NAV_SUPPORT = `
<style>body { padding-top: 52px; }</style>
<script>
(function () {
  var b = document.querySelector('.nav-burger');
  if (!b) return;
  b.addEventListener('click', function () { document.body.classList.toggle('menu-open'); });
  document.querySelectorAll('.menu-overlay a').forEach(function (a) {
    a.addEventListener('click', function () { document.body.classList.remove('menu-open'); });
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 820) document.body.classList.remove('menu-open');
  });
})();
</script>`;

function fillStaticPartials(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { fillStaticPartials(p); continue; }
    if (!e.name.endsWith('.html')) continue;
    let html = fs.readFileSync(p, 'utf8');
    if (!html.includes('{{FOOTER}}') && !html.includes('{{NAV}}')) continue;
    // dist から何階層下か＝サイト直下へ戻るのに要る '../' の数
    const depth = path.relative(DIST, p).split(path.sep).length - 1;
    const prefix = '../'.repeat(depth);
    // active は無し＝どのページ名も光らせない（サイト本体のページではないので）
    html = html.replaceAll('{{NAV}}', navHtml('', false, prefix) + NAV_SUPPORT);
    html = html.replaceAll('{{FOOTER}}', footerHtml(false, prefix));
    html = resolveTexts(html);
    // テンプレート側と同じく、埋め忘れは黙って公開せず必ず止める
    const leftover = html.match(/\{\{[A-Z_]+\}\}/);
    if (leftover) throw new Error(`${path.relative(DIST, p)}: unresolved token ${leftover[0]}`);
    fs.writeFileSync(p, html);
  }
}
fillStaticPartials(DIST);

for (const page of pages) {
  // 詳細ページのように「1つの型から何枚も作る」ページは template を別に指定する
  let html = read(path.join('templates', page.template || page.file));
  // 1つの雛形から「別の顔」を切り出すページ（Story など）はここで加工する
  if (page.transform) html = page.transform(html);
  const prefix = page.prefix || '';
  html = html
    .replace('{{HEAD}}', headHtml(page))
    .replace('{{NAV}}', navHtml(page.active, !!page.isHome, prefix))
    .replace('{{FOOTER}}', footerHtml(!!page.isHome, prefix));
  for (const [token, value] of Object.entries(page.tokens || {})) {
    html = html.replaceAll(token, value);
  }
  html = resolveTexts(html);
  const leftover = html.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`${page.file}: unresolved token ${leftover[0]}`);
  if (missingTextKeys.length) {
    throw new Error(`${page.file}: data.json の texts に無い文言: ${[...new Set(missingTextKeys)].join(', ')}`);
  }
  const out = path.join(DIST, page.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

// sitemap.xml
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE}${p.canonicalPath}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);

// robots.txt — AI クローラーを明示的に許可
const bots = ['GPTBot', 'ClaudeBot', 'Claude-Web', 'Google-Extended', 'PerplexityBot', 'CCBot'];
const robots = `User-agent: *
Allow: /

${bots.map((b) => `User-agent: ${b}\nAllow: /`).join('\n\n')}

Sitemap: ${SITE}/sitemap.xml
`;
fs.writeFileSync(path.join(DIST, 'robots.txt'), robots);

// llms.txt
// 店ごとの詳細ページは記録が増えるほど際限なく伸びるので並べない。sitemap.xml から辿れる。
const llms = `# 船越温 / Tsutsumu Funakoshi — ポートフォリオ

> うどん県（香川県）在住の高校3年生・船越温の個人サイト。コンセプトは「社会のためのイノベーション。」。廃棄うどんを原料とする水素・SAF・ナフサ生成の研究、議員訪問や主権者教育アプリなどの政治活動、生徒会長としての制度設計、そしてヴァイオリン・声楽などの音楽活動を記録している。

## 人物

- 香川県立高松高等学校3年。第152代生徒会長
- 研究: 廃棄うどんを用いた高効率水素生成プロセスの設計と最適化（東京大学生産技術研究所 Aziz研究室の指導、現・東北大学）
- 受賞: ${data.research.awards.map((a) => a.name).join(' / ')}
- 音楽: かがわジュニア・フィルハーモニック・オーケストラ（KJO）所属。第25回定期演奏会コンサートマスター（予定）。第九バリトンソロ、香川ジュニア音楽コンクール銀賞

## メディア掲載

${(data.media || []).length
    ? mediaSorted().map((m) => {
      const links = [m.ytid ? 'https://youtu.be/' + m.ytid : '', m.url].filter(Boolean).join(' ');
      return `- ${m.date}　${mediaOutlet(m)}「${m.title}」: ${m.summary}${links ? ' ' + links : ''}`;
    }).join('\n')
    : '- （なし）'}

## ページ

- [Home](${SITE}/): 研究・政治・制度設計・音楽を束ねる自己紹介
- [About](${SITE}/about.html): プロフィール・経歴タイムライン
- [Story](${SITE}/story.html): 研究・政治・制度設計・音楽の4つの顔を、写真と言葉でスクロールしながら読む紹介（読み物版）
- [Research](${SITE}/research.html): 廃棄うどん研究の詳細（統計・プロセス・受賞）
- [Works](${SITE}/works.html): 個人開発の Web アプリ・ゲームと、学校で実際に使われているサイト計${data.worksItems.length}本
- [Archive](${SITE}/archive.html): 活動の時系列記録（記事全文）
- [Udon](${SITE}/henro.html): 讃岐うどんの食べ歩き記録「うどん遍路」。香川県内${data.henro.kagawaTowns.length}市町の巡り具合と県外遠征。店ごとの詳細ページ（/udon/ 以下）もある
- [Press](${SITE}/press.html): 報道・取材向けのプロフィール・経歴・ポートレート写真・連絡先
- [Contact](${SITE}/contact.html): お問い合わせ（フォーム・メール・SNS）

## 連絡先

- Email: ${data.contact.email}
- X: https://x.com/funa_sun273
- GitHub: https://github.com/funasun/
`;
fs.writeFileSync(path.join(DIST, 'llms.txt'), llms);

reportUnusedTextKeys();
console.log(`Built ${pages.length} pages → dist/`);
