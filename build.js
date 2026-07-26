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

/* ---------------- partials ---------------- */

function navHtml(active, isHome) {
  const on = '#f4f4f5';
  const off = 'rgba(244,244,245,.72)';
  return read('partials/nav.html')
    .replaceAll('{{HOME_HREF}}', isHome ? '#top' : 'index.html')
    .replace('{{C_HOME}}', active === 'Home' ? on : off)
    .replace('{{C_ABOUT}}', active === 'About' ? on : off)
    .replace('{{C_RESEARCH}}', active === 'Research' ? on : off)
    .replace('{{C_WORKS}}', active === 'Works' ? on : off)
    .replace('{{C_ARCHIVE}}', active === 'Archive' ? on : off)
    .replace('{{C_HENRO}}', active === 'Henro' ? on : off)
    .replace('{{C_CONTACT}}', active === 'Contact' ? on : off);
}

function footerHtml(isHome) {
  return read('partials/footer.html')
    .replaceAll('{{HOME_HREF}}', isHome ? '#top' : 'index.html');
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
  ]
};

function headHtml({ title, desc, canonicalPath, extraLd }) {
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
<meta property="og:image" content="${SITE}/images/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#060608">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Noto+Serif+JP:wght@500;600&family=Noto+Sans+JP:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/site.css">
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
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.58)">app screenshot</span>`;
    return `      <a ${linkAttrs} class="gcard" style="--tilt: ${g.tilt}; flex: none; width: clamp(240px, 24vw, 360px); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; display: block; text-decoration: none; color: #f4f4f5">
        <div style="aspect-ratio: 16 / 10; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
          ${thumb}
        </div>
        <div style="padding: 16px 18px 20px">
          <h3 style="margin: 0 0 5px; font: 500 15px 'Noto Sans JP', sans-serif">${esc(g.title)}</h3>
          <p style="margin: 0; font: 400 12px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.66)">${esc(g.desc)}</p>
        </div>
      </a>`;
  }).join('\n');
}

function newsRows() {
  return data.home.newsItems.map((n) => `    <a href="archive.html" data-reveal data-m="wrap" class="hbg" style="display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; border-top: 1px solid rgba(255,255,255,.1); text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .08em; color: rgba(244,244,245,.62); white-space: nowrap">${esc(n.date)}</span>
      <span style="flex: none; font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.74)">${esc(n.cat)}</span>
      <span style="flex: 1; font: 400 15px/1.7 'Noto Sans JP', sans-serif">${esc(n.title)}</span>
      <span style="color: var(--accent, #6f8cff)">→</span>
    </a>`).join('\n');
}

// " / " 区切りの値は、各項目を折り返し禁止にして区切りでのみ改行させる
// （モバイルで「ヴァイオリン」等が単語の途中で不自然に折り返すのを防ぐ）
function metaValue(v) {
  if (v.indexOf(' / ') === -1) return esc(v);
  return v
    .split(' / ')
    .map((s) => `<span style="white-space: nowrap">${esc(s)}</span>`)
    .join('<span style="color: rgba(244,244,245,.58)"> / </span>');
}

function metaRows() {
  return data.about.meta.map((m) => `    <div data-reveal data-m="stack6" class="rline" style="position: relative; display: grid; grid-template-columns: 160px 1fr; gap: 24px; padding: 20px 6px; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
      <span style="font: 500 13px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: rgba(244,244,245,.66)">${esc(m.label)}</span>
      <span style="font: 300 14.5px/1.9 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.9)">${metaValue(m.value)}</span>
    </div>`).join('\n');
}

function timelineItems() {
  return data.about.timeline.map((t) => `      <div data-reveal style="position: relative; display: flex; align-items: baseline; gap: 26px; flex-wrap: wrap; opacity: calc(var(--r, 0)); transform: translateX(calc((1 - var(--r, 0)) * 24px)); transition: opacity .9s ease, transform .9s cubic-bezier(.2,.7,.2,1)">
        <span style="position: absolute; left: -36px; top: 6px; width: 11px; height: 11px; border-radius: 50%; background: #0c0c10; border: 1.5px solid rgba(111,140,255,.8)"></span>
        <span style="font: 500 15px 'EB Garamond', serif; letter-spacing: .1em; color: rgba(244,244,245,.7); width: 90px; white-space: nowrap">${esc(t.year)}</span>
        <span style="flex: 1; min-width: 240px; font: 400 15.5px/1.8 'Noto Sans JP', sans-serif">${esc(t.label)}</span>
      </div>`).join('\n');
}

function aboutVideo() {
  const v = (data.about && data.about.video) || {};
  if (!v.ytid) return '';
  // 軽量埋め込み: 普段はポスター画像＋再生ボタンだけ（画像1枚分の重さ）。
  // クリックした瞬間に site.js が youtube-nocookie の iframe に差し替える。
  return `<section data-reveal style="padding: 0 7vw 16vh; max-width: 1080px; margin: 0 auto; box-sizing: border-box; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
  <p style="margin: 0 0 34px; font: 500 12px 'EB Garamond', serif; letter-spacing: .4em; text-transform: uppercase; color: rgba(244,244,245,.62)">Music — 演奏</p>
  <div class="yt-lite" data-ytid="${esc(v.ytid)}" data-title="${esc(v.title || '')}" style="background-image: linear-gradient(rgba(6,6,8,.05), rgba(6,6,8,.45)), url('${esc(v.poster || '')}')">
    <button class="yt-play" type="button" aria-label="演奏動画を再生"></button>
  </div>
  <p style="margin: 16px 0 0; font: 400 12.5px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.58)">${esc(v.caption || '')}</p>
</section>`;
}

function statCards() {
  return data.research.stats.map((s) => `    <div data-reveal data-m="statrow" style="padding: 34px 32px 30px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: linear-gradient(160deg, #0c0c11, #08080b); opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 26px)); transition: opacity 1s ease, transform 1s ease">
      <div style="display: flex; align-items: baseline; gap: 4px">
        <span data-count="${s.value}" style="font: 500 clamp(44px, 4.2vw, 64px)/1 'EB Garamond', serif">${s.value.toLocaleString('ja-JP')}</span>
        <span style="font: 500 18px 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.74)">${esc(s.suffix)}</span>
      </div>
      <p style="margin: 14px 0 0; font: 400 13px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.7)">${esc(s.label)}</p>
    </div>`).join('\n');
}

function storyParas() {
  return data.research.story.map((p) => `    <p data-reveal style="margin: 0; font: 300 15px/2.3 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.84); text-wrap: pretty; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">${esc(p)}</p>`).join('\n');
}

function keywordChips() {
  return data.research.keywords.map((kw) => `    <span style="font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .1em; padding: 6px 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: rgba(244,244,245,.78)">${esc(kw)}</span>`).join('\n');
}

function awardRows() {
  return data.research.awards.map((a) => `    <a href="archive.html" data-reveal data-m="wrap" class="rline hbg" style="position: relative; display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.62); white-space: nowrap; width: 100px">${esc(a.year)}</span>
      <span style="flex: 1; display: flex; flex-direction: column; gap: 3px">
        <span style="font: 400 15.5px/1.7 'Noto Sans JP', sans-serif">${esc(a.name)}</span>
        <span style="font: 400 12.5px 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.62)">${esc(a.org)}</span>
      </span>
      <span style="color: var(--accent, #6f8cff)">→</span>
    </a>`).join('\n');
}

function workCards() {
  return data.worksItems.map((w) => {
    const url = w.liveUrl || '';
    const statusStyle = w.status === 'live'
      ? "font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(111,140,255,.5); color: var(--accent, #6f8cff)"
      : "font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); color: rgba(244,244,245,.62)";
    const thumb = w.thumbnail
      ? `<img src="${esc(w.thumbnail)}" alt="${esc(w.title)}のスクリーンショット" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.58)">app screenshot</span>`;
    // liveUrl が空の作品はリンクにしない（href="#" だと「押しても飛ばない」リンクになる）
    const tag = url ? 'a' : 'div';
    const linkAttrs = url ? ` href="${esc(url)}" target="_blank" rel="noopener"` : '';
    return `    <${tag}${linkAttrs} data-type="${esc(w.type)}" class="wcard" style="display: block; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; text-decoration: none; color: #f4f4f5">
      <div style="aspect-ratio: 16 / 10; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
        ${thumb}
      </div>
      <div style="padding: 18px 20px 22px">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px">
          <span style="font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.74)">${esc(w.type)}</span>
          <span style="${statusStyle}">${w.status === 'live' ? '公開中' : '開発中'}</span>
        </div>
        <h3 style="margin: 0 0 6px; font: 500 16px 'Noto Sans JP', sans-serif">${esc(w.title)}</h3>
        <p style="margin: 0; font: 400 12.5px/1.8 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.66)">${esc(w.description)}</p>
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
      ? "font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .04em; padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(111,140,255,.55); background: rgba(111,140,255,.12); color: var(--accent, #6f8cff)"
      : "font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .04em; padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); color: rgba(244,244,245,.5)";
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

/* iframe はページ読み込み時には作らず、「地図を表示」を押したときだけ
   site.js が挿入する。こうすると通信量も増えず、押すまで Google に何も渡らない。 */
function henroMapBlock(g) {
  const q = String(g.mapQuery || [g.shop, g.town].filter(Boolean).join(' ')).trim();
  if (!q) return '';
  const link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return `
        <div class="udon-map" style="margin-top: 14px">
          <div style="display: flex; gap: 14px; flex-wrap: wrap; align-items: center">
            <button type="button" class="map-btn" data-map-pb="${esc(mapPb(q))}" aria-expanded="false" style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .08em; padding: 5px 13px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: none; color: rgba(244,244,245,.76); cursor: pointer">地図を表示</button>
            <a href="${esc(link)}" target="_blank" rel="noopener" style="font: 400 11.5px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: rgba(244,244,245,.62); text-decoration: none">マップで開く ↗</a>
          </div>
          <div class="map-slot" style="margin-top: 0"></div>
        </div>`;
}

/* 1回だけの店は「食べたもの＋メモ」をそのまま出す。
   2回以上の店は、訪問ごとの行を新しい順に積む（何回目・日付・食べたもの・メモ）。 */
function henroVisitLog(g) {
  const n = g.visits.length;
  if (n === 1) {
    const v = g.visits[0];
    const note = v.note
      ? `\n        <p style="margin: 10px 0 0; font: 400 12.5px/1.8 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.66)">${esc(v.note)}</p>`
      : '';
    return `\n        <p style="margin: 0; font: 400 13px 'Noto Sans JP', sans-serif; color: var(--accent, #6f8cff)">${esc(v.menu || '')}</p>${note}`;
  }
  const rows = g.visits.slice().reverse().map((v, i) => {
    const times = n - i; // 何回目か
    const thumb = v.photo
      ? `<img src="${esc(v.photo)}" alt="${esc(v.menu || 'うどん')}" loading="lazy" style="width: 46px; height: 46px; flex: none; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,.1)">`
      : '';
    const note = v.note
      ? `\n            <p style="margin: 5px 0 0; font: 400 12px/1.75 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.66)">${esc(v.note)}</p>`
      : '';
    return `        <li style="display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid rgba(255,255,255,.09)">
          ${thumb}
          <div style="flex: 1; min-width: 0">
            <div style="display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap">
              <span style="font: 500 11px 'Noto Sans JP', sans-serif; letter-spacing: .06em; color: var(--accent, #6f8cff)">${times}回目</span>
              <span style="font: 400 11.5px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.62)">${esc(v.date || '')}</span>
            </div>
            <p style="margin: 3px 0 0; font: 400 13px 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.88)">${esc(v.menu || '')}</p>${note}
          </div>
        </li>`;
  }).join('\n');
  return `\n        <ol style="list-style: none; margin: 10px 0 0; padding: 0">\n${rows}\n        </ol>`;
}

// 記録カード。店ごとに1枚、最終訪問が新しい順に並べる。
function henroCards(away) {
  const items = henroShops(away);
  if (!items.length) {
    const msg = away
      ? 'まだ県外での記録がありません。<br>遠征したときの一杯を残していきます。'
      : 'まだ記録がありません。<br>これから一杯ずつ増やしていきます。';
    return `    <p style="grid-column: 1 / -1; margin: 0; padding: 60px 0; text-align: center; font: 300 14px/2 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.62)">${msg}</p>`;
  }
  return items.map((g) => {
    const n = g.visits.length;
    const thumb = g.cover.photo
      ? `<img src="${esc(g.cover.photo)}" alt="${esc(g.shop)}の${esc(g.cover.menu || 'うどん')}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.58)">no photo</span>`;
    const tags = g.tags.length
      ? `\n        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px">${g.tags.map((t) =>
          `<span style="font: 400 10px 'Noto Sans JP', sans-serif; letter-spacing: .08em; padding: 2px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: rgba(244,244,245,.66)">${esc(t)}</span>`).join('')}</div>`
      : '';
    const badge = (away ? '遠征 ' : '') + 'No.' + g._no;
    // 2回以上の店は回数バッジを出す。日付は「直近いつ行ったか」を見せる。
    const times = n > 1
      ? `<span style="position: absolute; top: 12px; right: 12px; font: 500 11px 'Noto Sans JP', sans-serif; letter-spacing: .06em; padding: 4px 10px; border-radius: 999px; background: rgba(111,140,255,.9); color: #060608">${n}回</span>`
      : '';
    const dateLabel = n > 1 ? `最新 ${g.last}` : g.last;
    const map = henroMapBlock(g);
    return `    <article data-type="${esc(g.town || '')}" class="wcard" style="border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f">
      <div style="aspect-ratio: 4 / 3; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
        ${thumb}
        <span style="position: absolute; top: 12px; left: 12px; font: 500 11px 'EB Garamond', serif; letter-spacing: .1em; padding: 4px 10px; border-radius: 999px; background: rgba(6,6,8,.72); backdrop-filter: blur(8px); color: var(--accent, #6f8cff)">${esc(badge)}</span>
        ${times}
      </div>
      <div style="padding: 18px 20px 22px">
        <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px">
          <span style="font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.74)">${esc(g.town || '—')}</span>
          <span style="font: 400 12px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.58)">${esc(dateLabel)}</span>
        </div>
        <h3 style="margin: 0 0 4px; font: 500 16px 'Noto Sans JP', sans-serif">${esc(g.shop || '')}</h3>${henroVisitLog(g)}${tags}${map}
      </div>
    </article>`;
  }).join('\n');
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
              <figcaption style="font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.58)">${esc(im.caption)}</figcaption>
            </figure>`).join('\n')}
          </div>` : '';
      const links = a.links.length ? `
          <div style="display: flex; gap: 24px; flex-wrap: wrap">
${a.links.map((lk) => `            <a href="${esc(lk.url)}" target="_blank" rel="noopener" style="font: 400 13px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: var(--accent, #6f8cff); text-decoration: none">${esc(lk.label)}　↗</a>`).join('\n')}
          </div>` : '';
      return `      <article class="arch-item" id="${esc(a.slug)}" data-type="${esc(a.category)}" style="border-top: 1px solid rgba(255,255,255,.1)">
        <div class="arch-row hbg" data-m="wrap" style="display: flex; align-items: baseline; gap: clamp(14px, 2.6vw, 30px); padding: 20px 6px; cursor: pointer">
          <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.62); white-space: nowrap; width: 52px">${esc(a.date.slice(5) || '—')}</span>
          <span style="flex: none; font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.74)">${esc(a.category)}</span>
          <span style="flex: 1; display: flex; flex-direction: column; gap: 4px">
            <span style="font: 400 15px/1.6 'Noto Sans JP', sans-serif">${esc(a.title)}</span>
            <span style="font: 400 12.5px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.62)">${esc(a.excerpt)}</span>
          </span>
          <span class="chev">↓</span>
        </div>
        <div class="acc-body" data-m="pad0" style="padding: 6px 6px 30px calc(52px + clamp(14px, 2.6vw, 30px))">
          <p style="margin: 0 0 20px; font: 300 14.5px/2.2 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.86); max-width: 640px; white-space: pre-line; text-wrap: pretty">${esc(a.body)}</p>${images}${links}
        </div>
      </article>`;
    }).join('\n');
    return `  <section data-m="stack" data-year-group style="display: grid; grid-template-columns: 110px 1fr; gap: 30px; padding: 34px 0 6px; align-items: start">
    <h2 data-m="ystick" style="margin: 0; font: 500 clamp(28px, 3vw, 40px) 'EB Garamond', serif; color: rgba(244,244,245,.92); position: sticky; top: 80px">${y}</h2>
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
        <span style="font: 500 12px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: rgba(244,244,245,.66)">${esc(f.label)}</span>
        <span style="font: 300 14.5px/1.9 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.9)">${esc(f.value)}</span>
      </div>`).join('\n');
}

function pressPhotos() {
  const p = data.press || {};
  return (p.photos || []).map((ph) => `      <figure data-reveal style="margin: 0; display: flex; flex-direction: column; gap: 12px; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">
        <div style="border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); aspect-ratio: 4 / 5; background: #0a0a0e">
          <img src="${esc(ph.src)}" alt="${esc(p.name || '')} — ${esc(ph.caption || '')}" style="width: 100%; height: 100%; object-fit: cover; object-position: top" loading="lazy">
        </div>
        <figcaption style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
          <span style="font: 400 12px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.62)">${esc(ph.caption || '')}</span>
          <a href="${esc(ph.src)}" download class="hw" style="font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .06em; color: var(--accent, #6f8cff); text-decoration: none; white-space: nowrap">ダウンロード ↓</a>
        </figcaption>
      </figure>`).join('\n');
}

function pressAwards() {
  return data.research.awards.map((a) => `      <div data-reveal style="display: flex; align-items: baseline; gap: clamp(14px, 3vw, 30px); padding: 16px 6px; border-top: 1px solid rgba(255,255,255,.1); opacity: calc(var(--r, 0)); transition: opacity .9s ease">
        <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.62); white-space: nowrap; width: 96px">${esc(a.year)}</span>
        <span style="flex: 1; font: 400 14.5px/1.7 'Noto Sans JP', sans-serif">${esc(a.name)}</span>
      </div>`).join('\n');
}

function pillarPhoto(key) {
  const p = (data.home.pillarPhotos || {})[key] || {};
  if (p.src) {
    return `      <img src="${esc(p.src)}" alt="${esc(p.alt || '')}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`;
  }
  return `      <div data-slot="photo-${key}" style="position: absolute; inset: 0"></div>`;
}

/* ---------------- pages ---------------- */

const pages = [
  {
    file: 'index.html',
    active: 'Home',
    isHome: true,
    canonicalPath: '/',
    title: '船越温 / Tsutsumu Funakoshi — 社会のためのイノベーション。',
    desc: data.home.tagline,
    tokens: {
      '{{GAME_TILES}}': gameTiles(),
      '{{NEWS_ROWS}}': newsRows(),
      '{{PHOTO_RESEARCH}}': pillarPhoto('research'),
      '{{PHOTO_POLITICS}}': pillarPhoto('politics'),
      '{{PHOTO_GOVERNANCE}}': pillarPhoto('governance'),
      '{{PHOTO_MUSIC}}': pillarPhoto('music')
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
      '{{ABOUT_VIDEO}}': aboutVideo(),
      '{{TIMELINE_ITEMS}}': timelineItems()
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
    desc: '個人で開発した Web アプリとゲーム、9本。主権者教育アプリ、生活制度ナビ、歴史・哲学ゲームなど。',
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
];

/* ---------------- write dist ---------------- */

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// static assets
fs.cpSync(path.join(SRC, 'static'), DIST, { recursive: true });
fs.cpSync(path.join(SRC, 'images'), path.join(DIST, 'images'), { recursive: true });

for (const page of pages) {
  let html = read(path.join('templates', page.file));
  html = html
    .replace('{{HEAD}}', headHtml(page))
    .replace('{{NAV}}', navHtml(page.active, !!page.isHome))
    .replace('{{FOOTER}}', footerHtml(!!page.isHome));
  for (const [token, value] of Object.entries(page.tokens || {})) {
    html = html.replaceAll(token, value);
  }
  const leftover = html.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`${page.file}: unresolved token ${leftover[0]}`);
  fs.writeFileSync(path.join(DIST, page.file), html);
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
const llms = `# 船越温 / Tsutsumu Funakoshi — ポートフォリオ

> うどん県（香川県）在住の高校3年生・船越温の個人サイト。コンセプトは「社会のためのイノベーション。」。廃棄うどんを原料とする水素・SAF・ナフサ生成の研究、議員訪問や主権者教育アプリなどの政治活動、生徒会長としての制度設計、そしてヴァイオリン・声楽などの音楽活動を記録している。

## 人物

- 香川県立高松高等学校3年。第152代生徒会長
- 研究: 廃棄うどんを用いた高効率水素生成プロセスの設計と最適化（東京大学生産技術研究所 Aziz研究室の指導、現・東北大学）
- 受賞: ${data.research.awards.map((a) => a.name).join(' / ')}
- 音楽: かがわジュニア・フィルハーモニック・オーケストラ（KJO）所属。第25回定期演奏会コンサートマスター（予定）。第九バリトンソロ、香川ジュニア音楽コンクール銀賞

## ページ

- [Home](${SITE}/): 研究・政治・制度設計・音楽を束ねる自己紹介
- [About](${SITE}/about.html): プロフィール・経歴タイムライン
- [Research](${SITE}/research.html): 廃棄うどん研究の詳細（統計・プロセス・受賞）
- [Works](${SITE}/works.html): 個人開発の Web アプリとゲーム9本
- [Archive](${SITE}/archive.html): 活動の時系列記録（記事全文）
- [Contact](${SITE}/contact.html): お問い合わせ（フォーム・メール・SNS）

## 連絡先

- Email: ${data.contact.email}
- X: https://x.com/funa_sun273
- GitHub: https://github.com/funasun/
`;
fs.writeFileSync(path.join(DIST, 'llms.txt'), llms);

console.log(`Built ${pages.length} pages → dist/`);
