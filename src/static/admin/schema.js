/* ============================================================
   admin/schema.js — data.json の「編集できる項目」の定義
   ------------------------------------------------------------
   ここに書いた通りに、編集ツールが自動でフォームを組み立てる。
   将来 data.json に項目を足したら、ここに1行足すだけで編集欄が増える。

   フィールドの type:
     text      … 1行入力
     textarea  … 複数行入力（改行OK）
     number    … 数値
     select    … 選択（options: [{value,label}]）
     image     … 画像（選ぶと自動で webp 化してアップ）
     group     … 入れ子オブジェクト（fields を持つ）
     strlist   … 文字列の配列（段落やキーワードなど）
     list      … オブジェクトの配列（item に子フィールド定義）
   ============================================================ */
(function (global) {
  'use strict';

  var CATEGORIES = ['Research', 'Politics', 'Music', 'Leadership'];
  var catOptions = CATEGORIES.map(function (c) { return { value: c, label: c }; });

  var SCHEMA = [
    {
      id: 'home', label: 'ホーム', base: 'home',
      fields: [
        { key: 'tagline', label: 'キャッチ文', type: 'textarea' },
        {
          key: 'newsItems', label: '新着ニュース', type: 'list',
          itemLabel: function (o) { return o.title || '（見出し未入力）'; },
          item: [
            { key: 'date', label: '日付', type: 'text', placeholder: '2026.07.01' },
            { key: 'cat', label: 'カテゴリ', type: 'text', placeholder: '研究 / 開発 / 音楽 など' },
            { key: 'title', label: '見出し', type: 'text' }
          ]
        },
        {
          key: 'gameTiles', label: 'ホームの作品カード', type: 'list',
          itemLabel: function (o) { return o.title || '（タイトル未入力）'; },
          item: [
            { key: 'title', label: 'タイトル', type: 'text' },
            { key: 'desc', label: 'ひとこと説明', type: 'text' },
            { key: 'tilt', label: '傾き（そのままでOK）', type: 'text', placeholder: '-1.2deg' }
          ]
        },
        {
          key: 'pillarPhotos', label: '柱の背景写真', type: 'group',
          fields: [
            { key: 'research', label: '研究', type: 'group', fields: [
              { key: 'src', label: '写真', type: 'image' }, { key: 'alt', label: '説明（alt）', type: 'text' } ] },
            { key: 'politics', label: '政治', type: 'group', fields: [
              { key: 'src', label: '写真', type: 'image' }, { key: 'alt', label: '説明（alt）', type: 'text' } ] },
            { key: 'governance', label: '生徒会', type: 'group', fields: [
              { key: 'src', label: '写真', type: 'image' }, { key: 'alt', label: '説明（alt）', type: 'text' } ] },
            { key: 'music', label: '音楽', type: 'group', fields: [
              { key: 'src', label: '写真', type: 'image' }, { key: 'alt', label: '説明（alt）', type: 'text' } ] }
          ]
        }
      ]
    },

    {
      id: 'about', label: 'About', base: 'about',
      fields: [
        { key: 'heading', label: '見出し', type: 'text' },
        { key: 'prose', label: '本文', type: 'textarea' },
        {
          key: 'video', label: '演奏動画', type: 'group',
          fields: [
            { key: 'ytid', label: 'YouTube ID', type: 'text', placeholder: '例: IW_ZmnryWgs' },
            { key: 'title', label: 'タイトル', type: 'text' },
            { key: 'caption', label: 'キャプション', type: 'text' },
            { key: 'poster', label: 'サムネイル画像', type: 'image' }
          ]
        },
        {
          key: 'meta', label: 'プロフィール項目', type: 'list',
          itemLabel: function (o) { return o.label || '（項目名）'; },
          item: [
            { key: 'label', label: '項目名', type: 'text', placeholder: '所属 / 趣味 など' },
            { key: 'value', label: '内容', type: 'text' }
          ]
        },
        {
          key: 'timeline', label: '経歴タイムライン', type: 'list',
          itemLabel: function (o) { return (o.year || '') + ' ' + (o.label || ''); },
          item: [
            { key: 'year', label: '年月', type: 'text', placeholder: '2026 / 8' },
            { key: 'label', label: '内容', type: 'text' }
          ]
        },
        {
          key: 'images', label: 'About の写真', type: 'list',
          itemLabel: function (o) { return o.src || '（画像未設定）'; },
          item: [
            { key: 'src', label: '画像', type: 'image' },
            { key: 'position', label: '表示位置', type: 'text', placeholder: 'top など' }
          ]
        }
      ]
    },

    {
      id: 'research', label: 'Research', base: 'research',
      fields: [
        { key: 'heading', label: '見出し', type: 'text' },
        { key: 'problem', label: '問題提起', type: 'textarea' },
        { key: 'story', label: '本文（段落ごと）', type: 'strlist', placeholder: '1つの段落を入力' },
        { key: 'keywords', label: 'キーワード', type: 'strlist', placeholder: '例: 水素' },
        { key: 'poster', label: 'ポスター画像', type: 'image' },
        {
          key: 'stats', label: '数字カード', type: 'list',
          itemLabel: function (o) { return (o.value != null ? o.value : '') + (o.suffix || ''); },
          item: [
            { key: 'value', label: '数値', type: 'number' },
            { key: 'suffix', label: '単位', type: 'text', placeholder: 'トン+ / 玉 など' },
            { key: 'label', label: '説明', type: 'text' }
          ]
        },
        {
          key: 'awards', label: '受賞', type: 'list',
          itemLabel: function (o) { return o.name || '（受賞名）'; },
          item: [
            { key: 'year', label: '年月', type: 'text', placeholder: '2026 / 7' },
            { key: 'name', label: '受賞名', type: 'text' },
            { key: 'org', label: '主催・団体', type: 'text' }
          ]
        }
      ]
    },

    {
      id: 'works', label: 'Works（開発）', base: '', arrayPath: 'worksItems',
      listLabel: '作品', itemLabel: function (o) { return o.title || '（タイトル未入力）'; },
      item: [
        { key: 'title', label: 'タイトル', type: 'text' },
        { key: 'type', label: '種類', type: 'text', placeholder: 'Web App / Game' },
        { key: 'status', label: '状態', type: 'select', options: [
          { value: 'live', label: '公開中' }, { value: 'wip', label: '開発中' } ] },
        { key: 'description', label: '説明', type: 'textarea' },
        { key: 'thumbnail', label: 'サムネイル', type: 'image' },
        { key: 'liveUrl', label: '公開URL', type: 'text', placeholder: 'https://…（無ければ空欄）' }
      ]
    },

    {
      id: 'articles', label: 'Archive（活動記録）', base: '', arrayPath: 'articles',
      listLabel: '記事', itemLabel: function (o) { return (o.date || '') + ' ' + (o.title || '（無題）'); },
      item: [
        { key: 'date', label: '日付', type: 'text', placeholder: '2026.07.01' },
        { key: 'title', label: 'タイトル', type: 'text' },
        { key: 'slug', label: 'スラッグ（URL用・英数字）', type: 'text', placeholder: 'my-article' },
        { key: 'category', label: 'カテゴリ', type: 'select', options: catOptions },
        { key: 'excerpt', label: '要約（一覧に出る短文）', type: 'text' },
        { key: 'body', label: '本文', type: 'textarea' },
        {
          key: 'links', label: 'リンク', type: 'list',
          itemLabel: function (o) { return o.label || o.url || '（リンク）'; },
          item: [
            { key: 'label', label: 'ラベル', type: 'text' },
            { key: 'url', label: 'URL', type: 'text', placeholder: 'https://…' }
          ]
        },
        {
          key: 'images', label: '写真', type: 'list',
          itemLabel: function (o) { return o.caption || o.src || '（画像）'; },
          item: [
            { key: 'src', label: '画像', type: 'image' },
            { key: 'caption', label: 'キャプション', type: 'text' }
          ]
        }
      ]
    },

    {
      id: 'press', label: 'Press（プレスキット）', base: 'press',
      fields: [
        { key: 'catch', label: 'キャッチコピー', type: 'text' },
        { key: 'name', label: '氏名', type: 'text' },
        { key: 'nameRomaji', label: '氏名（ローマ字）', type: 'text' },
        { key: 'nameKana', label: '氏名（かな）', type: 'text' },
        { key: 'bioShort', label: '略歴（短）', type: 'textarea' },
        { key: 'bioLong', label: '略歴（長）', type: 'textarea' },
        {
          key: 'facts', label: '基本情報', type: 'list',
          itemLabel: function (o) { return o.label || '（項目）'; },
          item: [
            { key: 'label', label: '項目名', type: 'text' },
            { key: 'value', label: '内容', type: 'text' }
          ]
        },
        {
          key: 'photos', label: 'ポートレート写真', type: 'list',
          itemLabel: function (o) { return o.caption || o.src || '（写真）'; },
          item: [
            { key: 'src', label: '写真', type: 'image' },
            { key: 'caption', label: 'キャプション', type: 'text' }
          ]
        }
      ]
    },

    {
      id: 'contact', label: '連絡先', base: 'contact',
      fields: [
        { key: 'email', label: 'メールアドレス', type: 'text' },
        {
          key: 'links', label: 'SNS・リンク', type: 'list',
          itemLabel: function (o) { return o.label || '（リンク）'; },
          item: [
            { key: 'label', label: 'ラベル', type: 'text' },
            { key: 'url', label: 'URL', type: 'text' },
            { key: 'arrow', label: '表示テキスト', type: 'text' }
          ]
        }
      ]
    },

    {
      id: 'site', label: 'サイト設定', base: 'site',
      fields: [
        { key: 'title', label: 'サイトタイトル', type: 'text' },
        { key: 'footerYear', label: 'フッターの年', type: 'text', placeholder: '© 2026' }
      ]
    }
  ];

  global.SCHEMA = SCHEMA;
})(window);
