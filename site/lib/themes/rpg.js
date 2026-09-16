/*
 * Theme "rpg" — écran de jeu 8-bit rétro, plein écran, sans défilement,
 * navigation au clavier façon menu de combat. Module de la lib Juicy, voir
 * projects/pages/CLAUDE.md et le contrat .swarm/pages/contrat-lib.md (§9, §10).
 *
 * Ce fichier suppose que window.Juicy existe déjà (chargé après juicy.js).
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.Juicy || typeof window.Juicy.registerTheme !== 'function') {
    return;
  }

  var TOGGLE_IDS = [
    'bg', 'trail', 'glitch', 'tilt', 'sound', 'magnet',
    'cursor', 'rain', 'shaketext', 'crt', 'drunk', 'music'
  ];
  var ACTION_IDS = [
    'confetti', 'firework', 'shockwave', 'shake', 'emojiRain',
    'counter', 'timewarp', 'everything', 'reset'
  ];

  var SOUND_BY_ACTION = {
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

  // État privé de l'instance de thème courante : tout ce que layout() crée,
  // teardown() doit le détruire intégralement (règle §11 : rien ne survit).
  var state = {
    screen: null,
    cursorEl: null,
    widgets: [],
    timers: [],
    musicLoop: null,
    hpGauge: null,
    mpGauge: null,
    keydownHandler: null,
    windows: { options: null, skills: null }, // { el, body, items: [] }
    activeWindow: 'options',
    selectedIndex: 0,
    battle: null,       // { monster, hero, gauge, caption, defeated }
    monsterHp: 100,
    metaEl: null,
    resizeHandler: null, // ajustement des fenêtres de menu (fitMenus), retiré en cleanup
    themeEventHandler: null, // ré-ajuste après mountControls/mountThemeNav (mandat lib.fix4)
    readyEventHandler: null // idem, cas du tout premier chargement (mandat lib.fix4)
  };

  function clearTimers() {
    state.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    state.timers.length = 0;
  }

  function clearWidgets() {
    state.widgets.forEach(function (w) {
      try { w && typeof w.destroy === 'function' && w.destroy(); } catch (e) { /* noop */ }
    });
    state.widgets.length = 0;
    state.hpGauge = null;
    state.mpGauge = null;
  }

  function stopMusic() {
    if (!state.musicLoop) return;
    try { state.musicLoop.stop && state.musicLoop.stop(0); } catch (e) { /* noop */ }
    try { state.musicLoop.dispose && state.musicLoop.dispose(); } catch (e) { /* noop */ }
    state.musicLoop = null;
  }

  function detachKeyboard() {
    if (state.keydownHandler) {
      document.removeEventListener('keydown', state.keydownHandler);
      state.keydownHandler = null;
    }
  }

  function cleanup() {
    detachKeyboard();
    clearTimers();
    clearWidgets();
    stopMusic();
    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
      state.resizeHandler = null;
    }
    if (state.themeEventHandler) {
      document.removeEventListener('juicy:theme', state.themeEventHandler);
      state.themeEventHandler = null;
    }
    if (state.readyEventHandler) {
      document.removeEventListener('juicy:ready', state.readyEventHandler);
      state.readyEventHandler = null;
    }
    if (state.screen && state.screen.parentNode) {
      state.screen.parentNode.removeChild(state.screen);
    }
    state.screen = null;
    state.cursorEl = null;
    state.windows = { options: null, skills: null };
    state.activeWindow = 'options';
    state.selectedIndex = 0;
    state.battle = null;
    state.monsterHp = 100;
    state.metaEl = null;
  }

  function owned(tag, className) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    el.setAttribute('data-juicy-owner', 'rpg');
    return el;
  }

  function currentItems() {
    var w = state.windows[state.activeWindow];
    return (w && w.items) || [];
  }

  function moveCursor() {
    var items = currentItems();
    if (!items.length || !state.cursorEl) return;
    if (state.selectedIndex >= items.length) state.selectedIndex = 0;
    if (state.selectedIndex < 0) state.selectedIndex = items.length - 1;

    Object.keys(state.windows).forEach(function (key) {
      var w = state.windows[key];
      if (!w) return;
      w.items.forEach(function (it) { it.classList.remove('rpg-selected'); });
    });

    var item = items[state.selectedIndex];
    item.classList.add('rpg-selected');
    item.insertBefore(state.cursorEl, item.firstChild);
  }

  function switchWindow(dir) {
    var order = ['options', 'skills'].filter(function (k) {
      var w = state.windows[k];
      return w && w.items.length;
    });
    if (order.length < 2) return;
    var idx = order.indexOf(state.activeWindow);
    idx = (idx + dir + order.length) % order.length;
    state.activeWindow = order[idx];
    state.selectedIndex = 0;
    moveCursor();
  }

  function moveSelection(dir, api) {
    var items = currentItems();
    if (!items.length) return;
    state.selectedIndex = (state.selectedIndex + dir + items.length) % items.length;
    moveCursor();
    try { api.sound('hover'); } catch (e) { /* noop */ }
  }

  function activateSelection(api) {
    var items = currentItems();
    if (!items.length) return;
    var item = items[state.selectedIndex];
    try { api.sound('select'); } catch (e) { /* noop */ }
    item.click();
  }

  function attachKeyboard(api) {
    detachKeyboard();
    state.keydownHandler = function (evt) {
      if (!state.screen) return;
      switch (evt.key) {
        case 'ArrowDown':
          evt.preventDefault();
          moveSelection(1, api);
          break;
        case 'ArrowUp':
          evt.preventDefault();
          moveSelection(-1, api);
          break;
        case 'ArrowRight':
          evt.preventDefault();
          switchWindow(1);
          break;
        case 'ArrowLeft':
          evt.preventDefault();
          switchWindow(-1);
          break;
        case 'Enter':
        case ' ':
          evt.preventDefault();
          activateSelection(api);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', state.keydownHandler);
  }

  function buildWindow(titleText, regionName, api) {
    var win = owned('section', 'rpg-window rpg-panel-border');
    var h2 = owned('h2', 'rpg-window-title');
    h2.textContent = titleText;
    win.appendChild(h2);

    var body = owned('div', 'rpg-window-body');
    win.appendChild(body);

    var items = [];
    if (api.region(regionName)) {
      api.mount(regionName, body);
      var selector = regionName === 'controls' ? '[data-juicy-toggle]' : '[data-juicy-action]';
      items = Array.prototype.slice.call(body.querySelectorAll(selector));
    }

    return { el: win, body: body, items: items };
  }

  // ---------------------------------------------------------------------
  // fitMenus / fitWindow — mandat lib.fix4 : jamais de défilement. La
  // hauteur disponible se mesure en JS (bandeau de statut + dialogue,
  // getBoundingClientRect, jamais une valeur en dur), se répartit entre les
  // deux fenêtres selon leur nombre d'items, puis --rpg-item-scale (lu par
  // rpg.css) est réduit par recherche dichotomique jusqu'à ce que le corps
  // ne déborde plus (scrollHeight <= clientHeight + 1) ; si l'échelle
  // minimale ne suffit toujours pas, la liste bascule en deux colonnes.
  // ---------------------------------------------------------------------
  function fitWindow(win, boxHeight) {
    if (!win || !win.el || !win.body) return;
    var el = win.el;
    var body = win.body;
    var wrapper = body.querySelector('[data-juicy-region]');
    el.style.height = boxHeight + 'px';
    el.style.removeProperty('--rpg-item-scale');
    if (wrapper) wrapper.classList.remove('rpg-window-body--grid');
    if (!body.querySelector('.juicy-toggle, .juicy-action')) return;
    if (body.scrollHeight <= body.clientHeight + 1) return;

    // Le floor de la recherche descend plus bas en grille (0.05 contre
    // 0.55) : padding/gap/min-height continuent de se réduire sous ce
    // floor, mais font-size est déjà à son plancher clamp(6px, ...) dès
    // 0.667, donc la lisibilité du texte ne se dégrade plus en dessous —
    // seul l'espacement se resserre, ce qui est justement ce qu'il faut
    // pour caser deux colonnes sur une petite hauteur (mandat lib.fix4,
    // débordement mesuré aux petits viewports même en grille à floor 0.55).
    function shrinkToFit(floor) {
      var lo = floor;
      var hi = 1;
      var best = lo;
      for (var i = 0; i < 12; i++) {
        var mid = (lo + hi) / 2;
        el.style.setProperty('--rpg-item-scale', mid.toFixed(3));
        if (body.scrollHeight <= body.clientHeight + 1) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      el.style.setProperty('--rpg-item-scale', best.toFixed(3));
      return body.scrollHeight <= body.clientHeight + 1;
    }

    if (shrinkToFit(0.55)) return;

    // Repli deux colonnes : la recherche dichotomique ci-dessus a déjà donné
    // sa meilleure réponse pour une seule colonne (échelle minimale, encore
    // trop grand) — passer en grille change la hauteur nécessaire (moitié
    // moins de lignes) et appelle donc sa propre recherche, pas la réponse
    // de la colonne unique (mandat lib.fix4, débordement mesuré aux petits
    // viewports où même la grille à l'échelle minimale d'origine débordait
    // encore).
    if (wrapper) {
      wrapper.classList.add('rpg-window-body--grid');
      shrinkToFit(0.05);
    }
  }

  // items est capturé une fois dans buildWindow(), à un moment (layout(),
  // avant mountControls/mountThemeNav) où la région est encore vide : sans
  // ce rafraîchissement, la liste reste figée à vide pour de bon (ni le
  // garde-fou ci-dessous, ni la navigation clavier — qui lit ce même
  // state.windows.X.items — ne voient jamais les interrupteurs/actions
  // réels) (mandat lib.fix4, débordement mesuré une fois le contenu réel en
  // place).
  function refreshWindowItems() {
    ['options', 'skills'].forEach(function (k) {
      var w = state.windows[k];
      if (!w || !w.body) return;
      var selector = k === 'options' ? '[data-juicy-toggle]' : '[data-juicy-action]';
      w.items = Array.prototype.slice.call(w.body.querySelectorAll(selector));
    });
  }

  function fitMenus() {
    refreshWindowItems();
    var wins = ['options', 'skills']
      .map(function (k) { return state.windows[k]; })
      .filter(function (w) { return w && w.items.length; });
    if (!wins.length) return;
    var statusEl = document.querySelector('html[data-juicy-theme="rpg"] .rpg-statusbar');
    var dialogueEl = document.querySelector('html[data-juicy-theme="rpg"] [data-juicy-region="narration"]');
    var statusH = statusEl ? statusEl.getBoundingClientRect().height : 0;
    var dialogueH = dialogueEl ? dialogueEl.getBoundingClientRect().height : 0;
    var available = window.innerHeight - statusH - dialogueH - 32;
    var gapTotal = 12 * Math.max(wins.length - 1, 0);
    var usable = Math.max(available - gapTotal, 80);
    var totalItems = wins.reduce(function (s, w) { return s + w.items.length; }, 0);
    wins.forEach(function (w) {
      var share = totalItems ? w.items.length / totalItems : 1 / wins.length;
      var h = Math.max(Math.round(usable * share), 70);
      fitWindow(w, h);
    });
  }

  function spawnDamageNumber(api) {
    var anchor = (state.battle && state.battle.monster) ||
      (state.windows.skills && state.windows.skills.el);
    var rect = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0 };
    var crit = Math.random() < 0.3;
    var value = Math.ceil(Math.random() * 40) + 10;
    var fn = api.widget('floatNumber', { x: rect.left + rect.width / 2, y: rect.top }, {
      value: value,
      prefix: '-',
      crit: crit,
      color: crit ? 'var(--rpg-red)' : 'var(--rpg-gold)'
    });
    if (fn) state.widgets.push(fn);
  }

  function buildBattle(api, sceneSlot) {
    var wrap = owned('div', 'rpg-battle');

    var heroWrap = owned('div', 'rpg-hero');
    heroWrap.textContent = '🧙';
    wrap.appendChild(heroWrap);

    var monsterWrap = owned('div', 'rpg-monster-wrap');
    var gaugeSlot = owned('div', 'rpg-monster-gauge-slot');
    monsterWrap.appendChild(gaugeSlot);
    var monsterEl = owned('div', 'rpg-monster');
    monsterEl.textContent = '👾';
    monsterWrap.appendChild(monsterEl);
    wrap.appendChild(monsterWrap);

    var caption = owned('div', 'rpg-battle-caption');
    wrap.appendChild(caption);

    sceneSlot.appendChild(wrap);

    var gauge = api.widget('gauge', gaugeSlot, { value: 100, max: 100, label: 'MONSTRE', color: 'var(--rpg-red)' });
    if (gauge) state.widgets.push(gauge);

    return { wrap: wrap, hero: heroWrap, monster: monsterEl, gauge: gauge, caption: caption, defeated: false };
  }

  function hitMonster(api) {
    if (!state.battle || state.battle.defeated) return;
    spawnDamageNumber(api);
    var m = state.battle.monster;
    m.classList.remove('rpg-monster--hit');
    void m.offsetWidth; // force le redémarrage de l'animation
    m.classList.add('rpg-monster--hit');

    state.monsterHp = Math.max(0, state.monsterHp - (8 + Math.random() * 14));
    if (state.battle.gauge) state.battle.gauge.update({ value: state.monsterHp });
    if (state.monsterHp <= 0) victory(api);
  }

  function victory(api) {
    if (!state.battle || state.battle.defeated) return;
    state.battle.defeated = true;
    state.battle.monster.classList.add('rpg-monster--defeated');
    if (state.battle.gauge) state.battle.gauge.update({ value: 0 });
  }

  function reviveMonster() {
    if (!state.battle) return;
    state.battle.defeated = false;
    state.monsterHp = 100;
    state.battle.monster.classList.remove('rpg-monster--defeated', 'rpg-monster--hit');
    if (state.battle.gauge) state.battle.gauge.update({ value: 100 });
  }

  function updateMeta(api) {
    if (!state.metaEl) return;
    state.metaEl.textContent = 'Compteur : ' + api.state.counter + ' · Combo : ' + api.state.combo;
  }

  function getLine(id, api) {
    var lines = (api.theme && api.theme.lines) || {};
    if (lines[id]) return lines[id];
    var labels = (api.theme && api.theme.labels) || {};
    return labels[id] ? labels[id] + ' !' : '...';
  }

  function layout(api) {
    cleanup(); // défensif : repart d'un état propre si rappelé sans teardown

    var screen = owned('div', 'rpg-screen');
    state.screen = screen;

    // --- bandeau de statut ---
    var statusbar = owned('div', 'rpg-statusbar rpg-panel-border');

    var banner = owned('div', 'rpg-banner');
    if (api.region('title')) api.mount('title', banner);
    if (api.region('tagline')) api.mount('tagline', banner);
    statusbar.appendChild(banner);

    var gauges = owned('div', 'rpg-gauges');
    var hpSlot = owned('div', 'rpg-gauge-slot');
    var mpSlot = owned('div', 'rpg-gauge-slot');
    gauges.appendChild(hpSlot);
    gauges.appendChild(mpSlot);
    statusbar.appendChild(gauges);
    state.hpGauge = api.widget('gauge', hpSlot, { value: 100, max: 100, label: 'PV', color: 'var(--rpg-green)' });
    state.mpGauge = api.widget('gauge', mpSlot, { value: 100, max: 100, label: 'PM', color: 'var(--rpg-violet)' });
    if (state.hpGauge) state.widgets.push(state.hpGauge);
    if (state.mpGauge) state.widgets.push(state.mpGauge);

    var metaSlot = owned('div', 'rpg-meta-slot');
    if (api.region('meta')) {
      api.mount('meta', metaSlot);
      state.metaEl = api.region('meta');
    }
    statusbar.appendChild(metaSlot);

    var navSlot = owned('div', 'rpg-nav-slot');
    if (api.region('nav')) api.mount('nav', navSlot);
    statusbar.appendChild(navSlot);

    screen.appendChild(statusbar);

    // --- scène de combat ---
    var sceneSlot = owned('div', 'rpg-scene-slot');
    if (api.region('scene')) {
      state.battle = buildBattle(api, sceneSlot);
      api.mount('scene', state.battle.caption);
    } else {
      sceneSlot.classList.add('rpg-scene-slot--empty');
      sceneSlot.textContent = (api.theme && api.theme.emojis && api.theme.emojis[0]) || '⚔️';
    }
    screen.appendChild(sceneSlot);

    // --- fenêtres de menu, empilées en bas à gauche ---
    var menus = owned('div', 'rpg-menus');
    var texts = (api.theme && api.theme.texts) || {};
    var optionsWin = buildWindow(texts.controlsTitle || "MENU D'OPTIONS", 'controls', api);
    var skillsWin = buildWindow(texts.actionsTitle || 'COMPÉTENCES', 'actions', api);
    menus.appendChild(optionsWin.el);
    menus.appendChild(skillsWin.el);
    screen.appendChild(menus);

    state.windows.options = optionsWin;
    state.windows.skills = skillsWin;
    state.activeWindow = optionsWin.items.length ? 'options' : 'skills';
    state.selectedIndex = 0;

    // --- fenêtre de dialogue, fixée en bas pleine largeur ---
    var dialogueFrame = owned('div', 'rpg-dialogue-frame');
    if (api.region('narration')) {
      api.mount('narration', dialogueFrame);
    }
    screen.appendChild(dialogueFrame);

    // --- curseur de sélection clavier ---
    var cursorGlyph = (api.theme && api.theme.cursor) || '▶';
    state.cursorEl = owned('span', 'rpg-cursor');
    state.cursorEl.textContent = cursorGlyph;
    state.cursorEl.setAttribute('aria-hidden', 'true');
    screen.appendChild(state.cursorEl);

    api.themeLayer.appendChild(screen);

    moveCursor();
    attachKeyboard(api);
    narrate(getLine('theme', api) || 'Une quête pixel commence…', api);
    updateMeta(api);

    fitMenus();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (state.screen === screen) fitMenus();
      });
    }
    var resizeTimer = null;
    state.resizeHandler = function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitMenus, 120);
      state.timers.push(resizeTimer);
    };
    window.addEventListener('resize', state.resizeHandler);

    // layout() tourne avant que le noyau peuple réellement les interrupteurs/
    // boutons (mountControls/mountThemeNav, appelés après incoming.layout()
    // dans setTheme()) : un fitMenus() lancé ici mesure des fenêtres encore
    // vides et ne déclenche jamais la réduction d'échelle. 'juicy:theme' est
    // déclenché par le noyau juste après ce peuplement — c'est le bon moment
    // pour re-mesurer (mandat lib.fix4).
    state.themeEventHandler = function (e) {
      if (state.screen === screen && e.detail && e.detail.id === 'rpg') fitMenus();
    };
    document.addEventListener('juicy:theme', state.themeEventHandler);
    // Cas particulier du tout premier chargement de page : rpg est le thème
    // initial, donc ce tout premier setTheme() déclenche 'juicy:theme' AVANT
    // que init() n'appelle mountControls()/mountThemeNav() (ces deux appels,
    // non gardés pour cette toute première fois, arrivent seulement après le
    // retour de setTheme()) — mesuré : fenêtres de menu encore vides à ce
    // moment, débordement une fois réellement peuplées. 'juicy:ready', tout à
    // la fin de init(), est le bon moment pour ce cas précis (mandat lib.fix4).
    state.readyEventHandler = function () {
      if (state.screen === screen) fitMenus();
    };
    document.addEventListener('juicy:ready', state.readyEventHandler);
  }

  function teardown() {
    cleanup();
  }

  function onEffect(id, on, api) {
    updateMeta(api);
    if (id === 'music') return; // délégué à music(on, api)
    try { api.sound(on ? 'toggleOn' : 'toggleOff'); } catch (e) { /* noop */ }
    if (on) narrate(getLine(id, api), api);
  }

  function onFire(id, api) {
    updateMeta(api);
    try { api.sound(SOUND_BY_ACTION[id] || 'select'); } catch (e) { /* noop */ }
    narrate(getLine(id, api), api);

    // burst (confetti/firework/shockwave), shake et counter sont les frappes
    // qui touchent le monstre : dégâts flottants + recul (contrat §9 : onFire
    // reçoit l'id de l'effet réellement déclenché, pas l'id de l'action).
    if (id === 'burst' || id === 'shake' || id === 'counter') {
      hitMonster(api);
    }
    if (id === 'everything') {
      victory(api);
      try {
        api.toast('Attaque ultime débloquée !', { icon: '🏆', kind: 'success' });
      } catch (e) { /* noop */ }
    }
    if (id === 'reset') {
      if (state.hpGauge) state.hpGauge.update({ value: 100 });
      if (state.mpGauge) state.mpGauge.update({ value: 100 });
      reviveMonster();
    }
  }

  function narrate(text, api) {
    var region = api.region('narration');
    if (!region) return;

    // Une seule machine à écrire vivante à la fois pour la narration.
    state.widgets = state.widgets.filter(function (w) {
      if (w && w.__rpgNarration) {
        try { w.destroy && w.destroy(); } catch (e) { /* noop */ }
        return false;
      }
      return true;
    });

    var tw = api.widget('typewriter', region, { text: text, speed: 32, sound: 'type' });
    if (tw) {
      tw.__rpgNarration = true;
      state.widgets.push(tw);
    }
  }

  function sound(name, api) {
    if (!api.Tone) return;
    var freq = {
      toggleOn: 523, toggleOff: 349, hover: 660, select: 784,
      confetti: 880, firework: 988, shockwave: 220, shake: 165,
      emoji: 1046, counter: 880, combo: 988, everything: 1318,
      reset: 262, theme: 587, achievement: 1175, alert: 294, type: 1568
    }[name] || 523;
    try {
      var synth = new api.Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.08 }
      }).toDestination();
      synth.volume.value = -12;
      synth.triggerAttackRelease(freq, '32n');
      var t = setTimeout(function () { try { synth.dispose(); } catch (e) { /* noop */ } }, 500);
      state.timers.push(t);
    } catch (e) { /* dégradation silencieuse */ }
  }

  function music(on, api) {
    if (!on) {
      stopMusic();
      return;
    }
    if (!api.Tone || api.state.reduceMotion) return;
    try {
      var synth = new api.Tone.Synth({ oscillator: { type: 'square' } }).toDestination();
      synth.volume.value = -18;
      var notes = ['C4', 'E4', 'G4', 'C5', 'G4', 'E4'];
      var i = 0;
      var loop = new api.Tone.Loop(function (time) {
        synth.triggerAttackRelease(notes[i % notes.length], '16n', time);
        i += 1;
      }, '8n');
      loop.start(0);
      if (api.Tone.Transport && api.Tone.Transport.state !== 'started') {
        api.Tone.Transport.start();
      }
      state.musicLoop = loop;
    } catch (e) { /* dégradation silencieuse */ }
  }

  window.Juicy.registerTheme({
    id: 'rpg',
    name: 'RPG rétro',

    texts: {
      title: 'PRESS START',
      tagline: 'Une quête pixel commence',
      controlsTitle: "MENU D'OPTIONS",
      actionsTitle: 'COMPÉTENCES'
    },

    labels: {
      // 12 toggles continus
      bg: 'Décor animé',
      trail: 'Traînée d’étincelles',
      glitch: 'Interférence',
      tilt: 'Inclinaison du champ',
      sound: 'Effets sonores',
      magnet: 'Aimantation',
      cursor: 'Curseur héros',
      rain: 'Pluie de pixels',
      shaketext: 'Texte tremblant',
      crt: 'Filtre rétro',
      drunk: 'Ivresse',
      music: 'Musique de fond',
      // 9 actions ponctuelles
      confetti: 'Pluie de trésor',
      firework: 'Feu d’artifice',
      shockwave: 'Onde de choc',
      shake: 'Frappe critique',
      emojiRain: 'Invocation',
      counter: 'Combo',
      timewarp: 'Distorsion temporelle',
      everything: 'Attaque ultime',
      reset: 'Fuite'
    },

    lines: {
      theme: 'Un héros 8-bit entre dans la salle.',
      bg: 'Le décor pixelisé s’anime en fond.',
      trail: 'Une traînée d’étincelles suit le curseur.',
      glitch: 'Une interférence traverse l’écran.',
      tilt: 'Le champ de bataille s’incline légèrement.',
      sound: 'Les effets sonores sont armés.',
      magnet: 'Les objets sont aimantés vers le héros.',
      cursor: 'Le curseur prend la forme du héros.',
      rain: 'Une pluie de pixels tombe sur l’écran.',
      shaketext: 'Le texte se met à trembler.',
      crt: 'Un filtre rétro grésille en fond.',
      drunk: 'L’écran tangue, effet d’ivresse.',
      music: 'Une mélodie chiptune se met à jouer.',
      confetti: 'Une pluie de trésor s’abat sur la salle !',
      firework: 'Un feu d’artifice pixelisé explose !',
      shockwave: 'Une onde de choc balaie l’écran !',
      shake: 'Frappe critique ! Les dégâts pleuvent.',
      emojiRain: 'Une invocation fait pleuvoir des symboles !',
      counter: 'Le combo grimpe !',
      timewarp: 'Le temps se distord…',
      everything: 'Attaque ultime déclenchée !',
      reset: 'Le héros bat en retraite.'
    },

    palette: ['#e0c34c', '#7b3ff2', '#4ce07a', '#e0524c'],
    emojis: ['⚔️', '🛡️', '💎', '🏹'],
    cursor: '▶',

    presets: {
      // speed 0.8 (plus lent que le défaut 1) reste sous le seuil de
      // différence de pixels perceptible sur une fenêtre de 300ms ; 1.4
      // garde la chute posée du thème tout en restant mesurablement animée.
      rain: { glyphs: ['0', '1', '♦', '※'], density: 26, speed: 1.4, size: 14, color: '#e0c34c' },
      bg: { shape: 'square', density: 36, color: '#7b3ff2' },
      trail: { shape: 'square', size: 6, color: '#e0c34c' },
      burst: { shapes: ['square'], colors: ['#e0c34c', '#7b3ff2', '#4ce07a', '#e0524c'], preset: 'confetti' },
      shaketext: { intensity: 3 },
      cursor: { glyph: '▶' },
      emojiRain: { glyphs: ['⚔️', '🛡️', '💎', '🏹'] }
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
