/* metal-shader.js
   Animated liquid-metal surface for the "Enter → Do" control.

   The plasma shader is copied from metal-fx v1.0.4 (MIT, Jakub Antalik,
   https://github.com/Jakubantalik/metal-fx) using the "silver" dark preset,
   so the animation matches the reference component at metal.jakubantalik.com.
   Two small Decisive-only additions sit on top of the copied shader:
     - a thin ring mask that follows the control shape (square corners on the
       divider side, rounded corners on the right), replicating the ring
       punch-out metal-fx does in 2D;
     - a reduced-motion freeze and a gentle pointer/focus response.
   See THIRD_PARTY_NOTICES.md for the full MIT license.

   Self-contained module: creates the canvas, owns the WebGL setup, render
   loop, resize, pointer/focus state, reduced-motion behavior, and the
   webglcontextlost/restored lifecycle. If WebGL is unavailable or the
   "Metal Enter key" setting is off, the canvas is removed and the CSS silver
   rim (`.enter-key::before`) stays as the fallback. Everything is local and
   offline; no network resources are loaded.
*/
(() => {
  'use strict';

  const KEY = 'decisive.metalEffectEnabled';
  const DPR_CAP = 1.5;
  const RADIUS_CSS_PX = 10;

  const el = document.querySelector('.enter-key');
  const control = document.querySelector('.capture-control');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!el || !control) return;

  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'false'; } catch {}

  const CONTEXT_ATTRIBS = {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  };

  // silver dark preset, matching metal-fx defaults.
  const PRESET = {
    colors: ['#4d4d4d', '#ececec', '#a3a3a1', '#f2f2f2', '#565656', '#ffffff', '#f5f5f5'],
    alphas: [1, 1, 1, 1, 1, 1, 1],
    direction: 80 * Math.PI / 180,
    speed: 1.2,
    intensity: 2.5,
    scale: 2.5,
    softness: 0.18,
    distortion: 0.3,
    complexity: 0.68,
    shape: 1,
    blur: 1,
    vignette: 0.26,
    vigOpacity: 0.6,
    shaderOpacity: 1,
    ringPx: 1,
  };
  const PRESET_COLORS = PRESET.colors.map(hex => {
    const v = hex.replace('#', '');
    return [
      parseInt(v.slice(0, 2), 16) / 255,
      parseInt(v.slice(2, 4), 16) / 255,
      parseInt(v.slice(4, 6), 16) / 255,
    ];
  });

  let canvas = null;
  let gl = null;
  let program = null;
  let running = false;
  let rafId = 0;
  let mounted = false;
  let observer = null;
  let dpr = 1;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let hover = 0;
  let hoverTarget = 0;
  let focus = 0;
  let focusTarget = 0;

  // Vertex shader from metal-fx v1.0.4.
  const VERT_SRC = [
    'attribute vec2 a_position;',
    'void main() { gl_Position = vec4(a_position, 0.0, 1.0); }',
  ].join('\n');

  // Fragment shader from metal-fx v1.0.4 (silver preset) plus the ring mask,
  // reduced-motion freeze, and pointer/focus response noted in the header.
  const FRAG_SRC = [
    'precision highp float;',
    '',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform vec3 u_color1, u_color2, u_color3, u_color4, u_color5, u_color6, u_color7;',
    'uniform float u_alpha1, u_alpha2, u_alpha3, u_alpha4, u_alpha5, u_alpha6, u_alpha7;',
    'uniform float u_intensity, u_scale, u_direction;',
    'uniform float u_softness, u_distortion, u_complexity, u_shape;',
    'uniform float u_vignette, u_vigOpacity, u_blur, u_shaderOpacity;',
    '',
    '// Decisive integration uniforms',
    'uniform float u_motion;   // 0 freezes the animation (reduced motion)',
    'uniform float u_dpr;',
    'uniform float u_radius;   // corner radius, device px',
    'uniform float u_ringPx;   // ring thickness, css px',
    'uniform vec2  u_pointer;  // pointer position, 0..1, bottom-left origin',
    'uniform float u_hover;',
    'uniform float u_focus;',
    '',
    'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }',
    'vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }',
    '',
    'float snoise(vec2 v) {',
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439,',
    '                      -0.577350269189626, 0.024390243902439);',
    '  vec2 i = floor(v + dot(v, C.yy));',
    '  vec2 x0 = v - i + dot(i, C.xx);',
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);',
    '  vec4 x12 = x0.xyxy + C.xxzz;',
    '  x12.xy -= i1;',
    '  i = mod289v2(i);',
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));',
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);',
    '  m = m * m; m = m * m;',
    '  vec3 x_ = 2.0 * fract(p * C.www) - 1.0;',
    '  vec3 h = abs(x_) - 0.5;',
    '  vec3 ox = floor(x_ + 0.5);',
    '  vec3 a0 = x_ - ox;',
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);',
    '  vec3 g;',
    '  g.x = a0.x * x0.x + h.x * x0.y;',
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;',
    '  return 130.0 * dot(m, g);',
    '}',
    '',
    'float fbm(vec2 p, float oct) {',
    '  float val = 0.0, amp = 0.5;',
    '  int n = int(oct);',
    '  for (int i = 0; i < 7; i++) {',
    '    if (i >= n) break;',
    '    val += amp * snoise(p);',
    '    p *= 2.0;',
    '    amp *= 0.5;',
    '  }',
    '  return val;',
    '}',
    '',
    'float nfbm(vec2 p) { return fbm(p, 3.0 + u_complexity * 4.0); }',
    '',
    '/* 5-stop palette used by effect 1 (Plasma) — direct port of `palette` from',
    ' * the canonical engine. Stops at t = 0, 0.25, 0.5, 0.75, 1.0. */',
    'vec3 palette(float t) {',
    '  t = clamp(t, 0.0, 1.0);',
    '  t = t * t * (3.0 - 2.0 * t);',
    '  float k = 64.0;',
    '  float w1 = u_alpha1 * exp(-k * t * t);',
    '  float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));',
    '  float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));',
    '  float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));',
    '  float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));',
    '  float total = w1 + w2 + w3 + w4 + w5 + 0.0001;',
    '  return (u_color1 * w1 + u_color2 * w2 + u_color3 * w3 +',
    '          u_color4 * w4 + u_color5 * w5) / total;',
    '}',
    '',
    'float paletteAlpha(float t) {',
    '  t = clamp(t, 0.0, 1.0);',
    '  t = t * t * (3.0 - 2.0 * t);',
    '  float k = 64.0;',
    '  float w1 = u_alpha1 * exp(-k * t * t);',
    '  float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));',
    '  float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));',
    '  float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));',
    '  float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));',
    '  float totalW = w1 + w2 + w3 + w4 + w5 + 0.0001;',
    '  float rawW = exp(-k * t * t)',
    '             + exp(-k * (t - 0.25) * (t - 0.25))',
    '             + exp(-k * (t - 0.5)  * (t - 0.5))',
    '             + exp(-k * (t - 0.75) * (t - 0.75))',
    '             + exp(-k * (t - 1.0)  * (t - 1.0))',
    '             + 0.0001;',
    '  return totalW / rawW;',
    '}',
    '',
    'vec2 warp(vec2 p, float t) {',
    '  float str = u_distortion * 2.0;',
    '  return vec2(',
    '    nfbm(p + vec2(t * 0.1, 0.0)),',
    '    nfbm(p + vec2(0.0, t * 0.12) + 5.0)',
    '  ) * str;',
    '}',
    '',
    '/* Plasma: four sine bands warped by an FBM field, mapped through the',
    ' * 5-stop palette. Identical to effect 1 in the canonical engine. */',
    'vec3 computeEffect(vec2 uv, float aspect, float t, float dist, float cpx) {',
    '  vec2 p = (uv - 0.5) * u_scale;',
    '  p.x *= aspect;',
    '  p += vec2(cos(u_direction), sin(u_direction)) * t * 0.15;',
    '',
    '  float freq = 3.0 + cpx * 8.0;',
    '  float val = 0.0;',
    '  val += sin(p.x * freq + t);',
    '  val += sin(p.y * freq + t * 1.3);',
    '  val += sin((p.x + p.y) * freq * 0.7 + t * 0.7);',
    '  val += sin(length(p) * freq * 0.8 - t * 1.5);',
    '  vec2 w = warp(p, t);',
    '  val += (w.x + w.y) * dist;',
    '  val = val * 0.2 * u_intensity + 0.5;',
    '',
    '  return palette(clamp(val, 0.0, 1.0));',
    '}',
    '',
    'void main() {',
    '  // Decisive: sample the square plasma as metal-fx does when it crops its',
    '  // shared square buffer onto a wide control (design size 140x40,',
    '  // shaderScale 1.6).',
    '  float S = max(u_resolution.x, u_resolution.y);',
    '  vec2 uvEl = (gl_FragCoord.xy - (u_resolution - S) * 0.5) / S;',
    '  vec2 crop = vec2(u_resolution.x / (u_dpr * 224.0), u_resolution.y / (u_dpr * 64.0));',
    '  crop = min(crop, 1.0);',
    '  vec2 uv = (uvEl - 0.5) * crop + 0.5;',
    '',
    '  // Decisive: gentle tilt toward the pointer while hovering.',
    '  uv += (u_pointer - 0.5) * 0.10 * u_hover;',
    '',
    '  float aspect = 1.0;',
    '  float t = u_time * u_motion; // Decisive: frozen under reduced motion',
    '  float dist = u_distortion;',
    '  float cpx = u_complexity;',
    '',
    '  /* 5-tap cross blur (center + cardinal offsets). The chromatic/silver/gold',
    '   * presets all ship with blur=1 so this path is always active. 5 taps',
    '   * instead of the canonical engine\'s 9 saves ~44% fragment work; the',
    '   * perceptual difference is nil because the output is already soft from',
    '   * the plasma\'s low spatial frequency and CSS blur on reflections. */',
    '  vec3 col;',
    '  if (u_blur < 0.01) {',
    '    col = computeEffect(uv, aspect, t, dist, cpx);',
    '  } else {',
    '    float r = u_blur * 0.02;',
    '    col  = computeEffect(uv,                  aspect, t, dist, cpx) * 0.4;',
    '    col += computeEffect(uv + vec2( r, 0.0),  aspect, t, dist, cpx) * 0.15;',
    '    col += computeEffect(uv + vec2(-r, 0.0),  aspect, t, dist, cpx) * 0.15;',
    '    col += computeEffect(uv + vec2(0.0,  r),  aspect, t, dist, cpx) * 0.15;',
    '    col += computeEffect(uv + vec2(0.0, -r),  aspect, t, dist, cpx) * 0.15;',
    '  }',
    '',
    '  /* Gamma punch — adds the contrast pop that defines the chromatic',
    '   * highlights. From the canonical engine: `col = pow(col, vec3(1.3))`. */',
    '  col = pow(col, vec3(1.3));',
    '',
    '  /* Vignette — soft edge darkening so corners read as recessed. The 40-px',
    '   * scale at the bottom of the formula is hard-coded in the canonical',
    '   * engine; we keep it for visual parity. */',
    '  float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));',
    '  float vigPx = 40.0 / min(u_resolution.x, u_resolution.y);',
    '  float vigRange = vigPx * (1.0 + u_vignette * 3.0);',
    '  float vig = edgeDist * edgeDist / (vigRange * vigRange);',
    '  vig = smoothstep(0.0, 1.0, vig);',
    '  col *= mix(1.0, vig, u_vignette * u_vigOpacity);',
    '',
    '  float colorAlpha = (u_alpha1 + u_alpha2 + u_alpha3 + u_alpha4 + u_alpha5) / 5.0;',
    '  if (colorAlpha < 0.999) {',
    '    vec3 c1d = col - u_color1, c2d = col - u_color2, c3d = col - u_color3,',
    '         c4d = col - u_color4, c5d = col - u_color5;',
    '    float prox1 = exp(-8.0 * dot(c1d, c1d));',
    '    float prox2 = exp(-8.0 * dot(c2d, c2d));',
    '    float prox3 = exp(-8.0 * dot(c3d, c3d));',
    '    float prox4 = exp(-8.0 * dot(c4d, c4d));',
    '    float prox5 = exp(-8.0 * dot(c5d, c5d));',
    '    float pTotal = prox1 + prox2 + prox3 + prox4 + prox5 + 0.0001;',
    '    colorAlpha = (prox1 * u_alpha1 + prox2 * u_alpha2 + prox3 * u_alpha3 +',
    '                  prox4 * u_alpha4 + prox5 * u_alpha5) / pTotal;',
    '  }',
    '  float alpha = colorAlpha;',
    '',
    '  /* Touch the unused-at-effect-1 uniforms so GL drivers that complain about',
    '   * declared-but-unread uniforms (some Mali / Adreno builds do) keep them',
    '   * live. The contribution is provably zero. */',
    '  alpha += 0.0 * (u_softness + u_shape +',
    '                  u_alpha6 + u_alpha7 +',
    '                  u_color6.x + u_color7.x);',
    '',
    '  // Decisive ring mask: only a thin metal ring around the control outline',
    '  // keeps the liquid (square corners on the divider side, rounded right).',
    '  vec2 p = gl_FragCoord.xy - u_resolution * 0.5;',
    '  vec2 h = u_resolution * 0.5;',
    '  float rad = p.x >= 0.0 ? u_radius : 0.0;',
    '  vec2 rq = abs(p) - h + rad;',
    '  float d = min(max(rq.x, rq.y), 0.0) + length(max(rq, 0.0)) - rad;',
    '  float rimT = u_ringPx * u_dpr;',
    '  float ring = (1.0 - smoothstep(0.0, rimT, d)) * smoothstep(-rimT, 0.0, d);',
    '',
    '  float interact = 1.0 + 0.08 * u_hover + 0.08 * u_focus;',
    '  col = min(col * 1.4, vec3(1.0));',
    '  gl_FragColor = vec4(col, alpha * u_shaderOpacity * ring * interact);',
    '}',
  ].join('\n');

  const U = {
    resolution: null,
    time: null,
    color1: null, color2: null, color3: null, color4: null, color5: null, color6: null, color7: null,
    alpha1: null, alpha2: null, alpha3: null, alpha4: null, alpha5: null, alpha6: null, alpha7: null,
    intensity: null, scale: null, direction: null,
    softness: null, distortion: null, complexity: null, shape: null,
    vignette: null, vigOpacity: null, blur: null, shaderOpacity: null,
    motion: null, dpr: null, radius: null, ringPx: null,
    pointer: null, hover: null, focus: null,
  };

  function compile(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Decisive metal shader failed to compile:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function setupProgram() {
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return false;
    }
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Decisive metal shader failed to link:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      program = null;
      return false;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    for (const name of Object.keys(U)) U[name] = gl.getUniformLocation(program, `u_${name}`);
    setPreset();
    return true;
  }

  // Static preset uniforms; dynamic uniforms are set per frame in renderFrame.
  function setPreset() {
    for (let i = 0; i < 7; i++) {
      gl.uniform3f(U[`color${i + 1}`], PRESET_COLORS[i][0], PRESET_COLORS[i][1], PRESET_COLORS[i][2]);
      gl.uniform1f(U[`alpha${i + 1}`], PRESET.alphas[i]);
    }
    gl.uniform1f(U.intensity, PRESET.intensity);
    gl.uniform1f(U.scale, PRESET.scale);
    gl.uniform1f(U.direction, PRESET.direction);
    gl.uniform1f(U.softness, PRESET.softness);
    gl.uniform1f(U.distortion, PRESET.distortion);
    gl.uniform1f(U.complexity, PRESET.complexity);
    gl.uniform1f(U.shape, PRESET.shape);
    gl.uniform1f(U.vignette, PRESET.vignette);
    gl.uniform1f(U.vigOpacity, PRESET.vigOpacity);
    gl.uniform1f(U.blur, PRESET.blur);
    gl.uniform1f(U.shaderOpacity, PRESET.shaderOpacity);
    gl.uniform1f(U.ringPx, PRESET.ringPx);
  }

  function resize() {
    if (!gl || !canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(U.resolution, canvas.width, canvas.height);
  }

  function renderFrame(now) {
    gl.uniform1f(U.time, now * PRESET.speed);
    gl.uniform1f(U.motion, reducedMotion.matches ? 0 : 1);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform1f(U.radius, RADIUS_CSS_PX * dpr);
    gl.uniform2f(U.pointer, pointerX, 1 - pointerY);
    gl.uniform1f(U.hover, hover);
    gl.uniform1f(U.focus, focus);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    hover += (hoverTarget - hover) * 0.12;
    focus += (focusTarget - focus) * 0.12;
    renderFrame(performance.now() / 1000);
  }

  function stopLoop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
  }

  function startLoop() {
    if (running || !gl || !program) return;
    if (document.hidden) return;
    if (reducedMotion.matches) {
      hover = hoverTarget;
      focus = focusTarget;
      renderFrame(performance.now() / 1000);
      return;
    }
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function onContextLost(event) {
    event.preventDefault();
    stopLoop();
    gl = null;
  }

  function onContextRestored() {
    if (!canvas || !enabled) return;
    gl = canvas.getContext('webgl2', CONTEXT_ATTRIBS)
      || canvas.getContext('webgl', CONTEXT_ATTRIBS)
      || canvas.getContext('experimental-webgl', CONTEXT_ATTRIBS);
    if (!gl || !setupProgram()) {
      teardown();
      return;
    }
    resize();
    startLoop();
  }

  function onPointerEnter() { hoverTarget = 1; }
  function onPointerLeave() { hoverTarget = 0; }
  function onPointerMove(event) {
    const rect = el.getBoundingClientRect();
    pointerX = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
    pointerY = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
  }
  function onFocusIn() { focusTarget = 1; }
  function onFocusOut() { focusTarget = 0; }

  function mount() {
    if (!enabled || mounted) return;
    canvas = document.createElement('canvas');
    canvas.className = 'enter-key-metal';
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);

    gl = canvas.getContext('webgl2', CONTEXT_ATTRIBS)
      || canvas.getContext('webgl', CONTEXT_ATTRIBS)
      || canvas.getContext('experimental-webgl', CONTEXT_ATTRIBS);
    if (!gl || !setupProgram()) {
      canvas.remove();
      canvas = null;
      gl = null;
      return;
    }

    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    control.addEventListener('focusin', onFocusIn);
    control.addEventListener('focusout', onFocusOut);
    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('pointermove', onPointerMove);

    observer = new ResizeObserver(resize);
    observer.observe(el);

    mounted = true;
    el.classList.add('metal-active');
    resize();
    startLoop();
  }

  function teardown() {
    stopLoop();
    if (observer) { observer.disconnect(); observer = null; }
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      canvas.remove();
    }
    control.removeEventListener('focusin', onFocusIn);
    control.removeEventListener('focusout', onFocusOut);
    el.removeEventListener('pointerenter', onPointerEnter);
    el.removeEventListener('pointerleave', onPointerLeave);
    el.removeEventListener('pointermove', onPointerMove);
    el.classList.remove('metal-active');
    canvas = null;
    gl = null;
    program = null;
    mounted = false;
  }

  function handleSetting(event) {
    enabled = event.detail?.enabled !== false;
    if (enabled) mount(); else teardown();
  }

  function handleReducedMotionChange() {
    stopLoop();
    if (mounted) {
      resize();
      startLoop(); // static frame while reduce is preferred
    }
  }

  function handleVisibility() {
    if (document.hidden) stopLoop();
    else { resize(); startLoop(); }
  }

  window.addEventListener('decisive:metal-effect', handleSetting);
  reducedMotion.addEventListener('change', handleReducedMotionChange);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', stopLoop);
  window.addEventListener('focus', handleVisibility);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', teardown, { once: true });

  mount();
})();