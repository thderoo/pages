/*
 * themes/candy.js — thème « Candy » de la bibliothèque Juicy.
 *
 * Une confiserie en WebGL : fond peint par un fragment shader (rayures de
 * sucre d'orge qui tournent, halos mouvants, lueur sous le pointeur), pluie
 * de vermicelles en `ParticleContainer` qui s'écarte du pointeur, sundae
 * central en gelée (ressorts par boule, cerise qui saute, croissance à
 * chaque action), boutons macarons et interrupteurs en réglisse, titre qui
 * rebondit lettre par lettre, transition en coulée de glaçage.
 *
 * Tout hook absent retombe sur celui du thème `plain` du noyau ; ce thème
 * les fournit tous sauf `music`.
 *
 * Charger APRÈS lib/juicy.js (et lib/ui.js si la page l'utilise).
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  var Juicy = global.Juicy;
  if (!Juicy || !PIXI) { console.warn('[juicy] themes/candy.js chargé sans le noyau'); return; }

  var gsap = global.gsap || null;

  // ===================================================================== outils

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rgb(hex) {
    return new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);
  }
  function flat(j) { return !gsap || !!(j && j.reduced); }
  function kill(o) { if (gsap && o) { try { gsap.killTweensOf(o); } catch (e) { /* ignore */ } } }

  /** Couleurs de confiserie : vermicelles, confettis, sucres. */
  var CANDIES = [0xff6fae, 0xffd166, 0x7ee0c8, 0xa78bfa, 0xffffff, 0x8ecbff, 0xff9f68];

  // État du thème, hors des hooks : `paint` reconstruit, `update` anime.
  var S = {
    bgFilter: null, bgUni: null, bgNode: null,
    rain: null, fx: null, confetti: null,
    decor: null, tex: {}, t: 0,
    pointer: { x: 0.5, y: 0.5, sx: 0, sy: 0 },
    pointerOff: null
  };

  // ------------------------------------------------------------------ textures

  function tex(j, key, draw) {
    var t = S.tex[key];
    if (t && !t.destroyed) return t;
    var g = new PIXI.Graphics();
    draw(g);
    try {
      t = j.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    } catch (e) {
      t = PIXI.Texture.WHITE;
    }
    try { g.destroy(); } catch (e) { /* ignore */ }
    S.tex[key] = t;
    return t;
  }

  /** Vermicelle : une capsule blanche, teintée par particule. */
  function texSprinkle(j) {
    return tex(j, 'sprinkle', function (g) {
      g.roundRect(0, 0, 5, 16, 2.5).fill({ color: 0xffffff });
    });
  }

  /** Dragée : un disque blanc, teinté par particule. */
  function texDrop(j) {
    return tex(j, 'drop', function (g) {
      g.circle(8, 8, 7).fill({ color: 0xffffff });
    });
  }

  // ------------------------------------------------------------------ pointeur
  //
  // Le noyau n'expose pas de pointeur : le thème écoute le canevas lui-même
  // (comme les effets), en coordonnées écran ramenées à 0..1. Le
  // désabonnement se fait dans `transition.out`, le seul moment où l'on sait
  // que le thème s'en va.

  function watchPointer(j) {
    if (S.pointerOff || !j.canvas) return;
    var el = j.canvas;
    function move(e) {
      var w = j.app.screen.width, h = j.app.screen.height;
      var x = e.offsetX != null ? e.offsetX : 0;
      var y = e.offsetY != null ? e.offsetY : 0;
      S.pointer.x = clamp(x / Math.max(1, w), 0, 1);
      S.pointer.y = clamp(y / Math.max(1, h), 0, 1);
      S.pointer.sx = x;
      S.pointer.sy = y;
    }
    el.addEventListener('pointermove', move, { passive: true });
    S.pointerOff = function () { el.removeEventListener('pointermove', move); S.pointerOff = null; };
  }

  // ======================================================== fond : le shader

  var FRAG = [
    'in vec2 vTextureCoord;',
    'out vec4 finalColor;',
    'uniform sampler2D uTexture;',
    'uniform float uTime;',
    'uniform vec2 uAspect;',
    'uniform vec2 uPointer;',
    'uniform vec3 uTop;',
    'uniform vec3 uBot;',
    'uniform vec3 uStripe;',
    'uniform vec3 uHalo;',
    '',
    'float halo(vec2 p, vec2 c, float r) {',
    '  return 1.0 - smoothstep(0.0, r, distance(p, c));',
    '}',
    '',
    'void main(void) {',
    '  vec2 uv = vTextureCoord;',
    '  vec2 p = uv * uAspect;',
    '  float big = max(uAspect.x, uAspect.y);',
    '  vec3 col = mix(uTop, uBot, smoothstep(0.0, 1.0, uv.y));',
    '  float a = uTime * 0.05;',
    '  vec2 dir = vec2(cos(a), sin(a));',
    '  float s = dot(p, dir) * 6.5 + uTime * 0.26;',
    '  float f = abs(fract(s) - 0.5) * 2.0;',
    '  col = mix(col, uStripe, smoothstep(0.10, 0.90, f) * 0.40);',
    '  vec2 c0 = vec2(0.50 + 0.33 * sin(uTime * 0.23), 0.40 + 0.26 * cos(uTime * 0.19)) * uAspect;',
    '  vec2 c1 = vec2(0.50 + 0.30 * sin(uTime * 0.17 + 2.1), 0.60 + 0.28 * cos(uTime * 0.21 + 1.3)) * uAspect;',
    '  vec2 c2 = vec2(0.50 + 0.36 * sin(uTime * 0.13 + 4.2), 0.50 + 0.31 * cos(uTime * 0.15 + 3.7)) * uAspect;',
    '  col += uHalo * 0.26 * halo(p, c0, 0.45 * big);',
    '  col += uHalo * 0.20 * halo(p, c1, 0.40 * big);',
    '  col += uHalo * 0.16 * halo(p, c2, 0.36 * big);',
    '  col += vec3(1.0, 0.98, 1.0) * 0.26 * halo(p, uPointer * uAspect, 0.30 * big);',
    '  float src = texture(uTexture, uv).a;',
    '  finalColor = vec4(clamp(col, 0.0, 1.0), 1.0) * src;',
    '}'
  ].join('\n');

  function makeBgFilter(j) {
    if (S.bgFilter && !S.bgFilter.destroyed) return S.bgFilter;
    var c = j.tokens.colors;
    try {
      var f = new PIXI.Filter({
        glProgram: PIXI.GlProgram.from({ vertex: PIXI.defaultFilterVert, fragment: FRAG, name: 'candy-bg' }),
        resources: {
          candyUniforms: {
            uTime: { value: 0, type: 'f32' },
            uAspect: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
            uPointer: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
            uTop: { value: rgb(0xfff6fb), type: 'vec3<f32>' },
            uBot: { value: rgb(0xffc9e2), type: 'vec3<f32>' },
            uStripe: { value: rgb(0xff9dc9), type: 'vec3<f32>' },
            uHalo: { value: rgb(0xffe6a4), type: 'vec3<f32>' }
          }
        }
      });
      f.padding = 0;
      f.antialias = 'off';
      S.bgFilter = f;
      S.bgUni = f.resources.candyUniforms.uniforms;
      return f;
    } catch (e) {
      console.warn('[juicy] candy : shader de fond indisponible, repli en bandes', e);
      S.bgFilter = null;
      S.bgUni = null;
      return null;
    }
  }

  /** Fond du thème : une nappe pleine écran peinte par le shader. */
  function paintShader(j, w, h) {
    var f = makeBgFilter(j);
    var g = new PIXI.Graphics().rect(0, 0, w, h).fill({ color: j.tokens.colors.bg });
    g.label = 'candy:bg';
    if (f) {
      // Le shader est bien moins coûteux que l'écran : une nappe basse
      // définition suffit pour un dégradé et des halos, et l'étirement
      // bilinéaire les adoucit au lieu de les abîmer.
      f.resolution = clamp(480 / Math.max(w, h), 0.20, 0.50);
      if (S.bgUni) {
        var ar = S.bgUni.uAspect;
        if (w >= h) { ar[0] = w / h; ar[1] = 1; } else { ar[0] = 1; ar[1] = h / w; }
      }
      g.filterArea = new PIXI.Rectangle(0, 0, w, h);
      g.filters = [f];
    } else {
      // repli sans shader : un dégradé en bandes, statique mais propre
      var bands = 16;
      for (var i = 0; i < bands; i++) {
        var t = i / (bands - 1);
        var col = mixHex(0xfff6fb, 0xffc9e2, t);
        g.rect(0, (h / bands) * i - 1, w, h / bands + 2).fill({ color: col });
      }
    }
    S.bgNode = g;
    j.layers.background.addChild(g);
  }

  // Les progressions viennent de ressorts (elastic/back) qui dépassent 0..1 :
  // sans borne, un canal sort de 0..255 et Pixi rejette la couleur.
  function chan(x) { return Math.max(0, Math.min(255, Math.round(x))); }

  function mixHex(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg2 = (b >> 8) & 255, bb = b & 255;
    return (chan(ar + (br - ar) * t) << 16) | (chan(ag + (bg2 - ag) * t) << 8) | chan(ab + (bb - ab) * t);
  }

  // ==================================================== pluie de vermicelles

  function makeRain(j, w, h) {
    var n = j.reduced ? 32 : 96;
    var t = texSprinkle(j);
    var pc = new PIXI.ParticleContainer({
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true }
    });
    pc.label = 'candy:rain';
    var ps = [], st = [];
    for (var i = 0; i < n; i++) {
      var sc = rnd(0.45, 1.05);
      var p = new PIXI.Particle({
        texture: t, x: rnd(0, w), y: rnd(0, h),
        anchorX: 0.5, anchorY: 0.5,
        scaleX: sc, scaleY: sc, rotation: rnd(0, 6.283),
        tint: CANDIES[(Math.random() * CANDIES.length) | 0],
        alpha: rnd(0.35, 0.8)
      });
      pc.addParticle(p);
      ps.push(p);
      st.push({ vy: rnd(24, 74), vx: 0, spin: rnd(-1.6, 1.6), ph: rnd(0, 6.283), sw: rnd(10, 30) });
    }
    S.rain = { pc: pc, ps: ps, st: st, w: w, h: h };
    j.layers.background.addChild(pc);
  }

  function updateRain(j, dt) {
    var r = S.rain;
    if (!r || r.pc.destroyed) return;
    if (j.reduced) return;
    var h = Math.max(1, dt) / 1000;
    var w = j.app.screen.width, hh = j.app.screen.height;
    var px = S.pointer.sx, py = S.pointer.sy;
    for (var i = 0; i < r.ps.length; i++) {
      var p = r.ps[i], s = r.st[i];
      // le pointeur repousse les vermicelles qui passent à sa portée
      var dx = p.x - px, dy = p.y - py;
      var d2 = dx * dx + dy * dy;
      if (d2 < 22500 && d2 > 1) {
        var d = Math.sqrt(d2);
        var k = (1 - d / 150) * 900;
        s.vx += (dx / d) * k * h;
        s.vy += (dy / d) * k * h * 0.6;
      }
      s.vx *= 0.94;
      p.x += (s.vx + Math.sin(S.t / 900 + s.ph) * s.sw) * h;
      p.y += s.vy * h;
      s.vy += (rnd(24, 74) - s.vy) * 0.02;
      p.rotation += s.spin * h;
      if (p.y > hh + 20) { p.y = -20; p.x = rnd(0, w); s.vx = 0; }
      if (p.y < -40) p.y = hh + 10;
      if (p.x < -20) p.x = w + 10;
      if (p.x > w + 20) p.x = -10;
    }
  }

  // ========================================================= plateaux du décor

  /** Un napperon festonné sous une région : l'assiette de l'étage. */
  function plate(g, b, o) {
    var px2 = o.padX == null ? o.pad : o.padX;
    var py2 = o.padY == null ? o.pad : o.padY;
    var r = o.radius;
    var x = b.x - px2, y = b.y - py2, w = b.width + px2 * 2, h = b.height + py2 * 2;
    g.roundRect(x + 2, y + 8, w, h, r).fill({ color: 0xd98cb0, alpha: 0.16 });
    var step = clamp(w / 16, 13, 26);
    var rr = step * 0.5;
    var n = Math.max(2, Math.round(w / step));
    var m = Math.max(2, Math.round(h / step));
    var i;
    for (i = 0; i <= n; i++) {
      var px = x + (w * i) / n;
      g.circle(px, y, rr).fill({ color: o.fill, alpha: o.alpha });
      g.circle(px, y + h, rr).fill({ color: o.fill, alpha: o.alpha });
    }
    for (i = 0; i <= m; i++) {
      var py = y + (h * i) / m;
      g.circle(x, py, rr).fill({ color: o.fill, alpha: o.alpha });
      g.circle(x + w, py, rr).fill({ color: o.fill, alpha: o.alpha });
    }
    g.roundRect(x, y, w, h, r).fill({ color: o.fill, alpha: o.alpha });
    g.roundRect(x, y, w, h, r).stroke({ width: o.line, color: o.border, alpha: 0.75 });
    if (o.gloss) {
      g.roundRect(x + 6, y + 5, w - 12, h * 0.26, r * 0.7).fill({ color: 0xffffff, alpha: 0.32 });
    }
  }

  // ======================================================== le sundae (décor)

  function scoop(S0, cx, cy, r, color) {
    var c = new PIXI.Container();
    var g = new PIXI.Graphics();
    g.circle(0, 0, r).fill({ color: color });
    g.circle(-r * 0.32, -r * 0.34, r * 0.34).fill({ color: 0xffffff, alpha: 0.42 });
    g.circle(r * 0.30, r * 0.22, r * 0.20).fill({ color: 0x000000, alpha: 0.06 });
    // vermicelles posés sur la boule
    for (var i = 0; i < 7; i++) {
      var a = rnd(0, 6.283), d = rnd(0, r * 0.72);
      var sx = Math.cos(a) * d, sy = Math.sin(a) * d;
      var sg = new PIXI.Graphics()
        .roundRect(-r * 0.045, -r * 0.13, r * 0.09, r * 0.26, r * 0.045)
        .fill({ color: CANDIES[(Math.random() * CANDIES.length) | 0] });
      sg.position.set(sx, sy);
      sg.rotation = rnd(0, 3.14);
      g.addChild(sg);
    }
    c.addChild(g);
    c.position.set(cx, cy);
    return c;
  }

  function buildSundae(j, frame) {
    var c = j.tokens.colors;
    var U = Math.max(34, Math.min(frame.width / 1.60, frame.height / 2.22));
    var root = new PIXI.Container();
    root.label = 'candy:sundae';

    // boîte invisible : la taille naturelle ne dépend pas des rebonds
    root.addChild(new PIXI.Graphics()
      .rect(-U * 0.80, -U * 1.20, U * 1.60, U * 2.22)
      .fill({ color: c.bg, alpha: 0 }));

    // halo de sucre derrière la coupe
    var halo = new PIXI.Graphics();
    for (var i = 4; i >= 1; i--) {
      halo.circle(0, -U * 0.10, U * (0.52 + i * 0.16))
        .fill({ color: CANDIES[i % CANDIES.length], alpha: 0.055 });
    }
    root.addChild(halo);

    var growC = new PIXI.Container();
    var squashC = new PIXI.Container();
    growC.addChild(squashC);
    root.addChild(growC);

    // -- la coupe -------------------------------------------------------
    var cup = new PIXI.Graphics();
    cup.ellipse(0, U * 0.88, U * 0.28, U * 0.075).fill({ color: 0xffffff, alpha: 0.75 });
    cup.roundRect(-U * 0.07, U * 0.60, U * 0.14, U * 0.30, U * 0.05).fill({ color: 0xffffff, alpha: 0.62 });
    cup.moveTo(-U * 0.72, U * 0.10)
      .bezierCurveTo(-U * 0.66, U * 0.64, -U * 0.34, U * 0.76, 0, U * 0.76)
      .bezierCurveTo(U * 0.34, U * 0.76, U * 0.66, U * 0.64, U * 0.72, U * 0.10)
      .closePath()
      .fill({ color: 0xffffff, alpha: 0.55 })
      .stroke({ width: Math.max(1.5, U * 0.022), color: 0xffd7e8, alpha: 0.95 });
    cup.moveTo(-U * 0.54, U * 0.20).bezierCurveTo(-U * 0.50, U * 0.50, -U * 0.36, U * 0.58, -U * 0.28, U * 0.60)
      .stroke({ width: Math.max(1.5, U * 0.03), color: 0xffffff, alpha: 0.8 });
    squashC.addChild(cup);

    // -- les boules -----------------------------------------------------
    var scoops = [
      scoop(U, -U * 0.40, -U * 0.10, U * 0.33, 0xff9ec4),
      scoop(U, U * 0.40, -U * 0.08, U * 0.31, 0x9fe3c0),
      scoop(U, 0, -U * 0.34, U * 0.34, 0xffe2a8)
    ];
    scoops.forEach(function (s) { squashC.addChild(s); });

    // -- gaufrette ------------------------------------------------------
    var wafer = new PIXI.Graphics();
    wafer.roundRect(-U * 0.07, -U * 0.30, U * 0.14, U * 0.60, U * 0.03)
      .fill({ color: 0xf0c98a })
      .stroke({ width: Math.max(1, U * 0.016), color: 0xd8a862, alpha: 0.9 });
    for (var wi = -2; wi <= 2; wi++) {
      wafer.moveTo(-U * 0.07, U * 0.11 * wi).lineTo(U * 0.07, U * 0.11 * wi)
        .stroke({ width: Math.max(0.8, U * 0.012), color: 0xd8a862, alpha: 0.7 });
    }
    wafer.position.set(U * 0.50, -U * 0.34);
    wafer.rotation = 0.42;
    squashC.addChild(wafer);

    // -- coulis de sirop ------------------------------------------------
    var syrup = new PIXI.Graphics();
    syrup.moveTo(-U * 0.62, -U * 0.06)
      .bezierCurveTo(-U * 0.38, -U * 0.34, -U * 0.18, U * 0.04, 0, -U * 0.28)
      .bezierCurveTo(U * 0.18, U * 0.04, U * 0.40, -U * 0.34, U * 0.62, -U * 0.04)
      .stroke({ width: Math.max(2, U * 0.055), color: 0xd94f79, alpha: 0.88 });
    squashC.addChild(syrup);

    // -- chantilly ------------------------------------------------------
    var cream = new PIXI.Graphics();
    cream.ellipse(0, -U * 0.56, U * 0.22, U * 0.12).fill({ color: 0xfffdf8 });
    cream.ellipse(0, -U * 0.68, U * 0.16, U * 0.10).fill({ color: 0xfffaf2 });
    cream.ellipse(0, -U * 0.78, U * 0.10, U * 0.075).fill({ color: 0xfffdf8 });
    cream.moveTo(-U * 0.03, -U * 0.82).lineTo(0, -U * 0.90).lineTo(U * 0.03, -U * 0.82).closePath()
      .fill({ color: 0xfffdf8 });
    squashC.addChild(cream);

    // -- la cerise ------------------------------------------------------
    var cherry = new PIXI.Container();
    var cg = new PIXI.Graphics();
    cg.moveTo(U * 0.01, -U * 0.09)
      .bezierCurveTo(U * 0.09, -U * 0.22, U * 0.16, -U * 0.20, U * 0.15, -U * 0.30)
      .stroke({ width: Math.max(1.4, U * 0.026), color: 0x7ba05b, alpha: 1 });
    cg.ellipse(U * 0.21, -U * 0.30, U * 0.07, U * 0.035).fill({ color: 0x8ec46a });
    cg.circle(0, 0, U * 0.115).fill({ color: 0xf4456b });
    cg.circle(-U * 0.04, -U * 0.04, U * 0.035).fill({ color: 0xffffff, alpha: 0.65 });
    cherry.addChild(cg);
    var cherryY = -U * 0.92;
    cherry.position.set(0, cherryY);
    squashC.addChild(cherry);

    // -- éclaboussures --------------------------------------------------
    var splash = new PIXI.Container();
    root.addChild(splash);

    var d = {
      root: root, halo: halo, growC: growC, squashC: squashC,
      scoops: scoops.map(function (s, i) {
        return { node: s, baseY: s.position.y, o: 0, v: 0, ph: i * 1.7 };
      }),
      cherry: cherry, cherryY: cherryY, cherryJump: { v: 0 },
      splash: splash, drops: [],
      U: U, t: 0, grow: 1, rot: 0
    };
    S.decor = d;

    // cliquer le sundae le fait trembler comme une gelée
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-U * 0.80, -U * 1.20, U * 1.60, U * 2.22);
    root.accessible = true;
    root.accessibleType = 'button';
    root.accessibleTitle = 'Le sundae';
    root.accessibleHint = 'Cliquer pour le faire trembler';
    root.on('pointerdown', function () { jiggle(j, 1); });

    // le décor vit et meurt avec l'emplacement `scene` : les abonnements
    // suivent, sinon un thème quitté continuerait de réagir aux actions
    var offA = j.on('action', function (e) { onAction(j, e); });
    var offT = j.on('toggle', function () { jiggle(j, 0.55); });
    root.on('destroyed', function () {
      offA(); offT();
      if (S.decor === d) S.decor = null;
    });
    return root;
  }

  /** Impulsion de gelée : la coupe s'écrase, les boules ballottent. */
  function jiggle(j, power) {
    var d = S.decor;
    if (!d || d.root.destroyed) return;
    d.scoops.forEach(function (s, i) { s.v += (2.4 + i * 0.5) * power * rnd(0.8, 1.3); });
    if (flat(j)) return;
    kill(d.squashC.scale);
    gsap.timeline()
      .to(d.squashC.scale, { x: 1 + 0.20 * power, y: 1 - 0.17 * power, duration: 0.09, ease: 'power3.out' })
      .to(d.squashC.scale, { x: 1, y: 1, duration: 0.75, ease: 'elastic.out(1,0.34)' });
    // la cerise saute
    kill(d.cherryJump);
    gsap.timeline()
      .to(d.cherryJump, { v: d.U * 0.40 * power, duration: 0.24, ease: 'power2.out' })
      .to(d.cherryJump, { v: 0, duration: 0.55, ease: 'bounce.out' });
    kill(d.cherry);
    gsap.fromTo(d.cherry, { rotation: -0.5 * power }, { rotation: 0, duration: 0.8, ease: 'elastic.out(1,0.3)' });
  }

  function onAction(j, e) {
    var d = S.decor;
    if (!d || d.root.destroyed) return;
    jiggle(j, 1.15);
    syrupSplash(j, d);
    sugarConfetti(j, d);
    if (e && e.id === 'reset') {
      d.grow = 1;
      growTo(j, d, 'bounce.out', 0.9);
    } else {
      d.grow = Math.min(1.30, d.grow + 0.035 + Math.min(0.03, (e && e.combo ? e.combo : 1) * 0.006));
      growTo(j, d, 'elastic.out(1,0.45)', 0.8);
    }
  }

  function growTo(j, d, ease, dur) {
    if (flat(j)) { d.growC.scale.set(d.grow); return; }
    kill(d.growC.scale);
    gsap.to(d.growC.scale, { x: d.grow, y: d.grow, duration: dur, ease: ease, overwrite: true });
  }

  /** Gouttes de sirop autour de la coupe, dans l'espace du décor. */
  function syrupSplash(j, d) {
    var n = j.reduced ? 5 : 14;
    for (var i = 0; i < n; i++) {
      var g = new PIXI.Graphics()
        .circle(0, 0, d.U * rnd(0.025, 0.06))
        .fill({ color: Math.random() < 0.5 ? 0xd94f79 : CANDIES[(Math.random() * CANDIES.length) | 0] });
      g.position.set(rnd(-d.U * 0.3, d.U * 0.3), -d.U * 0.2);
      var a = rnd(-2.9, -0.25);
      d.splash.addChild(g);
      d.drops.push({
        g: g, vx: Math.cos(a) * d.U * rnd(1.2, 2.8), vy: Math.sin(a) * d.U * rnd(1.4, 3.0),
        life: rnd(600, 1100), max: 1100
      });
    }
  }

  /** Confettis sucrés plein écran, recyclés dans un pool de particules. */
  function sugarConfetti(j, d) {
    if (!S.fx || S.fx.destroyed) return;
    if (!S.confetti) {
      var max = j.reduced ? 30 : 110;
      var t = texDrop(j);
      var pc = new PIXI.ParticleContainer({
        dynamicProperties: { position: true, rotation: true, vertex: true, color: true }
      });
      pc.label = 'candy:confetti';
      var ps = [], st = [];
      for (var i = 0; i < max; i++) {
        var p = new PIXI.Particle({
          texture: t, x: -999, y: -999, anchorX: 0.5, anchorY: 0.5,
          scaleX: 1, scaleY: 1, alpha: 0, tint: 0xffffff
        });
        pc.addParticle(p);
        ps.push(p);
        st.push({ life: 0 });
      }
      S.fx.addChild(pc);
      S.confetti = { pc: pc, ps: ps, st: st, i: 0 };
    }
    var cf = S.confetti;
    if (cf.pc.destroyed) { S.confetti = null; return; }
    // départ : la position du sundae à l'écran
    var o = { x: j.app.screen.width / 2, y: j.app.screen.height * 0.45 };
    try { var gp = d.root.getGlobalPosition(); o.x = gp.x; o.y = gp.y; } catch (e) { /* ignore */ }
    var n = j.reduced ? 12 : 42;
    for (var k = 0; k < n; k++) {
      var p2 = cf.ps[cf.i], s2 = cf.st[cf.i];
      cf.i = (cf.i + 1) % cf.ps.length;
      var a = rnd(0, 6.283), sp = rnd(120, 560);
      p2.x = o.x; p2.y = o.y;
      p2.tint = CANDIES[(Math.random() * CANDIES.length) | 0];
      p2.alpha = 1;
      var sc = rnd(0.35, 0.95);
      p2.scaleX = sc; p2.scaleY = sc;
      s2.vx = Math.cos(a) * sp;
      s2.vy = Math.sin(a) * sp - 180;
      s2.spin = rnd(-6, 6);
      s2.life = rnd(900, 1700);
      s2.max = s2.life;
      s2.sc = sc;
    }
  }

  function updateBursts(j, dt) {
    var h = Math.min(dt, 40) / 1000;
    var d = S.decor;
    if (d && !d.root.destroyed && d.drops.length) {
      for (var i = d.drops.length - 1; i >= 0; i--) {
        var q = d.drops[i];
        q.life -= dt;
        if (q.life <= 0 || q.g.destroyed) {
          try { if (!q.g.destroyed) q.g.destroy(); } catch (e) { /* ignore */ }
          d.drops.splice(i, 1);
          continue;
        }
        q.vy += d.U * 6 * h;
        q.g.x += q.vx * h;
        q.g.y += q.vy * h;
        q.g.alpha = clamp(q.life / q.max * 1.6, 0, 1);
      }
    }
    var cf = S.confetti;
    if (cf && !cf.pc.destroyed) {
      for (var k = 0; k < cf.ps.length; k++) {
        var s = cf.st[k];
        if (s.life <= 0) continue;
        s.life -= dt;
        var p = cf.ps[k];
        if (s.life <= 0) { p.alpha = 0; p.x = -999; p.y = -999; continue; }
        s.vy += 900 * h;
        s.vx *= 0.99;
        p.x += s.vx * h;
        p.y += s.vy * h;
        p.rotation += s.spin * h;
        var f = s.life / s.max;
        p.alpha = clamp(f * 1.8, 0, 1);
        p.scaleX = s.sc * (0.6 + f * 0.4);
        p.scaleY = s.sc * (0.6 + f * 0.4);
      }
    }
  }

  function updateSundae(j, dt) {
    var d = S.decor;
    if (!d || d.root.destroyed) return;
    d.t += dt;
    var T = d.t;
    if (j.reduced) {
      d.growC.scale.set(d.grow);
      d.cherry.position.y = d.cherryY;
      return;
    }
    var h = Math.min(dt, 34) / 1000;
    // respiration de la coupe, à volume à peu près constant
    var br = 1 + Math.sin(T / 880) * 0.022;
    // balancement lent du présentoir
    d.growC.rotation = Math.sin(T / 1500) * 0.028;
    // halo qui bat, un peu plus fort quand le son parle
    var lvl = j.audio && j.audio.level ? j.audio.level : 0;
    d.halo.scale.set(1 + Math.sin(T / 720) * 0.055 + lvl * 0.2);
    d.halo.alpha = 0.72 + Math.sin(T / 540) * 0.22 + lvl * 0.4;
    // ressorts par boule : chaque boule de glace est une gelée
    for (var i = 0; i < d.scoops.length; i++) {
      var s = d.scoops[i];
      s.v += (-150 * s.o - 13 * s.v) * h;
      s.o += s.v * h;
      var wob = Math.sin(T / (660 + i * 130) + s.ph) * 0.018;
      s.node.scale.set(1 + s.o * 0.42 + wob, 1 - s.o * 0.42 - wob);
      s.node.position.y = s.baseY + s.o * d.U * 0.10 + wob * d.U * 0.5;
    }
    // la cerise flotte, et retombe de son saut
    d.cherry.position.y = d.cherryY - Math.abs(Math.sin(T / 640)) * d.U * 0.045 - d.cherryJump.v;
    // la coupe respire sans gonfler le décor
    // la coupe respire à volume constant, sauf quand un ressort GSAP tient
    // déjà son échelle (squash du clic) : sinon les deux se battent.
    if (!(gsap && gsap.isTweening(d.squashC.scale))) d.squashC.scale.set(br, 2 - br);
  }

  // ===================================================== transition : glaçage
  //
  // Une nappe de glaçage descend depuis le haut : son bord inférieur ondulé
  // recouvre l'écran, puis son bord supérieur droit le dégage. Une seule
  // coulée continue fait donc le rideau dans les deux sens.

  function icing(j, color) {
    var w = j.app.screen.width, h = j.app.screen.height;
    var drip = Math.max(30, h * 0.09);
    var g = new PIXI.Graphics();
    g.label = 'candy:icing';
    var H = h + drip + 40;
    // corps : de -H à 0, bord inférieur ondulé
    g.moveTo(0, -H).lineTo(w, -H).lineTo(w, -drip * 0.4);
    var lobes = Math.max(4, Math.round(w / 110));
    for (var i = lobes; i >= 1; i--) {
      var x1 = (w * i) / lobes, x0 = (w * (i - 1)) / lobes;
      var mid = (x0 + x1) / 2;
      g.bezierCurveTo(mid + (x1 - x0) * 0.18, drip * 0.9, mid - (x1 - x0) * 0.18, -drip * 0.9, x0, -drip * 0.4);
    }
    g.closePath().fill({ color: color });
    // gouttes qui pendent
    for (var k = 0; k < lobes; k++) {
      var cx = (w * (k + 0.5)) / lobes;
      g.circle(cx, drip * rnd(0.1, 0.6), drip * rnd(0.12, 0.26)).fill({ color: color });
    }
    // reflet nacré le long du bord
    g.rect(0, -H, w, H * 0.12).fill({ color: 0xffffff, alpha: 0.22 });
    g.rect(0, -drip * 2.6, w, drip * 0.5).fill({ color: 0xffffff, alpha: 0.16 });
    // quelques vermicelles sur la nappe
    for (var v = 0; v < 26; v++) {
      var vg = new PIXI.Graphics()
        .roundRect(-2, -6, 4, 12, 2)
        .fill({ color: CANDIES[(Math.random() * CANDIES.length) | 0] });
      vg.position.set(rnd(0, w), rnd(-h * 0.9, -drip));
      vg.rotation = rnd(0, 3.14);
      g.addChild(vg);
    }
    g.position.set(0, 0);
    g._H = H;
    g._drip = drip;
    j.layers.overlay.addChild(g);
    return g;
  }

  function pour(j, color, holdMs) {
    var w = j.app.screen.width, h = j.app.screen.height;
    var g;
    try { g = icing(j, color); } catch (e) { return Promise.resolve(); }
    function done() { try { if (!g.destroyed) g.destroy({ children: true }); } catch (e) { /* ignore */ } }
    if (flat(j)) { done(); return Promise.resolve(); }
    var cover = h + g._drip + 20;
    var clear2 = g._H + h + 40;
    return new Promise(function (res) {
      var tl = gsap.timeline({
        onComplete: function () { done(); res(); }
      });
      tl.fromTo(g.position, { y: 0 }, { y: cover, duration: 0.34, ease: 'power2.in' });
      if (holdMs) tl.to(g.position, { y: cover + 6, duration: holdMs / 1000 });
      tl.to(g.position, { y: clear2, duration: 0.46, ease: 'power2.inOut' });
      // sécurité : la nappe disparaît même si le tween est tué
      setTimeout(function () { if (!g.destroyed) { done(); res(); } }, 2200);
    });
  }

  // =========================================================== composants

  /** Mesures des composants : grosses lettres sur mobile, le noyau met à l'échelle. */
  function metrics(j) {
    var w = j.app.screen.width;
    var narrow = w < 900;
    var F = narrow ? 26 : (w < 1360 ? 16 : 17);
    return {
      narrow: narrow, F: F,
      padX: F * 0.62, padY: F * 0.36, depth: Math.max(2, F * 0.16),
      swW: F * 1.15, swH: F * 0.62, gapLS: F * 0.42
    };
  }

  function uiText(str, o) {
    var j = Juicy.instance;
    var base = (Juicy.ui && Juicy.ui.text) || null;
    if (base) return base(str, o);
    var st = j.ui && j.ui.style ? j.ui.style((o && o.role) || 'label', o) : {};
    return new PIXI.Text({ text: String(str == null ? '' : str), style: st });
  }

  /** Les mêmes poses que le noyau, mais sur le corps du macaron. */
  function springs(j, node, body, opts, onPress, depth) {
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.label || 'action';
    node.accessibleHint = opts.accessibleHint || '';
    node.tabIndex = 0;
    node.isPressable = true;

    function pose(steps) {
      if (flat(j)) {
        var s = steps[steps.length - 1];
        body.scale.set(s.sx, s.sy);
        body.position.y = s.y || 0;
        return;
      }
      kill(body.scale); kill(body.position);
      var tl = gsap.timeline();
      steps.forEach(function (st) {
        tl.to(body.scale, { x: st.sx, y: st.sy, duration: st.d, ease: st.e || 'power2.out' });
        tl.to(body.position, { y: st.y || 0, duration: st.d, ease: st.e || 'power2.out' }, '<');
      });
    }

    node.on('pointerover', function () {
      node._hover = true; node.redraw();
      // un macaron qu'on approche s'écrase comme une coque molle
      pose([{ sx: 1.13, sy: 0.86, y: 2, d: 0.09, e: 'power3.out' },
            { sx: 1.05, sy: 1.05, y: -3, d: 0.6, e: 'elastic.out(1,0.38)' }]);
      if (j.audio) j.audio.play('hover');
    });
    node.on('pointerout', function () {
      node._hover = false; node._down = false; node.redraw();
      pose([{ sx: 0.96, sy: 1.05, y: 1, d: 0.08 },
            { sx: 1, sy: 1, y: 0, d: 0.6, e: 'elastic.out(1,0.32)' }]);
    });
    node.on('pointerdown', function () {
      node._down = true; node.redraw();
      pose([{ sx: 0.90, sy: 0.80, y: depth, d: 0.07, e: 'power3.out' }]);
    });
    node.on('pointerupoutside', function () {
      node._down = false; node.redraw();
      pose([{ sx: 1, sy: 1, y: 0, d: 0.55, e: 'elastic.out(1,0.35)' }]);
    });
    node.on('pointerup', function (e) {
      var was = node._down;
      node._down = false; node.redraw();
      pose([{ sx: 1.18, sy: 0.84, y: -3, d: 0.09, e: 'power3.out' },
            { sx: node._hover ? 1.05 : 1, sy: node._hover ? 1.05 : 1, y: node._hover ? -3 : 0, d: 0.72, e: 'elastic.out(1,0.28)' }]);
      if (was && typeof onPress === 'function') onPress(e, node);
    });
    return node;
  }

  /** Bouton macaron : deux coques, une ganache, un glacis. */
  function candyButton(opts) {
    opts = opts || {};
    var j = Juicy.instance;
    var c = j.tokens.colors;
    var m = metrics(j);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var shell = new PIXI.Graphics();
    var label = uiText(opts.label || '', {
      role: 'label', fill: c.text, fontSize: m.F, fontFamily: j.tokens.fonts.display, fontWeight: '600'
    });
    body.addChild(shell, label);
    node.addChild(shadow, body);
    node.isButton = true;
    node.uiKind = 'button';
    node.labelText = label;
    node._active = !!opts.active;
    node._w = opts.width || Math.max(0, label.width + m.padX * 2);
    node._h = opts.height || (label.height + m.padY * 2);

    var TINTS = [0xffc2dd, 0xffe3a8, 0xc7efdc, 0xd9cdfb, 0xbfe2ff];
    node._tint = TINTS[(Math.random() * TINTS.length) | 0];

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2;
      var r = h / 2;
      var base = node._active ? c.accent : node._tint;
      var top = node._down ? mixHex(base, 0x000000, 0.10) : (node._hover ? mixHex(base, 0xffffff, 0.16) : base);
      shadow.clear();
      shadow.roundRect(x0, y0 + m.depth, w, h, r).fill({ color: 0xc4718f, alpha: node._down ? 0.16 : 0.34 });
      shell.clear();
      // coque du bas
      shell.roundRect(x0, y0 + h * 0.30, w, h * 0.70, r).fill({ color: mixHex(top, 0x000000, 0.12) });
      // ganache
      shell.roundRect(x0 + w * 0.012, y0 + h * 0.40, w - w * 0.024, h * 0.22, h * 0.11)
        .fill({ color: node._active ? 0xfff2f8 : 0xfffaf0 });
      // petits pieds de macaron
      var feet = Math.max(3, Math.round(w / 22));
      for (var i = 0; i < feet; i++) {
        var fx = x0 + w * ((i + 0.5) / feet);
        shell.circle(fx, y0 + h * 0.40, h * 0.055).fill({ color: mixHex(top, 0x000000, 0.06), alpha: 0.85 });
        shell.circle(fx, y0 + h * 0.62, h * 0.055).fill({ color: mixHex(top, 0x000000, 0.14), alpha: 0.85 });
      }
      // coque du haut
      shell.roundRect(x0, y0, w, h * 0.62, r).fill({ color: top });
      // glacis
      shell.roundRect(x0 + w * 0.05, y0 + h * 0.08, w * 0.9, h * 0.20, h * 0.1)
        .fill({ color: 0xffffff, alpha: node._active ? 0.42 : 0.5 });
      if (node._active) {
        shell.circle(x0 + w - h * 0.28, y0 + h * 0.26, h * 0.12).fill({ color: 0xf4456b });
      }
      label.style.fill = node._active ? c.accentText : c.text;
      label.position.set(-label.width / 2, -label.height / 2 - h * 0.04);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + m.depth);
    };
    node.setLabel = function (s) { label.text = s; node.redraw(); return node; };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setActive = function (v) { node._active = !!v; node.redraw(); return node; };
    node.redraw();
    return springs(j, node, body, opts, opts.onPress, m.depth);
  }

  /** Interrupteur : une réglette de réglisse, une dragée qui glisse. */
  function candyToggle(opts) {
    opts = opts || {};
    var j = Juicy.instance;
    var c = j.tokens.colors;
    var m = metrics(j);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var stick = new PIXI.Graphics();
    var sw = new PIXI.Graphics();
    var label = uiText(opts.label || '', {
      role: 'label', fill: c.text, fontSize: m.F, fontFamily: j.tokens.fonts.display
    });
    body.addChild(stick, sw, label);
    node.addChild(shadow, body);
    node.isToggle = true;
    node.uiKind = 'toggle';
    node.labelText = label;
    node._on = !!opts.value;
    node._p = node._on ? 1 : 0;
    node._w = opts.width || Math.max(0, label.width + m.swW + m.padX * 2 + m.gapLS);
    node._h = opts.height || (Math.max(label.height, m.swH) + m.padY * 2);

    function drawSwitch() {
      var x0 = -node._w / 2;
      var sx = x0 + m.padX, p = node._p;
      var r = m.swH / 2 - 1;
      sw.clear();
      // rainure de réglisse
      sw.roundRect(sx, -m.swH / 2, m.swW, m.swH, m.swH / 2)
        .fill({ color: mixHex(0x5b3550, c.accent, p) });
      var bars = 4;
      for (var i = 1; i < bars; i++) {
        sw.rect(sx + (m.swW * i) / bars - m.swH * 0.06, -m.swH / 2 + 1, m.swH * 0.12, m.swH - 2)
          .fill({ color: 0xffffff, alpha: 0.16 + p * 0.2 });
      }
      // la dragée s'étire au milieu de sa course
      var stretch = 1 + Math.sin(clamp(p, 0, 1) * Math.PI) * 0.55;
      var kx = sx + r + 1 + (m.swW - 2 * r - 2) * p;
      sw.ellipse(kx, 0, r * stretch, r / Math.sqrt(stretch))
        .fill({ color: mixHex(0xfff3f8, 0xffe07a, p) });
      sw.ellipse(kx - r * 0.25 * stretch, -r * 0.3, r * 0.3 * stretch, r * 0.22)
        .fill({ color: 0xffffff, alpha: 0.85 });
    }

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2, r = h * 0.42;
      var fill = node._on ? 0xfff0f7 : 0xfffaf4;
      shadow.clear();
      shadow.roundRect(x0, y0 + m.depth, w, h, r).fill({ color: 0xc4718f, alpha: node._down ? 0.14 : 0.3 });
      stick.clear();
      stick.roundRect(x0, y0, w, h, r).fill({ color: node._hover && !node._on ? 0xfff4ea : fill });
      stick.roundRect(x0, y0, w, h, r)
        .stroke({ width: Math.max(1.6, m.F * 0.12), color: node._on ? c.accent : 0xffcfe2, alignment: 0.5 });
      // rayures de sucre d'orge sur la réglette allumée
      if (node._on) {
        var n = Math.max(3, Math.round(w / (m.F * 1.4)));
        for (var i = 0; i < n; i++) {
          var bx = x0 + (w * (i + 0.5)) / n;
          stick.roundRect(bx - m.F * 0.09, y0 + h * 0.12, m.F * 0.18, h * 0.76, m.F * 0.09)
            .fill({ color: c.accent, alpha: 0.12 });
        }
      }
      drawSwitch();
      label.style.fill = node._on ? c.text : c.muted;
      label.position.set(x0 + m.padX + m.swW + m.gapLS, -label.height / 2 - h * 0.03);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + m.depth);
    };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setValue = function (v, silent) {
      var next = !!v;
      if (next === node._on) return node;
      node._on = next;
      node.accessibleHint = next ? 'activé' : 'désactivé';
      node.redraw();
      if (flat(j)) { node._p = next ? 1 : 0; drawSwitch(); }
      else {
        var p = { v: node._p };
        kill(p);
        gsap.to(p, {
          v: next ? 1 : 0, duration: 0.44, ease: 'back.out(2.8)', overwrite: true,
          onUpdate: function () { if (!node.destroyed) { node._p = p.v; drawSwitch(); } },
          onComplete: function () { if (!node.destroyed) { node._p = next ? 1 : 0; drawSwitch(); } }
        });
        kill(body);
        gsap.fromTo(body, { rotation: next ? -0.06 : 0.06 }, { rotation: 0, duration: 0.6, ease: 'elastic.out(1,0.32)' });
      }
      if (!silent && typeof opts.onChange === 'function') opts.onChange(next, node);
      return node;
    };
    Object.defineProperty(node, 'value', { get: function () { return node._on; } });
    node.redraw();
    return springs(j, node, body, {
      label: opts.label, accessibleTitle: opts.accessibleTitle
    }, function () { node.setValue(!node._on); }, m.depth);
  }

  /** Titre : une lettre par sprite, qui tombe en rebondissant. */
  function candyTitle(str, o) {
    var j = Juicy.instance;
    var c = j.tokens.colors;
    var root = new PIXI.Container();
    root.label = 'candy:title';
    var chars = String(str == null ? '' : str).split('');
    var letters = [];
    var x = 0, maxH = 0;
    chars.forEach(function (ch, i) {
      var t = uiText(ch === ' ' ? ' ' : ch, {
        role: 'title', fill: i % 2 ? c.accent : c.text,
        fontFamily: j.tokens.fonts.display, fontSize: (o && o.fontSize) || j.tokens.sizes.title,
        fontWeight: '700'
      });
      t.position.set(x, 0);
      x += t.width;
      maxH = Math.max(maxH, t.height);
      root.addChild(t);
      letters.push(t);
    });
    // boîte invisible : les rebonds ne changent pas la taille naturelle
    root.addChildAt(new PIXI.Graphics().rect(0, 0, Math.max(1, x), Math.max(1, maxH))
      .fill({ color: c.bg, alpha: 0 }), 0);
    if (!flat(j) && letters.length) {
      // lancé après la mise en place : `applySlotBox` a déjà mesuré la boîte
      setTimeout(function () {
        if (root.destroyed) return;
        letters.forEach(function (t, i) {
          if (t.destroyed) return;
          gsap.from(t, { y: -maxH * 1.6, duration: 0.9, delay: i * 0.06, ease: 'bounce.out' });
          gsap.from(t.scale, { x: 0.3, y: 1.7, duration: 0.8, delay: i * 0.06, ease: 'elastic.out(1,0.4)' });
        });
      }, 16);
    }
    return root;
  }

  // ============================================================== le thème

  var TOKENS = {
    colors: {
      bg: 0xffe4f0, bgAlt: 0xfff6e9, surface: 0xfffaf4, surfaceAlt: 0xffe9f3,
      border: 0xffb4d2, text: 0x6d3b57, muted: 0xa9758f,
      accent: 0xff5fa8, accentText: 0xfff6fb, danger: 0xff7b8f, success: 0x72cfa3
    },
    fonts: {
      display: 'Fredoka, "Baloo 2", "Trebuchet MS", Verdana, system-ui, sans-serif',
      body: 'Fredoka, "Baloo 2", "Trebuchet MS", Verdana, system-ui, sans-serif'
    },
    radius: 22,
    gap: 14,
    sizes: { title: 78, tagline: 21, label: 17, meta: 17, narration: 18, nav: 16 }
  };

  Juicy.themes.register({
    id: 'candy',
    name: 'Confiserie',

    tokens: TOKENS,

    skin: {
      button: {
        fill: 0xffc2dd, fillHover: 0xffd4e6, fillActive: TOKENS.colors.accent,
        text: TOKENS.colors.text, textActive: TOKENS.colors.accentText,
        border: 0xffa9cd, borderWidth: 0, radius: 999,
        padX: 18, padY: 11, depth: 5, shadowAlpha: 0.3, gloss: 0.45,
        fontSize: 17, fontFamily: TOKENS.fonts.display
      },
      toggle: {
        fill: 0xfffaf4, fillHover: 0xfff4ea, fillOn: 0xfff0f7,
        text: TOKENS.colors.muted, textOn: TOKENS.colors.text,
        border: 0xffcfe2, borderOn: TOKENS.colors.accent, borderWidth: 2, radius: 999,
        padX: 16, padY: 10, depth: 4, shadowAlpha: 0.26,
        knobOff: 0xfff3f8, knobOn: 0xffe07a, trackOff: 0x5b3550, trackOn: TOKENS.colors.accent,
        switchW: 30, switchH: 16,
        fontSize: 17, fontFamily: TOKENS.fonts.display
      },
      panel: { fill: 0xfffaf4, fillHeader: 0xffdcec, border: 0xffb4d2, radius: 26, title: TOKENS.colors.text },
      badge: { fill: TOKENS.colors.accent, text: 0xfff6fb, radius: 999 },
      card: { fill: 0xfffaf4, fillBack: 0xffe9f3, border: 0xffb4d2, radius: 24 },
      scores: { rowFill: 0xfffaf4, rowFillTop: 0xffdcec, accent: TOKENS.colors.accent, border: 0xffb4d2 },
      modal: { fill: 0xfffaf4, fillHeader: 0xffdcec, border: TOKENS.colors.accent, radius: 28, scrim: 0x7a4560 },
      cursor: { fill: TOKENS.colors.accent, accent: 0xffe07a, size: 15 },
      text: {
        title: { fill: TOKENS.colors.text, fontFamily: TOKENS.fonts.display, fontSize: 78, fontWeight: '700', letterSpacing: 0 },
        tagline: { fill: TOKENS.colors.muted, fontFamily: TOKENS.fonts.body, fontSize: 21 },
        label: { fill: TOKENS.colors.text, fontFamily: TOKENS.fonts.body, fontSize: 17 },
        meta: { fill: TOKENS.colors.accent, fontFamily: TOKENS.fonts.display, fontSize: 17, fontWeight: '600' },
        narration: { fill: TOKENS.colors.text, fontFamily: TOKENS.fonts.body, fontSize: 18 },
        nav: { fill: TOKENS.colors.text, fontFamily: TOKENS.fonts.display, fontSize: 16 }
      }
    },

    ui: { button: candyButton, toggle: candyToggle,
      text: function (str, o) {
        if (o && o.role === 'title') return candyTitle(str, o);
        return uiText(str, o);
      }
    },

    // ---------------------------------------------------- mise en page
    //
    // Un présentoir à étages : la coupe trône sur le plateau du haut, les
    // deux napperons de friandises occupent l'étage du dessous, le ruban de
    // narration ferme le bas. En dessous de 900px, les étages s'empilent en
    // une colonne unique : tout reste atteignable à l'écran, sans onglet ni
    // glissement de caméra qui sortiraient un contrôle du cadre.
    layout: function (j, w, h) {
      var has = function (k) { return !!j.slots[k]; };
      var plan = {};
      var narrow = w < 900;

      if (!narrow) {
        var pad = Math.round(Math.min(46, w * 0.035));
        var low = h < 800;
        var titleH = low ? 62 : 80;
        var tagH = low ? 24 : 28;
        var navH = low ? 40 : 46;
        var metaH = low ? 24 : 28;
        var headW = w * 0.44, rightW = w * 0.34;
        if (has('title')) plan.title = { x: pad, y: pad, width: headW, height: titleH, align: 'left', valign: 'top' };
        if (has('tagline')) plan.tagline = { x: pad, y: pad + (has('title') ? titleH + 2 : 0), width: headW, height: tagH, align: 'left', valign: 'top' };
        if (has('nav')) plan.nav = { x: w - pad - rightW, y: pad, width: rightW, height: navH, align: 'right', valign: 'top' };
        if (has('meta')) plan.meta = { x: w - pad - rightW, y: pad + (has('nav') ? navH + 10 : 0), width: rightW, height: metaH, align: 'right', valign: 'top' };

        var top = pad + Math.max(
          (has('title') ? titleH : 0) + (has('tagline') ? tagH + 2 : 0),
          (has('nav') ? navH : 0) + (has('meta') ? metaH + 10 : 0)
        ) + (low ? 16 : 24);
        var bottom = h - pad;
        var narrH = has('narration') ? clamp(h * 0.085, 48, 78) : 0;
        var tierGap = low ? 16 : 24;
        var avail = bottom - top - (narrH ? narrH + tierGap : 0);
        var share = low ? 0.40 : 0.48;
        var sceneH = has('scene') ? Math.round(avail * share) - tierGap : 0;
        var lowH = avail - (sceneH ? sceneH + tierGap : 0);

        if (has('scene')) {
          var sceneW = Math.min(w * 0.30, 400);
          plan.scene = { x: (w - sceneW) / 2, y: top, width: sceneW, height: sceneH };
        }
        var y2 = top + (sceneH ? sceneH + tierGap : 0);
        var side = Math.round(w * 0.065);
        var mid = Math.round(w * 0.05);
        var colW = Math.round((w - side * 2 - mid) / 2);
        if (has('controls') && has('actions')) {
          plan.controls = { x: side, y: y2, width: colW, height: lowH, gap: 14, valign: 'middle' };
          plan.actions = { x: w - side - colW, y: y2, width: colW, height: lowH, gap: 14, valign: 'middle' };
        } else if (has('controls')) {
          plan.controls = { x: side, y: y2, width: w - side * 2, height: lowH, gap: 14 };
        } else if (has('actions')) {
          plan.actions = { x: side, y: y2, width: w - side * 2, height: lowH, gap: 14 };
        }
        if (has('narration')) plan.narration = { x: w * 0.18, y: bottom - narrH, width: w * 0.64, height: narrH, columns: 1 };
        return plan;
      }

      // ----- écran étroit : les étages s'empilent, rien ne sort du cadre
      var p2 = 14, g2 = 9;
      var tH = 44, taH = 30, nH = 34, mH = 22, naH = 44;
      var fixed = 0, flexKeys = [];
      if (has('title')) fixed += tH + g2;
      if (has('tagline')) fixed += taH + g2;
      if (has('nav')) fixed += nH + g2;
      if (has('meta')) fixed += mH + g2;
      if (has('narration')) fixed += naH + g2;
      if (has('scene')) flexKeys.push(['scene', 0.24]);
      if (has('controls')) flexKeys.push(['controls', 0.44]);
      if (has('actions')) flexKeys.push(['actions', 0.32]);
      var total = flexKeys.reduce(function (s, e) { return s + e[1]; }, 0) || 1;
      var rest = Math.max(0, h - p2 * 2 - fixed - flexKeys.length * g2);
      var y = p2, cw = w - p2 * 2;
      function put(k, hh, extra) {
        plan[k] = { x: p2, y: y, width: cw, height: hh, gap: 9 };
        if (extra) Object.keys(extra).forEach(function (kk) { plan[k][kk] = extra[kk]; });
        y += hh + g2;
      }
      if (has('title')) put('title', tH);
      if (has('tagline')) put('tagline', taH);
      if (has('nav')) put('nav', nH);
      flexKeys.forEach(function (e, i) {
        put(e[0], rest * (e[1] / total));
        if (i === 0 && has('narration')) put('narration', naH, { columns: 1 });
      });
      if (!flexKeys.length && has('narration')) put('narration', naH, { columns: 1 });
      if (has('meta')) put('meta', mH);
      return plan;
    },

    // ------------------------------------------------------------ décor peint
    paint: function (j, w, h, plan) {
      watchPointer(j);
      paintShader(j, w, h);
      makeRain(j, w, h);

      var narrow = w < 900;
      var g = new PIXI.Graphics();
      g.label = 'candy:trays';

      // Les plateaux se dessinent sur les bornes RÉELLES des emplacements
      // (`slot.rect`, posé par le noyau juste avant `paint`), pas sur la case
      // du plan : le noyau met chaque emplacement à l'échelle de son contenu,
      // et une case plus grande que son contenu donnerait un napperon vide
      // autour de deux boutons.
      function boxOf(k) {
        var sl = j.slots[k];
        if (sl && sl.rect && sl.rect.width > 2 && sl.rect.height > 2) return sl.rect;
        return plan[k];
      }

      // le mât du présentoir, entre l'étage de la coupe et celui du dessous
      if (!narrow && plan.scene && (plan.controls || plan.actions)) {
        var low = boxOf(j.slots.controls ? 'controls' : 'actions') || plan.controls || plan.actions;
        var sc = boxOf('scene') || plan.scene;
        var cx = w / 2;
        var y0 = sc.y + sc.height;
        var y1 = low.y + low.height * 0.5;
        g.roundRect(cx - w * 0.012, y0 - 6, w * 0.024, Math.max(10, y1 - y0 + 6), w * 0.012)
          .fill({ color: 0xffffff, alpha: 0.5 });
        g.ellipse(cx, y0 + 2, w * 0.05, w * 0.012).fill({ color: 0xffffff, alpha: 0.55 });
      }

      var opt = {
        pad: narrow ? 6 : 14,
        radius: narrow ? 18 : 28,
        line: narrow ? 1.6 : 2.4,
        fill: 0xfffaf4,
        alpha: 0.78,
        border: 0xffb4d2
      };
      ['scene', 'controls', 'actions', 'narration'].forEach(function (k) {
        var b = boxOf(k);
        if (!b || !j.slots[k]) return;
        if (k === 'scene') {
          plate(g, b, { padX: opt.pad + 6, padY: opt.pad, radius: opt.radius, line: opt.line, fill: 0xfff4fa, alpha: 0.62, border: 0xffc9de, gloss: true });
        } else if (k === 'narration') {
          // bulle de chantilly : large en X, serrée en Y autour de la ligne
          plate(g, b, { padX: narrow ? 16 : 34, padY: narrow ? 10 : 18, radius: 999, line: opt.line, fill: 0xfffdfa, alpha: 0.86, border: 0xffd9e8 });
        } else {
          plate(g, b, { padX: opt.pad + (narrow ? 2 : 10), padY: opt.pad + (narrow ? 2 : 8), radius: opt.radius, line: opt.line, fill: opt.fill, alpha: opt.alpha, border: opt.border });
        }
      });
      j.layers.background.addChild(g);

      // couche de bursts du thème, sur l'overlay, refaite à chaque mise en page
      if (S.fx && !S.fx.destroyed) { try { S.fx.destroy({ children: true }); } catch (e) { /* ignore */ } }
      S.confetti = null;
      S.fx = new PIXI.Container();
      S.fx.label = 'candy:fx';
      S.fx.eventMode = 'none';
      j.layers.overlay.addChild(S.fx);
    },

    // ------------------------------------------------------------- le sundae
    decor: function (j, frame) { return buildSundae(j, frame); },

    // -------------------------------------------------------------- la boucle
    update: function (j, dt) {
      S.t += dt;
      if (S.bgUni && !j.reduced) {
        S.bgUni.uTime = S.t / 1000;
        var pu = S.bgUni.uPointer;
        pu[0] += (S.pointer.x - pu[0]) * clamp(dt / 260, 0.02, 1);
        pu[1] += (S.pointer.y - pu[1]) * clamp(dt / 260, 0.02, 1);
      }
      updateRain(j, dt);
      updateSundae(j, dt);
      updateBursts(j, dt);
    },

    meta: function (j, state) {
      return 'Bonbons : ' + state.counter + ' · Gourmandise ×' + state.combo;
    },

    // ------------------------------------------------------------ transitions
    transition: {
      'in': function (j) { return pour(j, 0xff8fc0, 90); },
      out: function (j) {
        // on s'en va : la nappe recouvre puis dégage, et le thème se déplie
        var p = pour(j, 0xffc2dd, 60);
        return p.then(function () {
          if (S.pointerOff) S.pointerOff();
          if (S.fx && !S.fx.destroyed) { try { S.fx.destroy({ children: true }); } catch (e) { /* ignore */ } }
          S.fx = null;
          S.confetti = null;
          S.rain = null;
          S.bgNode = null;
        });
      }
    }
  });
})(window);
