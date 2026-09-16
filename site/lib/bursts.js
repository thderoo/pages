/*
 * bursts.js — the seven oneshot ("ponctuel") effects: burst, shake,
 * emojiRain, counter, timewarp, everything, reset. See contrat-lib.md §7.
 *
 * Depends only on window.Juicy (lib/juicy.js), loaded before this file per
 * the load order in contrat-lib.md §2. Everything here is registered
 * through Juicy.defineEffect: no globals besides Juicy are created, no
 * setTimeout/setInterval/requestAnimationFrame of our own — timing goes
 * through ctx.ticker (kernel loop) or through GSAP's own scheduler, exactly
 * as the effects contract requires ("une seule boucle existe, celle du
 * noyau").
 */
(function () {
  'use strict';

  if (typeof window.Juicy === 'undefined' || typeof window.Juicy.defineEffect !== 'function') {
    return;
  }

  var Juicy = window.Juicy;

  // ---------------------------------------------------------------------
  // shared helpers
  // ---------------------------------------------------------------------

  function pick(list, i) {
    return list && list.length ? list[i % list.length] : undefined;
  }

  function resolveOrigin(origin, root) {
    if (origin === 'pointer' && Juicy.state && Juicy.state.pointer) {
      return { x: Juicy.state.pointer.x, y: Juicy.state.pointer.y };
    }
    if (origin && typeof origin === 'object' && 'x' in origin && 'y' in origin) {
      return { x: origin.x, y: origin.y };
    }
    // 'center', unresolved 'pointer', or anything else: fall back to center.
    return { x: root.clientWidth / 2, y: root.clientHeight / 2 };
  }

  // ---------------------------------------------------------------------
  // burst — parametric explosion, presets confetti / firework / shockwave
  // ---------------------------------------------------------------------

  var BURST_PRESETS = {
    confetti: { count: 60, spread: 70, gravity: 620, duration: 1.4, shapes: ['square', 'circle'] },
    firework: { count: 90, spread: 360, gravity: 260, duration: 1.6, shapes: ['circle', 'star'] },
    shockwave: { count: 40, spread: 360, gravity: 40, duration: 0.9, shapes: ['circle'] },
  };

  Juicy.defineEffect({
    id: 'burst',
    kind: 'oneshot',
    label: 'Explosion',
    defaults: {
      preset: 'confetti',
      origin: 'pointer',
      count: null,
      colors: null,
      shapes: null,
      spread: null,
      gravity: null,
      duration: null,
    },
    fire: function (ctx) {
      var p = ctx.params;
      var preset = BURST_PRESETS[p.preset] || BURST_PRESETS.confetti;
      var count = p.count != null ? p.count : preset.count;
      var spread = p.spread != null ? p.spread : preset.spread;
      var gravity = p.gravity != null ? p.gravity : preset.gravity;
      var duration = p.duration != null ? p.duration : preset.duration;
      var shapes = p.shapes || preset.shapes;
      var colors = p.colors || (ctx.theme && ctx.theme.palette) || ['#ffffff', '#ffd166'];
      var origin = resolveOrigin(p.origin, ctx.root);
      var spreadRad = (spread * Math.PI) / 180;

      // Real particles on the kernel canvas: the effect never depends on an
      // external lib to be visible, and this is what canvas.count() reads.
      ctx.canvas.spawnMany(count, function (i) {
        var angle = -Math.PI / 2 + (Math.random() - 0.5) * spreadRad;
        var speed = 180 + Math.random() * 260;
        return {
          x: origin.x,
          y: origin.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          ax: 0,
          ay: gravity,
          life: duration * (0.7 + Math.random() * 0.6),
          size: 5 + Math.random() * 7,
          shape: pick(shapes, i),
          color: pick(colors, i),
          fade: true,
          rotation: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 6,
        };
      });

      // canvas-confetti, really used, additive: skipped silently if absent.
      if (ctx.confetti) {
        ctx.confetti({
          particleCount: Math.round(count / 2),
          spread: spread,
          startVelocity: p.preset === 'firework' ? 55 : 40,
          origin: {
            x: origin.x / ctx.root.clientWidth,
            y: origin.y / ctx.root.clientHeight,
          },
          colors: colors,
        });
      }

      // GSAP, really used, additive: a staggered second confetti wave for
      // firework, an expanding ring for shockwave. Skipped silently if GSAP
      // is absent or reduced motion is requested.
      if (p.preset === 'firework' && ctx.gsap && ctx.confetti && !ctx.state.reduceMotion) {
        [0.12, 0.24].forEach(function (delay) {
          ctx.gsap.delayedCall(delay, function () {
            ctx.confetti({
              particleCount: 24,
              spread: 360,
              startVelocity: 35,
              origin: {
                x: origin.x / ctx.root.clientWidth,
                y: origin.y / ctx.root.clientHeight,
              },
              colors: colors,
            });
          });
        });
      } else if (p.preset === 'shockwave' && ctx.gsap && !ctx.state.reduceMotion) {
        var overlay = ctx.layer('overlay');
        if (overlay) {
          var ring = document.createElement('div');
          ring.className = 'juicy-shockwave-ring';
          ring.style.left = origin.x + 'px';
          ring.style.top = origin.y + 'px';
          ring.style.setProperty('--juicy-shockwave-color', colors[0] || '#ffffff');
          overlay.appendChild(ring);
          ctx.gsap.to(ring, {
            width: 480,
            height: 480,
            opacity: 0,
            duration: duration,
            ease: 'power2.out',
            onComplete: function () {
              ring.remove();
            },
          });
        }
      }

      ctx.sound(p.preset === 'confetti' ? 'confetti' : p.preset === 'firework' ? 'firework' : 'shockwave');
    },
  });

  // ---------------------------------------------------------------------
  // shake — screen shake. Targets layer('theme'), never html/body/an
  // ancestor of a fixed layer (contrat §11).
  // ---------------------------------------------------------------------

  Juicy.defineEffect({
    id: 'shake',
    kind: 'oneshot',
    label: 'Secousse',
    needs: ['gsap'],
    defaults: { intensity: 18, duration: 0.5 },
    fire: function (ctx) {
      var target = ctx.layer('theme');
      if (!target) return;
      ctx.sound('shake');
      if (ctx.state.reduceMotion) return;

      var amp = ctx.params.intensity;
      var segDuration = ctx.params.duration / 6;
      var tl = ctx.gsap.timeline({
        onComplete: function () {
          ctx.gsap.set(target, { x: 0, y: 0, rotation: 0 });
        },
      });
      for (var i = 0; i < 5; i++) {
        tl.to(target, {
          x: (Math.random() - 0.5) * amp,
          y: (Math.random() - 0.5) * amp,
          rotation: (Math.random() - 0.5) * (amp / 6),
          duration: segDuration,
          ease: 'power1.inOut',
        });
      }
      tl.to(target, { x: 0, y: 0, rotation: 0, duration: segDuration });
    },
  });

  // ---------------------------------------------------------------------
  // emojiRain — falls through the kernel canvas as 'glyph' particles.
  // ---------------------------------------------------------------------

  Juicy.defineEffect({
    id: 'emojiRain',
    kind: 'oneshot',
    label: "Pluie d'emojis",
    defaults: { glyphs: ['✨', '🎉', '⭐'], count: 24, duration: 2.2, size: 26 },
    fire: function (ctx) {
      var p = ctx.params;
      var glyphs = ctx.theme && ctx.theme.emojis && ctx.theme.emojis.length ? ctx.theme.emojis : p.glyphs;
      var w = ctx.root.clientWidth;
      ctx.canvas.spawnMany(p.count, function (i) {
        return {
          x: Math.random() * w,
          y: -20 - Math.random() * 120,
          vx: (Math.random() - 0.5) * 40,
          vy: 60 + Math.random() * 40,
          ax: 0,
          ay: 90,
          life: p.duration * (0.8 + Math.random() * 0.4),
          size: p.size * (0.8 + Math.random() * 0.4),
          shape: 'glyph',
          glyph: pick(glyphs, i),
          rotation: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 2,
          fade: true,
          tag: 'emojiRain',
        };
      });
      ctx.sound('emoji');
    },
  });

  // ---------------------------------------------------------------------
  // counter — increments state.counter, detects combo, spring animation.
  // ---------------------------------------------------------------------

  var lastCounterFireAt = 0;
  var COMBO_WINDOW_S = 1.4;

  Juicy.defineEffect({
    id: 'counter',
    kind: 'oneshot',
    label: 'Compteur',
    defaults: { amount: 1, origin: 'pointer' },
    fire: function (ctx) {
      var now = performance.now() / 1000;
      var combo = now - lastCounterFireAt <= COMBO_WINDOW_S;
      lastCounterFireAt = now;

      ctx.state.counter += ctx.params.amount;
      ctx.state.combo = combo ? ctx.state.combo + 1 : 1;

      var origin = resolveOrigin(ctx.params.origin, ctx.root);
      var isCrit = ctx.state.combo >= 5;
      var instance = ctx.widget('floatNumber', origin, {
        value: ctx.params.amount,
        prefix: '+',
        color: isCrit && ctx.theme && ctx.theme.palette ? ctx.theme.palette[0] : undefined,
        crit: isCrit,
      });

      // lib.widgets may not be loaded on a page that only wants bursts: fall
      // back to a minimal float number so the effect stays visible on its
      // own, per contrat-lib.md's "aucun fichier de site/lib/ ne suppose"
      // rule (a page loading only bursts.js must still see something).
      if (!instance && ctx.gsap && !ctx.state.reduceMotion) {
        var overlay = ctx.layer('overlay');
        if (overlay) {
          var el = document.createElement('div');
          el.className = 'juicy-counter-fallback';
          el.textContent = '+' + ctx.params.amount;
          el.style.left = origin.x + 'px';
          el.style.top = origin.y + 'px';
          overlay.appendChild(el);
          ctx.gsap.to(el, {
            y: '-=40',
            opacity: 0,
            duration: 0.7,
            ease: 'power1.out',
            onComplete: function () {
              el.remove();
            },
          });
        }
      }

      ctx.sound(combo && ctx.state.combo > 1 ? 'combo' : 'counter');
    },
  });

  // ---------------------------------------------------------------------
  // timewarp — timer button: sets state.timeScale for a duration, shows a
  // countdown, restores state.timeScale to 1. `duration` is in *seconds*
  // (default 4s), matching the human-facing countdown it displays.
  // ---------------------------------------------------------------------

  var timewarpHandle = null;

  function endTimewarp(ctx) {
    if (!timewarpHandle) return;
    ctx.ticker.remove(timewarpHandle.tick);
    if (timewarpHandle.badge && timewarpHandle.badge.parentNode) {
      timewarpHandle.badge.parentNode.removeChild(timewarpHandle.badge);
    }
    ctx.state.timeScale = 1;
    timewarpHandle = null;
  }

  Juicy.defineEffect({
    id: 'timewarp',
    kind: 'oneshot',
    label: 'Ralenti',
    defaults: { scale: 0.35, duration: 4 },
    fire: function (ctx) {
      // Re-firing while active restarts cleanly instead of stacking timers.
      if (timewarpHandle) endTimewarp(ctx);

      var scale = ctx.params.scale;
      var duration = ctx.params.duration;
      ctx.state.timeScale = scale;

      var overlay = ctx.layer('overlay');
      var badge = document.createElement('div');
      badge.className = 'juicy-timewarp-countdown';
      if (!ctx.state.reduceMotion) badge.setAttribute('data-juicy-pulse', 'true');
      if (overlay) overlay.appendChild(badge);

      var remaining = duration;
      function render() {
        badge.textContent = '×' + scale.toFixed(2) + ' · ' + Math.max(0, Math.ceil(remaining)) + 's';
      }
      render();

      // dt is real, unscaled elapsed time: the countdown that produces
      // timeScale must not itself be slowed down by it.
      function tick(dt) {
        remaining -= dt;
        render();
        if (remaining <= 0) endTimewarp(ctx);
      }
      ctx.ticker.add(tick);
      timewarpHandle = { tick: tick, badge: badge };

      // No entry in the closed sound(name) vocabulary (§9) covers timewarp;
      // nothing is played rather than reusing an unrelated name. Flagged in
      // the report as a contract gap for lib.integrate to arbitrate.
      ctx.emit('juicy:timewarp', { scale: scale, duration: duration });
    },
  });

  // ---------------------------------------------------------------------
  // everything — cascades the rest without recalling itself.
  // ---------------------------------------------------------------------

  Juicy.defineEffect({
    id: 'everything',
    kind: 'oneshot',
    label: 'Tout en même temps',
    defaults: {},
    fire: function (ctx) {
      ctx.sound('everything');
      var list = Juicy.list();
      list.continuous.forEach(function (id) {
        if (!Juicy.isOn(id)) Juicy.on(id);
      });
      list.oneshot
        .filter(function (id) {
          return id !== 'everything' && id !== 'reset';
        })
        .forEach(function (id) {
          Juicy.fire(id);
        });
    },
  });

  // ---------------------------------------------------------------------
  // reset — turns off every continuous effect, empties the canvas, resets
  // counter/combo/timeScale, never touches the active theme.
  // ---------------------------------------------------------------------

  Juicy.defineEffect({
    id: 'reset',
    kind: 'oneshot',
    label: 'Réinitialiser',
    defaults: {},
    fire: function (ctx) {
      endTimewarp(ctx); // the only bursts effect that owns a live ticker fn
      var list = Juicy.list();
      list.continuous.forEach(function (id) {
        if (Juicy.isOn(id)) Juicy.off(id);
      });
      ctx.canvas.clear();
      ctx.state.counter = 0;
      ctx.state.combo = 0;
      ctx.state.timeScale = 1;
      ctx.sound('reset');
    },
  });
})();
