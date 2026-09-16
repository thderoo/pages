/* ==========================================================================
   theme-candy.js — Confiserie / niveau des glaces
   Enregistre le thème 'candy' auprès de window.JUICY (défini par core.js,
   chargé avant ce script). N'invente aucun id, classe ou hook hors du
   contrat .swarm/pages/contrat-juicy.md.
   ========================================================================== */

(function () {
  'use strict';

  var PALETTE = ['#ffb6c8', '#ffe066', '#b8f2e6', '#d9b8ff', '#ff5d8f', '#fff6ea'];

  var state = {
    themeLayer: null,
    themeStage: null,
    sundaeEl: null,
    timelines: [],
    bits: [],
    synths: null,
    musicPart: null,
    musicLoop: null,
  };

  /* -- utilitaires ---------------------------------------------------------*/

  function trackTimeline(tl) {
    state.timelines.push(tl);
    tl.eventCallback('onComplete', function () {
      var i = state.timelines.indexOf(tl);
      if (i > -1) state.timelines.splice(i, 1);
    });
    return tl;
  }

  function killTimelines() {
    state.timelines.forEach(function (tl) {
      try { tl.kill(); } catch (e) { /* noop */ }
    });
    state.timelines = [];
  }

  function clearBits() {
    state.bits.forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    state.bits = [];
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* -- décor : #theme-layer --------------------------------------------------*/

  function buildLayerDecor(api) {
    var layer = api.themeLayer;
    var reduce = api.state.reduceMotion;

    ['candy-decor-cone--left', 'candy-decor-cone--right'].forEach(function (side, i) {
      var cone = document.createElement('div');
      cone.className = 'candy-decor-cone ' + side + (reduce ? '' : ' candy-decor-bob');
      cone.style.setProperty('--candy-r', (i === 0 ? -9 : 9) + 'deg');
      cone.setAttribute('aria-hidden', 'true');
      layer.appendChild(cone);
      state.bits.push(cone);
    });

    var dripColors = [PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[4]];
    var dripCount = 7;
    for (var d = 0; d < dripCount; d++) {
      var drip = document.createElement('div');
      drip.className = 'candy-decor-drip';
      drip.style.left = (6 + (88 / (dripCount - 1)) * d) + '%';
      drip.style.height = rand(28, 50) + 'px';
      drip.style.background = 'linear-gradient(180deg, ' + pick(dripColors) + ', transparent)';
      drip.setAttribute('aria-hidden', 'true');
      layer.appendChild(drip);
      state.bits.push(drip);
    }

    var sprinkleColors = PALETTE;
    var sprinkleCount = 16;
    for (var s = 0; s < sprinkleCount; s++) {
      var sp = document.createElement('div');
      sp.className = 'candy-decor-sprinkle' + (reduce ? '' : ' candy-decor-bob');
      sp.style.left = rand(2, 96) + '%';
      sp.style.bottom = rand(0, 26) + 'px';
      sp.style.background = pick(sprinkleColors);
      sp.style.setProperty('--candy-r', rand(-40, 40) + 'deg');
      sp.style.transform = 'rotate(' + rand(-40, 40) + 'deg)';
      sp.style.animationDelay = rand(0, 4) + 's';
      sp.setAttribute('aria-hidden', 'true');
      layer.appendChild(sp);
      state.bits.push(sp);
    }
  }

  function buildStageDecor(api) {
    var stage = api.themeStage;
    var sundae = document.createElement('div');
    sundae.className = 'candy-sundae';
    sundae.setAttribute('aria-hidden', 'true');
    sundae.innerHTML =
      '<div class="candy-scoop candy-scoop--mint"></div>' +
      '<div class="candy-scoop candy-scoop--pink"></div>' +
      '<div class="candy-scoop candy-scoop--lemon"></div>' +
      '<div class="candy-sundae-cream"></div>' +
      '<div class="candy-sundae-cherry"></div>';
    stage.appendChild(sundae);
    state.bits.push(sundae);
    state.sundaeEl = sundae;
  }

  /* -- réactions du dessert central ------------------------------------------*/

  function bump(api, opts) {
    if (!state.sundaeEl || api.state.reduceMotion) return;
    opts = opts || {};
    var tl = api.gsap.timeline();
    trackTimeline(tl);
    tl.to(state.sundaeEl, {
      scale: opts.scale || 1.12,
      rotate: opts.rotate || 0,
      duration: 0.12,
      ease: 'power2.out',
    }).to(state.sundaeEl, {
      scale: 1,
      rotate: 0,
      duration: opts.settle || 0.55,
      ease: 'elastic.out(1, 0.45)',
    });
  }

  function wiggle(api) {
    if (!state.sundaeEl || api.state.reduceMotion) return;
    var tl = api.gsap.timeline();
    trackTimeline(tl);
    tl.to(state.sundaeEl, { rotate: -6, duration: 0.08, ease: 'power1.inOut' })
      .to(state.sundaeEl, { rotate: 6, duration: 0.1, ease: 'power1.inOut' })
      .to(state.sundaeEl, { rotate: -3, duration: 0.1, ease: 'power1.inOut' })
      .to(state.sundaeEl, { rotate: 0, duration: 0.25, ease: 'elastic.out(1, 0.5)' });
  }

  function spawnBit(api, emoji, opts) {
    if (api.state.reduceMotion || !state.sundaeEl) return;
    opts = opts || {};
    var el = document.createElement('span');
    el.className = 'candy-bit';
    el.textContent = emoji;
    el.setAttribute('aria-hidden', 'true');
    el.style.left = (48 + rand(-16, 16)) + '%';
    el.style.top = '10%';
    api.themeStage.appendChild(el);
    state.bits.push(el);

    var tl = api.gsap.timeline({
      onComplete: function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        var i = state.bits.indexOf(el);
        if (i > -1) state.bits.splice(i, 1);
      },
    });
    trackTimeline(tl);
    tl.fromTo(
      el,
      { y: 0, opacity: 0, scale: 0.6 },
      { y: -1, opacity: 1, scale: 1, duration: 0.15 }
    ).to(el, {
      y: opts.rise || -60,
      x: rand(-24, 24),
      rotate: rand(-40, 40),
      opacity: 0,
      duration: 0.7,
      ease: 'power1.out',
    });
  }

  /* -- son : Tone.js -----------------------------------------------------------*/

  function ensureSynths(Tone) {
    if (state.synths) return state.synths;
    try {
      state.synths = {
        pop: new Tone.MembraneSynth({
          pitchDecay: 0.02,
          octaves: 3,
          envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 },
        }).toDestination(),
        pluck: new Tone.PluckSynth({ attackNoise: 0.6, dampening: 3200, resonance: 0.85 }).toDestination(),
        splotch: new Tone.NoiseSynth({
          noise: { type: 'pink' },
          envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
        }).toDestination(),
        bell: new Tone.MetalSynth({
          envelope: { attack: 0.001, decay: 0.35, release: 0.2 },
          harmonicity: 4.5,
          modulationIndex: 12,
          resonance: 1800,
          octaves: 1,
        }).toDestination(),
      };
      state.synths.pop.volume.value = -8;
      state.synths.pluck.volume.value = -12;
      state.synths.splotch.volume.value = -18;
      state.synths.bell.volume.value = -20;
    } catch (e) {
      state.synths = null;
    }
    return state.synths;
  }

  function safe(fn) {
    try { fn(); } catch (e) { /* jamais d'erreur console */ }
  }

  function sound(name, api) {
    var Tone = api.Tone;
    var synths = ensureSynths(Tone);
    if (!synths) return;
    var now = Tone.now();

    switch (name) {
      case 'toggleOn':
        safe(function () { synths.pop.triggerAttackRelease('C4', '32n', now); });
        break;
      case 'toggleOff':
        safe(function () { synths.pop.triggerAttackRelease('G3', '32n', now); });
        break;
      case 'hover':
        safe(function () { synths.pluck.triggerAttack('C6', now, 0.2); });
        break;
      case 'confetti':
        safe(function () {
          synths.bell.triggerAttackRelease('C6', '16n', now, 0.5);
          synths.bell.triggerAttackRelease('E6', '16n', now + 0.06, 0.4);
        });
        break;
      case 'shake':
        safe(function () { synths.splotch.triggerAttackRelease('16n', now); });
        break;
      case 'emoji':
        safe(function () { synths.pop.triggerAttackRelease('E4', '32n', now); });
        break;
      case 'firework':
        safe(function () {
          synths.pop.triggerAttackRelease('C4', '32n', now);
          synths.bell.triggerAttackRelease('G6', '8n', now + 0.05, 0.6);
        });
        break;
      case 'shockwave':
        safe(function () { synths.splotch.triggerAttackRelease('8n', now, 0.8); });
        break;
      case 'counter':
        safe(function () { synths.pluck.triggerAttack('A5', now, 0.3); });
        break;
      case 'combo':
        safe(function () {
          synths.bell.triggerAttackRelease('A6', '16n', now, 0.5);
        });
        break;
      case 'everything':
        safe(function () {
          ['C5', 'E5', 'G5', 'C6'].forEach(function (note, i) {
            synths.pluck.triggerAttack(note, now + i * 0.05, 0.4);
          });
          synths.bell.triggerAttackRelease('C6', '8n', now + 0.22, 0.5);
        });
        break;
      case 'reset':
        safe(function () {
          synths.pluck.triggerAttack('G4', now, 0.3);
          synths.pluck.triggerAttack('C4', now + 0.08, 0.25);
        });
        break;
      case 'theme':
        safe(function () { synths.bell.triggerAttackRelease('E6', '8n', now, 0.4); });
        break;
      case 'achievement':
        safe(function () {
          synths.bell.triggerAttackRelease('C6', '16n', now, 0.5);
          synths.bell.triggerAttackRelease('G6', '8n', now + 0.1, 0.6);
        });
        break;
      default:
        break;
    }
  }

  function music(on, api) {
    var Tone = api.Tone;
    if (on) {
      if (state.musicLoop) return;
      try {
        var synths = ensureSynths(Tone);
        if (!synths) return;
        var notes = ['C5', 'D5', 'E5', 'G5', 'E5', 'D5'];
        var idx = 0;
        state.musicLoop = new Tone.Loop(function (time) {
          safe(function () {
            synths.pluck.triggerAttack(notes[idx % notes.length], time, 0.18);
          });
          idx++;
        }, '4n');
        Tone.Transport.bpm.value = 108;
        state.musicLoop.start(0);
        Tone.Transport.start();
      } catch (e) {
        state.musicLoop = null;
      }
    } else {
      if (state.musicLoop) {
        safe(function () {
          state.musicLoop.stop(0);
          state.musicLoop.dispose();
        });
        state.musicLoop = null;
      }
    }
  }

  /* -- cycle de vie du thème ---------------------------------------------------*/

  function onActivate(api) {
    state.themeLayer = api.themeLayer;
    state.themeStage = api.themeStage;
    buildLayerDecor(api);
    buildStageDecor(api);
  }

  function onDeactivate(api) {
    killTimelines();
    if (state.musicLoop) {
      safe(function () {
        state.musicLoop.stop(0);
        state.musicLoop.dispose();
      });
      state.musicLoop = null;
    }
    clearBits();
    state.sundaeEl = null;
    state.themeLayer = null;
    state.themeStage = null;
  }

  function onToggle(id, on, api) {
    bump(api, { scale: 1.05, settle: 0.4 });
  }

  function onAction(id, api) {
    switch (id) {
      case 'confetti':
        bump(api, { scale: 1.1 });
        spawnBit(api, pick(['🍬', '🍭', '🍡']));
        spawnBit(api, pick(['🍬', '🍭', '🍡']));
        break;
      case 'shake':
        wiggle(api);
        break;
      case 'emoji':
        bump(api, { scale: 1.05 });
        spawnBit(api, pick(['🍩', '🧁', '🍪', '🍫']));
        break;
      case 'firework':
        bump(api, { scale: 1.2 });
        spawnBit(api, '✨', { rise: -80 });
        break;
      case 'shockwave':
        if (state.sundaeEl && !api.state.reduceMotion) {
          var tl = api.gsap.timeline();
          trackTimeline(tl);
          tl.to(state.sundaeEl, { scaleX: 1.25, scaleY: 0.85, duration: 0.12, ease: 'power2.out' })
            .to(state.sundaeEl, { scaleX: 1, scaleY: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
        }
        break;
      case 'counter':
        bump(api, { scale: 1.07, settle: 0.3 });
        break;
      case 'everything':
        bump(api, { scale: 1.28, settle: 0.7 });
        spawnBit(api, pick(['🍬', '🍭', '🍩', '🧁', '✨']));
        break;
      case 'reset':
        if (state.sundaeEl) {
          killTimelines();
          if (!api.state.reduceMotion) {
            api.gsap.to(state.sundaeEl, { scale: 1, rotate: 0, scaleX: 1, scaleY: 1, duration: 0.4, ease: 'power2.out' });
          } else {
            api.gsap.set(state.sundaeEl, { scale: 1, rotate: 0, scaleX: 1, scaleY: 1 });
          }
        }
        break;
      default:
        bump(api);
        break;
    }
  }

  /* -- enregistrement -----------------------------------------------------------*/

  if (window.JUICY && typeof window.JUICY.registerTheme === 'function') {
    window.JUICY.registerTheme({
      id: 'candy',
      name: 'Confiserie',
      title: 'AU STAND À BONBONS',
      tagline: 'Choisis tes gourmandises et laisse-toi tenter.',
      togglesTitle: 'Le comptoir des saveurs',
      actionsTitle: 'Les spécialités maison',

      labels: {
        bg: 'Vitrine animée',
        trail: 'Traînée sucrée',
        light: 'Vitrine ensoleillée',
        glitch: 'Titre qui frissonne',
        tilt: 'Étals qui penchent',
        sound: 'Sons gourmands',
        magnet: 'Aimant à friandises',
        cursor: 'Curseur cuillère',
        rain: 'Pluie de bonbons',
        shaketext: 'Texte qui tremblote',
        crt: 'Grésillement sucré',
        timewarp: 'Sirop qui ralentit',
        antigravity: 'Bulles qui s’envolent',
        negative: 'Bonbon inversé',
        fog: 'Brume de sucre glace',
        snow: 'Neige en vermicelles',
        bigtext: 'Lettres XXL',
        drunk: 'Tangage de gelée',
        music: 'Musique guillerette',
        confetti: 'Pluie de vermicelles',
        shake: 'Secoue le stand',
        emoji: 'Pluie de bonbons emoji',
        firework: 'Feu d’artifice sucré',
        shockwave: 'Onde de chantilly',
        counter: 'Compteur gourmand',
        everything: 'Le grand buffet',
        reset: 'Nouvelle fournée',
      },

      comments: {
        theme: 'Bienvenue au pays des douceurs, sers-toi et régale-toi !',
        bg: 'La vitrine s’anime de bulles sucrées.',
        trail: 'Une traînée de sucre glace suit chacun de tes gestes.',
        light: 'Le soleil illumine la vitrine.',
        glitch: 'Le titre frissonne comme une gelée trop fraîche.',
        tilt: 'Les étals penchent doucement, gourmands.',
        sound: 'Les gourmandises se mettent à crépiter.',
        magnet: 'Les friandises se collent à ton doigt.',
        cursor: 'Une petite cuillère te suit partout.',
        rain: 'Il pleut des bonbons !',
        shaketext: 'Les mots tremblotent comme de la gelée.',
        crt: 'Un léger grésillement sucré crépite en fond.',
        timewarp: 'Le sirop coule au ralenti.',
        antigravity: 'Les bulles s’envolent vers le plafond.',
        negative: 'Le bonbon se retourne sur lui-même.',
        fog: 'Une brume de sucre glace flotte dans l’air.',
        snow: 'Il neige des vermicelles.',
        bigtext: 'Les lettres gonflent comme une guimauve.',
        drunk: 'Le stand tangue, un peu trop de barbe à papa.',
        music: 'Une petite mélodie guillerette se met en boucle.',
        confetti: 'Une pluie de vermicelles arrose la scène !',
        shake: 'Le stand tremble de gourmandise.',
        emoji: 'Des bonbons volent de partout !',
        firework: 'Un feu d’artifice tout sucré illumine la nuit.',
        shockwave: 'Une onde de chantilly se propage.',
        counter: 'Encore une gourmandise au compteur !',
        everything: 'Le buffet est ouvert, tout y passe !',
        reset: 'Une nouvelle fournée toute fraîche arrive.',
      },

      emojis: ['🍬', '🍭', '🍩', '🧁', '🍪', '🍫', '🍡', '🍒'],
      rainGlyphs: ['🍬', '🍭', '●'],
      snowGlyphs: ['❋', '✻', '•'],
      palette: PALETTE,
      confettiOptions: {
        colors: PALETTE,
        shapes: ['circle', 'square'],
        scalar: 1.05,
        gravity: 0.85,
        ticks: 220,
      },
      particlesPreset: {
        particles: {
          color: { value: PALETTE },
          shape: { type: 'circle' },
          opacity: { value: 0.6 },
          size: { value: { min: 2, max: 5 } },
          move: { speed: 0.6 },
        },
      },
      cursor: '🥄',

      onActivate: onActivate,
      onDeactivate: onDeactivate,
      onToggle: onToggle,
      onAction: onAction,
      sound: sound,
      music: music,
    });
  }
})();
