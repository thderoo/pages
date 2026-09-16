/*
 * juicy.js — noyau Juicy sur PixiJS 8.
 *
 * Une page Juicy est une scène WebGL plein écran : pas de DOM en dehors du
 * canvas et de la couche d'accessibilité de Pixi. Le noyau fournit
 * l'application, les couches, la caméra, les emplacements construits depuis
 * `content`, les registres d'effets et de thèmes, les événements, le journal
 * et un thème `plain` de référence.
 *
 * Charger APRÈS pixi.js, pixi-filters, gsap + PixiPlugin (Tone.js facultatif,
 * peut arriver plus tard : le son s'initialise paresseusement).
 *
 *   const juicy = await Juicy.create({ theme, log, fonts, content });
 *
 * Contrat détaillé : .swarm/pages/findings/pixi-concept.md, section
 * « Contrat d'API », et le rapport du mandat pixi.core.
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  if (!PIXI) {
    console.warn('[juicy] PixiJS absent : le noyau ne démarre pas.');
    return;
  }

  var gsap = global.gsap || null;
  if (gsap && global.PixiPlugin) {
    try {
      gsap.registerPlugin(global.PixiPlugin);
      if (global.PixiPlugin.registerPIXI) global.PixiPlugin.registerPIXI(PIXI);
    } catch (e) { /* PixiPlugin facultatif */ }
  }

  // ------------------------------------------------------------------ utils

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /** Fusion profonde à deux niveaux (suffit pour tokens et skin). */
  function merge(base, over) {
    var out = {};
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      out[k] = (isObj(base && base[k]) && isObj(over[k])) ? merge(base[k], over[k]) : over[k];
    });
    return out;
  }

  function killTweens(node) {
    if (!gsap || !node) return;
    try { gsap.killTweensOf(node); } catch (e) { /* ignore */ }
    if (node.children) node.children.forEach(killTweens);
  }

  function clearContainer(c) {
    if (!c) return;
    var kids = c.removeChildren();
    kids.forEach(function (k) {
      killTweens(k);
      try { k.destroy({ children: true }); } catch (e) { /* ignore */ }
    });
  }

  function rectOf(b) { return { x: b.x, y: b.y, width: b.width, height: b.height }; }
  function fmt(r) { return Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }

  // ---------------------------------------------------------------- journal

  var T0 = 0;
  var LOG = false;

  function log(msg) {
    if (!LOG) return;
    var t = ((global.performance ? performance.now() : Date.now()) - T0) / 1000;
    console.info('[juicy +' + t.toFixed(3) + 's] ' + msg);
  }

  function warnLine(msg) {
    var t = ((global.performance ? performance.now() : Date.now()) - T0) / 1000;
    console.warn('[juicy +' + t.toFixed(3) + 's] ' + msg);
  }

  // --------------------------------------------------------------- registres

  var effectDefs = {};
  var effectOn = {};
  var themeDefs = {};
  var themeOrder = [];
  var inst = null;

  // Une exception dans un effet ne disparaît plus dans la console : elle est
  // comptée (`juicy.errors`), écrite au journal et émise sur `error`, pour
  // qu'un harnais qui n'écoute que la console ne croie pas que tout va bien
  // pendant qu'un effet meurt. Le `console.warn` reste.
  var effectErrors = [];

  function effectError(id, phase, e) {
    effectErrors.push({
      effect: id, phase: phase, error: e,
      at: (global.performance ? performance.now() : Date.now()) - T0
    });
    console.warn('[juicy] effet ' + id + ' ' + phase + ' :', e);
    log('effect ' + id + ' failed in ' + phase + ': ' + ((e && e.message) || e));
    if (inst) inst.emit('error', { effect: id, phase: phase, error: e });
  }

  var effects = {
    /** define(id, def) ou define(def) avec def.id. */
    define: function (id, def) {
      if (isObj(id)) { def = id; id = def.id; }
      if (!id || !isObj(def)) { console.warn('[juicy] effects.define : id ou définition manquante'); return effects; }
      def.id = id;
      effectDefs[id] = def;
      return effects;
    },
    get: function (id) { return effectDefs[id] || null; },
    has: function (id) { return !!effectDefs[id]; },
    list: function () { return Object.keys(effectDefs); },
    isOn: function (id) { return !!effectOn[id]; },
    enable: function (id) { return setEffect(id, true); },
    disable: function (id) { return setEffect(id, false); },
    toggle: function (id) { return setEffect(id, !effectOn[id]); },
    fire: function (id, opts) {
      var def = effectDefs[id];
      if (!def || typeof def.fire !== 'function') { log('fire ' + id + ' effect=absent'); return false; }
      try { def.fire(inst, opts || {}); } catch (e) { effectError(id, 'fire', e); return false; }
      log('fire ' + id);
      return true;
    }
  };

  function setEffect(id, on) {
    if (!!effectOn[id] === !!on) return false;
    var def = effectDefs[id];
    if (!def) { effectOn[id] = !!on; log((on ? 'start ' : 'stop ') + id + ' effect=absent'); return false; }
    var fn = on ? def.start : def.stop;
    var targets = null;
    if (typeof fn === 'function') {
      try {
        var r = fn(inst);
        if (typeof r === 'number') targets = r;
        else if (isObj(r) && typeof r.targets === 'number') targets = r.targets;
      } catch (e) {
        effectError(id, on ? 'start' : 'stop', e);
        return false;
      }
    }
    effectOn[id] = !!on;
    log((on ? 'start ' : 'stop ') + id + (targets === null ? '' : ' targets=' + targets));
    if (on && targets === 0) warnLine('targets=0 ' + id);
    return true;
  }

  var setThemeImpl = null;

  var themes = {
    register: function (def) {
      if (!isObj(def) || !def.id) { console.warn('[juicy] themes.register : def.id manquant'); return themes; }
      if (!themeDefs[def.id]) themeOrder.push(def.id);
      themeDefs[def.id] = def;
      if (inst && inst.slots.nav) inst.relayout(true);
      return themes;
    },
    get: function (id) { return themeDefs[id] || null; },
    has: function (id) { return !!themeDefs[id]; },
    list: function () { return themeOrder.slice(); },
    current: function () { return inst ? inst.theme : null },
    set: function (id) {
      if (!setThemeImpl) { console.warn('[juicy] themes.set : aucune instance'); return Promise.resolve(false); }
      return setThemeImpl(id);
    }
  };

  // ------------------------------------------------------------ jetons/skin

  var DEFAULT_TOKENS = {
    colors: {
      bg: 0x0d1018, bgAlt: 0x151b28, surface: 0x1a2030, surfaceAlt: 0x222a3d,
      border: 0x323c54, text: 0xe9eef8, muted: 0x9aa4bd,
      accent: 0x6ea8fe, accentText: 0x0b0f18, danger: 0xff6b6b, success: 0x5ddc9a
    },
    fonts: {
      display: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      body: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    },
    radius: 10,
    gap: 12,
    sizes: { title: 60, tagline: 21, label: 15, meta: 16, narration: 17, nav: 15 }
  };

  function defaultSkin(t) {
    var c = t.colors;
    return {
      button: {
        fill: c.surface, fillHover: c.surfaceAlt, fillActive: c.accent,
        text: c.text, textActive: c.accentText,
        border: c.border, borderWidth: 1.5, radius: t.radius,
        padX: 16, padY: 10, minWidth: 0, fontSize: t.sizes.label, fontFamily: t.fonts.body
      },
      toggle: {
        fill: c.surface, fillHover: c.surfaceAlt, fillOn: c.surfaceAlt,
        text: c.muted, textOn: c.text,
        border: c.border, borderOn: c.accent, borderWidth: 1.5, radius: t.radius,
        padX: 14, padY: 9, minWidth: 0, fontSize: t.sizes.label, fontFamily: t.fonts.body,
        knobOff: c.border, knobOn: c.accent, trackOff: c.bgAlt, trackOn: c.accent,
        switchW: 30, switchH: 15
      },
      text: {
        title: { fill: c.text, fontFamily: t.fonts.display, fontSize: t.sizes.title, fontWeight: '700', letterSpacing: -1 },
        tagline: { fill: c.muted, fontFamily: t.fonts.body, fontSize: t.sizes.tagline },
        label: { fill: c.text, fontFamily: t.fonts.body, fontSize: t.sizes.label },
        meta: { fill: c.muted, fontFamily: t.fonts.body, fontSize: t.sizes.meta },
        narration: { fill: c.text, fontFamily: t.fonts.body, fontSize: t.sizes.narration },
        nav: { fill: c.text, fontFamily: t.fonts.body, fontSize: t.sizes.nav }
      }
    };
  }

  // ------------------------------------------------------------- composants
  //
  // `juicy.ui` minimal du noyau : button, toggle, text. Le mandat pixi.ui
  // ajoute panel/badge/card/scores/modal/cursor avec les mêmes signatures.

  function makeUI(j) {
    function style(role, over) {
      var base = j.skin.text[role] || j.skin.text.label;
      var s = merge(base, over || {});
      var st = {
        fill: s.fill, fontFamily: s.fontFamily, fontSize: s.fontSize,
        fontWeight: s.fontWeight || '400', align: s.align || 'left',
        letterSpacing: s.letterSpacing || 0
      };
      if (s.wrapWidth) { st.wordWrap = true; st.wordWrapWidth = s.wrapWidth; }
      if (s.lineHeight) st.lineHeight = s.lineHeight;
      return st;
    }

    /** text(str, { role, fill, fontSize, fontFamily, wrapWidth, align, … }) -> PIXI.Text */
    function text(str, o) {
      o = o || {};
      var t = new PIXI.Text({ text: String(str == null ? '' : str), style: style(o.role || 'label', o) });
      t.roundPixels = true;
      return t;
    }

    function pressable(node, opts) {
      node.eventMode = 'static';
      node.cursor = 'pointer';
      node.accessible = true;
      node.accessibleType = 'button';
      node.accessibleTitle = opts.accessibleTitle || opts.label || opts.id || 'action';
      node.accessibleHint = opts.accessibleHint || '';
      node.tabIndex = 0;
      var base = 1;
      function to(p, dur, ease) {
        if (j.reduced || !gsap) { node.scale.set(p.scale != null ? p.scale : node.scale.x); return; }
        gsap.to(node.scale, { x: p.scale, y: p.scale, duration: dur, ease: ease || 'power2.out', overwrite: true });
      }
      node.on('pointerover', function () { node._hover = true; node.redraw(); to({ scale: base * 1.05 }, 0.18); if (j.audio) j.audio.play('hover'); });
      node.on('pointerout', function () { node._hover = false; node._down = false; node.redraw(); to({ scale: base }, 0.25, 'elastic.out(1,0.6)'); });
      node.on('pointerdown', function () { node._down = true; node.redraw(); to({ scale: base * 0.93 }, 0.08); });
      node.on('pointerupoutside', function () { node._down = false; node.redraw(); to({ scale: base }, 0.3, 'elastic.out(1,0.5)'); });
      node.on('pointerup', function (e) {
        node._down = false;
        node.redraw();
        to({ scale: base }, 0.45, 'elastic.out(1,0.45)');
        if (typeof opts.onPress === 'function') opts.onPress(e, node);
      });
      return node;
    }

    /**
     * button({ label, width, height, minWidth, onPress, accessibleTitle, skin })
     *   -> PIXI.Container  (+ .setLabel(s), .setWidth(px), .setActive(bool),
     *                          .redraw(), .isButton === true, .labelText)
     */
    function button(opts) {
      opts = opts || {};
      var sk = merge(j.skin.button, opts.skin);
      var node = new PIXI.Container();
      var bg = new PIXI.Graphics();
      var label = text(opts.label || '', { role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily, fontWeight: '600' });
      node.addChild(bg, label);
      node.isButton = true;
      node.labelText = label;
      node._active = !!opts.active;
      node._w = opts.width || Math.max(sk.minWidth, label.width + sk.padX * 2);
      node._h = opts.height || (label.height + sk.padY * 2);

      // dessiné centré sur l'origine : l'échelle au survol part du centre et
      // getLocalBounds() décrit exactement ce qu'on voit (pas de pivot).
      node.redraw = function () {
        var fill = node._active ? sk.fillActive : ((node._down || node._hover) ? sk.fillHover : sk.fill);
        var x0 = -node._w / 2, y0 = -node._h / 2;
        bg.clear();
        bg.roundRect(x0, y0, node._w, node._h, sk.radius).fill({ color: fill });
        if (sk.borderWidth > 0) bg.roundRect(x0, y0, node._w, node._h, sk.radius).stroke({ width: sk.borderWidth, color: node._active ? sk.fillActive : sk.border, alignment: 0.5 });
        label.style.fill = node._active ? sk.textActive : sk.text;
        label.position.set(-label.width / 2, -label.height / 2);
        node.hitArea = new PIXI.Rectangle(x0, y0, node._w, node._h);
      };
      node.setLabel = function (s) { label.text = s; node.redraw(); return node; };
      node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
      node.setActive = function (v) { node._active = !!v; node.redraw(); return node; };
      node.redraw();
      return pressable(node, opts);
    }

    /**
     * toggle({ label, value, width, height, onChange, accessibleTitle, skin })
     *   -> PIXI.Container  (+ .setValue(v, silent), .value, .setWidth(px),
     *                          .redraw(), .isToggle === true, .labelText)
     */
    function toggle(opts) {
      opts = opts || {};
      var sk = merge(j.skin.toggle, opts.skin);
      var node = new PIXI.Container();
      var bg = new PIXI.Graphics();
      var sw = new PIXI.Graphics();
      var label = text(opts.label || '', { role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily });
      node.addChild(bg, sw, label);
      node.isToggle = true;
      node.labelText = label;
      node._on = !!opts.value;
      node._w = opts.width || Math.max(sk.minWidth, label.width + sk.switchW + sk.padX * 2 + 10);
      node._h = opts.height || (Math.max(label.height, sk.switchH) + sk.padY * 2);

      node.redraw = function () {
        var fill = node._on ? sk.fillOn : ((node._hover || node._down) ? sk.fillHover : sk.fill);
        var x0 = -node._w / 2, y0 = -node._h / 2;
        bg.clear();
        bg.roundRect(x0, y0, node._w, node._h, sk.radius).fill({ color: fill });
        if (sk.borderWidth > 0) bg.roundRect(x0, y0, node._w, node._h, sk.radius).stroke({ width: sk.borderWidth, color: node._on ? sk.borderOn : sk.border, alignment: 0.5 });
        var sx = x0 + sk.padX, sy = -sk.switchH / 2;
        sw.clear();
        sw.roundRect(sx, sy, sk.switchW, sk.switchH, sk.switchH / 2).fill({ color: node._on ? sk.trackOn : sk.trackOff, alpha: node._on ? 0.45 : 1 });
        var r = sk.switchH / 2 - 1.5;
        var kx = node._on ? sx + sk.switchW - r - 2 : sx + r + 2;
        sw.circle(kx, 0, r).fill({ color: node._on ? sk.knobOn : sk.knobOff });
        label.style.fill = node._on ? sk.textOn : sk.text;
        label.position.set(sx + sk.switchW + 10, -label.height / 2);
        node.hitArea = new PIXI.Rectangle(x0, y0, node._w, node._h);
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
      node.redraw();
      return pressable(node, {
        label: opts.label, accessibleTitle: opts.accessibleTitle,
        onPress: function () { node.setValue(!node._on); }
      });
    }

    return { text: text, button: button, toggle: toggle, style: style };
  }

  // ------------------------------------------------------------------- son
  //
  // Minimal et paresseux : Tone.js peut arriver après le noyau (`defer`), et
  // le contexte audio n'existe qu'après un geste de l'utilisateur.

  function makeAudio() {
    var A = { enabled: false, level: 0, ready: false };
    var synth = null, analyser = null;
    var NOTES = {
      hover: 'C6', select: 'E5', toggleOn: 'G5', toggleOff: 'C5', action: 'A5',
      theme: 'D5', combo: 'B5', alert: 'F3'
    };
    function ensure() {
      if (A.ready) return true;
      if (!global.Tone) return false;
      try {
        analyser = new global.Tone.Analyser('waveform', 64);
        synth = new global.Tone.PolySynth(global.Tone.Synth, {
          volume: -16, envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 }
        });
        synth.connect(analyser);
        analyser.toDestination();
        A.ready = true;
      } catch (e) { A.ready = false; }
      return A.ready;
    }
    A.start = function () {
      if (!global.Tone) return Promise.resolve(false);
      return Promise.resolve(global.Tone.start()).then(function () {
        A.enabled = ensure();
        log('audio ' + (A.enabled ? 'on' : 'indisponible'));
        return A.enabled;
      }).catch(function () { return false; });
    };
    A.play = function (name) {
      if (!A.enabled || !ensure()) return false;
      try {
        if (global.Tone.getContext().state !== 'running') return false;
        synth.triggerAttackRelease(NOTES[name] || NOTES.select, 0.07);
        return true;
      } catch (e) { return false; }
    };
    A.sample = function () {
      if (!A.enabled || !analyser) { A.level = 0; return 0; }
      try {
        var d = analyser.getValue(), s = 0;
        for (var i = 0; i < d.length; i++) s += d[i] * d[i];
        A.level = clamp(Math.sqrt(s / d.length) * 3, 0, 1);
      } catch (e) { A.level = 0; }
      return A.level;
    };
    return A;
  }

  // ---------------------------------------------------------------- polices

  function loadFonts(list) {
    if (!list || !list.length || !global.document || !document.fonts) return Promise.resolve([]);
    var fams = list.map(function (f) { return 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':wght@400;600;700'; }).join('&');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + fams + '&display=swap';
    document.head.appendChild(link);
    var wait = Promise.all(list.map(function (f) {
      return document.fonts.load('16px "' + f + '"').catch(function () { return []; });
    }));
    var timeout = new Promise(function (res) { setTimeout(res, 2500); });
    return Promise.race([wait, timeout]).then(function () {
      return list.filter(function (f) { try { return document.fonts.check('16px "' + f + '"'); } catch (e) { return false; } });
    });
  }

  // --------------------------------------------------------- mise en page

  /** Choisit le nombre de colonnes qui maximise l'échelle tenable dans la boîte. */
  function bestColumns(n, cw, ch, gap, box) {
    var best = 1, bestS = -Infinity;
    for (var c = 1; c <= n; c++) {
      var r = Math.ceil(n / c);
      var gw = c * cw + (c - 1) * gap;
      var gh = r * ch + (r - 1) * gap;
      var s = Math.min(box.width / gw, box.height / gh);
      if (s > bestS + 1e-6) { bestS = s; best = c; }
    }
    return best;
  }

  function arrange(slot, box) {
    var items = slot.items || [];
    var n = items.length;
    if (!n) return;
    var gap = box.gap != null ? box.gap : (inst ? inst.tokens.gap : 12);
    if (n === 1) { items[0].position.set(0, 0); return; }
    var cw = 0, ch = 0;
    items.forEach(function (it) { var b = it.getLocalBounds(); cw = Math.max(cw, b.width); ch = Math.max(ch, b.height); });
    var cols = box.columns || bestColumns(n, cw, ch, gap, box);
    items.forEach(function (it, i) {
      var c = i % cols, r = Math.floor(i / cols);
      var b = it.getLocalBounds();
      var alignRow = box.itemAlign === 'left' ? 0 : (cw - b.width) / 2;
      it.position.set(c * (cw + gap) + alignRow - b.x, r * (ch + gap) + (ch - b.height) / 2 - b.y);
    });
  }

  /**
   * Place un emplacement dans la boîte donnée par le thème, à l'échelle la
   * plus grande qui tient (jamais au-dessus de 1 sauf `box.scaleUp`). C'est
   * ce qui rend « tout tient dans la fenêtre » vrai par construction.
   */
  function applySlotBox(slot, box) {
    arrange(slot, box);
    var lb = slot.getLocalBounds();
    var s = 1;
    if (lb.width > 0 && lb.height > 0) s = Math.min(box.width / lb.width, box.height / lb.height);
    if (!box.scaleUp) s = Math.min(1, s);
    if (!isFinite(s) || s <= 0) s = 1;
    slot.scale.set(s);
    var w = lb.width * s, h = lb.height * s;
    var x = box.x + (box.width - w) / 2;
    if (box.align === 'left') x = box.x;
    else if (box.align === 'right') x = box.x + box.width - w;
    var y = box.y + (box.height - h) / 2;
    if (box.valign === 'top') y = box.y;
    else if (box.valign === 'bottom') y = box.y + box.height - h;
    slot.position.set(x - lb.x * s, y - lb.y * s);
    slot.box = box;
    slot.rect = { x: x, y: y, width: w, height: h };
  }

  // ------------------------------------------------------ extension de l'UI
  //
  // `applyTheme` reconstruit `juicy.ui` à chaque thème : une affectation de
  // `juicy.ui` après `create()` serait perdue au premier changement de thème.
  // `Juicy.ui.extend(map)` enregistre des fabriques durables, fusionnées
  // après celles du noyau et avant le `ui` du thème actif — un thème garde
  // donc le dernier mot sur une fabrique qu'il redéfinit.

  var uiExtras = {};

  var uiRegistry = {
    extend: function (map) {
      if (!isObj(map)) { console.warn('[juicy] ui.extend : objet attendu'); return uiRegistry; }
      Object.keys(map).forEach(function (k) {
        uiExtras[k] = map[k];
        uiRegistry[k] = map[k];
      });
      if (inst) inst.ui = composeUI(inst);
      return uiRegistry;
    }
  };

  /** Fabriques du noyau, puis celles de `ui.extend`, puis celles du thème. */
  function composeUI(j) {
    return merge(merge(makeUI(j), uiExtras), j.theme && j.theme.ui);
  }

  // --------------------------------------------------------------- création

  var Juicy = {
    version: '2.0.0-pixi',
    effects: effects,
    themes: themes,
    ui: uiRegistry,
    get instance() { return inst; },
    create: createInstance
  };

  function createInstance(options) {
    var opts = options || {};
    var params = new URLSearchParams(global.location ? global.location.search : '');
    LOG = params.has('juicy-log') ? true : !!opts.log;
    T0 = global.performance ? performance.now() : Date.now();

    var content = merge({}, opts.content || {});
    var wantedTheme = params.get('juicy-theme') || opts.theme || themeOrder[0] || 'plain';

    var reduced = false;
    try { reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }

    var app = new PIXI.Application();
    var handlers = {};
    var slots = {};
    var state = { counter: 0, combo: 0 };
    var cam = { x: 0, y: 0, zoom: 1, rotation: 0, shake: 0, sx: 0, sy: 0 };
    var lastAction = -1e9;
    var COMBO_MS = 1400;
    var transitioning = false;
    var pixelate = null;
    var fpsFrames = 0, fpsSince = 0, frameT0 = 0, frameMs = 0;

    var juicy = {
      version: Juicy.version,
      app: app,
      canvas: null,
      layers: null,
      camera: null,
      slots: slots,
      state: state,
      errors: effectErrors,
      content: content,
      theme: null,
      tokens: DEFAULT_TOKENS,
      skin: defaultSkin(DEFAULT_TOKENS),
      themes: themes,
      effects: effects,
      ui: null,
      audio: makeAudio(),
      reduced: reduced,
      log: log,
      get logEnabled() { return LOG; },
      get screen() { return { width: app.screen.width, height: app.screen.height }; },
      on: on, off: off, emit: emit,
      relayout: function (rebuild, rebuildScene) { relayout(rebuild !== false, !!rebuildScene); return juicy; },
      setTheme: function (id) { return setTheme(id); }
    };
    inst = juicy;
    setThemeImpl = function (id) { return setTheme(id); };

    // -- événements -------------------------------------------------------
    function on(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
      return function () { off(name, fn); };
    }
    function off(name, fn) {
      var l = handlers[name];
      if (!l) return juicy;
      var i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
      return juicy;
    }
    function emit(name, payload) {
      (handlers[name] || []).slice().forEach(function (fn) {
        try { fn(payload, juicy); } catch (e) { console.warn('[juicy] écouteur ' + name + ' :', e); }
      });
    }

    // -- caméra -----------------------------------------------------------
    function applyCamera() {
      var w = app.screen.width, h = app.screen.height;
      var world = juicy.layers.world;
      world.pivot.set(w / 2, h / 2);
      world.position.set(w / 2 + cam.x + cam.sx, h / 2 + cam.y + cam.sy);
      world.scale.set(cam.zoom);
      world.rotation = cam.rotation;
    }

    function camTween(to, o) {
      o = o || {};
      if (reduced || !gsap || o.duration === 0) {
        Object.keys(to).forEach(function (k) { cam[k] = to[k]; });
        applyCamera();
        return null;
      }
      var vars = { duration: (o.duration != null ? o.duration : 600) / 1000, ease: o.ease || 'power3.out', onUpdate: applyCamera, overwrite: 'auto' };
      Object.keys(to).forEach(function (k) { vars[k] = to[k]; });
      return gsap.to(cam, vars);
    }

    var camera = {
      /** pan(x, y, { duration, ease }) — décalage en pixels écran. */
      pan: function (x, y, o) { log('camera pan ' + Math.round(x) + ',' + Math.round(y)); return camTween({ x: x || 0, y: y || 0 }, o); },
      /** zoom(k, { duration, ease }) — 1 = taille naturelle. */
      zoom: function (k, o) { log('camera zoom ' + k); return camTween({ zoom: k || 1 }, o); },
      /** rotate(a, { duration, ease }) — radians. */
      rotate: function (a, o) { log('camera rotate ' + (a || 0).toFixed(3)); return camTween({ rotation: a || 0 }, o); },
      /** shake(strength, ms) — secousse amortie, aplatie si reduced-motion. */
      shake: function (strength, ms) {
        strength = strength == null ? 8 : strength;
        ms = ms == null ? 400 : ms;
        log('shake strength=' + strength + ' ms=' + ms);
        if (reduced) return null;
        cam.shake = strength;
        if (!gsap) { cam.shake = 0; return null; }
        return gsap.to(cam, { shake: 0, duration: ms / 1000, ease: 'power2.out', overwrite: true });
      },
      reset: function (o) { log('camera reset'); return camTween({ x: 0, y: 0, zoom: 1, rotation: 0 }, o); },
      get state() { return { x: cam.x, y: cam.y, zoom: cam.zoom, rotation: cam.rotation }; }
    };

    // -- emplacements -----------------------------------------------------
    function slotWanted(name) {
      switch (name) {
        case 'title': return content.title != null;
        case 'tagline': return content.tagline != null;
        case 'nav': return !!content.nav;
        case 'controls': return !!(content.controls && content.controls.length);
        case 'actions': return !!(content.actions && content.actions.length);
        case 'scene': return content.scene != null;
        case 'narration': return !!(content.narration && content.narration.length);
        case 'meta': return !!content.meta;
        default: return false;
      }
    }

    // ordre de création = ordre d'empilement dans `world` : la scène derrière
    var SLOT_NAMES = ['scene', 'title', 'tagline', 'nav', 'controls', 'actions', 'narration', 'meta'];

    function makeSlots() {
      SLOT_NAMES.forEach(function (name) {
        if (!slotWanted(name)) return;
        var c = new PIXI.Container();
        c.label = 'slot:' + name;
        c.items = [];
        slots[name] = c;
        juicy.layers.world.addChild(c);
      });
    }

    function uniformWidth(items) {
      var w = 0;
      items.forEach(function (it) { w = Math.max(w, it._w || it.getLocalBounds().width); });
      items.forEach(function (it) { if (it.setWidth) it.setWidth(w); });
      return w;
    }

    function runToggle(c, on) {
      if (c.effect) {
        if (c.effect === 'sound' && !effects.has('sound')) {
          if (on) juicy.audio.start(); else juicy.audio.enabled = false;
        }
        setEffect(c.effect, on);
      }
      juicy.audio.play(on ? 'toggleOn' : 'toggleOff');
      log('toggle ' + c.id + ' ' + (on ? 'on' : 'off') + (c.effect ? ' effect=' + c.effect : ''));
      emit('toggle', { id: c.id, effect: c.effect || null, on: on });
    }

    function runAction(a) {
      var now = global.performance ? performance.now() : Date.now();
      state.counter += 1;
      state.combo = (now - lastAction < COMBO_MS) ? state.combo + 1 : 1;
      lastAction = now;
      updateMeta();
      juicy.audio.play(state.combo > 2 ? 'combo' : 'action');
      if (a.burst) effects.fire(a.burst, a.opts || {});
      log('action ' + a.id + (a.burst ? ' burst=' + a.burst : '') + ' counter=' + state.counter + ' combo=' + state.combo);
      emit('action', { id: a.id, burst: a.burst || null, counter: state.counter, combo: state.combo });
    }

    function metaLabel() {
      if (typeof content.meta === 'function') return content.meta(juicy, state);
      if (juicy.theme && typeof juicy.theme.meta === 'function') return juicy.theme.meta(juicy, state);
      return 'Compteur : ' + state.counter + ' · Combo : ' + state.combo;
    }

    function updateMeta() {
      var s = slots.meta;
      if (!s || !s.items[0]) return;
      s.items[0].text = metaLabel();
      if (s.box) applySlotBox(s, s.box);
    }

    function buildSlotItems(plan, rebuildScene) {
      Object.keys(slots).forEach(function (name) {
        if (name === 'scene' && !rebuildScene) return;
        var slot = slots[name];
        clearContainer(slot);
        slot.items = [];
        var box = plan[name] || { x: 0, y: 0, width: app.screen.width, height: app.screen.height };
        var items = [];

        if (name === 'title') {
          items.push(juicy.ui.text(content.title, { role: 'title', wrapWidth: box.width }));
        } else if (name === 'tagline') {
          items.push(juicy.ui.text(content.tagline, { role: 'tagline', wrapWidth: box.width }));
        } else if (name === 'nav') {
          var ids = Array.isArray(content.nav) ? content.nav : themes.list();
          ids.forEach(function (id) {
            var def = themeDefs[id];
            if (!def) return;
            items.push(juicy.ui.button({
              label: def.name || id,
              active: juicy.theme && juicy.theme.id === id,
              accessibleTitle: 'Thème ' + (def.name || id),
              onPress: function () { setTheme(id); }
            }));
          });
        } else if (name === 'controls') {
          content.controls.forEach(function (c) {
            items.push(juicy.ui.toggle({
              label: c.label || c.id,
              value: c.effect ? effects.isOn(c.effect) : false,
              accessibleTitle: c.label || c.id,
              onChange: function (on) { runToggle(c, on); }
            }));
          });
          uniformWidth(items);
        } else if (name === 'actions') {
          content.actions.forEach(function (a) {
            items.push(juicy.ui.button({
              label: a.label || a.id,
              accessibleTitle: a.label || a.id,
              onPress: function () { runAction(a); }
            }));
          });
          uniformWidth(items);
        } else if (name === 'narration') {
          content.narration.forEach(function (line) {
            items.push(juicy.ui.text(line, { role: 'narration', wrapWidth: box.width }));
          });
        } else if (name === 'meta') {
          items.push(juicy.ui.text(metaLabel(), { role: 'meta' }));
        } else if (name === 'scene') {
          var node = null;
          try {
            if (typeof content.scene === 'function') node = content.scene(juicy, rectOf(box));
            else node = (juicy.theme.decor || plainTheme.decor)(juicy, rectOf(box));
          } catch (e) { console.warn('[juicy] scène :', e); node = null; }
          if (node) items.push(node);
        }

        items.forEach(function (it) { slot.addChild(it); });
        slot.items = items;
      });
    }

    // -- thèmes -----------------------------------------------------------
    function applyTheme(def) {
      juicy.theme = def;
      juicy.tokens = merge(DEFAULT_TOKENS, def.tokens);
      juicy.skin = merge(defaultSkin(juicy.tokens), def.skin);
      juicy.ui = composeUI(juicy);
      try { app.renderer.background.color = juicy.tokens.colors.bg; } catch (e) { /* ignore */ }
      relayout(true, true);
    }

    function getPixelate() {
      if (pixelate) return pixelate;
      if (!PIXI.filters || !PIXI.filters.PixelateFilter) return null;
      pixelate = new PIXI.filters.PixelateFilter(1);
      return pixelate;
    }

    function pixelTween(from, to, ms) {
      var f = getPixelate();
      if (!f || !gsap || reduced) { if (f) app.stage.filters = []; return Promise.resolve(); }
      app.stage.filters = [f];
      var p = { v: from };
      f.size = from;
      return new Promise(function (res) {
        gsap.to(p, {
          v: to, duration: ms / 1000, ease: 'power2.inOut',
          onUpdate: function () { f.size = Math.max(1, p.v); },
          onComplete: function () { f.size = Math.max(1, to); res(); }
        });
      });
    }

    function defaultOut() { return pixelTween(1, 28, 300); }
    function defaultIn() {
      return pixelTween(28, 1, 340).then(function () { app.stage.filters = []; });
    }

    function setTheme(id) {
      var def = themeDefs[id];
      if (!def) { console.warn('[juicy] thème inconnu : ' + id); return Promise.resolve(false); }
      if (transitioning) return Promise.resolve(false);
      transitioning = true;
      var prev = juicy.theme ? juicy.theme.id : null;
      var out = (juicy.theme && juicy.theme.transition && juicy.theme.transition.out) || defaultOut;
      var inn = (def.transition && def.transition['in']) || defaultIn;
      log('theme ' + prev + ' -> ' + id);
      return Promise.resolve()
        .then(function () { return out(juicy); })
        .catch(function (e) { console.warn('[juicy] transition out :', e); })
        .then(function () { applyTheme(def); animateSlotsIn(); })
        .then(function () { return inn(juicy); })
        .catch(function (e) { console.warn('[juicy] transition in :', e); })
        .then(function () {
          try { app.stage.filters = []; } catch (e) { /* ignore */ }
          transitioning = false;
          juicy.audio.play('theme');
          log('theme ' + id + ' prêt');
          emit('theme', { id: id, previous: prev });
          return true;
        });
    }

    function animateSlotsIn() {
      if (reduced || !gsap) return;
      var list = Object.keys(slots).map(function (k) { return slots[k]; });
      list.forEach(function (s, i) {
        var y = s.position.y;
        s.alpha = 0;
        gsap.fromTo(s, { alpha: 0 }, { alpha: 1, duration: 0.35, delay: i * 0.035, ease: 'power2.out', overwrite: true });
        gsap.fromTo(s.position, { y: y + 16 }, { y: y, duration: 0.45, delay: i * 0.035, ease: 'power3.out', overwrite: true });
      });
    }

    // -- cycle de mise en page --------------------------------------------
    function relayout(rebuild, rebuildScene) {
      if (!juicy.theme) return;
      var w = app.screen.width, h = app.screen.height;
      var layoutFn = juicy.theme.layout || plainTheme.layout;
      var plan = {};
      try { plan = layoutFn(juicy, w, h) || {}; } catch (e) { console.warn('[juicy] layout du thème :', e); plan = {}; }
      Object.keys(slots).forEach(function (k) {
        if (!plan[k]) plan[k] = fallbackBox(k, w, h);
      });
      if (rebuild) buildSlotItems(plan, !!rebuildScene);
      Object.keys(slots).forEach(function (k) { applySlotBox(slots[k], plan[k]); });
      paint(w, h, plan);
      applyCamera();
      emit('layout', { width: w, height: h, plan: plan });
      logFit(w, h);
    }

    function fallbackBox(name, w, h) {
      warnLine('emplacement ' + name + ' sans boîte dans le plan du thème');
      return { x: w * 0.1, y: h * 0.1, width: w * 0.8, height: h * 0.8 };
    }

    function paint(w, h, plan) {
      var bg = juicy.layers.background;
      clearContainer(bg);
      var fn = juicy.theme.paint || plainTheme.paint;
      if (typeof fn !== 'function') return;
      try { fn(juicy, w, h, plan); } catch (e) { console.warn('[juicy] paint du thème :', e); }
    }

    function logFit(w, h) {
      if (!LOG) return;
      var bad = [];
      var parts = [];
      Object.keys(slots).forEach(function (k) {
        var r = slots[k].rect;
        if (!r) return;
        parts.push(k + ' ' + fmt(r));
        if (r.x < -1 || r.y < -1 || r.x + r.width > w + 1 || r.y + r.height > h + 1) {
          bad.push('overflow ' + k + ' ' + fmt(r) + ' / ' + w + 'x' + h);
        }
      });
      if (bad.length) bad.forEach(warnLine);
      else log('fit ok ' + w + 'x' + h + ' · ' + parts.join(' · '));
    }

    // -- boucle -----------------------------------------------------------
    function tick(ticker) {
      var dt = ticker.deltaMS;
      if (cam.shake > 0.01) {
        cam.sx = (Math.random() * 2 - 1) * cam.shake;
        cam.sy = (Math.random() * 2 - 1) * cam.shake;
        applyCamera();
      } else if (cam.sx !== 0 || cam.sy !== 0) {
        cam.sx = 0; cam.sy = 0; applyCamera();
      }
      Object.keys(effectOn).forEach(function (id) {
        if (!effectOn[id]) return;
        var def = effectDefs[id];
        if (!def || typeof def.update !== 'function') return;
        try { def.update(juicy, dt); } catch (e) { effectError(id, 'update', e); effectOn[id] = false; }
      });
      if (juicy.theme && typeof juicy.theme.update === 'function') {
        try { juicy.theme.update(juicy, dt); } catch (e) { console.warn('[juicy] update du thème :', e); }
      }
      if (juicy.audio.enabled) juicy.audio.sample();
      if (LOG) {
        fpsFrames++;
        fpsSince += dt;
        if (fpsSince >= 5000) {
          log('fps=' + Math.round(fpsFrames / (fpsSince / 1000)) +
            ' frame=' + (frameMs / Math.max(1, fpsFrames)).toFixed(2) + 'ms');
          fpsFrames = 0; fpsSince = 0; frameMs = 0;
        }
      }
    }

    // Coût processeur d'une image (mises a jour + rendu) : mesuré entre une
    // écoute prioritaire (avant tout) et une écoute utilitaire (après le
    // rendu de l'application). Le rythme des images est imposé par le
    // navigateur ; `frame=` dit ce que la page, elle, consomme.
    function frameStart() { frameT0 = performance.now(); }
    function frameEnd() { frameMs += performance.now() - frameT0; }

    // -- démarrage --------------------------------------------------------
    var resizeTimer = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { resizeTimer = null; relayout(true, false); }, 120);
    }

    return loadFonts(opts.fonts).then(function (loaded) {
      return app.init({
        resizeTo: global.window,
        autoDensity: true,
        resolution: global.devicePixelRatio || 1,
        antialias: true,
        preference: 'webgl',
        background: DEFAULT_TOKENS.colors.bg,
        preserveDrawingBuffer: false
      }).then(function () { return loaded; });
    }).then(function (loaded) {
      juicy.canvas = app.canvas;
      app.canvas.setAttribute('aria-label', content.title || 'Juicy');
      document.body.appendChild(app.canvas);

      // `scene` groupe tout ce qui se projette : un effet qui remplace l'image
      // (perspective, post-traitement en RenderTexture) rend un seul
      // conteneur au lieu d'en composer deux. L'ordre d'empilement est
      // inchangé : background et world d'abord, puis ui, overlay, cursor.
      var layers = {
        scene: new PIXI.Container(),
        background: new PIXI.Container(),
        world: new PIXI.Container(),
        ui: new PIXI.Container(),
        overlay: new PIXI.Container(),
        cursor: new PIXI.Container()
      };
      Object.keys(layers).forEach(function (k) { layers[k].label = k; });
      layers.scene.addChild(layers.background, layers.world);
      app.stage.addChild(layers.scene, layers.ui, layers.overlay, layers.cursor);
      // `overlay` reste traversé par le système d'événements : une modale ou
      // un composant posé là reçoit ses clics sans que personne n'ait à
      // basculer la couche. Ses enfants décoratifs, non interactifs, ne
      // deviennent pas des cibles pour autant.
      layers.overlay.eventMode = 'passive';
      layers.cursor.eventMode = 'none';
      juicy.layers = layers;
      juicy.camera = camera;
      juicy.ui = composeUI(juicy);

      try {
        if (app.renderer.accessibility && app.renderer.accessibility.init) { /* activé au Tab */ }
      } catch (e) { /* ignore */ }

      makeSlots();
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;

      var themeId = themeDefs[wantedTheme] ? wantedTheme : (themeOrder[0] || 'plain');
      if (themeId !== wantedTheme) console.warn('[juicy] thème « ' + wantedTheme + ' » inconnu, repli sur ' + themeId);
      applyTheme(themeDefs[themeId]);
      animateSlotsIn();

      app.ticker.add(tick);
      if (LOG) {
        app.ticker.add(frameStart, null, PIXI.UPDATE_PRIORITY.HIGH);
        app.ticker.add(frameEnd, null, PIXI.UPDATE_PRIORITY.UTILITY);
      }
      global.addEventListener('resize', onResize);
      if (app.renderer.on) app.renderer.on('resize', onResize);

      // premier geste : démarre le contexte audio si une page l'a demandé
      app.stage.once('pointerdown', function () { if (juicy.audio.enabled) juicy.audio.start(); });

      log('ready theme=' + themeId + ' renderer=' + app.renderer.name +
        ' screen=' + app.screen.width + 'x' + app.screen.height +
        ' dpr=' + (global.devicePixelRatio || 1) +
        ' slots=' + Object.keys(slots).join(',') +
        ' fonts=' + (loaded && loaded.length ? loaded.join('|') : 'repli') +
        (reduced ? ' reduced-motion' : ''));
      return juicy;
    });
  }

  // ====================================================================
  // Thème `plain` — sobre, intégré au noyau, sert de défaut et de repli
  // pour tout hook qu'un autre thème ne fournit pas.
  // ====================================================================

  var decorState = { ring: null, core: null, dots: [], t: 0, r: 0 };

  var plainTheme = {
    id: 'plain',
    name: 'Sobre',
    tokens: {
      colors: {
        bg: 0x0d1018, bgAlt: 0x161d2c, surface: 0x1a2132, surfaceAlt: 0x242d43,
        border: 0x323d57, text: 0xeaf0fb, muted: 0x98a3bd, accent: 0x6ea8fe, accentText: 0x0a0e17
      },
      radius: 12,
      gap: 12
    },

    layout: function (j, w, h) {
      var has = function (k) { return !!j.slots[k]; };
      var narrow = w < 900;
      var pad = narrow ? 16 : 40;
      var plan = {};
      var titleH = narrow ? 42 : 66;
      var tagH = narrow ? 22 : 30;
      var navH = narrow ? 34 : 44;
      var metaH = narrow ? 20 : 28;

      if (!narrow) {
        var headW = w * 0.44;
        if (has('title')) plan.title = { x: pad, y: pad, width: headW, height: titleH, align: 'left', valign: 'top' };
        if (has('tagline')) plan.tagline = { x: pad, y: pad + (has('title') ? titleH + 6 : 0), width: headW, height: tagH, align: 'left', valign: 'top' };
        var rightW = w * 0.36;
        if (has('nav')) plan.nav = { x: w - pad - rightW, y: pad, width: rightW, height: navH, align: 'right', valign: 'top' };
        if (has('meta')) plan.meta = { x: w - pad - rightW, y: pad + (has('nav') ? navH + 10 : 0), width: rightW, height: metaH, align: 'right', valign: 'top' };

        var headBottom = pad + Math.max(
          (has('title') ? titleH : 0) + (has('tagline') ? tagH + 6 : 0),
          (has('nav') ? navH : 0) + (has('meta') ? metaH + 10 : 0)
        ) + 26;
        var bottom = h - pad;
        var colW = clamp(w * 0.21, 200, 300);
        var left = pad, right = w - pad;
        if (has('controls')) { plan.controls = { x: pad, y: headBottom, width: colW, height: bottom - headBottom, columns: 1, valign: 'top' }; left = pad + colW + 28; }
        if (has('actions')) { plan.actions = { x: w - pad - colW, y: headBottom, width: colW, height: bottom - headBottom, columns: 1, valign: 'top' }; right = w - pad - colW - 28; }
        var narrH = has('narration') ? clamp(h * 0.11, 64, 110) : 0;
        if (has('scene')) plan.scene = { x: left, y: headBottom, width: right - left, height: bottom - headBottom - (narrH ? narrH + 18 : 0) };
        if (has('narration')) plan.narration = { x: left, y: bottom - narrH, width: right - left, height: narrH, columns: 1 };
        return plan;
      }

      // écran étroit : une seule colonne, tout empilé, rien ne défile
      var gap = 10;
      var fixed = 0;
      if (has('title')) fixed += titleH + gap;
      if (has('tagline')) fixed += tagH + gap;
      if (has('nav')) fixed += navH + gap;
      if (has('meta')) fixed += metaH + gap;
      var narrH2 = has('narration') ? 54 : 0;
      if (has('narration')) fixed += narrH2 + gap;
      var flexKeys = [];
      if (has('scene')) flexKeys.push(['scene', 0.34]);
      if (has('controls')) flexKeys.push(['controls', 0.40]);
      if (has('actions')) flexKeys.push(['actions', 0.26]);
      var total = flexKeys.reduce(function (s, e) { return s + e[1]; }, 0) || 1;
      var rest = Math.max(0, h - pad * 2 - fixed - flexKeys.length * gap);
      var y = pad;
      var cw = w - pad * 2;
      function put(k, hh, extra) {
        plan[k] = merge({ x: pad, y: y, width: cw, height: hh }, extra || {});
        y += hh + gap;
      }
      if (has('title')) put('title', titleH);
      if (has('tagline')) put('tagline', tagH);
      if (has('nav')) put('nav', navH);
      flexKeys.forEach(function (e, i) {
        var hh = rest * (e[1] / total);
        if (e[0] === 'scene') put('scene', hh);
        else if (e[0] === 'controls') { put('controls', hh); }
        else put('actions', hh);
        if (i === 0 && has('narration')) put('narration', narrH2, { columns: 1 });
      });
      if (!has('scene') && !has('controls') && !has('actions') && has('narration')) put('narration', narrH2, { columns: 1 });
      if (has('meta')) put('meta', metaH);
      return plan;
    },

    paint: function (j, w, h, plan) {
      var c = j.tokens.colors;
      var g = new PIXI.Graphics();
      // dégradé vertical en bandes (pas de FillGradient : API mouvante)
      var bands = 18;
      for (var i = 0; i < bands; i++) {
        var t = i / (bands - 1);
        g.rect(0, (h / bands) * i - 1, w, h / bands + 2)
          .fill({ color: mixColor(c.bgAlt, c.bg, t), alpha: 1 });
      }
      // trame de points
      var step = w < 900 ? 34 : 46;
      for (var x = step / 2; x < w; x += step) {
        for (var y = step / 2; y < h; y += step) {
          g.circle(x, y, 1).fill({ color: c.border, alpha: 0.5 });
        }
      }
      j.layers.background.addChild(g);

      // chrome derrière les emplacements qui en méritent un
      var chrome = new PIXI.Graphics();
      ['controls', 'actions', 'scene', 'narration'].forEach(function (k) {
        var b = plan[k];
        if (!b || !j.slots[k]) return;
        var pd = 10;
        chrome.roundRect(b.x - pd, b.y - pd, b.width + pd * 2, b.height + pd * 2, j.tokens.radius + 4)
          .fill({ color: c.surface, alpha: k === 'scene' ? 0.35 : 0.55 })
          .stroke({ width: 1, color: c.border, alpha: 0.8 });
      });
      j.layers.background.addChild(chrome);
    },

    /** decor(juicy, frame) -> Container : anneau qui tourne + cœur qui respire. */
    decor: function (j, frame) {
      var c = j.tokens.colors;
      var root = new PIXI.Container();
      var R = Math.max(40, Math.min(frame.width, frame.height) * 0.42);

      var ring = new PIXI.Container();
      var n = 44;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        var d = new PIXI.Graphics()
          .circle(0, 0, i % 4 === 0 ? 4 : 2)
          .fill({ color: i % 4 === 0 ? c.accent : c.muted, alpha: i % 4 === 0 ? 0.95 : 0.55 });
        d.position.set(Math.cos(a) * R, Math.sin(a) * R);
        ring.addChild(d);
      }
      var inner = new PIXI.Graphics()
        .circle(0, 0, R * 0.62).stroke({ width: 1.5, color: c.border, alpha: 0.9 })
        .circle(0, 0, R * 0.9).stroke({ width: 1, color: c.border, alpha: 0.5 });
      var core = new PIXI.Graphics()
        .circle(0, 0, R * 0.22).fill({ color: c.accent, alpha: 0.9 })
        .circle(0, 0, R * 0.34).stroke({ width: 2, color: c.accent, alpha: 0.4 });
      root.addChild(inner, ring, core);
      // une boîte invisible fixe la taille naturelle du décor
      var frameG = new PIXI.Graphics().rect(-R * 1.05, -R * 1.05, R * 2.1, R * 2.1).fill({ color: c.bg, alpha: 0 });
      root.addChildAt(frameG, 0);

      decorState.ring = ring;
      decorState.core = core;
      decorState.t = 0;
      return root;
    },

    update: function (j, dt) {
      if (!decorState.ring || decorState.ring.destroyed) return;
      decorState.t += dt;
      var speed = j.reduced ? 0 : 1;
      decorState.ring.rotation += 0.00025 * dt * speed;
      var p = 1 + (j.reduced ? 0 : Math.sin(decorState.t / 620) * 0.09 + j.audio.level * 0.25);
      decorState.core.scale.set(p);
    }
  };

  function mixColor(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }

  themes.register(plainTheme);

  global.Juicy = Juicy;
})(window);
