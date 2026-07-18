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
  //  カギ（トークン）設定画面
  // ============================================================
  function showTokenScreen(errText) {
    $('app').style.display = 'none';
    $('gate').style.display = 'block';
    if (errText) setStatus(errText, 'err');
  }

  function startWithToken() {
    var v = $('token-input').value.trim();
    if (!v) { setStatus('カギを貼り付けてください。', 'err'); return; }
    setStatus('カギを確認中…', 'info');
    GH.setToken(v);
    GH.me().then(function (login) {
      $('token-input').value = '';
      enterApp(login);
    }).catch(function (e) {
      GH.clearToken();
      setStatus(e.message || 'カギの確認に失敗しました。', 'err');
    });
  }

  // ============================================================
  //  本体へ入る → data.json を読み込む
  // ============================================================
  function enterApp(login) {
    $('gate').style.display = 'none';
    $('app').style.display = 'block';
    $('who').textContent = 'GitHub: ' + login + '（カギ ' + GH.tokenTail() + '）';
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

    if (sec.arrayPath) {
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

  function labelEl(def) {
    return el('label', { class: 'fl', text: def.label });
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
    pathText.addEventListener('input', function () { obj[def.key] = pathText.value.trim(); markDirty(); });

    var fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleUpload(fileInput.files[0], obj, def, preview, pathText);
      fileInput.value = '';
    });

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
      var base = Webp.slugifyBase(file.name);
      return uniquePath(base).then(function (path) {
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
      });
    }).catch(function (e) {
      setStatus('画像のアップに失敗しました：' + (e.message || e), 'err');
    });
  }

  // images/<base>.webp が既にあれば -xxxx を付けて重複を避ける
  function uniquePath(base) {
    var path = 'images/' + base + '.webp';
    return GH.getFile('src/' + path).then(function () {
      // 既に存在 → ユニーク化
      return 'images/' + base + '-' + Date.now().toString(36).slice(-4) + '.webp';
    }).catch(function (e) {
      if (e && e.notFound) return path;
      throw e;
    });
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
  //  初期化
  // ============================================================
  function init() {
    $('btn-token').addEventListener('click', startWithToken);
    $('token-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') startWithToken(); });
    $('btn-save').addEventListener('click', save);
    $('btn-reload').addEventListener('click', reload);
    $('btn-logout').addEventListener('click', function () {
      if (dirty && !confirm('未保存の変更があります。ログアウトしますか？')) return;
      GH.clearToken();
      location.reload();
    });
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    if (GH.hasToken()) {
      setStatus('カギを確認中…', 'info');
      GH.me().then(function (login) { enterApp(login); })
        .catch(function () { GH.clearToken(); showTokenScreen('カギが無効になっています。もう一度設定してください。'); });
    } else {
      showTokenScreen('');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
