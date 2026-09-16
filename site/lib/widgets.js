/*
 * lib/widgets.js — les sept briques réutilisables de Juicy (contrat §8).
 *
 * Chargé après lib/juicy.js : window.Juicy.defineWidget existe déjà. Chaque
 * brique s'enregistre par Juicy.defineWidget(name, (target, opts) => ({ el,
 * update(opts), destroy() })). Une instance n'expose jamais rien d'autre que
 * ces trois membres (sauf mention explicite ci-dessous pour `prop`, qui reste
 * gérable entièrement via update()).
 *
 * Aucune brique ne dessine sur #juicy-canvas, aucune ne tourne en boucle
 * (setInterval / requestAnimationFrame) : les animations sont portées par
 * des transitions CSS déclaratives, sauf le déroulement caractère par
 * caractère de `typewriter` et les auto-destructions temporisées de
 * `toast` / `floatNumber`, dont le seul minuteur est nettoyé par destroy().
 */
(function () {
  'use strict';

  function juicy() {
    return window.Juicy;
  }

  function defineWidget(name, factory) {
    var j = juicy();
    if (j && typeof j.defineWidget === 'function') {
      j.defineWidget(name, factory);
    } else {
      // Dégradation gracieuse : lib/juicy.js absent ou pas encore chargé.
      // Jamais d'erreur, un simple constat.
      console.info('[juicy-widgets] Juicy.defineWidget indisponible, "' + name + '" non enregistré');
    }
  }

  function prefersReducedMotion() {
    try {
      var j = juicy();
      if (j && j.state && typeof j.state.reduceMotion === 'boolean') {
        return j.state.reduceMotion;
      }
    } catch (e) {}
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function resolveEl(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      try { return document.querySelector(target); } catch (e) { return null; }
    }
    if (target instanceof Element) return target;
    return null;
  }

  function safeCall(fn, args) {
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(null, args || []);
    } catch (e) {
      console.info('[juicy-widgets] callback en erreur, ignoré :', e);
      return undefined;
    }
  }

  // Un seul minuteur nommé par instance : poser un nouveau annule l'ancien,
  // cleanup() les efface tous. Aucune brique n'utilise setInterval ni rAF.
  function makeTimers() {
    var handles = Object.create(null);
    return {
      set: function (name, fn, ms) {
        this.clear(name);
        handles[name] = window.setTimeout(function () {
          delete handles[name];
          fn();
        }, ms);
      },
      clear: function (name) {
        if (handles[name] != null) {
          window.clearTimeout(handles[name]);
          delete handles[name];
        }
      },
      cleanup: function () {
        Object.keys(handles).forEach(function (name) {
          window.clearTimeout(handles[name]);
          delete handles[name];
        });
      }
    };
  }

  function removeNode(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ===========================================================
  // typewriter — élément — { text, speed, sound, onDone }
  // update({text}) relance le déroulé.
  // ===========================================================
  defineWidget('typewriter', function (target, initialOpts) {
    var container = resolveEl(target);
    var el = document.createElement('span');
    el.className = 'juicy-typewriter';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    var textEl = document.createElement('span');
    textEl.className = 'juicy-typewriter-text';
    var cursorEl = document.createElement('span');
    cursorEl.className = 'juicy-typewriter-cursor';
    cursorEl.setAttribute('aria-hidden', 'true');
    el.appendChild(textEl);
    el.appendChild(cursorEl);
    if (container) container.appendChild(el);

    var timers = makeTimers();
    var current = { text: '', speed: 32, sound: null, onDone: null };
    var destroyed = false;

    function render(patch, merge) {
      current = merge
        ? Object.assign({}, current, patch || {})
        : Object.assign({ text: '', speed: 32, sound: null, onDone: null }, patch || {});
      timers.clear('type');

      var text = current.text == null ? '' : String(current.text);
      if (!text) {
        textEl.textContent = '';
        return;
      }

      if (prefersReducedMotion() || !current.speed || current.speed <= 0) {
        textEl.textContent = text;
        safeCall(current.onDone);
        return;
      }

      var i = 0;
      var delay = Math.max(1000 / current.speed, 1);
      textEl.textContent = '';
      (function step() {
        i += 1;
        textEl.textContent = text.slice(0, i);
        safeCall(current.sound, [text.charAt(i - 1)]);
        if (i >= text.length) {
          safeCall(current.onDone);
          return;
        }
        timers.set('type', step, delay);
      })();
    }

    render(initialOpts, false);

    return {
      el: el,
      update: function (patch) {
        if (destroyed) return;
        render(patch, true);
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        timers.cleanup();
        removeNode(el);
      }
    };
  });

  // ===========================================================
  // floatNumber — élément ou {x,y} — { value, color, prefix, crit, duration }
  // Auto-destruction après duration (défaut 900ms).
  // ===========================================================
  defineWidget('floatNumber', function (target, opts) {
    opts = opts || {};
    var el = document.createElement('span');
    el.className = 'juicy-floatnumber';
    el.setAttribute('aria-hidden', 'true');

    var instant = prefersReducedMotion();
    if (instant) el.setAttribute('data-instant', 'true');
    if (opts.crit) el.setAttribute('data-crit', 'true');
    if (opts.color) el.style.color = opts.color;

    var point = null;
    if (target && typeof target.x === 'number' && typeof target.y === 'number') {
      point = { x: target.x, y: target.y };
    } else {
      var refEl = resolveEl(target);
      if (refEl) {
        var rect = refEl.getBoundingClientRect();
        point = { x: rect.left + rect.width / 2, y: rect.top };
      }
    }
    if (point) {
      el.style.left = point.x + 'px';
      el.style.top = point.y + 'px';
    }

    function text(o) {
      var prefix = o.prefix == null ? '' : String(o.prefix);
      var value = o.value == null ? '' : String(o.value);
      return prefix + value;
    }
    el.textContent = text(opts);

    document.body.appendChild(el);

    var timers = makeTimers();
    var destroyed = false;
    var duration = typeof opts.duration === 'number' ? opts.duration : 900;

    function rise() {
      // Force un reflow pour que la transition parte bien de l'état initial.
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.setAttribute('data-risen', 'true');
    }

    if (instant) {
      el.setAttribute('data-risen', 'true');
    } else {
      timers.set('rise', rise, 16);
    }
    timers.set('gone', function () {
      instance.destroy();
    }, duration);

    var instance = {
      el: el,
      update: function (patch) {
        if (destroyed) return;
        patch = patch || {};
        if (patch.color) el.style.color = patch.color;
        if (patch.crit) el.setAttribute('data-crit', 'true');
        if ('value' in patch || 'prefix' in patch) {
          el.textContent = text(Object.assign({}, opts, patch));
        }
        opts = Object.assign({}, opts, patch);
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        timers.cleanup();
        removeNode(el);
      }
    };
    return instance;
  });

  // ===========================================================
  // toast — cible ignorée (null), rendu dans la couche toasts — { text, icon, duration, kind }
  // Auto-destruction après duration (défaut 3000ms).
  // ===========================================================
  function toastStack() {
    var real = document.getElementById('juicy-toasts');
    if (real) return real;
    var fallback = document.querySelector('.juicy-toast-stack--fallback');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.className = 'juicy-toast-stack--fallback';
      document.body.appendChild(fallback);
    }
    return fallback;
  }

  defineWidget('toast', function (_target, opts) {
    opts = opts || {};
    var stack = toastStack();

    var el = document.createElement('div');
    el.className = 'juicy-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    if (opts.kind) el.setAttribute('data-kind', opts.kind);

    var instant = prefersReducedMotion();
    if (instant) el.setAttribute('data-instant', 'true');

    if (opts.icon) {
      var iconEl = document.createElement('span');
      iconEl.className = 'juicy-toast-icon';
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.textContent = opts.icon;
      el.appendChild(iconEl);
    }
    var textEl = document.createElement('span');
    textEl.className = 'juicy-toast-text';
    textEl.textContent = opts.text == null ? '' : String(opts.text);
    el.appendChild(textEl);

    stack.appendChild(el);

    var timers = makeTimers();
    var destroyed = false;
    var duration = typeof opts.duration === 'number' ? opts.duration : 3000;

    if (instant) {
      el.setAttribute('data-shown', 'true');
    } else {
      timers.set('show', function () {
        el.setAttribute('data-shown', 'true');
      }, 16);
    }
    timers.set('gone', function () {
      instance.destroy();
    }, duration);

    var instance = {
      el: el,
      update: function (patch) {
        if (destroyed) return;
        patch = patch || {};
        if ('text' in patch) textEl.textContent = String(patch.text);
        if ('icon' in patch) {
          var iconEl2 = el.querySelector('.juicy-toast-icon');
          if (patch.icon && !iconEl2) {
            iconEl2 = document.createElement('span');
            iconEl2.className = 'juicy-toast-icon';
            iconEl2.setAttribute('aria-hidden', 'true');
            el.insertBefore(iconEl2, textEl);
          }
          if (iconEl2) iconEl2.textContent = patch.icon || '';
        }
        if (patch.kind) el.setAttribute('data-kind', patch.kind);
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        timers.cleanup();
        removeNode(el);
        if (stack.classList.contains('juicy-toast-stack--fallback') && !stack.children.length) {
          removeNode(stack);
        }
      }
    };
    return instance;
  });

  // ===========================================================
  // gauge — élément — { value, max, label, color, segments, shape }
  // shape: 'linear' (défaut) | 'radial'.
  // ===========================================================
  var RADIAL_RADIUS = 42; // rayon du cercle SVG, en unités de viewBox

  defineWidget('gauge', function (target, opts) {
    opts = opts || {};
    var container = resolveEl(target);

    var el = document.createElement('div');
    el.className = 'juicy-gauge';
    el.setAttribute('role', 'progressbar');

    var shape = opts.shape === 'radial' ? 'radial' : 'linear';
    el.setAttribute('data-shape', shape);
    if (prefersReducedMotion()) el.setAttribute('data-instant', 'true');

    var labelEl = document.createElement('div');
    labelEl.className = 'juicy-gauge-label';
    el.appendChild(labelEl);

    var fillEl, trackEl, ringFillEl, ringValueEl, circumference;

    if (shape === 'linear') {
      trackEl = document.createElement('div');
      trackEl.className = 'juicy-gauge-track';
      fillEl = document.createElement('div');
      fillEl.className = 'juicy-gauge-fill';
      trackEl.appendChild(fillEl);
      el.appendChild(trackEl);
    } else {
      var wrap = document.createElement('div');
      wrap.className = 'juicy-gauge-ring-wrap';
      var svgNS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'juicy-gauge-ring');
      svg.setAttribute('viewBox', '0 0 100 100');
      var ringTrack = document.createElementNS(svgNS, 'circle');
      ringTrack.setAttribute('class', 'juicy-gauge-ring-track');
      ringTrack.setAttribute('cx', '50');
      ringTrack.setAttribute('cy', '50');
      ringTrack.setAttribute('r', String(RADIAL_RADIUS));
      ringFillEl = document.createElementNS(svgNS, 'circle');
      ringFillEl.setAttribute('class', 'juicy-gauge-ring-fill');
      ringFillEl.setAttribute('cx', '50');
      ringFillEl.setAttribute('cy', '50');
      ringFillEl.setAttribute('r', String(RADIAL_RADIUS));
      circumference = 2 * Math.PI * RADIAL_RADIUS;
      ringFillEl.setAttribute('stroke-dasharray', String(circumference));
      svg.appendChild(ringTrack);
      svg.appendChild(ringFillEl);
      wrap.appendChild(svg);
      ringValueEl = document.createElement('div');
      ringValueEl.className = 'juicy-gauge-ring-value';
      wrap.appendChild(ringValueEl);
      el.appendChild(wrap);
    }

    if (container) container.appendChild(el);

    var current = { value: 0, max: 100, label: '', color: null, segments: 0, shape: shape };

    function paint(patch, merge) {
      current = merge ? Object.assign({}, current, patch || {}) : Object.assign({}, current, patch || {});
      var max = current.max > 0 ? current.max : 1;
      var value = Math.max(0, Math.min(current.value, max));
      var ratio = value / max;

      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(max));
      el.setAttribute('aria-valuenow', String(value));
      if (current.label) el.setAttribute('aria-label', current.label);

      var labelText = current.label ? current.label + ' ' : '';
      labelEl.textContent = labelText + value + ' / ' + max;

      if (current.color) {
        el.style.setProperty('--juicy-widget-accent', current.color);
      }

      if (shape === 'linear') {
        fillEl.style.width = (ratio * 100) + '%';
        var existingSegs = trackEl.querySelector('.juicy-gauge-segments');
        if (existingSegs) removeNode(existingSegs);
        var segCount = current.segments | 0;
        if (segCount > 1) {
          var segsEl = document.createElement('div');
          segsEl.className = 'juicy-gauge-segments';
          for (var c = 0; c < segCount; c += 1) {
            var cell = document.createElement('div');
            cell.className = 'juicy-gauge-segment';
            segsEl.appendChild(cell);
          }
          trackEl.appendChild(segsEl);
        }
      } else {
        var offset = circumference * (1 - ratio);
        ringFillEl.style.strokeDashoffset = String(offset);
        ringValueEl.textContent = value;
      }
    }

    paint(opts, false);

    return {
      el: el,
      update: function (patch) {
        paint(patch, true);
      },
      destroy: function () {
        removeNode(el);
      }
    };
  });

  // ===========================================================
  // ticker — élément — { items, speed, separator }
  // Défilement par animation CSS déclarative, sans JS en boucle.
  // ===========================================================
  defineWidget('ticker', function (target, opts) {
    opts = opts || {};
    var container = resolveEl(target);

    var el = document.createElement('div');
    el.className = 'juicy-ticker';
    el.setAttribute('aria-label', 'télémétrie');

    var track = document.createElement('div');
    track.className = 'juicy-ticker-track';
    el.appendChild(track);

    if (container) container.appendChild(el);

    var current = { items: [], speed: 60, separator: '•' };

    function buildItems(items, separator) {
      var frag = document.createDocumentFragment();
      // dupliqué deux fois pour boucler sans coupure visible (translateX -50%)
      for (var pass = 0; pass < 2; pass += 1) {
        items.forEach(function (item) {
          var itemEl = document.createElement('span');
          itemEl.className = 'juicy-ticker-item';
          itemEl.setAttribute('data-separator', separator);
          itemEl.textContent = String(item);
          frag.appendChild(itemEl);
        });
      }
      return frag;
    }

    function paint(patch, merge) {
      current = merge ? Object.assign({}, current, patch || {}) : Object.assign({}, current, patch || {});
      var items = Array.isArray(current.items) ? current.items : [];
      track.innerHTML = '';
      track.appendChild(buildItems(items, current.separator == null ? '•' : current.separator));

      if (prefersReducedMotion() || !items.length) {
        el.setAttribute('data-instant', 'true');
        return;
      }
      el.removeAttribute('data-instant');
      // durée ~ proportionnelle au nombre de caractères / vitesse (px/s estimée)
      var totalChars = items.join('').length || 1;
      var estPx = totalChars * 9;
      var speed = current.speed > 0 ? current.speed : 60;
      var dur = Math.max(estPx / speed, 4);
      el.style.setProperty('--juicy-ticker-duration', dur + 's');
    }

    paint(opts, false);

    return {
      el: el,
      update: function (patch) {
        paint(patch, true);
      },
      destroy: function () {
        removeNode(el);
      }
    };
  });

  // ===========================================================
  // alert — élément — { text, level, blink }
  // ===========================================================
  defineWidget('alert', function (target, opts) {
    opts = opts || {};
    var container = resolveEl(target);

    var el = document.createElement('div');
    el.className = 'juicy-alert';

    var textEl = document.createElement('span');
    textEl.className = 'juicy-alert-text';
    el.appendChild(textEl);

    if (container) container.appendChild(el);

    function paint(patch, merge) {
      var current = merge ? Object.assign({}, paint.current, patch || {}) : Object.assign({ text: '', level: 'info', blink: false }, patch || {});
      paint.current = current;

      textEl.textContent = current.text == null ? '' : String(current.text);
      el.setAttribute('data-level', current.level || 'info');
      el.setAttribute('role', current.level === 'danger' ? 'alert' : 'status');

      var blinkOn = !!current.blink && !prefersReducedMotion();
      if (blinkOn) {
        el.setAttribute('data-blink', 'true');
        el.removeAttribute('data-instant');
      } else {
        el.removeAttribute('data-blink');
        if (current.blink) el.setAttribute('data-instant', 'true');
      }
    }
    paint.current = {};

    paint(opts, false);

    return {
      el: el,
      update: function (patch) {
        paint(patch, true);
      },
      destroy: function () {
        removeNode(el);
      }
    };
  });

  // ===========================================================
  // prop — élément — { sprite, states, react }
  // `states` : { nomEtat: { text?, class? } }. `react(event)` -> nomEtat,
  // fourni par l'appelant ; appelé par update({event}). update({state:...})
  // bascule un état directement. update({sprite:...}) change le contenu de
  // base sans état. Reste à exactement { el, update, destroy }.
  // ===========================================================
  defineWidget('prop', function (target, opts) {
    opts = opts || {};
    var container = resolveEl(target);

    var el = document.createElement('div');
    el.className = 'juicy-prop';
    el.setAttribute('aria-hidden', 'true');

    var spriteEl = document.createElement('span');
    spriteEl.className = 'juicy-prop-sprite';
    el.appendChild(spriteEl);

    if (prefersReducedMotion()) el.setAttribute('data-instant', 'true');

    if (container) container.appendChild(el);

    var current = {
      sprite: opts.sprite || '',
      states: opts.states || {},
      react: typeof opts.react === 'function' ? opts.react : null,
      state: opts.initialState || null
    };
    var activeStateClass = null;

    function applyState(stateName) {
      var def = current.states && current.states[stateName];
      if (activeStateClass) {
        el.classList.remove(activeStateClass);
        activeStateClass = null;
      }
      if (!def) return;
      current.state = stateName;
      if (def.class) {
        el.classList.add(def.class);
        activeStateClass = def.class;
      }
      spriteEl.textContent = def.text != null ? String(def.text) : String(current.sprite);
    }

    spriteEl.textContent = String(current.sprite);
    if (current.state) applyState(current.state);

    return {
      el: el,
      update: function (patch) {
        patch = patch || {};
        if ('sprite' in patch) {
          current.sprite = patch.sprite;
          if (!current.state) spriteEl.textContent = String(current.sprite);
        }
        if ('states' in patch) current.states = patch.states || {};
        if ('react' in patch) current.react = typeof patch.react === 'function' ? patch.react : null;
        if ('state' in patch) {
          applyState(patch.state);
        } else if ('event' in patch && current.react) {
          var next = safeCall(current.react, [patch.event]);
          if (next) applyState(next);
        }
      },
      destroy: function () {
        removeNode(el);
      }
    };
  });
})();
