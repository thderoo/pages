/*
 * Theme "candy" — étal de desserts façon niveau des glaces, présentoir à
 * étages, page qui défile verticalement. Module de la lib Juicy, voir
 * projects/pages/CLAUDE.md et le contrat .swarm/pages/contrat-lib.md.
 *
 * Ce fichier suppose que window.Juicy existe déjà (chargé après juicy.js).
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.Juicy || typeof window.Juicy.registerTheme !== 'function') {
    return;
  }

  // Ordre d'empilement des étages du présentoir : quels régions vont sur
  // quel étage, et quelle classe de modificateur porte l'étage.
  var TIERS = [
    { names: ['title', 'tagline'], cls: 'candy-tier--sign' },
    { names: ['nav'], cls: 'candy-tier--nav' },
    { names: ['controls'], cls: 'candy-tier--controls' },
    { names: ['actions'], cls: 'candy-tier--actions' },
    { names: ['scene'], cls: 'candy-tier--scene' },
    { names: ['narration'], cls: 'candy-tier--narration' },
    { names: ['meta'], cls: 'candy-tier--meta' }
  ];

  // État privé de l'instance de thème courante : tout ce que layout() crée,
  // teardown() doit le détruire intégralement (règle §11 : rien ne survit).
  var state = {
    root: null,       // le conteneur .candy-counter, unique enfant ajouté au themeLayer
    widgets: [],       // instances de briques à détruire (prop, typewriter…)
    tweens: [],        // tweens gsap éventuels à tuer
    timers: [],        // setTimeout/setInterval à annuler
    musicPart: null,   // référence Tone à stopper/disposer
    propEl: null,       // élément DOM de la brique prop (le sundae)
    metaEl: null         // élément DOM de la région meta (compteur/combo)
  };

  function clearTimers() {
    state.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    state.timers.length = 0;
  }

  function clearTweens() {
    state.tweens.forEach(function (tw) {
      try { tw && tw.kill && tw.kill(); } catch (e) { /* noop */ }
    });
    state.tweens.length = 0;
  }

  function clearWidgets() {
    state.widgets.forEach(function (w) {
      try { w && typeof w.destroy === 'function' && w.destroy(); } catch (e) { /* noop */ }
    });
    state.widgets.length = 0;
  }

  function buildTier(cls) {
    var tier = document.createElement('div');
    tier.className = 'candy-tier' + (cls ? ' ' + cls : '');
    tier.setAttribute('data-juicy-owner', 'candy');

    var plate = document.createElement('div');
    plate.className = 'candy-plate';
    plate.setAttribute('data-juicy-owner', 'candy');
    tier.appendChild(plate);

    var drip = document.createElement('div');
    drip.className = 'candy-drip';
    drip.setAttribute('data-juicy-owner', 'candy');
    tier.appendChild(drip);

    return { tier: tier, plate: plate };
  }

  function layout(api) {
    // Repart d'un état propre si layout() est rappelé sans teardown
    // intermédiaire (défensif ; le noyau appelle normalement teardown avant).
    clearTimers();
    clearTweens();
    clearWidgets();

    var counter = document.createElement('div');
    counter.className = 'candy-counter';
    counter.setAttribute('data-juicy-owner', 'candy');

    TIERS.forEach(function (spec) {
      var built = buildTier(spec.cls);
      var hasRegion = false;

      spec.names.forEach(function (name) {
        var region = api.region(name);
        if (!region) return;
        api.mount(name, built.plate);
        hasRegion = true;
        if (name === 'meta') state.metaEl = region;
      });

      // On construit l'étage même si la page n'a pas déclaré la région :
      // un présentoir vide fait partie du décor, et le thème reste stable
      // quel que soit le sous-ensemble de régions fourni par la page.
      counter.appendChild(built.tier);

      if (spec.cls === 'candy-tier--scene') {
        var sundae = api.widget('prop', built.plate, {
          sprite: '🍨',
          states: { small: { text: '🍦' }, big: { text: '🍨🍒' } },
          react: function () {}
        });
        if (sundae && sundae.el) {
          sundae.el.classList.add('candy-prop');
          sundae.el.setAttribute('data-juicy-owner', 'candy');
          sundae.el.setAttribute('data-candy-state', 'small');
          state.propEl = sundae.el;
        }
        state.widgets.push(sundae);
      }

      if (!hasRegion && spec.names[0] !== 'scene') {
        built.plate.setAttribute('hidden', '');
      }
    });

    api.themeLayer.appendChild(counter);
    state.root = counter;
    updateMeta(api);
  }

  function updateMeta(api) {
    if (!state.metaEl) return;
    state.metaEl.textContent = 'Compteur : ' + api.state.counter + ' · Combo : ' + api.state.combo;
  }

  function teardown() {
    clearTimers();
    clearTweens();
    clearWidgets();
    if (state.musicPart) {
      try { state.musicPart.stop && state.musicPart.stop(0); } catch (e) { /* noop */ }
      try { state.musicPart.dispose && state.musicPart.dispose(); } catch (e) { /* noop */ }
      state.musicPart = null;
    }
    if (state.root && state.root.parentNode) {
      state.root.parentNode.removeChild(state.root);
    }
    state.root = null;
    state.propEl = null;
    state.metaEl = null;
  }

  function growSundae(big) {
    if (!state.propEl) return;
    state.propEl.setAttribute('data-candy-state', big ? 'big' : 'small');
  }

  function onEffect(id, on, api) {
    updateMeta(api);
    if (id === 'music') return; // délégué à music(on, api), voir plus bas
    if (on) growSundae(true);
    api.sound(on ? 'toggleOn' : 'toggleOff');
  }

  function onFire(id, api) {
    updateMeta(api);
    growSundae(true);
    var timer = setTimeout(function () { growSundae(false); }, 900);
    state.timers.push(timer);

    var soundByAction = {
      confetti: 'confetti',
      firework: 'firework',
      shockwave: 'shockwave',
      shake: 'shake',
      emojiRain: 'emoji',
      counter: 'counter',
      timewarp: 'combo',
      everything: 'everything',
      reset: 'reset'
    };
    api.sound(soundByAction[id] || 'select');
  }

  function narrate(text, api) {
    var region = api.region('narration');
    if (!region) return;
    clearWidgets_narrationOnly();
    var tw = api.widget('typewriter', region, {
      text: text,
      speed: 28,
      sound: 'type'
    });
    if (tw) {
      tw.__candyNarration = true;
      state.widgets.push(tw);
    }
  }

  // On ne garde qu'une seule machine à écrire vivante à la fois : les
  // anciennes instances de narration sont détruites avant d'en recréer une,
  // sans toucher aux autres briques (le sundae).
  function clearWidgets_narrationOnly() {
    state.widgets = state.widgets.filter(function (w) {
      if (w && w.__candyNarration) {
        try { w.destroy && w.destroy(); } catch (e) { /* noop */ }
        return false;
      }
      return true;
    });
  }

  function sound(name, api) {
    if (!api.Tone) return;
    var freq = {
      toggleOn: 660, toggleOff: 440, hover: 880, select: 740,
      confetti: 990, firework: 1180, shockwave: 330, shake: 220,
      emoji: 1320, counter: 990, combo: 1180, everything: 1480,
      reset: 260, theme: 590, achievement: 1046, alert: 300, type: 1760
    }[name] || 660;
    try {
      var synth = new api.Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.15 }
      }).toDestination();
      synth.volume.value = -10;
      synth.triggerAttackRelease(freq, '32n');
      var t = setTimeout(function () { try { synth.dispose(); } catch (e) { /* noop */ } }, 600);
      state.timers.push(t);
    } catch (e) { /* dégradation silencieuse */ }
  }

  function music(on, api) {
    if (!on) {
      if (state.musicPart) {
        try { state.musicPart.stop && state.musicPart.stop(0); } catch (e) { /* noop */ }
        try { state.musicPart.dispose && state.musicPart.dispose(); } catch (e) { /* noop */ }
        state.musicPart = null;
      }
      return;
    }
    if (!api.Tone || api.state.reduceMotion) return;
    try {
      var synth = new api.Tone.Synth({ oscillator: { type: 'triangle' } }).toDestination();
      synth.volume.value = -16;
      var notes = ['C5', 'E5', 'G5', 'E5'];
      var i = 0;
      var loop = new api.Tone.Loop(function (time) {
        synth.triggerAttackRelease(notes[i % notes.length], '8n', time);
        i += 1;
      }, '2n');
      loop.start(0);
      if (api.Tone.Transport && api.Tone.Transport.state !== 'started') {
        api.Tone.Transport.start();
      }
      state.musicPart = loop;
    } catch (e) { /* dégradation silencieuse */ }
  }

  window.Juicy.registerTheme({
    id: 'candy',
    name: 'Confiserie',

    texts: {
      title: 'Au comptoir des douceurs',
      tagline: 'Un présentoir de gourmandises à faire fondre',
      controlsTitle: 'Les cuillères',
      actionsTitle: 'Les macarons'
    },

    labels: {
      // 12 toggles continus
      bg: 'Sucre glace',
      trail: 'Traînée de caramel',
      glitch: 'Sucre pétillant',
      tilt: 'Bascule gourmande',
      sound: 'Cloche de service',
      magnet: 'Aimant à bonbons',
      cursor: 'Curseur cerise',
      rain: 'Pluie de vermicelles',
      shaketext: 'Lettres qui tremblent',
      crt: 'Croustillant du fond',
      drunk: 'Tangage nappé',
      music: 'Musique de la confiserie',
      // 9 actions ponctuelles
      confetti: 'Pluie de bonbons',
      firework: 'Feu d’artifice sucré',
      shockwave: 'Onde de chantilly',
      shake: 'Secousse gourmande',
      emojiRain: 'Pluie de sucreries',
      counter: 'Compteur de gourmandise',
      timewarp: 'Sirop qui ralentit',
      everything: 'Buffet complet',
      reset: 'Table débarrassée'
    },

    lines: {
      theme: 'Le comptoir se redresse dans un nuage de sucre glace.',
      bg: 'Une pluie de sucre glace saupoudre la vitrine.',
      trail: 'Un filet de caramel suit chaque geste.',
      glitch: 'Le glaçage pétille et crépite.',
      tilt: 'Les plateaux basculent doucement.',
      sound: 'La cloche du service tinte.',
      magnet: 'Les bonbons se collent les uns aux autres.',
      cursor: 'Une cerise remplace le curseur.',
      rain: 'Des vermicelles tombent en pluie sur l’étal.',
      shaketext: 'Les lettres tremblotent comme de la gélatine.',
      crt: 'Un léger grésillement croustille en fond.',
      drunk: 'Le comptoir tangue, un peu trop gourmand.',
      music: 'Une ritournelle sucrée se met à jouer.',
      confetti: 'Une pluie de bonbons éclate sur le comptoir !',
      firework: 'Un feu d’artifice de sucre illumine l’étal.',
      shockwave: 'Une onde de chantilly balaie le comptoir.',
      shake: 'Tout le présentoir tremble de gourmandise.',
      emojiRain: 'Des sucreries pleuvent de partout.',
      counter: 'Le compteur de gourmandise grimpe.',
      timewarp: 'Le sirop coule au ralenti.',
      everything: 'Le buffet complet est servi !',
      reset: 'La table est débarrassée, prête pour la suite.'
    },

    palette: ['#ff8fab', '#ffc2d6', '#bdf2e6', '#ffe8a3', '#ddc9f2', '#ffffff'],
    emojis: ['🍬', '🍭', '🍩', '🧁', '🍧', '🍨', '🍫', '🍒'],
    cursor: '🍒',

    presets: {
      rain: { preset: 'snow', glyphs: ['🍬', '●', '✦', '🍭'], density: 26, speed: 0.8, drift: 12, color: '#ff8fab' },
      burst: { shapes: ['circle'], colors: ['#ff8fab', '#ffc2d6', '#bdf2e6', '#ffe8a3', '#ddc9f2'], preset: 'confetti' },
      bg: { color: '#ffc2d6', shape: 'circle', density: 22 },
      trail: { shape: 'circle', size: 10, color: '#ff8fab' },
      emojiRain: { glyphs: ['🍬', '🍭', '🍩', '🧁', '🍒'] },
      magnet: { color: '#ffe8a3' }
    },

    layout: layout,
    teardown: teardown,
    onEffect: onEffect,
    onFire: onFire,
    narrate: narrate,
    sound: sound,
    music: music
  });
})();
