/**
 * themes/neon.js — « HUD néon » : cockpit tactique cyan/magenta.
 *
 * Ce que le thème exploite du medium canvas/WebGL :
 *   - un fond écrit en GLSL (grille en perspective qui défile vers l'horizon,
 *     champ d'étoiles, lueur d'horizon) posé dans un `PIXI.Filter` maison ;
 *   - un radar central dont la traînée de balayage vit dans deux
 *     `RenderTexture` en ping-pong : chaque image rejoue la précédente
 *     affaiblie, ce qu'aucun dessin `Graphics` ne saurait faire ;
 *   - un `AdvancedBloomFilter` posé sur `layers.scene` (jamais sur
 *     `app.stage`, qui appartient à effects.js) et un `RGBSplitFilter`
 *     monté le temps d'un glitch à chaque action ;
 *   - une transition d'entrée par balayage horizontal avec séparation RVB.
 *
 * Emplacements : bureau = cockpit trois colonnes (contrôles à gauche, radar
 * au centre, actions à droite, ticker en bas) ; mobile = même cockpit
 * compacté, tout visible d'un coup, rien hors écran.
 *
 * Tout l'état vivant du thème tient dans `S`, construit par `ensure()`
 * (idempotent, appelé depuis layout/decor/paint) et démoli par
 * `transition.out` — le seul accroche-démontage qu'un thème possède.
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  if (!global.Juicy || !PIXI) {
    console.warn('[juicy] themes/neon.js chargé sans le noyau');
    return;
  }
  var Juicy = global.Juicy;
  var FX = PIXI.filters || {};
  var gsap = global.gsap || null;

  function J() { return Juicy.instance; }
  function has(n) { return typeof FX[n] === 'function'; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function merge(a, b) {
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    if (!isObj(b)) return out;
    for (k in b) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
      out[k] = (isObj(out[k]) && isObj(b[k])) ? merge(out[k], b[k]) : b[k];
    }
    return out;
  }
  function kill(o) { if (gsap) try { gsap.killTweensOf(o); } catch (e) { /* ignore */ } }
  function dead(o) { return !o || o.destroyed; }

  // ------------------------------------------------------------- palette

  var C = {
    bg: 0x030810, bgAlt: 0x061622, surface: 0x07202f, surfaceAlt: 0x0c3347,
    border: 0x1d7d9c, text: 0xdcfbff, muted: 0x6fb4cc,
    accent: 0x2ff0ff, accentText: 0x02131a, danger: 0xff4fb0, success: 0x4dffcf
  };
  var FONT = "Orbitron, 'Segoe UI', system-ui, sans-serif";

  // Un tracé à coins coupés : deux angles rabattus, les deux autres francs.
  // C'est la forme de tous les panneaux, boutons et interrupteurs du thème.
  function cutPts(x, y, w, h, c) {
    c = Math.min(c, w / 2, h / 2);
    return [x + c, y, x + w, y, x + w, y + h - c, x + w - c, y + h, x, y + h, x, y + c];
  }
  function cut(g, x, y, w, h, c) { g.poly(cutPts(x, y, w, h, c), true); return g; }

  // ------------------------------------------------------------- shader
  //
  // Vertex standard des filtres Pixi v8 (GLSL ES 3.00), recopié ici pour que
  // le thème ne dépende d'aucun export interne du moteur.

  var VERT = [
    'in vec2 aPosition;',
    'out vec2 vTextureCoord;',
    'uniform vec4 uInputSize;',
    'uniform vec4 uOutputFrame;',
    'uniform vec4 uOutputTexture;',
    'vec4 filterVertexPosition( void ) {',
    '  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;',
    '  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;',
    '  position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;',
    '  return vec4(position, 0.0, 1.0);',
    '}',
    'vec2 filterTextureCoord( void ) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }',
    'void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }'
  ].join('\n');

  // Pas de `fwidth` : la largeur des lignes de grille est calculée
  // analytiquement (dérivée exacte de la projection), ce qui reste juste
  // même si le contexte retombe sur un profil sans dérivées.
  var FRAG = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    // `highp` explicite : le vertex des filtres Pixi déclare uInputSize en
    // haute précision, et un fragment en mediump ferait échouer l'édition
    // de liens (« Precisions of uniform differ between VERTEX and FRAGMENT »).
    'uniform sampler2D uTexture;',
    'uniform highp vec4 uInputSize;',
    'uniform float uTime;',
    'uniform float uEnergy;',
    'uniform vec2 uSize;',
    '',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    '',
    'void main(void) {',
    '  vec2 px = vTextureCoord * uInputSize.xy;',
    '  vec2 uv = px / max(uSize, vec2(1.0));',
    '  float ar = uSize.x / max(1.0, uSize.y);',
    '  vec2 p = uv * 2.0 - 1.0;',
    '  p.x *= ar;',
    '  float e = clamp(uEnergy, 0.0, 1.0);',
    '',
    '  vec3 col = mix(vec3(0.004, 0.014, 0.032), vec3(0.008, 0.042, 0.066), clamp(uv.y * 1.15, 0.0, 1.0));',
    '',
    '  float hz = -0.28;',            // horizon un peu au-dessus du centre
    '  float dy = p.y - hz;',
    '',
    '  // ciel : champ d\'étoiles qui scintille',
    '  if (dy < 0.0) {',
    '    vec2 g = uv * vec2(150.0, 84.0);',
    '    vec2 id = floor(g);',
    '    float s = hash(id);',
    '    if (s > 0.978) {',
    '      vec2 cc = vec2(hash(id + 1.37), hash(id + 7.71));',
    '      float d = length(fract(g) - cc);',
    '      float tw = 0.40 + 0.60 * sin(uTime * 2.2 + s * 63.0);',
    '      col += vec3(0.34, 0.86, 1.00) * smoothstep(0.20, 0.0, d) * tw * smoothstep(0.0, -0.22, dy);',
    '    }',
    '    float band = sin(uv.x * 3.1 - uTime * 0.18) * 0.5 + 0.5;',
    '    col += vec3(0.12, 0.02, 0.18) * band * smoothstep(0.0, -0.9, dy);',
    '  }',
    '',
    '  // sol : grille en perspective qui fuit vers l\'horizon',
    '  if (dy > 0.0) {',
    '    float z = 1.15 / dy;',
    '    float gx = p.x * z;',
    '    float gz = z + uTime * (2.4 + e * 4.5);',
    '    float dpy = 2.0 / max(1.0, uSize.y);',
    '    float dpx = 2.0 * ar / max(1.0, uSize.x);',
    '    float wz = clamp((z / dy) * dpy, 0.0008, 0.46);',
    '    float wx = clamp(z * dpx, 0.0008, 0.46);',
    '    float lz = abs(fract(gz) - 0.5);',
    '    float lx = abs(fract(gx) - 0.5);',
    '    float gridZ = 1.0 - smoothstep(0.0, wz * 1.6, lz);',
    '    float gridX = 1.0 - smoothstep(0.0, wx * 1.6, lx);',
    '    float fade = exp(-z * 0.085);',
    '    vec3 cyan = vec3(0.10, 0.92, 1.00);',
    '    vec3 mag = vec3(1.00, 0.24, 0.66);',
    '    col += cyan * gridZ * fade * (0.95 + e * 1.30);',
    '    col += mix(cyan, mag, clamp(abs(p.x) * 0.48, 0.0, 1.0)) * gridX * fade * (0.78 + e * 1.10);',
    '    col += vec3(0.02, 0.11, 0.16) * fade;',
    '  }',
    '',
    '  // lueur d\'horizon, qui respire et encaisse les actions',
    '  float glow = exp(-abs(dy) * 26.0);',
    '  vec3 hcol = mix(vec3(0.06, 0.58, 0.78), vec3(0.62, 0.10, 0.46), 0.34 + 0.26 * sin(uTime * 0.37));',
    '  col += hcol * glow * (0.40 + e * 0.95);',
    '',
    '  // vignette',
    '  vec2 q = p * vec2(0.52, 0.74);',
    '  col *= clamp(1.0 - 0.62 * dot(q, q), 0.18, 1.0);',
    '',
    '  finalColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function makeGridFilter() {
    try {
      var f = new PIXI.Filter({
        glProgram: PIXI.GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'neon-grid' }),
        resources: {
          gridUniforms: {
            uTime: { value: 0, type: 'f32' },
            uEnergy: { value: 0, type: 'f32' },
            uSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' }
          }
        },
        padding: 0
      });
      // Le fond est une nappe continue : la calculer a 40 % de la resolution
      // divise par six le travail du fragment sans que rien ne se voie, et
      // l'effet `tilt` rend la scene deux fois par image.
      f.resolution = 0.4;
      return f;
    } catch (e) {
      console.warn('[neon] shader de fond indisponible :', e && e.message);
      return null;
    }
  }

  // --------------------------------------------------------------- texte

  function halo(role) {
    if (role === 'title') return { color: C.accent, alpha: 0.95, blur: 14, angle: 0, distance: 0 };
    if (role === 'narration') return { color: C.danger, alpha: 0.7, blur: 6, angle: 0, distance: 0 };
    return { color: C.accent, alpha: 0.6, blur: 5, angle: 0, distance: 0 };
  }

  function makeText(str, o) {
    o = o || {};
    var j = J();
    var role = o.role || 'label';
    var base = (j && j.skin.text[role]) || { fill: C.text, fontFamily: FONT, fontSize: 15 };
    var s = merge(base, o);
    var st = {
      fill: s.fill, fontFamily: s.fontFamily || FONT, fontSize: s.fontSize,
      fontWeight: s.fontWeight || '500', align: s.align || 'left',
      letterSpacing: s.letterSpacing || 0,
      dropShadow: o.halo === false ? false : halo(role)
    };
    if (s.wrapWidth) { st.wordWrap = true; st.wordWrapWidth = s.wrapWidth; }
    if (s.lineHeight) st.lineHeight = s.lineHeight;
    var t = new PIXI.Text({ text: String(str == null ? '' : str), style: st });
    t.roundPixels = true;
    return t;
  }

  function smallLabel(str, size, color, alpha) {
    var t = new PIXI.Text({
      text: str,
      style: {
        fill: color, fontFamily: FONT, fontSize: size,
        fontWeight: '600', letterSpacing: 2.2, dropShadow: false
      }
    });
    t.alpha = alpha == null ? 1 : alpha;
    t.roundPixels = true;
    return t;
  }

  // ---------------------------------------------------------- composants
  //
  // Le noyau attend un contrat précis (voir ui.js) : dessin centré sur
  // l'origine, `hitArea` posé dans `redraw`, `_w`/`setWidth` pour la
  // largeur uniforme, `setActive`/`setValue`, accessibilité. Ces deux
  // fabriques le respectent et ajoutent le flash de bord et le voyant.

  function skinOf(name, over) {
    var j = J();
    return merge(merge({}, j ? j.skin[name] : null), over);
  }

  function edgeFlash(flash) {
    if (!flash || flash.destroyed) return;
    kill(flash);
    flash.alpha = 1;
    if (gsap) gsap.to(flash, { alpha: 0, duration: 0.42, ease: 'power2.out' });
    else flash.alpha = 0;
  }

  function wire(node, body, opts, onPress, depth) {
    var j = J();
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.label || 'action';
    node.accessibleHint = opts.accessibleHint || '';
    node.tabIndex = 0;
    node.isPressable = true;
    function pop(list) {
      if (!gsap || (j && j.reduced)) return;
      kill(body);
      var tl = gsap.timeline();
      list.forEach(function (s) {
        tl.to(body.scale, { x: s.sx, y: s.sy, duration: s.d, ease: s.e || 'power2.out' }, s.at || '>');
      });
    }
    node.on('pointerover', function () {
      node._hover = true; node.redraw(); edgeFlash(node._flash);
      pop([{ sx: 1.06, sy: 0.94, d: 0.09 }, { sx: 1.03, sy: 1.03, d: 0.5, e: 'elastic.out(1,0.4)' }]);
      if (j && j.audio) j.audio.play('hover');
    });
    node.on('pointerout', function () {
      node._hover = false; node._down = false; node.redraw();
      pop([{ sx: 1, sy: 1, d: 0.45, e: 'elastic.out(1,0.35)' }]);
    });
    node.on('pointerdown', function () {
      node._down = true; node.redraw(); edgeFlash(node._flash);
      pop([{ sx: 0.94, sy: 0.88, d: 0.07 }]);
    });
    node.on('pointerupoutside', function () {
      node._down = false; node.redraw();
      pop([{ sx: 1, sy: 1, d: 0.45, e: 'elastic.out(1,0.4)' }]);
    });
    node.on('pointerup', function (e) {
      var was = node._down;
      node._down = false; node.redraw(); edgeFlash(node._flash);
      pop([{ sx: 1.10, sy: 0.90, d: 0.08 }, { sx: node._hover ? 1.03 : 1, sy: node._hover ? 1.03 : 1, d: 0.55, e: 'elastic.out(1,0.32)' }]);
      if (was && typeof onPress === 'function') onPress(e, node);
    });
    return node;
  }

  function neonButton(opts) {
    opts = opts || {};
    var sk = skinOf('button', opts.skin);
    var cutR = sk.cut == null ? 8 : sk.cut;
    var depth = sk.depth == null ? 4 : sk.depth;
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var plate = new PIXI.Graphics();
    var flash = new PIXI.Graphics();
    var label = makeText(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize,
      fontFamily: sk.fontFamily, fontWeight: '600', letterSpacing: 1.6
    });
    flash.alpha = 0;
    body.addChild(plate, flash, label);
    node.addChild(shadow, body);
    node.isButton = true;
    node.uiKind = 'button';
    node.labelText = label;
    node._flash = flash;
    node._active = !!opts.active;
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + sk.padX * 2 + 14);
    node._h = opts.height || (label.height + sk.padY * 2);

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2;
      var on = node._active, hot = node._down || node._hover;
      var fill = on ? sk.fillActive : (hot ? sk.fillHover : sk.fill);
      var line = on ? C.accent : (hot ? C.accent : sk.border);
      shadow.clear();
      cut(shadow, x0, y0 + depth, w, h, cutR)
        .fill({ color: 0x000000, alpha: node._down ? 0.18 : 0.42 });
      plate.clear();
      cut(plate, x0, y0, w, h, cutR).fill({ color: fill, alpha: on ? 1 : 0.82 });
      cut(plate, x0, y0, w, h, cutR).stroke({ width: sk.borderWidth, color: line, alpha: on ? 1 : 0.85, alignment: 0.5 });
      // rail gauche + trait de soulignement : la signature « instrument »
      plate.rect(x0 + 3, y0 + 4, 2.5, h - 8).fill({ color: on ? C.accentText : C.accent, alpha: on ? 0.55 : 0.9 });
      plate.rect(x0 + 10, y0 + h - 4, w - 20, 1).fill({ color: line, alpha: hot || on ? 0.9 : 0.3 });
      flash.clear();
      cut(flash, x0 - 1, y0 - 1, w + 2, h + 2, cutR + 1).stroke({ width: 2, color: 0xffffff, alpha: 0.95, alignment: 0.5 });
      label.style.fill = on ? sk.textActive : (hot ? C.text : sk.text);
      label.position.set(-label.width / 2, -label.height / 2);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + depth);
    };
    node.setLabel = function (s) { label.text = s; node.redraw(); return node; };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setActive = function (v) { node._active = !!v; node.redraw(); return node; };
    node.redraw();
    return wire(node, body, opts, opts.onPress, depth);
  }

  function neonToggle(opts) {
    opts = opts || {};
    var sk = skinOf('toggle', opts.skin);
    var cutR = sk.cut == null ? 8 : sk.cut;
    var depth = sk.depth == null ? 3 : sk.depth;
    var lampR = sk.lampR == null ? 6 : sk.lampR;
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var plate = new PIXI.Graphics();
    var lamp = new PIXI.Graphics();
    var flash = new PIXI.Graphics();
    var label = makeText(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize,
      fontFamily: sk.fontFamily, letterSpacing: 1.4
    });
    flash.alpha = 0;
    body.addChild(plate, lamp, flash, label);
    node.addChild(shadow, body);
    node.isToggle = true;
    node.uiKind = 'toggle';
    node.labelText = label;
    node._flash = flash;
    node._on = !!opts.value;
    node._p = node._on ? 1 : 0;
    var lampBox = lampR * 2 + 12;
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + lampBox + sk.padX * 2 + 10);
    node._h = opts.height || (Math.max(label.height, lampR * 2 + 8) + sk.padY * 2);

    function drawLamp() {
      var x0 = -node._w / 2, p = clamp(node._p, 0, 1);
      var cx = x0 + sk.padX + lampR + 3;
      lamp.clear();
      // logement
      lamp.circle(cx, 0, lampR + 4).fill({ color: C.bg, alpha: 0.85 });
      lamp.circle(cx, 0, lampR + 4).stroke({ width: 1, color: sk.border, alpha: 0.9 });
      // halo qui s'ouvre puis se tasse : le voyant « s'allume »
      var burst = Math.sin(p * Math.PI);
      if (p > 0.001) {
        lamp.circle(cx, 0, lampR + 3 + burst * 5).fill({ color: sk.lampOn || C.accent, alpha: 0.18 * p + burst * 0.22 });
      }
      lamp.circle(cx, 0, lampR).fill({ color: p > 0.02 ? sk.lampOn || C.accent : (sk.lampOff || 0x123448), alpha: 0.35 + p * 0.65 });
      lamp.circle(cx, 0, lampR * 0.42).fill({ color: 0xffffff, alpha: 0.12 + p * 0.75 });
      node._lampX = cx;
    }

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2;
      var on = node._on, hot = node._hover || node._down;
      var fill = on ? sk.fillOn : (hot ? sk.fillHover : sk.fill);
      var line = on ? sk.borderOn : (hot ? C.accent : sk.border);
      shadow.clear();
      cut(shadow, x0, y0 + depth, w, h, cutR).fill({ color: 0x000000, alpha: node._down ? 0.16 : 0.38 });
      plate.clear();
      cut(plate, x0, y0, w, h, cutR).fill({ color: fill, alpha: on ? 0.95 : 0.75 });
      cut(plate, x0, y0, w, h, cutR).stroke({ width: sk.borderWidth, color: line, alpha: on ? 1 : 0.8, alignment: 0.5 });
      plate.rect(x0 + 10, y0 + h - 4, w - 20, 1).fill({ color: line, alpha: on ? 0.95 : 0.28 });
      flash.clear();
      cut(flash, x0 - 1, y0 - 1, w + 2, h + 2, cutR + 1).stroke({ width: 2, color: 0xffffff, alpha: 0.95, alignment: 0.5 });
      drawLamp();
      label.style.fill = on ? sk.textOn : sk.text;
      label.position.set(x0 + sk.padX + lampBox + 6, -label.height / 2);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + depth);
    };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setValue = function (v, silent) {
      var next = !!v;
      if (next === node._on) return node;
      node._on = next;
      node.accessibleHint = next ? 'activé' : 'désactivé';
      node.redraw();
      var j = J();
      if (gsap && !(j && j.reduced)) {
        var st = { p: node._p };
        kill(st);
        gsap.to(st, {
          p: next ? 1 : 0, duration: 0.42, ease: 'back.out(2.4)',
          onUpdate: function () { if (!node.destroyed) { node._p = st.p; drawLamp(); } }
        });
      } else { node._p = next ? 1 : 0; drawLamp(); }
      edgeFlash(flash);
      if (!silent && typeof opts.onChange === 'function') opts.onChange(next, node);
      return node;
    };
    Object.defineProperty(node, 'value', { get: function () { return node._on; } });
    node.redraw();
    return wire(node, body, { label: opts.label, accessibleTitle: opts.accessibleTitle }, function () {
      node.setValue(!node._on);
    }, depth);
  }

  // Ticker : le texte défile DANS un cadre de taille fixe (masque interne),
  // donc l'emplacement mesuré par le noyau ne dépasse jamais l'écran.
  function tickerItem(str) {
    var box = (S && S.tick) ? S.tick : { w: 420, h: 26 };
    var root = new PIXI.Container();
    var sizer = new PIXI.Graphics().rect(0, 0, box.w, box.h).fill({ color: C.bg, alpha: 0.001 });
    var mask = new PIXI.Graphics().rect(0, 0, box.w, box.h).fill({ color: 0xffffff });
    var clip = new PIXI.Container();
    clip.mask = mask;
    var seg = '  ' + String(str == null ? '' : str) + '   ///   ';
    var probe = makeText(seg, { role: 'narration' });
    var fs = probe.style.fontSize;
    if (probe.height > box.h - 4 && probe.height > 0) {
      fs = Math.max(9, Math.floor(fs * (box.h - 6) / probe.height));
    }
    probe.destroy();
    var segW = 0;
    var parts = [];
    var i;
    for (i = 0; i < 2; i++) {
      var t = makeText(seg, { role: 'narration', fontSize: fs });
      parts.push(t);
      segW = Math.max(segW, t.width);
    }
    // assez de copies pour couvrir le cadre en continu
    while (segW > 0 && parts.length < 40 && parts.length * segW < box.w + segW * 2) {
      parts.push(makeText(seg, { role: 'narration', fontSize: fs }));
    }
    parts.forEach(function (t, k) {
      t.position.set(k * segW, (box.h - t.height) / 2);
      clip.addChild(t);
    });
    root.addChild(sizer, mask, clip);
    root.tick = { clip: clip, segW: segW || box.w, x: 0 };
    if (S) S.tickers.push(root);
    return root;
  }

  // ---------------------------------------------------------------- état

  var S = null;

  function teardown(j) {
    var st = S;
    S = null;
    if (!st) return;
    if (st.offAction) { try { st.offAction(); } catch (e) { /* ignore */ } st.offAction = null; }
    try { j.layers.scene.filters = []; j.layers.scene.filterArea = null; } catch (e) { /* ignore */ }
    [st.bgRoot, st.fxRoot].forEach(function (n) {
      if (dead(n)) return;
      kill(n);
      if (n.parent) n.parent.removeChild(n);
      try { n.destroy({ children: true }); } catch (e) { /* ignore */ }
    });
    if (st.radar) {
      [st.radar.rtA, st.radar.rtB].forEach(function (rt) {
        if (rt) try { rt.destroy(true); } catch (e) { /* ignore */ }
      });
      if (st.radar.feed && !st.radar.feed.destroyed) {
        try { st.radar.feed.destroy({ children: true }); } catch (e) { /* ignore */ }
      }
    }
    if (st.grid) { try { st.grid.destroy(); } catch (e) { /* ignore */ } }
    if (st.bloom) { try { st.bloom.destroy(); } catch (e) { /* ignore */ } }
    if (st.rgb) { try { st.rgb.destroy(); } catch (e) { /* ignore */ } }
  }

  function ensure(j) {
    if (S && !dead(S.bgRoot) && S.bgRoot.parent === j.layers.scene) return S;
    if (S) teardown(j);
    var st = {
      t: 0, energy: 0, glitch: 0, hold: false, gaugeAcc: 0, tickers: [],
      bgRoot: null, bgSprite: null, grid: null, gu: null,
      fxRoot: null, scan: null, vig: null,
      bloom: null, rgb: null, radar: null, deco: null,
      gaugeG: null, barG: null, gaugeVals: [0.62, 0.4, 0.78], gaugeTgt: [0.62, 0.4, 0.78],
      bars: [], offAction: null
    };

    // fond : un quad plein écran dont tout le dessin vient du shader
    var bgRoot = new PIXI.Container();
    bgRoot.label = 'neon:bg';
    bgRoot.eventMode = 'none';
    var sp = new PIXI.Sprite(PIXI.Texture.WHITE);
    sp.tint = C.bg;
    sp.width = j.app.screen.width;
    sp.height = j.app.screen.height;
    bgRoot.addChild(sp);
    st.grid = makeGridFilter();
    if (st.grid) {
      bgRoot.filters = [st.grid];
      st.gu = st.grid.resources.gridUniforms.uniforms;
    }
    // `layers.background` est vidé à chaque `paint` : le fond animé vit donc
    // dans `layers.scene`, sous lui, et survit aux mises en page.
    j.layers.scene.addChildAt(bgRoot, 0);
    st.bgRoot = bgRoot;
    st.bgSprite = sp;

    // habillage plein écran : lignes de scan + vignette + balayage
    var fx = new PIXI.Container();
    fx.label = 'neon:fx';
    fx.eventMode = 'none';
    st.scan = new PIXI.Graphics();
    st.vig = new PIXI.Graphics();
    fx.addChild(st.scan, st.vig);
    j.layers.overlay.addChild(fx);
    st.fxRoot = fx;

    // bloom réservé au thème, posé sur `layers.scene` (app.stage appartient
    // à effects.js, qui le resynchronise à chaque changement de thème)
    if (has('AdvancedBloomFilter')) {
      st.bloom = new FX.AdvancedBloomFilter({
        threshold: 0.42, bloomScale: 1.25, brightness: 1.0,
        blur: 4, quality: 3, pixelSize: { x: 2, y: 2 }
      });
    }
    if (has('RGBSplitFilter')) {
      st.rgb = new FX.RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } });
    }
    S = st;
    applyFilters(j);
    st.offAction = j.on('action', function () { onAction(j); });
    return st;
  }

  function applyFilters(j) {
    if (!S) return;
    var list = [];
    if (S.rgb && (S.glitch > 0 || S.hold)) list.push(S.rgb);
    if (S.bloom) list.push(S.bloom);
    try {
      j.layers.scene.filters = list;
      j.layers.scene.filterArea = list.length ? j.app.screen : null;
    } catch (e) { /* ignore */ }
  }

  function onAction(j) {
    if (!S) return;
    S.energy = Math.min(1, S.energy + 0.75);
    var had = S.glitch > 0;
    S.glitch = j.reduced ? 90 : 300;
    if (!had) applyFilters(j);
    for (var i = 0; i < 3; i++) {
      S.gaugeTgt[i] = clamp(S.gaugeTgt[i] + rnd(-0.45, 0.45), 0.08, 0.98);
    }
    var rd = S.radar;
    if (!rd || dead(rd.root)) return;
    var n = 4 + Math.floor(Math.random() * 4);
    for (i = 0; i < n; i++) {
      var a = rnd(0, Math.PI * 2), r = rnd(18, rd.RRT * 0.92);
      rd.blips.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, age: 0, life: rnd(1600, 3200), s: rnd(2.4, 5.2) });
    }
    if (rd.blips.length > 60) rd.blips.splice(0, rd.blips.length - 60);
    var ring = new PIXI.Graphics();
    ring.circle(0, 0, rd.R * 0.9).stroke({ width: 2.5, color: C.danger, alpha: 1 });
    ring.scale.set(0.12);
    rd.rings.addChild(ring);
    rd.ringList.push({ g: ring, t: 0 });
  }

  // --------------------------------------------------------------- radar

  function buildRadar(j, frame) {
    var root = new PIXI.Container();
    root.label = 'neon:radar';
    var fw = Math.max(80, frame.width), fh = Math.max(80, frame.height);
    var R = Math.max(46, Math.min(fw, fh) * 0.46);
    var RS = 256, RRT = 118;

    var sizer = new PIXI.Graphics().rect(-fw / 2, -fh / 2, fw, fh).fill({ color: C.bg, alpha: 0.001 });

    var rtA = null, rtB = null;
    try {
      rtA = PIXI.RenderTexture.create({ width: RS, height: RS, resolution: 1, antialias: false });
      rtB = PIXI.RenderTexture.create({ width: RS, height: RS, resolution: 1, antialias: false });
    } catch (e) {
      console.warn('[neon] RenderTexture du radar indisponible :', e && e.message);
    }

    var grid = new PIXI.Graphics();
    var i, a;
    // bezel à coins coupés
    cut(grid, -R * 1.10, -R * 1.10, R * 2.20, R * 2.20, R * 0.26)
      .fill({ color: C.surface, alpha: 0.30 });
    cut(grid, -R * 1.10, -R * 1.10, R * 2.20, R * 2.20, R * 0.26)
      .stroke({ width: 1.5, color: C.border, alpha: 0.85 });
    for (i = 1; i <= 4; i++) {
      grid.circle(0, 0, R * i / 4).stroke({ width: i === 4 ? 1.6 : 1, color: C.border, alpha: i === 4 ? 0.9 : 0.45 });
    }
    for (i = 0; i < 36; i++) {
      a = (i / 36) * Math.PI * 2;
      var l = i % 3 === 0 ? R * 0.10 : R * 0.05;
      grid.moveTo(Math.cos(a) * R, Math.sin(a) * R)
        .lineTo(Math.cos(a) * (R - l), Math.sin(a) * (R - l))
        .stroke({ width: i % 3 === 0 ? 1.6 : 1, color: C.accent, alpha: i % 3 === 0 ? 0.65 : 0.28 });
    }
    grid.moveTo(-R, 0).lineTo(R, 0).stroke({ width: 1, color: C.accent, alpha: 0.22 });
    grid.moveTo(0, -R).lineTo(0, R).stroke({ width: 1, color: C.accent, alpha: 0.22 });
    // équerres de coin
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
      var x = s[0] * R * 1.10, y = s[1] * R * 1.10, k = R * 0.20;
      grid.moveTo(x - s[0] * k, y).lineTo(x, y).lineTo(x, y - s[1] * k)
        .stroke({ width: 2, color: C.danger, alpha: 0.7 });
    });
    ['N', 'E', 'S', 'O'].forEach(function (s, k) {
      var t = smallLabel(s, Math.max(8, R * 0.09), C.muted, 0.85);
      var ang = -Math.PI / 2 + k * Math.PI / 2;
      t.position.set(Math.cos(ang) * R * 1.02 - t.width / 2, Math.sin(ang) * R * 1.02 - t.height / 2);
      grid.addChild(t);
    });

    // traînée : ce que la RenderTexture accumule
    var trail = new PIXI.Sprite(rtA || PIXI.Texture.WHITE);
    trail.anchor.set(0.5);
    // le rayon RRT de la texture doit couvrir R à l'écran
    var ts = (R / RRT) * (rtA ? 1 : RS);
    trail.scale.set(ts);
    trail.blendMode = 'add';
    trail.alpha = 0.95;

    var rings = new PIXI.Container();

    var beam = new PIXI.Graphics();
    beam.moveTo(0, 0).lineTo(R, 0).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    beam.circle(R, 0, 3).fill({ color: 0xffffff, alpha: 0.9 });

    var hub = new PIXI.Graphics();
    hub.circle(0, 0, R * 0.055).fill({ color: C.accent, alpha: 0.95 });
    hub.circle(0, 0, R * 0.11).stroke({ width: 1.4, color: C.accent, alpha: 0.5 });

    root.addChild(sizer, grid, trail, rings, beam, hub);
    if (fh / 2 > R * 1.16 + 16) {
      var tag = smallLabel('SCOPE · 360°', Math.max(8, R * 0.085), C.accent, 0.8);
      tag.position.set(-tag.width / 2, R * 1.16);
      root.addChild(tag);
    }

    // chaîne de rétroaction : echo (image précédente) + faisceau + échos
    var feed = new PIXI.Container();
    var echo = new PIXI.Sprite(rtA || PIXI.Texture.WHITE);
    if (!rtA) { echo.width = RS; echo.height = RS; }
    echo.alpha = 0;
    var wedge = new PIXI.Graphics();
    var steps = 16, span = 0.62;
    for (i = 0; i < steps; i++) {
      var a0 = -span * (i + 1) / steps, a1 = -span * i / steps;
      wedge.moveTo(0, 0)
        .lineTo(Math.cos(a0) * RRT, Math.sin(a0) * RRT)
        .lineTo(Math.cos(a1) * RRT, Math.sin(a1) * RRT)
        .fill({ color: C.accent, alpha: 0.07 * (1 - i / steps) });
    }
    wedge.moveTo(0, 0).lineTo(RRT, 0).stroke({ width: 2, color: C.accent, alpha: 0.55 });
    wedge.position.set(RS / 2, RS / 2);
    var blipG = new PIXI.Graphics();
    blipG.position.set(RS / 2, RS / 2);
    feed.addChild(echo, wedge, blipG);

    return {
      root: root, R: R, RS: RS, RRT: RRT, trail: trail, beam: beam, hub: hub,
      feed: feed, echo: echo, wedge: wedge, blipG: blipG,
      rtA: rtA, rtB: rtB, a: 0, blips: [], rings: rings, ringList: [], primed: false
    };
  }

  // ------------------------------------------------------------- gabarit

  function layout(j, w, h) {
    ensure(j);
    S.tickers = [];
    var hasSlot = function (k) { return !!j.slots[k]; };
    var plan = {};
    var narrow = w < 900;
    var deco = { corners: true, bars: null, gauges: [], panels: [], rules: [] };

    if (!narrow) {
      var pad = 30;
      var titleH = 56, tagH = 24, navH = 40, metaH = 22;
      var headW = Math.min(w * 0.46, 620);
      if (hasSlot('title')) plan.title = { x: pad, y: pad, width: headW, height: titleH, align: 'left', valign: 'top' };
      if (hasSlot('tagline')) plan.tagline = { x: pad, y: pad + (hasSlot('title') ? titleH + 4 : 0), width: headW, height: tagH, align: 'left', valign: 'top' };
      var rightW = Math.min(w * 0.40, 560);
      if (hasSlot('nav')) plan.nav = { x: w - pad - rightW, y: pad, width: rightW, height: navH, align: 'right', valign: 'top' };
      if (hasSlot('meta')) plan.meta = { x: w - pad - rightW, y: pad + (hasSlot('nav') ? navH + 8 : 0), width: rightW, height: metaH, align: 'right', valign: 'top' };

      var headBottom = pad + Math.max(
        (hasSlot('title') ? titleH : 0) + (hasSlot('tagline') ? tagH + 4 : 0),
        (hasSlot('nav') ? navH : 0) + (hasSlot('meta') ? metaH + 8 : 0)
      ) + 26;
      deco.rules.push({ x: pad, y: headBottom - 14, w: w - pad * 2 });

      var tickH = hasSlot('narration') ? 28 : 0;
      var tickY = h - pad - tickH;
      var bottom = tickH ? tickY - 18 : h - pad;
      var gaugeH = Math.min(96, Math.max(0, (bottom - headBottom) * 0.22));
      var colW = clamp(w * 0.195, 178, 262);
      var left = pad, right = w - pad;
      var colBottom = bottom - (gaugeH > 40 ? gaugeH + 12 : 0);

      if (hasSlot('controls')) {
        plan.controls = { x: pad, y: headBottom, width: colW, height: colBottom - headBottom, columns: 1, valign: 'top' };
        left = pad + colW + 26;
        deco.panels.push({ k: 'controls', label: 'SYSTÈMES' });
      }
      if (hasSlot('actions')) {
        plan.actions = { x: w - pad - colW, y: headBottom, width: colW, height: colBottom - headBottom, columns: 1, valign: 'top' };
        right = w - pad - colW - 26;
        deco.panels.push({ k: 'actions', label: 'IMPULSIONS' });
      }
      if (hasSlot('scene')) {
        plan.scene = { x: left, y: headBottom, width: Math.max(120, right - left), height: bottom - headBottom };
        deco.panels.push({ k: 'scene', label: null });
      }
      if (tickH) {
        S.tick = { w: w - pad * 2, h: tickH };
        plan.narration = { x: pad, y: tickY, width: w - pad * 2, height: tickH, columns: 1 };
        deco.panels.push({ k: 'narration', label: 'FLUX' });
      }
      if (gaugeH > 40) {
        var gr = Math.min(gaugeH * 0.34, colW * 0.16);
        if (hasSlot('controls')) {
          deco.gauges.push({ x: pad + colW * 0.25, y: colBottom + 12 + gr, r: gr, i: 0, label: 'PWR' });
          deco.gauges.push({ x: pad + colW * 0.75, y: colBottom + 12 + gr, r: gr, i: 1, label: 'SYNC' });
        }
        if (hasSlot('actions')) {
          deco.gauges.push({ x: w - pad - colW * 0.5, y: colBottom + 12 + gr, r: gr, i: 2, label: 'CHARGE' });
        }
      }
      deco.bars = { x: left, y: headBottom - 14 - 26, w: Math.max(80, right - left), h: 20, n: 26 };
      S.deco = deco;
      return plan;
    }

    // ---- format étroit : même cockpit, compacté, tout visible d'un coup
    var p2 = 12, g2 = 14;
    var tH = hasSlot('narration') ? 22 : 0;
    var tY = h - p2 - tH;
    var titleH2 = 34, tagH2 = 22, navH2 = 30, metaH2 = 15;
    var y = p2;
    var cw = w - p2 * 2;
    function put(k, hh, extra) {
      plan[k] = merge({ x: p2, y: y, width: cw, height: hh }, extra || {});
      y += hh + g2;
    }
    if (hasSlot('title')) put('title', titleH2, { align: 'left', valign: 'top' });
    if (hasSlot('tagline')) put('tagline', tagH2, { align: 'left', valign: 'top' });
    if (hasSlot('nav')) put('nav', navH2, { valign: 'top' });
    var fixedEnd = (hasSlot('meta') ? metaH2 + g2 : 0) + (tH ? tH + g2 * 2 : 0);
    var rest = Math.max(60, (h - p2) - y - fixedEnd);
    var sceneH = 0, ctrlH = 0, actH = 0;
    var wsum = (hasSlot('scene') ? 0.22 : 0) + (hasSlot('controls') ? 0.44 : 0) + (hasSlot('actions') ? 0.34 : 0);
    if (wsum <= 0) wsum = 1;
    var avail = rest - (((hasSlot('scene') ? 1 : 0) + (hasSlot('controls') ? 1 : 0) + (hasSlot('actions') ? 1 : 0) - 1) * g2);
    if (hasSlot('scene')) sceneH = avail * 0.22 / wsum;
    if (hasSlot('controls')) ctrlH = avail * 0.44 / wsum;
    if (hasSlot('actions')) actH = avail * 0.34 / wsum;
    if (hasSlot('scene')) { put('scene', sceneH); deco.panels.push({ k: 'scene', label: null }); }
    if (hasSlot('controls')) { put('controls', ctrlH, { columns: 2 }); deco.panels.push({ k: 'controls', label: 'SYSTÈMES' }); }
    if (hasSlot('actions')) { put('actions', actH, { columns: 2 }); deco.panels.push({ k: 'actions', label: 'IMPULSIONS' }); }
    if (hasSlot('meta')) put('meta', metaH2, { valign: 'top' });
    if (tH) {
      S.tick = { w: cw, h: tH };
      plan.narration = { x: p2, y: tY, width: cw, height: tH, columns: 1 };
      deco.panels.push({ k: 'narration', label: null });
    }
    deco.bars = null;
    deco.gauges = [];
    S.deco = deco;
    return plan;
  }

  // ---------------------------------------------------------------- décor

  function decor(j, frame) {
    var st = ensure(j);
    if (st.radar && st.radar.feed && !st.radar.feed.destroyed) {
      try { st.radar.feed.destroy({ children: true }); } catch (e) { /* ignore */ }
    }
    if (st.radar) {
      [st.radar.rtA, st.radar.rtB].forEach(function (rt) { if (rt) try { rt.destroy(true); } catch (e) { /* ignore */ } });
    }
    st.radar = buildRadar(j, frame);
    return st.radar.root;
  }

  // ---------------------------------------------------------------- peint

  function panelFor(j, plan, k) {
    var b = plan[k];
    if (!b || !j.slots[k]) return null;
    return b;
  }

  function paint(j, w, h, plan) {
    var st = ensure(j);
    var bg = j.layers.background;
    // le quad du shader suit la taille de l'écran
    if (st.bgSprite && !st.bgSprite.destroyed) { st.bgSprite.width = w; st.bgSprite.height = h; }
    if (st.gu) { st.gu.uSize[0] = w; st.gu.uSize[1] = h; }
    drawOverlay(j, w, h);

    var deco = st.deco || { panels: [], gauges: [], rules: [], bars: null };
    var chrome = new PIXI.Graphics();
    bg.addChild(chrome);
    var narrow = w < 900;
    var pd = narrow ? 4 : 10;

    (deco.panels || []).forEach(function (p) {
      var b = panelFor(j, plan, p.k);
      if (!b) return;
      var top = pd + (p.label ? (narrow ? 9 : 16) : 0);
      var x = b.x - pd, y = b.y - top, bw = b.width + pd * 2, bh = b.height + pd + top;
      var cc = narrow ? 8 : 14;
      cut(chrome, x, y, bw, bh, cc).fill({ color: C.surface, alpha: p.k === 'scene' ? 0.14 : 0.30 });
      cut(chrome, x, y, bw, bh, cc).stroke({ width: 1.2, color: C.border, alpha: 0.85 });
      // languette d'en-tête
      var th2 = p.label ? (narrow ? 9 : 15) : 7;
      var tw2 = Math.min(bw * 0.55, 116);
      chrome.poly([x + cc, y, x + cc + tw2, y, x + cc + tw2 - th2, y + th2, x + cc, y + th2], true)
        .fill({ color: C.accent, alpha: 0.26 });
      // ferrures d'angle
      chrome.rect(x + bw - 4, y + bh - 16, 2, 12).fill({ color: C.danger, alpha: 0.7 });
      chrome.rect(x + 2, y + 10, 2, Math.min(26, bh - 20)).fill({ color: C.accent, alpha: 0.55 });
      if (p.label) {
        var lt = smallLabel(p.label, narrow ? 7 : 9, C.accent, 0.95);
        lt.position.set(x + cc + 5, y + (th2 - lt.height) / 2);
        bg.addChild(lt);
      }
    });

    (deco.rules || []).forEach(function (r) {
      chrome.rect(r.x, r.y, r.w, 1).fill({ color: C.border, alpha: 0.75 });
      chrome.rect(r.x, r.y - 1, 56, 3).fill({ color: C.accent, alpha: 0.85 });
      chrome.rect(r.x + r.w - 96, r.y - 1, 96, 3).fill({ color: C.danger, alpha: 0.55 });
    });

    if (deco.corners) {
      var m = narrow ? 5 : 12, k = narrow ? 16 : 28;
      [[m, m, 1, 1], [w - m, m, -1, 1], [w - m, h - m, -1, -1], [m, h - m, 1, -1]].forEach(function (c) {
        chrome.moveTo(c[0] + c[2] * k, c[1]).lineTo(c[0], c[1]).lineTo(c[0], c[1] + c[3] * k)
          .stroke({ width: 2, color: C.accent, alpha: 0.55 });
      });
    }

    // barres de télémétrie et jauges radiales : redessinées par `update`
    st.barG = null;
    st.gaugeG = null;
    st.bars = [];
    st.gaugeLabels = [];
    if (deco.bars && deco.bars.w > 60) {
      st.barG = new PIXI.Graphics();
      bg.addChild(st.barG);
      st.bars = [];
      for (var i = 0; i < deco.bars.n; i++) {
        st.bars.push({ v: Math.random(), ph: Math.random() * 6.28, sp: rnd(0.0012, 0.0035) });
      }
    }
    if (deco.gauges && deco.gauges.length) {
      st.gaugeG = new PIXI.Graphics();
      bg.addChild(st.gaugeG);
      deco.gauges.forEach(function (gg) {
        var lt = smallLabel(gg.label, Math.max(7, gg.r * 0.30), C.muted, 0.9);
        lt.position.set(gg.x - lt.width / 2, gg.y + gg.r + 3);
        bg.addChild(lt);
        var vt = smallLabel('00', Math.max(8, gg.r * 0.42), C.text, 1);
        vt.position.set(gg.x - vt.width / 2, gg.y - vt.height / 2);
        bg.addChild(vt);
        st.gaugeLabels.push({ t: vt, x: gg.x, i: gg.i });
      });
    }
    drawGauges(j, 0);
    drawBars(j, 0);
  }

  function drawOverlay(j, w, h) {
    if (!S || dead(S.scan)) return;
    // lignes de scan : dessinées sur deux hauteurs pour défiler en boucle
    var g = S.scan;
    g.clear();
    var step = 4;
    for (var y = 0; y < h * 2; y += step) {
      g.rect(0, y, w, 1).fill({ color: 0x0a1c26, alpha: 0.30 });
    }
    g.position.set(0, 0);
    S.scanH = step * 2;

    var v = S.vig;
    v.clear();
    var n = 16, m = Math.min(w, h) * 0.30;
    for (var i = 0; i < n; i++) {
      var t = i / n;
      var inset = m * t;
      var al = 0.055 * (1 - t);
      v.rect(0, inset, w, m / n + 1).fill({ color: 0x000000, alpha: al });
      v.rect(0, h - inset - m / n - 1, w, m / n + 1).fill({ color: 0x000000, alpha: al });
      v.rect(inset, 0, m / n + 1, h).fill({ color: 0x000000, alpha: al });
      v.rect(w - inset - m / n - 1, 0, m / n + 1, h).fill({ color: 0x000000, alpha: al });
    }
  }

  function drawGauges(j, dt) {
    if (!S || !S.gaugeG || dead(S.gaugeG) || !S.deco) return;
    var g = S.gaugeG;
    g.clear();
    var a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    (S.deco.gauges || []).forEach(function (gg) {
      var v = clamp(S.gaugeVals[gg.i] || 0, 0, 1);
      var r = gg.r;
      g.circle(gg.x, gg.y, r * 1.18).fill({ color: C.bg, alpha: 0.45 });
      g.moveTo(gg.x + Math.cos(a0) * r, gg.y + Math.sin(a0) * r)
        .arc(gg.x, gg.y, r, a0, a0 + span)
        .stroke({ width: Math.max(2, r * 0.16), color: C.border, alpha: 0.35 });
      g.moveTo(gg.x + Math.cos(a0) * r, gg.y + Math.sin(a0) * r)
        .arc(gg.x, gg.y, r, a0, a0 + span * v)
        .stroke({ width: Math.max(2, r * 0.16), color: v > 0.82 ? C.danger : C.accent, alpha: 0.95 });
      for (var i = 0; i <= 6; i++) {
        var a = a0 + span * i / 6;
        g.moveTo(gg.x + Math.cos(a) * r * 1.02, gg.y + Math.sin(a) * r * 1.02)
          .lineTo(gg.x + Math.cos(a) * r * 1.14, gg.y + Math.sin(a) * r * 1.14)
          .stroke({ width: 1, color: C.muted, alpha: 0.6 });
      }
      var an = a0 + span * v;
      g.moveTo(gg.x + Math.cos(an) * r * 0.56, gg.y + Math.sin(an) * r * 0.56)
        .lineTo(gg.x + Math.cos(an) * r * 0.84, gg.y + Math.sin(an) * r * 0.84)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
    });
    (S.gaugeLabels || []).forEach(function (l) {
      if (dead(l.t)) return;
      var v = clamp(S.gaugeVals[l.i] || 0, 0, 1);
      l.t.text = String(Math.round(v * 100));
      l.t.position.x = l.x - l.t.width / 2;
    });
  }

  function drawBars(j, dt) {
    if (!S || !S.barG || dead(S.barG) || !S.deco || !S.deco.bars) return;
    var b = S.deco.bars, g = S.barG;
    g.clear();
    var n = S.bars.length || 1;
    var bw = b.w / n;
    for (var i = 0; i < n; i++) {
      var v = clamp(S.bars[i].v, 0.04, 1);
      var x = b.x + i * bw;
      g.rect(x, b.y, bw - 2, b.h).fill({ color: C.surface, alpha: 0.35 });
      g.rect(x, b.y + b.h * (1 - v), bw - 2, b.h * v)
        .fill({ color: v > 0.8 ? C.danger : C.accent, alpha: 0.55 + v * 0.4 });
    }
    g.rect(b.x, b.y + b.h + 2, b.w, 1).fill({ color: C.border, alpha: 0.6 });
  }

  // ----------------------------------------------------------- animation

  function update(j, dt) {
    if (!S || dead(S.bgRoot)) return;
    var red = !!j.reduced;
    S.t += dt;
    var lvl = (j.audio && j.audio.level) || 0;

    S.energy = Math.max(0, S.energy - dt / 1100) * 0.999 + lvl * 0.02;
    S.energy = clamp(S.energy, 0, 1);

    if (S.gu) {
      S.gu.uTime = red ? 3.2 : S.t / 1000;
      S.gu.uEnergy = S.energy;
    }

    // lignes de scan qui glissent
    if (!dead(S.scan) && !red && S.scanH) {
      S.scan.position.y = -(S.t * 0.045) % S.scanH;
    }

    // glitch d'action : RGBSplit monté puis retiré
    if (S.glitch > 0 && !S.hold) {
      S.glitch -= dt;
      var k = Math.max(0, S.glitch) / 300;
      if (S.rgb) {
        var o = (red ? 4 : 16) * k;
        var jit = red ? 0 : rnd(-3, 3) * k;
        S.rgb.red = { x: -o, y: jit };
        S.rgb.green = { x: 0, y: -jit };
        S.rgb.blue = { x: o, y: jit };
      }
      if (S.glitch <= 0) { S.glitch = 0; applyFilters(j); }
    }
    if (S.bloom) S.bloom.bloomScale = 1.18 + S.energy * 0.85 + lvl * 0.5;

    // radar
    var rd = S.radar;
    if (rd && !dead(rd.root) && rd.rtA && rd.rtB) {
      if (!red) rd.a += dt * 0.00165;
      rd.wedge.rotation = rd.a;
      rd.beam.rotation = rd.a;
      rd.beam.alpha = 0.55 + S.energy * 0.45;
      rd.echo.texture = rd.rtA;
      rd.echo.alpha = Math.pow(0.975, dt / 16.667);

      var bg2 = rd.blipG;
      bg2.clear();
      for (var i = rd.blips.length - 1; i >= 0; i--) {
        var bl = rd.blips[i];
        bl.age += dt;
        if (bl.age > bl.life) { rd.blips.splice(i, 1); continue; }
        var al = 1 - bl.age / bl.life;
        bg2.circle(bl.x, bl.y, bl.s * (0.6 + al * 0.6)).fill({ color: C.danger, alpha: al });
        bg2.circle(bl.x, bl.y, bl.s * 2.1).stroke({ width: 1, color: C.danger, alpha: al * 0.35 });
      }

      if (!red || !rd.primed) {
        try {
          j.app.renderer.render({ container: rd.feed, target: rd.rtB, clear: true });
          var tmp = rd.rtA; rd.rtA = rd.rtB; rd.rtB = tmp;
          rd.trail.texture = rd.rtA;
          rd.primed = true;
        } catch (e) { rd.rtA = rd.rtB = null; }
      }

      for (var r = rd.ringList.length - 1; r >= 0; r--) {
        var ri = rd.ringList[r];
        ri.t += dt;
        var p = ri.t / 900;
        if (p >= 1 || dead(ri.g)) {
          if (!dead(ri.g)) { ri.g.parent && ri.g.parent.removeChild(ri.g); ri.g.destroy(); }
          rd.ringList.splice(r, 1);
          continue;
        }
        ri.g.scale.set(0.12 + p * 1.05);
        ri.g.alpha = (1 - p) * 0.9;
      }
      rd.hub.scale.set(1 + (red ? 0 : Math.sin(S.t / 420) * 0.08 + S.energy * 0.3));
    }

    // jauges et télémétrie : redessin limité, le dessin vectoriel coûte
    S.gaugeAcc += dt;
    if (S.gaugeAcc >= 55) {
      var d = S.gaugeAcc;
      S.gaugeAcc = 0;
      for (var gi = 0; gi < 3; gi++) {
        if (!red && Math.random() < 0.05) S.gaugeTgt[gi] = clamp(S.gaugeTgt[gi] + rnd(-0.22, 0.22), 0.08, 0.98);
        S.gaugeVals[gi] = lerp(S.gaugeVals[gi], S.gaugeTgt[gi], red ? 1 : 0.14);
      }
      if (S.bars && S.bars.length) {
        for (var bi = 0; bi < S.bars.length; bi++) {
          var bb = S.bars[bi];
          bb.v = red ? 0.35 + 0.4 * Math.sin(bi) * Math.sin(bi)
            : clamp(0.18 + 0.42 * (Math.sin(S.t * bb.sp + bb.ph) * 0.5 + 0.5) + S.energy * 0.45 + lvl * 0.5, 0.04, 1);
        }
      }
      drawGauges(j, d);
      drawBars(j, d);
    }

    // ticker
    if (S.tickers.length) {
      for (var ti = S.tickers.length - 1; ti >= 0; ti--) {
        var tk = S.tickers[ti];
        if (dead(tk) || !tk.tick) { S.tickers.splice(ti, 1); continue; }
        if (!red) {
          tk.tick.x -= dt * 0.055;
          if (tk.tick.x <= -tk.tick.segW) tk.tick.x += tk.tick.segW;
          tk.tick.clip.position.x = tk.tick.x;
        }
      }
    }
  }

  // ------------------------------------------------------------ passages

  function sweep(j, dirIn) {
    return new Promise(function (res) {
      var st = ensure(j);
      try { j.app.stage.filters = []; } catch (e) { /* ignore */ }
      var w = j.app.screen.width, h = j.app.screen.height;
      if (!gsap || j.reduced || dead(st.fxRoot)) { res(); return; }
      var wrap = new PIXI.Container();
      var cover = new PIXI.Graphics().rect(0, 0, w, h).fill({ color: C.bg, alpha: 1 });
      var bar = new PIXI.Graphics();
      bar.rect(-3, 0, 6, h).fill({ color: 0xffffff, alpha: 1 });
      bar.rect(-26, 0, 22, h).fill({ color: C.accent, alpha: 0.5 });
      bar.rect(6, 0, 30, h).fill({ color: C.danger, alpha: 0.35 });
      wrap.addChild(cover, bar);
      st.fxRoot.addChild(wrap);
      var rgb = st.rgb;
      var p = { v: 0, s: dirIn ? 1 : 0 };
      function frame() {
        cover.position.x = dirIn ? p.v * w : (p.v - 1) * w;
        bar.position.x = dirIn ? p.v * w : p.v * w;
        if (rgb) {
          var o = 20 * p.s;
          rgb.red = { x: -o, y: 0 };
          rgb.green = { x: 0, y: o * 0.3 };
          rgb.blue = { x: o, y: 0 };
        }
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        kill(p);
        if (!dead(wrap)) { if (wrap.parent) wrap.parent.removeChild(wrap); wrap.destroy({ children: true }); }
        if (S && S.rgb && S.glitch <= 0) { S.rgb.red = { x: 0, y: 0 }; S.rgb.green = { x: 0, y: 0 }; S.rgb.blue = { x: 0, y: 0 }; }
        if (S) { S.hold = false; S.glitch = 0; applyFilters(j); }
        res();
      }
      var timer = setTimeout(finish, dirIn ? 1100 : 900);
      if (rgb && S) { S.hold = true; applyFilters(j); }
      frame();
      gsap.to(p, {
        v: 1, s: dirIn ? 0 : 1,
        duration: dirIn ? 0.60 : 0.42,
        ease: dirIn ? 'power3.inOut' : 'power2.in',
        onUpdate: frame,
        onComplete: finish
      });
    });
  }

  var transition = {
    'in': function (j) { return sweep(j, true); },
    out: function (j) {
      return sweep(j, false).then(function () { teardown(j); });
    }
  };

  // --------------------------------------------------------------- méta

  function meta(j, state) {
    var e = S ? Math.round(S.energy * 100) : 0;
    return 'CONTACTS ' + state.counter + ' · CHAÎNE ×' + state.combo + ' · CHARGE ' + e + '%';
  }

  // ------------------------------------------------------------- inscrit

  Juicy.themes.register({
    id: 'neon',
    name: 'Néon',
    tokens: {
      colors: {
        bg: C.bg, bgAlt: C.bgAlt, surface: C.surface, surfaceAlt: C.surfaceAlt,
        border: C.border, text: C.text, muted: C.muted,
        accent: C.accent, accentText: C.accentText, danger: C.danger, success: C.success
      },
      fonts: { display: FONT, body: FONT },
      radius: 0,
      gap: 9,
      sizes: { title: 46, tagline: 15, label: 13, meta: 13, narration: 15, nav: 13 }
    },
    skin: {
      button: {
        fill: C.surface, fillHover: C.surfaceAlt, fillActive: C.accent,
        text: C.accent, textActive: C.accentText,
        border: C.border, borderWidth: 1.3, radius: 0,
        padX: 14, padY: 9, minWidth: 0, fontSize: 13, fontFamily: FONT,
        cut: 8, depth: 4
      },
      toggle: {
        fill: C.surface, fillHover: C.surfaceAlt, fillOn: C.surfaceAlt,
        text: C.muted, textOn: C.text,
        border: C.border, borderOn: C.accent, borderWidth: 1.3, radius: 0,
        padX: 11, padY: 8, minWidth: 0, fontSize: 13, fontFamily: FONT,
        cut: 8, depth: 3, lampOn: C.accent, lampOff: 0x123448, lampR: 6
      },
      panel: { fill: C.surface, fillHeader: C.surfaceAlt, border: C.accent, borderWidth: 1.4, radius: 0, title: C.accent },
      badge: { fill: C.accent, text: C.accentText, radius: 0, borderWidth: 0 },
      card: { fill: C.surface, fillBack: C.surfaceAlt, border: C.border, accent: C.accent, radius: 0 },
      scores: { rowFill: C.surface, rowFillTop: C.surfaceAlt, flash: C.accent, accent: C.accent, radius: 0 },
      modal: { scrim: 0x01060c, scrimAlpha: 0.66, fill: C.surface, border: C.accent, radius: 0 },
      cursor: { fill: C.accent, accent: C.danger, size: 14, trail: 16, trailAlpha: 0.6 },
      text: {
        title: { fill: C.text, fontFamily: FONT, fontSize: 46, fontWeight: '800', letterSpacing: 5 },
        tagline: { fill: C.muted, fontFamily: FONT, fontSize: 15, letterSpacing: 2.4 },
        label: { fill: C.text, fontFamily: FONT, fontSize: 13, letterSpacing: 1.4 },
        meta: { fill: C.accent, fontFamily: FONT, fontSize: 13, letterSpacing: 2 },
        narration: { fill: C.text, fontFamily: FONT, fontSize: 15, letterSpacing: 2.6 },
        nav: { fill: C.text, fontFamily: FONT, fontSize: 13, letterSpacing: 1.6 }
      }
    },
    ui: {
      text: function (str, o) {
        o = o || {};
        if (o.role === 'narration') return tickerItem(str);
        return makeText(str, o);
      },
      button: neonButton,
      toggle: neonToggle
    },
    layout: layout,
    paint: paint,
    decor: decor,
    update: update,
    meta: meta,
    transition: transition
  });
})(window);
