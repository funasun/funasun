(function () {
  'use strict';

  /* ============ Nav: mobile menu ============ */
  var burger = document.querySelector('.nav-burger');
  if (burger) {
    burger.addEventListener('click', function () {
      document.body.classList.toggle('menu-open');
    });
    document.querySelectorAll('.menu-overlay a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('menu-open');
      });
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 820) document.body.classList.remove('menu-open');
    });
  }

  /* ============ Reveal (IntersectionObserver → --r) ============ */
  var threshold = parseFloat(document.body.getAttribute('data-reveal-threshold') || '0.15');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.style.setProperty('--r', '1');
        io.unobserve(en.target);
      }
    });
  }, { threshold: threshold });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });

  /* ============ Pin + scrub scenes (Home) ============ */
  var scenes = document.querySelectorAll('[data-scene]');
  var tl = document.getElementById('timeline-track');
  if (scenes.length || tl) {
    var smooth = function (v) {
      var c = Math.min(1, Math.max(0, v));
      return c * c * (3 - 2 * c);
    };
    var seg = function (p, spec) {
      if (!spec) return null;
      var parts = spec.split(',').map(Number);
      var a = parts[0], b = parts[1];
      if (!(b > a)) return 1; // degenerate "0,0" => always on
      return smooth((p - a) / (b - a));
    };
    // Cache each scene's animated descendants once (querySelectorAll every frame
    // is what made mobile Safari crash with "問題が繰り返し発生しました").
    var sceneList = [];
    scenes.forEach(function (scene) {
      var nodes = scene.querySelectorAll('[data-seg], [data-out], [data-dim]');
      var specs = [];
      nodes.forEach(function (el) {
        specs.push({
          el: el,
          s: el.getAttribute('data-seg'),
          o: el.getAttribute('data-out'),
          d: el.getAttribute('data-dim'),
          // last written values (dedupe: 変化した要素だけ DOM に書く)
          wk: null, wko: null, wkd: null
        });
      });
      sceneList.push({
        el: scene,
        nodes: specs,
        lp: null, // last progress written to the DOM (dedupe writes)
        vis: false // 画面内フラグ（切り替わった時だけ will-change を付け外し）
      });
    });
    var vh = window.innerHeight;
    var raf = null;
    // 演出はスクロール位置に「正確に」連動させる（遅延ゼロ）。
    // 遅延（減衰）を掛けると、速いフリックのときアニメが追いつく前に
    // シーンをピンアウトして中途半端な状態で飛び、バグに見えていた。
    // スクロールの「速さ」を抑える役目は下の Wheel smoothing が担う（役割分離）。
    // スクロールイベント 1 回につき最大 1 フレームだけ更新（自走ループなし）。
    var update = function () {
      raf = null;
      // 毎フレーム最新のビューポート高さを読む（モバイルのアドレスバー開閉対策）。
      vh = window.innerHeight;
      // 画面手前 0.5 画面分から「見える」扱いにして、レイヤーを先に用意する
      // （シーンに入った瞬間にレイヤー生成が走ると 1 フレーム引っかかるため）。
      var margin = vh * 0.5;
      for (var i = 0; i < sceneList.length; i++) {
        var sc = sceneList[i];
        var rect = sc.el.getBoundingClientRect();
        var vis = rect.bottom >= -margin && rect.top <= vh + margin;
        // 画面の出入りが切り替わった瞬間だけ will-change を付け外しする。
        // 入った時: アニメする要素を GPU レイヤーへ昇格 → transform/opacity を
        // 再描画なしで合成（Apple 方式の「GPU 合成のみ」）。速いスクロールでも
        // 文字の再ラスタライズが起きず「読み込みが間に合わない」カクつきを防ぐ。
        // 出た時: レイヤーを解放してモバイルのメモリ圧（＝クラッシュ）を避ける。
        if (vis !== sc.vis) {
          sc.vis = vis;
          var wc = vis ? 'transform, opacity' : '';
          var nn = sc.nodes;
          for (var m = 0; m < nn.length; m++) nn[m].el.style.willChange = wc;
        }
        // 画面外のシーンはスキップ（見えない＝書く必要なし。再表示時に再計算）。
        if (!vis) continue;
        var total = sc.el.offsetHeight - vh;
        var p = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
        var pr = Number(p.toFixed(4));
        if (pr === sc.lp) continue; // 進行度に変化なし → 何も書かない
        sc.lp = pr;
        sc.el.style.setProperty('--p', pr);
        var nodes = sc.nodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          var k = seg(p, n.s);
          var ko = seg(p, n.o);
          var kd = seg(p, n.d);
          if (k !== null) { var wk = Number(k.toFixed(3)); if (wk !== n.wk) { n.wk = wk; n.el.style.setProperty('--k', wk); } }
          if (ko !== null) { var wko = Number(ko.toFixed(3)); if (wko !== n.wko) { n.wko = wko; n.el.style.setProperty('--ko', wko); } }
          if (kd !== null) { var wkd = Number(kd.toFixed(3)); if (wkd !== n.wkd) { n.wkd = wkd; n.el.style.setProperty('--kd', wkd); } }
        }
      }
      if (tl) {
        var r = tl.getBoundingClientRect();
        var tp = Math.min(1, Math.max(0, (vh * 0.82 - r.top) / r.height));
        tl.style.setProperty('--tl', tp.toFixed(4));
      }
    };
    var onScroll = function () {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      vh = window.innerHeight;
      for (var i = 0; i < sceneList.length; i++) sceneList[i].lp = null;
      onScroll();
    });
    onScroll();
  }

  /* ============ Wheel smoothing（マウス／トラックパッド）============ */
  // ホイールのスクロールをイージングして、速く回しても一定以上の速さで
  // 進まないようにする（Apple の製品ページのような「重み」）。演出は上の
  // update がスクロール位置に正確連動しているので、これで演出の進む速さも
  // 自動的に滑らか＆速度制限される。
  // タッチ（スマホ）はネイティブのまま＝フリックの慣性を殺さない（Apple も同様）。
  var mm = window.matchMedia;
  var reduceMotion = mm && mm('(prefers-reduced-motion: reduce)').matches;
  var coarsePointer = mm && mm('(pointer: coarse)').matches;
  if (!reduceMotion && !coarsePointer && window.requestAnimationFrame) {
    var wsTarget = window.scrollY;
    var wsRaf = null;
    var wsActive = false;
    var WS_EASE = 0.14; // 小さいほど滑らか（重い）、大きいほど直結（軽い）
    var wsMax = function () {
      var d = document.documentElement, b = document.body;
      return Math.max(0, Math.max(d.scrollHeight, b ? b.scrollHeight : 0) - window.innerHeight);
    };
    var wsClamp = function (v) { return Math.max(0, Math.min(wsMax(), v)); };
    var wsLoop = function () {
      var cur = window.scrollY;
      if (Math.abs(wsTarget - cur) < 0.5) {
        wsRaf = null; wsActive = false;
        window.scrollTo(0, wsTarget);
        return;
      }
      wsActive = true;
      window.scrollTo(0, cur + (wsTarget - cur) * WS_EASE);
      wsRaf = requestAnimationFrame(wsLoop);
    };
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) return; // ピンチズームには干渉しない
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;                 // 行単位 → px 換算
      else if (e.deltaMode === 2) d *= window.innerHeight; // ページ単位
      if (!d) return;
      e.preventDefault();
      // ループ停止中は、直前に他手段（スクロールバー等）で動いた位置へ同期
      if (!wsActive) wsTarget = window.scrollY;
      wsTarget = wsClamp(wsTarget + d);
      if (!wsRaf) wsRaf = requestAnimationFrame(wsLoop);
    }, { passive: false });
    // ホイール以外（キーボード / アンカー / スクロールバー）で動いたら目標を同期
    window.addEventListener('scroll', function () {
      if (!wsActive) wsTarget = window.scrollY;
    }, { passive: true });
    window.addEventListener('resize', function () { wsTarget = wsClamp(wsTarget); }, { passive: true });
  }

  /* ============ Count-up (Research stats) ============ */
  var counts = document.querySelectorAll('[data-count]');
  if (counts.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        cio.unobserve(en.target);
        var target = Number(en.target.getAttribute('data-count')) || 0;
        var t0 = performance.now();
        var dur = 1400;
        var tick = function (t) {
          var p = Math.min(1, (t - t0) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          en.target.textContent = Math.round(target * eased).toLocaleString();
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    counts.forEach(function (el) { el.textContent = '0'; cio.observe(el); });
  }

  /* ============ Filter chips (Works / Archive) ============ */
  var chips = document.querySelectorAll('.chip[data-filter]');
  if (chips.length) {
    var applyFilter = function (val) {
      document.querySelectorAll('[data-type]').forEach(function (el) {
        var show = val === 'All' || el.getAttribute('data-type') === val;
        el.classList.toggle('hidden-by-filter', !show);
      });
      // Archive: hide year groups that became empty
      document.querySelectorAll('[data-year-group]').forEach(function (g) {
        var any = g.querySelector('[data-type]:not(.hidden-by-filter)');
        g.classList.toggle('hidden-by-filter', !any);
      });
    };
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on');
        applyFilter(chip.getAttribute('data-filter'));
      });
    });
  }

  /* ============ Archive accordion (single open) ============ */
  var rows = document.querySelectorAll('.arch-item > .arch-row');
  if (rows.length) {
    var openItem = function (item) {
      document.querySelectorAll('.arch-item.open').forEach(function (o) {
        if (o !== item) o.classList.remove('open');
      });
      item.classList.toggle('open');
    };
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        openItem(row.parentElement);
      });
    });
    // Deep link: archive.html#slug opens the article (旧 ?p=slug URL からの誘導先)
    if (location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target && target.classList.contains('arch-item')) {
        target.classList.add('open');
        setTimeout(function () {
          target.scrollIntoView({ block: 'center' });
        }, 0);
      }
    }
  }
})();
