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
    metaEl: null,        // élément DOM de la région meta (compteur/combo)
    tabButtons: null,    // { controls, actions } — boutons d'onglets mobile
    tabHandlers: null,   // { controls, actions } — listeners à détacher
    resizeHandler: null, // ajustement des plaques (fitTiers), retiré en teardown
    themeEventHandler: null // ré-ajuste après mountControls/mountThemeNav (mandat lib.fix4)
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

    return { tier: tier, plate: plate };
  }

  // ---------------------------------------------------------------------
  // fitTiers — mandat lib.fix4 : jamais de défilement. Chaque plaque a une
  // hauteur bornée par la grille (CSS) ; on réduit --candy-item-scale (posé
  // sur .candy-tier, lu par candy.css) par dichotomie jusqu'à ce que la
  // plaque ne déborde plus (scrollHeight <= clientHeight + 1). Le
  // quadrillage flex-wrap des contrôles/actions absorbe déjà l'essentiel :
  // cette passe ne fait qu'un ajustement fin, plaque par plaque.
  // ---------------------------------------------------------------------
  // Une région (controls/actions/nav) porte son propre overflow:hidden et
  // max-height:100% : elle peut déborder (scrollHeight > clientHeight) sans
  // que la plaque qui la contient déborde à son tour, puisque sa boîte
  // extérieure reste bornée par max-height. Il faut donc vérifier la
  // plaque ET ses régions, pas la plaque seule. Un macaron individuel
  // (.juicy-action, .juicy-toggle) est en hauteur libre (height:auto) : un
  // libellé de plusieurs mots peut le faire déborder de sa propre boîte
  // sans que le flex-wrap parent (dont la ligne se dimensionne déjà sur ce
  // même contenu) ne le révèle au niveau plaque/région — vérifié aussi
  // (mandat lib.fix4, débordement mesuré sur button.juicy-action).
  function fits(plate) {
    if (plate.scrollHeight > plate.clientHeight + 1) return false;
    var regions = plate.querySelectorAll('[data-juicy-region]');
    for (var i = 0; i < regions.length; i++) {
      if (regions[i].scrollHeight > regions[i].clientHeight + 1) return false;
    }
    var controls = plate.querySelectorAll('.juicy-action, .juicy-toggle');
    for (var j = 0; j < controls.length; j++) {
      if (controls[j].scrollHeight > controls[j].clientHeight + 1) return false;
    }
    return true;
  }

  function fitTier(tierEl) {
    if (!tierEl) return;
    tierEl.style.removeProperty('--candy-item-scale');
    var plate = tierEl.querySelector('.candy-plate');
    if (!plate || plate.hasAttribute('hidden') || plate.hidden) return;
    if (fits(plate)) return;

    var lo = 0.35;
    var hi = 1;
    var best = lo;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      tierEl.style.setProperty('--candy-item-scale', mid.toFixed(3));
      if (fits(plate)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    tierEl.style.setProperty('--candy-item-scale', best.toFixed(3));
  }

  function fitTiers() {
    if (!state.root) return;
    var tiers = state.root.querySelectorAll('.candy-tier');
    for (var i = 0; i < tiers.length; i++) fitTier(tiers[i]);
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

    // --- onglets mobiles (réglages / macarons), CSS ne les affiche qu'en
    // dessous de 600px ; au clic (jamais de survol), voir candy.css. ------
    var texts = (api.theme && api.theme.texts) || {};
    var tabs = document.createElement('div');
    tabs.className = 'candy-tabs';
    tabs.setAttribute('data-juicy-owner', 'candy');
    tabs.setAttribute('role', 'tablist');

    var tabControls = document.createElement('button');
    tabControls.type = 'button';
    tabControls.className = 'candy-tab-btn';
    tabControls.setAttribute('role', 'tab');
    tabControls.textContent = texts.controlsTitle || 'Réglages';

    var tabActions = document.createElement('button');
    tabActions.type = 'button';
    tabActions.className = 'candy-tab-btn';
    tabActions.setAttribute('role', 'tab');
    tabActions.textContent = texts.actionsTitle || 'Actions';

    tabs.appendChild(tabControls);
    tabs.appendChild(tabActions);
    counter.appendChild(tabs);

    function setTab(id) {
      counter.setAttribute('data-candy-tab', id);
      tabControls.setAttribute('aria-selected', id === 'controls' ? 'true' : 'false');
      tabActions.setAttribute('aria-selected', id === 'actions' ? 'true' : 'false');
    }
    var onTabControls = function () { setTab('controls'); };
    var onTabActions = function () { setTab('actions'); };
    tabControls.addEventListener('click', onTabControls);
    tabActions.addEventListener('click', onTabActions);
    setTab('controls');
    state.tabButtons = { controls: tabControls, actions: tabActions };
    state.tabHandlers = { controls: onTabControls, actions: onTabActions };

    api.themeLayer.appendChild(counter);
    state.root = counter;
    updateMeta(api);

    fitTiers();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.root === counter) fitTiers();
      });
    }
    var resizeTimer = null;
    state.resizeHandler = function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitTiers, 120);
      state.timers.push(resizeTimer);
    };
    window.addEventListener('resize', state.resizeHandler);

    // layout() tourne avant que le noyau peuple réellement les interrupteurs/
    // boutons (mountControls/mountThemeNav, appelés après incoming.layout()
    // dans setTheme()) : un fitTiers() lancé ici mesure des régions encore
    // vides et conclut à tort que tout tient. 'juicy:theme' est déclenché par
    // le noyau juste après ce peuplement, avant checkFit() — c'est le bon
    // moment pour re-mesurer (mandat lib.fix4).
    state.themeEventHandler = function (e) {
      if (state.root === counter && e.detail && e.detail.id === 'candy') fitTiers();
    };
    document.addEventListener('juicy:theme', state.themeEventHandler);
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
    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
      state.resizeHandler = null;
    }
    if (state.themeEventHandler) {
      document.removeEventListener('juicy:theme', state.themeEventHandler);
      state.themeEventHandler = null;
    }
    if (state.tabButtons && state.tabHandlers) {
      state.tabButtons.controls.removeEventListener('click', state.tabHandlers.controls);
      state.tabButtons.actions.removeEventListener('click', state.tabHandlers.actions);
    }
    state.tabButtons = null;
    state.tabHandlers = null;
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
      // size 10 restait proche du défaut mais se fond trop dans les
      // plateaux clairs du thème (contraste faible avec les teintes
      // pastel) ; 16 garde la forme « caramel » tout en restant mesurable.
      trail: { shape: 'circle', size: 16, color: '#ff8fab' },
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
