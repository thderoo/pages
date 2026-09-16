/*
 * ui.js — composants d'interface de la bibliothèque Juicy (PixiJS 8).
 * Chargé après `lib/juicy.js` et avant les thèmes.
 *
 * Les composants sont des objets physiques : ils s'écrasent, s'enfoncent,
 * reviennent par ressort, gardent leur inertie. Rien n'est un rectangle qui
 * change de couleur.
 *
 *   juicy.ui.button / toggle / text / style   (mêmes signatures que le noyau,
 *                                              remplacées ici)
 *   juicy.ui.panel / badge / card / scores / modal / cursor
 *
 * Installation : `Juicy.ui.extend(UI)` en bas de fichier. Le noyau
 * reconstruit `juicy.ui` à chaque changement de thème et y refusionne les
 * fabriques étendues, avant celles du thème actif — qui restent prioritaires.
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  var Juicy = global.Juicy;
  if (!PIXI || !Juicy) { console.warn('[juicy] ui.js chargé sans le noyau'); return; }
  var gsap = global.gsap || null;

  // ------------------------------------------------------------------ utils

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  function merge(base, over) {
    var out = {};
    Object.keys(base || {}).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      out[k] = (isObj(base && base[k]) && isObj(over[k])) ? merge(base[k], over[k]) : over[k];
    });
    return out;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mix(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
  }

  function now() { return global.performance ? performance.now() : Date.now(); }
  function J() { return Juicy.instance; }
  /** true quand il ne faut pas animer (reduced-motion ou GSAP absent). */
  function flat() { var j = J(); return !gsap || !!(j && j.reduced); }
  function kill(t) { if (gsap && t) { try { gsap.killTweensOf(t); } catch (e) { /* ignore */ } } }

  /**
   * Enchaîne des poses sur un conteneur : { sx, sy, y, d, e }.
   * Sans GSAP (ou en reduced-motion), la dernière pose est appliquée sèchement.
   */
  function motion(node, steps) {
    if (flat()) {
      var s = steps[steps.length - 1];
      node.scale.set(s.sx == null ? node.scale.x : s.sx, s.sy == null ? node.scale.y : s.sy);
      if (s.y != null) node.position.y = s.y;
      return null;
    }
    kill(node.scale); kill(node.position);
    var t = gsap.timeline();
    steps.forEach(function (st) {
      t.to(node.scale, { x: st.sx, y: st.sy, duration: st.d, ease: st.e || 'power2.out' });
      if (st.y != null) t.to(node.position, { y: st.y, duration: st.d, ease: st.e || 'power2.out' }, '<');
    });
    return t;
  }

  /** Tween d'un scalaire avec rappel par image ; sec si pas d'animation. */
  function ramp(from, to, ms, ease, onUpdate, onDone) {
    if (flat()) { onUpdate(to); if (onDone) onDone(); return null; }
    var p = { v: from };
    return gsap.to(p, {
      v: to, duration: ms / 1000, ease: ease || 'power2.out', overwrite: true,
      onUpdate: function () { onUpdate(p.v); },
      onComplete: function () { onUpdate(to); if (onDone) onDone(); }
    });
  }

  /** Se redessine au changement de thème, et se désabonne à la destruction. */
  function followTheme(node, fn) {
    var j = J();
    if (!j) return;
    var off = j.on('theme', function () {
      if (node.destroyed) { off(); return; }
      try { fn(); } catch (e) { console.warn('[juicy] ui thème :', e); }
    });
    node.on('destroyed', off);
  }

  /** Se recale à chaque mise en page, et se désabonne à la destruction. */
  function followLayout(node, fn) {
    var j = J();
    if (!j) return;
    var off = j.on('layout', function () {
      if (node.destroyed) { off(); return; }
      try { fn(); } catch (e) { console.warn('[juicy] ui layout :', e); }
    });
    node.on('destroyed', off);
  }

  // ------------------------------------------------------------------ skins
  //
  // Les composants du noyau (`button`, `toggle`, `text`) lisent `juicy.skin`,
  // que le thème complète. Les nôtres ajoutent leurs propres clés, calculées
  // depuis les jetons du thème : un thème n'a rien à déclarer pour qu'ils
  // prennent ses couleurs, et tout à déclarer pour les changer.

  function baseSkins(t) {
    var c = t.colors;
    return {
      button: { depth: 4, shadowAlpha: 0.45, gloss: 0.12 },
      toggle: { depth: 3, shadowAlpha: 0.35 },
      panel: {
        fill: c.surface, fillHeader: c.surfaceAlt, border: c.border, borderWidth: 2,
        radius: t.radius + 4, headerH: 30, pad: 12, shadowAlpha: 0.5, shadowDepth: 8,
        title: c.text, grip: c.muted, fontSize: t.sizes.label, fontFamily: t.fonts.display
      },
      badge: {
        fill: c.accent, text: c.accentText, ring: c.accent, border: c.accent,
        borderWidth: 0, radius: 999, padX: 13, padY: 7,
        fontSize: t.sizes.label, fontFamily: t.fonts.body
      },
      card: {
        fill: c.surface, fillBack: c.surfaceAlt, border: c.border, borderWidth: 2,
        accent: c.accent, text: c.text, muted: c.muted, radius: t.radius + 2,
        pad: 12, fontSize: t.sizes.label, fontFamily: t.fonts.display, shadowAlpha: 0.45
      },
      scores: {
        rowFill: c.surface, rowFillTop: c.surfaceAlt, flash: c.accent,
        text: c.text, muted: c.muted, accent: c.accent, border: c.border,
        rowH: 28, gap: 6, radius: t.radius - 2, padX: 10,
        fontSize: t.sizes.label, fontFamily: t.fonts.body
      },
      modal: {
        scrim: 0x05070d, scrimAlpha: 0.55, blur: 9, blurQuality: 3,
        fill: c.surface, fillHeader: c.surfaceAlt, border: c.accent, borderWidth: 2,
        radius: t.radius + 6, pad: 22, width: 420, gap: 14,
        title: c.text, body: c.muted, shadowAlpha: 0.6
      },
      cursor: {
        fill: c.text, accent: c.accent, size: 13, trail: 14, trailAlpha: 0.5,
        follow: 0.34, magnet: 0.38
      }
    };
  }

  /** skin du composant = défauts calculés < skin du thème < option d'appel. */
  function skinFor(name, over) {
    var j = J();
    var base = baseSkins(j.tokens)[name] || {};
    return merge(merge(base, j.skin[name]), over);
  }

  // ------------------------------------------------------------------ texte

  function style(role, over) {
    var j = J();
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

  /** text(str, { role, fill, fontSize, … }) -> PIXI.Text */
  function text(str, o) {
    o = o || {};
    var t = new PIXI.Text({ text: String(str == null ? '' : str), style: style(o.role || 'label', o) });
    t.roundPixels = true;
    return t;
  }

  function centered(t) { t.position.set(-t.width / 2, -t.height / 2); return t; }

  // -------------------------------------------------------------- pressable
  //
  // Le corps (`body`) porte le dessin : c'est lui qui s'écrase et s'enfonce,
  // pendant que le nœud garde son `hitArea` et sa position de mise en page.

  function pressable(node, body, sk, opts, onPress) {
    var j = J();
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.label || opts.id || 'action';
    node.accessibleHint = opts.accessibleHint || '';
    node.tabIndex = 0;
    node.isPressable = true;
    var d = sk.depth || 4;

    node.on('pointerover', function () {
      node._hover = true;
      node.redraw();
      motion(body, [
        { sx: 1.10, sy: 0.90, y: 0, d: 0.09, e: 'power3.out' },
        { sx: 1.04, sy: 1.04, y: -3, d: 0.55, e: 'elastic.out(1,0.4)' }
      ]);
      if (j.audio) j.audio.play('hover');
    });
    node.on('pointerout', function () {
      node._hover = false; node._down = false;
      node.redraw();
      motion(body, [
        { sx: 0.97, sy: 1.03, y: 1, d: 0.08 },
        { sx: 1, sy: 1, y: 0, d: 0.55, e: 'elastic.out(1,0.35)' }
      ]);
    });
    node.on('pointerdown', function () {
      node._down = true;
      node.redraw();
      motion(body, [{ sx: 0.93, sy: 0.85, y: d, d: 0.07, e: 'power3.out' }]);
    });
    node.on('pointerupoutside', function () {
      node._down = false;
      node.redraw();
      motion(body, [{ sx: 1, sy: 1, y: 0, d: 0.5, e: 'elastic.out(1,0.4)' }]);
    });
    node.on('pointerup', function (e) {
      var wasDown = node._down;
      node._down = false;
      node.redraw();
      motion(body, [
        { sx: 1.14, sy: 0.88, y: -2, d: 0.09, e: 'power3.out' },
        { sx: node._hover ? 1.04 : 1, sy: node._hover ? 1.04 : 1, y: node._hover ? -3 : 0, d: 0.62, e: 'elastic.out(1,0.32)' }
      ]);
      if (wasDown && typeof onPress === 'function') onPress(e, node);
    });
    return node;
  }

  // ----------------------------------------------------------------- bouton

  /**
   * button({ label, width, height, active, onPress, accessibleTitle, skin })
   *   -> PIXI.Container  (+ setLabel, setWidth, setActive, redraw,
   *                          isButton, labelText)
   */
  function button(opts) {
    opts = opts || {};
    var sk = skinFor('button', opts.skin);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var bg = new PIXI.Graphics();
    var gloss = new PIXI.Graphics();
    var label = text(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize,
      fontFamily: sk.fontFamily, fontWeight: '600'
    });
    body.addChild(bg, gloss, label);
    node.addChild(shadow, body);
    node.isButton = true;
    node.uiKind = 'button';
    node.labelText = label;
    node._active = !!opts.active;
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + sk.padX * 2);
    node._h = opts.height || (label.height + sk.padY * 2);

    // dessiné centré sur l'origine : l'écrasement part du centre et
    // getLocalBounds() décrit ce qu'on voit (aucun pivot).
    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2, r = sk.radius;
      var fill = node._active ? sk.fillActive : ((node._down || node._hover) ? sk.fillHover : sk.fill);
      shadow.clear();
      shadow.roundRect(x0, y0 + (sk.depth || 4), w, h, r)
        .fill({ color: 0x000000, alpha: node._down ? sk.shadowAlpha * 0.4 : sk.shadowAlpha });
      bg.clear();
      bg.roundRect(x0, y0, w, h, r).fill({ color: fill });
      if (sk.borderWidth > 0) {
        bg.roundRect(x0, y0, w, h, r)
          .stroke({ width: sk.borderWidth, color: node._active ? sk.fillActive : sk.border, alignment: 0.5 });
      }
      gloss.clear();
      if (sk.gloss > 0) {
        gloss.roundRect(x0 + 2, y0 + 2, w - 4, h * 0.42, r * 0.8)
          .fill({ color: 0xffffff, alpha: node._active ? sk.gloss * 0.6 : sk.gloss });
      }
      label.style.fill = node._active ? sk.textActive : sk.text;
      centered(label);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + (sk.depth || 4));
    };
    node.setLabel = function (s) { label.text = s; node.redraw(); return node; };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setActive = function (v) { node._active = !!v; node.redraw(); return node; };
    node.redraw();
    return pressable(node, body, sk, opts, opts.onPress);
  }

  // ---------------------------------------------------------- interrupteur

  /**
   * toggle({ label, value, width, height, onChange, accessibleTitle, skin })
   *   -> PIXI.Container  (+ setValue(v, silent), value, setWidth, redraw,
   *                          isToggle, labelText)
   */
  function toggle(opts) {
    opts = opts || {};
    var sk = skinFor('toggle', opts.skin);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var body = new PIXI.Container();
    var bg = new PIXI.Graphics();
    var sw = new PIXI.Graphics();
    var label = text(opts.label || '', {
      role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily
    });
    body.addChild(bg, sw, label);
    node.addChild(shadow, body);
    node.isToggle = true;
    node.uiKind = 'toggle';
    node.labelText = label;
    node._on = !!opts.value;
    node._p = node._on ? 1 : 0;           // position du curseur, animée
    node._w = opts.width || Math.max(sk.minWidth || 0, label.width + sk.switchW + sk.padX * 2 + 10);
    node._h = opts.height || (Math.max(label.height, sk.switchH) + sk.padY * 2);

    function drawSwitch() {
      var x0 = -node._w / 2;
      var sx = x0 + sk.padX, sy = -sk.switchH / 2, p = node._p;
      var r = sk.switchH / 2 - 1.5;
      sw.clear();
      sw.roundRect(sx, sy, sk.switchW, sk.switchH, sk.switchH / 2)
        .fill({ color: mix(sk.trackOff, sk.trackOn, p), alpha: 1 - p * 0.55 });
      // le curseur s'étire au milieu de sa course : l'élan se voit
      var stretch = 1 + Math.sin(clamp(p, 0, 1) * Math.PI) * 0.5;
      var kx = lerp(sx + r + 2, sx + sk.switchW - r - 2, p);
      sw.ellipse(kx, 0, r * stretch, r / Math.sqrt(stretch))
        .fill({ color: mix(sk.knobOff, sk.knobOn, p) });
    }

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2, r = sk.radius;
      var fill = node._on ? sk.fillOn : ((node._hover || node._down) ? sk.fillHover : sk.fill);
      shadow.clear();
      shadow.roundRect(x0, y0 + (sk.depth || 3), w, h, r)
        .fill({ color: 0x000000, alpha: node._down ? sk.shadowAlpha * 0.4 : sk.shadowAlpha });
      bg.clear();
      bg.roundRect(x0, y0, w, h, r).fill({ color: fill });
      if (sk.borderWidth > 0) {
        bg.roundRect(x0, y0, w, h, r)
          .stroke({ width: sk.borderWidth, color: node._on ? sk.borderOn : sk.border, alignment: 0.5 });
      }
      drawSwitch();
      label.style.fill = node._on ? sk.textOn : sk.text;
      label.position.set(x0 + sk.padX + sk.switchW + 10, -label.height / 2);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h + (sk.depth || 3));
    };
    node.setWidth = function (px) { node._w = px; node.redraw(); return node; };
    node.setValue = function (v, silent) {
      var next = !!v;
      if (next === node._on) return node;
      node._on = next;
      node.accessibleHint = next ? 'activé' : 'désactivé';
      node.redraw();
      // bascule avec inertie : le curseur dépasse puis revient
      ramp(node._p, next ? 1 : 0, 420, 'back.out(2.6)', function (v) {
        node._p = v; drawSwitch();
      });
      if (!flat()) {
        kill(body);
        gsap.fromTo(body, { rotation: next ? -0.05 : 0.05 }, { rotation: 0, duration: 0.55, ease: 'elastic.out(1,0.35)' });
      }
      if (!silent && typeof opts.onChange === 'function') opts.onChange(next, node);
      return node;
    };
    Object.defineProperty(node, 'value', { get: function () { return node._on; } });
    node.redraw();
    return pressable(node, body, sk, {
      label: opts.label, accessibleTitle: opts.accessibleTitle
    }, function () { node.setValue(!node._on); });
  }

  // ---------------------------------------------------------------- panneau

  function screenRect() { var j = J(); return { w: j.app.screen.width, h: j.app.screen.height }; }

  /** Ramène le nœud dans l'écran (marge en pixels écran). */
  function clampToScreen(node, margin) {
    var s = screenRect();
    var b = node.getBounds();
    var m = margin == null ? 4 : margin;
    var dx = 0, dy = 0;
    if (b.width < s.w) {
      if (b.x < m) dx = m - b.x;
      else if (b.x + b.width > s.w - m) dx = (s.w - m) - (b.x + b.width);
    }
    if (b.height < s.h) {
      if (b.y < m) dy = m - b.y;
      else if (b.y + b.height > s.h - m) dy = (s.h - m) - (b.y + b.height);
    }
    if (dx || dy) {
      var wt = node.parent ? node.parent.worldTransform : null;
      var kx = wt && wt.a ? wt.a : 1, ky = wt && wt.d ? wt.d : 1;
      node.position.set(node.position.x + dx / kx, node.position.y + dy / ky);
    }
    return { dx: dx, dy: dy };
  }

  /** Saisie à la souris : suit le pointeur, garde son élan, reste à l'écran. */
  function draggable(node, sk) {
    var j = J();
    node.eventMode = 'static';
    node.cursor = 'grab';
    node.isDraggable = true;
    var st = null;

    function local(e) { return node.parent.toLocal(e.global); }

    function move(e) {
      if (!st) return;
      var p = local(e);
      var t = now(), dt = Math.max(8, t - st.t);
      node.position.set(p.x + st.dx, p.y + st.dy);
      clampToScreen(node, 4);
      st.vx = (node.position.x - st.px) / dt;
      st.vy = (node.position.y - st.py) / dt;
      st.px = node.position.x; st.py = node.position.y; st.t = t;
      node.dragged = true;
    }

    function up() {
      if (!st) return;
      var vx = clamp(st.vx, -3, 3), vy = clamp(st.vy, -3, 3);
      var stage = j.app.stage;
      stage.off('pointermove', move); stage.off('pointerup', up); stage.off('pointerupoutside', up);
      st = null;
      node.cursor = 'grab';
      node.dragging = false;
      if (!flat()) {
        motion(node, [{ sx: 1, sy: 1, d: 0.45, e: 'elastic.out(1,0.45)' }]);
        kill(node.position);
        gsap.to(node.position, {
          x: node.position.x + vx * 150, y: node.position.y + vy * 150,
          duration: 0.7, ease: 'power3.out', overwrite: true,
          onUpdate: function () { clampToScreen(node, 4); }
        });
      } else {
        node.scale.set(1);
      }
      node.emit('dragend');
    }

    node.on('pointerdown', function (e) {
      kill(node.position); kill(node.scale);
      var p = local(e);
      st = { dx: node.position.x - p.x, dy: node.position.y - p.y, px: node.position.x, py: node.position.y, t: now(), vx: 0, vy: 0 };
      node.cursor = 'grabbing';
      node.dragging = true;
      if (!flat()) gsap.to(node.scale, { x: 1.04, y: 1.04, duration: 0.18, ease: 'back.out(3)', overwrite: true });
      var stage = j.app.stage;
      stage.on('pointermove', move); stage.on('pointerup', up); stage.on('pointerupoutside', up);
      node.emit('dragstart');
    });
    return node;
  }

  /**
   * panel({ width, height, title, draggable, skin })
   *   -> PIXI.Container (+ content, contentBox, setTitle, setSize, redraw,
   *                         isPanel ; drag avec inertie, reste dans l'écran)
   */
  function panel(opts) {
    opts = opts || {};
    var sk = skinFor('panel', opts.skin);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var bg = new PIXI.Graphics();
    var grip = new PIXI.Graphics();
    var content = new PIXI.Container();
    var title = null;
    node.addChild(shadow, bg, grip, content);
    node.isPanel = true;
    node.uiKind = 'panel';
    node.content = content;
    node._w = opts.width || 280;
    node._h = opts.height || 180;
    node._title = opts.title || '';

    if (node._title) {
      title = text(node._title, {
        role: 'label', fill: sk.title, fontSize: sk.fontSize,
        fontFamily: sk.fontFamily, fontWeight: '700'
      });
      node.addChild(title);
      node.titleText = title;
    }

    node.redraw = function () {
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2, r = sk.radius;
      var head = node._title ? sk.headerH : 0;
      shadow.clear();
      shadow.roundRect(x0 + 2, y0 + sk.shadowDepth, w, h, r).fill({ color: 0x000000, alpha: sk.shadowAlpha });
      bg.clear();
      bg.roundRect(x0, y0, w, h, r).fill({ color: sk.fill });
      if (head) bg.roundRect(x0, y0, w, head, r).fill({ color: sk.fillHeader });
      if (head) bg.moveTo(x0, y0 + head).lineTo(x0 + w, y0 + head).stroke({ width: 1, color: sk.border, alpha: 0.8 });
      if (sk.borderWidth > 0) bg.roundRect(x0, y0, w, h, r).stroke({ width: sk.borderWidth, color: sk.border });
      grip.clear();
      if (head) {
        for (var i = 0; i < 3; i++) {
          grip.roundRect(x0 + w - 16 - i * 7, y0 + head / 2 - 6, 3, 12, 1.5).fill({ color: sk.grip, alpha: 0.7 });
        }
      }
      if (title) { title.position.set(x0 + sk.pad, y0 + (head - title.height) / 2); }
      node.contentBox = { x: x0 + sk.pad, y: y0 + head + sk.pad, width: w - sk.pad * 2, height: h - head - sk.pad * 2 };
      content.position.set(0, head / 2);
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h);
    };
    node.setTitle = function (s) { if (title) { title.text = s; node._title = s; node.redraw(); } return node; };
    node.setSize = function (w, h) { node._w = w; node._h = h; node.redraw(); return node; };
    node.redraw();
    if (opts.draggable !== false) draggable(node, sk);
    return node;
  }

  // ---------------------------------------------------------------- pastille

  /**
   * badge({ label, value, skin }) -> PIXI.Container
   *   (+ setValue(v), pulse(), labelText, isBadge)
   */
  function badge(opts) {
    opts = opts || {};
    var sk = skinFor('badge', opts.skin);
    var node = new PIXI.Container();
    var ring = new PIXI.Graphics();
    var body = new PIXI.Container();
    var bg = new PIXI.Graphics();
    var label = text('', { role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily, fontWeight: '700' });
    body.addChild(bg, label);
    node.addChild(ring, body);
    node.isBadge = true;
    node.uiKind = 'badge';
    node.labelText = label;
    node._label = opts.label || '';
    node._value = opts.value == null ? '' : opts.value;

    node.redraw = function () {
      label.text = node._label ? node._label + ' ' + node._value : String(node._value);
      var w = label.width + sk.padX * 2, h = label.height + sk.padY * 2;
      node._w = w; node._h = h;
      var x0 = -w / 2, y0 = -h / 2, r = Math.min(sk.radius, h / 2);
      bg.clear();
      bg.roundRect(x0, y0, w, h, r).fill({ color: sk.fill });
      if (sk.borderWidth > 0) bg.roundRect(x0, y0, w, h, r).stroke({ width: sk.borderWidth, color: sk.border });
      centered(label);
      ring.clear();
      ring.roundRect(x0, y0, w, h, r).stroke({ width: 2, color: sk.ring });
      node.hitArea = new PIXI.Rectangle(x0, y0, w, h);
    };

    /** Impulsion : la pastille rebondit, une onde part de son bord. */
    node.pulse = function () {
      if (flat()) return node;
      kill(body.scale); kill(ring.scale); kill(ring);
      ring.alpha = 0.9; ring.scale.set(1);
      gsap.to(ring.scale, { x: 1.9, y: 2.4, duration: 0.55, ease: 'power2.out' });
      gsap.to(ring, { alpha: 0, duration: 0.55, ease: 'power2.out' });
      gsap.fromTo(body.scale, { x: 1.35, y: 0.7 }, { x: 1, y: 1, duration: 0.7, ease: 'elastic.out(1,0.35)' });
      return node;
    };
    node.setValue = function (v, quiet) {
      node._value = v;
      node.redraw();
      if (!quiet) node.pulse();
      return node;
    };
    node.redraw();
    ring.alpha = 0;
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.label || 'pastille';
    node.on('pointertap', function () {
      node.pulse();
      if (typeof opts.onPress === 'function') opts.onPress(node);
    });
    return node;
  }

  // ------------------------------------------------------------------ carte

  /**
   * card({ width, height, title, back, lines, backLines, skin })
   *   -> PIXI.Container (+ flip(), face, front, backFace, isCard)
   */
  function card(opts) {
    opts = opts || {};
    var sk = skinFor('card', opts.skin);
    var node = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var front = new PIXI.Container();
    var back = new PIXI.Container();
    node.addChild(shadow, front, back);
    node.isCard = true;
    node.uiKind = 'card';
    node.face = 'front';
    node.front = front;
    node.backFace = back;
    node._w = opts.width || 170;
    node._h = opts.height || 220;

    function buildFace(box, faceSk, title, lines, accent) {
      clearAll(box);
      var w = node._w, h = node._h, x0 = -w / 2, y0 = -h / 2;
      var g = new PIXI.Graphics();
      g.roundRect(x0, y0, w, h, sk.radius).fill({ color: faceSk });
      g.roundRect(x0, y0, w, h, sk.radius).stroke({ width: sk.borderWidth, color: accent ? sk.accent : sk.border });
      g.roundRect(x0 + 6, y0 + 6, w - 12, h - 12, sk.radius - 3).stroke({ width: 1, color: sk.border, alpha: 0.6 });
      box.addChild(g);
      var t = text(title, { role: 'label', fill: sk.text, fontSize: sk.fontSize * 1.15, fontFamily: sk.fontFamily, fontWeight: '700', align: 'center', wrapWidth: w - sk.pad * 2 });
      t.position.set(-t.width / 2, y0 + sk.pad);
      box.addChild(t);
      var y = y0 + sk.pad + t.height + 10;
      (lines || []).forEach(function (line) {
        var l = text(line, { role: 'label', fill: sk.muted, fontSize: sk.fontSize * 0.9, align: 'center', wrapWidth: w - sk.pad * 2 });
        l.position.set(-l.width / 2, y);
        box.addChild(l);
        y += l.height + 6;
      });
    }

    function clearAll(box) {
      box.removeChildren().forEach(function (k) { try { k.destroy({ children: true }); } catch (e) { /* ignore */ } });
    }

    node.redraw = function () {
      var w = node._w, h = node._h;
      shadow.clear();
      shadow.roundRect(-w / 2 + 3, -h / 2 + 9, w, h, sk.radius).fill({ color: 0x000000, alpha: sk.shadowAlpha });
      buildFace(front, sk.fill, opts.title || 'Recto', opts.lines || [], false);
      buildFace(back, sk.fillBack, opts.back || 'Verso', opts.backLines || [], true);
      front.visible = node.face === 'front';
      back.visible = node.face === 'back';
      node.hitArea = new PIXI.Rectangle(-w / 2, -h / 2, w, h);
    };

    function swap() {
      node.face = node.face === 'front' ? 'back' : 'front';
      front.visible = node.face === 'front';
      back.visible = node.face === 'back';
    }

    /** Retournement : la carte s'aplatit sur la tranche puis rebondit. */
    node.flip = function () {
      if (flat()) { swap(); return node; }
      kill(node.scale); kill(node);
      var t = gsap.timeline();
      t.to(node.scale, { x: 0.04, y: 1.08, duration: 0.18, ease: 'power2.in', onComplete: swap });
      t.to(node.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' });
      t.fromTo(node, { rotation: -0.06 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1,0.4)' }, '<');
      return node;
    };
    node.redraw();
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.accessible = true;
    node.accessibleType = 'button';
    node.accessibleTitle = opts.accessibleTitle || opts.title || 'Carte';
    node.on('pointertap', function () {
      if (opts.flipOnTap !== false) node.flip();
      if (typeof opts.onPress === 'function') opts.onPress(node);
    });
    return node;
  }

  // ----------------------------------------------------------------- scores

  /**
   * scores({ entries: [{ name, value }], width, rows, skin })
   *   -> PIXI.Container (+ setEntries(list), bump(name, delta), entries,
   *                         isScores)
   */
  function scores(opts) {
    opts = opts || {};
    var sk = skinFor('scores', opts.skin);
    var node = new PIXI.Container();
    node.isScores = true;
    node.uiKind = 'scores';
    node._w = opts.width || 220;
    node.entries = (opts.entries || []).map(function (e) { return { name: e.name, value: e.value || 0 }; });
    var rows = {};

    function rowY(i) { return i * (sk.rowH + sk.gap); }

    function makeRow(entry) {
      var row = new PIXI.Container();
      var bg = new PIXI.Graphics();
      var flash = new PIXI.Graphics();
      var nameT = text(entry.name, { role: 'label', fill: sk.text, fontSize: sk.fontSize, fontFamily: sk.fontFamily });
      var valT = text(String(entry.value), { role: 'label', fill: sk.accent, fontSize: sk.fontSize, fontFamily: sk.fontFamily, fontWeight: '700' });
      row.addChild(bg, flash, nameT, valT);
      row.bgG = bg; row.flashG = flash; row.nameT = nameT; row.valT = valT;
      row.redraw = function (rank) {
        var w = node._w, h = sk.rowH, x0 = -w / 2;
        bg.clear();
        bg.roundRect(x0, 0, w, h, sk.radius).fill({ color: rank === 0 ? sk.rowFillTop : sk.rowFill });
        bg.roundRect(x0, 0, w, h, sk.radius).stroke({ width: 1, color: rank === 0 ? sk.accent : sk.border, alpha: rank === 0 ? 0.9 : 0.6 });
        bg.rect(x0 + 1, 1, 4, h - 2).fill({ color: rank === 0 ? sk.accent : sk.muted, alpha: 0.9 });
        flash.clear();
        flash.roundRect(x0, 0, w, h, sk.radius).fill({ color: sk.flash });
        nameT.text = (rank + 1) + '. ' + entry.name;
        nameT.position.set(x0 + sk.padX, (h - nameT.height) / 2);
        valT.text = String(Math.round(entry.value));
        valT.position.set(x0 + w - sk.padX - valT.width, (h - valT.height) / 2);
      };
      flash.alpha = 0;
      return row;
    }

    node.redraw = function () {
      node.removeChildren().forEach(function (k) { try { k.destroy({ children: true }); } catch (e) { /* ignore */ } });
      rows = {};
      var sorted = node.entries.slice().sort(function (a, b) { return b.value - a.value; });
      sorted.forEach(function (e, i) {
        var row = makeRow(e);
        row.redraw(i);
        row.position.set(0, rowY(i));
        rows[e.name] = row;
        node.addChild(row);
      });
      node.hitArea = new PIXI.Rectangle(-node._w / 2, 0, node._w, rowY(Math.max(0, sorted.length - 1)) + sk.rowH);
    };

    /** Réordonne en faisant glisser chaque ligne vers son nouveau rang. */
    node.setEntries = function (list) {
      list.forEach(function (e) {
        var found = null;
        node.entries.forEach(function (x) { if (x.name === e.name) found = x; });
        if (found) found.value = e.value; else node.entries.push({ name: e.name, value: e.value });
      });
      var sorted = node.entries.slice().sort(function (a, b) { return b.value - a.value; });
      sorted.forEach(function (e, i) {
        var row = rows[e.name];
        if (!row) { node.redraw(); return; }
        row.redraw(i);
        if (flat()) row.position.y = rowY(i);
        else {
          kill(row.position);
          gsap.to(row.position, { y: rowY(i), duration: 0.55, ease: 'back.out(1.6)', overwrite: true });
        }
      });
      return node;
    };

    /** bump(name, delta) : ajoute des points et éclaire la ligne. */
    node.bump = function (name, delta) {
      var e = null;
      node.entries.forEach(function (x) { if (x.name === name) e = x; });
      if (!e) return node;
      node.setEntries([{ name: name, value: e.value + (delta || 1) }]);
      var row = rows[name];
      if (row && !flat()) {
        kill(row.flashG); kill(row.scale);
        row.flashG.alpha = 0.55;
        gsap.to(row.flashG, { alpha: 0, duration: 0.6, ease: 'power2.out' });
        gsap.fromTo(row.scale, { x: 1.06, y: 0.88 }, { x: 1, y: 1, duration: 0.7, ease: 'elastic.out(1,0.4)' });
      }
      return node;
    };
    node.redraw();
    return node;
  }

  // ----------------------------------------------------------------- modale

  function blurFilter(sk) {
    try {
      if (PIXI.filters && PIXI.filters.KawaseBlurFilter) {
        return new PIXI.filters.KawaseBlurFilter({ strength: 0.001, quality: sk.blurQuality || 3 });
      }
    } catch (e) { /* repli */ }
    try { return new PIXI.BlurFilter({ strength: 0.001, quality: 2 }); } catch (e) { return null; }
  }

  function setBlur(f, v) {
    if (!f) return;
    try { f.strength = v; } catch (e) { /* ignore */ }
    if ('blur' in f) { try { f.blur = v; } catch (e) { /* ignore */ } }
  }

  /**
   * modal({ title, body, actions: [{ label, onPress }], width, blur, skin })
   *   -> PIXI.Container dans `layers.overlay`
   *      (+ open(), close(), isOpen, isModal ; le fond est flouté et le
   *         clic sur le fond referme)
   */
  function modal(opts) {
    opts = opts || {};
    var j = J();
    var sk = skinFor('modal', opts.skin);
    var node = new PIXI.Container();
    var scrim = new PIXI.Graphics();
    var dialog = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    var bg = new PIXI.Graphics();
    var inner = new PIXI.Container();
    dialog.addChild(shadow, bg, inner);
    node.addChild(scrim, dialog);
    node.isModal = true;
    node.uiKind = 'modal';
    node.isOpen = false;
    node.visible = false;
    node.dialog = dialog;
    node.scrim = scrim;

    j.layers.overlay.addChild(node);

    scrim.eventMode = 'static';
    scrim.cursor = 'pointer';
    dialog.eventMode = 'static';

    var filt = null;

    function clearInner() {
      inner.removeChildren().forEach(function (k) { kill(k); try { k.destroy({ children: true }); } catch (e) { /* ignore */ } });
    }

    node.redraw = function () {
      sk = skinFor('modal', opts.skin);
      var s = screenRect();
      scrim.clear();
      scrim.rect(0, 0, s.w, s.h).fill({ color: sk.scrim, alpha: sk.scrimAlpha });
      scrim.hitArea = new PIXI.Rectangle(0, 0, s.w, s.h);

      clearInner();
      var w = Math.min(sk.width, s.w - 40);
      var lines = opts.body == null ? [] : (Array.isArray(opts.body) ? opts.body : [opts.body]);
      var y = sk.pad;
      var t = text(opts.title || '', { role: 'tagline', fill: sk.title, fontSize: j.tokens.sizes.tagline, fontFamily: j.tokens.fonts.display, fontWeight: '700', wrapWidth: w - sk.pad * 2 });
      inner.addChild(t);
      t.position.set(sk.pad, y);
      y += t.height + 10;
      lines.forEach(function (line) {
        var l = text(line, { role: 'label', fill: sk.body, wrapWidth: w - sk.pad * 2 });
        l.position.set(sk.pad, y);
        inner.addChild(l);
        y += l.height + 6;
      });
      y += sk.gap;
      var acts = opts.actions || [{ label: 'Fermer' }];
      var bx = sk.pad;
      var rowH = 0;
      acts.forEach(function (a) {
        var b = button({
          label: a.label,
          accessibleTitle: a.label,
          onPress: function (e, n) {
            if (typeof a.onPress === 'function') a.onPress(e, n);
            if (a.close !== false) node.close();
          }
        });
        b.position.set(bx + b._w / 2, y + b._h / 2);
        rowH = Math.max(rowH, b._h + 6);
        bx += b._w + 10;
        inner.addChild(b);
      });
      y += rowH + sk.pad;

      var h = y;
      inner.position.set(-w / 2, -h / 2);
      shadow.clear();
      shadow.roundRect(-w / 2 + 3, -h / 2 + 12, w, h, sk.radius).fill({ color: 0x000000, alpha: sk.shadowAlpha });
      bg.clear();
      bg.roundRect(-w / 2, -h / 2, w, h, sk.radius).fill({ color: sk.fill });
      bg.roundRect(-w / 2, -h / 2, w, h, sk.radius).stroke({ width: sk.borderWidth, color: sk.border });
      bg.roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, sk.radius - 3).stroke({ width: 1, color: sk.border, alpha: 0.35 });
      dialog.hitArea = new PIXI.Rectangle(-w / 2, -h / 2, w, h);
      dialog.position.set(s.w / 2, s.h / 2);
      node._w = w; node._h = h;
    };

    function applyBlur(to, ms, done) {
      if (!filt) filt = blurFilter(sk);
      if (!filt) { if (done) done(); return; }
      var ls = [j.layers.background, j.layers.world];
      ls.forEach(function (l) { l.filterArea = j.app.screen; l.filters = [filt]; });
      ramp(to > 0 ? 0 : sk.blur, to, ms, 'power2.out', function (v) { setBlur(filt, v); }, function () {
        if (to === 0) ls.forEach(function (l) { l.filters = []; l.filterArea = null; });
        if (done) done();
      });
    }

    node.open = function () {
      if (node.isOpen) return node;
      node.isOpen = true;
      node.redraw();
      node.visible = true;
      applyBlur(sk.blur, 320);
      if (flat()) { scrim.alpha = 1; dialog.alpha = 1; dialog.scale.set(1); }
      else {
        kill(scrim); kill(dialog); kill(dialog.scale);
        gsap.fromTo(scrim, { alpha: 0 }, { alpha: 1, duration: 0.25, ease: 'power2.out' });
        gsap.fromTo(dialog, { alpha: 0 }, { alpha: 1, duration: 0.2 });
        gsap.fromTo(dialog.scale, { x: 0.65, y: 0.5 }, { x: 1, y: 1, duration: 0.7, ease: 'elastic.out(1,0.5)' });
      }
      if (j.audio) j.audio.play('select');
      j.log('modal open');
      return node;
    };

    node.close = function () {
      if (!node.isOpen) return node;
      node.isOpen = false;
      applyBlur(0, 260);
      if (flat()) { node.visible = false; }
      else {
        kill(scrim); kill(dialog); kill(dialog.scale);
        gsap.to(scrim, { alpha: 0, duration: 0.22 });
        gsap.to(dialog, { alpha: 0, duration: 0.2 });
        gsap.to(dialog.scale, {
          x: 0.8, y: 0.7, duration: 0.24, ease: 'power2.in',
          onComplete: function () { node.visible = false; }
        });
      }
      j.log('modal close');
      return node;
    };

    scrim.on('pointertap', function () { node.close(); });
    dialog.on('pointerdown', function (e) { e.stopPropagation(); });
    node.redraw();
    followLayout(node, function () { if (node.isOpen || node.visible) node.redraw(); else node.redraw(); });
    followTheme(node, function () { filt = null; node.redraw(); });
    return node;
  }

  // ---------------------------------------------------------------- curseur

  function discTexture(j, color, r) {
    var g = new PIXI.Graphics();
    for (var i = 6; i >= 1; i--) {
      g.circle(0, 0, r * (i / 6)).fill({ color: color, alpha: 0.16 });
    }
    var tex = j.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    g.destroy();
    return tex;
  }

  function arrowTexture(j, sk) {
    var s = sk.size;
    var g = new PIXI.Graphics();
    g.circle(0, 0, s * 0.92).fill({ color: sk.accent, alpha: 0.18 });
    g.circle(0, 0, s * 0.62).stroke({ width: 2, color: sk.accent, alpha: 0.95 });
    g.circle(0, 0, s * 0.2).fill({ color: sk.fill });
    g.moveTo(-s * 1.25, 0).lineTo(-s * 0.85, 0).stroke({ width: 2, color: sk.accent, alpha: 0.8 });
    g.moveTo(s * 0.85, 0).lineTo(s * 1.25, 0).stroke({ width: 2, color: sk.accent, alpha: 0.8 });
    g.moveTo(0, -s * 1.25).lineTo(0, -s * 0.85).stroke({ width: 2, color: sk.accent, alpha: 0.8 });
    g.moveTo(0, s * 0.85).lineTo(0, s * 1.25).stroke({ width: 2, color: sk.accent, alpha: 0.8 });
    var tex = j.app.renderer.generateTexture({ target: g, resolution: 2, antialias: true });
    g.destroy();
    return tex;
  }

  /**
   * cursor({ trail, magnet, size, skin }) -> PIXI.Container dans `layers.cursor`
   *   (+ setEnabled(on), setTrail(on), setMagnet(on), enabled, isCursor)
   *
   * Sprite qui suit le pointeur avec du retard, traîne des particules et se
   * fait aimanter par le composant survolé. Le curseur natif n'est masqué que
   * sur le canvas (styles de curseur de Pixi compris).
   */
  function cursor(opts) {
    opts = opts || {};
    var j = J();
    var sk = skinFor('cursor', opts.skin);
    var node = new PIXI.Container();
    var trailBox = new PIXI.Container();
    var sprite = null;
    var trail = [];
    var texArrow = null, texDot = null;
    node.isCursor = true;
    node.uiKind = 'cursor';
    node.enabled = false;
    node.trailOn = opts.trail !== false;
    node.magnetOn = opts.magnet !== false;

    var p = { x: j.app.screen.width / 2, y: j.app.screen.height / 2 };
    var target = { x: p.x, y: p.y };
    var pointer = { x: p.x, y: p.y };
    var hover = null;
    var savedCursors = null;

    node.addChild(trailBox);

    function build() {
      sk = skinFor('cursor', opts.skin);
      if (sprite) { sprite.destroy(); sprite = null; }
      trail.forEach(function (s) { s.destroy(); });
      trail = [];
      if (texArrow) texArrow.destroy(true);
      if (texDot) texDot.destroy(true);
      texArrow = arrowTexture(j, sk);
      texDot = discTexture(j, 0xffffff, 10);
      var n = sk.trail;
      for (var i = 0; i < n; i++) {
        var s = new PIXI.Sprite(texDot);
        s.anchor.set(0.5);
        s.tint = sk.accent;
        s.alpha = 0;
        s.blendMode = 'add';
        trailBox.addChild(s);
        trail.push(s);
      }
      sprite = new PIXI.Sprite(texArrow);
      sprite.anchor.set(0.5);
      node.addChild(sprite);
      sprite.position.set(p.x, p.y);
    }

    function pressableUnder(x, y) {
      var hit = null;
      try { hit = j.app.renderer.events.rootBoundary.hitTest(x, y); } catch (e) { return null; }
      var n = hit;
      while (n) { if (n.isPressable) return n; n = n.parent; }
      return null;
    }

    function onMove(e) {
      var g = e.global || e;
      pointer.x = g.x; pointer.y = g.y;
      hover = node.magnetOn ? pressableUnder(g.x, g.y) : null;
    }

    function onDown() {
      if (!node.enabled || flat() || !sprite) return;
      kill(sprite.scale);
      gsap.fromTo(sprite.scale, { x: 0.55, y: 0.55 }, { x: 1, y: 1, duration: 0.55, ease: 'elastic.out(1,0.4)' });
    }

    var history = [];

    function update() {
      if (!node.enabled || !sprite) return;
      target.x = pointer.x; target.y = pointer.y;
      var pull = 1;
      if (hover && !hover.destroyed) {
        var b = hover.getBounds();
        if (b.width > 0) {
          var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
          target.x = lerp(target.x, cx, sk.magnet);
          target.y = lerp(target.y, cy, sk.magnet);
          pull = 1.45;
        }
      }
      var k = flat() ? 1 : sk.follow;
      p.x += (target.x - p.x) * k;
      p.y += (target.y - p.y) * k;
      sprite.position.set(p.x, p.y);
      var s = sprite.scale.x;
      sprite.rotation = flat() ? 0 : sprite.rotation + 0.01;
      if (!flat()) {
        var want = pull;
        sprite.scale.set(s + (want - s) * 0.12);
      }
      if (node.trailOn) {
        history.unshift({ x: p.x, y: p.y });
        if (history.length > trail.length * 2) history.length = trail.length * 2;
        trail.forEach(function (sp, i) {
          var h = history[Math.min(history.length - 1, i * 2)];
          if (!h) return;
          var f = 1 - i / trail.length;
          sp.position.set(h.x, h.y);
          sp.alpha = f * f * sk.trailAlpha;
          sp.scale.set(f * 0.9 + 0.1);
        });
      } else {
        trail.forEach(function (sp) { sp.alpha = 0; });
      }
    }

    function hideNative(on) {
      var evs = j.app.renderer.events;
      if (on) {
        if (!savedCursors) savedCursors = merge({}, evs.cursorStyles);
        Object.keys(evs.cursorStyles).forEach(function (k) { evs.cursorStyles[k] = 'none'; });
        evs.cursorStyles.default = 'none';
        evs.cursorStyles.pointer = 'none';
        evs.cursorStyles.grab = 'none';
        evs.cursorStyles.grabbing = 'none';
        try { evs.setCursor('default'); } catch (e) { /* ignore */ }
        j.canvas.style.cursor = 'none';
      } else {
        if (savedCursors) {
          Object.keys(savedCursors).forEach(function (k) { evs.cursorStyles[k] = savedCursors[k]; });
        }
        j.canvas.style.cursor = '';
        try { evs.setCursor('default'); } catch (e) { /* ignore */ }
      }
    }

    node.setEnabled = function (on) {
      on = !!on;
      if (on === node.enabled) return node;
      node.enabled = on;
      node.visible = on;
      hideNative(on);
      if (on && !sprite) build();
      return node;
    };
    node.setTrail = function (on) { node.trailOn = !!on; return node; };
    node.setMagnet = function (on) { node.magnetOn = !!on; if (!node.magnetOn) hover = null; return node; };

    build();
    node.visible = false;
    j.layers.cursor.addChild(node);
    j.app.stage.on('globalpointermove', onMove);
    j.app.stage.on('pointerdown', onDown);
    j.app.ticker.add(update);
    followTheme(node, build);
    node.on('destroyed', function () {
      j.app.ticker.remove(update);
      j.app.stage.off('globalpointermove', onMove);
      j.app.stage.off('pointerdown', onDown);
      hideNative(false);
    });
    if (opts.enabled !== false) node.setEnabled(true);
    return node;
  }

  // ----------------------------------------------------------- installation

  var UI = {
    style: style, text: text, button: button, toggle: toggle,
    panel: panel, badge: badge, card: card, scores: scores,
    modal: modal, cursor: cursor,
    clampToScreen: clampToScreen, draggable: draggable
  };

  // Point d'extension du noyau : les fabriques survivent aux changements de
  // thème, et celles qu'un thème redéfinit restent prioritaires.
  Juicy.ui.extend(UI);
})(window);
