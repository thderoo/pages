/*
 * effects.js — effets continus, effets ponctuels et son de la bibliothèque
 * Juicy. Chargé après `lib/juicy.js`.
 *
 * Tout est fait avec ce que le canvas WebGL permet et que le DOM ne permettait
 * pas : filtres sur l'image rendue entière, caméra, milliers de particules en
 * `ParticleContainer`, vraie perspective par `RenderTexture` + `PerspectiveMesh`.
 *
 * Effet continu  : Juicy.effects.define(id, { start(juicy), stop(juicy), update(juicy, dt) })
 *                  `start` retourne le nombre d'éléments ciblés : journal `targets=N`.
 * Effet ponctuel : Juicy.effects.define(id, { fire(juicy, opts) })
 *
 * Où vivent les choses (le noyau vide `layers.background` et les emplacements
 * à chaque mise en page, jamais `layers.world` ni `layers.overlay`) :
 *   world   (caméra) : champ de particules de fond, derrière les emplacements
 *   overlay          : pluie, confettis, ondes, traînée, maillage de perspective
 *   cursor           : curseur dessiné
 *   app.stage.filters: filtres plein écran, empilés par `stageFilters`
 */
(function (global) {
  'use strict';

  var PIXI = global.PIXI;
  var Juicy = global.Juicy;
  if (!Juicy || !PIXI) { console.warn('[juicy] effects.js chargé sans le noyau'); return; }

  var gsap = global.gsap || null;
  var FX = PIXI.filters || {};
  var E = Juicy.effects;

  // =================================================================== outils

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function has(name) { return typeof FX[name] === 'function'; }

  /** Pointeur suivi en coordonnées écran (le noyau n'en expose pas). */
  var P = { x: 0, y: 0, down: false, seen: false };

  var inst = null;          // instance installée
  var texCache = {};
  var layoutCbs = [];       // rappels à rejouer après chaque mise en page
  var tickCbs = [];         // boucles hors effets continus (bursts)
  var stageFilters = {};    // id -> filtre(s) posés sur app.stage

  function onLayout(fn) { layoutCbs.push(fn); return fn; }
  function offLayout(fn) { var i = layoutCbs.indexOf(fn); if (i >= 0) layoutCbs.splice(i, 1); }
  function onTick(fn) { if (tickCbs.indexOf(fn) < 0) tickCbs.push(fn); return fn; }
  function offTick(fn) { var i = tickCbs.indexOf(fn); if (i >= 0) tickCbs.splice(i, 1); }

  function syncStage(j) {
    var list = [];
    Object.keys(stageFilters).forEach(function (k) {
      var f = stageFilters[k];
      if (Array.isArray(f)) list = list.concat(f); else list.push(f);
    });
    try { j.app.stage.filters = list; } catch (e) { /* ignore */ }
  }
  function addStage(j, id, f) { if (!f) return false; stageFilters[id] = f; syncStage(j); return true; }
  function delStage(j, id) {
    var f = stageFilters[id];
    delete stageFilters[id];
    syncStage(j);
    (Array.isArray(f) ? f : [f]).forEach(function (x) { if (x && x.destroy) { try { x.destroy(); } catch (e) { /* ignore */ } } });
  }

  /** Branche le pointeur, les rappels de mise en page et la boucle des bursts. */
  function install(j) {
    if (inst === j) return j;
    inst = j;
    texCache = {};
    P.x = j.app.screen.width / 2;
    P.y = j.app.screen.height / 2;
    var c = j.canvas || j.app.canvas;
    // le canvas lui-même, pas de DOM ajouté
    c.addEventListener('pointermove', function (e) { P.x = e.offsetX; P.y = e.offsetY; P.seen = true; }, { passive: true });
    c.addEventListener('pointerdown', function (e) { P.x = e.offsetX; P.y = e.offsetY; P.down = true; }, { passive: true });
    c.addEventListener('pointerup', function () { P.down = false; }, { passive: true });
    c.addEventListener('pointerleave', function () { P.down = false; }, { passive: true });
    j.on('layout', function () {
      layoutCbs.slice().forEach(function (f) {
        try { f(j); } catch (e) { console.warn('[juicy] fx relayout :', e); }
      });
    });
    j.on('theme', function () { syncStage(j); });
    j.app.ticker.add(function (t) {
      var dt = Math.min(120, t.deltaMS);
      tickCbs.slice().forEach(function (f) {
        try { f(j, dt); } catch (e) { console.warn('[juicy] fx tick :', e); }
      });
    });
    return j;
  }

  // ------------------------------------------------------------- textures

  function texture(j, key, draw) {
    if (texCache[key]) return texCache[key];
    var g = new PIXI.Graphics();
    draw(g);
    var t = j.app.renderer.generateTexture(g);
    g.destroy();
    texCache[key] = t;
    return t;
  }

  /** Disque doux : des cercles concentriques de faible alpha qui s'accumulent. */
  function texDot(j) {
    return texture(j, 'dot', function (g) {
      var R = 32, steps = 20;
      for (var i = steps; i >= 1; i--) g.circle(R, R, R * (i / steps)).fill({ color: 0xffffff, alpha: 0.075 });
    });
  }
  function texSpark(j) {
    return texture(j, 'spark', function (g) {
      var R = 10, steps = 8;
      for (var i = steps; i >= 1; i--) g.circle(R, R, R * (i / steps)).fill({ color: 0xffffff, alpha: 0.16 });
    });
  }
  function texChip(j) {
    return texture(j, 'chip', function (g) { g.roundRect(0, 0, 18, 11, 2).fill({ color: 0xffffff }); });
  }
  function texStreak(j) {
    return texture(j, 'streak', function (g) { g.roundRect(0, 0, 3, 30, 1.5).fill({ color: 0xffffff }); });
  }
  function texBar(j) {
    return texture(j, 'bar', function (g) { g.roundRect(0, 0, 10, 10, 3).fill({ color: 0xffffff }); });
  }
  function texGlyph(j, key, ch, size) {
    if (texCache[key]) return texCache[key];
    var t = new PIXI.Text({ text: ch, style: { fontSize: size || 44, fill: 0xffffff } });
    var tex = j.app.renderer.generateTexture(t);
    t.destroy();
    texCache[key] = tex;
    return tex;
  }

  // -------------------------------------------------- réservoir de particules
  //
  // Un `ParticleContainer` + un état JS par particule. Les particules mortes
  // restent dans le conteneur, à alpha 0 : pas d'allocation en vol.

  function makePool(j, layer, tex, max, blend) {
    var pc = new PIXI.ParticleContainer({
      dynamicProperties: { vertex: true, position: true, rotation: true, color: true }
    });
    if (blend) pc.blendMode = blend;
    var st = new Array(max), cur = 0, alive = 0;
    for (var i = 0; i < max; i++) {
      var p = new PIXI.Particle({ texture: tex, x: -9999, y: -9999, anchorX: 0.5, anchorY: 0.5 });
      p.scaleX = p.scaleY = 0; p.alpha = 0;
      pc.addParticle(p);
      st[i] = { p: p, life: 0 };
    }
    layer.addChild(pc);

    return {
      container: pc,
      get alive() { return alive; },
      spawn: function (o) {
        for (var k = 0; k < max; k++) {
          var s = st[(cur + k) % max];
          if (s.life > 0) continue;
          cur = (cur + k + 1) % max;
          s.life = s.max = o.life;
          s.x = o.x; s.y = o.y;
          s.vx = o.vx || 0; s.vy = o.vy || 0;
          s.ax = o.ax || 0; s.ay = o.ay || 0;
          s.drag = o.drag == null ? 1 : o.drag;
          s.rot = o.rot || 0; s.vr = o.vr || 0;
          s.s0 = o.s0 == null ? 1 : o.s0;
          s.s1 = o.s1 == null ? s.s0 : o.s1;
          s.a0 = o.a0 == null ? 1 : o.a0;
          s.a1 = o.a1 == null ? 0 : o.a1;
          s.p.tint = o.tint == null ? 0xffffff : o.tint;
          s.p.x = s.x; s.p.y = s.y; s.p.rotation = s.rot;
          s.p.scaleX = s.p.scaleY = s.s0; s.p.alpha = s.a0;
          alive++;
          return s;
        }
        return null;
      },
      update: function (dt) {
        var sec = dt / 1000;
        for (var k = 0; k < max; k++) {
          var s = st[k];
          if (s.life <= 0) continue;
          s.life -= dt;
          if (s.life <= 0) { s.p.alpha = 0; s.p.scaleX = s.p.scaleY = 0; s.p.x = -9999; alive--; continue; }
          s.vx += s.ax * sec; s.vy += s.ay * sec;
          if (s.drag !== 1) { var d = Math.pow(s.drag, sec * 60); s.vx *= d; s.vy *= d; }
          s.x += s.vx * sec; s.y += s.vy * sec;
          s.rot += s.vr * sec;
          var t = 1 - s.life / s.max;
          s.p.x = s.x; s.p.y = s.y; s.p.rotation = s.rot;
          var sc = s.s0 + (s.s1 - s.s0) * t;
          s.p.scaleX = s.p.scaleY = sc;
          s.p.alpha = s.a0 + (s.a1 - s.a0) * t;
        }
      },
      clear: function () {
        for (var k = 0; k < max; k++) {
          var s = st[k];
          if (s.life <= 0) continue;
          s.life = 0; s.p.alpha = 0; s.p.scaleX = s.p.scaleY = 0; s.p.x = -9999;
        }
        alive = 0;
      },
      destroy: function () { try { pc.destroy({ children: true }); } catch (e) { /* ignore */ } }
    };
  }

  /** Réservoirs partagés par les effets ponctuels, créés à la demande. */
  var pools = {};
  function poolOf(j, key, layerName, tex, max, blend) {
    if (pools[key] && !pools[key].container.destroyed) return pools[key];
    pools[key] = makePool(j, j.layers[layerName], tex, max, blend);
    onTick(function (jj, dt) { if (pools[key]) pools[key].update(dt); });
    return pools[key];
  }
  function clearPools() { Object.keys(pools).forEach(function (k) { pools[k].clear(); }); }

  // ------------------------------------------------------------------- son
  //
  // Le noyau fournit un `juicy.audio` minimal et invite explicitement ce
  // fichier à remplacer la synthèse : on remplace les méthodes **en place**,
  // l'objet reste le même pour tous ceux qui le tiennent déjà.

  var A = null;

  function audioEngine(j) {
    if (A) return A;
    var T = global.Tone;
    var a = j.audio;
    var nodes = null, lastHover = 0;

    function build() {
      if (nodes || !global.Tone) return nodes;
      T = global.Tone;
      try {
        var master = new T.Gain(0.85).toDestination();
        var an = new T.Analyser('waveform', 128);
        master.connect(an);
        var verb = new T.Reverb({ decay: 2.2, wet: 0.18 }).connect(master);
        nodes = {
          master: master, an: an, verb: verb,
          blip: new T.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 }, volume: -22 }).connect(verb),
          pluck: new T.PolySynth(T.FMSynth, { harmonicity: 2.5, modulationIndex: 6, envelope: { attack: 0.003, decay: 0.22, sustain: 0, release: 0.2 }, volume: -16 }).connect(verb),
          click: new T.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -26 }).connect(master),
          kick: new T.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.28, sustain: 0 }, volume: -8 }).connect(master),
          bass: new T.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { Q: 3 }, filterEnvelope: { attack: 0.01, decay: 0.2, baseFrequency: 120, octaves: 2.6 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.2 }, volume: -18 }).connect(master),
          pad: new T.PolySynth(T.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.3, decay: 0.5, sustain: 0.4, release: 1.2 }, volume: -28 }).connect(verb)
        };
      } catch (e) { nodes = null; }
      return nodes;
    }

    a.start = function () {
      if (!global.Tone) return Promise.resolve(false);
      return Promise.resolve(global.Tone.start()).then(function () {
        a.enabled = !!build();
        j.log('audio ' + (a.enabled ? 'on (moteur effects.js)' : 'indisponible'));
        return a.enabled;
      }).catch(function () { return false; });
    };

    a.play = function (name) {
      if (!a.enabled || !build()) return false;
      try {
        if (global.Tone.getContext().state !== 'running') return false;
        var now = global.Tone.now();
        if (name === 'hover') {
          var t = performance.now();
          if (t - lastHover < 70) return false;
          lastHover = t;
          nodes.blip.triggerAttackRelease('C7', 0.02, now);
          return true;
        }
        if (name === 'toggleOn') { nodes.pluck.triggerAttackRelease(['E5', 'B5'], 0.09, now); nodes.click.triggerAttackRelease(0.02, now); return true; }
        if (name === 'toggleOff') { nodes.pluck.triggerAttackRelease(['B4', 'E4'], 0.09, now); nodes.click.triggerAttackRelease(0.02, now); return true; }
        if (name === 'action') { nodes.pluck.triggerAttackRelease(['A4', 'E5'], 0.12, now); nodes.kick.triggerAttackRelease('C2', 0.1, now); return true; }
        if (name === 'combo') { nodes.pluck.triggerAttackRelease(['C5', 'G5', 'C6'], 0.14, now); nodes.kick.triggerAttackRelease('D2', 0.1, now); return true; }
        if (name === 'theme') { nodes.pad.triggerAttackRelease(['C4', 'G4', 'D5'], 0.9, now); return true; }
        if (name === 'alert') { nodes.bass.triggerAttackRelease('F2', 0.3, now); return true; }
        nodes.blip.triggerAttackRelease('E6', 0.04, now);
        return true;
      } catch (e) { return false; }
    };

    a.sample = function () {
      if (!a.enabled || !nodes) { a.level = 0; return 0; }
      try {
        var d = nodes.an.getValue(), s = 0;
        for (var i = 0; i < d.length; i++) s += d[i] * d[i];
        a.level = clamp(Math.sqrt(s / d.length) * 4.5, 0, 1);
      } catch (e) { a.level = 0; }
      return a.level;
    };

    A = { audio: a, note: function (kind, note, dur) {
      if (!a.enabled || !build()) return;
      try {
        var now = global.Tone.now();
        if (kind === 'kick') nodes.kick.triggerAttackRelease(note || 'C2', dur || 0.12, now);
        else if (kind === 'bass') nodes.bass.triggerAttackRelease(note, dur || 0.16, now);
        else if (kind === 'arp') nodes.pluck.triggerAttackRelease(note, dur || 0.12, now);
        else if (kind === 'pad') nodes.pad.triggerAttackRelease(note, dur || 1.4, now);
      } catch (e) { /* ignore */ }
    } };
    return A;
  }

  /** Niveau exploitable même quand Tone n'a pas démarré : 0 sinon. */
  function level(j) { return j.audio && j.audio.enabled ? j.audio.level : 0; }

  // =========================================================== effets continus

  // ---------------------------------------------------------------- bg
  // Champ de milliers de particules dans `world` (donc emporté par la caméra),
  // dérivé par un champ de flux, repoussé par le pointeur, traversé de rayons.

  var bg = null;
  E.define('bg', {
    start: function (j) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var n = j.reduced ? 500 : 2400;
      var c = j.tokens.colors;
      var tints = [c.accent, c.text, c.muted, c.success || c.accent, c.danger || c.accent];
      var pc = new PIXI.ParticleContainer({ dynamicProperties: { vertex: true, position: true, rotation: false, color: true } });
      pc.blendMode = 'add';
      var a = new Array(n);
      for (var i = 0; i < n; i++) {
        var z = rnd(0.18, 1);
        var p = new PIXI.Particle({ texture: texDot(j), x: rnd(0, w), y: rnd(0, h), anchorX: 0.5, anchorY: 0.5 });
        var sc = z * rnd(0.12, 0.55);
        p.scaleX = p.scaleY = sc;
        p.tint = tints[i % tints.length];
        p.alpha = 0.10 + 0.45 * z;
        pc.addParticle(p);
        a[i] = { p: p, x: p.x, y: p.y, z: z, sc: sc, ph: Math.random() * 6.283, a0: p.alpha };
      }
      j.layers.world.addChildAt(pc, 0);
      var god = null;
      if (has('GodrayFilter') && !j.reduced) {
        god = new FX.GodrayFilter({ alpha: 0.42, gain: 0.5, lacunarity: 2.6, angle: 32, parallel: true });
        pc.filters = [god];
        pc.filterArea = new PIXI.Rectangle(0, 0, w, h);
      }
      bg = { pc: pc, a: a, god: god, t: 0, w: w, h: h };
      bg.relay = onLayout(function (jj) {
        bg.w = jj.screen.width; bg.h = jj.screen.height;
        if (pc.filterArea) pc.filterArea = new PIXI.Rectangle(0, 0, bg.w, bg.h);
        if (pc.parent !== jj.layers.world) jj.layers.world.addChildAt(pc, 0);
      });
      return n;
    },
    stop: function (j) {
      if (!bg) return;
      offLayout(bg.relay);
      if (bg.god) { try { bg.pc.filters = []; bg.god.destroy(); } catch (e) { /* ignore */ } }
      try { bg.pc.destroy({ children: true }); } catch (e) { /* ignore */ }
      bg = null;
    },
    update: function (j, dt) {
      if (!bg) return;
      bg.t += dt;
      var w = bg.w, h = bg.h, a = bg.a, lv = level(j);
      var sp = j.reduced ? 0.12 : 1;
      var sec = dt / 1000;
      var T = bg.t / 1000;
      for (var i = 0; i < a.length; i++) {
        var s = a[i];
        var fx = Math.sin(s.y * 0.0042 + T * 0.35 + s.ph) * 26 + Math.cos(s.x * 0.0027 - T * 0.22) * 12;
        var fy = Math.cos(s.x * 0.0038 - T * 0.3 + s.ph) * 22 - 14;
        var dx = s.x - P.x, dy = s.y - P.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 44100) {
          var d = Math.sqrt(d2) || 1;
          var f = (1 - d / 210) * 420;
          fx += (dx / d) * f; fy += (dy / d) * f;
        }
        s.x += fx * s.z * sp * sec;
        s.y += fy * s.z * sp * sec;
        if (s.x < -30) s.x += w + 60; else if (s.x > w + 30) s.x -= w + 60;
        if (s.y < -30) s.y += h + 60; else if (s.y > h + 30) s.y -= h + 60;
        s.p.x = s.x; s.p.y = s.y;
        var pulse = 1 + Math.sin(T * 1.8 + s.ph) * 0.22 + lv * 1.4;
        s.p.scaleX = s.p.scaleY = s.sc * pulse;
        s.p.alpha = clamp(s.a0 * (0.75 + lv * 1.6), 0, 1);
      }
      if (bg.god) { bg.god.time += dt / 1000 * (j.reduced ? 0 : 0.7); }
    }
  });

  // ---------------------------------------------------------------- trail
  // Comète au pointeur : une chaîne de sprites à inertie qui tourne autour du
  // curseur même à l'arrêt, plus des braises émises en continu.

  var trail = null;
  E.define('trail', {
    start: function (j) {
      install(j);
      var n = j.reduced ? 26 : 90;
      var c = j.tokens.colors;
      var pc = new PIXI.ParticleContainer({ dynamicProperties: { vertex: true, position: true, rotation: false, color: true } });
      pc.blendMode = 'add';
      var nodes = new Array(n);
      for (var i = 0; i < n; i++) {
        var t = i / n;
        var p = new PIXI.Particle({ texture: texDot(j), x: P.x, y: P.y, anchorX: 0.5, anchorY: 0.5 });
        // Une comete est une trainee de points distincts : chacun reste petit
        // et peu opaque, sinon le melange additif les fond en une tache
        // blanche au lieu d'une queue.
        p.scaleX = p.scaleY = (1 - t) * 1.25 + 0.22;
        p.tint = i < n * 0.08 ? 0xffffff : c.accent;
        p.alpha = (1 - t) * 0.24 + 0.03;
        pc.addParticle(p);
        nodes[i] = p;
      }
      j.layers.overlay.addChild(pc);
      var sparks = makePool(j, j.layers.overlay, texSpark(j), j.reduced ? 90 : 320, 'add');
      // Historique de la tete, echantillonne a pas de temps fixe : la longueur
      // de la queue se compte en millisecondes, pas en images, donc elle est
      // la meme sur une machine a 60 images/s et sur une a 10.
      var hist = new Array(n);
      for (i = 0; i < n; i++) hist[i] = { x: P.x, y: P.y };
      trail = { pc: pc, nodes: nodes, sparks: sparks, hist: hist, head: 0, acc: 0, t: 0, emit: 0, hx: P.x, hy: P.y, px: P.x, py: P.y };
      return n;
    },
    stop: function () {
      if (!trail) return;
      try { trail.pc.destroy({ children: true }); } catch (e) { /* ignore */ }
      trail.sparks.destroy();
      trail = null;
    },
    update: function (j, dt) {
      if (!trail) return;
      trail.t += dt;
      var c = j.tokens.colors;
      var orb = j.reduced ? 0 : 165;
      var ang = trail.t / 520;
      var tx = P.x + Math.cos(ang) * orb, ty = P.y + Math.sin(ang * 1.3) * orb * 0.85;
      var k = clamp(dt / 90, 0.08, 1);
      trail.hx = lerp(trail.hx, tx, k * 0.85);
      trail.hy = lerp(trail.hy, ty, k * 0.85);
      var nodes = trail.nodes, hist = trail.hist, len = hist.length;
      // un echantillon toutes les 16 ms, interpoles entre la position de
      // l'image precedente et celle-ci quand une image en couvre plusieurs
      trail.acc += dt;
      var steps = 0;
      while (trail.acc >= 16 && steps < len) { trail.acc -= 16; steps++; }
      for (var s2 = 1; s2 <= steps; s2++) {
        var f2 = s2 / steps;
        trail.head = (trail.head + 1) % len;
        hist[trail.head].x = lerp(trail.px, trail.hx, f2);
        hist[trail.head].y = lerp(trail.py, trail.hy, f2);
      }
      trail.px = trail.hx; trail.py = trail.hy;
      for (var i = 0; i < nodes.length; i++) {
        var q = hist[(trail.head - i + len * 2) % len];
        nodes[i].x = q.x; nodes[i].y = q.y;
      }
      trail.emit += dt;
      var step = j.reduced ? 90 : 26;
      while (trail.emit > step) {
        trail.emit -= step;
        var a2 = Math.random() * 6.283;
        trail.sparks.spawn({
          x: trail.hx, y: trail.hy,
          vx: Math.cos(a2) * rnd(60, 300), vy: Math.sin(a2) * rnd(60, 300) - 40,
          ay: 120, drag: 0.94, life: rnd(700, 1700),
          s0: rnd(0.5, 1.5), s1: 0, a0: 0.55, a1: 0,
          tint: Math.random() < 0.35 ? 0xffffff : c.accent
        });
      }
      trail.sparks.update(dt);
    }
  });

  // ---------------------------------------------------------------- glitch
  // Filtres sur l'image rendue : découpe en tranches + séparation RVB, avec
  // des crises périodiques.

  var glitch = null;
  E.define('glitch', {
    start: function (j) {
      install(j);
      if (!has('GlitchFilter') && !has('RGBSplitFilter')) return 0;
      var g = has('GlitchFilter') ? new FX.GlitchFilter({ slices: 14, offset: 22, direction: 0, fillMode: 2, red: [4, 2], green: [-4, 0], blue: [0, -4] }) : null;
      var r = has('RGBSplitFilter') ? new FX.RGBSplitFilter({ red: { x: -6, y: 0 }, green: { x: 0, y: 3 }, blue: { x: 6, y: 0 } }) : null;
      var list = [];
      if (g) list.push(g);
      if (r) list.push(r);
      addStage(j, 'glitch', list);
      glitch = { g: g, r: r, t: 0, next: 400, crisis: 0 };
      return list.length;
    },
    stop: function (j) { delStage(j, 'glitch'); glitch = null; },
    update: function (j, dt) {
      if (!glitch) return;
      glitch.t += dt;
      glitch.next -= dt;
      if (glitch.next <= 0) { glitch.crisis = j.reduced ? 90 : rnd(110, 260); glitch.next = rnd(700, 1900); }
      var crisis = glitch.crisis > 0;
      if (crisis) glitch.crisis -= dt;
      var amp = crisis ? 1 : 0.28;
      if (glitch.g) {
        glitch.g.offset = (j.reduced ? 6 : 30) * amp * rnd(0.6, 1.2);
        glitch.g.direction = crisis ? rnd(-45, 45) : Math.sin(glitch.t / 900) * 8;
        if (!j.reduced) glitch.g.seed = Math.random();
        glitch.g.slices = crisis ? Math.round(rnd(10, 26)) : 8;
      }
      if (glitch.r) {
        var o = (j.reduced ? 3 : 9) * amp;
        var w = Math.sin(glitch.t / 210) * o;
        glitch.r.red = { x: -o - w, y: crisis ? rnd(-5, 5) : 0 };
        glitch.r.green = { x: w * 0.4, y: o * 0.3 };
        glitch.r.blue = { x: o + w, y: crisis ? rnd(-5, 5) : 0 };
      }
    }
  });

  // ---------------------------------------------------------------- tilt
  // Vraie perspective : `layers.scene` (le décor et le monde réunis par le
  // noyau) est rendu dans une `RenderTexture` projetée sur un
  // `PerspectiveMesh` dont les quatre coins suivent le pointeur. La scène
  // reste en place (alpha 0.001), mais elle n'est plus là où on la voit :
  // l'effet déclare donc sa projection au noyau (`layers.setProjection`), qui
  // ramène chaque point de l'écran dans la scène avant de chercher la cible.
  // Un clic sur un bouton *là où il est affiché* touche ce bouton.

  /*
   * Homographie du rectangle (0,0,w,h) vers le quadrilatère des quatre coins
   * du maillage, dans l'ordre haut-gauche, haut-droit, bas-droit, bas-gauche :
   * c'est exactement la projection que `PerspectiveMesh` applique à l'image
   * (`PerspectivePlaneGeometry.updateProjection`). Rendue sous la forme
   *   [A,B,C, D,E,F, G,H,1] avec  X = (A·x + B·y + C) / (G·x + H·y + 1)
   * pour que la matrice s'applique directement à un point de scène en pixels.
   */
  function quadMatrix(w, h, c) {
    var x0 = c[0], y0 = c[1], x1 = c[2], y1 = c[3], x2 = c[4], y2 = c[5], x3 = c[6], y3 = c[7];
    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    var A, B, C, D, E, F, G, H;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      A = x1 - x0; B = x3 - x0; C = x0;
      D = y1 - y0; E = y3 - y0; F = y0;
      G = 0; H = 0;
    } else {
      var den = dx1 * dy2 - dx2 * dy1;
      if (!den) return null;
      G = (dx3 * dy2 - dx2 * dy3) / den;
      H = (dx1 * dy3 - dx3 * dy1) / den;
      A = x1 - x0 + G * x1; B = x3 - x0 + H * x3; C = x0;
      D = y1 - y0 + G * y1; E = y3 - y0 + H * y3; F = y0;
    }
    if (!w || !h) return null;
    return [A / w, B / h, C, D / w, E / h, F, G / w, H / h, 1];
  }
  /** Inverse d'une homographie 3×3 par sa comatrice (le facteur d'échelle ne change pas le point). */
  function invMatrix(m) {
    if (!m) return null;
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!det || !isFinite(det)) return null;
    return [
      e * i - f * h, c * h - b * i, b * f - c * e,
      f * g - d * i, a * i - c * g, c * d - a * f,
      d * h - e * g, b * g - a * h, a * e - b * d
    ];
  }
  function applyMatrix(m, p) {
    if (!m) return { x: p.x, y: p.y };
    var wq = m[6] * p.x + m[7] * p.y + m[8];
    if (!wq) return { x: p.x, y: p.y };
    return { x: (m[0] * p.x + m[1] * p.y + m[2]) / wq, y: (m[3] * p.x + m[4] * p.y + m[5]) / wq };
  }

  var tilt = null;
  function tiltTexture(j) {
    var w = Math.max(2, Math.round(j.screen.width)), h = Math.max(2, Math.round(j.screen.height));
    if (tilt.rt) { try { tilt.rt.destroy(true); } catch (e) { /* ignore */ } }
    tilt.rt = PIXI.RenderTexture.create({ width: w, height: h, resolution: 1, antialias: false });
    tilt.w = w; tilt.h = h;
    if (tilt.mesh) tilt.mesh.texture = tilt.rt;
  }
  E.define('tilt', {
    start: function (j) {
      install(j);
      if (typeof PIXI.PerspectiveMesh !== 'function') return 0;
      tilt = { rt: null, mesh: null, ax: 0, ay: 0, w: 0, h: 0, t: 0, fwd: null, inv: null };
      tiltTexture(j);
      tilt.mesh = new PIXI.PerspectiveMesh({
        texture: tilt.rt, verticesX: 14, verticesY: 14,
        x0: 0, y0: 0, x1: tilt.w, y1: 0, x2: tilt.w, y2: tilt.h, x3: 0, y3: tilt.h
      });
      // Le maillage couvre tout l'écran : laissé testable, il avalerait chaque
      // test de contact (`hitTestRecursive` s'arrête au premier enfant dont
      // `containsPoint` répond, même non interactif) et rendrait la page
      // entière insensible. C'est la projection déclarée plus bas qui porte
      // les clics, pas lui.
      tilt.mesh.eventMode = 'none';
      j.layers.overlay.addChild(tilt.mesh);
      tilt.relay = onLayout(function (jj) {
        tiltTexture(jj);
        if (tilt.mesh.parent !== jj.layers.overlay) jj.layers.overlay.addChild(tilt.mesh);
      });
      if (j.layers.setProjection) {
        j.layers.setProjection({
          project: function (p) { return applyMatrix(tilt && tilt.fwd, p); },
          unproject: function (p) { return applyMatrix(tilt && tilt.inv, p); }
        });
      }
      return 4;
    },
    stop: function (j) {
      if (!tilt) return;
      offLayout(tilt.relay);
      if (j.layers.setProjection) j.layers.setProjection(null);
      j.layers.scene.alpha = 1;
      try { tilt.mesh.destroy(); } catch (e) { /* ignore */ }
      try { tilt.rt.destroy(true); } catch (e) { /* ignore */ }
      tilt = null;
    },
    update: function (j, dt) {
      if (!tilt || !tilt.mesh) return;
      var w = tilt.w, h = tilt.h;
      tilt.t += dt;
      var T = tilt.t / 1000;
      // dérive propre : la perspective respire même pointeur immobile
      var dr = j.reduced ? 0 : 0.34;
      var nx = clamp((P.x / w) * 2 - 1 + Math.sin(T * 0.62) * dr, -1, 1);
      var ny = clamp((P.y / h) * 2 - 1 + Math.cos(T * 0.47) * dr, -1, 1);
      if (j.reduced) { nx = 0.35; ny = -0.2; }
      var k = j.reduced ? 1 : clamp(dt / 140, 0.05, 1);
      tilt.ax = lerp(tilt.ax, nx, k);
      tilt.ay = lerp(tilt.ay, ny, k);
      // marge de 6 % : quelle que soit l'inclinaison, les coins restent dans l'écran
      var m = 0.06, amp = 0.06;
      var mx = w * m, my = h * m;
      var ex = w * amp * tilt.ax, ey = h * amp * tilt.ay;
      var sk = w * amp * 0.5 * tilt.ax, sy2 = h * amp * 0.5 * tilt.ay;
      var x0 = mx + ex - sk, y0 = my + ey - sy2;
      var x1 = w - mx + ex + sk, y1 = my - ey - sy2;
      var x2 = w - mx - ex + sk, y2 = h - my - ey + sy2;
      var x3 = mx - ex - sk, y3 = h - my + ey + sy2;
      if (tilt.mesh.setCorners) tilt.mesh.setCorners(x0, y0, x1, y1, x2, y2, x3, y3);
      else { tilt.mesh.x0 = x0; tilt.mesh.y0 = y0; tilt.mesh.x1 = x1; tilt.mesh.y1 = y1; tilt.mesh.x2 = x2; tilt.mesh.y2 = y2; tilt.mesh.x3 = x3; tilt.mesh.y3 = y3; }
      // La projection suit les coins : le noyau s'en sert pour porter les
      // clics là où l'image est affichée (scène -> écran et retour).
      tilt.fwd = quadMatrix(w, h, [x0, y0, x1, y1, x2, y2, x3, y3]);
      tilt.inv = invMatrix(tilt.fwd);
      // Capture de la scène entière (décor + monde) à pleine opacité dans la
      // texture : les cadres des panneaux vivent dans `background` et doivent
      // basculer avec leur contenu, sinon la page se plie derrière des cadres
      // restés plats. La scène est ensuite effacée pour le rendu final, seul
      // le maillage est visible à l'écran.
      var scene = j.layers.scene;
      tilt.mesh.visible = false;
      scene.alpha = 1;
      try {
        j.app.renderer.render({ container: scene, target: tilt.rt, clear: true });
      } catch (e) { /* ignore */ } finally {
        scene.alpha = 0.001;
        tilt.mesh.visible = true;
      }
    }
  });

  // ---------------------------------------------------------------- sound
  // Démarre le moteur sonore et montre ce qu'on entend : couronne de barres
  // radiales + spectre au sol, nourris par l'analyseur.

  var sound = null;
  function makeBars(j, layer, n, tint) {
    var pc = new PIXI.ParticleContainer({ dynamicProperties: { vertex: true, position: true, rotation: true, color: true } });
    pc.blendMode = 'add';
    var a = new Array(n);
    for (var i = 0; i < n; i++) {
      var p = new PIXI.Particle({ texture: texBar(j), x: 0, y: 0, anchorX: 0.5, anchorY: 1 });
      p.tint = tint; p.alpha = 0.75;
      pc.addParticle(p);
      a[i] = p;
    }
    layer.addChild(pc);
    return { pc: pc, a: a };
  }
  E.define('sound', {
    start: function (j) {
      install(j);
      audioEngine(j);
      j.audio.start();
      var c = j.tokens.colors;
      var ring = makeBars(j, j.layers.overlay, j.reduced ? 28 : 64, c.accent);
      var floor = makeBars(j, j.layers.overlay, j.reduced ? 20 : 48, c.text);
      sound = { ring: ring, floor: floor, t: 0 };
      return ring.a.length + floor.a.length;
    },
    stop: function (j) {
      if (!sound) return;
      j.audio.enabled = false;
      j.audio.level = 0;
      try { sound.ring.pc.destroy({ children: true }); sound.floor.pc.destroy({ children: true }); } catch (e) { /* ignore */ }
      sound = null;
    },
    update: function (j, dt) {
      if (!sound) return;
      sound.t += dt;
      var w = j.screen.width, h = j.screen.height;
      var T = sound.t / 1000;
      var lv = level(j);
      var R = Math.min(w, h) * 0.34;
      var cx = w / 2, cy = h / 2;
      var ring = sound.ring.a;
      for (var i = 0; i < ring.length; i++) {
        var a = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        var env = 0.35 + Math.abs(Math.sin(T * 2.2 + i * 0.5)) * 0.4 + lv * 2.4;
        var len = clamp(env, 0.1, 3) * (j.reduced ? 22 : 46);
        var p = ring[i];
        p.x = cx + Math.cos(a) * R; p.y = cy + Math.sin(a) * R;
        p.rotation = a + Math.PI / 2;
        p.scaleX = 0.55; p.scaleY = len / 10;
        p.alpha = 0.35 + clamp(lv * 2, 0, 0.55);
      }
      var fl = sound.floor.a;
      var bw = w / fl.length;
      for (i = 0; i < fl.length; i++) {
        var e2 = 0.3 + Math.abs(Math.sin(T * 3.1 + i * 0.8)) * 0.35 + lv * 3;
        var lh = clamp(e2, 0.08, 4) * (j.reduced ? 24 : 40);
        var q = fl[i];
        q.x = bw * (i + 0.5); q.y = h - 6;
        q.rotation = 0;
        q.scaleX = (bw - 5) / 10; q.scaleY = lh / 10;
        q.alpha = 0.30 + clamp(lv * 1.6, 0, 0.5);
      }
    }
  });

  // ---------------------------------------------------------------- magnet
  // Les objets d'interface se laissent attirer par le pointeur (attraction
  // seule : un objet ne peut donc pas sortir de l'écran, il se rapproche d'un
  // point qui y est). Un champ dessiné rend la force visible.

  var magnet = null;
  function uiItems(j) {
    var out = [];
    ['controls', 'actions', 'nav'].forEach(function (k) {
      var s = j.slots[k];
      if (!s) return;
      s.items.forEach(function (it) { out.push({ it: it, slot: s, bx: it.position.x, by: it.position.y, bs: it.scale.x }); });
    });
    return out;
  }
  E.define('magnet', {
    start: function (j) {
      install(j);
      var g = new PIXI.Graphics();
      j.layers.overlay.addChild(g);
      magnet = { items: uiItems(j), g: g, t: 0 };
      magnet.relay = onLayout(function (jj) { magnet.items = uiItems(jj); if (g.parent !== jj.layers.overlay) jj.layers.overlay.addChild(g); });
      return magnet.items.length;
    },
    stop: function () {
      if (!magnet) return;
      offLayout(magnet.relay);
      magnet.items.forEach(function (e) {
        if (e.it.destroyed) return;
        e.it.position.set(e.bx, e.by);
        e.it.scale.set(e.bs);
      });
      try { magnet.g.destroy(); } catch (e) { /* ignore */ }
      magnet = null;
    },
    update: function (j, dt) {
      if (!magnet) return;
      magnet.t += dt;
      var w = j.screen.width, h = j.screen.height;
      var reach = Math.sqrt(w * w + h * h) * 0.55;
      var pull = j.reduced ? 8 : 30;
      var g = magnet.g;
      g.clear();
      var near = [];
      magnet.items.forEach(function (e) {
        var it = e.it;
        if (it.destroyed || !it.parent) return;
        var b = it.getBounds();
        var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        var dx = P.x - cx, dy = P.y - cy;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var f = clamp(1 - d / reach, 0, 1);
        f = f * f;
        var sc = it.parent.worldTransform ? (it.parent.worldTransform.a || 1) : 1;
        var ox = (dx / d) * pull * f / (sc || 1);
        var oy = (dy / d) * pull * f / (sc || 1);
        var k = clamp(dt / 120, 0.05, 1);
        it.position.set(lerp(it.position.x, e.bx + ox, k), lerp(it.position.y, e.by + oy, k));
        it.scale.set(lerp(it.scale.x, e.bs * (1 + f * 0.16), k));
        if (f > 0.45) near.push({ x: cx + ox * sc, y: cy + oy * sc, f: f });
      });
      var c = j.tokens.colors;
      var pulse = 1 + Math.sin(magnet.t / 260) * 0.45;
      g.circle(P.x, P.y, 34 * pulse).stroke({ width: 4, color: c.accent, alpha: 0.9 });
      g.circle(P.x, P.y, 78 * pulse).stroke({ width: 2.5, color: c.accent, alpha: 0.55 });
      g.circle(P.x, P.y, 150 * (2 - pulse)).stroke({ width: 2, color: c.accent, alpha: 0.3 });
      // couronne de graduations qui tourne : le champ vit sans bouger la souris
      var spin = magnet.t / 900;
      for (var q = 0; q < 24; q++) {
        var qa = spin + (q / 24) * Math.PI * 2;
        var r0 = 96 + Math.sin(magnet.t / 180 + q) * 12;
        g.moveTo(P.x + Math.cos(qa) * r0, P.y + Math.sin(qa) * r0)
          .lineTo(P.x + Math.cos(qa) * (r0 + 26), P.y + Math.sin(qa) * (r0 + 26))
          .stroke({ width: 2, color: q % 6 === 0 ? c.text : c.accent, alpha: 0.6 });
      }
      near.forEach(function (n) {
        g.moveTo(P.x, P.y).lineTo(n.x, n.y).stroke({ width: 2, color: c.accent, alpha: 0.14 + n.f * 0.45 });
      });
    }
  });

  // ---------------------------------------------------------------- cursor
  // Curseur dessiné : réticule, halo large, lignes de visée plein écran,
  // satellites, et magnétisme sur l'objet survolé.

  var cursorFx = null;
  E.define('cursor', {
    start: function (j) {
      install(j);
      var lay = j.layers.cursor;
      var glow = new PIXI.Sprite(texDot(j));
      glow.anchor.set(0.5);
      glow.scale.set(j.reduced ? 4 : 7);
      glow.alpha = 0.55;
      glow.tint = j.tokens.colors.accent;
      glow.blendMode = 'add';
      var g = new PIXI.Graphics();
      var sats = new PIXI.Container();
      var satList = [];
      for (var i = 0; i < 9; i++) {
        var s = new PIXI.Sprite(texSpark(j));
        s.anchor.set(0.5); s.tint = 0xffffff; s.alpha = 0.9; s.blendMode = 'add';
        sats.addChild(s); satList.push(s);
      }
      lay.addChild(glow, g, sats);
      var st = { x: P.x, y: P.y, w: 0, h: 0, r: 0 };
      var cs = j.app.renderer.events.cursorStyles;
      var prev = { def: cs.default, ptr: cs.pointer };
      cs.default = 'none'; cs.pointer = 'none';
      try { (j.canvas || j.app.canvas).style.cursor = 'none'; } catch (e) { /* ignore */ }
      cursorFx = { glow: glow, g: g, sats: sats, satList: satList, st: st, prev: prev, t: 0, sq: 1 };
      return 1 + satList.length;
    },
    stop: function (j) {
      if (!cursorFx) return;
      var cs = j.app.renderer.events.cursorStyles;
      cs.default = cursorFx.prev.def; cs.pointer = cursorFx.prev.ptr;
      try { (j.canvas || j.app.canvas).style.cursor = cursorFx.prev.def || 'default'; } catch (e) { /* ignore */ }
      try { cursorFx.glow.destroy(); cursorFx.g.destroy(); cursorFx.sats.destroy({ children: true }); } catch (e) { /* ignore */ }
      cursorFx = null;
    },
    update: function (j, dt) {
      if (!cursorFx) return;
      cursorFx.t += dt;
      var c = j.tokens.colors;
      var w = j.screen.width, h = j.screen.height;
      var st = cursorFx.st;
      // magnétisme : si le pointeur est sur un objet cliquable, le réticule
      // s'ancre sur lui et épouse sa forme
      var target = null;
      try {
        var hit = j.app.renderer.events.rootBoundary.hitTest(P.x, P.y);
        var n = hit;
        while (n) { if (n.isButton || n.isToggle) { target = n; break; } n = n.parent; }
      } catch (e) { /* ignore */ }
      var tx = P.x, ty = P.y, tw = 0, th = 0;
      if (target && !target.destroyed) {
        var b = target.getBounds();
        tx = b.x + b.width / 2; ty = b.y + b.height / 2;
        tw = b.width / 2 + 7; th = b.height / 2 + 7;
      }
      var k = j.reduced ? 1 : clamp(dt / 90, 0.08, 1);
      st.x = lerp(st.x, tx, k * 0.9); st.y = lerp(st.y, ty, k * 0.9);
      st.w = lerp(st.w, tw, k * 0.7); st.h = lerp(st.h, th, k * 0.7);
      cursorFx.sq = lerp(cursorFx.sq, P.down ? 0.72 : 1, k * 0.8);

      cursorFx.glow.position.set(P.x, P.y);
      cursorFx.glow.alpha = 0.42 + (P.down ? 0.25 : 0) + Math.sin(cursorFx.t / 420) * 0.08;

      var g = cursorFx.g;
      g.clear();
      // lignes de visée plein écran
      g.moveTo(0, P.y).lineTo(w, P.y).stroke({ width: 1, color: c.accent, alpha: 0.22 });
      g.moveTo(P.x, 0).lineTo(P.x, h).stroke({ width: 1, color: c.accent, alpha: 0.22 });
      var sq = cursorFx.sq;
      if (st.w > 3) {
        var rw = st.w * sq, rh = st.h * sq;
        g.roundRect(st.x - rw, st.y - rh, rw * 2, rh * 2, 10).stroke({ width: 2, color: c.accent, alpha: 0.95 });
        // coins
        var L = Math.min(14, rw, rh);
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (s) {
          var X = st.x + s[0] * rw, Y = st.y + s[1] * rh;
          g.moveTo(X - s[0] * L, Y).lineTo(X, Y).lineTo(X, Y - s[1] * L).stroke({ width: 3, color: c.text, alpha: 0.9 });
        });
      } else {
        var r = 13 * sq;
        g.circle(st.x, st.y, r).stroke({ width: 2, color: c.text, alpha: 0.95 });
        g.circle(st.x, st.y, 3.2).fill({ color: c.accent });
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          g.moveTo(st.x + d[0] * (r + 5), st.y + d[1] * (r + 5))
            .lineTo(st.x + d[0] * (r + 13), st.y + d[1] * (r + 13))
            .stroke({ width: 2, color: c.accent, alpha: 0.85 });
        });
      }
      // Couronne de graduations en rotation : au repos, le curseur doit rester
      // vivant sans que le pointeur bouge — c'est elle qui porte le mouvement.
      if (!j.reduced) {
        var ar = cursorFx.t / 260, ticks = 18;
        for (var q = 0; q < ticks; q++) {
          var aa = ar + (q / ticks) * Math.PI * 2;
          var ca = Math.cos(aa), sa = Math.sin(aa);
          var r0 = 44, r1 = q % 3 === 0 ? 60 : 53;
          g.moveTo(P.x + ca * r0, P.y + sa * r0)
            .lineTo(P.x + ca * r1, P.y + sa * r1)
            .stroke({ width: 2, color: q % 3 === 0 ? c.text : c.accent, alpha: 0.75 });
        }
      }
      var A2 = cursorFx.t / (j.reduced ? 1400 : 420);
      cursorFx.satList.forEach(function (s, i) {
        var a = A2 + (i / cursorFx.satList.length) * Math.PI * 2;
        var rr = 62 + Math.sin(cursorFx.t / 500 + i) * 14;
        s.position.set(P.x + Math.cos(a) * rr, P.y + Math.sin(a) * rr * 0.78);
        s.scale.set(1.5 + Math.sin(cursorFx.t / 300 + i) * 0.4);
        s.tint = i % 2 ? c.accent : 0xffffff;
      });
    }
  });

  // ---------------------------------------------------------------- rain
  // Averse en `ParticleContainer` devant toute la scène, avec vent, gerbes au
  // sol et éclairs.

  var rain = null;
  E.define('rain', {
    start: function (j) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var n = j.reduced ? 260 : 1400;
      var c = j.tokens.colors;
      var pc = new PIXI.ParticleContainer({ dynamicProperties: { vertex: true, position: true, rotation: true, color: true } });
      var a = new Array(n);
      for (var i = 0; i < n; i++) {
        var z = rnd(0.3, 1);
        var p = new PIXI.Particle({ texture: texStreak(j), x: rnd(0, w), y: rnd(-h, h), anchorX: 0.5, anchorY: 0.5 });
        p.scaleX = 0.4 + z * 0.8; p.scaleY = 0.7 + z * 1.6;
        p.tint = i % 9 === 0 ? c.accent : c.text;
        p.alpha = 0.10 + z * 0.35;
        pc.addParticle(p);
        a[i] = { p: p, x: p.x, y: p.y, z: z };
      }
      j.layers.overlay.addChild(pc);
      var splash = makePool(j, j.layers.overlay, texSpark(j), j.reduced ? 40 : 200);
      var flash = new PIXI.Graphics().rect(0, 0, w, h).fill({ color: 0xffffff });
      flash.alpha = 0;
      j.layers.overlay.addChild(flash);
      rain = { pc: pc, a: a, splash: splash, flash: flash, t: 0, next: 2600, w: w, h: h };
      rain.relay = onLayout(function (jj) {
        rain.w = jj.screen.width; rain.h = jj.screen.height;
        flash.clear().rect(0, 0, rain.w, rain.h).fill({ color: 0xffffff });
        if (pc.parent !== jj.layers.overlay) jj.layers.overlay.addChild(pc);
      });
      return n;
    },
    stop: function () {
      if (!rain) return;
      offLayout(rain.relay);
      try { rain.pc.destroy({ children: true }); rain.flash.destroy(); } catch (e) { /* ignore */ }
      rain.splash.destroy();
      rain = null;
    },
    update: function (j, dt) {
      if (!rain) return;
      rain.t += dt;
      var sec = dt / 1000;
      var w = rain.w, h = rain.h;
      var wind = (j.reduced ? 20 : 90) + Math.sin(rain.t / 1800) * 60;
      var speed = j.reduced ? 380 : 1150;
      var c = j.tokens.colors;
      for (var i = 0; i < rain.a.length; i++) {
        var s = rain.a[i];
        s.y += speed * s.z * sec;
        s.x += wind * s.z * sec;
        if (s.y > h + 20) {
          if (Math.random() < 0.25) {
            rain.splash.spawn({
              x: s.x, y: h - rnd(0, 6), vx: rnd(-90, 90), vy: rnd(-180, -60), ay: 620,
              life: rnd(260, 520), s0: rnd(0.25, 0.6), s1: 0, a0: 0.55, a1: 0, tint: c.text
            });
          }
          s.y = rnd(-220, -10); s.x = rnd(-80, w + 80);
        }
        if (s.x > w + 40) s.x -= w + 80; else if (s.x < -40) s.x += w + 80;
        s.p.x = s.x; s.p.y = s.y;
        s.p.rotation = Math.atan2(speed * s.z, wind * s.z) - Math.PI / 2;
      }
      rain.splash.update(dt);
      rain.next -= dt;
      if (rain.next <= 0 && !j.reduced) {
        rain.next = rnd(2600, 6200);
        rain.flash.alpha = 0.45;
        if (gsap) gsap.to(rain.flash, { alpha: 0, duration: 0.55, ease: 'power3.out', overwrite: true });
        else rain.flash.alpha = 0;
      } else if (!gsap && rain.flash.alpha > 0) {
        rain.flash.alpha = Math.max(0, rain.flash.alpha - dt / 500);
      }
    }
  });

  // ------------------------------------------------------------- shaketext
  // Chaque texte de la scène tremble et se dédouble en deux fantômes colorés
  // (aberration chromatique faite d'objets, pas d'un filtre par texte).

  var shaketext = null;
  function collectTexts(root, out, depth) {
    if (!root || depth > 8 || root.destroyed) return out;
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k._fxGhost) continue;
      if (k instanceof PIXI.Text) out.push(k);
      else collectTexts(k, out, depth + 1);
    }
    return out;
  }
  function makeGhosts(j) {
    var list = collectTexts(j.layers.world, [], 0);
    var c = j.tokens.colors;
    return list.map(function (t, i) {
      var g1 = null, g2 = null;
      try {
        var stl = t.style && t.style.clone ? t.style.clone() : t.style;
        g1 = new PIXI.Text({ text: t.text, style: stl });
        g2 = new PIXI.Text({ text: t.text, style: t.style && t.style.clone ? t.style.clone() : t.style });
        g1._fxGhost = g2._fxGhost = true;
        g1.tint = 0xff3b6b; g2.tint = 0x2ee6ff;
        g1.alpha = g2.alpha = 0.7;
        g1.blendMode = g2.blendMode = 'add';
        if (t.anchor) { g1.anchor.set(t.anchor.x, t.anchor.y); g2.anchor.set(t.anchor.x, t.anchor.y); }
        g1.scale.set(t.scale.x, t.scale.y); g2.scale.set(t.scale.x, t.scale.y);
        var idx = t.parent.getChildIndex(t);
        t.parent.addChildAt(g2, idx);
        t.parent.addChildAt(g1, idx);
      } catch (e) { g1 = g2 = null; }
      return { t: t, g1: g1, g2: g2, bx: t.position.x, by: t.position.y, br: t.rotation, ph: i * 1.7 };
    });
  }
  E.define('shaketext', {
    start: function (j) {
      install(j);
      shaketext = { list: makeGhosts(j), t: 0 };
      shaketext.relay = onLayout(function (jj) {
        // les emplacements ont été reconstruits : les fantômes sont partis avec
        shaketext.list = makeGhosts(jj);
      });
      return shaketext.list.length;
    },
    stop: function () {
      if (!shaketext) return;
      offLayout(shaketext.relay);
      shaketext.list.forEach(function (e) {
        if (e.g1 && !e.g1.destroyed) { try { e.g1.parent && e.g1.parent.removeChild(e.g1); e.g1.destroy(); } catch (x) { /* ignore */ } }
        if (e.g2 && !e.g2.destroyed) { try { e.g2.parent && e.g2.parent.removeChild(e.g2); e.g2.destroy(); } catch (x) { /* ignore */ } }
        if (!e.t.destroyed) { e.t.position.set(e.bx, e.by); e.t.rotation = e.br; }
      });
      shaketext = null;
    },
    update: function (j, dt) {
      if (!shaketext) return;
      shaketext.t += dt;
      var T = shaketext.t;
      var amp = j.reduced ? 1.2 : 4.2;
      var gap = j.reduced ? 2.5 : 6.5;
      shaketext.list.forEach(function (e) {
        var t = e.t;
        if (t.destroyed || !t.parent) return;
        var jx = Math.sin(T / 47 + e.ph) * amp + (j.reduced ? 0 : rnd(-1, 1) * amp * 0.5);
        var jy = Math.cos(T / 39 + e.ph * 1.3) * amp + (j.reduced ? 0 : rnd(-1, 1) * amp * 0.5);
        t.position.set(e.bx + jx, e.by + jy);
        t.rotation = e.br + Math.sin(T / 220 + e.ph) * (j.reduced ? 0.004 : 0.02);
        var o = gap * (0.7 + Math.sin(T / 130 + e.ph) * 0.5);
        if (e.g1 && !e.g1.destroyed) {
          e.g1.position.set(t.position.x - o, t.position.y - o * 0.4);
          e.g1.rotation = t.rotation;
          if (e.g1.text !== t.text) e.g1.text = t.text;
        }
        if (e.g2 && !e.g2.destroyed) {
          e.g2.position.set(t.position.x + o, t.position.y + o * 0.4);
          e.g2.rotation = t.rotation;
          if (e.g2.text !== t.text) e.g2.text = t.text;
        }
      });
    }
  });

  // ---------------------------------------------------------------- crt
  // Tube cathodique : courbure, lignes, bruit, vignettage — sur l'image
  // rendue entière — plus une bande de balayage qui descend.

  var crt = null;
  E.define('crt', {
    start: function (j) {
      install(j);
      if (!has('CRTFilter')) return 0;
      var f = new FX.CRTFilter({
        curvature: 3.2, lineWidth: 3.2, lineContrast: 0.42, verticalLine: false,
        noise: 0.26, noiseSize: 1.1, vignetting: 0.34, vignettingAlpha: 0.95, vignettingBlur: 0.35, seed: Math.random()
      });
      // En portrait etroit, la courbure et le vignettage du tube mangent le
      // haut et le bas de la page : on les rentre pour garder le texte lisible.
      function fit(jj) {
        var portrait = jj.screen.width < jj.screen.height;
        f.curvature = portrait ? 1.4 : 3.2;
        f.vignetting = portrait ? 0.16 : 0.34;
        f.vignettingAlpha = portrait ? 0.62 : 0.95;
        f.noise = portrait ? 0.18 : 0.26;
      }
      fit(j);
      addStage(j, 'crt', f);
      var w = j.screen.width, h = j.screen.height;
      var band = new PIXI.Graphics();
      var steps = 14, bh = 120;
      for (var i = 0; i < steps; i++) {
        var t = i / (steps - 1);
        band.rect(0, (bh / steps) * i, 4000, bh / steps + 1).fill({ color: 0xffffff, alpha: 0.05 * Math.sin(t * Math.PI) });
      }
      band.blendMode = 'add';
      band.position.set(0, -bh);
      j.layers.overlay.addChild(band);
      crt = { f: f, band: band, y: -bh, bh: bh, t: 0 };
      crt.relay = onLayout(function (jj) {
        if (band.parent !== jj.layers.overlay) jj.layers.overlay.addChild(band);
        fit(jj);
      });
      return 1;
    },
    stop: function (j) {
      if (!crt) return;
      offLayout(crt.relay);
      delStage(j, 'crt');
      try { crt.band.destroy(); } catch (e) { /* ignore */ }
      crt = null;
    },
    update: function (j, dt) {
      if (!crt) return;
      crt.t += dt;
      if (!j.reduced) {
        crt.f.time += dt / 1000 * 3.2;
        crt.f.seed = Math.random();
      }
      crt.f.lineContrast = 0.36 + Math.sin(crt.t / 900) * 0.08;
      var h = j.screen.height;
      crt.y += (j.reduced ? 60 : 320) * dt / 1000;
      if (crt.y > h) crt.y = -crt.bh - rnd(0, h * 0.5);
      crt.band.position.set(0, crt.y);
    }
  });

  // ---------------------------------------------------------------- drunk
  // Caméra qui tangue (rotation compensée par un dézoom : rien ne sort de
  // l'écran) + déformation en bulle + vision double.

  var drunk = null;
  E.define('drunk', {
    start: function (j) {
      install(j);
      var tw = [];
      var rot = 0.038, zoomLo = 0.90, zoomHi = 0.965;
      j.camera.rotate(-rot, { duration: 0 });
      j.camera.zoom(zoomLo, { duration: 0 });
      j.camera.pan(-20, -12, { duration: 0 });
      if (gsap && !j.reduced) {
        var a = j.camera.rotate(rot, { duration: 2300, ease: 'sine.inOut' });
        var b = j.camera.zoom(zoomHi, { duration: 1700, ease: 'sine.inOut' });
        var c = j.camera.pan(20, 12, { duration: 3100, ease: 'sine.inOut' });
        [a, b, c].forEach(function (t) { if (t) { t.repeat(-1); t.yoyo(true); tw.push(t); } });
      }
      var f = [];
      if (has('BulgePinchFilter') && !j.reduced) f.push(new FX.BulgePinchFilter({ center: { x: 0.5, y: 0.5 }, radius: 700, strength: 0.28 }));
      if (has('RGBSplitFilter')) f.push(new FX.RGBSplitFilter({ red: { x: -5, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 5, y: 0 } }));
      if (f.length) addStage(j, 'drunk', f);
      drunk = { tw: tw, f: f, t: 0 };
      return 1 + f.length;
    },
    stop: function (j) {
      if (!drunk) return;
      drunk.tw.forEach(function (t) { try { t.kill(); } catch (e) { /* ignore */ } });
      delStage(j, 'drunk');
      j.camera.reset({ duration: j.reduced ? 0 : 500 });
      drunk = null;
    },
    update: function (j, dt) {
      if (!drunk) return;
      drunk.t += dt;
      var T = drunk.t / 1000;
      drunk.f.forEach(function (f) {
        if (f.radius !== undefined) {
          f.strength = 0.20 + Math.sin(T * 0.8) * 0.16;
          f.center = { x: 0.5 + Math.sin(T * 0.45) * 0.16, y: 0.5 + Math.cos(T * 0.33) * 0.14 };
        } else if (f.red !== undefined) {
          var o = j.reduced ? 3 : 6 + Math.sin(T * 1.1) * 4;
          f.red = { x: -o, y: Math.sin(T * 0.7) * 2 };
          f.blue = { x: o, y: -Math.sin(T * 0.7) * 2 };
        }
      });
    }
  });

  // ---------------------------------------------------------------- music
  // Boucle jouée par Tone.js, cadencée par une horloge interne : les visuels
  // (anneaux de pulsation, colonnes latérales, bloom) suivent la même horloge
  // et existent donc même si le contexte audio n'a pas pu démarrer.

  var music = null;
  var SCALE = ['C3', 'D#3', 'F3', 'G3', 'A#3', 'C4', 'D#4', 'F4', 'G4', 'A#4', 'C5', 'D#5'];
  var BASS = ['C2', 'C2', 'G1', 'A#1'];
  E.define('music', {
    start: function (j) {
      install(j);
      audioEngine(j);
      j.audio.start();
      var bloom = has('AdvancedBloomFilter') ? new FX.AdvancedBloomFilter({ threshold: 0.42, bloomScale: 0.6, brightness: 1.0, blur: 7, quality: 4 }) : null;
      if (bloom) addStage(j, 'music', bloom);
      var rings = new PIXI.Graphics();
      j.layers.overlay.addChild(rings);
      var cols = makeBars(j, j.layers.overlay, j.reduced ? 12 : 30, j.tokens.colors.accent);
      music = { bloom: bloom, rings: rings, cols: cols, t: 0, step: -1, env: 0, bar: 0, pulses: [] };
      music.relay = onLayout(function (jj) { if (rings.parent !== jj.layers.overlay) jj.layers.overlay.addChild(rings); });
      return (bloom ? 1 : 0) + cols.a.length;
    },
    stop: function (j) {
      if (!music) return;
      offLayout(music.relay);
      delStage(j, 'music');
      try { music.rings.destroy(); music.cols.pc.destroy({ children: true }); } catch (e) { /* ignore */ }
      music = null;
    },
    update: function (j, dt) {
      if (!music) return;
      music.t += dt;
      var spb = 60000 / 112 / 4;                 // double-croche à 112 bpm
      var step = Math.floor(music.t / spb);
      var w = j.screen.width, h = j.screen.height;
      var c = j.tokens.colors;
      if (step !== music.step) {
        var passed = Math.min(4, step - music.step);
        for (var s = step - passed + 1; s <= step; s++) {
          var i16 = ((s % 16) + 16) % 16;
          if (i16 % 4 === 0) {
            if (A) A.note('kick', 'C2', 0.12);
            music.env = 1;
            music.pulses.push({ r: 10, a: 0.8, big: true });
          }
          if (i16 % 2 === 0 && A) A.note('bass', BASS[(Math.floor(s / 4)) % BASS.length], 0.14);
          if (i16 % 2 === 1) {
            var n = SCALE[(s * 5 + Math.floor(s / 16) * 3) % SCALE.length];
            if (A) A.note('arp', n, 0.1);
            music.env = Math.max(music.env, 0.65);
            music.pulses.push({ r: 4, a: 0.5, big: false });
          }
          if (i16 === 0 && A && s % 64 === 0) A.note('pad', ['C4', 'D#4', 'G4'], 2.2);
        }
        music.step = step;
      }
      music.env = Math.max(0, music.env - dt / 420);
      var lv = Math.max(music.env, level(j) * 1.6);
      if (music.bloom) {
        music.bloom.bloomScale = 0.35 + lv * 1.5;
        music.bloom.brightness = 0.95 + lv * 0.35;
        music.bloom.threshold = clamp(0.5 - lv * 0.28, 0.12, 0.6);
      }
      var g = music.rings;
      g.clear();
      var cx = w / 2, cy = h / 2;
      var keep = [];
      music.pulses.forEach(function (p) {
        p.r += (p.big ? 620 : 380) * dt / 1000;
        p.a -= dt / (p.big ? 900 : 620);
        if (p.a > 0 && p.r < Math.max(w, h)) {
          g.circle(cx, cy, p.r).stroke({ width: p.big ? 4 : 2, color: p.big ? c.accent : c.text, alpha: clamp(p.a, 0, 1) * 0.55 });
          keep.push(p);
        }
      });
      music.pulses = keep.slice(-26);
      var a = music.cols.a, n = a.length, half = n / 2;
      for (var i = 0; i < n; i++) {
        var leftSide = i < half;
        var k = leftSide ? i : i - half;
        var y = (h / half) * (k + 0.5);
        var e = 0.25 + Math.abs(Math.sin(music.t / 240 + i * 0.7)) * 0.3 + lv * 1.5;
        var len = clamp(e, 0.08, 2.4) * (j.reduced ? 26 : 58);
        var p2 = a[i];
        p2.x = leftSide ? 0 : w;
        p2.y = y;
        p2.rotation = leftSide ? -Math.PI / 2 : Math.PI / 2;
        p2.scaleX = ((h / half) - 6) / 10;
        p2.scaleY = len / 10;
        p2.alpha = 0.3 + clamp(lv * 0.6, 0, 0.45);
        p2.tint = c.accent;
      }
    }
  });

  // ========================================================= effets ponctuels

  function flash(j, color, alpha, ms) {
    var w = j.screen.width, h = j.screen.height;
    var g = new PIXI.Graphics().rect(0, 0, w, h).fill({ color: color });
    g.alpha = alpha;
    g.blendMode = 'add';
    j.layers.overlay.addChild(g);
    if (gsap && !j.reduced) gsap.to(g, { alpha: 0, duration: ms / 1000, ease: 'power3.out', onComplete: function () { try { g.destroy(); } catch (e) { /* ignore */ } } });
    else setTimeout(function () { try { g.destroy(); } catch (e) { /* ignore */ } }, 60);
  }

  /** Anneau de choc dessiné, indépendant du filtre. */
  function ring(j, x, y, color, maxR, ms, width) {
    var g = new PIXI.Graphics();
    g.blendMode = 'add';
    j.layers.overlay.addChild(g);
    var st = { r: 6, a: 1 };
    function draw() { g.clear().circle(x, y, st.r).stroke({ width: (width || 6) * st.a, color: color, alpha: st.a }); }
    draw();
    if (gsap && !j.reduced) {
      gsap.to(st, { r: maxR, a: 0, duration: ms / 1000, ease: 'power2.out', onUpdate: draw, onComplete: function () { try { g.destroy(); } catch (e) { /* ignore */ } } });
    } else { setTimeout(function () { try { g.destroy(); } catch (e) { /* ignore */ } }, 80); }
    return g;
  }

  function firePoint(j, opts) {
    var w = j.screen.width, h = j.screen.height;
    var x = opts && opts.x != null ? opts.x : (P.seen ? P.x : w / 2);
    var y = opts && opts.y != null ? opts.y : (P.seen ? P.y : h / 2);
    return { x: clamp(x, 0, w), y: clamp(y, 0, h) };
  }

  // -------------------------------------------------------------- confetti
  E.define('confetti', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var c = j.tokens.colors;
      var tints = [c.accent, c.text, c.success || 0x5ddc9a, c.danger || 0xff6b6b, 0xffd166, 0xb388ff];
      var pool = poolOf(j, 'confetti', 'overlay', texChip(j), 900);
      var n = j.reduced ? 120 : 620;
      var cannons = [
        { x: w * 0.06, y: h * 1.0, a: -Math.PI / 2.6 },
        { x: w * 0.94, y: h * 1.0, a: -Math.PI + Math.PI / 2.6 },
        { x: w * 0.5, y: h * 0.96, a: -Math.PI / 2 }
      ];
      for (var i = 0; i < n; i++) {
        var cn = cannons[i % cannons.length];
        var a = cn.a + rnd(-0.42, 0.42);
        var sp = rnd(760, 1550);
        pool.spawn({
          x: cn.x + rnd(-14, 14), y: cn.y + rnd(-14, 14),
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          ay: 1250, drag: 0.985,
          rot: rnd(0, 6.28), vr: rnd(-11, 11),
          life: rnd(1900, 3400),
          s0: rnd(0.55, 1.25), s1: rnd(0.4, 1.0),
          a0: 1, a1: 0, tint: tints[i % tints.length]
        });
      }
      flash(j, c.accent, 0.18, 380);
      if (gsap && !j.reduced) {
        j.camera.zoom(1.04, { duration: 140, ease: 'power3.out' });
        setTimeout(function () { if (inst === j) j.camera.zoom(1, { duration: 620, ease: 'elastic.out(1,0.5)' }); }, 170);
      }
      return n;
    }
  });

  // -------------------------------------------------------------- firework
  E.define('firework', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var c = j.tokens.colors;
      var pool = poolOf(j, 'spark', 'overlay', texSpark(j), 2400, 'add');
      var tints = [c.accent, 0xffd166, 0xff5c8a, 0x7ef0c0, 0xffffff, 0xb388ff];
      function shell(x, y, tint, count, speed) {
        for (var i = 0; i < count; i++) {
          var a = (i / count) * 6.283 + rnd(-0.06, 0.06);
          var sp = speed * rnd(0.35, 1);
          pool.spawn({
            x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            ay: 420, drag: 0.955, life: rnd(900, 1900),
            s0: rnd(0.8, 2.0), s1: 0, a0: 1, a1: 0, tint: tint
          });
        }
        ring(j, x, y, tint, 130, 520, 4);
      }
      var shells = j.reduced ? 2 : 4;
      var per = j.reduced ? 70 : 240;
      for (var k = 0; k < shells; k++) {
        shell(rnd(w * 0.15, w * 0.85), rnd(h * 0.12, h * 0.55), tints[k % tints.length], per, j.reduced ? 380 : 700);
      }
      if (!j.reduced) {
        var later = 0;
        for (var m = 0; m < 3; m++) {
          later += 260;
          setTimeout((function (idx) {
            return function () {
              if (!inst) return;
              shell(rnd(w * 0.1, w * 0.9), rnd(h * 0.1, h * 0.5), tints[(idx + 2) % tints.length], per, 660);
            };
          })(m), later);
        }
      }
      flash(j, 0xffffff, 0.22, 260);
      return shells * per;
    }
  });

  // -------------------------------------------------------------- shockwave
  E.define('shockwave', {
    fire: function (j, opts) {
      install(j);
      var p = firePoint(j, opts);
      var c = j.tokens.colors;
      var maxR = Math.max(j.screen.width, j.screen.height) * 1.15;
      ring(j, p.x, p.y, c.accent, maxR, 900, 10);
      ring(j, p.x, p.y, 0xffffff, maxR * 0.7, 700, 4);
      if (!has('ShockwaveFilter')) { flash(j, c.accent, 0.2, 300); return 2; }
      var f = new FX.ShockwaveFilter({
        center: { x: p.x, y: p.y }, amplitude: 72, wavelength: 220,
        brightness: 1.15, radius: -1, speed: 900, time: 0
      });
      var key = 'shockwave' + Math.random().toString(36).slice(2, 7);
      addStage(j, key, f);
      var st = { t: 0 };
      var dur = j.reduced ? 0.25 : 1.05;
      function done() { delStage(j, key); }
      if (gsap) {
        gsap.to(st, {
          t: dur, duration: dur, ease: 'none',
          onUpdate: function () { f.time = st.t; f.amplitude = 72 * (1 - st.t / dur); },
          onComplete: done
        });
      } else { setTimeout(done, 200); }
      return 3;
    }
  });

  // -------------------------------------------------------------- shake
  E.define('shake', {
    fire: function (j, opts) {
      install(j);
      var c = j.tokens.colors;
      j.camera.shake((opts && opts.strength) || 15, (opts && opts.ms) || 620);
      var f = has('RGBSplitFilter') ? new FX.RGBSplitFilter({ red: { x: -14, y: 0 }, green: { x: 0, y: 5 }, blue: { x: 14, y: 0 } }) : null;
      if (f) {
        var key = 'shake' + Math.random().toString(36).slice(2, 7);
        addStage(j, key, f);
        var st = { k: 1 };
        if (gsap) {
          gsap.to(st, {
            k: 0, duration: 0.62, ease: 'power2.out',
            onUpdate: function () { f.red = { x: -14 * st.k, y: 0 }; f.blue = { x: 14 * st.k, y: 0 }; f.green = { x: 0, y: 5 * st.k }; },
            onComplete: function () { delStage(j, key); }
          });
        } else setTimeout(function () { delStage(j, key); }, 120);
      }
      var pool = poolOf(j, 'spark', 'overlay', texSpark(j), 2400, 'add');
      var w = j.screen.width, h = j.screen.height;
      var n = j.reduced ? 20 : 90;
      for (var i = 0; i < n; i++) {
        pool.spawn({
          x: rnd(0, w), y: rnd(0, h), vx: rnd(-260, 260), vy: rnd(-260, 60), ay: 700,
          drag: 0.95, life: rnd(400, 900), s0: rnd(0.4, 1.2), s1: 0, a0: 0.8, a1: 0, tint: c.text
        });
      }
      flash(j, c.danger || 0xff6b6b, 0.14, 240);
      return n;
    }
  });

  // -------------------------------------------------------------- emojiRain
  var EMOJI = ['🎉', '✨', '🔥', '💥', '⭐', '🌈', '🍬', '🚀'];
  E.define('emojiRain', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var n = j.reduced ? 60 : 300;
      var per = Math.ceil(n / EMOJI.length);
      var total = 0;
      EMOJI.forEach(function (ch, gi) {
        var tex = texGlyph(j, 'emoji' + gi, ch, 48);
        var pool = poolOf(j, 'emoji' + gi, 'overlay', tex, Math.max(80, per * 2));
        for (var i = 0; i < per; i++) {
          // déjà répartis sur toute la hauteur : l'averse est pleine tout de suite
          pool.spawn({
            x: rnd(-40, w + 40), y: rnd(-h * 0.5, h),
            vx: rnd(-70, 70), vy: rnd(160, 520), ay: 260,
            rot: rnd(0, 6.28), vr: rnd(-4, 4),
            life: rnd(1800, 3600), s0: rnd(0.45, 1.1), s1: rnd(0.3, 0.9),
            a0: 1, a1: 0
          });
          total++;
        }
      });
      return total;
    }
  });

  // -------------------------------------------------------------- counter
  E.define('counter', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var c = j.tokens.colors;
      var n = (opts && opts.value != null) ? opts.value : j.state.counter;
      var size = Math.min(w, h) * 0.34;
      var t = new PIXI.Text({
        text: String(n),
        style: { fill: c.text, fontFamily: j.tokens.fonts.display, fontSize: size, fontWeight: '700', align: 'center' }
      });
      t.anchor.set(0.5);
      t.position.set(w / 2, h / 2);
      t.blendMode = 'add';
      j.layers.overlay.addChild(t);
      var combo = null;
      if (j.state.combo > 1) {
        combo = new PIXI.Text({ text: '×' + j.state.combo, style: { fill: c.accent, fontFamily: j.tokens.fonts.display, fontSize: size * 0.34, fontWeight: '700' } });
        combo.anchor.set(0.5);
        combo.position.set(w / 2 + size * 0.62, h / 2 - size * 0.22);
        combo.blendMode = 'add';
        j.layers.overlay.addChild(combo);
      }
      ring(j, w / 2, h / 2, c.accent, Math.min(w, h) * 0.55, 700, 8);
      var pool = poolOf(j, 'spark', 'overlay', texSpark(j), 2400, 'add');
      var rays = j.reduced ? 18 : 80;
      for (var i = 0; i < rays; i++) {
        var a = (i / rays) * 6.283;
        pool.spawn({
          x: w / 2, y: h / 2, vx: Math.cos(a) * rnd(300, 900), vy: Math.sin(a) * rnd(300, 900),
          drag: 0.93, life: rnd(500, 1000), s0: rnd(0.6, 1.6), s1: 0, a0: 1, a1: 0, tint: c.accent
        });
      }
      if (gsap && !j.reduced) {
        t.scale.set(0.2); t.alpha = 0;
        gsap.to(t.scale, { x: 1, y: 1, duration: 0.55, ease: 'elastic.out(1,0.5)' });
        gsap.to(t, { alpha: 0.95, duration: 0.14 });
        gsap.to(t, { alpha: 0, duration: 0.5, delay: 0.75, onComplete: function () { try { t.destroy(); } catch (e) { /* ignore */ } } });
        if (combo) {
          combo.scale.set(0.2);
          gsap.to(combo.scale, { x: 1, y: 1, duration: 0.6, ease: 'back.out(3)', delay: 0.08 });
          gsap.to(combo, { alpha: 0, duration: 0.5, delay: 0.8, onComplete: function () { try { combo.destroy(); } catch (e) { /* ignore */ } } });
        }
      } else {
        setTimeout(function () { try { t.destroy(); if (combo) combo.destroy(); } catch (e) { /* ignore */ } }, 500);
      }
      return rays;
    }
  });

  // -------------------------------------------------------------- timewarp
  var warping = null;
  E.define('timewarp', {
    fire: function (j, opts) {
      install(j);
      if (warping) return 0;
      var f = [];
      if (has('ZoomBlurFilter')) f.push(new FX.ZoomBlurFilter({ strength: 0, center: { x: j.screen.width / 2, y: j.screen.height / 2 }, innerRadius: 60, radius: -1 }));
      if (PIXI.ColorMatrixFilter) { var cm = new PIXI.ColorMatrixFilter(); cm.saturate(-0.7, false); f.push(cm); }
      var key = 'timewarp';
      if (f.length) addStage(j, key, f);
      var prevSpeed = j.app.ticker.speed;
      j.app.ticker.speed = j.reduced ? 0.6 : 0.22;
      var st = { k: 0 };
      var zb = f[0] && f[0].strength !== undefined ? f[0] : null;
      var dead = false, tws = [];
      function apply() {
        // les filtres sont détruits par `end` : un tween encore vivant ne
        // doit plus les toucher, sinon Pixi jette sur un uniforme nul.
        if (dead) return;
        if (zb) zb.strength = 0.42 * st.k;
        if (cm) { cm.reset(); cm.saturate(-0.85 * st.k, false); cm.brightness(1 - 0.18 * st.k, true); }
      }
      function end() {
        if (dead) return;
        dead = true;
        tws.forEach(function (t) { try { t.kill(); } catch (e) { /* ignore */ } });
        tws.length = 0;
        j.app.ticker.speed = prevSpeed;
        delStage(j, key);
        warping = null;
      }
      warping = { end: end };
      if (gsap && !j.reduced) {
        tws.push(gsap.to(st, { k: 1, duration: 0.14, ease: 'power2.out', onUpdate: apply }));
        tws.push(gsap.to(st, { k: 0, duration: 0.5, delay: 1.25, ease: 'power2.in', onUpdate: apply, onComplete: end }));
      } else { st.k = 1; apply(); setTimeout(end, 700); }
      // le ralenti touche le ticker, pas setTimeout : filet de sécurité
      setTimeout(function () { if (warping) end(); }, 3000);
      return 1 + f.length;
    }
  });

  // -------------------------------------------------------------- everything
  E.define('everything', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      E.fire('confetti');
      E.fire('firework');
      E.fire('shockwave', { x: w / 2, y: h / 2 });
      E.fire('emojiRain');
      E.fire('counter');
      E.fire('shake', { strength: 20, ms: 800 });
      var bloom = has('AdvancedBloomFilter') ? new FX.AdvancedBloomFilter({ threshold: 0.25, bloomScale: 2.2, brightness: 1.15, blur: 9, quality: 4 }) : null;
      if (bloom) {
        addStage(j, 'everything', bloom);
        var st = { k: 1 };
        if (gsap && !j.reduced) {
          gsap.to(st, {
            k: 0, duration: 1.6, ease: 'power2.out',
            onUpdate: function () { bloom.bloomScale = 2.2 * st.k; bloom.brightness = 1 + 0.2 * st.k; },
            onComplete: function () { delStage(j, 'everything'); }
          });
        } else setTimeout(function () { delStage(j, 'everything'); }, 200);
      }
      if (gsap && !j.reduced) {
        var z = j.camera.zoom(1.08, { duration: 180, ease: 'power3.out' });
        setTimeout(function () { if (inst === j) j.camera.zoom(1, { duration: 700, ease: 'elastic.out(1,0.5)' }); }, 220);
      }
      return 6;
    }
  });

  // -------------------------------------------------------------- reset
  E.define('reset', {
    fire: function (j, opts) {
      install(j);
      var w = j.screen.width, h = j.screen.height;
      var c = j.tokens.colors;
      // balayage visible : le nettoyage se voit
      var g = new PIXI.Graphics();
      g.blendMode = 'add';
      j.layers.overlay.addChild(g);
      var st = { r: 0, a: 0.85 };
      function draw() {
        g.clear();
        g.circle(w / 2, h / 2, st.r).stroke({ width: 26, color: c.text, alpha: st.a });
        g.circle(w / 2, h / 2, Math.max(0, st.r - 30)).stroke({ width: 10, color: c.accent, alpha: st.a * 0.8 });
      }
      draw();
      var maxR = Math.sqrt(w * w + h * h) / 2 + 40;

      var wiped = false;
      function wipe() {
        if (wiped) return;
        wiped = true;
        // effets continus coupés, et les interrupteurs remis en accord
        E.list().forEach(function (id) { if (E.isOn(id)) E.disable(id); });
        clearPools();
        // le ralenti détient des tweens qui écrivent dans ses filtres : le
        // clore d'abord, sinon `delStage` les détruit sous ses pieds.
        if (warping) warping.end();
        j.app.ticker.speed = 1;
        Object.keys(stageFilters).forEach(function (k) { delStage(j, k); });
        j.camera.reset({ duration: 0 });
        j.state.counter = 0;
        j.state.combo = 0;
        j.relayout(true, false);
      }

      if (gsap && !j.reduced) {
        gsap.to(st, {
          r: maxR, duration: 0.42, ease: 'power2.out', onUpdate: draw,
          onComplete: function () {
            wipe();
            gsap.to(st, {
              a: 0, duration: 0.3, onUpdate: draw,
              onComplete: function () { try { g.destroy(); } catch (e) { /* ignore */ } }
            });
          }
        });
      } else {
        wipe();
        setTimeout(function () { try { g.destroy(); } catch (e) { /* ignore */ } }, 120);
      }
      // Garde-fou : le nettoyage ne doit jamais attendre l'animation. Sur une
      // machine lente, chaque image coute des centaines de millisecondes et
      // GSAP lisse le retard : l'anneau met alors plusieurs secondes a finir,
      // et la page resterait chargee d'effets pendant tout ce temps.
      setTimeout(wipe, 500);
      flash(j, c.text, 0.22, 420);
      return 1;
    }
  });

})(window);
