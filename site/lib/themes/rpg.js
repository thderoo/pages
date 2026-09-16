/*
 * themes/rpg.js — thème « RPG rétro » de la bibliothèque Juicy.
 *
 * Un écran de combat de JRPG 16 bits, entièrement dessiné dans le canvas :
 *
 *   - fond de combat en couches à parallaxe (ciel dégradé, lune et étoiles,
 *     nuages, montagnes lointaines, collines proches, sol en bandes qui
 *     fuient vers l'horizon), chaque couche défilant à sa vitesse et
 *     réagissant au pointeur et à la caméra ;
 *   - fenêtres de menu à bordure pixel (double liseré + rivets) peintes
 *     derrière chaque emplacement, façon fenêtre de commande de JRPG ;
 *   - héros et monstre en pixel art généré (matrices de caractères ->
 *     texture au voisin le plus proche), animation d'attente, attaque avec
 *     recul, éclair blanc, dégâts flottants, barres PV/PM qui se vident en
 *     tremblant ;
 *   - curseur ▶ clignotant sur l'entrée survolée ou sélectionnée, et
 *     navigation clavier (flèches + Entrée) en plus de la souris ;
 *   - boîte de dialogue en bas, machine à écrire lettre par lettre avec bip ;
 *   - transition d'entrée en volets de bataille qui s'ouvrent sur un éclair,
 *     sortie en dissolution pixellisée.
 *
 * Le thème ne touche à rien hors de ses propres hooks : tout ce qu'il
 * dessine vit dans `layers.background` (repeinte par le noyau à chaque mise
 * en page) ou dans l'emplacement `scene` (reconstruit par le noyau), et tout
 * ce qu'il branche en dehors (clavier, écouteurs) est débranché par
 * `transition.out`, appelé par le noyau quand on quitte le thème.
 *
 * Contrat : .swarm/pages/reports/pixi.core2.md §1.
 */
(function () {
  'use strict';

  if (!window.Juicy) { console.warn('[juicy] themes/rpg.js chargé sans le noyau'); return; }

  var PIXI = window.PIXI;
  if (!PIXI) return;

  // ------------------------------------------------------------------ utils

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /** Fusion à deux niveaux, comme celle du noyau (jetons et skins). */
  function merge(base, over) {
    var out = {};
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      out[k] = (isObj(base && base[k]) && isObj(over[k])) ? merge(base[k], over[k]) : over[k];
    });
    return out;
  }

  function mix(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }

  function alive(node) { return !!node && !node.destroyed; }

  /** Générateur déterministe : deux chargements donnent les mêmes textures. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ------------------------------------------------------------- palette
  //
  // Palette limitée, comme une console 16 bits : nuit bleue, bois de fenêtre
  // outremer, liseré parchemin, or pour la sélection.

  var C = {
    night: 0x0b0a1e, nightHi: 0x241a52, dusk: 0x54306b, glow: 0xd07a5a,
    mountFar: 0x2b2650, mountFarTop: 0x4a4380,
    mountNear: 0x1a1738, mountNearTop: 0x322c62,
    soilFar: 0x3a2f5c, soilNear: 0x6b5a46,
    win: 0x1c2470, winHi: 0x3746b4, winEdge: 0x08081c, winBorder: 0xf6f1de,
    gold: 0xffcf4a, goldDark: 0xb07a12,
    parchment: 0xfdf6e3, muted: 0xa9b0dc,
    blood: 0xe04848, mana: 0x4ca8ff, leaf: 0x62d86a,
    white: 0xffffff
  };

  // --------------------------------------------------------- pixel art
  //
  // Matrices de caractères -> texture. Chaque caractère est un pixel de la
  // texture source ; les sprites sont ensuite agrandis d'un facteur entier et
  // échantillonnés au voisin le plus proche : aucun flou, vraie échelle pixel.

  var PIX = {
    o: 0x16102a,  // contour
    s: 0xf2c98a,  // peau
    a: 0xbfd2ee,  // armure claire
    A: 0x6d86b8,  // armure sombre
    c: 0xd04545,  // cape
    C: 0x8e2626,  // cape ombrée
    g: 0xffcf4a,  // or
    b: 0x5a4326,  // cuir
    m: 0xeaf2ff,  // lame claire
    M: 0xa8bce0,  // lame ombrée
    h: 0x8a4bd6,  // peau du monstre
    H: 0x5b2d96,  // monstre, ombre
    r: 0xff5a5a,  // œil
    w: 0xfdf3d8   // croc
  };

  // Chevalier de profil, tourné vers la gauche (16 x 20).
  var HERO = [
    '......oooo......',
    '.....oggggo.....',
    '....oaaaaaao....',
    '...oaassssao....',
    '...oassoosao....',
    '...oasssssao....',
    '....oosssoo.....',
    '.....oCCCo......',
    '...ocCaaaCco....',
    '..ocCaaaaaCco...',
    '..ocCaaAaaCco...',
    '..ocCaaaaaCco...',
    '...ocCaaaCco....',
    '....oAAAAAo.....',
    '....oAo.oAo.....',
    '....oAo.oAo.....',
    '....oAo.oAo.....',
    '...ooAo.oAoo....',
    '...obbo.obbo....',
    '...oooo.oooo....'
  ];

  // Épée tenue devant, pivot au pommeau (7 x 16).
  var SWORD = [
    '...o...',
    '..oMo..',
    '..oMo..',
    '..mMo..',
    '..mMo..',
    '..mMo..',
    '..mMo..',
    '..mMo..',
    '..mMo..',
    '..mMo..',
    '.ogggo.',
    'ogggggo',
    '..ogo..',
    '..ogo..',
    '..ogo..',
    '...o...'
  ];

  // Démon cornu, de face (22 x 17).
  var ENEMY = [
    '...o..............o...',
    '...og............go...',
    '...ogo..oooooo..ogo...',
    '....ogoohhhhhhoogo....',
    '....ohhhhhhhhhhhho....',
    '...ohhhhhhhhhhhhhho...',
    '...ohhrrhhhhhhrrhho...',
    '...ohhrrhhhhhhrrhho...',
    '...ohhhhhhhhhhhhhho...',
    '...ohHHHHHHHHHHHHho...',
    '...ohwowowowowowwho...',
    '...ohhwwwwwwwwwwhho...',
    '....ohhhhhhhhhhhho....',
    '.....ohhhhhhhhhho.....',
    '.....oHHHHHHHHHHo.....',
    '......oHHHHHHHHo......',
    '.......oooooooo.......'
  ];

  /** Matrice de caractères -> RenderTexture au voisin le plus proche. */
  function pixelTexture(renderer, rows, map) {
    var g = new PIXI.Graphics();
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y], x = 0;
      while (x < row.length) {
        var ch = row.charAt(x);
        if (map[ch] == null) { x++; continue; }
        var x2 = x;
        while (x2 + 1 < row.length && row.charAt(x2 + 1) === ch) x2++;
        g.rect(x, y, x2 - x + 1, 1).fill({ color: map[ch] });
        x = x2 + 1;
      }
    }
    var t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    crisp(t);
    return t;
  }

  function crisp(t) {
    try { t.source.scaleMode = 'nearest'; t.source.antialias = false; } catch (e) { /* ignore */ }
    return t;
  }

  /**
   * Silhouette de relief répétable : somme de sinus de périodes entières, donc
   * identique en x=0 et x=largeur — la texture se carrelle sans couture.
   */
  function ridgeTexture(renderer, w, h, body, crest, amp, base, seed) {
    var r = rng(seed);
    var ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    var g = new PIXI.Graphics();
    var step = 4;
    var pts = [];
    var ys = [];
    for (var x = 0; x <= w; x += step) {
      var t = (x / w) * Math.PI * 2;
      var y = base
        + Math.sin(t + ph[0]) * amp
        + Math.sin(t * 2 + ph[1]) * amp * 0.45
        + Math.sin(t * 3 + ph[2]) * amp * 0.22
        + Math.sin(t * 5 + ph[3]) * amp * 0.11;
      y = Math.round(y / step) * step;
      ys.push(y);
      pts.push(x, y);
    }
    g.poly(pts.concat([w, h, 0, h])).fill({ color: body });
    for (var i = 0; i < ys.length; i++) {
      g.rect(i * step, ys[i], step, step).fill({ color: crest });
    }
    var t2 = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return crisp(t2);
  }

  /** Bande de nuages répétable : blocs translucides posés sur une trame. */
  function cloudTexture(renderer, w, h, color, seed) {
    var r = rng(seed);
    var g = new PIXI.Graphics();
    for (var i = 0; i < 26; i++) {
      var cx = r() * w, cy = r() * h, ww = 24 + r() * 90, hh = 6 + r() * 14;
      g.rect(Math.round(cx), Math.round(cy), Math.round(ww), Math.round(hh)).fill({ color: color, alpha: 0.10 + r() * 0.12 });
      g.rect(Math.round(cx + ww * 0.2), Math.round(cy - hh * 0.6), Math.round(ww * 0.6), Math.round(hh)).fill({ color: color, alpha: 0.08 + r() * 0.10 });
    }
    var t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return crisp(t);
  }

  /** Dalle de sol : fond uni, mouchetis et joints, répétable dans les deux sens. */
  function soilTexture(renderer, size, base, dark, light, seed) {
    var r = rng(seed);
    var g = new PIXI.Graphics();
    g.rect(0, 0, size, size).fill({ color: base });
    for (var i = 0; i < 70; i++) {
      var x = Math.floor(r() * size), y = Math.floor(r() * size), s = 1 + Math.floor(r() * 2);
      g.rect(x, y, s, s).fill({ color: r() > 0.5 ? dark : light, alpha: 0.5 });
    }
    g.rect(0, 0, size, 1).fill({ color: light, alpha: 0.28 });
    g.rect(0, Math.floor(size / 2), size, 1).fill({ color: dark, alpha: 0.35 });
    var t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return crisp(t);
  }

  function dotTexture(renderer, size, color) {
    var g = new PIXI.Graphics().rect(0, 0, size, size).fill({ color: color });
    var t = renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return crisp(t);
  }

  // Les textures sont générées une fois et gardées : quitter puis revenir sur
  // le thème ne les reconstruit pas. `destroy({children:true})` du noyau ne
  // détruit pas les textures des sprites, seulement les nœuds.
  var TEX = null;

  function textures(j) {
    if (TEX) return TEX;
    var rd = j.app.renderer;
    TEX = {
      hero: pixelTexture(rd, HERO, PIX),
      sword: pixelTexture(rd, SWORD, PIX),
      enemy: pixelTexture(rd, ENEMY, PIX),
      mountFar: ridgeTexture(rd, 512, 232, C.mountFar, C.mountFarTop, 34, 120, 7),
      mountNear: ridgeTexture(rd, 512, 200, C.mountNear, C.mountNearTop, 22, 96, 23),
      cloud: cloudTexture(rd, 384, 96, 0xc8bfff, 41),
      soil: soilTexture(rd, 32, C.soilNear, 0x3b3020, 0x9c8a6e, 17),
      dust: soilTexture(rd, 32, C.soilFar, 0x241c40, 0x6a5c96, 29),
      dot: dotTexture(rd, 2, C.white)
    };
    return TEX;
  }

  // ---------------------------------------------------- fenêtre pixel
  //
  // La fenêtre de commande d'un JRPG : contour sombre, liseré clair de
  // quelques pixels, second contour sombre, corps outremer plus clair en
  // haut, et un rivet doré à chaque coin. Aucun arrondi.

  /** Cadre creux : quatre côtés, pas de plaque pleine. */
  function ring(g, x, y, w, h, t, color, alpha) {
    g.rect(x, y, w, t).fill({ color: color, alpha: alpha });
    g.rect(x, y + h - t, w, t).fill({ color: color, alpha: alpha });
    g.rect(x, y + t, t, h - t * 2).fill({ color: color, alpha: alpha });
    g.rect(x + w - t, y + t, t, h - t * 2).fill({ color: color, alpha: alpha });
  }

  // `o.hollow` : seuls les quatre côtés sont peints, l'intérieur reste
  // transparent. C'est ce qu'il faut pour le cadre de combat, sinon la plaque
  // de la fenêtre recouvre le ciel, la lune et les montagnes du fond.
  function pixelWindow(g, x, y, w, h, o) {
    o = o || {};
    var b = o.bw || 5;
    var alpha = o.alpha == null ? 1 : o.alpha;
    var fill = o.fill == null ? C.win : o.fill;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (o.hollow) {
      ring(g, x - b - 2, y - b - 2, w + b * 2 + 4, h + b * 2 + 4, 2, C.winEdge, alpha);
      ring(g, x - b, y - b, w + b * 2, h + b * 2, b, o.border || C.winBorder, alpha);
      ring(g, x - 2, y - 2, w + 4, h + 4, 2, C.winEdge, alpha);
    } else {
      g.rect(x - b - 2, y - b - 2, w + b * 2 + 4, h + b * 2 + 4).fill({ color: C.winEdge, alpha: alpha });
      g.rect(x - b, y - b, w + b * 2, h + b * 2).fill({ color: o.border || C.winBorder, alpha: alpha });
      g.rect(x - 2, y - 2, w + 4, h + 4).fill({ color: C.winEdge, alpha: alpha });
      g.rect(x, y, w, h).fill({ color: fill, alpha: alpha * (o.fillAlpha == null ? 1 : o.fillAlpha) });
      g.rect(x, y, w, Math.max(2, Math.round(h * 0.42))).fill({ color: o.fillHi || C.winHi, alpha: alpha * 0.30 });
    }
    var s = Math.max(3, b);
    var stud = o.stud || C.gold;
    [[x - b, y - b], [x + w + b - s, y - b], [x - b, y + h + b - s], [x + w + b - s, y + h + b - s]]
      .forEach(function (p) { g.rect(p[0], p[1], s, s).fill({ color: stud, alpha: alpha }); });
  }

  // ------------------------------------------------------------- état
  //
  // Un seul objet d'état, remis à neuf par `paint` (décor de fond) et par
  // `decor` (arène). Tout est relu en vérifiant `destroyed` : le noyau
  // détruit les nœuds à chaque mise en page.

  var R = {
    t: 0, bg: null, ar: null, typers: [],
    keys: null, offLayout: null, offAction: null, offToggle: null,
    sel: { g: 0, i: 0 }, hp: null, msg: ''
  };

  // ------------------------------------------------------- composants
  //
  // `button` et `toggle` du thème : fenêtre pixel, gouttière de curseur ▶ à
  // gauche, enfoncement franc de quelques pixels (pas de ressort mou), et les
  // mêmes garanties que les fabriques du noyau (dessin centré sur l'origine,
  // `hitArea` posé dans `redraw`, `_w`/`setWidth` pour `uniformWidth`).

  function makeText(str, o) {
    var j = window.Juicy.instance;
    o = o || {};
    var t = new PIXI.Text({ text: String(str == null ? '' : str), style: j.ui.style(o.role || 'label', o) });
    t.roundPixels = true;
    return t;
  }

  function drawCursor(g, s, color) {
    g.clear();
    // ▶ dessiné en marches de pixels, pas en triangle lisse
    var n = Math.max(3, Math.round(s / 2));
    for (var i = 0; i < n; i++) {
      var hh = (n - i) * 2;
      g.rect(i * 2, -hh, 2, hh * 2).fill({ color: color });
    }
  }

  function pressable(node, body, opts, onPress) {
    var j = window.Juicy.instance;
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.label || opts.id || 'action';
    node.accessibleHint = opts.accessibleHint || '';
    node.tabIndex = 0;
    node.isPressable = true;
    node.on('pointerover', function () {
      node._hover = true; node.redraw();
      body.position.set(-1, -1);
      if (j.audio) j.audio.play('hover');
    });
    node.on('pointerout', function () {
      node._hover = false; node._down = false; node.redraw();
      body.position.set(0, 0);
    });
    node.on('pointerdown', function () {
      node._down = true; node.redraw();
      body.position.set(0, node._depth);
    });
    node.on('pointerupoutside', function () {
      node._down = false; node.redraw();
      body.position.set(0, 0);
    });
    node.on('pointerup', function (e) {
      var was = node._down;
      node._down = false; node.redraw();
      body.position.set(node._hover ? -1 : 0, node._hover ? -1 : 0);
      if (was && typeof onPress === 'function') onPress(e, node);
    });
    return node;
  }

  function frameFor(node, bg, sk, w, h, fill, border) {
    var x0 = -w / 2, y0 = -h / 2, d = node._depth;
    bg.clear();
    bg.rect(x0 + 2, y0 + d, w, h).fill({ color: 0x000000, alpha: node._down ? 0.16 : 0.42 });
    bg.rect(x0, y0, w, h).fill({ color: C.winEdge });
    bg.rect(x0 + 2, y0 + 2, w - 4, h - 4).fill({ color: border });
    bg.rect(x0 + 2 + sk.borderWidth, y0 + 2 + sk.borderWidth, w - 4 - sk.borderWidth * 2, h - 4 - sk.borderWidth * 2)
      .fill({ color: fill });
    bg.rect(x0 + 2 + sk.borderWidth, y0 + 2 + sk.borderWidth, w - 4 - sk.borderWidth * 2, 2)
      .fill({ color: C.white, alpha: 0.22 });
  }

  function rpgButton(opts) {
    var j = window.Juicy.instance;
    opts = opts || {};
    var sk = merge(j.skin.button, opts.skin);
    var node = new PIXI.Container();
    var body = new PIXI.Container();
    var bg = new PIXI.Graphics();
    var cur = new PIXI.Graphics();
    var label = makeText(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily, fontWeight: '600'
    });
    body.addChild(bg, cur, label);
    node.addChild(body);
    node.isButton = true;
    node.uiKind = 'button';
    node.labelText = label;
    node.cursorG = cur;
    node._depth = 3;
    node._active = !!opts.active;
    var gut = Math.round(Math.max(10, sk.fontSize * 0.9)) + 6;
    node._gut = gut;
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + gut + sk.padX * 2);
    node._h = opts.height || (label.height + sk.padY * 2);

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2;
      var fill = node._active ? sk.fillActive : ((node._down || node._hover || node._rpgSel) ? sk.fillHover : sk.fill);
      var border = (node._hover || node._rpgSel) ? C.gold : sk.border;
      frameFor(node, bg, sk, w, h, fill, node._active ? C.gold : border);
      label.style.fill = node._active ? sk.textActive : sk.text;
      label.position.set(Math.round(x0 + sk.padX + node._gut), Math.round(-label.height / 2));
      drawCursor(cur, Math.max(8, sk.fontSize * 0.8), node._active ? sk.textActive : C.gold);
      cur.position.set(Math.round(x0 + sk.padX), 0);
      cur.alpha = (node._hover || node._rpgSel) ? 1 : 0;
      node.hitArea = new PIXI.Rectangle(x0, -h / 2, w, h + node._depth);
    };
    node.setLabel = function (s) { label.text = s; node.redraw(); return node; };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setActive = function (v) { node._active = !!v; node.redraw(); return node; };
    node.rpgSelect = function (v) { node._rpgSel = !!v; node.redraw(); return node; };
    node.rpgActivate = function () { if (typeof opts.onPress === 'function') opts.onPress(null, node); };
    node.redraw();
    return pressable(node, body, opts, opts.onPress);
  }

  function rpgToggle(opts) {
    var j = window.Juicy.instance;
    opts = opts || {};
    var sk = merge(j.skin.toggle, opts.skin);
    var node = new PIXI.Container();
    var body = new PIXI.Container();
    var bg = new PIXI.Graphics();
    var cur = new PIXI.Graphics();
    var lamp = new PIXI.Graphics();
    var label = makeText(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily
    });
    body.addChild(bg, cur, lamp, label);
    node.addChild(body);
    node.isToggle = true;
    node.uiKind = 'toggle';
    node.labelText = label;
    node.cursorG = cur;
    node._depth = 3;
    node._on = !!opts.value;
    var gut = Math.round(Math.max(10, sk.fontSize * 0.9)) + 6;
    var lampW = Math.round(Math.max(12, sk.fontSize * 1.5));
    node._gut = gut;
    node._lampW = lampW;
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + gut + lampW + sk.padX * 2 + 10);
    node._h = opts.height || (Math.max(label.height, sk.fontSize) + sk.padY * 2);

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2;
      var fill = node._on ? sk.fillOn : ((node._down || node._hover || node._rpgSel) ? sk.fillHover : sk.fill);
      var border = node._on ? sk.borderOn : ((node._hover || node._rpgSel) ? C.gold : sk.border);
      frameFor(node, bg, sk, w, h, fill, border);
      label.style.fill = node._on ? sk.textOn : sk.text;
      label.position.set(Math.round(x0 + sk.padX + node._gut), Math.round(-label.height / 2));
      drawCursor(cur, Math.max(8, sk.fontSize * 0.8), C.gold);
      cur.position.set(Math.round(x0 + sk.padX), 0);
      cur.alpha = (node._hover || node._rpgSel) ? 1 : 0;
      // témoin façon jauge : trois cases qui s'allument
      var lx = Math.round(w / 2 - sk.padX - node._lampW), lh = Math.round(Math.max(6, h * 0.34));
      var cell = Math.floor(node._lampW / 3);
      lamp.clear();
      lamp.rect(lx - 2, -lh / 2 - 2, node._lampW + 4, lh + 4).fill({ color: C.winEdge });
      for (var i = 0; i < 3; i++) {
        lamp.rect(lx + i * cell, -lh / 2, cell - 1, lh)
          .fill({ color: node._on ? sk.knobOn : sk.knobOff, alpha: node._on ? 1 : 0.45 });
      }
      node.hitArea = new PIXI.Rectangle(x0, -h / 2, w, h + node._depth);
    };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setValue = function (v, silent) {
      var next = !!v;
      if (next === node._on) return node;
      node._on = next;
      node.redraw();
      node.accessibleHint = next ? 'activé' : 'désactivé';
      if (!silent && typeof opts.onChange === 'function') opts.onChange(next, node);
      return node;
    };
    Object.defineProperty(node, 'value', { get: function () { return node._on; } });
    node.rpgSelect = function (v) { node._rpgSel = !!v; node.redraw(); return node; };
    node.rpgActivate = function () { node.setValue(!node._on); };
    node.redraw();
    return pressable(node, body, { label: opts.label, accessibleTitle: opts.accessibleTitle },
      function () { node.setValue(!node._on); });
  }

  /** `panel` du thème : même fenêtre pixel, pour les pages qui en posent. */
  function rpgPanel(opts) {
    var j = window.Juicy.instance;
    opts = opts || {};
    var sk = merge(j.skin.panel, opts.skin);
    var w = opts.width || 280, h = opts.height || 170;
    var node = new PIXI.Container();
    var g = new PIXI.Graphics();
    node.addChild(g);
    node.uiKind = 'panel';
    node.content = new PIXI.Container();
    node._w = w; node._h = h;
    var title = opts.title ? makeText(opts.title, { role: 'label', fill: C.gold, fontSize: sk.fontSize }) : null;
    node.redraw = function () {
      g.clear();
      pixelWindow(g, -w / 2, -h / 2, w, h, { bw: 4 });
      if (title) title.position.set(Math.round(-w / 2 + 10), Math.round(-h / 2 + 8));
    };
    if (title) node.addChild(title);
    node.addChild(node.content);
    node.content.position.set(0, title ? 10 : 0);
    node.redraw();
    node.eventMode = 'static';
    node.hitArea = new PIXI.Rectangle(-w / 2, -h / 2, w, h);
    return node;
  }

  // --------------------------------------------------- clavier (flèches)
  //
  // Le noyau ne fournit pas de navigation clavier ; le thème la pose lui-même
  // sur `window` et la retire dans `transition.out` (seul hook de sortie
  // disponible). Les groupes sont les emplacements de contrôles, d'actions et
  // de nav ; le nombre de colonnes est relu dans les positions posées par le
  // noyau, donc la navigation suit toujours la grille réellement affichée.

  function groups(j) {
    var out = [];
    ['controls', 'actions', 'nav'].forEach(function (k) {
      var s = j.slots[k];
      if (s && s.items && s.items.length) out.push(s.items);
    });
    return out;
  }

  function colsOf(items) {
    if (items.length < 2) return 1;
    var y0 = items[0].position.y, n = 0;
    for (var i = 0; i < items.length; i++) {
      if (Math.abs(items[i].position.y - y0) < 0.5) n++; else break;
    }
    return Math.max(1, n);
  }

  function applySel(j) {
    var gs = groups(j);
    if (!gs.length) return;
    R.sel.g = clamp(R.sel.g, 0, gs.length - 1);
    R.sel.i = clamp(R.sel.i, 0, gs[R.sel.g].length - 1);
    gs.forEach(function (items, gi) {
      items.forEach(function (it, ii) {
        if (typeof it.rpgSelect === 'function') it.rpgSelect(gi === R.sel.g && ii === R.sel.i && R.selShown);
      });
    });
  }

  function moveSel(j, dx, dy) {
    var gs = groups(j);
    if (!gs.length) return;
    R.selShown = true;
    var items = gs[R.sel.g];
    var cols = colsOf(items);
    var i = R.sel.i + dx + dy * cols;
    if (i < 0) {
      R.sel.g = (R.sel.g + gs.length - 1) % gs.length;
      R.sel.i = gs[R.sel.g].length - 1;
    } else if (i >= items.length) {
      R.sel.g = (R.sel.g + 1) % gs.length;
      R.sel.i = 0;
    } else {
      R.sel.i = i;
    }
    applySel(j);
    if (j.audio) j.audio.play('hover');
  }

  function armKeys(j) {
    if (R.keys) return;
    R.keys = function (e) {
      var k = e.key;
      if (k === 'ArrowDown') { moveSel(j, 0, 1); }
      else if (k === 'ArrowUp') { moveSel(j, 0, -1); }
      else if (k === 'ArrowRight') { moveSel(j, 1, 0); }
      else if (k === 'ArrowLeft') { moveSel(j, -1, 0); }
      else if (k === 'Enter' || k === ' ') {
        var gs = groups(j);
        var node = gs[R.sel.g] && gs[R.sel.g][R.sel.i];
        if (!R.selShown) { R.selShown = true; applySel(j); }
        else if (node && typeof node.rpgActivate === 'function') { node.rpgActivate(); if (j.audio) j.audio.play('select'); }
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', R.keys);
    R.offLayout = j.on('layout', function () { applySel(j); });
  }

  function disarm(j) {
    if (R.keys) { window.removeEventListener('keydown', R.keys); R.keys = null; }
    if (R.offLayout) { R.offLayout(); R.offLayout = null; }
    if (R.offAction) { R.offAction(); R.offAction = null; }
    if (R.offToggle) { R.offToggle(); R.offToggle = null; }
    R.selShown = false;
  }

  // ------------------------------------------------- animation utilitaire
  //
  // Le thème anime sur le ticker de Pixi plutôt que par GSAP : sur une machine
  // lente, `lagSmoothing` étire un tween GSAP sur plusieurs secondes de temps
  // mur (piège relevé par le mandat pixi.effects). Ici une transition de
  // 1,1 s dure 1,1 s, et la promesse se résout même si la boucle s'arrête.

  function animate(j, ms, step) {
    if (j.reduced) { try { step(1); } catch (e) { /* ignore */ } return Promise.resolve(); }
    return new Promise(function (res) {
      var t = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        try { j.app.ticker.remove(fn); } catch (e) { /* ignore */ }
        clearTimeout(guard);
        res();
      }
      function fn(ticker) {
        t += ticker.deltaMS;
        var p = t >= ms ? 1 : t / ms;
        try { step(p); } catch (e) { /* ignore */ }
        if (p >= 1) finish();
      }
      var guard = setTimeout(function () { try { step(1); } catch (e) { /* ignore */ } finish(); }, ms * 3 + 4000);
      j.app.ticker.add(fn);
    });
  }

  function stagePixelate(j) {
    var f = null;
    try {
      var list = j.app.stage.filters;
      if (list && list.length && typeof list[0].size !== 'undefined') f = list[0];
    } catch (e) { /* ignore */ }
    return f;
  }

  // --------------------------------------------------------- décor de fond
  //
  // Tout est posé dans `layers.background`, que le noyau vide avant chaque
  // `paint` : rien à nettoyer en sortie de thème.

  function paintBackground(j, w, h, root, scene) {
    var T = textures(j);
    // Même ligne d'horizon que l'arène (voir buildArena : -H*0.14 du centre du
    // cadre) : sans cela le ciel, la lune et les montagnes sont peints sous le
    // sol du combat et la parallaxe ne se voit nulle part.
    var horizon = Math.round(scene ? scene.y + scene.height * 0.36 : h * 0.52);
    // `band` : la hauteur de ciel réellement visible, c'est-à-dire la partie du
    // cadre de combat au-dessus de l'horizon. Lune, nuages et montagnes sont
    // dimensionnés dessus, pas sur l'écran : sinon leurs crêtes passent au-
    // dessus de la fenêtre et on ne voit que leur base, plate.
    var top = Math.round(scene ? scene.y : 0);
    var band = Math.max(40, horizon - top);
    var bg = { root: root, stars: [], strips: [], t: 0 };

    // 1. ciel en bandes (dégradé quantifié, pas de gradient lisse)
    var sky = new PIXI.Graphics();
    var bands = 24;
    for (var i = 0; i < bands; i++) {
      var t = i / (bands - 1);
      var col = t < 0.72 ? mix(C.night, C.nightHi, t / 0.72) : mix(C.nightHi, C.dusk, (t - 0.72) / 0.28);
      sky.rect(0, Math.floor((horizon / bands) * i), w, Math.ceil(horizon / bands) + 1).fill({ color: col });
    }
    sky.rect(0, horizon - 6, w, 6).fill({ color: C.glow, alpha: 0.35 });
    root.addChild(sky);

    // 2. lune et étoiles (les étoiles scintillent, la lune non)
    var moon = new PIXI.Graphics();
    var mr = Math.round(clamp(band * 0.20, 10, 44));
    var mx = Math.round(w * 0.74), my = Math.round(horizon - band * 0.60);
    moon.rect(mx - mr, my - mr, mr * 2, mr * 2).fill({ color: 0xfff3c4, alpha: 0.10 });
    moon.circle(mx, my, mr).fill({ color: 0xfdf0c0 });
    moon.circle(mx - mr * 0.3, my - mr * 0.2, mr * 0.22).fill({ color: 0xe6d69f });
    moon.circle(mx + mr * 0.25, my + mr * 0.3, mr * 0.16).fill({ color: 0xe6d69f });
    root.addChild(moon);

    var starLayer = new PIXI.Container();
    var r = rng(5);
    var nStars = w < 900 ? 34 : 58;
    for (var s = 0; s < nStars; s++) {
      var sp = new PIXI.Sprite(T.dot);
      sp.roundPixels = true;
      var k = r() > 0.8 ? 2 : 1;
      sp.scale.set(k);
      sp.position.set(Math.round(r() * w), Math.round(top + r() * band * 0.88));
      sp.alpha = 0.3 + r() * 0.6;
      sp._ph = r() * 6.28;
      sp._sp = 0.0012 + r() * 0.002;
      starLayer.addChild(sp);
      bg.stars.push(sp);
    }
    root.addChild(starLayer);

    // 3. nuages, 4. montagnes lointaines, 5. collines proches
    function tile(tex, y, hh, alpha, tint) {
      var ts = new PIXI.TilingSprite({ texture: tex, width: w + 8, height: hh });
      ts.position.set(-4, y);
      ts.alpha = alpha == null ? 1 : alpha;
      if (tint != null) ts.tint = tint;
      ts.roundPixels = true;
      root.addChild(ts);
      return ts;
    }
    var cloudH = Math.round(clamp(band * 0.34, 20, 120));
    bg.cloud = tile(T.cloud, Math.round(horizon - band * 0.86), cloudH, 0.55);
    var farH = Math.round(clamp(band * 0.86, 34, 250));
    bg.far = tile(T.mountFar, horizon - farH + 6, farH);
    var nearH = Math.round(clamp(band * 0.56, 24, 190));
    bg.near = tile(T.mountNear, horizon - nearH + 4, nearH);

    // 6. sol : bandes qui fuient vers l'horizon, de plus en plus larges et
    //    rapides en se rapprochant — la profondeur vient de là, pas d'un
    //    dégradé.
    var nStrip = 9;
    for (var k2 = 0; k2 < nStrip; k2++) {
      var t0 = k2 / nStrip, t1 = (k2 + 1) / nStrip;
      var yA = horizon + (h - horizon) * Math.pow(t0, 1.85);
      var yB = horizon + (h - horizon) * Math.pow(t1, 1.85);
      var ts2 = new PIXI.TilingSprite({ texture: T.dust, width: w + 8, height: Math.ceil(yB - yA) + 1 });
      ts2.position.set(-4, Math.floor(yA));
      ts2.tileScale.set(0.45 + t0 * 3.4);
      ts2.tint = mix(C.soilFar, C.soilNear, Math.pow(t0, 0.7));
      ts2.roundPixels = true;
      ts2._d = t0;
      root.addChild(ts2);
      bg.strips.push(ts2);
    }

    // brume sur la ligne d'horizon, pour coller les deux moitiés
    var haze = new PIXI.Graphics();
    haze.rect(0, horizon - 10, w, 22).fill({ color: C.glow, alpha: 0.14 });
    root.addChild(haze);

    bg.horizon = horizon;
    return bg;
  }

  /** Cadres de fenêtre derrière les emplacements, et vignettage. */
  function paintFrames(j, w, h, plan, root) {
    var g = new PIXI.Graphics();
    var narrow = w < 900;
    var bw = narrow ? 3 : 5;
    var pd = narrow ? 5 : 8;
    ['scene', 'controls', 'actions', 'narration'].forEach(function (k) {
      var b = plan[k];
      if (!b || !j.slots[k]) return;
      pixelWindow(g, b.x - pd, b.y - pd, b.width + pd * 2, b.height + pd * 2, {
        bw: bw,
        hollow: k === 'scene',
        fill: C.win,
        fillAlpha: 0.94,
        alpha: 1
      });
    });
    // bandeau d'en-tête : un simple socle sombre sous titre / nav / compteur
    var head = ['title', 'tagline', 'nav', 'meta'].map(function (k) { return plan[k]; }).filter(Boolean);
    if (head.length) {
      var y1 = Math.max.apply(null, head.map(function (b) { return b.y + b.height; }));
      var base = Math.round(y1 + (narrow ? 6 : 10));
      g.rect(0, 0, w, base).fill({ color: C.winEdge, alpha: 0.55 });
      g.rect(0, base - 3, w, 3).fill({ color: C.gold, alpha: 0.65 });
    }
    root.addChild(g);

    var vig = new PIXI.Graphics();
    var vw = Math.round(clamp(w * 0.06, 18, 70));
    for (var i = 0; i < 3; i++) {
      var a = 0.13 * (1 - i / 3);
      vig.rect(0, 0, vw * (1 - i / 4), h).fill({ color: 0x000000, alpha: a });
      vig.rect(w - vw * (1 - i / 4), 0, vw * (1 - i / 4), h).fill({ color: 0x000000, alpha: a });
    }
    vig.eventMode = 'none';
    root.addChild(vig);
  }

  // -------------------------------------------------------------- l'arène
  //
  // Contenu de l'emplacement `scene` quand `content.scene === 'decor'` :
  // l'écran de combat proprement dit. Tout est construit dans un repère
  // centré, d'exactement la taille du cadre que le thème a réservé, pour que
  // le noyau le pose à l'échelle 1.

  function bar(w, h, color, back) {
    var c = new PIXI.Container();
    var frame = new PIXI.Graphics();
    var fill = new PIXI.Graphics();
    frame.rect(-2, -2, w + 4, h + 4).fill({ color: C.winEdge });
    frame.rect(0, 0, w, h).fill({ color: back });
    c.addChild(frame, fill);
    c._w = w; c._h = h; c._color = color; c._fill = fill; c._v = 1; c._target = 1;
    c.render0 = function () {
      fill.clear();
      var ww = Math.max(0, Math.round(w * c._v));
      if (ww > 0) {
        fill.rect(0, 0, ww, h).fill({ color: color });
        fill.rect(0, 0, ww, Math.max(1, Math.round(h * 0.35))).fill({ color: C.white, alpha: 0.28 });
      }
    };
    c.render0();
    return c;
  }

  function buildArena(j, frame) {
    var T = textures(j);
    var W = Math.max(80, frame.width), H = Math.max(60, frame.height);
    var root = new PIXI.Container();
    var ar = { root: root, W: W, H: H, t: 0, hitT: 0, lungeT: 0, deadT: 0, floats: [] };

    // boîte invisible : fixe la taille naturelle du décor (échelle 1)
    root.addChild(new PIXI.Graphics().rect(-W / 2, -H / 2, W, H).fill({ color: C.night, alpha: 0 }));

    // Pas de masque : sous une caméra tournée (effets `tilt`, `drunk`) Pixi ne
    // peut plus ramener un masque rectangulaire à un scissor et paie un
    // passage de pochoir à chaque image. Le contenu tient dans le cadre par
    // construction (bandes de sol exactement larges de W, positions bornées).

    var horizon = -H * 0.14;

    // sol de l'arène : mêmes bandes fuyantes, mais texture de terre battue
    ar.floor = [];
    var nS = 8;
    for (var i = 0; i < nS; i++) {
      var t0 = i / nS, t1 = (i + 1) / nS;
      var yA = horizon + (H / 2 - horizon) * Math.pow(t0, 1.8);
      var yB = horizon + (H / 2 - horizon) * Math.pow(t1, 1.8);
      var ts = new PIXI.TilingSprite({ texture: T.soil, width: W, height: Math.ceil(yB - yA) + 1 });
      ts.position.set(-W / 2, Math.floor(yA));
      ts.tileScale.set(0.5 + t0 * 3.2);
      ts.tint = mix(0x4a3f63, 0xa08a62, Math.pow(t0, 0.8));
      ts.roundPixels = true;
      ts._d = t0;
      root.addChild(ts);
      ar.floor.push(ts);
    }
    var glow = new PIXI.Graphics();
    glow.rect(-W / 2, horizon - Math.round(H * 0.1), W, Math.round(H * 0.1)).fill({ color: C.dusk, alpha: 0.5 });
    glow.rect(-W / 2, horizon - 4, W, 6).fill({ color: C.glow, alpha: 0.45 });
    root.addChildAt(glow, 1);

    function shadow(x, y, rw) {
      var g = new PIXI.Graphics();
      g.ellipse(0, 0, rw, rw * 0.3).fill({ color: 0x000000, alpha: 0.38 });
      g.position.set(x, y);
      root.addChild(g);
      return g;
    }

    function pixSprite(tex, k) {
      var sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.scale.set(k);
      sp.roundPixels = true;
      return sp;
    }

    // monstre : en haut à gauche, il flotte
    var ek = Math.max(1, Math.round((H * 0.34) / ENEMY.length));
    ar.enemyShadow = shadow(-W * 0.24, horizon + H * 0.17, ENEMY[0].length * ek * 0.4);
    ar.enemy = pixSprite(T.enemy, ek);
    ar.enemy.position.set(-W * 0.24, horizon + H * 0.13);
    root.addChild(ar.enemy);
    ar.enemyFlash = pixSprite(T.enemy, ek);
    ar.enemyFlash.position.copyFrom(ar.enemy.position);
    ar.enemyFlash.tint = C.white;
    ar.enemyFlash.blendMode = 'add';
    ar.enemyFlash.alpha = 0;
    root.addChild(ar.enemyFlash);

    // héros : en bas à droite, de dos-profil, épée au poing
    var hk = Math.max(1, Math.round((H * 0.36) / HERO.length));
    ar.heroShadow = shadow(W * 0.26, H * 0.34, HERO[0].length * hk * 0.42);
    ar.hero = new PIXI.Container();
    var body = pixSprite(T.hero, hk);
    var sword = pixSprite(T.sword, hk);
    sword.anchor.set(0.5, 1);
    sword.position.set(-HERO[0].length * hk * 0.42, -HERO.length * hk * 0.36);
    sword.rotation = -0.35;
    ar.sword = sword;
    ar.hero.addChild(sword, body);
    ar.hero.position.set(W * 0.26, H * 0.34);
    root.addChild(ar.hero);

    // jauges : fenêtre du monstre en haut à gauche, du héros en bas à droite
    var fs = clamp(Math.round(H * 0.055), 7, 15);
    function gaugeBox(x, y, w, hh, title, bars, anchorRight) {
      var c = new PIXI.Container();
      var g = new PIXI.Graphics();
      pixelWindow(g, 0, 0, w, hh, { bw: 3 });
      c.addChild(g);
      var t = makeText(title, { role: 'label', fill: C.parchment, fontSize: fs });
      t.position.set(6, 5);
      c.addChild(t);
      // Le nom est ramené dans la fenêtre : la police du thème n'est pas
      // garantie chargée, sa largeur réelle n'est connue qu'ici.
      c.fitTitle = function () {
        t.scale.set(1);
        var m = (w - 12) / Math.max(1, t.width);
        if (m < 1) t.scale.set(m);
      };
      c.fitTitle();
      var by = 8 + t.height;
      bars.forEach(function (b) {
        b.position.set(6, by);
        c.addChild(b);
        by += b._h + 5;
      });
      c.position.set(anchorRight ? x - w : x, y);
      root.addChild(c);
      return c;
    }
    var gw = Math.round(clamp(W * 0.3, 110, 240));
    var bw2 = gw - 12;
    ar.ehp = bar(bw2, Math.max(5, Math.round(fs * 0.7)), C.blood, 0x3a1030);
    ar.hhp = bar(bw2, Math.max(5, Math.round(fs * 0.7)), C.leaf, 0x10301e);
    ar.hmp = bar(bw2, Math.max(4, Math.round(fs * 0.55)), C.mana, 0x102038);
    ar.ebox = gaugeBox(-W / 2 + 14, -H / 2 + 12, gw, Math.round(fs * 2.4), 'SEIGNEUR DES CENDRES', [ar.ehp], false);
    ar.hbox = gaugeBox(W / 2 - 14, H / 2 - Math.round(fs * 4.0) - 12, gw, Math.round(fs * 3.6), 'HÉROS', [ar.hhp, ar.hmp], true);

    ar.floats = new PIXI.Container();
    root.addChild(ar.floats);

    ar.flash = new PIXI.Graphics().rect(-W / 2, -H / 2, W, H).fill({ color: C.white });
    ar.flash.alpha = 0;
    root.addChild(ar.flash);

    ar.fs = fs;
    ar.horizon = horizon;

    // les points de vie survivent aux mises en page (le décor est reconstruit,
    // pas le combat)
    if (!R.hp) R.hp = { ehp: 1, hhp: 1, hmp: 1, kills: 0 };
    ar.ehp._v = ar.ehp._target = R.hp.ehp;
    ar.hhp._v = ar.hhp._target = R.hp.hhp;
    ar.hmp._v = ar.hmp._target = R.hp.hmp;
    ar.ehp.render0(); ar.hhp.render0(); ar.hmp.render0();
    return ar;
  }

  function floatText(ar, str, color, x, y, size) {
    if (!alive(ar.floats)) return;
    var t = makeText(str, { role: 'label', fill: color, fontSize: size, fontWeight: '700' });
    t.position.set(Math.round(x - t.width / 2), Math.round(y));
    t._life = 0;
    t._floor = Math.round(y);
    t._ceil = Math.round(-ar.H / 2 + 6);
    ar.floats.addChild(t);
  }

  /** Une action de la page = un coup porté. */
  function strike(j) {
    var ar = R.ar;
    if (!ar || !alive(ar.root)) return;
    var dmg = 40 + Math.floor(Math.random() * 180) + j.state.combo * 25;
    var crit = j.state.combo >= 3;
    ar.lungeT = 1;
    ar.hitT = 1;
    ar.flash.alpha = crit ? 0.7 : 0.45;
    ar.ehp._target = Math.max(0, ar.ehp._target - dmg / 1200);
    R.hp.ehp = ar.ehp._target;
    ar.shakeBox = 1;
    floatText(ar, (crit ? 'CRIT ' : '') + dmg, crit ? C.gold : C.parchment,
      ar.enemy.x + (Math.random() * 30 - 15), ar.enemy.y - ar.H * 0.22, Math.round(ar.fs * (crit ? 2.0 : 1.5)));
    say(j, crit ? 'COUP CRITIQUE ! ' + dmg + ' dégâts !' : 'Le héros frappe ! ' + dmg + ' dégâts.');
    if (ar.ehp._target <= 0.001 && ar.deadT === 0) {
      ar.deadT = 1;
      R.hp.kills += 1;
      say(j, 'Le seigneur des cendres est vaincu !');
    }
  }

  /** Un interrupteur = une incantation : la magie coûte des PM. */
  function cast(j, on) {
    var ar = R.ar;
    if (!ar || !alive(ar.root)) return;
    ar.hmp._target = on ? Math.max(0.08, ar.hmp._target - 0.12) : Math.min(1, ar.hmp._target + 0.1);
    R.hp.hmp = ar.hmp._target;
    ar.shakeBox = 0.6;
    ar.hitT = Math.max(ar.hitT, 0.5);
    floatText(ar, on ? 'MAGIE' : 'REPOS', on ? C.mana : C.leaf,
      ar.hero.x - ar.W * 0.02, ar.hero.y - ar.H * 0.3, Math.round(ar.fs * 1.2));
  }

  // --------------------------------------------- boîte de dialogue (texte)

  function say(j, msg) {
    var slot = j.slots.narration;
    if (!slot || !slot.items || !slot.items[0]) return;
    var t = slot.items[0];
    if (!alive(t)) return;
    // Le noyau a posé ce texte avec `wrapWidth` = largeur de la boîte : le
    // retour à la ligne suit la nouvelle phrase sans remise en page. Pas de
    // `relayout` ici — il repositionnerait les menus sous le curseur.
    R.msg = msg;
    t._rpgFull = msg;
    t._rpgAt = 0;
    t._rpgShown = -1;
    t._rpgArm = false;
    t.text = '';
    if (R.typers.indexOf(t) < 0) R.typers.push(t);
  }

  function registerTyper(t) {
    // Le texte reste en place : le noyau doit mesurer la largeur finale avant
    // que la frappe ne commence, sinon l'emplacement est calé sur une chaîne
    // vide et la phrase déborde de sa boîte en s'écrivant.
    t._rpgFull = t.text;
    t._rpgAt = 0;
    t._rpgArm = true;
    R.typers = R.typers.filter(alive);
    R.typers.push(t);
  }

  function runTypers(j, dt) {
    var any = false;
    for (var i = 0; i < R.typers.length; i++) {
      var t = R.typers[i];
      if (!alive(t) || t._rpgFull == null) continue;
      if (t._rpgArm) { t._rpgArm = false; t._rpgShown = 0; t.text = ''; }
      if (t._rpgAt >= t._rpgFull.length) continue;
      any = true;
      t._rpgAt = Math.min(t._rpgFull.length, t._rpgAt + Math.max(1, dt / 34));
      var n = Math.floor(t._rpgAt);
      if (n !== t._rpgShown) {
        t._rpgShown = n;
        t.text = t._rpgFull.slice(0, n);
        if (n % 3 === 0 && j.audio) j.audio.play('select');
      }
    }
    if (!any && R.typers.length) R.typers = R.typers.filter(function (x) {
      return alive(x) && x._rpgFull != null && x._rpgAt < x._rpgFull.length;
    });
  }

  // ------------------------------------------------------------ transition

  function shutters(j, ms) {
    var over = j.layers.overlay;
    var box = new PIXI.Container();
    box.eventMode = 'none';
    over.addChild(box);
    var w = j.screen.width, h = j.screen.height;
    var n = 12;
    var bandH = Math.ceil(h / n) + 1;
    var bars = [];
    for (var i = 0; i < n; i++) {
      var g = new PIXI.Graphics()
        .rect(0, 0, w, bandH).fill({ color: C.winEdge })
        .rect(0, bandH - 3, w, 3).fill({ color: C.gold, alpha: 0.6 });
      g.position.set(0, i * (h / n));
      g.pivot.set(0, 0);
      g._dir = (i % 2 === 0) ? 1 : -1;
      box.addChild(g);
      bars.push(g);
    }
    var flash = new PIXI.Graphics().rect(0, 0, w, h).fill({ color: C.white });
    flash.alpha = 0;
    box.addChild(flash);

    var pf = stagePixelate(j);
    return animate(j, ms, function (p) {
      var e = p * p * (3 - 2 * p);
      bars.forEach(function (g, i) {
        var d = clamp((e - (i / bars.length) * 0.25) / 0.75, 0, 1);
        g.scale.y = 1 - d;
        g.position.x = g._dir * d * 26;
      });
      flash.alpha = p < 0.22 ? (p / 0.22) * 0.85 : Math.max(0, 0.85 * (1 - (p - 0.22) / 0.3));
      if (pf) { try { pf.size = Math.max(1, 30 * (1 - Math.min(1, p / 0.55))); } catch (e2) { /* ignore */ } }
    }).then(function () {
      if (alive(box)) { box.parent && box.parent.removeChild(box); box.destroy({ children: true }); }
    });
  }

  function dissolve(j, ms) {
    var f = null;
    try {
      if (PIXI.filters && PIXI.filters.PixelateFilter) {
        f = new PIXI.filters.PixelateFilter(1);
        j.app.stage.filters = [f];
      }
    } catch (e) { f = null; }
    return animate(j, ms, function (p) {
      if (f) { try { f.size = 1 + 30 * p * p; } catch (e2) { /* ignore */ } }
    });
  }

  // ------------------------------------------------------------- le thème

  var rpg = {
    id: 'rpg',
    name: 'RPG',

    tokens: {
      colors: {
        bg: C.night, bgAlt: C.nightHi, surface: C.win, surfaceAlt: C.winHi,
        border: C.winBorder, text: C.parchment, muted: C.muted,
        accent: C.gold, accentText: 0x2a1a05,
        danger: C.blood, success: C.leaf
      },
      fonts: {
        display: '"Press Start 2P", ui-monospace, "Courier New", monospace',
        body: '"Press Start 2P", ui-monospace, "Courier New", monospace'
      },
      radius: 0,
      gap: 10,
      sizes: { title: 38, tagline: 12, label: 11, meta: 11, narration: 17, nav: 11 }
    },

    skin: {
      button: {
        fill: C.win, fillHover: C.winHi, fillActive: C.gold,
        text: C.parchment, textActive: 0x2a1a05,
        border: C.winBorder, borderWidth: 3, radius: 0,
        padX: 12, padY: 9, gloss: 0, depth: 3
      },
      toggle: {
        fill: C.win, fillHover: C.winHi, fillOn: 0x2a3590,
        text: C.muted, textOn: C.parchment,
        border: C.winBorder, borderOn: C.gold, borderWidth: 3, radius: 0,
        padX: 12, padY: 8, knobOn: C.gold, knobOff: 0x39406e, depth: 3
      },
      text: {
        title: { fill: C.parchment, letterSpacing: 1 },
        tagline: { fill: C.muted },
        narration: { fill: C.parchment },
        meta: { fill: C.gold },
        nav: { fill: C.parchment }
      },
      panel: { fill: C.win, border: C.winBorder, borderWidth: 3, radius: 0, title: C.gold },
      card: { fill: C.win, fillBack: C.winHi, border: C.winBorder, borderWidth: 3, radius: 0, accent: C.gold },
      badge: { fill: C.gold, text: 0x2a1a05, ring: C.gold, radius: 0, borderWidth: 0 },
      scores: { rowFill: C.win, rowFillTop: C.winHi, flash: C.gold, accent: C.gold, border: C.winBorder, radius: 0 },
      modal: { fill: C.win, fillHeader: C.winHi, border: C.gold, borderWidth: 4, radius: 0, scrim: 0x05040f },
      cursor: { fill: C.parchment, accent: C.gold, size: 14 }
    },

    ui: { button: rpgButton, toggle: rpgToggle, panel: rpgPanel },

    /**
     * Bureau : la scène de combat en haut, la boîte de dialogue au milieu, les
     * deux fenêtres de commande en bas — la disposition d'un écran de combat
     * de JRPG. Écran étroit : une seule colonne, scène compacte, tout dans la
     * fenêtre (voir « Divergences » du rapport pour le glissement de caméra).
     */
    layout: function (j, w, h) {
      var has = function (k) { return !!j.slots[k]; };
      var narrow = w < 900;
      var plan = {};

      if (!narrow) {
        var pad = w >= 1200 ? 30 : 24;
        var G = 20;
        var titleH = clamp(h * 0.055, 34, 52);
        var tagH = clamp(h * 0.024, 14, 22);
        var navH = clamp(h * 0.046, 30, 44);
        var metaH = clamp(h * 0.022, 13, 20);
        var headW = w * 0.44;
        var sideW = Math.min(w * 0.40, 470);

        if (has('title')) plan.title = { x: pad, y: pad, width: headW, height: titleH, align: 'left', valign: 'top', scaleUp: true };
        if (has('tagline')) plan.tagline = { x: pad, y: pad + (has('title') ? titleH + 6 : 0), width: headW, height: tagH, align: 'left', valign: 'top', scaleUp: true };
        if (has('nav')) plan.nav = { x: w - pad - sideW, y: pad, width: sideW, height: navH, align: 'right', valign: 'top', columns: null, scaleUp: true };
        if (has('meta')) plan.meta = { x: w - pad - sideW, y: pad + (has('nav') ? navH + 8 : 0), width: sideW, height: metaH, align: 'right', valign: 'top', scaleUp: true };

        var headH = Math.max(
          (has('title') ? titleH : 0) + (has('tagline') ? tagH + 6 : 0),
          (has('nav') ? navH : 0) + (has('meta') ? metaH + 8 : 0)
        );
        var top = pad + headH + G;
        var bottom = h - pad;

        var narrH = has('narration') ? clamp(h * 0.075, 40, 84) : 0;
        var menuH = (has('controls') || has('actions')) ? clamp(h * 0.30, 130, 300) : 0;
        var sceneH = bottom - top - (narrH ? narrH + G : 0) - (menuH ? menuH + G : 0);
        if (sceneH < 80 && menuH) { menuH = Math.max(90, menuH + sceneH - 90); sceneH = 90; }

        var y = top;
        if (has('scene')) { plan.scene = { x: pad, y: y, width: w - pad * 2, height: sceneH }; y += sceneH + G; }
        if (has('narration')) {
          plan.narration = { x: pad + 10, y: y, width: w - pad * 2 - 20, height: narrH, columns: 1, align: 'left' };
          y += narrH + G;
        }
        if (menuH) {
          var colW = (has('controls') && has('actions')) ? (w - pad * 2 - G * 2) / 2 : (w - pad * 2);
          // Pas de `scaleUp` sur les grilles de menu : le noyau agrandit d'un
          // facteur quelconque, ce qui rend le pixel flou dès qu'une page
          // n'a que deux ou trois entrées (cas de `lib-demo.html`). Les
          // fenêtres gardent leur taille, les entrées restent nettes.
          if (has('controls')) plan.controls = { x: pad, y: y, width: colW, height: menuH };
          if (has('actions')) plan.actions = { x: w - pad - colW, y: y, width: colW, height: menuH };
        }
        return plan;
      }

      // ---- écran étroit : une colonne, rien ne déborde, rien ne défile
      var p2 = 14, g2 = 12;
      var tH = clamp(h * 0.045, 26, 40);
      var gH = clamp(h * 0.020, 12, 18);
      var nH = clamp(h * 0.040, 26, 36);
      var mH = clamp(h * 0.020, 12, 18);
      var narrH2 = has('narration') ? clamp(h * 0.07, 34, 60) : 0;
      var fixed = 0;
      if (has('title')) fixed += tH + g2;
      if (has('tagline')) fixed += gH + g2;
      if (has('nav')) fixed += nH + g2;
      if (has('narration')) fixed += narrH2 + g2;
      if (has('meta')) fixed += mH + g2;
      var flex = [];
      if (has('scene')) flex.push(['scene', 0.34]);
      if (has('controls')) flex.push(['controls', 0.40]);
      if (has('actions')) flex.push(['actions', 0.26]);
      var sum = flex.reduce(function (s, e) { return s + e[1]; }, 0) || 1;
      var rest = Math.max(60, h - p2 * 2 - fixed - flex.length * g2);
      var cw = w - p2 * 2;
      var yy = p2;
      function put(k, hh, extra) {
        plan[k] = merge({ x: p2, y: Math.round(yy), width: cw, height: Math.round(hh) }, extra || {});
        yy += hh + g2;
      }
      if (has('title')) put('title', tH, { scaleUp: true });
      if (has('tagline')) put('tagline', gH, { scaleUp: true });
      if (has('nav')) put('nav', nH, { scaleUp: true });
      flex.forEach(function (e, i) {
        put(e[0], rest * (e[1] / sum), null); // ni scène ni menus agrandis : pixel net
        if (i === 0 && has('narration')) put('narration', narrH2, { columns: 1, align: 'left' });
      });
      if (!flex.length && has('narration')) put('narration', narrH2, { columns: 1, align: 'left' });
      if (has('meta')) put('meta', mH, { scaleUp: true });
      return plan;
    },

    paint: function (j, w, h, plan) {
      var root = new PIXI.Container();
      j.layers.background.addChild(root);
      R.bg = paintBackground(j, w, h, root, plan.scene);
      paintFrames(j, w, h, plan, root);

      // premier passage sur le thème : brancher clavier et réactions
      armKeys(j);
      if (!R.offAction) R.offAction = j.on('action', function () { strike(j); });
      if (!R.offToggle) R.offToggle = j.on('toggle', function (e) { cast(j, e.on); });
      applySel(j);
    },

    decor: function (j, frame) {
      R.ar = buildArena(j, frame);
      return R.ar.root;
    },

    update: function (j, dt) {
      var slow = j.reduced ? 0 : 1;
      R.t += dt * slow;
      var bg = R.bg, ar = R.ar;

      // --- parallaxe : dérive propre + pointeur + caméra
      var px = 0, py = 0;
      try {
        var p = j.app.renderer.events.pointer.global;
        px = (p.x / Math.max(1, j.screen.width)) - 0.5;
        py = (p.y / Math.max(1, j.screen.height)) - 0.5;
      } catch (e) { /* pas encore de pointeur */ }
      var cs = j.camera.state;

      if (bg && alive(bg.root)) {
        if (bg.cloud) { bg.cloud.tilePosition.x = -R.t * 0.010 - px * 26 - cs.x * 0.05; bg.cloud.position.y = bg.cloud.position.y; }
        if (bg.far) { bg.far.tilePosition.x = -R.t * 0.004 - px * 40 - cs.x * 0.10; bg.far.tilePosition.y = -py * 6; }
        if (bg.near) { bg.near.tilePosition.x = -R.t * 0.009 - px * 74 - cs.x * 0.18; bg.near.tilePosition.y = -py * 10; }
        for (var i = 0; i < bg.strips.length; i++) {
          var s = bg.strips[i];
          s.tilePosition.x = -R.t * (0.004 + s._d * 0.05) - px * (12 + s._d * 130) - cs.x * (0.05 + s._d * 0.35);
        }
        for (var k = 0; k < bg.stars.length; k++) {
          var st = bg.stars[k];
          st.alpha = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(R.t * st._sp + st._ph));
        }
      }

      // --- l'arène
      if (ar && alive(ar.root)) {
        ar.t += dt * slow;
        for (var f = 0; f < ar.floor.length; f++) {
          var fl = ar.floor[f];
          fl.tilePosition.x = -ar.t * (0.006 + fl._d * 0.055) - px * (6 + fl._d * 60);
        }

        // attente : le monstre flotte, le héros respire, l'épée oscille
        var bob = Math.sin(ar.t / 520) * (ar.H * 0.018) * slow;
        ar.enemy.position.y = ar.horizon + ar.H * 0.13 + bob;
        ar.enemyFlash.position.y = ar.enemy.position.y;
        ar.enemy.scale.x = ar.enemy.scale.y * (1 + Math.sin(ar.t / 380) * 0.03 * slow);
        ar.enemyFlash.scale.x = ar.enemy.scale.x;
        ar.enemyShadow.scale.x = 1 - bob / (ar.H * 0.25);
        var hb = Math.sin(ar.t / 700) * 0.02 * slow;
        ar.hero.scale.set(1, 1 + hb);
        ar.sword.rotation = -0.35 + Math.sin(ar.t / 640) * 0.10 * slow;

        // coup porté : le héros bondit vers le monstre puis revient
        if (ar.lungeT > 0) {
          ar.lungeT = Math.max(0, ar.lungeT - dt / 480);
          var u = 1 - ar.lungeT;
          var k2 = Math.sin(Math.min(1, u * 1.6) * Math.PI);
          ar.hero.position.x = ar.W * 0.26 - k2 * ar.W * 0.30;
          ar.hero.position.y = ar.H * 0.34 - k2 * ar.H * 0.16;
          ar.sword.rotation = -0.35 - k2 * 2.4;
          ar.heroShadow.alpha = 0.38 * (1 - k2 * 0.6);
        } else {
          ar.hero.position.set(ar.W * 0.26, ar.H * 0.34);
          ar.heroShadow.alpha = 0.38;
        }

        // le monstre encaisse : éclair blanc et recul tremblé
        if (ar.hitT > 0) {
          ar.hitT = Math.max(0, ar.hitT - dt / 420);
          ar.enemyFlash.alpha = ar.hitT * 0.9;
          ar.enemy.position.x = -ar.W * 0.24 + (Math.random() * 2 - 1) * ar.hitT * ar.W * 0.03;
          ar.enemyFlash.position.x = ar.enemy.position.x;
        } else if (ar.enemyFlash.alpha !== 0) {
          ar.enemyFlash.alpha = 0;
          ar.enemy.position.x = -ar.W * 0.24;
          ar.enemyFlash.position.x = ar.enemy.position.x;
        }

        if (ar.flash.alpha > 0) ar.flash.alpha = Math.max(0, ar.flash.alpha - dt / 260);

        // jauges : elles se vident progressivement et tremblent
        [ar.ehp, ar.hhp, ar.hmp].forEach(function (b) {
          if (!alive(b)) return;
          if (Math.abs(b._v - b._target) > 0.0015) {
            b._v += (b._target - b._v) * Math.min(1, dt / 120);
            b.render0();
          } else if (b._v !== b._target) { b._v = b._target; b.render0(); }
        });
        if (ar.shakeBox > 0) {
          ar.shakeBox = Math.max(0, ar.shakeBox - dt / 320);
          var sx = (Math.random() * 2 - 1) * ar.shakeBox * 5;
          ar.ebox.position.x = -ar.W / 2 + 14 + sx;
          ar.hbox.position.x = ar.W / 2 - 14 - ar.hbox.width + sx * 0.6;
        }

        // dégâts flottants
        var kids = ar.floats.children;
        for (var d = kids.length - 1; d >= 0; d--) {
          var t2 = kids[d];
          t2._life += dt;
          t2.position.y = Math.max(t2._ceil, t2.position.y - dt * 0.045);
          t2.alpha = clamp(1 - (t2._life - 700) / 700, 0, 1);
          if (t2._life > 1500) { ar.floats.removeChild(t2); t2.destroy(); }
        }

        // le monstre tombe, puis un autre arrive
        if (ar.deadT > 0) {
          ar.deadT = Math.max(0, ar.deadT - dt / 1600);
          ar.enemy.alpha = ar.deadT;
          ar.enemyShadow.alpha = 0.38 * ar.deadT;
          ar.enemy.position.y = Math.min(ar.H / 2 - 4, ar.enemy.position.y + dt * 0.02);
          if (ar.deadT === 0) {
            ar.enemy.alpha = 1;
            R.hp.ehp = 1;
            ar.ehp._target = 1;
            if (ar.ebox.children[1]) {
              ar.ebox.children[1].text = 'SEIGNEUR DES CENDRES ' + 'I'.repeat(Math.min(4, R.hp.kills + 1));
              ar.ebox.fitTitle();
            }
            say(j, 'Un nouvel ennemi surgit des cendres !');
          }
        }
      }

      runTypers(j, dt);

      // curseur ▶ clignotant sur l'entrée survolée ou sélectionnée
      var blink = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(R.t / 190));
      var gs = groups(j);
      for (var gi = 0; gi < gs.length; gi++) {
        var items = gs[gi];
        for (var ii = 0; ii < items.length; ii++) {
          var it = items[ii];
          if (it.cursorG && !it.cursorG.destroyed && it.cursorG.alpha > 0) it.cursorG.alpha = blink;
        }
      }
    },

    meta: function (j, state) {
      return 'COUPS ' + state.counter + '   COMBO x' + state.combo;
    },

    transition: {
      out: function (j) {
        disarm(j);
        R.typers = [];
        return dissolve(j, 380);
      },
      'in': function (j) {
        return shutters(j, 1150);
      }
    }
  };

  // La machine à écrire s'accroche à la fabrique de texte : seul le rôle
  // `narration` (la boîte de dialogue du bas) est frappé lettre par lettre.
  rpg.ui.text = function (str, o) {
    var t = makeText(str, o);
    if (o && o.role === 'narration') registerTyper(t);
    return t;
  };

  window.Juicy.themes.register(rpg);
})();
