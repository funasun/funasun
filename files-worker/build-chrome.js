#!/usr/bin/env node
/* ============================================================
   受け取りページ（Worker が作る /f/ /g/ など）に載せる
   サイト共通のナビとフッターを、サイト本体と同じ部品から生成する。

   なぜ生成か: Worker のページは tsutsumufunakoshi.com とは別の機械が
   その場で作るので、ビルド時の {{NAV}} 差し込みが届かない。
   かといって手書きで写すと、本体を直したときに必ずずれる。
   そこで、同じ src/partials/ と data.json から
   「絶対URL版」を作って chrome.gen.js に書き出し、worker が読み込む。

   wrangler.toml の [build] で deploy のたびに自動実行される。
   chrome.gen.js は生成物なので直接編集しない。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const SITE = 'https://tsutsumufunakoshi.com/';

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data.json'), 'utf8'));
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

// {{T:footer.h2}} のような文言を data.json の texts から埋める（build.js と同じ規則）
function resolveTexts(html) {
  return html.replace(/\{\{T:([A-Za-z0-9_.]+)\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data.texts);
    if (typeof v !== 'string') throw new Error('data.json の texts に無い文言: ' + key);
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\r?\n/g, '<br>');
  });
}

// リンクは全部、サイト本体への絶対URLにする（ここは別ドメインなので）
const off = '#d8d8da';
const nav = read('partials/nav.html')
  .replaceAll('{{P}}', SITE)
  .replaceAll('{{HOME_HREF}}', SITE)
  .replace('{{C_HOME}}', off).replace('{{C_ABOUT}}', off)
  .replace('{{C_RESEARCH}}', off).replace('{{C_WORKS}}', off)
  .replace('{{C_ARCHIVE}}', off).replace('{{C_HENRO}}', off)
  .replace('{{C_CONTACT}}', off);

const footer = resolveTexts(read('partials/footer.html')
  .replaceAll('{{P}}', SITE)
  .replaceAll('{{HOME_HREF}}', SITE));

/* ナビの畳み方・ハンバーガーの見た目はサイトの css に入っているので、
   それを読み込む。開け閉めだけ小さな台本をここに持つ（site.js を丸ごと
   入れると本体ページ用の演出まで付いてくるため）。 */
const head = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Serif+JP:wght@500;600&family=Noto+Sans+JP:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${SITE}css/site.css">`;

const support = `<script>
(function () {
  var b = document.querySelector('.nav-burger');
  if (!b) return;
  b.addEventListener('click', function () { document.body.classList.toggle('menu-open'); });
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 820) document.body.classList.remove('menu-open');
  });
})();
</script>`;

const out = `/* 自動生成ファイル。直接編集しない（build-chrome.js が作る）。 */
export const CHROME_HEAD = ${JSON.stringify(head)};
export const NAV_HTML = ${JSON.stringify(nav + '\n' + support)};
export const FOOTER_HTML = ${JSON.stringify(footer)};
`;
fs.writeFileSync(path.join(__dirname, 'chrome.gen.js'), out);
console.log('chrome.gen.js を生成した（nav ' + nav.length + '字 / footer ' + footer.length + '字）');
