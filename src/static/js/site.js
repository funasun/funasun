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
          d: el.getAttribute('data-dim')
        });
      });
      sceneList.push({
        el: scene,
        nodes: specs,
        cur: -1, // displayed (smoothed) progress; -1 = uninitialised
        lp: -1 // last progress written to the DOM (dedupe writes)
      });
    });
    var vh = window.innerHeight;
    var tlCur = -1;
    var raf = null;
    var last = 0;
    var EPS = 0.0005;
    var TAU = 110; // smoothing time constant (ms) — Apple-like eased catch-up
    // Displayed progress chases the scroll-derived target with an exponential
    // ease, so stopping or reversing mid-gimmick settles smoothly instead of
    // freezing/jerking. The rAF loop keeps itself alive only while any value
    // is still converging, then stops (preserves the battery/crash fixes).
    var frame = function (now) {
      raf = null;
      var dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      var a = 1 - Math.exp(-dt / TAU); // frame-rate independent lerp factor
      var settled = true;
      for (var i = 0; i < sceneList.length; i++) {
        var sc = sceneList[i];
        var rect = sc.el.getBoundingClientRect();
        var total = sc.el.offsetHeight - vh;
        var target = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
        var off = rect.bottom < 0 || rect.top > vh;
        if (sc.cur < 0 || off) {
          // First pass, or scene fully outside the viewport: snap (nothing
          // visible to animate; re-entry then starts from the exact position).
          sc.cur = target;
        } else {
          var d = target - sc.cur;
          if (d > EPS || d < -EPS) {
            sc.cur += d * a;
            settled = false;
          } else {
            sc.cur = target;
          }
        }
        if (off) continue;
        var pr = Number(sc.cur.toFixed(4));
        if (pr === sc.lp) continue; // unchanged → nothing to write
        sc.lp = pr;
        sc.el.style.setProperty('--p', sc.cur.toFixed(4));
        var nodes = sc.nodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          var k = seg(sc.cur, n.s);
          var ko = seg(sc.cur, n.o);
          var kd = seg(sc.cur, n.d);
          if (k !== null) n.el.style.setProperty('--k', k.toFixed(4));
          if (ko !== null) n.el.style.setProperty('--ko', ko.toFixed(4));
          if (kd !== null) n.el.style.setProperty('--kd', kd.toFixed(4));
        }
      }
      if (tl) {
        var r = tl.getBoundingClientRect();
        var tt = Math.min(1, Math.max(0, (vh * 0.82 - r.top) / r.height));
        if (tlCur < 0) tlCur = tt;
        var td = tt - tlCur;
        if (td > EPS || td < -EPS) {
          tlCur += td * a;
          settled = false;
        } else {
          tlCur = tt;
        }
        tl.style.setProperty('--tl', tlCur.toFixed(4));
      }
      if (!settled) {
        raf = requestAnimationFrame(frame);
      } else {
        last = 0; // loop idle — reset the clock for the next kick
      }
    };
    var kick = function () {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', function () {
      vh = window.innerHeight;
      // force recompute on next frame (dimensions changed)
      for (var i = 0; i < sceneList.length; i++) sceneList[i].lp = -1;
      kick();
    });
    kick();
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
