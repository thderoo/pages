/*
 * Thème neon — console de cockpit à trois colonnes.
 * Voir .swarm/pages/contrat-lib.md §9-§11 : layout(api) construit tout le
 * chrome dans api.layer('theme'), qui est vidé automatiquement par le noyau
 * à chaque bascule/teardown ; on ne détruit donc jamais le DOM à la main,
 * seulement les écouteurs, la boucle ticker et les instances de briques.
 */
(function () {
  var TOGGLE_LABELS = {
    bg: 'FOND',
    trail: 'SILLAGE',
    glitch: 'BROUILLAGE',
    tilt: 'INCLINAISON',
    sound: 'AUDIO',
    magnet: 'AIMANT',
    cursor: 'VISEUR',
    rain: 'PLUIE DE CODE',
    shaketext: 'VIBRATION TEXTE',
    crt: 'BALAYAGE CRT',
    drunk: 'TANGAGE',
    music: 'MUSIQUE'
  };

  var ACTION_LABELS = {
    confetti: 'CONFETTIS',
    firework: "FEU D'ARTIFICE",
    shockwave: 'ONDE DE CHOC',
    shake: 'SECOUSSE',
    emojiRain: "PLUIE D'EMOJIS",
    counter: 'COMPTEUR',
    timewarp: 'DISTORSION TEMPORELLE',
    everything: 'TOUT ARMER',
    reset: 'RÉINITIALISER'
  };

  var ALERT_TRIGGERS = { everything: true, reset: true, shockwave: true, shake: true };

  var LINES = {
    theme: 'BASCULE VERS NEON-HUD…',
    bg: 'FOND TACTIQUE ACTIVÉ',
    trail: 'SILLAGE DE PARTICULES ENGAGÉ',
    glitch: 'INTERFÉRENCE DÉTECTÉE',
    tilt: 'STABILISATEUR GYROSCOPIQUE ACTIF',
    sound: 'CANAL AUDIO OUVERT',
    magnet: 'CHAMP MAGNÉTIQUE ENGAGÉ',
    cursor: 'VISEUR TACTIQUE VERROUILLÉ',
    rain: 'PLUIE DE DONNÉES EN COURS',
    shaketext: 'INSTABILITÉ TEXTUELLE',
    crt: 'BALAYAGE CRT ACTIVÉ',
    drunk: 'STABILISATEURS HORS LIGNE',
    music: 'BANDE SONORE ENGAGÉE',
    confetti: 'LARGAGE DE CONFETTIS',
    firework: "TIR DE FEU D'ARTIFICE",
    shockwave: 'ONDE DE CHOC ÉMISE',
    shake: 'IMPACT DÉTECTÉ',
    emojiRain: "PLUIE D'ICÔNES",
    counter: 'COMPTEUR INCRÉMENTÉ',
    timewarp: 'DISTORSION TEMPORELLE ENGAGÉE',
    everything: 'ARMEMENT TOTAL',
    reset: 'SYSTÈMES RÉINITIALISÉS'
  };

  // état de la console active, recréé à chaque layout(), effacé à chaque
  // teardown() : rien n'est partagé entre deux activations du thème.
  var session = null;

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function buildLayout(api) {
    var theme = api.theme || {};
    var texts = theme.texts || {};

    var root = el('div', 'neon-console');
    root.setAttribute('data-juicy-owner', 'neon');
    api.themeLayer.appendChild(root);

    var header = el('div', 'neon-header');
    var left = el('div', 'neon-panel neon-panel--left');
    var right = el('div', 'neon-panel neon-panel--right');
    var sceneWrap = el('div', 'neon-scene');
    root.appendChild(header);
    root.appendChild(left);
    root.appendChild(right);
    root.appendChild(sceneWrap);

    // --- bandeau haut : titre, accroche, bascule, méta, statut -------
    var titleHost = el('div', 'neon-title-host');
    var navHost = el('div', 'neon-nav-host');
    var metaHost = el('div', 'neon-meta-host');
    var alertHost = el('div', 'neon-alert-host');
    header.appendChild(titleHost);
    header.appendChild(navHost);
    header.appendChild(metaHost);
    header.appendChild(alertHost);

    api.mount('title', titleHost);
    api.mount('tagline', titleHost);
    api.mount('nav', navHost);
    api.mount('meta', metaHost);
    var metaEl = api.region('meta');
    function updateMeta() {
      if (!metaEl) return;
      metaEl.textContent = 'COMPTEUR ' + api.state.counter + ' · COMBO ' + api.state.combo;
    }
    updateMeta();

    var alertWidget = api.widget('alert', alertHost, {
      text: 'SYSTÈME EN LIGNE',
      level: 'ok'
    });

    // --- panneau gauche : interrupteurs à voyant ----------------------
    var controlsTitle = el('div', 'neon-panel-title');
    controlsTitle.textContent = texts.controlsTitle || 'SYSTÈMES';
    left.appendChild(controlsTitle);
    api.mount('controls', left);

    // --- panneau droit : modules d'armement + cadrans radiaux --------
    var actionsTitle = el('div', 'neon-panel-title');
    actionsTitle.textContent = texts.actionsTitle || 'ARMEMENT';
    right.appendChild(actionsTitle);
    api.mount('actions', right);

    // Cadrans radiaux : un dial (brique `gauge`, mode radial) par module
    // d'armement, dont la valeur suit la variable --cooldown posée par le
    // noyau sur le bouton lui-même pendant son temps de recharge.
    var gauges = {};
    var actionButtons = right.querySelectorAll('[data-juicy-action]');
    for (var i = 0; i < actionButtons.length; i++) {
      var btn = actionButtons[i];
      var id = btn.getAttribute('data-juicy-action');
      var dialHost = el('span', 'neon-dial');
      btn.appendChild(dialHost);
      gauges[id] = {
        button: btn,
        gauge: api.widget('gauge', dialHost, {
          value: 0,
          max: 1,
          shape: 'radial',
          color: 'var(--neon-cyan)'
        })
      };
    }

    function readCooldowns() {
      for (var actionId in gauges) {
        if (!Object.prototype.hasOwnProperty.call(gauges, actionId)) continue;
        var entry = gauges[actionId];
        var raw = getComputedStyle(entry.button).getPropertyValue('--cooldown');
        raw = raw ? raw.trim() : '';
        var value = raw === '' ? 0 : parseFloat(raw);
        entry.gauge.update({ value: isNaN(value) ? 0 : value, max: 1 });
      }
    }
    api.ticker.add(readCooldowns);

    // --- centre : radar tactique à balayage ---------------------------
    var reticle = el('div', 'neon-reticle');
    var radar = el('div', 'neon-radar');
    var sweep = el('div', 'neon-radar-sweep');
    var echoes = el('div', 'neon-radar-echoes');
    radar.appendChild(sweep);
    radar.appendChild(echoes);
    var readout = el('div', 'neon-readout');
    sceneWrap.appendChild(reticle);
    sceneWrap.appendChild(radar);
    sceneWrap.appendChild(readout);
    api.mount('scene', sceneWrap);

    function activeSystemCount() {
      var s = api.state;
      var count = 0;
      for (var k in s.on) {
        if (Object.prototype.hasOwnProperty.call(s.on, k) && s.on[k]) count += 1;
      }
      return count;
    }

    function readRadar() {
      var s = api.state;
      var ts = typeof s.timeScale === 'number' ? s.timeScale : 1;
      readout.textContent =
        'CPT ' + s.counter + ' · COMBO ' + s.combo +
        ' · T×' + ts.toFixed(2) + ' · SYS ' + activeSystemCount();
    }
    api.ticker.add(readRadar);

    var echoTimers = [];
    function spawnEcho() {
      var dot = el('span', 'neon-echo');
      var angle = Math.random() * Math.PI * 2;
      var dist = 18 + Math.random() * 32; // % du rayon du radar
      dot.style.left = (50 + Math.cos(angle) * dist) + '%';
      dot.style.top = (50 + Math.sin(angle) * dist) + '%';
      echoes.appendChild(dot);
      var t = setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 900);
      echoTimers.push(t);
    }

    // --- télémétrie : la région narration devient elle-même la barre
    // fixée en bas ; la brique ticker en est le rendu défilant. ---------
    var tickerWidget = null;
    api.mount('narration', root);
    var narrationRegion = api.region('narration');
    if (narrationRegion) {
      narrationRegion.classList.add('neon-telemetry');
      narrationRegion.textContent = '';
      var tickerHost = el('div', 'neon-ticker-host');
      narrationRegion.appendChild(tickerHost);
      tickerWidget = api.widget('ticker', tickerHost, {
        items: [(theme.lines && theme.lines.theme) || 'CONSOLE NEON-HUD EN LIGNE'],
        speed: 60
      });
    }

    // --- tiroirs mobiles -----------------------------------------------
    var handleLeft = el('button', 'neon-drawer-handle neon-drawer-handle--left');
    handleLeft.type = 'button';
    handleLeft.setAttribute('aria-label', controlsTitle.textContent);
    handleLeft.textContent = '»';
    var handleRight = el('button', 'neon-drawer-handle neon-drawer-handle--right');
    handleRight.type = 'button';
    handleRight.setAttribute('aria-label', actionsTitle.textContent);
    handleRight.textContent = '«';
    root.appendChild(handleLeft);
    root.appendChild(handleRight);

    function onHandleLeft() {
      left.classList.toggle('is-open');
    }
    function onHandleRight() {
      right.classList.toggle('is-open');
    }
    handleLeft.addEventListener('click', onHandleLeft);
    handleRight.addEventListener('click', onHandleRight);

    var alertTimer = null;
    function flashAlert(text) {
      alertWidget.update({ text: text || 'ALERTE', level: 'alert' });
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(function () {
        alertTimer = null;
        alertWidget.update({ text: 'SYSTÈME EN LIGNE', level: 'ok' });
      }, 1200);
    }

    return {
      root: root,
      left: left,
      right: right,
      gauges: gauges,
      readCooldowns: readCooldowns,
      readRadar: readRadar,
      updateMeta: updateMeta,
      spawnEcho: spawnEcho,
      clearEchoTimers: function () {
        echoTimers.forEach(function (t) { clearTimeout(t); });
        echoTimers.length = 0;
      },
      handleLeft: handleLeft,
      handleRight: handleRight,
      onHandleLeft: onHandleLeft,
      onHandleRight: onHandleRight,
      alertWidget: alertWidget,
      tickerWidget: tickerWidget,
      flashAlert: flashAlert,
      clearAlertTimer: function () {
        if (alertTimer) {
          clearTimeout(alertTimer);
          alertTimer = null;
        }
      }
    };
  }

  function destroySession(api, s) {
    api.ticker.remove(s.readCooldowns);
    api.ticker.remove(s.readRadar);
    s.clearEchoTimers();
    s.handleLeft.removeEventListener('click', s.onHandleLeft);
    s.handleRight.removeEventListener('click', s.onHandleRight);
    s.clearAlertTimer();
    for (var id in s.gauges) {
      if (Object.prototype.hasOwnProperty.call(s.gauges, id)) {
        s.gauges[id].gauge.destroy();
      }
    }
    s.alertWidget.destroy();
    if (s.tickerWidget) s.tickerWidget.destroy();
    // Le DOM lui-même (root et tout ce qu'il contient) est effacé par le
    // noyau, qui vide api.layer('theme') à chaque bascule/teardown.
  }

  window.Juicy.registerTheme({
    id: 'neon',
    name: 'HUD néon',

    texts: {
      title: 'NEON HUD',
      tagline: 'INTERFACE DE COCKPIT',
      controlsTitle: 'SYSTÈMES',
      actionsTitle: 'ARMEMENT'
    },

    labels: (function () {
      var labels = {};
      for (var t in TOGGLE_LABELS) labels[t] = TOGGLE_LABELS[t];
      for (var a in ACTION_LABELS) labels[a] = ACTION_LABELS[a];
      return labels;
    })(),

    lines: LINES,

    palette: ['#00f6ff', '#ff2bd6', '#ffb000'],
    emojis: ['🛰️', '⚡', '🎯', '🛡️', '📡'],
    cursor: '◎',

    presets: {
      rain: { glyphs: ['0', '1', '◇', '※', '#'], density: 42, speed: 1.3, color: '#00f6ff' },
      trail: { shape: 'square', size: 5, color: '#00f6ff' },
      burst: { shapes: ['square', 'triangle'], colors: ['#00f6ff', '#ff2bd6', '#ffb000'] },
      bg: { color: '#00f6ff', density: 30 },
      crt: { intensity: 0.6 }
    },

    layout: function (api) {
      session = buildLayout(api);
    },

    teardown: function (api) {
      if (session) {
        destroySession(api, session);
        session = null;
      }
    },

    onFire: function (id, api) {
      if (!session) return;
      session.updateMeta();
      session.spawnEcho();
      if (ALERT_TRIGGERS[id]) {
        session.flashAlert(LINES[id] || 'ALERTE');
      }
    },

    narrate: function (text, api) {
      if (session && session.tickerWidget) session.tickerWidget.update({ items: [text] });
    },

    music: function (on, api) {
      if (session) session.root.classList.toggle('is-music-on', !!on);
      if (!on || !api.Tone || typeof api.Tone.start !== 'function') return;
      // Dégradation gracieuse : sans Tone.js réellement chargé, la
      // console reste muette mais n'erre jamais.
    },

    sound: function (name, api) {
      if (!api.Tone || typeof api.Tone.Synth !== 'function') return;
      var freq =
        {
          toggleOn: 660,
          toggleOff: 340,
          hover: 880,
          select: 990,
          confetti: 740,
          firework: 820,
          shockwave: 220,
          shake: 180,
          emoji: 560,
          counter: 940,
          combo: 1040,
          everything: 1200,
          reset: 260,
          theme: 500,
          achievement: 1180,
          alert: 300,
          type: 700
        }[name] || 500;
      try {
        var synth = new api.Tone.Synth().toDestination();
        synth.triggerAttackRelease(freq, '32n');
      } catch (e) {
        // no-op : un thème n'erre jamais, cf. contrat §9
      }
    }
  });
})();
