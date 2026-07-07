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
          lp: -1 // last progress applied to this scene (dedupe writes)
        });
      });
      sceneList.push({ el: scene, nodes: specs, lp: -1 });
    });
    var vh = window.innerHeight;
    var raf = null;
    var update = function () {
      raf = null;
      for (var i = 0; i < sceneList.length; i++) {
        var sc = sceneList[i];
        var rect = sc.el.getBoundingClientRect();
        // Skip scenes fully outside the viewport — their frozen state isn't
        // visible, and re-entering recomputes from scratch.
        if (rect.bottom < 0 || rect.top > vh) continue;
        var total = sc.el.offsetHeight - vh;
        var p = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
        var pr = Number(p.toFixed(4));
        if (pr === sc.lp) continue; // progress unchanged → nothing to write
        sc.lp = pr;
        sc.el.style.setProperty('--p', p.toFixed(4));
        var nodes = sc.nodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          var k = seg(p, n.s);
          var ko = seg(p, n.o);
          var kd = seg(p, n.d);
          if (k !== null) n.el.style.setProperty('--k', k.toFixed(4));
          if (ko !== null) n.el.style.setProperty('--ko', ko.toFixed(4));
          if (kd !== null) n.el.style.setProperty('--kd', kd.toFixed(4));
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
      // force recompute on next frame (dimensions changed)
      for (var i = 0; i < sceneList.length; i++) sceneList[i].lp = -1;
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
