/*
 * effects.js — les douze effets continus de la bibliothèque Juicy
 * (contrat lib §7). Chaque effet s'enregistre par `Juicy.defineEffect` et ne
 * connaît rien d'une page cliente particulière : sélecteurs, couleurs et
 * seuils sont tous des paramètres avec un défaut raisonnable, jamais une
 * valeur en dur. `bg` utilise tsParticles, les mouvements (`glitch`, `tilt`,
 * `magnet`, `cursor`, `shaketext`, `drunk`) utilisent GSAP, `crt` utilise
 * Tone.js pour un souffle discret ; `sound` et `music` ne produisent rien
 * eux-mêmes, ils relaient respectivement l'interrupteur global de son et le
 * hook `theme.music` (voir contrat §7, "points figés").
 *
 * Convention de ciblage : les effets qui agissent sur des éléments de la
 * page (glitch, tilt, magnet, shaketext) prennent trois niveaux de cible,
 * du plus prioritaire au plus faible : (1) `params.selector` explicite,
 * passé par la page ou un preset de thème ; (2) le marqueur
 * `[data-juicy-<id>]`, posé par une page cliente sur l'élément qu'elle veut
 * opter ; (3) à défaut des deux, une cible par défaut qui existe sur toute
 * page Juicy standard (titre, toggles, actions, libellés — voir chaque
 * effet). `drunk` cible par défaut le contenu de la couche thème
 * (`#juicy-theme-layer`, où les thèmes montent toutes leurs régions), ou la
 * région `stage` si cette couche est vide — jamais `html`/`body`, voir
 * contrat §11.
 */
(function () {
  if (typeof window === 'undefined' || !window.Juicy || typeof window.Juicy.defineEffect !== 'function') {
    return; // lib.core doit être chargé avant ce fichier (contrat §2)
  }

  // Vrai si l'utilisateur a demandé moins de mouvement : tout effet qui pose
  // une boucle continue doit alors rendre un état final statique et net.
  function reduced(ctx) {
    return !!(ctx.state && ctx.state.reduceMotion);
  }

  // Résout les cibles d'un effet de ciblage (glitch/tilt/magnet/shaketext) :
  // sélecteur explicite (params.selector) > marqueur [data-juicy-<id>] >
  // cible par défaut fournie par l'effet (garantie présente sur une page
  // Juicy standard, sans jamais lever d'erreur si elle manque).
  function resolveTargets(ctx, effectId, fallbackSelector) {
    if (ctx.params.selector) return document.querySelectorAll(ctx.params.selector);
    var marked = document.querySelectorAll('[data-juicy-' + effectId + ']');
    if (marked.length) return marked;
    return document.querySelectorAll(fallbackSelector);
  }

  // Le bundle CDN tsParticles (« slim ») expose son moteur sur
  // `window.tsParticles`, mais ses greffons (dont celui qui déplace les
  // particules à chaque frame) s'enregistrent séparément, via la fonction
  // globale `loadSlim` exportée par ce même bundle. Sans cet appel,
  // `tsParticles.load()` construit bien un champ de particules qui se
  // dessine, mais aucun greffon de mouvement n'est enregistré : les
  // particules restent parfaitement immobiles (`speed`/`size` n'y changent
  // rien) alors que rien ne signale d'erreur. Un seul enregistrement vaut
  // pour toute la page ; mis en cache pour ne jamais le refaire.
  let tsParticlesReady = null;
  function ensureTsParticlesEngine(tsParticles) {
    if (!tsParticlesReady) {
      tsParticlesReady =
        typeof window.loadSlim === 'function'
          ? Promise.resolve(window.loadSlim(tsParticles)).catch(() => {})
          : Promise.resolve();
    }
    return tsParticlesReady;
  }

  // ---------------------------------------------------------------------
  // bg — fond animé, propriété exclusive de tsParticles
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'bg',
    kind: 'continuous',
    label: 'Fond animé',
    needs: ['tsParticles'],
    defaults: {
      count: 60, // nombre de particules ciblées à l'écran
      color: null, // couleur css des particules ; null = couleur de palette du thème
      size: 6, // rayon moyen d'une particule en px
      speed: 4, // vitesse de déplacement (facteur, 1 = normal) — à 1 le
      // déplacement par particule est trop lent pour rester "animé" au sens
      // d'une vraie différence de pixels perceptible sur une fenêtre courte
      shape: 'circle', // 'circle' | 'square' | 'triangle' | 'star'
      links: false, // relie les particules proches par un trait
      opacity: 0.75 // opacité moyenne des particules
    },
    start(ctx) {
      if (!ctx.tsParticles || typeof ctx.tsParticles.load !== 'function') return;
      const el = ctx.layer('bg');
      ctx.log({ layer: 'bg', targets: el ? 1 : 0 });
      if (!el) return;
      const palette =
        (ctx.theme && ctx.theme.palette && ctx.theme.palette[0]) || '#ffffff';
      const color = ctx.params.color || palette;
      const containerId = 'juicy-bg-' + Math.random().toString(36).slice(2);
      const options = {
        fullScreen: { enable: false },
        background: { color: { value: 'transparent' } },
        particles: {
          number: { value: ctx.params.density != null ? ctx.params.density : ctx.params.count },
          color: { value: color },
          shape: { type: ctx.params.shape },
          opacity: { value: ctx.params.opacity },
          size: { value: ctx.params.size },
          links: { enable: !!ctx.params.links, color, distance: 120, opacity: 0.3 },
          move: { enable: true, speed: ctx.params.speed, outModes: { default: 'out' } }
        },
        detectRetina: true
      };
      let cancelled = false;
      let handle = null;
      ensureTsParticlesEngine(ctx.tsParticles)
        .then(() => {
          if (cancelled) return null;
          return ctx.tsParticles.load({ id: containerId, element: el, options });
        })
        .then((container) => {
          if (cancelled) {
            if (container && container.destroy) container.destroy();
            return;
          }
          handle = container;
        })
        .catch(() => {});
      ctx.onStop(() => {
        cancelled = true;
        if (handle && handle.destroy) handle.destroy();
        handle = null;
        el.innerHTML = '';
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // trail — traînée de particules derrière le pointeur ou le doigt
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'trail',
    kind: 'continuous',
    label: 'Traînée',
    needs: [],
    defaults: {
      color: null, // couleur css ; null = couleur de palette du thème
      size: 13, // taille en px des particules laissées (6 laissait une
      // traînée trop clairsemée pour rester mesurable sur un thème dense en
      // panneaux — cf. contrat lib §7)
      life: 0.6, // durée de vie d'une particule en secondes
      spacing: 8, // distance mini en px entre deux dépôts consécutifs (18
      // espaçait trop les dépôts ; une traînée plus dense reste visible même
      // sur un trajet court)
      shape: 'circle', // 'circle' | 'square' | 'triangle' | 'star' | 'glyph'
      glyph: '•', // glyphe utilisé si shape === 'glyph'
      fade: true // estompage progressif (alpha -> 0 sur la vie)
    },
    start(ctx) {
      let lastX = null;
      let lastY = null;
      const palette = (ctx.theme && ctx.theme.palette && ctx.theme.palette[0]) || null;
      const onMove = (e) => {
        const x = e.clientX;
        const y = e.clientY;
        if (lastX !== null) {
          const dx = x - lastX;
          const dy = y - lastY;
          if (Math.sqrt(dx * dx + dy * dy) < ctx.params.spacing) return;
        }
        lastX = x;
        lastY = y;
        ctx.canvas.spawn({
          x,
          y,
          vx: 0,
          vy: 0,
          ax: 0,
          ay: 0,
          life: ctx.params.life,
          size: ctx.params.size,
          shape: ctx.params.shape,
          glyph: ctx.params.glyph,
          color: ctx.params.color || palette,
          fade: ctx.params.fade,
          tag: 'trail'
        });
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      ctx.log({ layer: 'canvas' });
      ctx.onStop(() => {
        window.removeEventListener('pointermove', onMove);
        ctx.canvas.clear('trail');
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // glitch — sauts de position/teinte sur les éléments ciblés
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'glitch',
    kind: 'continuous',
    label: 'Glitch',
    needs: ['gsap'],
    defaults: {
      selector: null, // explicite ; sinon [data-juicy-glitch] ; sinon la région title
      interval: 0.15, // secondes moyennes entre deux sauts (assez court pour
      // qu'un saut tombe dans toute fenêtre d'observation de l'ordre de la
      // seconde, sans quoi l'effet paraît éteint entre deux sauts espacés)
      jitter: 0.4, // variation aléatoire (0-1) autour de l'intervalle
      amplitude: 8, // décalage horizontal max en px
      duration: 0.12, // durée d'un saut en secondes (aller-retour ~0.24s, pour
      // qu'un saut recouvre une bonne partie de n'importe quelle fenêtre
      // d'observation courte plutôt qu'un flash trop bref pour être capté)
      hueShift: 50 // décalage de teinte max en degrés pendant le saut
    },
    start(ctx) {
      if (!ctx.gsap) return;
      const els = resolveTargets(ctx, 'glitch', '[data-juicy-region="title"]');
      ctx.log({ targets: els.length });
      if (!els.length) return;
      if (reduced(ctx)) return; // état neutre statique, pas de boucle
      let acc = 0;
      let nextAt = ctx.params.interval;
      const tick = (dt) => {
        acc += dt;
        if (acc < nextAt) return;
        acc = 0;
        nextAt = ctx.params.interval * (1 + (Math.random() * 2 - 1) * ctx.params.jitter);
        els.forEach((el) => {
          const dx = (Math.random() * 2 - 1) * ctx.params.amplitude;
          const hue = (Math.random() * 2 - 1) * ctx.params.hueShift;
          ctx.gsap
            .timeline()
            .to(el, { x: dx, filter: 'hue-rotate(' + hue + 'deg)', duration: ctx.params.duration })
            .to(el, { x: 0, filter: 'none', duration: ctx.params.duration });
        });
      };
      ctx.ticker.add(tick);
      ctx.onStop(() => {
        ctx.ticker.remove(tick);
        els.forEach((el) => {
          ctx.gsap.killTweensOf(el);
          el.style.transform = '';
          el.style.filter = '';
        });
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // tilt — bascule 3D de la scène, suit le pointeur sur toute la fenêtre
  // (jamais html/body, voir contrat §11 — même piège que drunk ci-dessous)
  // ---------------------------------------------------------------------
  // Cible par défaut : le contenu du thème, exactement comme drunk (voir son
  // commentaire) — #juicy-theme-layer si non vide, sinon la région stage.
  // C'est la seule cible par défaut dont on sait, par construction du noyau
  // (contrat §4 : couche plein écran, position fixe, sans marge/bordure),
  // que la transformer ne casse pas le positionnement de ses descendants
  // position:fixed (mêmes dimensions que le viewport). Un `selector` ou un
  // marqueur [data-juicy-tilt] explicite reste prioritaire, mais un candidat
  // qui serait lui-même position:fixed sans être cette couche connue (donc
  // sans la garantie ci-dessus) est écarté pour ne jamais poser de transform
  // sur un ancêtre inattendu d'un élément position:fixed.
  function resolveTiltTargets(ctx) {
    function safe(el) {
      return el === ctx.layer('theme') || getComputedStyle(el).position !== 'fixed';
    }
    if (ctx.params.selector) {
      return Array.from(document.querySelectorAll(ctx.params.selector)).filter(safe);
    }
    const marked = document.querySelectorAll('[data-juicy-tilt]');
    if (marked.length) return Array.from(marked).filter(safe);
    const layer = ctx.layer('theme');
    if (layer && layer.childElementCount) return [layer];
    const stage = document.querySelector('[data-juicy-region="stage"]');
    return stage ? [stage] : [];
  }

  Juicy.defineEffect({
    id: 'tilt',
    kind: 'continuous',
    label: 'Tilt 3D',
    needs: ['gsap'],
    defaults: {
      selector: null, // explicite ; sinon [data-juicy-tilt] ; sinon le contenu du thème (voir resolveTiltTargets)
      max: 6, // angle max en degrés, atteint sur un bord de la fenêtre (mandat lib.fix4 : contenu jamais hors fenêtre)
      scale: 0.94, // retrait pendant l'inclinaison, même but que max réduit ; mesuré
      // (getBoundingClientRect des 4 coins, #juicy-theme-layer, 1440×900) :
      // 0.96 laissait ~4px hors fenêtre à angle max, 0.94 garde ~6px de marge
      // (mandat lib.fix4)
      perspective: 1200, // gsap transformPerspective en px, posé sur la cible elle-même
      duration: 0.3, // durée de la transition en secondes (suivi et retour à plat)
      ease: 'power2.out' // easing GSAP
    },
    start(ctx) {
      if (!ctx.gsap) return;
      const els = resolveTiltTargets(ctx);
      ctx.log({ targets: els.length });
      if (!els.length) return;
      ctx.gsap.set(els, { transformPerspective: ctx.params.perspective, rotateX: 0, rotateY: 0, scale: 1 });
      const move = (e) => {
        if (reduced(ctx)) return; // mouvement réduit : la cible reste à plat
        const px = e.clientX / window.innerWidth - 0.5;
        const py = e.clientY / window.innerHeight - 0.5;
        ctx.gsap.to(els, {
          rotateY: px * ctx.params.max,
          rotateX: -py * ctx.params.max,
          scale: ctx.params.scale,
          duration: ctx.params.duration,
          ease: ctx.params.ease,
          overwrite: 'auto'
        });
      };
      const leave = () => {
        ctx.gsap.to(els, {
          rotateX: 0,
          rotateY: 0,
          scale: 1,
          duration: ctx.params.duration,
          ease: ctx.params.ease,
          overwrite: 'auto'
        });
      };
      window.addEventListener('pointermove', move);
      document.documentElement.addEventListener('pointerleave', leave);
      ctx.onStop(() => {
        window.removeEventListener('pointermove', move);
        document.documentElement.removeEventListener('pointerleave', leave);
        // ne tue que rotateX/rotateY/scale : drunk (rotation/skewX) peut
        // tourner sur le même élément, on ne touche jamais à
        // el.style.transform en bloc (contrat de ce mandat).
        ctx.gsap.killTweensOf(els, 'rotateX,rotateY,scale');
        ctx.gsap.set(els, { rotateX: 0, rotateY: 0, scale: 1 });
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // sound — interrupteur global ; ne produit aucun son lui-même
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'sound',
    kind: 'continuous',
    label: 'Sons',
    needs: [],
    defaults: {
      confirm: 'toggleOn' // nom (vocabulaire fermé §9) du son thème joué à l'activation
    },
    start(ctx) {
      // ctx.sound() est fourni par le noyau/thème et gère lui-même le cas
      // coupé (no-op) : cet effet ne fait que confirmer l'activation.
      ctx.sound(ctx.params.confirm);
    },
    stop() {
      // rien à nettoyer : couper le son est une lecture d'état
      // (Juicy.isOn('sound')) faite par ctx.sound() ailleurs, pas une action.
    }
  });

  // ---------------------------------------------------------------------
  // magnet — éléments attirés par le pointeur
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'magnet',
    kind: 'continuous',
    label: 'Aimantation',
    needs: ['gsap'],
    defaults: {
      selector: null, // explicite ; sinon [data-juicy-magnet] ; sinon les actions
      radius: 90, // rayon d'influence en px
      strength: 0.4, // fraction du déplacement appliquée (0-1)
      duration: 0.25, // durée de suivi/retour en secondes
      ease: 'power2.out' // easing GSAP
    },
    start(ctx) {
      if (!ctx.gsap) return;
      const els = Array.from(resolveTargets(ctx, 'magnet', '.juicy-action'));
      ctx.log({ targets: els.length });
      if (!els.length) return;
      const move = (e) => {
        if (reduced(ctx)) return;
        els.forEach((el) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < ctx.params.radius) {
            ctx.gsap.to(el, {
              x: dx * ctx.params.strength,
              y: dy * ctx.params.strength,
              duration: ctx.params.duration,
              ease: ctx.params.ease
            });
          } else {
            ctx.gsap.to(el, { x: 0, y: 0, duration: ctx.params.duration, ease: ctx.params.ease });
          }
        });
      };
      window.addEventListener('pointermove', move, { passive: true });
      ctx.onStop(() => {
        window.removeEventListener('pointermove', move);
        els.forEach((el) => {
          ctx.gsap.killTweensOf(el);
          el.style.transform = '';
        });
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // cursor — curseur personnalisé qui suit le pointeur
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'cursor',
    kind: 'continuous',
    label: 'Curseur personnalisé',
    needs: ['gsap'],
    defaults: {
      glyph: '', // contenu texte/emoji du curseur ; vide = pastille pleine (voir CSS)
      size: 30, // taille en px de la pastille — à 18px la pastille se fond
      // trop souvent dans un thème dont la palette d'accent est la même
      // teinte (ex. neon, tout en cyan) : trop peu de pixels de contraste
      // pour rester perceptible sur un instantané (voir aussi l'anneau
      // blanc ajouté en CSS, qui garantit un contraste local quelle que
      // soit la couleur derrière)
      color: null, // couleur css ; null = couleur de palette du thème
      smoothing: 0.25 // durée du lissage GSAP en secondes (plus petit = plus réactif)
    },
    start(ctx) {
      const el = ctx.layer('cursor');
      ctx.log({ layer: 'cursor', targets: el ? 1 : 0 });
      if (!el) return;
      el.textContent = ctx.params.glyph || '';
      el.style.width = el.style.height = ctx.params.size + 'px';
      const palette = (ctx.theme && ctx.theme.palette && ctx.theme.palette[0]) || null;
      if (ctx.params.color || palette) el.style.background = ctx.params.color || palette;
      const half = ctx.params.size / 2;
      let moveX = null;
      let moveY = null;
      if (ctx.gsap && !reduced(ctx)) {
        moveX = ctx.gsap.quickTo(el, 'x', { duration: ctx.params.smoothing, ease: 'power3' });
        moveY = ctx.gsap.quickTo(el, 'y', { duration: ctx.params.smoothing, ease: 'power3' });
      }
      const onMove = (e) => {
        const x = e.clientX - half;
        const y = e.clientY - half;
        if (moveX) {
          moveX(x);
          moveY(y);
        } else {
          el.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
        }
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      ctx.onStop(() => {
        window.removeEventListener('pointermove', onMove);
        if (ctx.gsap) ctx.gsap.killTweensOf(el);
        el.style.transform = '';
        el.style.background = '';
        el.textContent = '';
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // rain — pluie générique de glyphes, avec presets snow / code / sparks
  // ---------------------------------------------------------------------
  var RAIN_DEFAULTS = {
    preset: null, // 'snow' | 'code' | 'sparks' | null ; fournit un jeu de valeurs par défaut
    glyphs: ['░', '▪', '·'], // glyphes utilisés (shape 'glyph')
    density: 30, // particules vivantes ciblées
    speed: 1, // multiplicateur de vitesse de chute/déplacement
    direction: 'down', // 'down' | 'up' | 'left' | 'right'
    drift: 0, // amplitude de dérive latérale en px/s
    size: 16, // taille de la police/particule en px
    rotation: 0, // vitesse de rotation en rad/s
    color: null // couleur css ; null = couleur de palette du thème
  };
  var RAIN_PRESETS = {
    snow: { glyphs: ['❄', '❅', '❆'], density: 25, speed: 0.6, size: 14, drift: 0.5, rotation: 0.3, color: '#ffffff' },
    code: {
      glyphs: ['0', '1', 'ｱ', 'ｳ', 'ｴ', 'ｶ', 'ｷ', 'ﾑ', 'ﾒ', 'ﾘ'],
      density: 45,
      speed: 1.5,
      size: 16,
      drift: 0,
      rotation: 0,
      color: '#39ff6a'
    },
    sparks: { glyphs: ['✦', '✧', '·', '∙'], density: 35, speed: 2.2, size: 9, drift: 1.3, rotation: 4, color: '#ffcf5c' }
  };
  function sameAsDefault(key, value) {
    var base = RAIN_DEFAULTS[key];
    if (Array.isArray(base) || Array.isArray(value)) {
      return JSON.stringify(base) === JSON.stringify(value);
    }
    return base === value;
  }
  // Fusion : def.defaults <- preset nommé (uniquement pour les clés restées
  // au défaut) <- paramètres explicites de l'appel, déjà fusionnés par le
  // noyau dans ctx.params (voir contrat §7).
  function resolveRainParams(params) {
    var preset = params.preset && RAIN_PRESETS[params.preset];
    if (!preset) return params;
    var out = Object.assign({}, params);
    Object.keys(preset).forEach(function (k) {
      if (sameAsDefault(k, params[k])) out[k] = preset[k];
    });
    return out;
  }
  Juicy.defineEffect({
    id: 'rain',
    kind: 'continuous',
    label: 'Pluie',
    needs: [],
    defaults: RAIN_DEFAULTS,
    start(ctx) {
      var p = resolveRainParams(ctx.params);
      ctx.log({ layer: 'canvas' });
      if (reduced(ctx)) return; // pluie continue = animation, neutralisée
      var dirVec = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[p.direction] || [0, 1];
      var horizontal = dirVec[1] === 0;
      var palette = (ctx.theme && ctx.theme.palette && ctx.theme.palette[0]) || null;
      var acc = 0;
      var spawnOne = function () {
        var w = window.innerWidth;
        var h = window.innerHeight;
        var x = horizontal ? (dirVec[0] > 0 ? -20 : w + 20) : Math.random() * w;
        var y = horizontal ? Math.random() * h : dirVec[1] > 0 ? -20 : h + 20;
        ctx.canvas.spawn({
          x: x,
          y: y,
          vx: dirVec[0] * p.speed * 80 + (Math.random() * 2 - 1) * p.drift,
          vy: dirVec[1] * p.speed * 80,
          life: 6 / p.speed,
          size: p.size,
          shape: 'glyph',
          glyph: p.glyphs[Math.floor(Math.random() * p.glyphs.length)],
          color: p.color || palette,
          rotation: Math.random() * Math.PI * 2,
          spin: p.rotation,
          tag: 'rain'
        });
      };
      var tick = function (dt) {
        acc += dt * p.density; // taux de spawn proportionnel à la densité demandée
        while (acc > 1) {
          spawnOne();
          acc -= 1;
        }
      };
      ctx.ticker.add(tick);
      ctx.onStop(() => {
        ctx.ticker.remove(tick);
        ctx.canvas.clear('rain');
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // shaketext — tremblement de texte
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'shaketext',
    kind: 'continuous',
    label: 'Texte qui tremble',
    needs: ['gsap'],
    defaults: {
      selector: null, // explicite ; sinon [data-juicy-shaketext] ; sinon titre/accroche/libellés
      amplitude: 3, // amplitude du tremblement en px
      frequency: 12, // sauts aléatoires par seconde
      rotation: 1.5 // rotation max en degrés à chaque saut
    },
    start(ctx) {
      if (!ctx.gsap) return;
      const els = resolveTargets(
        ctx,
        'shaketext',
        '[data-juicy-region="title"], [data-juicy-region="tagline"], .juicy-toggle-label, .juicy-action-label'
      );
      ctx.log({ targets: els.length });
      if (!els.length) return;
      if (reduced(ctx)) return;
      const interval = 1 / ctx.params.frequency;
      let acc = 0;
      const tick = (dt) => {
        acc += dt;
        if (acc < interval) return;
        acc = 0;
        els.forEach((el) => {
          ctx.gsap.to(el, {
            x: (Math.random() * 2 - 1) * ctx.params.amplitude,
            y: (Math.random() * 2 - 1) * ctx.params.amplitude,
            rotation: (Math.random() * 2 - 1) * ctx.params.rotation,
            duration: interval,
            ease: 'sine.inOut'
          });
        });
      };
      ctx.ticker.add(tick);
      ctx.onStop(() => {
        ctx.ticker.remove(tick);
        els.forEach((el) => {
          ctx.gsap.killTweensOf(el);
          el.style.transform = '';
        });
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // crt — scanlines, vignette, souffle ; souffle audio discret via Tone.js
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'crt',
    kind: 'continuous',
    label: 'Bruit CRT',
    needs: [],
    defaults: {
      scanlineOpacity: 0.12, // opacité des lignes de balayage (0-1)
      vignette: 0.35, // intensité du vignettage (0-1)
      flicker: 0.35, // amplitude du scintillement (0-1) — à 0.04 la respiration
      // ne déplaçait qu'environ 1 niveau RGB sur l'écran en 300 ms : invisible
      // à l'œil comme à la mesure. 0.35 garde un effet discret mais réel.
      breathSpeed: 1.6, // durée d'un cycle de respiration en secondes — à 4s
      // avec un easing ease-in-out (courbe d'origine), toute fenêtre courte
      // qui tombe près d'un sommet ou d'un creux du cycle voit une opacité
      // presque plate : diagnostiqué sur le thème neon, où une fenêtre de
      // 300 ms tombait systématiquement dans cette zone plate et rendait le
      // souffle quasi invisible malgré une amplitude réelle. Cycle plus
      // court (voir aussi l'easing linéaire dans effects.css) : une vraie
      // pente sur toute fenêtre d'observation, quel que soit le thème.
      hum: true // active un souffle audio discret via Tone.js si présent et si le son est activé
    },
    start(ctx) {
      const overlay = ctx.layer('overlay');
      ctx.log({ layer: 'overlay', targets: overlay ? 1 : 0 });
      if (!overlay) return;
      overlay.style.setProperty('--juicy-crt-scanline', String(ctx.params.scanlineOpacity));
      overlay.style.setProperty('--juicy-crt-vignette', String(ctx.params.vignette));
      overlay.style.setProperty('--juicy-crt-flicker', String(reduced(ctx) ? 0 : ctx.params.flicker));
      overlay.style.setProperty('--juicy-crt-breath', ctx.params.breathSpeed + 's');

      let noise = null;
      let gain = null;
      const soundOn = !!(ctx.state && ctx.state.on && ctx.state.on.sound);
      if (ctx.params.hum && ctx.Tone && soundOn) {
        try {
          gain = new ctx.Tone.Gain(0.02).toDestination();
          noise = new ctx.Tone.Noise('brown').connect(gain);
          // Le contexte audio est déverrouillé par le noyau au premier geste
          // utilisateur ; cet effet ne l'appelle jamais lui-même (contrat §2).
          noise.start();
        } catch (e) {
          noise = null;
        }
      }
      ctx.onStop(() => {
        ['--juicy-crt-scanline', '--juicy-crt-vignette', '--juicy-crt-flicker', '--juicy-crt-breath'].forEach((v) =>
          overlay.style.removeProperty(v)
        );
        if (noise) {
          try {
            noise.stop();
            noise.dispose();
          } catch (e) {}
        }
        if (gain) {
          try {
            gain.dispose();
          } catch (e) {}
        }
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // drunk — tangage de la scène (jamais html/body, voir contrat §11)
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'drunk',
    kind: 'continuous',
    label: 'Mode ivre',
    needs: ['gsap'],
    defaults: {
      selector: null, // explicite ; sinon le contenu de la couche thème ; sinon stage si elle est vide
      angle: 2.5, // amplitude de rotation en degrés
      skew: 1, // amplitude de skew en degrés
      duration: 2.2 // durée d'un demi-cycle en secondes
    },
    start(ctx) {
      if (!ctx.gsap) return;
      // La couche thème (#juicy-theme-layer) est déjà plein écran, position
      // fixe, sans marge/bordure : la transformer ne déplace pas son bloc
      // englobant pour ses propres descendants position:fixed (mêmes
      // dimensions que le viewport, contrat §11) — c'est elle qui porte
      // aujourd'hui tout le chrome d'un thème actif (§3), `stage` étant
      // vidée par `api.mount`.
      let el = ctx.params.selector ? document.querySelector(ctx.params.selector) : null;
      if (!el) {
        const themeLayer = ctx.layer('theme');
        el = themeLayer && themeLayer.childElementCount ? themeLayer : document.querySelector('[data-juicy-region="stage"]');
      }
      ctx.log({ targets: el ? 1 : 0 });
      if (!el || reduced(ctx)) return;
      const tween = ctx.gsap.to(el, {
        rotation: ctx.params.angle,
        skewX: ctx.params.skew,
        duration: ctx.params.duration,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      });
      ctx.onStop(() => {
        tween.kill();
        ctx.gsap.set(el, { rotation: 0, skewX: 0 });
      });
    },
    stop() {}
  });

  // ---------------------------------------------------------------------
  // music — ne joue rien elle-même, délègue à theme.music(on, api)
  // ---------------------------------------------------------------------
  Juicy.defineEffect({
    id: 'music',
    kind: 'continuous',
    label: 'Musique',
    needs: [],
    defaults: {
      volume: -8 // volume de référence en dB, transmis au thème (celui-ci gère son propre mix)
    },
    start(ctx) {
      if (ctx.theme && typeof ctx.theme.music === 'function') {
        try {
          ctx.theme.music(true, ctx);
        } catch (e) {
          // un hook de thème qui jette ne casse jamais la page (contrat §9)
        }
      }
    },
    stop(ctx) {
      if (ctx.theme && typeof ctx.theme.music === 'function') {
        try {
          ctx.theme.music(false, ctx);
        } catch (e) {}
      }
    }
  });
})();
