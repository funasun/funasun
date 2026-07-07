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
  const off = 'rgba(244,244,245,.55)';
  return read('partials/nav.html')
    .replaceAll('{{HOME_HREF}}', isHome ? '#top' : 'index.html')
    .replace('{{C_HOME}}', active === 'Home' ? on : off)
    .replace('{{C_ABOUT}}', active === 'About' ? on : off)
    .replace('{{C_RESEARCH}}', active === 'Research' ? on : off)
    .replace('{{C_WORKS}}', active === 'Works' ? on : off)
    .replace('{{C_ARCHIVE}}', active === 'Archive' ? on : off);
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Noto+Serif+JP:wght@500;600&family=Noto+Sans+JP:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/site.css">
${ldTags}`;
}

/* ---------------- fragments ---------------- */

function gameTiles() {
  return data.home.gameTiles.map((g) => `      <div class="gcard" style="--tilt: ${g.tilt}; flex: none; width: clamp(240px, 24vw, 360px); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f">
        <div style="aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
          <span style="font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.4)">app screenshot</span>
        </div>
        <div style="padding: 16px 18px 20px">
          <h3 style="margin: 0 0 5px; font: 500 15px 'Noto Sans JP', sans-serif">${esc(g.title)}</h3>
          <p style="margin: 0; font: 300 12px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.5)">${esc(g.desc)}</p>
        </div>
      </div>`).join('\n');
}

function newsRows() {
  return data.home.newsItems.map((n) => `    <a href="archive.html" data-reveal data-m="wrap" class="hbg" style="display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; border-top: 1px solid rgba(255,255,255,.1); text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .08em; color: rgba(244,244,245,.45); white-space: nowrap">${esc(n.date)}</span>
      <span style="flex: none; font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.6)">${esc(n.cat)}</span>
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
    .join('<span style="color: rgba(244,244,245,.4)"> / </span>');
}

function metaRows() {
  return data.about.meta.map((m) => `    <div data-reveal data-m="stack6" class="rline" style="position: relative; display: grid; grid-template-columns: 160px 1fr; gap: 24px; padding: 20px 6px; opacity: calc(var(--r, 0)); transition: opacity 1s ease">
      <span style="font: 500 13px 'Noto Sans JP', sans-serif; letter-spacing: .14em; color: rgba(244,244,245,.5)">${esc(m.label)}</span>
      <span style="font: 300 14.5px/1.9 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.8)">${metaValue(m.value)}</span>
    </div>`).join('\n');
}

function timelineItems() {
  return data.about.timeline.map((t) => `      <div data-reveal style="position: relative; display: flex; align-items: baseline; gap: 26px; flex-wrap: wrap; opacity: calc(var(--r, 0)); transform: translateX(calc((1 - var(--r, 0)) * 24px)); transition: opacity .9s ease, transform .9s cubic-bezier(.2,.7,.2,1)">
        <span style="position: absolute; left: -36px; top: 6px; width: 11px; height: 11px; border-radius: 50%; background: #0c0c10; border: 1.5px solid rgba(111,140,255,.8)"></span>
        <span style="font: 500 15px 'EB Garamond', serif; letter-spacing: .1em; color: rgba(244,244,245,.55); width: 90px; white-space: nowrap">${esc(t.year)}</span>
        <span style="flex: 1; min-width: 240px; font: 400 15.5px/1.8 'Noto Sans JP', sans-serif">${esc(t.label)}</span>
      </div>`).join('\n');
}

function statCards() {
  return data.research.stats.map((s) => `    <div data-reveal data-m="statrow" style="padding: 34px 32px 30px; border: 1px solid rgba(255,255,255,.1); border-radius: 18px; background: linear-gradient(160deg, #0c0c11, #08080b); opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 26px)); transition: opacity 1s ease, transform 1s ease">
      <div style="display: flex; align-items: baseline; gap: 4px">
        <span data-count="${s.value}" style="font: 500 clamp(44px, 4.2vw, 64px)/1 'EB Garamond', serif">${s.value.toLocaleString('ja-JP')}</span>
        <span style="font: 500 18px 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.6)">${esc(s.suffix)}</span>
      </div>
      <p style="margin: 14px 0 0; font: 300 13px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.55)">${esc(s.label)}</p>
    </div>`).join('\n');
}

function storyParas() {
  return data.research.story.map((p) => `    <p data-reveal style="margin: 0; font: 300 15px/2.3 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.72); text-wrap: pretty; opacity: calc(var(--r, 0)); transform: translateY(calc((1 - var(--r, 0)) * 20px)); transition: opacity 1s ease, transform 1s ease">${esc(p)}</p>`).join('\n');
}

function keywordChips() {
  return data.research.keywords.map((kw) => `    <span style="font: 400 12px 'Noto Sans JP', sans-serif; letter-spacing: .1em; padding: 6px 16px; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; color: rgba(244,244,245,.65)">${esc(kw)}</span>`).join('\n');
}

function awardRows() {
  return data.research.awards.map((a) => `    <a href="archive.html" data-reveal data-m="wrap" class="rline hbg" style="position: relative; display: flex; align-items: baseline; gap: clamp(16px, 3vw, 36px); padding: 22px 6px; text-decoration: none; color: #f4f4f5; opacity: calc(var(--r, 0)); transition: opacity .9s ease, background .3s ease">
      <span style="font: 400 13.5px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.45); white-space: nowrap; width: 100px">${esc(a.year)}</span>
      <span style="flex: 1; display: flex; flex-direction: column; gap: 3px">
        <span style="font: 400 15.5px/1.7 'Noto Sans JP', sans-serif">${esc(a.name)}</span>
        <span style="font: 300 12.5px 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.45)">${esc(a.org)}</span>
      </span>
      <span style="color: var(--accent, #6f8cff)">→</span>
    </a>`).join('\n');
}

function workCards() {
  return data.worksItems.map((w) => {
    const url = w.liveUrl || '#';
    const statusStyle = w.status === 'live'
      ? "font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(111,140,255,.5); color: var(--accent, #6f8cff)"
      : "font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); color: rgba(244,244,245,.45)";
    const thumb = w.thumbnail
      ? `<img src="${esc(w.thumbnail)}" alt="${esc(w.title)}のスクリーンショット" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover" loading="lazy">`
      : `<span style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.4)">app screenshot</span>`;
    return `    <a href="${esc(url)}" target="_blank" rel="noopener" data-type="${esc(w.type)}" class="wcard" style="display: block; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; overflow: hidden; background: #0b0b0f; text-decoration: none; color: #f4f4f5">
      <div style="aspect-ratio: 16 / 10; position: relative; background: repeating-linear-gradient(45deg, #0e0e13 0 12px, #101017 12px 24px)">
        ${thumb}
      </div>
      <div style="padding: 18px 20px 22px">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px">
          <span style="font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.6)">${esc(w.type)}</span>
          <span style="${statusStyle}">${w.status === 'live' ? '公開中' : '開発中'}</span>
        </div>
        <h3 style="margin: 0 0 6px; font: 500 16px 'Noto Sans JP', sans-serif">${esc(w.title)}</h3>
        <p style="margin: 0; font: 300 12.5px/1.8 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.5)">${esc(w.description)}</p>
      </div>
    </a>`;
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
          <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px">
${a.images.map((im) => `            <figure style="margin: 0; display: flex; flex-direction: column; gap: 8px">
              <div style="width: 260px; height: 190px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,.12)">
                <img src="${esc(im.src)}" alt="${esc(a.title)} — ${esc(im.caption)}" style="width: 100%; height: 100%; object-fit: cover" loading="lazy">
              </div>
              <figcaption style="font: 400 11px ui-monospace, Menlo, monospace; color: rgba(244,244,245,.4)">${esc(im.caption)}</figcaption>
            </figure>`).join('\n')}
          </div>` : '';
      const links = a.links.length ? `
          <div style="display: flex; gap: 24px; flex-wrap: wrap">
${a.links.map((lk) => `            <a href="${esc(lk.url)}" target="_blank" rel="noopener" style="font: 400 13px 'Noto Sans JP', sans-serif; letter-spacing: .08em; color: var(--accent, #6f8cff); text-decoration: none">${esc(lk.label)}　↗</a>`).join('\n')}
          </div>` : '';
      return `      <article class="arch-item" id="${esc(a.slug)}" data-type="${esc(a.category)}" style="border-top: 1px solid rgba(255,255,255,.1)">
        <div class="arch-row hbg" data-m="wrap" style="display: flex; align-items: baseline; gap: clamp(14px, 2.6vw, 30px); padding: 20px 6px; cursor: pointer">
          <span style="font: 400 13px 'EB Garamond', serif; letter-spacing: .06em; color: rgba(244,244,245,.45); white-space: nowrap; width: 52px">${esc(a.date.slice(5) || '—')}</span>
          <span style="flex: none; font: 400 10.5px 'Noto Sans JP', sans-serif; letter-spacing: .12em; padding: 3px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; color: rgba(244,244,245,.6)">${esc(a.category)}</span>
          <span style="flex: 1; display: flex; flex-direction: column; gap: 4px">
            <span style="font: 400 15px/1.6 'Noto Sans JP', sans-serif">${esc(a.title)}</span>
            <span style="font: 300 12.5px/1.7 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.45)">${esc(a.excerpt)}</span>
          </span>
          <span class="chev">↓</span>
        </div>
        <div class="acc-body" data-m="pad0" style="padding: 6px 6px 30px calc(52px + clamp(14px, 2.6vw, 30px))">
          <p style="margin: 0 0 20px; font: 300 14.5px/2.2 'Noto Sans JP', sans-serif; color: rgba(244,244,245,.75); max-width: 640px; white-space: pre-line; text-wrap: pretty">${esc(a.body)}</p>${images}${links}
        </div>
      </article>`;
    }).join('\n');
    return `  <section data-m="stack" data-year-group style="display: grid; grid-template-columns: 110px 1fr; gap: 30px; padding: 34px 0 6px; align-items: start">
    <h2 data-m="ystick" style="margin: 0; font: 500 clamp(28px, 3vw, 40px) 'EB Garamond', serif; color: rgba(244,244,245,.85); position: sticky; top: 80px">${y}</h2>
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
    file: 'archive.html',
    active: 'Archive',
    canonicalPath: '/archive.html',
    title: 'Archive 活動記録 — 船越温 / Tsutsumu Funakoshi',
    desc: '受賞、議員訪問、発表、演奏会。船越温の活動の時系列記録。',
    tokens: { '{{ARCHIVE_SECTIONS}}': archiveSections() },
    extraLd: articleLds()
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
    html = html.replace(token, value);
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

## 連絡先

- Email: ${data.contact.email}
- X: https://x.com/funa_sun273
- GitHub: https://github.com/funasun/
`;
fs.writeFileSync(path.join(DIST, 'llms.txt'), llms);

console.log(`Built ${pages.length} pages → dist/`);
