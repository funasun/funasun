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
        dp: null, // displayed progress（スクロール目標へ滑らかに追従する現在値）
        lp: null  // last progress written to the DOM (dedupe writes)
      });
    });
    var vh = window.innerHeight;
    var raf = null;
    var last = 0;   // 前フレームのタイムスタンプ（フレームレート非依存の減衰用）
    var tlDp = null; // timeline track の表示値
    // Apple の製品ページと同じ挙動:
    // ・演出の「目標」は常にスクロール位置だけで決まる（可逆・スナップしない）。
    //   途中で止めればその位置の状態で落ち着き、逆戻りすれば正確に巻き戻る。
    // ・ただし表示上の進行度 dp を毎フレーム「目標へ一定割合だけ」近づける
    //   減衰（ダンピング）を掛ける。これで速いフリックでも一気に飛ばず、
    //   スクロールの速さに依存しない滑らかな進み方になる。
    // ・dp が目標に追いついたらループを止める（自走し続けない＝負荷・電池対策）。
    var TAU = 80; // ms。大きいほど滑らか（重い）、小さいほどスクロール直結（軽い）
    var writeScene = function (sc, p) {
      var pr = Number(p.toFixed(4));
      if (pr === sc.lp) return; // 変化なし → 書かない
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
    };
    var tick = function (now) {
      raf = null;
      // dt をクランプ（タブ復帰などの巨大 dt で一気に飛ぶのを防ぐ）
      var dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      var alpha = 1 - Math.exp(-dt / TAU); // 経過時間ベース＝120Hz でも 60Hz でも同じ体感
      vh = window.innerHeight;
      var moving = false;
      for (var i = 0; i < sceneList.length; i++) {
        var sc = sceneList[i];
        var rect = sc.el.getBoundingClientRect();
        var total = sc.el.offsetHeight - vh;
        var target = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
        // 画面外のシーンは見えないので即座に目標へスナップ（再表示時に飛ばない）
        if (rect.bottom < 0 || rect.top > vh) { sc.dp = target; continue; }
        if (sc.dp === null) {
          sc.dp = target; // 初回はアニメせず即確定
        } else {
          sc.dp += (target - sc.dp) * alpha;
          if (Math.abs(target - sc.dp) < 0.0004) sc.dp = target; // 収束したら固定
          else moving = true; // まだ追従中 → 次フレームも回す
        }
        writeScene(sc, sc.dp);
      }
      if (tl) {
        var r = tl.getBoundingClientRect();
        var ttarget = Math.min(1, Math.max(0, (vh * 0.82 - r.top) / r.height));
        if (tlDp === null) { tlDp = ttarget; }
        else {
          tlDp += (ttarget - tlDp) * alpha;
          if (Math.abs(ttarget - tlDp) < 0.0004) tlDp = ttarget;
          else moving = true;
        }
        tl.style.setProperty('--tl', tlDp.toFixed(4));
      }
      if (moving) raf = requestAnimationFrame(tick); // 追従が終わるまで回す
    };
    var onScroll = function () {
      if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      vh = window.innerHeight;
      // 寸法が変わったので次フレームで即座に目標へスナップし直す
      for (var i = 0; i < sceneList.length; i++) { sceneList[i].dp = null; sceneList[i].lp = null; }
      tlDp = null;
      onScroll();
    });
    onScroll();
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
