/* juicy/core.js — moteur du terrain de jeu juicy.html.
   Définit window.JUICY, construit les 19 toggles et les 8 boutons, câble
   leurs effets génériques et la bascule entre thèmes. Contrat détaillé dans
   .swarm/pages/contrat-juicy.md (fait foi). Aucune référence à un thème
   précis : tout ce qui est spécifique à un thème passe par registerTheme(). */

(function () {
  'use strict';

  var TOGGLE_IDS = [
    'bg', 'trail', 'light', 'glitch', 'tilt', 'sound', 'magnet', 'cursor',
    'rain', 'shaketext', 'crt', 'timewarp', 'antigravity', 'negative', 'fog',
    'snow', 'bigtext', 'drunk', 'music'
  ];
  var ACTION_IDS = ['confetti', 'shake', 'emoji', 'firework', 'shockwave', 'counter', 'everything', 'reset'];
  var THEME_IDS = ['rpg', 'neon', 'candy'];

  var DEFAULT_LABELS = {
    bg: 'Fond animé', trail: 'Traînée', light: 'Mode clair', glitch: 'Glitch',
    tilt: 'Tilt 3D', sound: 'Sons', magnet: 'Aimant', cursor: 'Curseur',
    rain: 'Pluie', shaketext: 'Texte tremblant', crt: 'CRT', timewarp: 'Vitesse du temps',
    antigravity: 'Antigravité', negative: 'Négatif', fog: 'Brouillard', snow: 'Neige',
    bigtext: 'Texte géant', drunk: 'Ivre', music: 'Musique',
    confetti: 'Confettis', shake: 'Secousse', emoji: "Pluie d'emojis",
    firework: "Feu d'artifice", shockwave: 'Onde de choc', counter: 'Compteur',
    everything: 'Tout !', reset: 'Reset'
  };
  var THEME_NAME_FALLBACK = { rpg: 'RPG', neon: 'Neon', candy: 'Candy' };
  var DEFAULT_TITLE = 'Terrain de jeu';
  var DEFAULT_TAGLINE = 'Bascule les thèmes, active tout, rien ne casse.';
  var DEFAULT_TOGGLES_TITLE = 'Options';
  var DEFAULT_ACTIONS_TITLE = 'Actions';
  var DEFAULT_PALETTE = ['#7c5cff', '#00e5c7', '#ff5e7a', '#ffd166'];
  var DEFAULT_EMOJIS = ['✨', '🎉', '⭐', '💥'];
  var DEFAULT_RAIN_GLYPHS = ['0', '1'];
  var DEFAULT_SNOW_GLYPHS = ['❄'];
  var DEFAULT_CURSOR = '●';
  var COOLDOWN_MS = 700;
  var COOLDOWN_EVERYTHING_MS = 2000;
  var MAX_PARTICLES = 900;
  var SOUND_FREQS = {
    toggleOn: 523, toggleOff: 392, hover: 660, confetti: 784, shake: 220,
    emoji: 880, firework: 988, shockwave: 494, counter: 659, combo: 831,
    everything: 1046, reset: 196, theme: 349, achievement: 1318
  };
  var DEFAULT_PARTICLES = {
    fpsLimit: 60,
    detectRetina: true,
    fullScreen: { enable: false },
    particles: {
      number: { value: 34 },
      color: { value: DEFAULT_PALETTE },
      opacity: { value: { min: 0.15, max: 0.5 } },
      size: { value: { min: 1, max: 3 } },
      move: { enable: true, speed: 0.5, direction: 'none', random: true, outModes: { default: 'out' } },
      links: { enable: false }
    },
    interactivity: { events: { onHover: { enable: false }, onClick: { enable: false }, resize: { enable: true } } }
  };

  var registry = new Map();
  var reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var state = {
    theme: null,
    toggles: {},
    counter: 0,
    combo: 0,
    reduceMotion: reduceMotionQuery.matches
  };
  TOGGLE_IDS.forEach(function (id) { state.toggles[id] = false; });
  reduceMotionQuery.addEventListener && reduceMotionQuery.addEventListener('change', function (e) {
    state.reduceMotion = e.matches;
  });

  var initialized = false;
  var currentThemeId = null;
  var root = document.documentElement;

  var root_, togglesEl, actionsEl, titleEl, taglineEl, togglesTitleEl, actionsTitleEl,
    themeLayerEl, themeStageEl, commentEl, counterValueEl, comboEl, toastLayerEl,
    cursorEl, stageEl, canvas, ctx, themeButtons, themeSwitcherEl;
  var toggleEls = {}, actionEls = {};
  var panelEls = [];
  var W = window.innerWidth, H = window.innerHeight, dpr = 1;
  var particles = [];
  var rainAcc = 0, snowAcc = 0;
  var glitchTl = null, drunkTl = null;
  var lastPointer = { x: W / 2, y: H / 2 };
  var lastClickTime = 0, comboTimer = null;
  var audioStarted = false, defaultSynth = null, crtNoise = null, crtFilter = null;

  /* ---------- utilities ---------- */

  function $(sel) { return document.getElementById(sel); }

  function safeCall(def, hookName, args) {
    var fn = def && def[hookName];
    if (typeof fn !== 'function') return;
    try { fn.apply(def, args); } catch (e) {
      console.warn('[JUICY] ' + hookName + ' du thème "' + def.id + '" a levé une exception :', e);
    }
  }

  function mergeDeep(a, b) {
    var out = Object.assign({}, a);
    Object.keys(b || {}).forEach(function (k) {
      var av = a && a[k], bv = b[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && av && typeof av === 'object' && !Array.isArray(av)) {
        out[k] = mergeDeep(av, bv);
      } else {
        out[k] = bv;
      }
    });
    return out;
  }

  function currentDef() { return registry.get(currentThemeId); }

  function label(id) {
    var def = currentDef();
    return (def && def.labels && def.labels[id]) || DEFAULT_LABELS[id] || id;
  }

  function currentPalette() {
    var def = currentDef();
    return (def && Array.isArray(def.palette) && def.palette.length) ? def.palette : DEFAULT_PALETTE;
  }

  function currentGlyphs(key, fallback) {
    var def = currentDef();
    return (def && Array.isArray(def[key]) && def[key].length) ? def[key] : fallback;
  }

  function currentCursor() {
    var def = currentDef();
    return (def && def.cursor) || DEFAULT_CURSOR;
  }

  function gravitySign() { return state.toggles.antigravity ? -1 : 1; }

  /* ---------- api exposed to themes ---------- */

  var api = {
    root: root,
    get themeLayer() { return themeLayerEl; },
    get themeStage() { return themeStageEl; },
    state: state,
    comment: function (t) { pushComment(t); },
    toast: function (t) { showToast(t); },
    isOn: function (id) { return !!state.toggles[id]; },
    gsap: window.gsap,
    confetti: window.confetti,
    tsParticles: window.tsParticles,
    Tone: window.Tone
  };

  /* ---------- registerTheme ---------- */

  function registerTheme(def) {
    if (!def || !def.id || !def.name || !def.labels || typeof def.labels !== 'object') {
      console.warn('[JUICY] registerTheme ignoré : id, name ou labels manquant.', def && def.id);
      return;
    }
    registry.set(def.id, def);
    if (initialized) {
      updateThemeButtons();
      if (def.id === currentThemeId) {
        updateAllLabels();
        activateCurrentTheme();
        initParticles();
      }
    }
  }

  window.JUICY = { registerTheme: registerTheme };

  /* ---------- comments / toasts ---------- */

  function commentFor(kind, id, on) {
    var def = currentDef();
    var custom = def && def.comments && def.comments[id];
    if (custom) return custom;
    var lbl = label(id);
    if (kind === 'toggle') return lbl + (on ? ' activé.' : ' désactivé.');
    if (kind === 'action') return lbl + ' !';
    return lbl;
  }

  function commentForTheme(def) {
    var custom = def && def.comments && def.comments.theme;
    if (custom) return custom;
    return 'Thème : ' + ((def && def.name) || THEME_NAME_FALLBACK[currentThemeId] || currentThemeId);
  }

  function pushComment(text) {
    var def = currentDef();
    if (def && typeof def.onComment === 'function') {
      safeCall(def, 'onComment', [text, api]);
    } else if (commentEl) {
      commentEl.textContent = text;
    }
  }

  function showToast(text) {
    if (!toastLayerEl) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    toastLayerEl.appendChild(el);
    setTimeout(function () { el.remove(); }, 2700);
  }

  /* ---------- sound ---------- */

  function ensureSynth() {
    if (!defaultSynth) defaultSynth = new window.Tone.Synth().toDestination();
    return defaultSynth;
  }

  function defaultBeep(name) {
    try {
      var synth = ensureSynth();
      synth.triggerAttackRelease(SOUND_FREQS[name] || 440, '16n');
    } catch (e) { console.warn('[JUICY] son par défaut indisponible :', e); }
  }

  function playSound(name) {
    if (!state.toggles.sound || !audioStarted) return;
    var def = currentDef();
    if (def && typeof def.sound === 'function') {
      safeCall(def, 'sound', [name, api]);
    } else {
      defaultBeep(name);
    }
  }

  function syncCrtNoise() {
    var shouldPlay = state.toggles.crt && state.toggles.sound && audioStarted;
    if (shouldPlay) {
      if (!crtNoise) {
        try {
          crtFilter = new window.Tone.Filter(700, 'lowpass').toDestination();
          crtNoise = new window.Tone.Noise('pink');
          crtNoise.volume.value = -30;
          crtNoise.connect(crtFilter);
          crtNoise.start();
        } catch (e) { console.warn('[JUICY] souffle CRT indisponible :', e); crtNoise = null; }
      }
    } else if (crtNoise) {
      try { crtNoise.stop(); crtNoise.dispose(); if (crtFilter) crtFilter.dispose(); } catch (e) { /* ignore */ }
      crtNoise = null; crtFilter = null;
    }
  }

  function syncMusic(on) {
    var def = currentDef();
    safeCall(def, 'music', [on, api]);
  }

  function wireAudioUnlock() {
    function start() {
      if (audioStarted) return;
      audioStarted = true;
      try {
        window.Tone.start().then(function () { syncCrtNoise(); }).catch(function (e) {
          console.warn('[JUICY] Tone.start() a échoué :', e);
        });
      } catch (e) { console.warn('[JUICY] Tone.start() a échoué :', e); }
    }
    document.addEventListener('pointerdown', start, { once: true });
    document.addEventListener('keydown', start, { once: true });
  }

  /* ---------- interactive transforms (tilt + magnet, GSAP) ---------- */

  function applyTiltOnly(el, x, y) {
    var rect = el.getBoundingClientRect();
    if (state.toggles.tilt && !state.reduceMotion) {
      var inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (inside) {
        var px = (x - rect.left) / rect.width, py = (y - rect.top) / rect.height;
        el._interactive = true;
        window.gsap.to(el, {
          rotateX: (py - 0.5) * -12, rotateY: (px - 0.5) * 12, scale: 1.03,
          duration: 0.25, ease: 'power2.out', transformPerspective: 700, overwrite: 'auto'
        });
        return;
      }
    }
    if (el._interactive) {
      el._interactive = false;
      window.gsap.to(el, { rotateX: 0, rotateY: 0, scale: 1, x: 0, y: 0, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
    }
  }

  function applyActionTransform(el, x, y) {
    if (state.reduceMotion) return;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var tx = 0, ty = 0, rx = 0, ry = 0, scale = 1, active = false;
    if (state.toggles.magnet) {
      var dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy), R = 110;
      if (dist < R) { var pull = Math.pow(1 - dist / R, 2) * 0.45; tx = dx * pull; ty = dy * pull; active = true; }
    }
    if (state.toggles.tilt) {
      var inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (inside) {
        var px = (x - rect.left) / rect.width, py = (y - rect.top) / rect.height;
        rx = (py - 0.5) * -14; ry = (px - 0.5) * 14; scale = 1.05; active = true;
      }
    }
    if (active) {
      el._interactive = true;
      window.gsap.to(el, { x: tx, y: ty, rotateX: rx, rotateY: ry, scale: scale, duration: 0.25, ease: 'power2.out', transformPerspective: 700, overwrite: 'auto' });
    } else if (el._interactive) {
      el._interactive = false;
      window.gsap.to(el, { x: 0, y: 0, rotateX: 0, rotateY: 0, scale: 1, duration: 0.45, ease: 'power2.out', overwrite: 'auto' });
    }
  }

  function resetInteractiveTransforms() {
    panelEls.forEach(function (el) { el._interactive = false; });
    Object.keys(actionEls).forEach(function (id) { actionEls[id]._interactive = false; });
    window.gsap.set(panelEls, { rotateX: 0, rotateY: 0, scale: 1, x: 0, y: 0 });
    window.gsap.set(Object.keys(actionEls).map(function (id) { return actionEls[id]; }), { rotateX: 0, rotateY: 0, scale: 1, x: 0, y: 0 });
  }

  /* ---------- glitch / drunk (GSAP loops) ---------- */

  function startGlitch() {
    if (state.reduceMotion || glitchTl) return;
    glitchTl = window.gsap.timeline({ repeat: -1, repeatRefresh: true })
      .to(titleEl, { duration: 0.06, x: function () { return window.gsap.utils.random(-6, 6); }, skewX: function () { return window.gsap.utils.random(-10, 10); }, ease: 'none' })
      .to(titleEl, { duration: 0.06, x: 0, skewX: 0, ease: 'none' })
      .to(titleEl, { duration: function () { return window.gsap.utils.random(1.4, 2.6); }, x: 0 });
  }
  function stopGlitch() {
    if (glitchTl) { glitchTl.kill(); glitchTl = null; }
    window.gsap.set(titleEl, { x: 0, skewX: 0 });
  }

  function startDrunk() {
    if (state.reduceMotion || drunkTl || !stageEl) return;
    drunkTl = window.gsap.timeline({ repeat: -1, yoyo: true })
      .to(stageEl, { rotate: 1.6, x: 8, duration: 2.2, ease: 'sine.inOut' })
      .to(stageEl, { rotate: -1.6, x: -8, duration: 2.2, ease: 'sine.inOut' });
  }
  function stopDrunk() {
    if (drunkTl) { drunkTl.kill(); drunkTl = null; }
    if (stageEl) window.gsap.set(stageEl, { rotate: 0, x: 0 });
  }

  /* ---------- custom cursor ---------- */

  function positionCursor(x, y) {
    if (!cursorEl) return;
    cursorEl.style.left = x + 'px';
    cursorEl.style.top = y + 'px';
  }

  /* ---------- shake / shockwave ---------- */

  function shakeScreen() {
    if (!stageEl) return;
    stageEl.classList.remove('shake-active', 'flash-active');
    void stageEl.offsetWidth;
    stageEl.classList.add(state.reduceMotion ? 'flash-active' : 'shake-active');
  }

  function spawnShockwave(cx, cy) {
    var overlay = $('fx-overlay');
    if (!overlay) return;
    var el = document.createElement('div');
    el.className = 'shock-ring';
    var size = Math.max(W, H) * 2.2;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    overlay.appendChild(el);
    if (state.reduceMotion) {
      window.gsap.to(el, { opacity: 0, duration: 0.35, onComplete: function () { el.remove(); } });
    } else {
      window.gsap.fromTo(el, { scale: 0, opacity: 0.85 }, { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out', onComplete: function () { el.remove(); } });
    }
  }

  /* ---------- fx-canvas particle engine ---------- */

  function setupCanvas() {
    canvas = $('fx-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnTrail(x, y) {
    var pal = currentPalette();
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6,
      size: 4 + Math.random() * 4,
      color: pal[(Math.random() * pal.length) | 0],
      life: 1, decay: 0.035,
      update: function (k) { this.x += this.vx * k; this.y += this.vy * k; this.life -= this.decay * k; },
      draw: function (c) {
        c.save(); c.globalAlpha = Math.max(this.life, 0); c.fillStyle = this.color;
        c.beginPath(); c.arc(this.x, this.y, this.size * Math.max(this.life, 0.001), 0, Math.PI * 2); c.fill(); c.restore();
      }
    });
  }

  function spawnRainDrop() {
    var glyphs = currentGlyphs('rainGlyphs', DEFAULT_RAIN_GLYPHS);
    var pal = currentPalette();
    particles.push({
      x: Math.random() * W, y: gravitySign() > 0 ? -20 : H + 20,
      vy: 6 + Math.random() * 4,
      glyph: glyphs[(Math.random() * glyphs.length) | 0],
      size: 13 + Math.random() * 6,
      color: pal[(Math.random() * pal.length) | 0],
      life: 1,
      update: function (k) { this.y += this.vy * k * gravitySign(); if (this.y > H + 40 || this.y < -40) this.life = 0; },
      draw: function (c) {
        c.save(); c.globalAlpha = 0.85; c.fillStyle = this.color; c.font = this.size + 'px monospace';
        c.fillText(this.glyph, this.x, this.y); c.restore();
      }
    });
  }

  function spawnSnowFlake() {
    var glyphs = currentGlyphs('snowGlyphs', DEFAULT_SNOW_GLYPHS);
    particles.push({
      x: Math.random() * W, y: gravitySign() > 0 ? -20 : H + 20,
      vy: 1 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      sway: 10 + Math.random() * 14,
      glyph: glyphs[(Math.random() * glyphs.length) | 0],
      size: 12 + Math.random() * 10,
      life: 1,
      update: function (k) { this.y += this.vy * k * gravitySign(); this.phase += 0.03 * k; if (this.y > H + 40 || this.y < -40) this.life = 0; },
      draw: function (c) {
        c.save(); c.globalAlpha = 0.9; c.fillStyle = '#fff'; c.font = this.size + 'px serif';
        c.fillText(this.glyph, this.x + Math.sin(this.phase) * this.sway, this.y); c.restore();
      }
    });
  }

  function maybeEmitRain(dt) {
    rainAcc += dt;
    var interval = 55;
    var guard = 0;
    while (rainAcc > interval && guard < 6) { rainAcc -= interval; spawnRainDrop(); guard++; }
  }

  function maybeEmitSnow(dt) {
    snowAcc += dt;
    var interval = 90;
    var guard = 0;
    while (snowAcc > interval && guard < 6) { snowAcc -= interval; spawnSnowFlake(); guard++; }
  }

  function fireEmojiRain(count) {
    count = count || 26;
    var emojis = currentGlyphs('emojis', DEFAULT_EMOJIS);
    for (var i = 0; i < count; i++) {
      (function () {
        var delay = Math.random() * 600;
        setTimeout(function () {
          particles.push({
            x: Math.random() * W, y: gravitySign() > 0 ? -30 : H + 30,
            vy: 2 + Math.random() * 3,
            phase: Math.random() * Math.PI * 2, sway: 6 + Math.random() * 16,
            rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.05,
            size: 20 + Math.random() * 14,
            emoji: emojis[(Math.random() * emojis.length) | 0],
            life: 1,
            update: function (k) {
              this.y += this.vy * k * gravitySign(); this.phase += 0.05 * k; this.rot += this.vr * k;
              if (this.y > H + 40 || this.y < -40) this.life = 0;
            },
            draw: function (c) {
              c.save(); c.translate(this.x + Math.sin(this.phase) * this.sway, this.y); c.rotate(this.rot);
              c.font = this.size + 'px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
              c.fillText(this.emoji, 0, 0); c.restore();
            }
          });
        }, delay);
      })();
    }
  }

  function explodeSpark(x, y) {
    var hueBase = Math.random() * 360, n = 40;
    for (var i = 0; i < n; i++) {
      var angle = (Math.PI * 2 * i) / n + Math.random() * 0.15;
      var speed = 2.2 + Math.random() * 3.2;
      particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.012 + Math.random() * 0.01,
        hue: hueBase + Math.random() * 30 - 15,
        size: 2 + Math.random() * 2,
        update: function (k) {
          this.vy += 0.05 * k * gravitySign(); this.vx *= 0.98; this.vy *= 0.98;
          this.x += this.vx * k; this.y += this.vy * k; this.life -= this.decay * k;
        },
        draw: function (c) {
          c.save(); c.globalAlpha = Math.max(this.life, 0); c.fillStyle = 'hsl(' + this.hue + ' 95% 60%)';
          c.beginPath(); c.arc(this.x, this.y, this.size, 0, Math.PI * 2); c.fill(); c.restore();
        }
      });
    }
  }

  function fireFirework(x, y) {
    var bursts = 3;
    for (var i = 0; i < bursts; i++) {
      (function (i) {
        setTimeout(function () {
          var bx = x + (Math.random() - 0.5) * 160;
          var by = Math.max(60, y - 80 - Math.random() * 120);
          explodeSpark(bx, by);
        }, i * 180);
      })(i);
    }
  }

  function canvasTick(t) {
    requestAnimationFrame(canvasTick);
    if (!ctx) return;
    var scale = state.toggles.timewarp ? 0.35 : 1;
    var k = scale;
    ctx.clearRect(0, 0, W, H);
    if (state.toggles.rain && !state.reduceMotion) maybeEmitRain(16 * scale);
    if (state.toggles.snow && !state.reduceMotion) maybeEmitSnow(16 * scale);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.update(k);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.draw(ctx);
    }
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
  }

  /* ---------- counter ---------- */

  function bumpCounter() {
    var now = performance.now();
    state.combo = (now - lastClickTime < 600) ? state.combo + 1 : 1;
    lastClickTime = now;
    state.counter++;
    if (counterValueEl) counterValueEl.textContent = String(state.counter);
    if (!state.reduceMotion && counterValueEl) {
      window.gsap.timeline()
        .to(counterValueEl, { scale: 1.45, duration: 0.12, ease: 'power2.out' })
        .to(counterValueEl, { scale: 0.85, duration: 0.14 })
        .to(counterValueEl, { scale: 1.1, duration: 0.14 })
        .to(counterValueEl, { scale: 1, duration: 0.12 });
    }
    if (state.combo > 1 && comboEl) {
      comboEl.textContent = 'combo ×' + state.combo;
      if (!state.reduceMotion) {
        window.gsap.fromTo(comboEl, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
      } else { comboEl.style.opacity = 1; }
      clearTimeout(comboTimer);
      comboTimer = setTimeout(function () { comboEl.textContent = ''; state.combo = 0; }, 900);
      playSound('combo');
    }
  }

  /* ---------- toggles ---------- */

  function applyToggleSideEffects(id, on) {
    switch (id) {
      case 'glitch': on ? startGlitch() : stopGlitch(); break;
      case 'drunk': on ? startDrunk() : stopDrunk(); break;
      case 'timewarp': window.gsap.globalTimeline.timeScale(on ? 0.35 : 1); break;
      case 'crt': syncCrtNoise(); break;
      case 'sound': syncCrtNoise(); break;
      case 'music': syncMusic(on); break;
      case 'tilt': if (!on) resetInteractiveTransforms(); break;
      case 'magnet': if (!on) resetInteractiveTransforms(); break;
      case 'cursor': if (on) positionCursor(lastPointer.x, lastPointer.y); break;
      default: break;
    }
  }

  function setToggle(id, on, opts) {
    opts = opts || {};
    state.toggles[id] = on;
    var el = toggleEls[id];
    if (el) { el.dataset.on = String(on); el.setAttribute('aria-checked', String(on)); }
    root.classList.toggle('on-' + id, on);
    applyToggleSideEffects(id, on);
    var def = currentDef();
    if (def && typeof def.onToggle === 'function') safeCall(def, 'onToggle', [id, on, api]);
    if (!opts.silent) {
      playSound(on ? 'toggleOn' : 'toggleOff');
      pushComment(commentFor('toggle', id, on));
    }
  }

  /* ---------- actions ---------- */

  function runActionEffect(id, x, y) {
    switch (id) {
      case 'confetti': fireConfetti(x, y); break;
      case 'shake': shakeScreen(); break;
      case 'emoji': fireEmojiRain(); break;
      case 'firework': fireFirework(x, y); break;
      case 'shockwave': spawnShockwave(x, y); break;
      case 'counter': bumpCounter(); break;
      case 'everything': fireEverything(x, y); break;
      case 'reset': fireReset(); break;
      default: break;
    }
  }

  function fireConfetti(x, y) {
    if (typeof window.confetti !== 'function') return;
    var def = currentDef();
    var opts = Object.assign({
      origin: { x: x / W, y: y / H },
      colors: currentPalette(),
      particleCount: 90,
      spread: 65
    }, (def && def.confettiOptions) || {}, { gravity: gravitySign() });
    try { window.confetti(opts); } catch (e) { console.warn('[JUICY] confetti a échoué :', e); }
  }

  function fireEverything(x, y) {
    fireConfetti(x, y);
    setTimeout(function () { fireFirework(x, y); }, 120);
    fireEmojiRain(18);
    spawnShockwave(x, y);
    shakeScreen();
    bumpCounter();
  }

  function fireReset() {
    TOGGLE_IDS.forEach(function (id) {
      if (state.toggles[id]) setToggle(id, false, { silent: true });
    });
    particles.length = 0;
    state.counter = 0; state.combo = 0;
    if (counterValueEl) counterValueEl.textContent = '0';
    if (comboEl) comboEl.textContent = '';
    resetInteractiveTransforms();
    if (stageEl) stageEl.classList.remove('shake-active', 'flash-active');
  }

  function startCooldown(btn, ms) {
    btn.disabled = true;
    btn.dataset.cooldown = 'true';
    var start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / ms);
      btn.style.setProperty('--cooldown', String(1 - p));
      if (p < 1) requestAnimationFrame(tick);
      else { btn.disabled = false; btn.dataset.cooldown = 'false'; btn.style.setProperty('--cooldown', '0'); }
    }
    requestAnimationFrame(tick);
  }

  function fireAction(id, btn, x, y) {
    if (btn.disabled) return;
    btn.dataset.firing = 'true';
    setTimeout(function () { btn.dataset.firing = 'false'; }, 300);
    runActionEffect(id, x, y);
    playSound(id);
    pushComment(commentFor('action', id));
    var def = currentDef();
    if (def && typeof def.onAction === 'function') safeCall(def, 'onAction', [id, api]);
    if (id !== 'reset') startCooldown(btn, id === 'everything' ? COOLDOWN_EVERYTHING_MS : COOLDOWN_MS);
  }

  /* ---------- theme switching ---------- */

  function updateThemeButtons() {
    themeButtons.forEach(function (btn) {
      var id = btn.dataset.themeBtn;
      var def = registry.get(id);
      btn.textContent = (def && def.name) || THEME_NAME_FALLBACK[id] || id;
      btn.setAttribute('aria-pressed', String(id === currentThemeId));
    });
  }

  function updateAllLabels() {
    var def = currentDef();
    if (titleEl) titleEl.textContent = (def && def.title) || DEFAULT_TITLE;
    if (taglineEl) taglineEl.textContent = (def && def.tagline) || DEFAULT_TAGLINE;
    if (togglesTitleEl) togglesTitleEl.textContent = (def && def.togglesTitle) || DEFAULT_TOGGLES_TITLE;
    if (actionsTitleEl) actionsTitleEl.textContent = (def && def.actionsTitle) || DEFAULT_ACTIONS_TITLE;
    TOGGLE_IDS.forEach(function (id) {
      var span = toggleEls[id] && toggleEls[id].querySelector('.toggle-label');
      if (span) span.textContent = label(id);
    });
    ACTION_IDS.forEach(function (id) {
      var span = actionEls[id] && actionEls[id].querySelector('.action-label');
      if (span) span.textContent = label(id);
    });
    if (cursorEl) cursorEl.innerHTML = currentCursor();
  }

  function activateCurrentTheme() {
    var def = currentDef();
    safeCall(def, 'onActivate', [api]);
    TOGGLE_IDS.forEach(function (id) {
      if (state.toggles[id]) safeCall(def, 'onToggle', [id, true, api]);
    });
    if (state.toggles.music) safeCall(def, 'music', [true, api]);
  }

  function initParticles() {
    if (!window.tsParticles) return;
    var def = currentDef();
    var preset = mergeDeep(DEFAULT_PARTICLES, (def && def.particlesPreset) || {});
    try {
      if (typeof window.tsParticles.dom === 'function') {
        window.tsParticles.dom().forEach(function (c) { try { c.destroy(); } catch (e) { /* ignore */ } });
      }
    } catch (e) { /* ignore */ }
    try {
      var p = window.tsParticles.load({ id: 'tsparticles', options: preset });
      if (p && typeof p.catch === 'function') p.catch(function (e) { console.warn('[JUICY] tsParticles a échoué :', e); });
    } catch (e) { console.warn('[JUICY] tsParticles a échoué :', e); }
  }

  function switchTheme(id) {
    if (THEME_IDS.indexOf(id) === -1 || id === currentThemeId) return;
    var scrollY = window.scrollY;
    var prevDef = currentDef();
    root.classList.add('is-switching');
    if (prevDef) {
      safeCall(prevDef, 'onDeactivate', [api]);
      if (state.toggles.music) safeCall(prevDef, 'music', [false, api]);
    }
    if (themeLayerEl) themeLayerEl.innerHTML = '';
    if (themeStageEl) themeStageEl.innerHTML = '';
    currentThemeId = id;
    state.theme = id;
    root.setAttribute('data-theme', id);
    updateThemeButtons();
    updateAllLabels();
    activateCurrentTheme();
    initParticles();
    syncSwitcherHeight();
    window.scrollTo(0, scrollY);
    playSound('theme');
    pushComment(commentForTheme(currentDef()));
    setTimeout(function () { root.classList.remove('is-switching'); syncSwitcherHeight(); }, 400);
  }

  /* ---------- DOM construction ---------- */

  function buildToggles() {
    TOGGLE_IDS.forEach(function (id) {
      var el = document.createElement('div');
      el.className = 'toggle';
      el.dataset.toggle = id;
      el.setAttribute('role', 'switch');
      el.tabIndex = 0;
      el.setAttribute('aria-checked', 'false');
      el.dataset.on = 'false';
      el.innerHTML = '<span class="toggle-control"><span class="toggle-thumb"></span></span><span class="toggle-label"></span>';
      togglesEl.appendChild(el);
      toggleEls[id] = el;
    });
  }

  function buildActions() {
    ACTION_IDS.forEach(function (id) {
      var el = document.createElement('button');
      el.className = 'action';
      el.type = 'button';
      el.dataset.action = id;
      el.innerHTML = '<span class="action-label"></span>';
      el.style.setProperty('--cooldown', '0');
      el.addEventListener('pointerenter', function () { playSound('hover'); });
      actionsEl.appendChild(el);
      actionEls[id] = el;
    });
  }

  function wireToggles() {
    togglesEl.addEventListener('click', function (e) {
      var el = e.target.closest('.toggle');
      if (!el) return;
      var id = el.dataset.toggle;
      setToggle(id, !state.toggles[id]);
    });
    togglesEl.addEventListener('keydown', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      var el = e.target.closest('.toggle');
      if (!el) return;
      e.preventDefault();
      var id = el.dataset.toggle;
      setToggle(id, !state.toggles[id]);
    });
  }

  function wireActions() {
    actionsEl.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.action');
      if (!btn || btn.disabled) return;
      btn.dataset.armed = 'true';
      setTimeout(function () { btn.dataset.armed = 'false'; }, 200);
    });
    actionsEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.action');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      fireAction(btn.dataset.action, btn, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
  }

  function wireThemeSwitcher() {
    themeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { switchTheme(btn.dataset.themeBtn); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      var map = { '1': 'rpg', '2': 'neon', '3': 'candy' };
      if (map[e.key]) switchTheme(map[e.key]);
    });
  }

  function wirePointer() {
    document.addEventListener('pointermove', function (e) {
      lastPointer.x = e.clientX; lastPointer.y = e.clientY;
      if (state.toggles.cursor) positionCursor(e.clientX, e.clientY);
      if (state.toggles.trail && !state.reduceMotion) spawnTrail(e.clientX, e.clientY);
      panelEls.forEach(function (el) { applyTiltOnly(el, e.clientX, e.clientY); });
      Object.keys(actionEls).forEach(function (id) { applyActionTransform(actionEls[id], e.clientX, e.clientY); });
    }, { passive: true });
  }

  function cacheEls() {
    togglesEl = $('toggles');
    actionsEl = $('actions');
    titleEl = $('title');
    taglineEl = $('tagline');
    togglesTitleEl = $('toggles-title');
    actionsTitleEl = $('actions-title');
    themeLayerEl = $('theme-layer');
    themeStageEl = $('theme-stage');
    commentEl = $('comment');
    counterValueEl = $('counter-value');
    comboEl = $('combo');
    toastLayerEl = $('toast-layer');
    cursorEl = $('custom-cursor');
    stageEl = $('stage');
    themeButtons = Array.prototype.slice.call(document.querySelectorAll('.theme-btn'));
    panelEls = Array.prototype.slice.call(document.querySelectorAll('.panel'));
    themeSwitcherEl = $('theme-switcher');
  }

  // #theme-switcher is fixed so it stays visible while scrolling (objectif) ;
  // body reserves space for it via the --switcher-h custom property. Its
  // real height depends on label text width vs viewport (it wraps to 2 rows
  // on narrow screens) and on the active theme's font, so a static fallback
  // isn't enough: measure it for real whenever it can have changed.
  function syncSwitcherHeight() {
    if (!themeSwitcherEl) return;
    root.style.setProperty('--switcher-h', themeSwitcherEl.offsetHeight + 'px');
  }

  function init() {
    cacheEls();
    buildToggles();
    buildActions();
    var attr = root.getAttribute('data-theme');
    currentThemeId = THEME_IDS.indexOf(attr) > -1 ? attr : THEME_IDS[0];
    root.setAttribute('data-theme', currentThemeId);
    state.theme = currentThemeId;
    wireThemeSwitcher();
    wireToggles();
    wireActions();
    wirePointer();
    wireAudioUnlock();
    setupCanvas();
    updateThemeButtons();
    updateAllLabels();
    activateCurrentTheme();
    initParticles();
    syncSwitcherHeight();
    window.addEventListener('resize', syncSwitcherHeight);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncSwitcherHeight);
    requestAnimationFrame(canvasTick);
    initialized = true;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
