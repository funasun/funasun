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

  // メディア掲載の「種類」。サイトでは丸いラベルとしてそのまま出る
  var MEDIA_KINDS = ['テレビ', 'ラジオ', '新聞', '雑誌', '記事', 'Web'];
  var mediaKindOptions = MEDIA_KINDS.map(function (c) { return { value: c, label: c }; });

  /* 「文章」タブ用の書き方を短くするための小道具。
     t  … 1行の文言（見出し・リンクの文字など）
     ta … 改行できる文言（改行するとサイトでもそこで改行される）
     g  … まとまり（画面上では枠で囲まれる） */
  function t(key, label, hint) { return { key: key, label: label, type: 'text', hint: hint }; }
  function ta(key, label, hint) { return { key: key, label: label, type: 'textarea', hint: hint }; }
  function g(key, label, fields) { return { key: key, label: label, type: 'group', fields: fields }; }
  var BR = '改行すると、サイトでもそこで行が変わります。';

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
        /* 種類は Works ページの絞り込みボタンと一字一句そろえる必要がある。
           手入力だと打ち間違いで絞り込みから漏れるので、選ぶ形にしている。 */
        { key: 'type', label: '種類', type: 'select', options: [
          { value: 'Web App', label: 'Web App（アプリ）' },
          { value: 'Game', label: 'Game（ゲーム）' },
          { value: 'School', label: 'School（学校で使われているサイト）' } ] },
        { key: 'status', label: '状態', type: 'select', options: [
          { value: 'live', label: '公開中' }, { value: 'wip', label: '開発中' } ] },
        { key: 'description', label: '説明', type: 'textarea' },
        { key: 'thumbnail', label: 'サムネイル', type: 'image' },
        { key: 'liveUrl', label: '公開URL', type: 'text', placeholder: 'https://…（無ければ空欄）' }
      ]
    },

    {
      id: 'udon', label: 'うどん遍路', base: '', arrayPath: 'udonItems',
      listLabel: 'うどん', itemLabel: function (o) {
        return (o.area === '遠征' ? '［遠征］' : '') + (o.shop || '（店名未入力）') +
          (o.town ? '（' + o.town + '）' : '') + (o.date ? '　' + o.date : '');
      },
      item: [
        { key: 'area', label: '区分', type: 'select', options: [
          { value: '讃岐', label: '讃岐（香川県内）' }, { value: '遠征', label: '遠征（県外）' } ] },
        { key: 'shop', label: '店名', type: 'text', placeholder: '山越うどん',
          hint: '再訪したときは、この「1回分」をもう1件足してください。店名と場所が同じものは、サイト側で1枚のカードにまとまって訪問履歴になります。' },
        { key: 'town', label: '場所', type: 'text', placeholder: '県内は市町（綾川町 など）／県外は都道府県や市（東京都 など）' },
        { key: 'shopType', label: '店のかたち', type: 'select', options: [
          { value: '', label: '（選ばない）' },
          { value: 'セルフ', label: 'セルフ' },
          { value: '一般店', label: '一般店（注文して席まで）' },
          { value: '製麺所', label: '製麺所' } ],
          hint: '讃岐うどんの店を分けるときの定番の3種類。店ごとの情報なので、再訪のときは同じものを選べば大丈夫です。' },
        { key: 'date', label: '訪問日', type: 'text', placeholder: '2026.07.20',
          hint: '「2026.07.20」の形で。空のままだと並び順が正しくなりません。' },
        { key: 'mapQuery', label: '地図の検索語（任意）', type: 'text', placeholder: '空欄なら「店名＋場所」で検索。ズレるときだけ住所などを入れる' },
        { key: 'menu', label: '食べたもの', type: 'text', placeholder: 'かまたま（小）' },
        { key: 'price', label: '値段', type: 'text', placeholder: '250円' },
        { key: 'noodle', label: '麺', type: 'text', placeholder: 'コシが強い／エッジが立つ／やわらかめ',
          hint: 'ここから3つは、その日の一杯の感想です。空でも大丈夫。' },
        { key: 'broth', label: '出汁', type: 'text', placeholder: 'いりこが強い／昆布とかつお／甘め' },
        { key: 'photo', label: '写真', type: 'image' },
        { key: 'note', label: 'ひとことメモ', type: 'textarea', placeholder: '2〜3行で気軽に。' },
        { key: 'tags', label: 'タグ', type: 'strlist', placeholder: '釜玉 / ひやあつ / 行列 など',
          hint: '「セルフ・一般店・製麺所」は上の「店のかたち」で選べるので、ここには食べ方や雰囲気を。' }
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

    /* 取材されたもの（新聞・テレビ・記事）。自分の活動記録＝Archive とは別枠。
       ホームとプレスキットの両方に、新しい順で自動的に並ぶ。 */
    {
      id: 'media', label: 'メディア掲載', base: '', arrayPath: 'media',
      listLabel: '掲載', itemLabel: function (o) {
        return (o.date || '') + ' ' + (o.outlet || '') + ' — ' + (o.title || '（見出し未入力）');
      },
      item: [
        { key: 'date', label: '日付', type: 'text', placeholder: '2025.12.29',
          hint: '放送日・掲載日。新しいものが自動で上に来ます。' },
        { key: 'kind', label: '種類', type: 'select', options: mediaKindOptions,
          hint: 'サイトでは丸いラベルとして出ます。' },
        { key: 'outlet', label: '媒体名', type: 'text', placeholder: 'TBS『THE TIME,』' },
        { key: 'program', label: '番組名・コーナー名', type: 'text', placeholder: '全国！中高生ニュース',
          hint: '無ければ空のままで大丈夫です（媒体名だけが出ます）。' },
        { key: 'title', label: '見出し', type: 'text',
          hint: '記事のタイトル、または「どんな内容だったか」の一行。' },
        { key: 'summary', label: '内容の説明', type: 'textarea',
          hint: 'プレスキットのページに出ます。2〜3行くらいで。' },
        { key: 'quote', label: '紹介された自分の言葉', type: 'text',
          hint: '記事中で引用された発言があれば。かぎかっこは自動で付きます。無ければ空で。' },
        { key: 'url', label: 'リンク先 URL', type: 'text', placeholder: 'https://…' },
        { key: 'thumb', label: 'サムネイル画像', type: 'image',
          hint: '自分で撮った写真のみ。番組や記事の画面を無断で載せないでください。' },
        { key: 'ytid', label: 'YouTube の動画ID', type: 'text', placeholder: 'IW_ZmnryWgs',
          hint: '動画を載せる許可がある場合のみ。YouTube の URL の v= のあとの文字列です。' }
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
    },

    /* ============================================================
       文章（ホーム）
       ホームは上から下へスクロールする順に並べてある。
       ============================================================ */
    {
      id: 'text-home', label: '文章：ホーム', base: 'texts.index',
      fields: [
        g('hero', '① 最初の画面', [
          ta('tagline', 'スクロールして出てくる一文', BR)
        ]),
        g('intro', '② 並んで出てくる4行＋まとめ', [
          t('line1', '1行目'), t('line2', '2行目'), t('line3', '3行目'), t('line4', '4行目'),
          t('line5', 'まとめの1行')
        ]),
        g('research', '③ 研究', [
          t('word', '大きく出る言葉'),
          t('eyebrow', '写真の上の小さなラベル'),
          ta('h2', '大見出し', BR),
          ta('lead', 'リード文'),
          t('item1Title', '項目1・見出し'), t('item1Desc', '項目1・説明'),
          t('item2Title', '項目2・見出し'), t('item2Desc', '項目2・説明'),
          t('link', 'リンクの文字')
        ]),
        g('politics', '④ 政治', [
          t('word', '大きく出る言葉'),
          t('eyebrow', '写真の上の小さなラベル'),
          ta('h2', '大見出し', BR),
          ta('lead', 'リード文'),
          t('item1Title', '項目1・見出し'), t('item1Desc', '項目1・説明'),
          t('item2Title', '項目2・見出し'), t('item2Desc', '項目2・説明'),
          t('link', 'リンクの文字')
        ]),
        g('governance', '⑤ 学生自治', [
          t('word', '大きく出る言葉'),
          t('eyebrow', '写真の上の小さなラベル'),
          ta('h2', '大見出し', BR),
          ta('lead', 'リード文'),
          t('item1Title', '項目1・見出し'), t('item1Desc', '項目1・説明'),
          t('item2Title', '項目2・見出し'), t('item2Desc', '項目2・説明'),
          t('link', 'リンクの文字')
        ]),
        g('works', '⑥ 開発（Works）', [
          t('eyebrow', '小さなラベル'),
          ta('h2', '大見出し', BR),
          ta('lead', 'リード文'),
          t('link', 'リンクの文字')
        ]),
        g('connect', '⑦ 三つがつながる場面', [
          t('line1', '最初の一文'),
          t('word1', '浮かぶ言葉1'), t('word2', '浮かぶ言葉2'), t('word3', '浮かぶ言葉3'),
          t('line2', '次の一文'),
          ta('h2', '大見出し', BR),
          t('h2Sub', '大見出しの下の英文')
        ]),
        g('bridge', '⑧ 音楽へのつなぎ', [
          ta('line', '一文', BR)
        ]),
        g('music', '⑨ 音楽', [
          t('word', '大きく出る言葉'),
          t('eyebrow', '写真の上の小さなラベル'),
          t('h2w1', '大見出し・1つめ', 'ここに書いた分は途中で改行されません'),
          t('h2w2', '大見出し・2つめ'), t('h2w3', '大見出し・3つめ'), t('h2w4', '大見出し・4つめ'),
          ta('lead', 'リード文'),
          t('item1Title', '項目1・見出し'),
          t('item2Title', '項目2・見出し'), t('item2Desc', '項目2・説明'),
          t('item3Title', '項目3・見出し'), t('item3Desc', '項目3・説明')
        ]),
        g('finale', '⑩ 締めくくり', [
          t('word1', '集まる言葉1'), t('word2', '集まる言葉2'),
          t('word3', '集まる言葉3'), t('word4', '集まる言葉4'),
          t('name', '大きく出る名前'),
          t('line', '名前の下の一文'),
          t('lineSub', 'その下の英文')
        ]),
        g('about', '⑪ 自己紹介の欄', [
          t('eyebrow', '小さなラベル'),
          t('h2', '見出し（名前）'),
          ta('link', 'リンクの文字')
        ]),
        g('news', '⑫ 新着ニュースの欄', [
          t('eyebrow', '小さなラベル'),
          t('link', 'リンクの文字')
        ])
      ]
    },

    /* ============================================================
       文章（ホーム以外のページ）
       ============================================================ */
    {
      id: 'text-pages', label: '文章：各ページ', base: 'texts',
      fields: [
        g('about', 'About（自己紹介）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          t('h1', '大見出し', '右の「。」は自動で付きます'),
          t('timelineEyebrow', '歩みの欄のラベル'),
          t('ctaLine', 'ページ末尾の一文'),
          t('ctaLink1', 'ページ末尾のリンク1'),
          t('ctaLink2', 'ページ末尾のリンク2'),
          t('ctaLink3', 'ページ末尾のリンク3', 'プレスキットへのリンクです')
        ]),
        g('research', 'Research（研究）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          ta('h1', '大見出し', BR),
          t('processEyebrow', '変換の流れの欄のラベル'),
          t('flowInTitle', '流れ図・入口の見出し'), t('flowInDesc', '流れ図・入口の説明'),
          t('flowMidTitle', '流れ図・中央の見出し'), t('flowMidDesc', '流れ図・中央の説明'),
          t('flowOut1', '流れ図・出口1'),
          t('flowOut2Note', '流れ図・出口2の補足（SAF）'),
          t('flowOut3', '流れ図・出口3'), t('flowOut3Note', '流れ図・出口3の補足'),
          t('awardsEyebrow', '受賞・活動の欄のラベル'),
          t('awardsLink', '受賞・活動の欄のリンク')
        ]),
        g('works', 'Works（つくったもの）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          t('h1', '大見出し', '右の「。」は自動で付きます'),
          ta('lead', 'リード文'),
          t('toolsEyebrow', '便利ツールの欄のラベル'),
          t('toolsH2', '便利ツールの見出し', '右の「。」は自動で付きます'),
          ta('toolsLead', '便利ツールの説明'),
          t('tool1Title', 'ツール1・見出し'), ta('tool1Desc', 'ツール1・説明'),
          t('tool2Title', 'ツール2・見出し'),
          ta('tool2Desc', 'ツール2・説明', 'このあとに「編集はこちら」のリンクが続きます')
        ]),
        g('archive', 'Archive（活動記録）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          t('h1', '大見出し', '右の「。」は自動で付きます'),
          ta('lead', 'リード文')
        ]),
        g('henro', 'うどん遍路', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          t('unitCups', '杯数の単位', '数字のうしろに付く文字。前の空白も含みます'),
          t('unitShops', '軒数の単位'),
          t('unitHome', '県内の単位'),
          t('unitAway', '遠征の単位'),
          t('unitTowns', '市町の単位'),
          t('mapEyebrow', '制覇状況の欄のラベル'),
          t('homeEyebrow', '県内の欄のラベル'),
          t('homeH2', '県内の見出し', '右の「。」は自動で付きます'),
          t('awayEyebrow', '県外の欄のラベル'),
          t('awayH2', '県外の見出し', '右の「。」は自動で付きます')
        ]),
        g('press', 'Press（プレスキット）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          ta('lead', 'リード文'),
          t('profileEyebrow', '基本情報の欄のラベル'),
          t('bioShortLabel', '短いプロフィールのラベル'),
          t('bioLongLabel', '長いプロフィールのラベル'),
          t('photosEyebrow', '写真素材の欄のラベル'),
          ta('photosLead', '写真素材の説明'),
          t('awardsEyebrow', '受賞の欄のラベル'),
          t('contactEyebrow', '連絡先の欄のラベル'),
          t('contactLine', '連絡先の欄の一文')
        ]),
        g('contact', 'Contact（お問い合わせ）', [
          t('eyebrow', 'ページ上部の小さなラベル'),
          t('h1', '大見出し', '右の「。」は自動で付きます'),
          ta('lead', 'リード文'),
          t('pressEyebrow', '取材の方向けの帯：小さなラベル'),
          t('pressTitle', '取材の方向けの帯：見出し'),
          ta('pressLead', '取材の方向けの帯：説明'),
          t('pressLink', '取材の方向けの帯：ボタンの文字', 'フォームの案内の中のリンクにも使われます'),
          ta('pressFormHint', 'フォームで「取材・出演のご依頼」を選んだときに出る案内'),
          t('socialEyebrow', 'SNSの欄のラベル'),
          t('instagramNote', 'Instagram の説明'),
          t('xNote', 'X / Twitter の説明'),
          t('githubNote', 'GitHub の説明'),
          t('emailNote', 'メールの説明'),
          t('formEyebrow', 'フォームの欄のラベル'),
          ta('formLead', 'フォームの説明'),
          t('fieldName', '入力欄の名前：お名前'),
          t('fieldEmail', '入力欄の名前：返信用メール'),
          t('fieldCategory', '入力欄の名前：種類'),
          t('fieldMessage', '入力欄の名前：内容'),
          t('optionalMark', '任意の印', 'お名前とメールの両方に出ます'),
          t('category1', '種類の選択肢1'), t('category2', '種類の選択肢2'),
          t('category3', '種類の選択肢3'), t('category4', '種類の選択肢4'),
          t('submit', '送信ボタンの文字'),
          ta('formNote', 'フォームの下の注意書き')
        ]),
        g('udon', 'うどん店の詳細ページ', [
          t('backTop', '上の戻るリンク'),
          t('visitsEyebrow', '訪問の記録のラベル'),
          t('backBottom', '下の戻るリンク')
        ]),
        g('footer', 'フッター（全ページ共通）', [
          t('contactEyebrow', '上部の小さなラベル'),
          ta('h2', '大見出し'),
          t('name', '名前'),
          t('nameRomaji', 'ローマ字の名前'),
          t('tagline', '名前の下の一文'),
          t('address', '住所'),
          t('toTop', '上に戻るリンクの文字')
        ])
      ]
    }
  ];

  global.SCHEMA = SCHEMA;
})(window);
