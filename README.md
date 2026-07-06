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

## コンテンツ更新

すべて `src/data.json` を編集 → `node build.js` → push（Actions が自動デプロイ）。テンプレート HTML を触る必要はありません。

### 記事を追加する（Archive）

`articles` 配列の**先頭**にオブジェクトを追記:

```json
{
  "slug": "example-2026",
  "title": "記事タイトル",
  "date": "2026.09.01",
  "category": "Research",
  "excerpt": "一覧の行に出る短い説明。",
  "body": "本文。改行はそのまま反映される。",
  "figures": [{ "src": "images/example.webp", "caption": "写真の説明" }],
  "links": [{ "label": "関連リンク", "url": "https://..." }]
}
```

- `category` は `Research` / `Politics` / `Music` / `Leadership` のいずれか（フィルタに使われる）
- `date` の年で自動的に年グループへ振り分けられる
- `figures` / `links` は不要なら省略可
- `slug` はページ内リンク（`archive.html#slug`）と旧 `?p=` リダイレクトの両方に使われる。ユニークにすること
- 大きな出来事なら `home.newsItems`（Home の News 3件）と `about.timeline` にも追記する

### 写真を追加する

1. 画像を `src/images/` に置く（webp 推奨。`cwebp -q 82 in.jpg -o out.webp` などで変換）
2. data.json から `images/ファイル名.webp` で参照する

主な参照場所:

| 場所 | data.json のキー |
|---|---|
| 記事の写真 | `articles[].figures[].src` |
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

### Works（アプリ・ゲーム）を追加する

`worksItems` 配列に追記。`type` は `Web App` か `Game`、`status` は `live`（公開中）か `wip`（開発中）、`liveUrl` が空ならリンクなしカードになる。

### その他の更新箇所

- News（Home 下部の3件）: `home.newsItems` — 新しいものを先頭に、3件程度を維持
- 経歴タイムライン: `about.timeline` — 新しいものを先頭に
- 受賞（Research ページ）: `research.awards`
- メール・SNS: `contact`

## 未撮影素材の差し替え

黒プレースホルダーのままの箇所:

- **4本柱のセクション写真 × 4** — 上記のとおり `home.pillarPhotos` の `src` にパスを入れるだけ
- **回転オブジェクト切り抜き PNG × 4**（うどん・マイク・本・ヴァイオリン）— こちらはテンプレート側。撮影後、透過 PNG を `src/images/` に置き、`src/templates/index.html` 内の `data-slot="obj-*"` の div を `<img>` に差し替える

## デプロイ

`main` に push すると GitHub Actions（`.github/workflows/deploy.yml`）が `node build.js` → GitHub Pages へデプロイ。リポジトリ設定で **Settings → Pages → Source: GitHub Actions** を選択しておくこと。

### 初回プッシュ手順

**このフォルダ（portfolio-v2）をリポジトリのルートにすること**（`.github/workflows/` がルートにないと Actions が動かない）。

```sh
# 1. GitHub でリポジトリを新規作成（README 等は追加しない・空のまま）

# 2. このフォルダを git リポジトリ化してコミット
cd portfolio-v2
git init
git add .
git commit -m "Initial commit"

# 3. リモートを登録して push
git branch -M main
git remote add origin https://github.com/funasun/リポジトリ名.git
git push -u origin main
```

push 後に GitHub 上で:

1. **Settings → Pages → Build and deployment → Source** を「**GitHub Actions**」に変更
2. **Actions** タブでワークフローが緑になるのを確認（初回は Pages 設定前に失敗していたら「Re-run jobs」）
3. `https://funasun.github.io/リポジトリ名/` で表示確認

### 2回目以降の更新

```sh
node build.js        # ローカルで確認（npm run serve でプレビュー）
git add .
git commit -m "変更内容"
git push
```

push するだけで自動デプロイされる。`dist/` は .gitignore 済みなのでコミットされない（Actions がサーバー側でビルドする）。

### カスタムドメイン

旧サイトから引き継いだ `src/static/CNAME`（tsutsumufunakoshi.com）がビルドで dist に含まれるため、ドメインの紐付けは自動で維持される。`src/static/google1e2a64aee0096974.html`（Search Console 所有権確認）も同様に配信される。

### 旧 URL 互換

旧サイトの `/?p=slug` 形式 URL は index.html 内のスクリプトで `archive.html#slug` にリダイレクトし、該当記事のアコーディオンが自動で開く。

## AI 検索対応

- 全コンテンツは JS なしで読める静的 HTML に焼き込み済み（スクロール演出は opacity のみで隠す。display:none 不使用）
- JSON-LD: 全ページ Person スキーマ、archive.html は各記事の Article スキーマ
- robots.txt で GPTBot / ClaudeBot / Claude-Web / Google-Extended / PerplexityBot / CCBot を明示許可
- llms.txt / sitemap.xml をビルド時に自動生成
