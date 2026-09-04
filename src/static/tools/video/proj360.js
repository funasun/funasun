/* ============================================================
   proj360.js — 360°の絵（正距円筒 2:1）から、普通のカメラの絵を切り出す
   ------------------------------------------------------------
   受け取りページの 360°ビューアと同じ考え方（球の内側に貼って、
   見たい方向を透視投影で切り出す）を、書き出し用に独立させたもの。
   1コマ（VideoFrame / <video> / <img> / canvas）を渡すと、
   指定の向き・画角で切り出した絵を出力サイズの canvas に描いて返す。
   プレビューと書き出しの両方がこれを使うので、見たままが出てくる。
   ============================================================ */
(function (global) {
  'use strict';

  var VS = 'attribute vec2 aP; varying vec2 vP; void main(){ vP = aP; gl_Position = vec4(aP, 0.0, 1.0); }';
  var FS = [
    'precision highp float;',
    'varying vec2 vP;',
    'uniform sampler2D uTex;',
    'uniform float uYaw; uniform float uPitch; uniform float uFov; uniform float uAspect;',
    'uniform float uTilt; uniform float uTdir;',      // 水平補正（元の「上」のずれ）
    'const float PI = 3.14159265358979;',
    'mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }',
    'mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }',
    'void main(){',
    '  float t = tan(uFov * 0.5);',
    '  vec3 d = normalize(vec3(vP.x * t * uAspect, vP.y * t, -1.0));',
    '  d = rotY(-uYaw) * rotX(uPitch) * d;',            // yaw は右回りが正、pitch は上向きが正
    '  if (uTilt != 0.0) { d = rotY(uTdir) * rotX(-uTilt) * rotY(-uTdir) * d; }',
    '  float lon = atan(d.x, -d.z); float lat = asin(clamp(d.y, -1.0, 1.0));',
    '  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);',
    '  gl_FragColor = texture2D(uTex, uv);',
    '}'
  ].join('\n');

  /* W×H の出力を持つ切り出し器を作る。canvasEl を渡せばその canvas に描く
     （プレビュー用）。渡さなければ画面に出ない canvas を内側に持つ（書き出し用）。 */
  function create(W, H, canvasEl) {
    var canvas = canvasEl || ((typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(W, H) : document.createElement('canvas'));
    canvas.width = W; canvas.height = H;
    var opts = { antialias: false, alpha: false, preserveDrawingBuffer: false, premultipliedAlpha: false };
    var gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
    if (!gl) return null;
    var isGL2 = (typeof WebGL2RenderingContext !== 'undefined') && (gl instanceof WebGL2RenderingContext);

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var aP = gl.getAttribLocation(prog, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['uTex', 'uYaw', 'uPitch', 'uFov', 'uAspect', 'uTilt', 'uTdir'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(U.uTex, 0);
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    var fallback = null;   // VideoFrame を直接貼れない環境向けの、いったん2Dに写す canvas

    function sizeOf(src) {
      if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return [src.displayWidth || src.codedWidth, src.displayHeight || src.codedHeight];
      if (src.videoWidth) return [src.videoWidth, src.videoHeight];
      if (src.naturalWidth) return [src.naturalWidth, src.naturalHeight];
      return [src.width, src.height];
    }
    function upload(src) {
      var wh = sizeOf(src);
      var el = src;
      // 描画回路の上限より大きい絵は縮めてから貼る
      if (wh[0] > maxTex) {
        var lim = maxTex;
        if (!fallback) fallback = document.createElement('canvas');
        fallback.width = lim; fallback.height = Math.round(wh[1] * lim / wh[0]);
        fallback.getContext('2d').drawImage(src, 0, 0, fallback.width, fallback.height);
        el = fallback;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
      } catch (e) {
        // VideoFrame をそのまま受け付けない古い環境: いったん 2D canvas に写す
        if (!fallback) fallback = document.createElement('canvas');
        fallback.width = wh[0]; fallback.height = wh[1];
        fallback.getContext('2d').drawImage(src, 0, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, fallback);
      }
    }

    /* src: VideoFrame / <video> / <img> / canvas。yaw・pitch・fov はラジアン（fov は縦の画角） */
    function draw(src, yaw, pitch, fov, tilt, tdir) {
      if (src) upload(src);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(U.uYaw, yaw || 0);
      gl.uniform1f(U.uPitch, pitch || 0);
      gl.uniform1f(U.uFov, fov || (80 * Math.PI / 180));
      gl.uniform1f(U.uTilt, tilt || 0);
      gl.uniform1f(U.uTdir, tdir || 0);
      gl.uniform1f(U.uAspect, canvas.width / canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas;
    }
    function resize(w, h) { canvas.width = w; canvas.height = h; }

    return { canvas: canvas, draw: draw, resize: resize, isGL2: isGL2 };
  }

  global.Proj360 = { create: create };
})(window);
