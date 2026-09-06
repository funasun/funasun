/* ============================================================
   admin/app.js — 編集ツール本体
   ------------------------------------------------------------
   schema.js の定義どおりにフォームを自動生成し、GitHub 上の
   src/data.json と src/images/ を読み書きする。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ---- 状態 ----
  var data = null;         // data.json の中身
  var sha = null;          // data.json の GitHub 上のバージョン識別子
  var dirty = false;       // 未保存の変更があるか
  var orphanImages = {};   // 差し替えで不要になった画像パス（保存時に掃除）
  var activeSection = null;

  // ---- 小さな DOM ヘルパー ----
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k === 'html') n.innerHTML = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else if (props[k] != null) n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function setStatus(text, cls) {
    var m = $('status');
    m.textContent = text || '';
    m.className = 'status' + (cls ? ' ' + cls : '');
  }

  function getPath(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function markDirty() {
    dirty = true;
    $('btn-save').disabled = false;
    $('btn-save').textContent = '保存する（未保存の変更あり）';
  }
  function clearDirty() {
    dirty = false;
    $('btn-save').textContent = '保存する';
  }

  // ============================================================
  //  ログイン画面（Googleログイン）
  // ============================================================
  function showLoginScreen(errText) {
    $('app').style.display = 'none';
    $('gate').style.display = 'block';
    if (errText) setStatus(errText, 'err');
  }

  function doLogin() {
    if (!window.AdminAuth) {
      setStatus('ログイン機能を準備中です。数秒待ってからもう一度お試しください。', 'err');
      return;
    }
    setStatus('Googleでログイン中…', 'info');
    window.AdminAuth.signIn().catch(function (e) {
      var msg = (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request'))
        ? 'ログインがキャンセルされました。'
        : ('ログインに失敗しました：' + ((e && e.message) || e));
      setStatus(msg, 'err');
    });
  }

  // ============================================================
  //  本体へ入る → data.json を読み込む
  // ============================================================
  function enterApp(email) {
    $('gate').style.display = 'none';
    $('app').style.display = 'block';
    $('who').textContent = 'Google: ' + email;
    loadData();
  }

  function loadData() {
    setStatus('内容を読み込み中…', 'info');
    GH.getFile('src/data.json').then(function (f) {
      data = JSON.parse(f.text);
      sha = f.sha;
      orphanImages = {};
      clearDirty();
      $('btn-save').disabled = true;
      buildTabs();
      selectSection(SCHEMA[0]);
      setStatus('読み込みました。編集して「保存する」を押してください。', 'ok');
    }).catch(function (e) {
      setStatus('読み込みに失敗しました：' + (e.message || e), 'err');
    });
  }

  // ============================================================
  //  タブ（セクション切り替え）
  // ============================================================
  function buildTabs() {
    var nav = $('tabs');
    nav.innerHTML = '';
    SCHEMA.forEach(function (sec) {
      nav.appendChild(el('button', {
        class: 'tab', type: 'button', 'data-sec': sec.id,
        text: sec.label,
        onclick: function () { selectSection(sec); }
      }));
    });
  }

  function selectSection(sec) {
    activeSection = sec;
    Array.prototype.forEach.call($('tabs').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-sec') === sec.id);
    });
    renderSection();
  }

  function renderSection() {
    var sec = activeSection;
    var form = $('form');
    form.innerHTML = '';
    form.appendChild(el('h2', { class: 'sec-title', text: sec.label }));

    if (sec.custom === 'files') {
      renderFilesPane(form);
    } else if (sec.arrayPath) {
      // セクション全体が1つのリスト（Works / Archive）
      ensureArray(data, sec.arrayPath);
      form.appendChild(renderList(data, sec.arrayPath, {
        label: sec.listLabel || sec.label, item: sec.item, itemLabel: sec.itemLabel
      }));
    } else {
      var obj = getPath(data, sec.base);
      renderFields(form, obj, sec.fields);
    }
  }

  function ensureArray(obj, key) { if (!Array.isArray(obj[key])) obj[key] = []; }

  // ============================================================
  //  フィールド描画（再帰）
  // ============================================================
  function renderFields(container, obj, fields) {
    fields.forEach(function (def) { container.appendChild(renderField(obj, def)); });
  }

  function renderField(obj, def) {
    switch (def.type) {
      case 'textarea': return renderTextarea(obj, def);
      case 'number': return renderInput(obj, def, 'number');
      case 'select': return renderSelect(obj, def);
      case 'image': return renderImage(obj, def);
      case 'group': return renderGroup(obj, def);
      case 'strlist': return renderStrList(obj, def);
      case 'list': return renderList(obj, def.key, def);
      default: return renderInput(obj, def, 'text');
    }
  }

  // hint を書いておくと、項目名の下に小さな補足を出す（入力欄の中の
  // placeholder と違い、打ち始めても消えないので使い方の説明に向く）
  function labelEl(def) {
    var lab = el('label', { class: 'fl', text: def.label });
    if (def.hint) lab.appendChild(el('span', { class: 'fh', text: def.hint }));
    return lab;
  }

  function renderInput(obj, def, inputType) {
    var wrap = el('div', { class: 'field' }, [labelEl(def)]);
    var input = el('input', { type: inputType, placeholder: def.placeholder || '' });
    input.value = obj[def.key] != null ? obj[def.key] : '';
    input.addEventListener('input', function () {
      if (inputType === 'number') obj[def.key] = input.value === '' ? 0 : Number(input.value);
      else obj[def.key] = input.value;
      markDirty();
    });
    wrap.appendChild(input);
    return wrap;
  }

  function renderTextarea(obj, def) {
    var wrap = el('div', { class: 'field' }, [labelEl(def)]);
    var ta = el('textarea', { placeholder: def.placeholder || '', rows: 5 });
    ta.value = obj[def.key] != null ? obj[def.key] : '';
    ta.addEventListener('input', function () { obj[def.key] = ta.value; markDirty(); });
    wrap.appendChild(ta);
    return wrap;
  }

  function renderSelect(obj, def) {
    var wrap = el('div', { class: 'field' }, [labelEl(def)]);
    var sel = el('select');
    def.options.forEach(function (o) {
      var opt = el('option', { value: o.value, text: o.label });
      if (obj[def.key] === o.value) opt.selected = true;
      sel.appendChild(opt);
    });
    if (obj[def.key] == null && def.options[0]) obj[def.key] = def.options[0].value;
    sel.addEventListener('change', function () { obj[def.key] = sel.value; markDirty(); });
    wrap.appendChild(sel);
    return wrap;
  }

  function renderGroup(obj, def) {
    if (obj[def.key] == null || typeof obj[def.key] !== 'object') obj[def.key] = {};
    var box = el('fieldset', { class: 'group' }, [el('legend', { text: def.label })]);
    renderFields(box, obj[def.key], def.fields);
    return box;
  }

  // 文字列の配列（段落・キーワードなど）
  function renderStrList(obj, def) {
    if (!Array.isArray(obj[def.key])) obj[def.key] = [];
    var arr = obj[def.key];
    var box = el('fieldset', { class: 'group' }, [el('legend', { text: def.label })]);
    arr.forEach(function (val, i) {
      var row = el('div', { class: 'strrow' });
      var input = el(def.placeholder && def.placeholder.length > 20 ? 'textarea' : 'input', { placeholder: def.placeholder || '' });
      if (input.tagName === 'TEXTAREA') input.rows = 3;
      input.value = val != null ? val : '';
      input.addEventListener('input', function () { arr[i] = input.value; markDirty(); });
      row.appendChild(input);
      row.appendChild(itemButtons(arr, i));
      box.appendChild(row);
    });
    box.appendChild(el('button', {
      class: 'add', type: 'button', text: '＋ 追加',
      onclick: function () { arr.unshift(''); markDirty(); renderSection(); }
    }));
    return box;
  }

  // オブジェクトの配列（ニュース・記事・作品など）
  function renderList(parentObj, key, def) {
    if (!Array.isArray(parentObj[key])) parentObj[key] = [];
    var arr = parentObj[key];
    var box = el('fieldset', { class: 'group list' }, [el('legend', { text: def.label + '（' + arr.length + '件）' })]);
    arr.forEach(function (item, i) {
      var card = el('div', { class: 'card' });
      var head = el('div', { class: 'card-head' }, [
        el('span', { class: 'card-title', text: (def.itemLabel ? def.itemLabel(item) : ('#' + (i + 1))) }),
        itemButtons(arr, i)
      ]);
      card.appendChild(head);
      var body = el('div', { class: 'card-body' });
      renderFields(body, item, def.item);
      card.appendChild(body);
      box.appendChild(card);
    });
    box.appendChild(el('button', {
      class: 'add', type: 'button', text: '＋ ' + def.label + 'を追加',
      onclick: function () { arr.unshift(blankItem(def.item)); markDirty(); renderSection(); }
    }));
    return box;
  }

  // 上へ / 下へ / 削除 ボタン
  function itemButtons(arr, i) {
    var wrap = el('div', { class: 'itembtns' });
    wrap.appendChild(el('button', { class: 'mini', type: 'button', title: '上へ', text: '↑',
      onclick: function () { if (i > 0) { swap(arr, i, i - 1); markDirty(); renderSection(); } } }));
    wrap.appendChild(el('button', { class: 'mini', type: 'button', title: '下へ', text: '↓',
      onclick: function () { if (i < arr.length - 1) { swap(arr, i, i + 1); markDirty(); renderSection(); } } }));
    wrap.appendChild(el('button', { class: 'mini del', type: 'button', title: '削除', text: '×',
      onclick: function () {
        if (confirm('この項目を削除しますか？')) { arr.splice(i, 1); markDirty(); renderSection(); }
      } }));
    return wrap;
  }

  function swap(arr, a, b) { var t = arr[a]; arr[a] = arr[b]; arr[b] = t; }

  function blankItem(fields) {
    var o = {};
    fields.forEach(function (f) {
      if (f.type === 'list' || f.type === 'strlist') o[f.key] = [];
      else if (f.type === 'group') o[f.key] = {};
      else if (f.type === 'number') o[f.key] = 0;
      else if (f.type === 'select') o[f.key] = (f.options[0] || {}).value || '';
      else o[f.key] = '';
    });
    return o;
  }

  // ============================================================
  //  画像フィールド（選ぶ → webp化 → アップ）
  // ============================================================
  function renderImage(obj, def) {
    var wrap = el('div', { class: 'field image' }, [labelEl(def)]);
    var preview = el('div', { class: 'preview' });
    var path = obj[def.key] || '';
    if (path) preview.appendChild(el('img', { src: '/' + path, alt: '' }));
    else preview.appendChild(el('span', { class: 'nopreview', text: '画像なし' }));

    var pathText = el('input', { type: 'text', class: 'pathinput', placeholder: 'images/…（自動入力）' });
    pathText.value = path;
    // 手で打ち直したときも見た目を合わせる（アップ済みの画像を後から
    // つなぎ直すときに、合っているかどうかがその場で分かるように）
    pathText.addEventListener('input', function () {
      var p = pathText.value.trim();
      obj[def.key] = p;
      preview.innerHTML = '';
      preview.appendChild(p
        ? el('img', { src: '/' + p, alt: '' })
        : el('span', { class: 'nopreview', text: '画像なし' }));
      markDirty();
    });

    var fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleUpload(fileInput.files[0], obj, def, preview, pathText);
      fileInput.value = '';
    });

    // 写真アプリからも入れられるように、プレビュー枠を
    //   ①ドラッグ&ドロップ ②クリックして Cmd+V で貼り付け
    // の受け口にする（Mac のファイル選択だと写真アプリを開けないため）。
    preview.setAttribute('tabindex', '0');
    preview.setAttribute('title', 'ドラッグ&ドロップ、またはクリックして Cmd+V で貼り付け');
    ['dragenter', 'dragover'].forEach(function (ev) {
      preview.addEventListener(ev, function (e) { e.preventDefault(); preview.classList.add('over'); });
    });
    ['dragleave', 'dragend', 'drop'].forEach(function (ev) {
      preview.addEventListener(ev, function (e) { e.preventDefault(); preview.classList.remove('over'); });
    });
    preview.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { handleUpload(f, obj, def, preview, pathText); return; }
      setStatus('画像として受け取れませんでした。写真アプリからドラッグするか、コピーして Cmd+V で貼り付けてみてください。', 'err');
    });
    preview.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//i.test(items[i].type)) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); handleUpload(f, obj, def, preview, pathText); return; }
        }
      }
      setStatus('クリップボードに画像がありませんでした。写真アプリで画像を選んで Cmd+C してから、もう一度お試しください。', 'err');
    });
    preview.addEventListener('click', function () { fileInput.click(); });

    var btnRow = el('div', { class: 'imgbtns' }, [
      el('button', { class: 'mini pick', type: 'button', text: '画像を選ぶ（自動でwebp化）',
        onclick: function () { fileInput.click(); } }),
      el('button', { class: 'mini', type: 'button', text: '外す',
        onclick: function () {
          var old = obj[def.key];
          obj[def.key] = '';
          pathText.value = '';
          preview.innerHTML = ''; preview.appendChild(el('span', { class: 'nopreview', text: '画像なし' }));
          if (old && /^images\//.test(old)) orphanImages[old] = true;
          markDirty();
        } })
    ]);

    wrap.appendChild(preview);
    wrap.appendChild(el('p', { class: 'drophint', text:
      '写真アプリから直接ドラッグ&ドロップできます。または枠をクリックして Cmd+V で貼り付け。' }));
    wrap.appendChild(pathText);
    wrap.appendChild(btnRow);
    wrap.appendChild(fileInput);
    return wrap;
  }

  function handleUpload(file, obj, def, preview, pathText) {
    setStatus('画像を変換中…', 'info');
    var localUrl = null;
    Webp.toWebp(file).then(function (r) {
      localUrl = URL.createObjectURL(r.blob);
      var path = uploadPath(Webp.slugifyBase(file.name));
      setStatus('画像をアップロード中… ' + path, 'info');
      return GH.blobToB64(r.blob).then(function (b64) {
        return GH.putB64('src/' + path, b64, 'admin: 画像追加 ' + path).then(function () {
          var old = obj[def.key];
          obj[def.key] = path;
          pathText.value = path;
          preview.innerHTML = '';
          preview.appendChild(el('img', { src: localUrl, alt: '' }));
          if (old && old !== path && /^images\//.test(old)) orphanImages[old] = true;
          markDirty();
          setStatus('画像を追加しました：' + path + (r.converted ? '（webpに変換済み）' : '') + '。「保存する」で本文に反映されます。', 'ok');
        });
      });
    }).catch(function (e) {
      setStatus('画像のアップに失敗しました：' + (e.message || e), 'err');
    });
  }

  /* 画像の保存先を決める。
     以前は「同じ名前が無いか GitHub に見に行ってから書く」やり方だったが、
     GitHub のファイル一覧は少し前の状態を返すことがあり、続けてアップすると
     直前に上げた画像を見落として同じ名前で書きに行き、弾かれていた。
     （日本語のファイル名は英数字が残らず全部 image になるので、なおさら衝突した）
     最初から重複しない名前を作れば、見に行く必要も衝突もなくなる。      */
  function uploadPath(base) {
    var d = new Date();
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = String(d.getFullYear()).slice(2) + two(d.getMonth() + 1) + two(d.getDate());
    var rand = Math.random().toString(36).slice(2, 6);
    return 'images/' + base + '-' + stamp + '-' + rand + '.webp';
  }

  // ============================================================
  //  保存 / 再読み込み
  // ============================================================
  function save() {
    if (!data) return;
    setStatus('保存中…', 'info');
    $('btn-save').disabled = true;
    var text = JSON.stringify(data, null, 2) + '\n';
    GH.putText('src/data.json', text, 'admin: 内容を更新', sha).then(function (newSha) {
      sha = newSha;
      clearDirty();
      return cleanupOrphans();
    }).then(function () {
      setStatus('保存しました。1〜2分後に本番サイト（tsutsumufunakoshi.com）へ反映されます。', 'ok');
    }).catch(function (e) {
      $('btn-save').disabled = false;
      setStatus('保存に失敗しました：' + (e.message || e), 'err');
    });
  }

  // 差し替えで使われなくなった画像を GitHub から削除
  function cleanupOrphans() {
    var used = JSON.stringify(data);
    var targets = Object.keys(orphanImages).filter(function (p) {
      return used.indexOf('"' + p + '"') === -1; // どこからも参照されていない
    });
    orphanImages = {};
    if (!targets.length) return Promise.resolve();
    return targets.reduce(function (chain, p) {
      return chain.then(function () {
        return GH.getFile('src/' + p).then(function (f) {
          return GH.del('src/' + p, 'admin: 未使用画像を削除 ' + p, f.sha);
        }).catch(function () { /* 既に無い等は無視 */ });
      });
    }, Promise.resolve());
  }

  function reload() {
    if (dirty && !confirm('未保存の変更があります。破棄して最新を読み込みますか？')) return;
    loadData();
  }

  // ============================================================
  //  預かりファイルの一覧（ファイル共有 Worker から取得）
  //  ------------------------------------------------------------
  //  ここは data.json とは無関係なので「保存する」には影響しない。
  //  Worker 側は Google ログインで本人確認してから答えるので、
  //  この画面を開けるのは持ち主だけ。
  // ============================================================
  var filesCache = null;   // タブを行き来しても取り直さないための控え

  function filesApi(action, payload) {
    var base = (window.ADMIN_CONFIG || {}).filesUrl;
    if (!base) return Promise.reject(new Error('ファイル共有のURLが設定されていません（admin/config.js の filesUrl）'));
    return window.AdminAuth.getIdToken(false).then(function (idToken) {
      var body = Object.assign({ idToken: idToken }, payload || {});
      return fetch(base + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.message || ('通信に失敗しました（' + res.status + '）'));
        return j;
      });
    });
  }

  /* アップロード用の合言葉。/files/ を使う人みんなで共有するものなので、
     漏れたときにすぐ変えられないと困る。ここから変えられるようにしておく。
     いまの合言葉は表示しない（保存していないので、そもそも出せない）。 */
  var codeCache = null;

  function renderCodePane(box) {
    var wrap = el('div', { class: 'codebox' });
    box.appendChild(wrap);

    function draw() {
      wrap.innerHTML = '';
      wrap.appendChild(el('p', { class: 'codetitle', text: 'アップロードの合言葉' }));
      if (!codeCache) {
        wrap.appendChild(el('p', { class: 'fh', text: '読み込み中…' }));
        return;
      }
      var need = codeCache.requireCode;
      var msg = el('p', { class: 'fh', text: '' });

      var chk = el('input', { type: 'checkbox', id: 'code-need' });
      chk.checked = need;
      var pw = el('input', { type: 'password', id: 'code-new', autocomplete: 'new-password',
        placeholder: need ? '新しい合言葉（変えないときは空のまま）' : '合言葉' });
      pw.disabled = !need;

      wrap.appendChild(el('label', { class: 'codechk' }, [chk,
        el('span', { text: '合言葉を要る形にする' })]));
      wrap.appendChild(el('p', { class: 'fh', text: codeCache.requireCode
        ? (codeCache.usingSecret
          ? 'いまは Cloudflare に登録した合言葉が使われています。'
          : 'いまはここで決めた合言葉が使われています。')
        : '合言葉なしです。' }));
      wrap.appendChild(pw);

      // 外すと、URLを知っている人は誰でも船越さんのドライブに置けるようになる
      var warn = el('p', { class: 'codewarn', text:
        '合言葉を外すと、/files/ を開いた人は誰でもファイルを置けるようになります。'
        + 'URLが人づてに広まると、知らない人に保管庫を埋められたり、'
        + 'このドメインのリンクで知らないファイルを配られたりします。' });
      warn.hidden = chk.checked;
      wrap.appendChild(warn);

      chk.addEventListener('change', function () {
        pw.disabled = !chk.checked;
        warn.hidden = chk.checked;
      });

      var save = el('button', { class: 'mini', type: 'button', text: '合言葉を保存', onclick: function () {
        if (!chk.checked && !window.confirm('合言葉なしにします。だれでもファイルを置けるようになります。よろしいですか？')) return;
        if (chk.checked && !pw.value && !codeCache.hasCode && !codeCache.usingSecret) {
          msg.textContent = '合言葉を入力してください。'; return;
        }
        save.disabled = true;
        msg.textContent = '保存中…';
        filesApi('/admin/config', { save: true, requireCode: chk.checked, code: pw.value })
          .then(function (j) {
            codeCache = j;
            draw();
            // 変えた直後は、前の合言葉がしばらく通ることがある（最大30秒）
            setStatus(chk.checked
              ? '合言葉を保存しました。行き渡るまで30秒ほどかかります。'
              : '合言葉なしにしました。', 'ok');
          })
          .catch(function (e) { save.disabled = false; msg.textContent = e.message || '保存できませんでした。'; });
      } });
      wrap.appendChild(el('p', { style: 'margin:12px 0 0' }, [save]));
      wrap.appendChild(msg);

      /* ---- 1ファイルの上限 ----
         0（または空）にすると上限なし。上限なしでも「そのとき仮置き場に
         入る大きさか」は別に見ているので、置ける量を超えることはない。 */
      var curGb = codeCache.maxBytes ? (codeCache.maxBytes / (1024 * 1024 * 1024)) : 0;
      var lim = el('input', { type: 'number', min: '0', step: '0.5', id: 'max-gb',
        value: String(Math.round(curGb * 10) / 10) });
      var limMsg = el('p', { class: 'fh' });
      function limText() {
        limMsg.textContent = codeCache.maxBytes
          ? ('いまの上限は 1ファイルあたり ' + (Math.round(curGb * 10) / 10) + ' GB です。')
          : 'いまは上限なし（仮置き場に入る大きさなら、そのまま受け取ります）。';
      }
      limText();
      var limSave = el('button', { class: 'mini', type: 'button', text: '上限を保存', onclick: function () {
        var v = Number(lim.value);
        if (!isFinite(v) || v < 0) { limMsg.textContent = '0 以上の数を入れてください。'; return; }
        limSave.disabled = true;
        limMsg.textContent = '保存中…';
        filesApi('/admin/config', { save: true, requireCode: codeCache.requireCode, code: '', maxGb: v })
          .then(function (j) {
            codeCache = j; curGb = j.maxBytes ? (j.maxBytes / (1024 * 1024 * 1024)) : 0;
            limSave.disabled = false; limText();
            setStatus(j.maxBytes ? ('1ファイル ' + (Math.round(curGb * 10) / 10) + ' GB までにしました。')
              : '上限なしにしました。', 'ok');
          })
          .catch(function (e) { limSave.disabled = false; limMsg.textContent = e.message || '保存できませんでした。'; });
      } });
      wrap.appendChild(el('hr', { style: 'margin:22px 0 16px; border:0; border-top:1px solid rgba(255,255,255,.12)' }));
      wrap.appendChild(el('label', { class: 'fl', text: '1ファイルの上限（GB）' }, [
        el('span', { class: 'fh', text: '0 にすると上限なし。大きすぎるものを置かれたくないときに使います。' })
      ]));
      wrap.appendChild(lim);
      wrap.appendChild(el('p', { style: 'margin:10px 0 0' }, [limSave]));
      wrap.appendChild(limMsg);

      /* ---- Drive 全体で使う量 ----
         以前の「15GB まで使い、3GB は空ける」は実質12GBの固定上限だった。
         ここでは 0 を「Drive が実際に許す上限まで」として、契約容量を
         そのまま使いたい場合にも対応する。 */
      var capGb = codeCache.storageCapBytes ? (codeCache.storageCapBytes / (1024 * 1024 * 1024)) : 0;
      var reserveGb = codeCache.reserveBytes ? (codeCache.reserveBytes / (1024 * 1024 * 1024)) : 0;
      var driveCap = el('input', { type: 'number', min: '0', step: '0.5', id: 'drive-cap-gb',
        value: String(Math.round(capGb * 10) / 10) });
      var driveReserve = el('input', { type: 'number', min: '0', step: '0.5', id: 'drive-reserve-gb',
        value: String(Math.round(reserveGb * 10) / 10) });
      var driveMsg = el('p', { class: 'fh' });
      function driveText() {
        driveMsg.textContent = 'いまは ' + (capGb ? (Math.round(capGb * 10) / 10) + ' GB まで使う設定' : 'Drive の実際の上限まで使う設定')
          + ' ／ ' + (Math.round(reserveGb * 10) / 10) + ' GB を予備として空ける設定です。';
      }
      driveText();
      var driveSave = el('button', { class: 'mini', type: 'button', text: 'Drive容量の設定を保存', onclick: function () {
        var c = Number(driveCap.value), r = Number(driveReserve.value);
        if (!isFinite(c) || c < 0 || !isFinite(r) || r < 0) {
          driveMsg.textContent = 'どちらも 0 以上の数を入れてください。'; return;
        }
        driveSave.disabled = true;
        driveMsg.textContent = '保存中…';
        filesApi('/admin/config', { save: true, requireCode: codeCache.requireCode, code: '', storageCapGb: c, reserveGb: r })
          .then(function (j) {
            codeCache = j;
            capGb = j.storageCapBytes ? (j.storageCapBytes / (1024 * 1024 * 1024)) : 0;
            reserveGb = j.reserveBytes ? (j.reserveBytes / (1024 * 1024 * 1024)) : 0;
            driveSave.disabled = false;
            driveText();
            setStatus('Driveへの一時アップロード容量の設定を保存しました。', 'ok');
          })
          .catch(function (e) { driveSave.disabled = false; driveMsg.textContent = e.message || '保存できませんでした。'; });
      } });
      wrap.appendChild(el('hr', { style: 'margin:22px 0 16px; border:0; border-top:1px solid rgba(255,255,255,.12)' }));
      wrap.appendChild(el('label', { class: 'fl', text: 'Driveで使う上限（GB）' }, [
        el('span', { class: 'fh', text: '0 にすると、Google Drive が実際に許す容量まで使います。' })
      ]));
      wrap.appendChild(driveCap);
      wrap.appendChild(el('label', { class: 'fl', text: 'Driveに空けておく容量（GB）' }, [
        el('span', { class: 'fh', text: 'GmailやGoogleフォトと容量を共用している場合の予備です。0 にすると空けません。' })
      ]));
      wrap.appendChild(driveReserve);
      wrap.appendChild(el('p', { style: 'margin:10px 0 0' }, [driveSave]));
      wrap.appendChild(driveMsg);
    }

    draw();
    if (!codeCache) {
      filesApi('/admin/config').then(function (j) { codeCache = j; draw(); })
        .catch(function (e) { wrap.innerHTML = ''; wrap.appendChild(el('p', { class: 'fh', text: '合言葉の設定を読めませんでした：' + e.message })); });
    }
  }

  function renderFilesPane(form) {
    var box = el('div', {});
    form.appendChild(box);

    function draw() {
      box.innerHTML = '';
      if (!filesCache) {
        box.appendChild(el('p', { class: 'sub', text: '読み込み中…' }));
        return;
      }
      var d = filesCache;

      // 使用量
      var pct = d.cap ? Math.min(100, Math.round((d.used / d.cap) * 100)) : 0;
      var meter = el('div', { class: 'usage' }, [
        el('p', { class: 'usage-text', text: '使用量 ' + d.usedText + ' ／ ' + d.capText + '（' + pct + '%）' }),
        el('div', { class: 'bar' }, [el('span', { style: 'width:' + pct + '%' })])
      ]);
      box.appendChild(meter);

      /* 保管先ごとの内訳。アカウントを増やしたときに、ちゃんと効いているか／
         どれが埋まっているかがここだけで分かるようにしておく。
         「Drive全体」はメールや写真も含んだ数字（枠を共用しているため）。 */
      if (d.stores && d.stores.length) {
        box.appendChild(el('ul', { class: 'stores' }, d.stores.map(function (s, i) {
          return el('li', { class: s.ok ? '' : 'bad', text: '保管先' + (i + 1) + '：' + (s.ok
            ? s.files + '個を預かり中　Drive全体 ' + s.usedText + ' / ' + s.limitText
              + (s.capped ? '（' + s.safeText + ' までしか使いません）' : '')
              + '　まだ預かれる ' + s.freeText
            : '使えません（鍵が切れているか、登録が未完了）') });
        })));
        box.appendChild(el('p', { class: 'fh', text:
          'メールや写真のための予備容量は ' + d.reserveText + ' に設定されています。' }));
        if (d.stores.some(function (s) { return s.capped; })) {
          box.appendChild(el('p', { class: 'fh', text:
            'Google Driveの実際の容量より低い上限を設定しているため、その値までしか使いません。' }));
        }
      }

      renderCodePane(box);

      box.appendChild(el('p', { class: 'fh', text:
        '/files/ から送られたファイルの全部です。期限が来たものは自動で消えます。' }));

      var bar = el('p', { style: 'margin:14px 0 18px' }, [
        el('button', { class: 'mini', type: 'button', text: '再読み込み', onclick: function () { filesCache = null; draw(); load(); } })
      ]);
      box.appendChild(bar);

      if (!d.files.length) {
        box.appendChild(el('p', { class: 'sub', text: '今あずかっているファイルはありません。' }));
        return;
      }

      // まとめて操作する帯（PDFが2つ以上あるときだけ意味がある）
      var pdfs = d.files.filter(isMergeable);
      if (pdfs.length >= 2) box.appendChild(mergeBar(pdfs));
      box.appendChild(mergeOut);

      d.files.forEach(function (f) {
        box.appendChild(fileCard(f));
      });
      refreshMergeBar();
    }

    /* ---- 預かっているPDFを、その場で1つにまとめる ----
       ファイルはブラウザが直接ダウンロードして、ブラウザの中でつなぐ。
       サーバーで処理しないので、追加の費用も預かりも発生しない。 */
    var picked = {};                 // 選んだファイルの id
    var mergeOut = el('div', {});    // まとめた結果を出す場所
    var mergeBarEl = null;
    var mergeCount = null;
    var mergeBtn = null;

    // 期限切れ・合言葉つきは、そのままでは中身を取れないので選ばせない
    function isMergeable(f) {
      return /\.pdf$/i.test(f.name || '') && !f.expired && !f.locked;
    }

    function mergeBar(pdfs) {
      mergeCount = el('span', { class: 'fh', text: '' });
      mergeBtn = el('button', {
        class: 'mini pick', type: 'button', text: '選んだPDFを1つにまとめる',
        onclick: function () { doMerge(pdfs); }
      });
      mergeBarEl = el('div', { class: 'card', style: 'padding:12px 14px;margin-bottom:18px' }, [
        el('p', { class: 'fh', style: 'margin:0 0 10px', text:
          'PDFを選んでまとめられます（' + pdfs.length + '件が対象）。まとめる作業はこのブラウザの中で行われます。' }),
        el('div', { class: 'itembtns', style: 'flex-wrap:wrap' }, [
          el('button', {
            class: 'mini', type: 'button', text: 'ぜんぶ選ぶ',
            onclick: function () { pdfs.forEach(function (f) { picked[f.id] = true; }); draw(); }
          }),
          el('button', {
            class: 'mini', type: 'button', text: '選択を外す',
            onclick: function () { picked = {}; draw(); }
          }),
          mergeBtn
        ]),
        el('p', { style: 'margin:10px 0 0' }, [mergeCount])
      ]);
      return mergeBarEl;
    }

    function refreshMergeBar() {
      if (!mergeCount) return;
      var n = Object.keys(picked).filter(function (k) { return picked[k]; }).length;
      mergeCount.textContent = n ? n + '件を選択中（上から順につながります）' : 'まだ何も選んでいません';
      if (mergeBtn) {
        mergeBtn.disabled = n < 2;
        mergeBtn.textContent = n >= 2 ? '選んだ' + n + '件を1つにまとめる' : '選んだPDFを1つにまとめる';
      }
    }

    function doMerge(pdfs) {
      var chosen = pdfs.filter(function (f) { return picked[f.id]; });
      if (chosen.length < 2) return;
      var T = window.FileTools;
      if (!T) { setStatus('変換の部品を読み込めていません。ページを再読み込みしてください。', 'err'); return; }

      mergeBtn.disabled = true;
      mergeOut.innerHTML = '';
      setStatus('ファイルを取り寄せています…', 'info');

      var got = [];
      chosen.reduce(function (chain, f, i) {
        return chain.then(function () {
          setStatus('取り寄せ中… ' + (i + 1) + ' / ' + chosen.length + '「' + f.name + '」', 'info');
          return fetch(f.downloadUrl, { mode: 'cors', credentials: 'omit' }).then(function (res) {
            if (!res.ok) throw new Error('「' + f.name + '」を取り寄せられませんでした（' + res.status + '）');
            return res.blob();
          }).then(function (b) { got.push(T.toFile(b, f.name)); });
        });
      }, Promise.resolve()).then(function () {
        setStatus('まとめています…', 'info');
        return T.mergePdf(got, function (done, total, name) {
          setStatus('まとめています… ' + done + ' / ' + total + (name ? '（' + name + '）' : ''), 'info');
        });
      }).then(function (blob) {
        // 何ページになったかも数えて見せる（抜けていないか確かめられるように）
        return T.pdfPageCount(T.toFile(blob, 'merged.pdf')).catch(function () { return 0; })
          .then(function (pages) {
            setStatus(chosen.length + '個をまとめました（' + humanBytes(blob.size) + '）', 'ok');
            mergeOut.appendChild(mergedCard(blob, chosen, pages));
            mergeBtn.disabled = false;
          });
      }).catch(function (e) {
        setStatus(e.message, 'err');
        mergeBtn.disabled = false;
      });
    }

    /* まとめた結果のカード。保存するだけでも、共有し直してもよい。
       元のファイルを消すのは、置き直しが成功したあとにだけ聞く
       （先に消すと、置き直しに失敗したときに何も残らないため）。 */
    function mergedCard(blob, sources, pages) {
      var name = (window.FileTools.baseName(sources[0].name)) + '_まとめ.pdf';
      var nameInput = el('input', { class: 'urlbox', type: 'text', value: name });
      var days = el('select', {}, [
        el('option', { value: '1', text: '1日' }),
        el('option', { value: '3', text: '3日' }),
        el('option', { value: '7', text: '7日', selected: 'selected' }),
        el('option', { value: '30', text: '30日' }),
        // 無期限は管理画面だけの選択肢（Worker 側も持ち主にしか許さない）
        el('option', { value: '0', text: '無期限' })
      ]);
      var result = el('div', {});

      var shareBtn = el('button', {
        class: 'mini pick', type: 'button', text: 'このサイトで共有し直す',
        onclick: function () {
          shareBtn.disabled = true;
          uploadAsOwner(blob, nameInput.value || name, Number(days.value), function (t) { setStatus(t, 'info'); })
            .then(function (url) {
              setStatus('共有しました', 'ok');
              result.innerHTML = '';
              result.appendChild(urlRow('新しい受け取りページ', url, '相手に渡すのはこれ'));
              result.appendChild(el('p', { style: 'margin:12px 0 0' }, [
                el('button', {
                  class: 'mini del', type: 'button', text: 'まとめる前の' + sources.length + '件を削除する',
                  onclick: function () {
                    if (!confirm('まとめる前の' + sources.length + '件を削除します。元に戻せません。よろしいですか？')) return;
                    setStatus('削除中…', 'info');
                    sources.reduce(function (chain, f) {
                      return chain.then(function () { return filesApi('/admin/del', { id: f.id }); });
                    }, Promise.resolve()).then(function () {
                      setStatus(sources.length + '件を削除しました', 'ok');
                      picked = {}; filesCache = null; draw(); load();
                    }).catch(function (e) { setStatus(e.message, 'err'); });
                  }
                })
              ]));
              shareBtn.disabled = false;
            }).catch(function (e) {
              setStatus(e.message, 'err');
              shareBtn.disabled = false;
            });
        }
      });

      return el('div', { class: 'card', style: 'margin-bottom:18px;border-color:rgba(111,140,255,.4)' }, [
        el('div', { class: 'card-head' }, [
          el('span', {
            class: 'card-title',
            text: 'まとめたPDF（' + (pages ? '全' + pages + 'ページ・' : '') + humanBytes(blob.size) + '）'
          })
        ]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'urlrow' }, [
            el('span', { class: 'urllabel', text: 'ファイル名' }),
            nameInput,
            el('button', {
              class: 'mini pick', type: 'button', text: '保存',
              onclick: function () { window.FileTools.download(blob, nameInput.value || name); }
            })
          ]),
          el('div', { class: 'urlrow' }, [
            el('span', { class: 'urllabel', text: '公開する期間' }),
            days,
            shareBtn
          ]),
          result
        ])
      ]);
    }

    /* 持ち主として置き直す。合言葉ではなく Google ログインで通す
       （管理画面に合言葉を埋め込まずに済み、合言葉を変えても壊れない）。 */
    function uploadAsOwner(blob, name, expiryDays, onStep) {
      var base = (window.ADMIN_CONFIG || {}).filesUrl;
      return window.AdminAuth.getIdToken(false).then(function (idToken) {
        onStep('置き場所を用意しています…');
        return fetch(base + '/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: idToken, filename: name, size: blob.size,
            contentType: 'application/pdf', expiryDays: expiryDays
          })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            if (!res.ok) throw new Error(j.message || 'アップロードを開始できませんでした');
            return j;
          });
        });
      }).then(function (cj) {
        var shareUrl = '';
        var offsets = [];
        for (var o = 0; o < blob.size; o += cj.partSize) offsets.push(o);
        return offsets.reduce(function (chain, off, i) {
          return chain.then(function () {
            var end = Math.min(off + cj.partSize, blob.size);
            onStep('送信中… ' + Math.round(end / blob.size * 100) + '%');
            return fetch(base + '/part?session=' + encodeURIComponent(cj.sessionUri) +
              '&start=' + off + '&end=' + end + '&total=' + blob.size,
              { method: 'PUT', body: blob.slice(off, end) })
              .then(function (pr) {
                return pr.json().catch(function () { return {}; }).then(function (pj) {
                  if (!pr.ok) throw new Error(pj.message || 'アップロード中にエラーが発生しました');
                  if (pj.done) shareUrl = pj.url;
                });
              });
          });
        }, Promise.resolve()).then(function () {
          if (!shareUrl) throw new Error('保存を確定できませんでした');
          return shareUrl;
        });
      });
    }

    function humanBytes(n) {
      if (window.FileTools) return window.FileTools.humanSize(n);
      return Math.round(n / 1024) + ' KB';
    }

    function fileCard(f) {
      var headKids = [];
      if (isMergeable(f)) {
        var cb = el('input', { type: 'checkbox', style: 'flex:none;width:16px;height:16px;accent-color:var(--accent,#6f8cff)' });
        cb.checked = !!picked[f.id];
        cb.title = 'まとめる対象にする';
        cb.addEventListener('change', function () {
          picked[f.id] = cb.checked;
          refreshMergeBar();
        });
        headKids.push(cb);
      }
      var titleEl = el('span', { class: 'card-title', text: f.name });
      headKids.push(titleEl);
      var head = el('div', { class: 'card-head' }, headKids.concat([
        el('div', { class: 'itembtns' }, [
          el('button', {
            class: 'mini del', type: 'button', text: '削除',
            onclick: function () {
              if (!confirm('「' + f.name + '」を削除します。元に戻せません。よろしいですか？')) return;
              setStatus('削除中…', 'info');
              filesApi('/admin/del', { id: f.id }).then(function () {
                setStatus('削除しました', 'ok');
                filesCache = null; draw(); load();
              }).catch(function (e) { setStatus(e.message, 'err'); });
            }
          })
        ])
      ]));

      var meta = [f.sizeText];
      if (f.expired) meta.push('期限切れ（まもなく自動削除）');
      else if (f.expiresText) meta.push(f.expiresText + ' まで');
      else meta.push('無期限');
      if (f.locked) meta.push('合言葉つき');
      if (f.nasServed) meta.push('NAS配信中（Drive側は空）');
      else if (f.nas) meta.push('NAS済み');
      if (f.group) meta.push('まとめの一部');

      var body = el('div', { class: 'card-body' }, [
        el('p', { class: 'fh', style: 'margin:0 0 10px', text: meta.join('　/　') })
      ]);

      body.appendChild(urlRow('受け取りページ', f.pageUrl, '相手に渡すのはこれ'));
      if (f.groupUrl) body.appendChild(urlRow('まとめページ', f.groupUrl, '同時に送ったものが全部入っています'));
      if (f.previewUrl) body.appendChild(urlRow('中身を見る', f.previewUrl, ''));
      body.appendChild(urlRow('直接ダウンロード', f.downloadUrl, ''));

      /* ファイル名の変更。受け取りページの表示も保存名もこれで変わる。
         URLは変わらない（IDでできているので、渡したリンクはそのまま生きる）。
         注意: この欄は form の中にあるので、Enter をそのままにすると
         form 全体の送信（＝サイト文章の保存）が走って、名前の変更が
         押されないまま画面が動く。Enter は「名前を変える」に割り当てる。 */
      /* 名前を変えるのは「原本の名前」に対して。動画に mp4 の控えができていると
         一覧の name は .mp4 に置き換わっているので、そのまま入れると拡張子が
         原本とずれてしまう。 */
      var nameIn = el('input', { class: 'urlbox', type: 'text', value: f.origName || f.name });
      nameIn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); nameBtn.click(); }
      });
      var nameBtn = el('button', {
        class: 'mini', type: 'button', text: '名前を変える',
        onclick: function () {
          if (!nameIn.value.trim()) { setStatus('新しい名前を入力してください', 'err'); return; }
          nameBtn.disabled = true;
          setStatus('名前を変えています…', 'info');
          filesApi('/admin/rename', { id: f.id, name: nameIn.value }).then(function (j) {
            /* その場でカードの見出しと入力欄も新しい名前にする。
               一覧の取り直しを待つ間「変わっていないように見える」のを防ぐ。
               見出しは相手に見える名前（mp4の控えがあれば .mp4）で出す。 */
            var shown = f.convertedToMp4 ? j.name.replace(/\.[A-Za-z0-9]+$/, '') + '.mp4' : j.name;
            titleEl.textContent = shown;
            nameIn.value = j.name;
            nameBtn.disabled = false;
            setStatus('「' + j.name + '」にしました', 'ok');
            filesCache = null; load();
          }).catch(function (e) { nameBtn.disabled = false; setStatus(e.message, 'err'); });
        }
      });
      body.appendChild(el('div', { class: 'urlrow' }, [
        el('span', { class: 'urllabel', text: 'ファイル名' }), nameIn, nameBtn
      ]));

      /* 保存期間の変更。日数は「今から数えて」。無期限はこの画面だけの選択肢
         （/files/ の公開画面には出さない。誰でも無期限にできると保管庫が
         埋まったまま永久に空かないため）。 */
      var expSel = el('select', { style: 'width:auto;padding:6px 10px' }, [
        el('option', { value: '1', text: '今から1日' }),
        el('option', { value: '3', text: '今から3日' }),
        el('option', { value: '7', text: '今から7日' }),
        el('option', { value: '30', text: '今から30日' }),
        el('option', { value: '0', text: '無期限' })
      ]);
      var expBtn = el('button', {
        class: 'mini', type: 'button', text: '期限を変える',
        onclick: function () {
          var days = Number(expSel.value);
          if (days === 0 && !confirm('「' + f.name + '」を無期限にします。自動では消えなくなり、その分の容量を使い続けます。よろしいですか？')) return;
          expBtn.disabled = true;
          setStatus('期限を変えています…', 'info');
          filesApi('/admin/expiry', { id: f.id, days: days }).then(function () {
            setStatus('期限を変えました', 'ok');
            filesCache = null; draw(); load();
          }).catch(function (e) { expBtn.disabled = false; setStatus(e.message, 'err'); });
        }
      });
      body.appendChild(el('div', { class: 'urlrow' }, [
        el('span', { class: 'urllabel', text: '保存期間' }), expSel, expBtn
      ]));

      return el('div', { class: 'card' }, [head, body]);
    }

    // URL1本ぶんの行。押すとコピーできる
    function urlRow(label, url, hint) {
      var input = el('input', { class: 'urlbox', type: 'text', readonly: 'readonly', value: url });
      input.addEventListener('focus', function () { input.select(); });
      return el('div', { class: 'urlrow' }, [
        el('span', { class: 'urllabel', text: label }),
        input,
        el('button', {
          class: 'mini', type: 'button', text: 'コピー',
          onclick: function () {
            var done = function () { setStatus(label + 'のURLをコピーしました', 'ok'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(done, function () { input.select(); document.execCommand('copy'); done(); });
            } else { input.select(); document.execCommand('copy'); done(); }
          }
        }),
        el('a', { class: 'mini urlopen', href: url, target: '_blank', rel: 'noopener', text: '開く' }),
        hint ? el('span', { class: 'urlhint', text: hint }) : null
      ]);
    }

    function load() {
      filesApi('/admin/list').then(function (j) {
        filesCache = j;
        if (activeSection && activeSection.custom === 'files') draw();
        setStatus('', '');
      }).catch(function (e) {
        filesCache = { files: [], used: 0, cap: 0, usedText: '—', capText: '—' };
        if (activeSection && activeSection.custom === 'files') {
          box.innerHTML = '';
          box.appendChild(el('p', { class: 'sub', text: '一覧を取得できませんでした：' + e.message }));
          box.appendChild(el('p', {}, [el('button', { class: 'mini', type: 'button', text: 'やり直す', onclick: function () { filesCache = null; draw(); load(); } })]));
        }
        setStatus(e.message, 'err');
      });
    }

    draw();
    if (!filesCache) load();
  }

  // ============================================================
  //  初期化
  // ============================================================
  var entered = false;  // すでに本体に入っているか（トークン更新での二重読込を防ぐ）

  function init() {
    $('btn-login').addEventListener('click', doLogin);
    $('btn-save').addEventListener('click', save);
    $('btn-reload').addEventListener('click', reload);
    $('btn-logout').addEventListener('click', function () {
      if (dirty && !confirm('未保存の変更があります。ログアウトしますか？')) return;
      if (window.AdminAuth) window.AdminAuth.signOut();
      // ログアウトは admin-auth イベント（user=null）で画面が切り替わる
    });
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Firebase のログイン状態が確定 / 変化したとき
    window.addEventListener('admin-auth', function (e) {
      var user = e.detail && e.detail.user;
      if (user) {
        if (!entered) { entered = true; enterApp(user.email); }
      } else {
        entered = false;
        dirty = false;               // ログアウト後は未保存警告を出さない
        showLoginScreen('');
        setStatus('', '');
      }
    });
    // Firebase 初期化失敗（設定漏れなど）
    window.addEventListener('admin-auth-error', function (e) {
      showLoginScreen('ログイン機能を初期化できませんでした：' + (e.detail || ''));
    });

    showLoginScreen('');
    setStatus('ログイン状態を確認中…', 'info');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
