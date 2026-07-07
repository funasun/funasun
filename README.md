# tsutsumufunakoshi.com — Portfolio v2

船越温 個人サイト。素の HTML/CSS/JS + Node ビルドスクリプトによる完全静的サイト。フレームワーク・依存パッケージなし。

## ビルド

```sh
node build.js        # dist/ に全ページ + sitemap.xml / robots.txt / llms.txt を生成
npm run serve        # ビルドしてローカルプレビュー (npx serve)
```

Node 18+ のみ必要。`npm install` は不要。

## 構成

```
build.js             ビルドスクリプト（data.json をテンプレートに焼き込む）
src/
  data.json          全コンテンツの単一ソース（記事・受賞・作品・年表など）
  templates/         各ページの HTML テンプレート（{{TOKEN}} 置換）
  partials/          nav / footer 共通部品
  static/css|js/     共有 CSS と site.js（スクロール演出・フィルタ・アコーディオン）
  images/            画像一式（og.png 含む）
dist/                ビルド成果物（git 管理外）
og-src.html          OG 画像の生成元。変更したら headless Chrome で 1200×630 撮影し直す:
                     chrome --headless --window-size=1200,630 --screenshot=src/images/og.png og-src.html
```

## コンテンツ更新（共通フロー）

1. 下記のページ別ガイドに従って `src/data.json`（またはテンプレート）を編集
2. `node build.js` でビルド（`npm run serve` でローカルプレビュー）
3. `git add . && git commit -m "変更内容" && git push` → Actions が自動デプロイ

ほとんどのコンテンツは `src/data.json` に集約されていますが、**Home の文章だけは例外**で、スクロール演出と一体のためテンプレート `src/templates/index.html` に直接書かれています。

## ページ別更新ガイド

### Home（index.html）

**文章の書き換え** → `src/templates/index.html` を直接編集。各セクションは `id` で探せる（エディタで検索）:

| 内容 | 探し方 |
|---|---|
| ヒーロー「高校生。ただし、少し欲張りな。」 | `id="top"` のブロック内 |
| 導入の4行（廃棄うどんで水素を作る。…）と「バラバラに見える。」 | ヒーローの次の `data-scene` ブロック |
| 柱01 研究（見出し・説明文・実績2行） | `id="research"` |
| 柱02 政治 | `id="politics"` |
| 柱03 制度設計 | `id="governance"` |
| ゲーム帯の見出し「研究と、政治と、制度設計。」 | `id="works"` |
| 柱04 音楽 | `id="music"` |
| About ティザーの紹介文 | `id="about"` |

**キャッチコピー（演出付きテキスト）の書き換え方**

「廃棄うどんで水素を作る。」のようなスクロール演出付きの文言も、書き換えるのは**タグの中の日本語テキストだけ**。行はこんな形をしている:

```html
<p data-seg="0.04,0.14" data-dim="0.68,0.8" style="margin: 0; font: 500 ...">廃棄うどんで水素を作る。</p>
```

このうち末尾の `>廃棄うどんで水素を作る。</p>` の**テキスト部分だけ**を差し替える。`data-seg` / `data-out` / `style="…"` はスクロール演出（出るタイミング・動き・見た目）の設定なので触らない。

注意点:

- 見出し内の `<br>` は改行位置の指定（例: `廃棄うどんで<br>水素を作る。`）。文言に合わせて `<br>` の位置は動かしてよい
- 「バラバラに見える。」の行には `white-space: nowrap`（折り返し禁止）が付いているので、大幅に長い文にするとスマホではみ出す。同じくらいの文字数に収める
- ヒーローの名前「船越 温」だけは特殊で、1文字ずつ `<span>` に分かれている（1文字ごとに順番に現れる演出のため）。変える場合は文字数分の `<span>` を用意する
- 同じ文言が複数箇所に出ることがある（例: 「研究」「政治」「制度設計」はゲーム帯前後の浮遊テキストにも登場）。全部変えたいときはエディタの検索で漏れなく拾う
- 書き換えたら `node build.js` → `npm run serve` でスクロールして表示を確認してから push するのが安全

**data.json 側にあるもの**（`home` キー配下）:

| 内容 | data.json のキー |
|---|---|
| News 3件（Home 下部） | `home.newsItems` — 新しいものを先頭に、3件程度を維持 |
| ゲーム帯のカード5枚 | `home.gameTiles`（title / desc / tilt） |
| 柱の背景写真 | `home.pillarPhotos`（後述） |
| meta description・JSON-LD 用の自己紹介文 | `home.tagline`（ページには表示されない） |

### About（about.html）

すべて `src/data.json` の `about` 配下:

- 紹介文: `about.prose`（改行はそのまま反映）
- 見出し: `about.heading`
- 所属などのメタ表: `about.meta`（label / value の配列）
- 経歴タイムライン: `about.timeline` — 新しいものを先頭に
- ポートレート写真: `about.images[0].src`

### Research（research.html）

すべて `src/data.json` の `research` 配下:

- 見出し・課題文: `research.heading` / `research.problem`
- 数字カウンター3つ: `research.stats`（value / suffix / label）
- 本文3段落: `research.story`（文字列の配列）
- ポスター画像: `research.poster`
- キーワードタグ: `research.keywords`
- 受賞歴: `research.awards`（year / name / org）— 新しいものを先頭に

### Works（works.html）

`src/data.json` の `worksItems` 配列に追記:

- `type` は `Web App` か `Game`（フィルタに使われる）
- `status` は `live`（公開中）か `wip`（開発中）
- `liveUrl` が空文字ならリンクなしカードになる
- `thumbnail` が空文字なら「app screenshot」プレースホルダー

### Archive（archive.html）— 記事を追加する

`src/data.json` の `articles` 配列の**先頭**にオブジェクトを追記:

```json
{
  "slug": "example-2026",
  "title": "記事タイトル",
  "date": "2026.09.01",
  "category": "Research",
  "excerpt": "一覧の行に出る短い説明。",
  "body": "本文。改行はそのまま反映される。",
  "images": [{ "src": "images/example.webp", "caption": "写真の説明" }],
  "links": [{ "label": "関連リンク", "url": "https://..." }]
}
```

- `category` は `Research` / `Politics` / `Music` / `Leadership` のいずれか（フィルタに使われる）
- `date` の年で自動的に年グループへ振り分けられる
- `images` / `links` は**キー自体は必須**。写真やリンクがなければ空配列 `[]` にする（省略するとビルドが落ちる）
- `slug` はページ内リンク（`archive.html#slug`）と旧 `?p=` リダイレクトの両方に使われる。ユニークにすること
- 大きな出来事なら `home.newsItems`（Home の News 3件）と `about.timeline` にも追記する

### 全ページ共通（フッター・ナビ）

これらは data.json ではなく **partial の HTML** に直接書かれている:

- メールアドレス・SNS リンク: `src/partials/footer.html`（`contact` キーではなくフッター内に直書き）
- フッターの見出し「話しましょう。」やコピー「社会のためのイノベーション。」: `src/partials/footer.html`
- ナビのリンク: `src/partials/nav.html`
- サイトタイトル・URL・description 用データ: `src/data.json` の `site` / `contact`

## 写真の追加（共通）

1. 画像を `src/images/` に置く（webp 推奨。`cwebp -q 82 in.jpg -o out.webp` などで変換）
2. data.json から `images/ファイル名.webp` で参照する

主な参照場所:

| 場所 | data.json のキー |
|---|---|
| 記事の写真 | `articles[].images[].src` |
| Home 柱セクションの背景写真 | `home.pillarPhotos.{research,politics,governance,music}.src` |
| Works のサムネイル | `worksItems[].thumbnail`（空文字なら「app screenshot」プレースホルダー） |
| About のポートレート | `about.images[0].src` |
| Research のポスター | `research.poster` |

### Home の柱（研究・政治・制度設計・音楽）に写真を出す

`home.pillarPhotos` の `src` にパスを入れるだけ:

```json
"pillarPhotos": {
  "research":   { "src": "images/kankyo1.webp", "alt": "研究活動の写真" },
  "politics":   { "src": "images/diet.webp",    "alt": "政治活動の写真" },
  "governance": { "src": "",                    "alt": "生徒会活動の写真" },
  "music":      { "src": "",                    "alt": "音楽活動の写真" }
}
```

- 写真はセクションの背景全面に表示され、説明文側に黒グラデーションがかかるので文字はそのまま読める
- スクロールに合わせてワイプで現れる演出も自動で適用される
- `src` が空文字なら従来どおり黒のプレースホルダー
- 横長・高解像度（1600px 以上目安）の写真が向いている

## 未撮影素材の差し替え

黒プレースホルダーのままの箇所:

- **4本柱のセクション写真 × 4** — 上記のとおり `home.pillarPhotos` の `src` にパスを入れるだけ
- **回転オブジェクト切り抜き PNG × 4**（うどん・マイク・本・ヴァイオリン）— こちらはテンプレート側。撮影後、透過 PNG を `src/images/` に置き、`src/templates/index.html` 内の `data-slot="obj-*"` の div を `<img>` に差し替える

## デプロイ

リポジトリは `github.com/funasun/funasun`（Pages Source は「GitHub Actions」設定済み）。`main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）が `node build.js` → GitHub Pages へデプロイする。

```sh
node build.js        # ローカルで確認（npm run serve でプレビュー）
git add .
git commit -m "変更内容"
git push
```

push するだけで自動デプロイされる。`dist/` は .gitignore 済みなのでコミットされない（Actions がサーバー側でビルドする）。デプロイ状況は GitHub の **Actions** タブで確認できる。

### カスタムドメイン

旧サイトから引き継いだ `src/static/CNAME`（tsutsumufunakoshi.com）がビルドで dist に含まれるため、ドメインの紐付けは自動で維持される。`src/static/google1e2a64aee0096974.html`（Search Console 所有権確認）も同様に配信される。

### 旧 URL 互換

旧サイトの `/?p=slug` 形式 URL は index.html 内のスクリプトで `archive.html#slug` にリダイレクトし、該当記事のアコーディオンが自動で開く。

## AI 検索対応

- 全コンテンツは JS なしで読める静的 HTML に焼き込み済み（スクロール演出は opacity のみで隠す。display:none 不使用）
- JSON-LD: 全ページ Person スキーマ、archive.html は各記事の Article スキーマ
- robots.txt で GPTBot / ClaudeBot / Claude-Web / Google-Extended / PerplexityBot / CCBot を明示許可
- llms.txt / sitemap.xml をビルド時に自動生成
