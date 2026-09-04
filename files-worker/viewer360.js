/* ============================================================
   viewer360.js — 360°写真・動画を、その場で見回せるようにする
   ------------------------------------------------------------
   THETA などの全天球カメラは「正距円筒図法」（横:縦 = 2:1 の引き伸ばした絵）
   で保存する。そのまま見せると歪んだ横長の絵にしかならないので、
   ブラウザの描画回路（WebGL）で球の内側に貼り直し、見たい方向を切り出す。

   見方（専用アプリと同じもの）:
     ・通常          … 普通の動画のように、ドラッグで見回す（ピンチ／ホイールで拡大）
     ・リトルプラネット … 足元を中心に丸めた「小さな惑星」
     ・魚眼          … 180°〜360°をまるごと1枚に
     ・平面          … 元の 2:1 の絵をそのまま（横に無限につながる）
   ほかに ジャイロ（スマホを向けた方向を見る）・全画面・自動でゆっくり回る。

   外のライブラリは使わない（費用ゼロ・読み込み先ゼロの方針）。
   ここは worker.js が受け取りページの <script> に埋め込む文字列。
   そのため中でバッククォートと ${ は使えない。
   ============================================================ */

export const VIEWER360_CSS = `
  /* ---- 360° ビューア ---- */
  .v360 { position:relative; width:100%; height:min(64vh, 720px); min-height:240px; border-radius:12px; overflow:hidden; background:#000;
    user-select:none; -webkit-user-select:none; }
  .v360.full { position:fixed; inset:0; z-index:1000; height:100%; border-radius:0; }
  .v360 canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; outline:none; }
  .v360.dragging canvas { cursor:grabbing; }
  /* 狭い画面ではボタンが2段に折り返す（縦に潰れたり、はみ出したりしない） */
  .v360 .v360-top { position:absolute; top:10px; left:10px; right:10px; display:flex; align-items:center; gap:6px 8px; flex-wrap:wrap; pointer-events:none; }
  .v360 .v360-top > * { pointer-events:auto; }
  .v360 .v360-badge { font-size:11px; letter-spacing:.14em; padding:5px 10px; flex:none; white-space:nowrap; border-radius:999px; background:rgba(6,6,8,.62); color:#f4f4f5;
    border:1px solid rgba(255,255,255,.18); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
  .v360 .v360-sp { flex:1; }
  .v360 .v360-btn { font:500 12px 'Noto Sans JP',system-ui,sans-serif; padding:7px 12px; border-radius:999px; cursor:pointer; white-space:nowrap; flex:none;
    background:rgba(6,6,8,.62); color:#f4f4f5; border:1px solid rgba(255,255,255,.18); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
  .v360 .v360-btn.on { background:rgba(111,140,255,.9); color:#060608; border-color:rgba(111,140,255,.9); }
  .v360 .v360-btn:hover { border-color:rgba(255,255,255,.5); }
  .v360 select.v360-btn { -webkit-appearance:none; appearance:none; padding-right:22px; flex:0 1 auto; min-width:0; max-width:52%;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23f4f4f5' stroke-width='1.5'/%3E%3C/svg%3E");
    background-repeat:no-repeat; background-position:right 9px center; }
  .v360 select.v360-btn option { color:#060608; }
  .v360 .v360-bar { position:absolute; left:10px; right:10px; bottom:10px; display:flex; align-items:center; gap:10px; padding:8px 12px; border-radius:999px;
    background:rgba(6,6,8,.62); border:1px solid rgba(255,255,255,.14); -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
  .v360 .v360-bar[hidden] { display:none; }
  .v360 .v360-play { width:34px; height:34px; border-radius:50%; border:0; background:#f4f4f5; color:#060608; font-size:14px; cursor:pointer; flex:none; }
  .v360 .v360-seek { flex:1; min-width:60px; margin:0; accent-color:#6f8cff; }
  .v360 .v360-time { font:400 11.5px ui-monospace,SFMono-Regular,Menlo,monospace; color:#f4f4f5; white-space:nowrap; }
  .v360 .v360-mute { border:0; background:none; color:#f4f4f5; font-size:15px; cursor:pointer; padding:0 2px; }
  .v360 .v360-msg { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); padding:10px 16px; border-radius:12px;
    background:rgba(6,6,8,.72); color:#f4f4f5; font-size:13px; pointer-events:none; text-align:center; line-height:1.7; max-width:80%; }
  .v360 .v360-msg[hidden] { display:none; }
  .v360 .v360-tap { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:74px; height:74px; border-radius:50%; border:0;
    background:rgba(6,6,8,.55); color:#f4f4f5; font-size:28px; cursor:pointer; -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); }
  .v360 .v360-tap[hidden] { display:none; }
  .v360-note { margin:8px 0 0; font-size:12px; color:rgba(244,244,245,.5); line-height:1.8; }
  .v360-note a, .v360-note button { color:#adbcff; background:none; border:0; padding:0; font:inherit; cursor:pointer; text-decoration:underline; }
  .v360.full .v360-note { display:none; }
`;

export const VIEWER360_JS = `
      /* ===== 360° ===== */
      /* 横:縦 が 2:1 なら全天球（THETA・Insta360・GoPro MAX などの共通の形）。
         判定は大きさだけで決める（中の印は機種や変換で消えることが多い）。
         はずれたときのために「普通に見る」「360°として見る」の切り替えを付けている。 */
      function is360Size(w, h) { return w > 0 && h > 0 && Math.abs(w / h - 2) < 0.06; }

      function maybe360(box, el, kind, src, force) {
        var w = kind === 'image' ? el.naturalWidth : el.videoWidth;
        var h = kind === 'image' ? el.naturalHeight : el.videoHeight;
        if (!force && !is360Size(w, h)) {
          // 360°ではなさそう。念のため、切り替えの入口だけ小さく置く
          if (kind === 'video' || kind === 'image') {
            var note = document.createElement('p');
            note.className = 'v360-note';
            var b = document.createElement('button');
            b.type = 'button'; b.textContent = '360°として見る';
            b.addEventListener('click', function () { note.remove(); maybe360(box, el, kind, src, true); });
            note.appendChild(b);
            box.appendChild(note);
          }
          return false;
        }
        var ok = mount360(box, el, kind, src);
        return ok;
      }

      function mount360(box, el, kind, src) {
        var root = document.createElement('div');
        root.className = 'v360';
        var canvas = document.createElement('canvas');
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', '360°ビューア。ドラッグまたは矢印キーで見回せます');
        root.appendChild(canvas);

        var gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
          || canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
        if (!gl) return false;
        var isGL2 = (typeof WebGL2RenderingContext !== 'undefined') && (gl instanceof WebGL2RenderingContext);

        /* ---- 描画の準備 ---- */
        var VS = 'attribute vec2 aP; varying vec2 vP; void main(){ vP = aP; gl_Position = vec4(aP, 0.0, 1.0); }';
        var FS = [
          'precision highp float;',
          'varying vec2 vP;',
          'uniform sampler2D uTex;',
          'uniform float uYaw; uniform float uPitch; uniform float uFov; uniform float uAspect; uniform int uMode;',
          'const float PI = 3.14159265358979;',
          'mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }',
          'mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }',
          'void main(){',
          '  vec2 p = vP; vec3 d; vec2 uv;',
          '  if (uMode == 3) {',
          /* 平面: 2:1 の絵を枠に収め、横は無限につながる。uFov は拡大率、uYaw/uPitch は位置 */
          '    float z = uFov;',
          '    if (uAspect >= 2.0) { uv = vec2(0.5 + p.x * uAspect * 0.25 / z, 0.5 - p.y * 0.5 / z); }',
          '    else { uv = vec2(0.5 + p.x * 0.5 / z, 0.5 - p.y / uAspect / z); }',
          '    uv += vec2(uYaw / (2.0 * PI), -uPitch / PI);',
          '    if (uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0); return; }',
          '    uv.x = fract(uv.x);',
          '    gl_FragColor = texture2D(uTex, uv); return;',
          '  }',
          '  if (uMode == 1) {',
          /* リトルプラネット: 足元を中心にした平射図法 */
          '    vec2 q = vec2(p.x * uAspect, p.y) * uFov;',
          '    float r = length(q); float th = 2.0 * atan(r); float ph = atan(q.y, q.x);',
          '    d = vec3(sin(th) * cos(ph), -cos(th), -sin(th) * sin(ph));',   /* 画面の上 = 前(-z)。符号を間違えると鏡文字になる */
          '    d = rotY(-uYaw) * rotX(uPitch) * d;',
          '  } else if (uMode == 2) {',
          /* 魚眼: 等距離射影。uFov は半径いっぱいでの角度（最大 PI = 360°） */
          '    vec2 q = vec2(p.x * uAspect, p.y);',
          '    float r = length(q);',
          '    if (r > 1.0) { gl_FragColor = vec4(0.02, 0.02, 0.03, 1.0); return; }',
          '    float th = r * uFov; float ph = atan(q.y, q.x);',
          '    d = vec3(sin(th) * cos(ph), sin(th) * sin(ph), -cos(th));',
          '    d = rotY(-uYaw) * rotX(uPitch) * d;',
          '  } else {',
          /* 通常: 普通のカメラ（透視投影） */
          '    float t = tan(uFov * 0.5);',
          '    d = normalize(vec3(p.x * t * uAspect, p.y * t, -1.0));',
          '    d = rotY(-uYaw) * rotX(uPitch) * d;',
          '  }',
          '  float lon = atan(d.x, -d.z); float lat = asin(clamp(d.y, -1.0, 1.0));',
          '  uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);',
          '  gl_FragColor = texture2D(uTex, uv);',
          '}'
        ].join(String.fromCharCode(10));

        function shader(type, srcText) {
          var s = gl.createShader(type); gl.shaderSource(s, srcText); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { return null; }
          return s;
        }
        var vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
        if (!vs || !fs) return false;
        var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
        gl.useProgram(prog);
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var aP = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
        var U = {};
        ['uTex', 'uYaw', 'uPitch', 'uFov', 'uAspect', 'uMode'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(U.uTex, 0);
        var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

        /* 画像はいちど貼れば済む。大きすぎる絵は描画回路の上限に合わせて縮める。
           WebGL2 なら縮小用の段階画像(ミップマップ)を作って、遠目のチラつきを抑える。 */
        var texReady = false;
        function uploadImage(img) {
          var w = img.naturalWidth, h = img.naturalHeight;
          var limit = isGL2 ? maxTex : Math.min(maxTex, 4096);
          var srcEl = img;
          if (w > limit) {
            var c = document.createElement('canvas');
            c.width = limit; c.height = Math.round(h * limit / w);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            srcEl = c;
          }
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, srcEl);
          if (isGL2) {
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          }
          texReady = true;
        }
        var lastVideoTime = -1;
        function uploadVideo(v) {
          if (v.readyState < 2) return false;
          if (v.currentTime === lastVideoTime && texReady) return false;
          lastVideoTime = v.currentTime;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, v);
          texReady = true;
          return true;
        }

        /* ---- 見る向きと見方 ---- */
        var mode = 0;                 // 0 通常 / 1 リトルプラネット / 2 魚眼 / 3 平面
        var yaw = 0, pitch = 0;       // 見る向き（ラジアン）。yaw は右回りが正、pitch は上向きが正
        var fov = 80 * Math.PI / 180; // 通常: 縦の画角
        var planet = 1.0, fish = Math.PI * 0.75, flatZoom = 1.0;
        var vyaw = 0, vpitch = 0;     // 指を離したあとの惰性
        var autoSpin = kind === 'image';
        var touched = false;
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var W = 0, H = 0;

        function clampPitch() {
          var lim = Math.PI / 2 - 0.001;
          if (mode === 3) lim = Math.PI / 2;
          if (pitch > lim) pitch = lim; if (pitch < -lim) pitch = -lim;
        }
        function fovNow() {
          if (mode === 1) return planet;
          if (mode === 2) return fish;
          if (mode === 3) return flatZoom;
          return fov;
        }
        function resize() {
          var r = root.getBoundingClientRect();
          var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
          if (w !== W || h !== H) { W = w; H = h; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
        }
        function draw() {
          resize();
          if (!texReady) { gl.clearColor(0.02, 0.02, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
          gl.uniform1f(U.uYaw, yaw); gl.uniform1f(U.uPitch, pitch);
          gl.uniform1f(U.uFov, fovNow()); gl.uniform1f(U.uAspect, W / H); gl.uniform1i(U.uMode, mode);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        /* 描き直しは必要なときだけ（電池を食わない）。動いている間はコマごとに */
        var raf = null, lastT = 0;
        function animating() {
          return dragging || Math.abs(vyaw) > 0.0002 || Math.abs(vpitch) > 0.0002 || (autoSpin && !touched)
            || (kind === 'video' && !el.paused && !el.ended) || gyroOn;
        }
        function tick(t) {
          raf = null;
          var dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016; lastT = t;
          if (!dragging) {
            yaw += vyaw; pitch += vpitch; clampPitch();
            vyaw *= 0.92; vpitch *= 0.92;
          }
          if (autoSpin && !touched && !dragging) yaw += dt * 0.12;
          if (kind === 'video') uploadVideo(el);
          if (gyroOn) applyGyro();
          draw();
          if (animating()) raf = requestAnimationFrame(tick); else lastT = 0;
        }
        function kick() { if (!raf) raf = requestAnimationFrame(tick); }

        /* ---- 指・マウス ---- */
        var dragging = false, ptrs = {}, lastX = 0, lastY = 0, pinchD = 0, moved = false;
        function anglePerPx() {
          // 画面の 1px が何ラジアンか。通常は画角に比例、ほかは見た目が近くなるよう固定気味に
          var hCss = Math.max(1, root.getBoundingClientRect().height);
          if (mode === 0) return fov / hCss;
          if (mode === 3) return (2 * Math.PI) / (Math.max(1, root.getBoundingClientRect().width) * flatZoom) ;
          return 1.6 / hCss;
        }
        canvas.addEventListener('pointerdown', function (e) {
          canvas.setPointerCapture(e.pointerId);
          ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
          var keys = Object.keys(ptrs);
          if (keys.length === 1) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; vyaw = vpitch = 0; root.classList.add('dragging'); }
          else if (keys.length === 2) { var a = ptrs[keys[0]], b = ptrs[keys[1]]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
          touched = true;
          canvas.focus({ preventScroll: true });
          kick();
        });
        canvas.addEventListener('pointermove', function (e) {
          if (!ptrs[e.pointerId]) return;
          ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
          var keys = Object.keys(ptrs);
          if (keys.length >= 2) {
            var a = ptrs[keys[0]], b = ptrs[keys[1]];
            var d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchD > 0) zoomBy(d / pinchD);
            pinchD = d;
            return;
          }
          if (!dragging) return;
          var dx = e.clientX - lastX, dy = e.clientY - lastY;
          lastX = e.clientX; lastY = e.clientY;
          if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
          var k = anglePerPx();
          // 指についてくる向き: 左へ引けば右側が見えてくる（yaw が増える＝右を向く）
          vyaw = -dx * k; vpitch = dy * k;
          yaw += vyaw; pitch += vpitch; clampPitch();
          gyroBase = null;
          draw();
        });
        function endPtr(e) {
          delete ptrs[e.pointerId];
          if (!Object.keys(ptrs).length) {
            dragging = false; root.classList.remove('dragging'); pinchD = 0;
            // 動かさずに触っただけ（タップ）なら、動画は再生／一時停止
            if (!moved && kind === 'video') togglePlay();
            kick();
          }
        }
        canvas.addEventListener('pointerup', endPtr);
        canvas.addEventListener('pointercancel', endPtr);
        canvas.addEventListener('wheel', function (e) {
          e.preventDefault();
          zoomBy(Math.exp(-e.deltaY * 0.0015));
          touched = true; draw();
        }, { passive: false });
        canvas.addEventListener('keydown', function (e) {
          var step = 0.06; var used = true;
          if (e.key === 'ArrowLeft') yaw -= step; else if (e.key === 'ArrowRight') yaw += step;
          else if (e.key === 'ArrowUp') pitch += step; else if (e.key === 'ArrowDown') pitch -= step;
          else if (e.key === '+' || e.key === '=') zoomBy(1.1); else if (e.key === '-') zoomBy(0.9);
          else if (e.key === ' ' && kind === 'video') togglePlay();
          else used = false;
          if (used) { e.preventDefault(); touched = true; clampPitch(); draw(); }
        });
        function zoomBy(f) {
          if (mode === 0) { fov = Math.min(120 * Math.PI / 180, Math.max(25 * Math.PI / 180, fov / f)); }
          else if (mode === 1) { planet = Math.min(4, Math.max(0.35, planet / f)); }
          else if (mode === 2) { fish = Math.min(Math.PI, Math.max(Math.PI / 4, fish / f)); }
          else { flatZoom = Math.min(6, Math.max(1, flatZoom * f)); }
        }

        /* ---- ジャイロ（スマホを向けた方向を見る） ---- */
        var gyroOn = false, gyroLast = null, gyroBase = null, gyroOffset = 0;
        function onOrient(e) {
          if (e.alpha === null || e.alpha === undefined) return;
          gyroLast = e;
        }
        function mul(a, b) { // 3x3 行列の積（行優先）
          var r = [];
          for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
            r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
          }
          return r;
        }
        function rx(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
        function ry(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
        function rz(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
        function applyGyro() {
          var e = gyroLast; if (!e) return;
          var D = Math.PI / 180;
          var alpha = (e.alpha || 0) * D, beta = (e.beta || 0) * D, gamma = (e.gamma || 0) * D;
          var so = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
          // 端末の姿勢 → 端末が向いている方向（世界座標、y が上）
          var R = mul(mul(mul(mul(ry(alpha), rx(beta)), rz(-gamma)), rx(-Math.PI / 2)), rz(-so * D));
          var dx = -R[2], dy = -R[5], dz = -R[8];     // R * (0,0,-1)
          var gy = Math.atan2(dx, -dz), gp = Math.asin(Math.max(-1, Math.min(1, dy)));
          if (gyroBase === null) { gyroBase = gy; gyroOffset = yaw; }
          yaw = gyroOffset + (gy - gyroBase);
          pitch = gp; clampPitch();
        }
        function toggleGyro() {
          if (gyroOn) { gyroOn = false; window.removeEventListener('deviceorientation', onOrient); gyroBtn.classList.remove('on'); return; }
          var start = function () {
            gyroOn = true; gyroLast = null; gyroBase = null; touched = true;
            window.addEventListener('deviceorientation', onOrient);
            gyroBtn.classList.add('on');
            setTimeout(function () {
              if (gyroOn && !gyroLast) { toggleGyro(); flash('この端末ではジャイロを使えません'); }
            }, 1500);
            kick();
          };
          if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(function (s) {
              if (s === 'granted') start(); else flash('ジャイロの使用が許可されませんでした');
            }).catch(function () { flash('ジャイロを使えませんでした'); });
          } else if (typeof DeviceOrientationEvent !== 'undefined') {
            start();
          } else {
            flash('この端末ではジャイロを使えません');
          }
        }

        /* ---- 上のボタン ---- */
        var top = document.createElement('div'); top.className = 'v360-top';
        var badge = document.createElement('span'); badge.className = 'v360-badge'; badge.textContent = '360°';
        var sp = document.createElement('span'); sp.className = 'v360-sp';
        var sel = document.createElement('select'); sel.className = 'v360-btn'; sel.setAttribute('aria-label', '見方');
        [['0', '通常'], ['1', 'リトルプラネット'], ['2', '魚眼'], ['3', '平面']].forEach(function (o) {
          var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
        });
        sel.addEventListener('change', function () { setMode(Number(sel.value)); });
        var gyroBtn = document.createElement('button'); gyroBtn.type = 'button'; gyroBtn.className = 'v360-btn'; gyroBtn.textContent = 'ジャイロ';
        gyroBtn.addEventListener('click', toggleGyro);
        var fullBtn = document.createElement('button'); fullBtn.type = 'button'; fullBtn.className = 'v360-btn'; fullBtn.textContent = '全画面';
        fullBtn.addEventListener('click', toggleFull);
        top.appendChild(badge); top.appendChild(sp); top.appendChild(sel); top.appendChild(gyroBtn); top.appendChild(fullBtn);
        root.appendChild(top);

        function setMode(m) {
          mode = m; touched = true;
          if (mode === 1) { pitch = 0; }
          if (mode === 3) { pitch = 0; }
          clampPitch(); draw();
        }
        function resetView() { yaw = 0; pitch = 0; fov = 80 * Math.PI / 180; planet = 1; fish = Math.PI * 0.75; flatZoom = 1; draw(); }

        var isFull = false;
        function toggleFull() {
          if (!isFull) {
            isFull = true; root.classList.add('full'); fullBtn.textContent = '閉じる';
            if (root.requestFullscreen) { root.requestFullscreen().catch(function () {}); }
            document.addEventListener('keydown', escClose);
          } else {
            isFull = false; root.classList.remove('full'); fullBtn.textContent = '全画面';
            if (document.fullscreenElement === root && document.exitFullscreen) document.exitFullscreen().catch(function () {});
            document.removeEventListener('keydown', escClose);
          }
          setTimeout(function () { resize(); draw(); }, 50);
        }
        function escClose(e) { if (e.key === 'Escape' && isFull) toggleFull(); }
        document.addEventListener('fullscreenchange', function () {
          if (!document.fullscreenElement && isFull) { isFull = false; root.classList.remove('full'); fullBtn.textContent = '全画面'; setTimeout(function () { resize(); draw(); }, 50); }
        });

        /* ---- 真ん中のひとこと ---- */
        var msg = document.createElement('div'); msg.className = 'v360-msg'; msg.hidden = true; root.appendChild(msg);
        var msgT = null;
        function flash(t) { msg.textContent = t; msg.hidden = false; clearTimeout(msgT); msgT = setTimeout(function () { msg.hidden = true; }, 2200); }

        /* ---- 動画の操作（元の <video> は見えない所で回し、絵だけをこちらに映す） ---- */
        var bar = null, playBtn = null, seek = null, timeEl = null, muteBtn = null, tapBtn = null, seeking = false;
        function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60); return m + ':' + ('0' + (s % 60)).slice(-2); }
        function togglePlay() {
          if (kind !== 'video') return;
          if (el.paused) { el.play().catch(function () { flash('再生できませんでした'); }); } else { el.pause(); }
        }
        if (kind === 'video') {
          el.controls = false; el.playsInline = true; el.setAttribute('playsinline', '');
          el.style.position = 'absolute'; el.style.width = '1px'; el.style.height = '1px'; el.style.opacity = '0'; el.style.pointerEvents = 'none';
          bar = document.createElement('div'); bar.className = 'v360-bar';
          playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'v360-play'; playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', '再生');
          playBtn.addEventListener('click', togglePlay);
          seek = document.createElement('input'); seek.type = 'range'; seek.className = 'v360-seek'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.setAttribute('aria-label', '再生位置');
          seek.addEventListener('input', function () { seeking = true; if (el.duration) { el.currentTime = el.duration * Number(seek.value) / 1000; } });
          seek.addEventListener('change', function () { seeking = false; kick(); });
          timeEl = document.createElement('span'); timeEl.className = 'v360-time'; timeEl.textContent = '0:00 / 0:00';
          muteBtn = document.createElement('button'); muteBtn.type = 'button'; muteBtn.className = 'v360-mute'; muteBtn.textContent = '🔊'; muteBtn.setAttribute('aria-label', '消音');
          muteBtn.addEventListener('click', function () { el.muted = !el.muted; muteBtn.textContent = el.muted ? '🔇' : '🔊'; });
          bar.appendChild(playBtn); bar.appendChild(seek); bar.appendChild(timeEl); bar.appendChild(muteBtn);
          root.appendChild(bar);
          // 長さはもう分かっていることが多い（durationchange はこの前に済んでいる）ので、今すぐ出す
          if (el.duration) timeEl.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration);
          tapBtn = document.createElement('button'); tapBtn.type = 'button'; tapBtn.className = 'v360-tap'; tapBtn.textContent = '▶'; tapBtn.setAttribute('aria-label', '再生');
          tapBtn.addEventListener('click', togglePlay);
          root.appendChild(tapBtn);
          el.addEventListener('play', function () { playBtn.textContent = '❚❚'; tapBtn.hidden = true; kick(); });
          el.addEventListener('pause', function () { playBtn.textContent = '▶'; tapBtn.hidden = false; });
          el.addEventListener('ended', function () { playBtn.textContent = '▶'; tapBtn.hidden = false; });
          el.addEventListener('timeupdate', function () {
            if (el.duration && !seeking) seek.value = String(Math.round(el.currentTime / el.duration * 1000));
            timeEl.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration);
          });
          el.addEventListener('seeked', function () { uploadVideo(el); draw(); });
          el.addEventListener('loadeddata', function () { uploadVideo(el); draw(); });
          el.addEventListener('durationchange', function () { timeEl.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration); });
          if (typeof el.requestVideoFrameCallback === 'function') {
            var onFrame = function () { if (!el.paused) { uploadVideo(el); draw(); } el.requestVideoFrameCallback(onFrame); };
            el.requestVideoFrameCallback(onFrame);
          }
        }

        /* ---- 置く ---- */
        var note = document.createElement('p'); note.className = 'v360-note';
        note.appendChild(document.createTextNode('ドラッグで見回せます。ピンチ／ホイールで拡大縮小。 '));
        var back = document.createElement('button'); back.type = 'button';
        back.textContent = kind === 'video' ? '普通の動画として見る' : '普通の画像として見る';
        back.addEventListener('click', function () {
          if (isFull) toggleFull();
          if (gyroOn) toggleGyro();
          if (raf) cancelAnimationFrame(raf); raf = null;
          if (kind === 'video') { el.pause(); el.controls = true; el.style.cssText = ''; }
          else { el.style.display = ''; }
          root.remove(); note.remove();
        });
        note.appendChild(back);
        var rs = document.createElement('button'); rs.type = 'button'; rs.textContent = '向きをもどす'; rs.style.marginLeft = '10px';
        rs.addEventListener('click', function () { touched = true; resetView(); });
        note.appendChild(rs);
        /* この向きを「普通の」写真・動画にする。
           写真はこの場で保存、動画はサイトの動画編集（向きと比率を選んで書き出す）へ渡す。 */
        var mk = document.createElement('button'); mk.type = 'button'; mk.style.marginLeft = '10px';
        mk.textContent = kind === 'video' ? 'この向きで普通の動画に切り出す ↗' : 'この向きを写真として保存';
        mk.addEventListener('click', function () {
          var deg = function (r) { return Math.round(r * 180 / Math.PI * 10) / 10; };
          if (kind === 'video') {
            var abs = new URL(src, location.href).href;
            var u = 'https://tsutsumufunakoshi.com/tools/video/?src=' + encodeURIComponent(abs)
              + '&yaw=' + deg(yaw) + '&pitch=' + deg(pitch) + '&fov=' + deg(fov);
            window.open(u, '_blank', 'noopener');
            return;
          }
          var keep = mode; mode = 0; draw(); mode = keep;
          canvas.toBlob(function (b) {
            if (!b) { flash('保存できませんでした'); draw(); return; }
            var a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = String(name || 'photo').replace(/\\.[A-Za-z0-9]+$/, '') + '_view.jpg';
            document.body.appendChild(a); a.click(); a.remove();
            draw();
          }, 'image/jpeg', 0.92);
        });
        note.appendChild(mk);

        if (kind === 'image') { el.style.display = 'none'; }
        box.insertBefore(root, el);
        box.appendChild(note);
        if (kind === 'video' && el.parentNode !== root) root.appendChild(el);

        if (typeof ResizeObserver !== 'undefined') { new ResizeObserver(function () { resize(); draw(); }).observe(root); }
        else { window.addEventListener('resize', function () { resize(); draw(); }); }

        if (kind === 'image') { uploadImage(el); }
        else { uploadVideo(el); }
        draw();
        kick();
        return true;
      }
`;
