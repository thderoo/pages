/* theme-neon.js — HUD sci-fi néon pour juicy.html
   S'appuie uniquement sur le contrat .swarm/pages/contrat-juicy.md :
   aucun id, classe ou hook inventé. Chaque hook survit à un `api` dont les
   zones optionnelles sont vides. */

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // État du module (une seule instance de thème active à la fois)
  // ------------------------------------------------------------------

  var frameWrap = null;
  var bannerEl = null;
  var telemetryEl = null;
  var telemetryTimer = null;
  var alertFlashTimer = null;

  var audio = null; // { master, reverb, blip, saw, noiseFilter, noise }
  var musicSynth = null;
  var musicGain = null;
  var musicLoop = null;

  var DISTURBING_TOGGLES = ["negative", "drunk", "timewarp"];

  var TELEMETRY_LINES = [
    "BALAYAGE SECTEUR... OK",
    "FLUX D'ÉNERGIE STABLE",
    "CAPTEURS ALIGNÉS",
    "LIAISON SATELLITE ACTIVE",
    "NOYAU À TEMPÉRATURE NOMINALE",
    "PRESSION HYDRAULIQUE OK",
    "SYNCHRONISATION RADAR",
    "ANALYSE DE TRAJECTOIRE...",
    "MODULE PRÊT",
    "INTÉGRITÉ COQUE 100%",
    "TÉLÉMÉTRIE EN COURS",
    "CANAL CHIFFRÉ OUVERT"
  ];

  // ------------------------------------------------------------------
  // Cadre cockpit (api.themeLayer)
  // ------------------------------------------------------------------

  function buildFrame(api) {
    var layer = api.themeLayer;
    if (!layer) return;

    var wrap = document.createElement("div");
    wrap.className = "neon-frame";

    ["tl", "tr", "bl", "br"].forEach(function (pos) {
      var c = document.createElement("div");
      c.className = "neon-corner neon-corner-" + pos;
      wrap.appendChild(c);
    });

    ["left", "right"].forEach(function (side) {
      var r = document.createElement("div");
      r.className = "neon-reticule neon-reticule-" + side;
      wrap.appendChild(r);
    });

    var top = document.createElement("div");
    top.className = "neon-statusbar neon-statusbar-top";
    top.innerHTML = '<span>SYS // NEON-HUD</span><span class="is-live">● EN LIGNE</span>';
    wrap.appendChild(top);

    var bottom = document.createElement("div");
    bottom.className = "neon-statusbar neon-statusbar-bottom";
    bottom.innerHTML = "<span>SECTEUR 07</span><span>CANAL CHIFFRÉ</span>";
    wrap.appendChild(bottom);

    var banner = document.createElement("div");
    banner.className = "neon-alert-banner";
    banner.textContent = "ALERTE";
    wrap.appendChild(banner);

    layer.appendChild(wrap);

    frameWrap = wrap;
    bannerEl = banner;

    updateSustainedAlert(api);
  }

  function teardownFrame(api) {
    if (frameWrap && api.gsap) {
      api.gsap.killTweensOf(frameWrap.querySelectorAll("*"));
    }
    frameWrap = null;
    bannerEl = null;
  }

  function updateSustainedAlert(api) {
    if (!frameWrap || !bannerEl) return;
    var active = DISTURBING_TOGGLES.some(function (id) {
      return api.isOn(id);
    });
    frameWrap.classList.toggle("neon-alert-sustained", active);
    bannerEl.classList.toggle("is-visible", active);
  }

  function triggerAlertFlash(api) {
    if (!frameWrap || !bannerEl) return;
    frameWrap.classList.add("neon-alert-flash");
    bannerEl.classList.add("is-visible");
    if (alertFlashTimer) alertFlashTimer.kill();
    var duration = api.state.reduceMotion ? 0.8 : 1.3;
    if (api.gsap) {
      alertFlashTimer = api.gsap.delayedCall(duration, function () {
        frameWrap.classList.remove("neon-alert-flash");
        if (!frameWrap.classList.contains("neon-alert-sustained")) {
          bannerEl.classList.remove("is-visible");
        }
      });
    } else {
      frameWrap.classList.remove("neon-alert-flash");
    }
  }

  // ------------------------------------------------------------------
  // Télémétrie (api.themeStage)
  // ------------------------------------------------------------------

  function startTelemetry(api) {
    var stage = api.themeStage;
    if (!stage) return;

    var list = document.createElement("div");
    list.className = "neon-telemetry";
    stage.appendChild(list);
    telemetryEl = list;

    if (api.state.reduceMotion) {
      TELEMETRY_LINES.slice(0, 6).forEach(function (text) {
        appendLine(api, text, false);
      });
      return;
    }

    function tick() {
      var text = TELEMETRY_LINES[Math.floor(Math.random() * TELEMETRY_LINES.length)];
      appendLine(api, text, true);
      if (api.gsap) {
        telemetryTimer = api.gsap.delayedCall(1.3 + Math.random() * 1.4, tick);
      }
    }
    tick();
  }

  function appendLine(api, text, animate) {
    if (!telemetryEl) return;
    var line = document.createElement("div");
    line.className = "neon-telemetry-line";
    line.textContent = text;
    telemetryEl.insertBefore(line, telemetryEl.firstChild);
    if (animate && api.gsap) {
      api.gsap.fromTo(line, { opacity: 0, x: -6 }, { opacity: 0.85, x: 0, duration: 0.25 });
    }
    while (telemetryEl.children.length > 8) {
      telemetryEl.removeChild(telemetryEl.lastElementChild);
    }
  }

  function pushComment(api, text) {
    if (!telemetryEl) return;
    var line = document.createElement("div");
    line.className = "neon-telemetry-line is-comment";
    line.textContent = text;
    telemetryEl.insertBefore(line, telemetryEl.firstChild);
    if (api.gsap) {
      api.gsap.fromTo(line, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.25 });
    }
    while (telemetryEl.children.length > 8) {
      telemetryEl.removeChild(telemetryEl.lastElementChild);
    }
  }

  function stopTelemetry(api) {
    if (telemetryTimer) {
      telemetryTimer.kill();
      telemetryTimer = null;
    }
    if (telemetryEl && api.gsap) {
      api.gsap.killTweensOf(telemetryEl.querySelectorAll("*"));
    }
    telemetryEl = null;
  }

  // ------------------------------------------------------------------
  // Son (Tone.js) — le moteur n'appelle sound() que si le toggle `sound`
  // est actif et l'AudioContext démarré. On ne démarre jamais l'audio ici.
  // ------------------------------------------------------------------

  function ensureAudio(Tone) {
    if (audio || !Tone) return audio;
    var reverb = new Tone.Reverb({ decay: 0.55, wet: 0.22 }).toDestination();
    var master = new Tone.Gain(0.7).connect(reverb);
    var blip = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.05 }
    }).connect(master);
    var saw = new Tone.Synth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.08 }
    }).connect(master);
    var noiseFilter = new Tone.Filter(1200, "bandpass").connect(master);
    var noise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.05 }
    }).connect(noiseFilter);
    audio = { master: master, reverb: reverb, blip: blip, saw: saw, noiseFilter: noiseFilter, noise: noise };
    return audio;
  }

  function sweep(Tone, synth, from, to, dur) {
    var t = Tone.now();
    synth.triggerAttack(from, t);
    synth.frequency.rampTo(to, dur, t);
    synth.triggerRelease(t + dur);
  }

  function sound(name, api) {
    var Tone = api.Tone;
    var a = ensureAudio(Tone);
    if (!a || !Tone) return;
    var now = Tone.now();

    switch (name) {
      case "toggleOn":
        a.blip.triggerAttackRelease("C6", "32n", now);
        break;
      case "toggleOff":
        a.blip.triggerAttackRelease("G4", "32n", now);
        break;
      case "hover":
        a.blip.triggerAttackRelease("E6", "64n", now, 0.15);
        break;
      case "confetti":
        ["C6", "E6", "G6"].forEach(function (n, i) {
          a.saw.triggerAttackRelease(n, "32n", now + i * 0.05);
        });
        break;
      case "shake":
        a.noise.triggerAttackRelease("8n", now);
        sweep(Tone, a.saw, 90, 40, 0.2);
        break;
      case "emoji":
        ["A5", "C6", "E6"].forEach(function (n, i) {
          a.blip.triggerAttackRelease(n, "32n", now + i * 0.04);
        });
        break;
      case "firework":
        a.noise.triggerAttackRelease("4n", now);
        sweep(Tone, a.saw, 220, 880, 0.25);
        break;
      case "shockwave":
        a.noise.triggerAttackRelease("4n", now);
        sweep(Tone, a.saw, 60, 30, 0.4);
        break;
      case "counter":
        a.blip.triggerAttackRelease("D6", "64n", now);
        break;
      case "combo":
        sweep(Tone, a.blip, 660, 990, 0.12);
        break;
      case "everything":
        a.noise.triggerAttackRelease("2n", now);
        sweep(Tone, a.saw, 80, 720, 0.5);
        break;
      case "reset":
        sweep(Tone, a.blip, 880, 220, 0.3);
        break;
      case "theme":
        a.blip.triggerAttackRelease("A5", "16n", now);
        break;
      case "achievement":
        ["C6", "E6", "G6", "C7"].forEach(function (n, i) {
          a.blip.triggerAttackRelease(n, "16n", now + i * 0.08);
        });
        break;
      default:
        break;
    }
  }

  function setMusic(on, api) {
    var Tone = api.Tone;
    var a = ensureAudio(Tone);
    if (!a || !Tone) return;

    if (on) {
      if (musicLoop) return;
      if (!musicSynth) {
        musicSynth = new Tone.FMSynth({
          harmonicity: 1.5,
          modulationIndex: 2,
          envelope: { attack: 2, decay: 1, sustain: 0.5, release: 3 }
        });
        musicGain = new Tone.Gain(0.09).connect(a.reverb);
        musicSynth.connect(musicGain);
      }
      var notes = ["C1", "G0", "D#1", "A#0"];
      var i = 0;
      musicLoop = new Tone.Loop(function (time) {
        musicSynth.triggerAttackRelease(notes[i % notes.length], "2n", time);
        i++;
      }, "2n");
      Tone.Transport.start();
      musicLoop.start(0);
    } else if (musicLoop) {
      musicLoop.stop();
      musicLoop.dispose();
      musicLoop = null;
      Tone.Transport.stop();
    }
  }

  function music(on, api) {
    setMusic(on, api);
  }

  // ------------------------------------------------------------------
  // Hooks du contrat
  // ------------------------------------------------------------------

  function onActivate(api) {
    buildFrame(api);
    startTelemetry(api);
  }

  function onDeactivate(api) {
    if (alertFlashTimer) {
      alertFlashTimer.kill();
      alertFlashTimer = null;
    }
    stopTelemetry(api);
    teardownFrame(api);
    setMusic(false, api);
  }

  function onToggle(id, on, api) {
    if (DISTURBING_TOGGLES.indexOf(id) !== -1) {
      updateSustainedAlert(api);
    }
  }

  function onAction(id, api) {
    if (id === "shake" || id === "everything") {
      triggerAlertFlash(api);
    }
  }

  function onComment(text, api) {
    pushComment(api, text);
  }

  // ------------------------------------------------------------------
  // Enregistrement
  // ------------------------------------------------------------------

  window.JUICY.registerTheme({
    id: "neon",
    name: "HUD néon",
    title: "SYSTÈME EN LIGNE",
    tagline: "Interface de contrôle tactique — tous systèmes nominaux.",
    togglesTitle: "Modules",
    actionsTitle: "Armement",

    labels: {
      bg: "Fond actif",
      trail: "Traînée ionique",
      light: "Mode diurne",
      glitch: "Interférence",
      tilt: "Stabilisateurs",
      sound: "Audio système",
      magnet: "Champ magnétique",
      cursor: "Viseur tactique",
      rain: "Pluie de données",
      shaketext: "Vibration texte",
      crt: "Bruit de fond CRT",
      timewarp: "Distorsion temporelle",
      antigravity: "Gravité inversée",
      negative: "Mode négatif",
      fog: "Brouillard radar",
      snow: "Neige de signal",
      bigtext: "Amplification texte",
      drunk: "Turbulences",
      music: "Nappe sonore",

      confetti: "Tir de paillettes",
      shake: "Secousse",
      emoji: "Essaim d'icônes",
      firework: "Feu d'artifice",
      shockwave: "Onde de choc",
      counter: "Compteur",
      everything: "Tout déclencher",
      reset: "Réinitialisation"
    },

    comments: {
      bg: "Le fond du secteur s'anime.",
      trail: "Traînée ionique détectée derrière le curseur.",
      light: "Bascule en mode diurne.",
      glitch: "Interférence sur le signal vidéo.",
      tilt: "Stabilisateurs gyroscopiques engagés.",
      sound: "Canal audio ouvert.",
      magnet: "Champ magnétique activé sur les modules.",
      cursor: "Viseur tactique verrouillé.",
      rain: "Pluie de données en cours.",
      shaketext: "Vibration détectée sur l'affichage.",
      crt: "Bruit de fond CRT audible.",
      timewarp: "Distorsion temporelle en cours.",
      antigravity: "Gravité inversée sur les particules.",
      negative: "Polarité vidéo inversée.",
      fog: "Brouillard radar en approche.",
      snow: "Neige de signal sur les capteurs.",
      bigtext: "Amplification des caractères.",
      drunk: "Turbulences sur la passerelle.",
      music: "Nappe sonore de fond activée.",

      confetti: "Tir de paillettes en cours.",
      shake: "Alerte : secousse détectée.",
      emoji: "Essaim d'icônes relâché.",
      firework: "Feu d'artifice sur écran radar.",
      shockwave: "Onde de choc émise.",
      counter: "Compteur incrémenté.",
      everything: "Alerte : protocole complet déclenché.",
      reset: "Réinitialisation du système.",
      theme: "Interface neuronale recalibrée."
    },

    emojis: ["⚡", "🛰️", "📡", "🔷", "💠", "🔧"],
    rainGlyphs: ["0", "1", "#", "∆", "λ", "§"],
    snowGlyphs: ["░", "▪", "✦", "·", "＊"],
    palette: ["#00fff2", "#ff2bd6", "#7df9ff"],
    confettiOptions: { colors: ["#00fff2", "#ff2bd6", "#39ff88"], shapes: ["square"], scalar: 0.9, ticks: 250 },
    particlesPreset: {
      particles: {
        shape: { type: "square" },
        color: { value: ["#00fff2", "#ff2bd6"] },
        opacity: { value: 0.55 },
        links: { enable: true, color: "#00fff2", opacity: 0.2 }
      }
    },
    cursor: "⌖",

    onActivate: onActivate,
    onDeactivate: onDeactivate,
    onToggle: onToggle,
    onAction: onAction,
    onComment: onComment,
    sound: sound,
    music: music
  });
})();
