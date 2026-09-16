/*
 * Juicy — noyau (juicy.js)
 * Définit window.Juicy. Aucune dépendance CDN directe : le noyau fonctionne
 * seul, les effets/briques/thèmes (autres fichiers de lib/) se dégradent
 * gracieusement quand un global CDN manque. Voir .swarm/pages/contrat-lib.md.
 */
(function () {
  'use strict';

  if (window.Juicy && window.Juicy.__juicyCore) {
    console.warn('[Juicy] core already loaded, skipping redefinition');
    return;
  }

  var REGION_NAMES = [
    'stage', 'title', 'tagline', 'nav', 'controls', 'actions',
    'scene', 'narration', 'meta',
  ];

  var DEFAULT_ACTIONS = [
    { id: 'confetti', effect: 'burst', params: { preset: 'confetti' } },
    { id: 'firework', effect: 'burst', params: { preset: 'firework' } },
    { id: 'shockwave', effect: 'burst', params: { preset: 'shockwave' } },
    { id: 'shake', effect: 'shake', params: {} },
    { id: 'emojiRain', effect: 'emojiRain', params: {} },
    { id: 'counter', effect: 'counter', params: {} },
    { id: 'timewarp', effect: 'timewarp', params: {} },
    { id: 'everything', effect: 'everything', params: {} },
    { id: 'reset', effect: 'reset', params: {} },
  ];

  var ACTION_COOLDOWN = { everything: 2000, reset: 0 };
  var DEFAULT_ACTION_COOLDOWN = 700;
  var PARTICLE_CAP = 900;

  /* ---------------- registres ---------------- */

  var effects = new Map();
  var widgets = new Map();
  var themes = new Map();
  var regions = new Map();
  var regionHomes = new Map();
  var activeCtx = new Map();
  var onStopRegistry = new Map();

  var state = {
    theme: null,
    on: {},
    counter: 0,
    combo: 0,
    reduceMotion: false,
    timeScale: 1,
  };

  var initialized = false;
  var layers = null;
  var particleEngine = null;
  var ticker = null;
  var lastAppliedTimeScale = 1;
  var initParams = {};

  /* ---------------- journal (activé par init({log:true}) ou ?juicy-log) ---------------- */

  var logEnabled = false;
  var initPerfTime = 0;

  function urlHasLogFlag() {
    try {
      return /(?:^|[?&])juicy-log(?:=|&|$)/.test(window.location.search);
    } catch (e) {
      return false;
    }
  }

  // Une ligne par événement, horodatée en secondes depuis init(), trois
  // décimales : `[juicy +12.345s] message`. Silencieux tant que le journal
  // n'est pas activé. `warn` bascule console.warn (cible=0, lib manquante) ;
  // sinon console.info.
  function logEvent(message, warn) {
    if (!logEnabled) return;
    var t = ((performance.now() - initPerfTime) / 1000).toFixed(3);
    var line = '[juicy +' + t + 's] ' + message;
    if (warn) console.warn(line);
    else console.info(line);
  }

  // API publique : offerte aux thèmes et aux pages, même format, silencieuse
  // par défaut.
  function publicLog() {
    if (!logEnabled) return Juicy;
    var parts = Array.prototype.slice.call(arguments).map(function (a) {
      return typeof a === 'string' ? a : JSON.stringify(a);
    });
    logEvent(parts.join(' '));
    return Juicy;
  }

  var controlsMounted = false;
  var lastControlsOpts = null;
  var navMounted = false;

  /* ---------------- utilitaires ---------------- */

  function safeCall(fn) {
    if (typeof fn !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      return fn.apply(null, args);
    } catch (e) {
      console.warn('[Juicy] hook error:', e);
      logEvent('error: ' + (e && e.message ? e.message : e), true);
      return undefined;
    }
  }

  function has(name) {
    return typeof window[name] !== 'undefined' && window[name] !== null;
  }

  function layer(name) {
    return layers ? (layers[name] || null) : null;
  }

  function region(name) {
    return regions.get(name) || null;
  }

  function mount(name, container) {
    var el = regions.get(name);
    if (!el || !container) return null;
    container.appendChild(el);
    return el;
  }

  /* ---------------- régions sémantiques (§3) ---------------- */

  function discoverRegions() {
    REGION_NAMES.forEach(function (name) {
      var el = document.querySelector('[data-juicy-region="' + name + '"]');
      if (el) {
        regions.set(name, el);
        regionHomes.set(name, { parent: el.parentNode, next: el.nextSibling });
      }
    });
  }

  function restoreRegions() {
    regionHomes.forEach(function (home, name) {
      var el = regions.get(name);
      if (!el) return;
      if (el.parentNode !== home.parent || el.nextSibling !== home.next) {
        home.parent.insertBefore(el, home.next);
      }
    });
  }

  function clearThemeOwnedNodes() {
    var owned = document.querySelectorAll('[data-juicy-owner]');
    owned.forEach(function (node) { node.remove(); });
  }

  /* ---------------- couches (§4) ---------------- */

  function buildLayers() {
    var defs = [
      ['bg', 'juicy-bg', 'div'],
      ['canvas', 'juicy-canvas', 'canvas'],
      ['theme', 'juicy-theme-layer', 'div'],
      ['overlay', 'juicy-overlay', 'div'],
      ['cursor', 'juicy-cursor', 'div'],
      ['toasts', 'juicy-toasts', 'div'],
    ];
    var map = {};
    defs.forEach(function (d) {
      var el = document.createElement(d[2]);
      el.id = d[1];
      document.body.appendChild(el);
      map[d[0]] = el;
    });
    return map;
  }

  /* ---------------- moteur de particules (§7) ---------------- */

  function createParticleEngine(canvasEl) {
    var ctx2d = canvasEl.getContext('2d');
    var particles = [];
    var hadParticles = false;

    function resize() {
      var dpr = window.devicePixelRatio || 1;
      canvasEl.width = Math.round(window.innerWidth * dpr);
      canvasEl.height = Math.round(window.innerHeight * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    function spawn(p) {
      var particle = Object.assign({
        x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
        life: 2, size: 8, shape: 'circle', glyph: '',
        color: null, alpha: 1, fade: false,
        rotation: 0, spin: 0, gravityScale: 1, tag: null,
      }, p || {});
      particle.maxLife = particle.life;
      particles.push(particle);
      if (particles.length > PARTICLE_CAP) {
        particles.splice(0, particles.length - PARTICLE_CAP);
      }
    }

    function spawnMany(n, fn) {
      for (var i = 0; i < n; i++) spawn(fn(i));
    }

    function clear(tag) {
      if (tag == null) { particles = []; return; }
      particles = particles.filter(function (p) { return p.tag !== tag; });
    }

    function count() { return particles.length; }

    function drawShape(c, p) {
      var s = p.size;
      switch (p.shape) {
        case 'square':
          c.fillRect(-s / 2, -s / 2, s, s);
          break;
        case 'triangle':
          c.beginPath();
          c.moveTo(0, -s / 2); c.lineTo(s / 2, s / 2); c.lineTo(-s / 2, s / 2);
          c.closePath(); c.fill();
          break;
        case 'star': {
          var spikes = 5, outer = s / 2, inner = s / 4;
          c.beginPath();
          for (var i = 0; i < spikes * 2; i++) {
            var r = i % 2 === 0 ? outer : inner;
            var a = (Math.PI / spikes) * i;
            c.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
          }
          c.closePath(); c.fill();
          break;
        }
        case 'glyph':
          c.font = s + 'px sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(p.glyph || '*', 0, 0);
          break;
        default:
          c.beginPath();
          c.arc(0, 0, s / 2, 0, Math.PI * 2);
          c.fill();
      }
    }

    function render() {
      ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var a = p.fade ? Math.max(0, p.life / p.maxLife) * (p.alpha == null ? 1 : p.alpha)
                       : (p.alpha == null ? 1 : p.alpha);
        ctx2d.save();
        ctx2d.globalAlpha = a;
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rotation || 0);
        ctx2d.fillStyle = p.color || '#fff';
        drawShape(ctx2d, p);
        ctx2d.restore();
      }
    }

    function tick(dt, timeScale) {
      if (particles.length === 0) {
        if (hadParticles) {
          ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
          hadParticles = false;
        }
        return;
      }
      hadParticles = true;
      var ts = timeScale;
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.vx += p.ax * dt * ts * p.gravityScale;
        p.vy += p.ay * dt * ts * p.gravityScale;
        p.x += p.vx * dt * ts;
        p.y += p.vy * dt * ts;
        p.rotation += p.spin * dt * ts;
        p.life -= dt * ts;
        if (p.life <= 0) particles.splice(i, 1);
      }
      render();
    }

    return { spawn: spawn, spawnMany: spawnMany, clear: clear, count: count, _tick: tick };
  }

  /* ---------------- ticker unique (§7) ---------------- */

  function createTicker() {
    var fns = new Set();
    var last = null;
    var rafId = null;

    function frame(ts) {
      if (last == null) last = ts;
      var dt = Math.min((ts - last) / 1000, 0.1);
      last = ts;

      if (has('gsap') && lastAppliedTimeScale !== state.timeScale) {
        safeCall(function () { window.gsap.globalTimeline.timeScale(state.timeScale); });
        lastAppliedTimeScale = state.timeScale;
      }

      fns.forEach(function (fn) { safeCall(fn, dt, state.timeScale); });
      rafId = window.requestAnimationFrame(frame);
    }

    function start() {
      if (rafId == null) {
        last = null;
        rafId = window.requestAnimationFrame(frame);
      }
    }

    function add(fn) { fns.add(fn); }
    function remove(fn) { fns.delete(fn); }

    return { start: start, add: add, remove: remove };
  }

  /* ---------------- ctx / api (§7, §9) ---------------- */

  function buildCtx(id, params) {
    var ctx = {
      id: id,
      params: params,
      layer: layer,
      root: document.documentElement,
      state: state,
      theme: themes.get(state.theme) || null,
      canvas: particleEngine,
      ticker: { add: ticker.add, remove: ticker.remove },
      onStop: function (fn) {
        if (!id) return;
        if (!onStopRegistry.has(id)) onStopRegistry.set(id, []);
        onStopRegistry.get(id).push(fn);
      },
      sound: coreSound,
      narrate: narrate,
      toast: toastFn,
      emit: function (name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail: detail }));
      },
      widget: widgetFn,
      gsap: has('gsap') ? window.gsap : null,
      confetti: has('confetti') ? window.confetti : null,
      tsParticles: has('tsParticles') ? window.tsParticles : null,
      Tone: has('Tone') ? window.Tone : null,
    };
    // Canal facultatif par lequel un effet (effects.js/bursts.js) signale au
    // noyau le nombre de cibles trouvées et/ou la couche utilisée, lu par
    // onEffect/fireEffect juste après start()/fire() pour composer la ligne
    // de journal. N'affecte rien si le journal est désactivé.
    ctx.log = function (fields) {
      ctx.__logFields = Object.assign({}, ctx.__logFields, fields || {});
    };
    return ctx;
  }

  function buildApi() {
    var ctx = buildCtx(null, null);
    delete ctx.id;
    delete ctx.params;
    ctx.region = region;
    ctx.mount = mount;
    ctx.themeLayer = layer('theme');
    return ctx;
  }

  function coreSound(name) {
    if (!state.on.sound) return;
    var theme = themes.get(state.theme);
    if (theme && typeof theme.sound === 'function') {
      safeCall(theme.sound, name, buildApi());
    }
  }

  function widgetFn(name, target, opts) {
    var factory = widgets.get(name);
    if (!factory) {
      console.warn('[Juicy] unknown widget "' + name + '"');
      return null;
    }
    var instance = safeCall(factory, target, opts);
    if (!instance) return null;
    if (logEnabled) {
      logEvent('widget create ' + name);
      var realDestroy = instance.destroy;
      instance.destroy = function () {
        logEvent('widget destroy ' + name);
        if (typeof realDestroy === 'function') return realDestroy.apply(instance, arguments);
      };
    }
    return instance;
  }

  /* ---------------- fusion des paramètres (§7) ---------------- */

  function mergeParams(id, def, callParams) {
    var theme = themes.get(state.theme);
    return Object.assign(
      {},
      def.defaults || {},
      (theme && theme.presets && theme.presets[id]) || {},
      initParams[id] || {},
      callParams || {}
    );
  }

  /* ---------------- effets (§7) ---------------- */

  function defineEffect(def) {
    if (!def || !def.id || (def.kind !== 'continuous' && def.kind !== 'oneshot')) {
      console.warn('[Juicy] invalid effect definition', def);
      return Juicy;
    }
    var merged = Object.assign({ needs: [], defaults: {}, label: def.id }, def);
    var missing = (merged.needs || []).filter(function (n) { return !has(n); });
    if (missing.length) {
      merged.__unavailable = true;
      console.info('[Juicy] effect "' + merged.id + '" disabled (missing ' + missing.join(', ') + ')');
    }
    effects.set(merged.id, merged);
    return Juicy;
  }

  function missingNeeds(def) {
    return (def.needs || []).filter(function (n) { return !has(n); });
  }

  function onEffect(id, params) {
    var def = effects.get(id);
    if (!def) { console.warn('[Juicy] unknown effect "' + id + '"'); return Juicy; }
    if (def.kind !== 'continuous') { console.warn('[Juicy] "' + id + '" is not continuous'); return Juicy; }
    if (def.__unavailable) {
      logEvent('start ' + id + ' skipped: missing ' + missingNeeds(def).join(','), true);
      return Juicy;
    }
    if (state.on[id]) return setEffect(id, params);

    var merged = mergeParams(id, def, params);
    var ctx = buildCtx(id, merged);
    activeCtx.set(id, ctx);
    safeCall(def.start, ctx);
    if (logEnabled) {
      var fields = ctx.__logFields || {};
      var hasTargets = typeof fields.targets === 'number';
      var msg = 'start ' + id + ' params=' + JSON.stringify(merged);
      if (hasTargets) msg += ' targets=' + fields.targets;
      if (fields.layer) msg += ' layer=' + fields.layer;
      logEvent(msg, hasTargets && fields.targets === 0);
    }
    state.on[id] = true;
    document.documentElement.classList.add('juicy-on-' + id);
    notifyThemeEffect(id, true);
    document.dispatchEvent(new CustomEvent('juicy:effect', { detail: { id: id, on: true } }));
    return Juicy;
  }

  function offEffect(id) {
    var def = effects.get(id);
    if (!def) { console.warn('[Juicy] unknown effect "' + id + '"'); return Juicy; }
    if (!state.on[id]) return Juicy;

    var ctx = activeCtx.get(id);
    safeCall(def.stop, ctx);
    var stops = onStopRegistry.get(id);
    if (stops) {
      stops.forEach(function (fn) { safeCall(fn); });
      onStopRegistry.delete(id);
    }
    activeCtx.delete(id);
    state.on[id] = false;
    document.documentElement.classList.remove('juicy-on-' + id);
    notifyThemeEffect(id, false);
    logEvent('stop ' + id);
    document.dispatchEvent(new CustomEvent('juicy:effect', { detail: { id: id, on: false } }));
    return Juicy;
  }

  function notifyThemeEffect(id, on) {
    var theme = themes.get(state.theme);
    if (theme && typeof theme.onEffect === 'function') {
      safeCall(theme.onEffect, id, on, buildApi());
    }
  }

  function notifyThemeFire(id) {
    var theme = themes.get(state.theme);
    if (theme && typeof theme.onFire === 'function') {
      safeCall(theme.onFire, id, buildApi());
    }
  }

  function toggleEffect(id, params) {
    var def = effects.get(id);
    if (!def) { console.warn('[Juicy] unknown effect "' + id + '"'); return false; }
    if (state.on[id]) { offEffect(id); return false; }
    onEffect(id, params);
    return !!state.on[id];
  }

  function isOnEffect(id) {
    return !!state.on[id];
  }

  function setEffect(id, params) {
    var def = effects.get(id);
    if (!def || def.kind !== 'continuous') {
      console.warn('[Juicy] "' + id + '" is not a continuous effect');
      return Juicy;
    }
    if (def.__unavailable) return Juicy;
    if (!state.on[id]) return Juicy;
    var ctx = activeCtx.get(id);
    Object.assign(ctx.params, params || {});
    if (typeof def.update === 'function') {
      safeCall(def.update, ctx);
    } else {
      safeCall(def.stop, ctx);
      safeCall(def.start, ctx);
    }
    return Juicy;
  }

  function fireEffect(id, params) {
    var def = effects.get(id);
    if (!def) { console.warn('[Juicy] unknown effect "' + id + '"'); return Juicy; }
    if (def.kind !== 'oneshot') { console.warn('[Juicy] "' + id + '" is not oneshot'); return Juicy; }
    if (def.__unavailable) {
      logEvent('fire ' + id + ' skipped: missing ' + missingNeeds(def).join(','), true);
      return Juicy;
    }
    var merged = mergeParams(id, def, params);
    var ctx = buildCtx(id, merged);
    safeCall(def.fire, ctx);
    if (logEnabled) {
      var fields = ctx.__logFields || {};
      var hasTargets = typeof fields.targets === 'number';
      var msg = 'fire ' + id + ' params=' + JSON.stringify(merged);
      if (hasTargets) msg += ' targets=' + fields.targets;
      if (fields.layer) msg += ' layer=' + fields.layer;
      logEvent(msg, hasTargets && fields.targets === 0);
    }
    notifyThemeFire(id);
    document.dispatchEvent(new CustomEvent('juicy:fire', { detail: { id: id, params: merged } }));
    return Juicy;
  }

  /* ---------------- briques (§8) ---------------- */

  function defineWidget(name, factory) {
    if (!name || typeof factory !== 'function') {
      console.warn('[Juicy] invalid widget definition', name);
      return Juicy;
    }
    widgets.set(name, factory);
    return Juicy;
  }

  /* ---------------- thèmes (§9) ---------------- */

  function registerTheme(def) {
    if (!def || !def.id || !def.name) {
      console.warn('[Juicy] invalid theme definition', def);
      return Juicy;
    }
    themes.set(def.id, def);
    return Juicy;
  }

  function setTheme(id) {
    if (!themes.has(id)) { console.warn('[Juicy] unknown theme "' + id + '"'); return Juicy; }
    if (id === state.theme) return Juicy;

    var prevTheme = state.theme;
    var prevScrollY = window.scrollY;
    var outgoing = themes.get(state.theme);
    if (outgoing) safeCall(outgoing.teardown, buildApi());

    restoreRegions();
    clearThemeOwnedNodes();
    if (layer('theme')) layer('theme').innerHTML = '';

    state.theme = id;
    document.documentElement.setAttribute('data-juicy-theme', id);
    document.documentElement.classList.add('juicy-switching');

    var incoming = themes.get(id);
    var api = buildApi();
    var mountCount = 0;
    if (logEnabled) {
      var originalMount = api.mount;
      api.mount = function (name, container) {
        var el = originalMount(name, container);
        if (el) mountCount++;
        return el;
      };
    }
    var layoutStart = logEnabled ? performance.now() : 0;
    safeCall(incoming.layout, api);
    if (logEnabled) {
      logEvent('theme ' + (prevTheme || '-') + ' -> ' + id +
        ' regions=' + mountCount + ' layout=' + (performance.now() - layoutStart).toFixed(1) + 'ms');
    }

    window.scrollTo(0, prevScrollY);

    if (controlsMounted) mountControls(lastControlsOpts);
    if (navMounted) mountThemeNav();

    document.dispatchEvent(new CustomEvent('juicy:theme', { detail: { id: id } }));
    window.setTimeout(function () {
      document.documentElement.classList.remove('juicy-switching');
    }, 400);
    return Juicy;
  }

  /* ---------------- contrôles générés (§6) ---------------- */

  function mountControls(opts) {
    opts = opts || {};
    lastControlsOpts = opts;
    controlsMounted = true;

    var toggleIds = opts.toggles || Array.from(effects.entries())
      .filter(function (e) { return e[1].kind === 'continuous'; })
      .map(function (e) { return e[0]; });
    var actionDefs = opts.actions || DEFAULT_ACTIONS;
    var theme = themes.get(state.theme);

    var controlsRegion = region('controls');
    if (controlsRegion) {
      controlsRegion.innerHTML = '';
      toggleIds.forEach(function (id) {
        var def = effects.get(id);
        var label = (theme && theme.labels && theme.labels[id]) || (def && def.label) || id;
        var wrap = document.createElement('div');
        wrap.className = 'juicy-toggle';
        wrap.setAttribute('data-juicy-toggle', id);
        wrap.setAttribute('role', 'switch');
        wrap.setAttribute('tabindex', '0');
        var on = isOnEffect(id);
        wrap.setAttribute('aria-checked', String(on));
        wrap.setAttribute('data-on', String(on));
        wrap.innerHTML =
          '<span class="juicy-toggle-control"><span class="juicy-toggle-thumb"></span></span>' +
          '<span class="juicy-toggle-label"></span>';
        wrap.querySelector('.juicy-toggle-label').textContent = label;
        function activate() {
          var nowOn = toggleEffect(id);
          wrap.setAttribute('aria-checked', String(nowOn));
          wrap.setAttribute('data-on', String(nowOn));
        }
        wrap.addEventListener('click', activate);
        wrap.addEventListener('keydown', function (e) {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); activate(); }
        });
        controlsRegion.appendChild(wrap);
      });
    }

    var actionsRegion = region('actions');
    if (actionsRegion) {
      actionsRegion.innerHTML = '';
      actionDefs.forEach(function (a) {
        var label = (theme && theme.labels && theme.labels[a.id]) || a.id;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'juicy-action';
        btn.setAttribute('data-juicy-action', a.id);
        btn.innerHTML = '<span class="juicy-action-label"></span>';
        btn.querySelector('.juicy-action-label').textContent = label;
        btn.addEventListener('pointerdown', function () {
          btn.setAttribute('data-armed', 'true');
          window.setTimeout(function () { btn.removeAttribute('data-armed'); }, 200);
        });
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          fireEffect(a.effect, a.params);
          btn.setAttribute('data-firing', 'true');
          window.setTimeout(function () { btn.removeAttribute('data-firing'); }, 300);
          var cooldown = Object.prototype.hasOwnProperty.call(ACTION_COOLDOWN, a.id)
            ? ACTION_COOLDOWN[a.id] : DEFAULT_ACTION_COOLDOWN;
          if (cooldown > 0) {
            btn.setAttribute('data-cooldown', 'true');
            btn.disabled = true;
            var start = performance.now();
            (function tick() {
              var elapsed = performance.now() - start;
              var remaining = Math.max(0, 1 - elapsed / cooldown);
              btn.style.setProperty('--cooldown', remaining.toFixed(3));
              if (elapsed < cooldown) {
                window.requestAnimationFrame(tick);
              } else {
                btn.removeAttribute('data-cooldown');
                btn.disabled = false;
                btn.style.removeProperty('--cooldown');
              }
            })();
          }
        });
        actionsRegion.appendChild(btn);
      });
    }

    return Juicy;
  }

  function mountThemeNav() {
    navMounted = true;
    var navRegion = region('nav');
    if (!navRegion) return Juicy;
    navRegion.innerHTML = '';
    themes.forEach(function (def, id) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'juicy-theme-btn';
      btn.setAttribute('data-juicy-theme-btn', id);
      btn.textContent = def.name || id;
      btn.setAttribute('aria-pressed', String(id === state.theme));
      btn.addEventListener('click', function () { setTheme(id); });
      navRegion.appendChild(btn);
    });
    return Juicy;
  }

  /* ---------------- narration / toasts ---------------- */

  function narrate(text) {
    var theme = themes.get(state.theme);
    if (theme && typeof theme.narrate === 'function') {
      safeCall(theme.narrate, text, buildApi());
    } else {
      var el = region('narration');
      if (el) el.textContent = text;
    }
    return Juicy;
  }

  function toastFn(text, opts) {
    if (!widgets.has('toast')) {
      console.warn('[Juicy] widget "toast" not registered');
      return Juicy;
    }
    widgetFn('toast', null, Object.assign({ text: text }, opts));
    return Juicy;
  }

  /* ---------------- divers globaux (reduced motion, audio, touches) ---------------- */

  function setupReducedMotion() {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    function apply(matches) {
      state.reduceMotion = matches;
      document.documentElement.classList.toggle('juicy-reduced', matches);
    }
    apply(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', function (e) { apply(e.matches); });
    else if (mq.addListener) mq.addListener(function (e) { apply(e.matches); });
  }

  function setupAudioUnlock() {
    if (!has('Tone')) return;
    function unlock() {
      safeCall(function () { window.Tone.start(); });
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    }
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  function setupThemeKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key !== '1' && e.key !== '2' && e.key !== '3') return;
      var target = e.target;
      var tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
      var ids = Array.from(themes.keys());
      var id = ids[Number(e.key) - 1];
      if (id) setTheme(id);
    });
  }

  /* ---------------- API publique (§5) ---------------- */

  function list() {
    var continuous = [];
    var oneshot = [];
    effects.forEach(function (def, id) {
      (def.kind === 'continuous' ? continuous : oneshot).push(id);
    });
    return { continuous: continuous, oneshot: oneshot, themes: Array.from(themes.keys()) };
  }

  function init(opts) {
    if (initialized) {
      console.warn('[Juicy] init() called twice, ignoring');
      return Juicy;
    }
    opts = opts || {};
    logEnabled = !!opts.log || urlHasLogFlag();
    initPerfTime = performance.now();
    initParams = opts.params || {};

    discoverRegions();
    layers = buildLayers();
    particleEngine = createParticleEngine(layers.canvas);
    ticker = createTicker();
    ticker.add(function (dt, ts) { particleEngine._tick(dt, ts); });
    ticker.start();

    setupReducedMotion();
    setupAudioUnlock();
    setupThemeKeys();

    initialized = true;

    var initialTheme = opts.theme || Array.from(themes.keys())[0];
    logEvent('init theme=' + (initialTheme || '-') +
      ' gsap=' + has('gsap') + ' confetti=' + has('confetti') +
      ' tsParticles=' + has('tsParticles') + ' Tone=' + has('Tone'));
    if (initialTheme) setTheme(initialTheme);

    mountThemeNav();
    if (opts.controls !== false) mountControls();

    (opts.on || []).forEach(function (id) {
      onEffect(id, opts.params && opts.params[id]);
    });

    document.dispatchEvent(new CustomEvent('juicy:ready', { detail: { theme: state.theme } }));
    return Juicy;
  }

  var Juicy = {
    __juicyCore: true,
    init: init,
    on: onEffect,
    off: offEffect,
    toggle: toggleEffect,
    isOn: isOnEffect,
    set: setEffect,
    fire: fireEffect,
    setTheme: setTheme,
    widget: widgetFn,
    narrate: narrate,
    toast: toastFn,
    list: list,
    has: has,
    log: publicLog,
    state: state,
    mountControls: mountControls,
    mountThemeNav: mountThemeNav,
    defineEffect: defineEffect,
    defineWidget: defineWidget,
    registerTheme: registerTheme,
  };

  window.Juicy = Juicy;
})();
