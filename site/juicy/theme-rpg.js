/* Thème RPG rétro 8-bit — implémente les hooks de JUICY.registerTheme et
   pilote les classes de theme-rpg.css. Propriété de game.rpg — voir
   .swarm/pages/contrat-juicy.md, qui fait foi. Aucun id/classe/hook hors du
   contrat : le moteur (core.js/core.css) est écrit en parallèle et n'est pas
   lu ici. */
(function () {
  'use strict';

  var TYPEWRITER_SPEED = 26; // ms par caractère

  var typewriterTimer = null;
  var timelines = [];
  var synth = null;
  var musicSynth = null;
  var musicLoop = null;

  // --- Nettoyage (appelé par onDeactivate) ---
  function stopTypewriter() {
    if (typewriterTimer) {
      clearTimeout(typewriterTimer);
      typewriterTimer = null;
    }
  }

  function stopTimelines() {
    timelines.forEach(function (tl) {
      tl.kill();
    });
    timelines = [];
  }

  function stopMusic() {
    if (musicLoop) {
      musicLoop.stop(0);
      musicLoop.dispose();
      musicLoop = null;
    }
  }

  // --- Décor (#theme-layer) : bordure pixel + étoiles ---
  function buildDecor(api) {
    var layer = api.themeLayer;
    layer.innerHTML =
      '<div class="rpg-frame"></div>' +
      '<div class="rpg-stars" aria-hidden="true"></div>';
    var stars = layer.querySelector('.rpg-stars');
    var count = 20;
    for (var i = 0; i < count; i++) {
      var star = document.createElement('span');
      star.className = 'rpg-star';
      star.style.left = (Math.random() * 100).toFixed(1) + '%';
      star.style.top = (Math.random() * 100).toFixed(1) + '%';
      star.style.animationDelay = (Math.random() * 2).toFixed(2) + 's';
      stars.appendChild(star);
    }
  }

  // --- Scène (#theme-stage) : barres de PV/PM + zone de chiffres de dégâts ---
  function buildStage(api) {
    var stage = api.themeStage;
    stage.innerHTML =
      '<div class="rpg-bars">' +
        '<div class="rpg-bar rpg-bar--hp">' +
          '<span class="rpg-bar-label">PV</span>' +
          '<div class="rpg-bar-track"><div class="rpg-bar-fill" data-rpg-bar="hp"></div></div>' +
        '</div>' +
        '<div class="rpg-bar rpg-bar--mp">' +
          '<span class="rpg-bar-label">PM</span>' +
          '<div class="rpg-bar-track"><div class="rpg-bar-fill" data-rpg-bar="mp"></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="rpg-dmg-layer"></div>';
  }

  // --- Machine à écrire dans #comment ---
  function typewriter(text, api) {
    var box = document.getElementById('comment');
    if (!box) return;
    stopTypewriter();
    box.innerHTML = '<span class="rpg-typed"></span><span class="rpg-caret">▶</span>';
    var typed = box.querySelector('.rpg-typed');

    if (api.state.reduceMotion) {
      typed.textContent = text;
      return;
    }

    var i = 0;
    function step() {
      typed.textContent = text.slice(0, i);
      i++;
      if (i <= text.length) {
        typewriterTimer = setTimeout(step, TYPEWRITER_SPEED);
      } else {
        typewriterTimer = null;
      }
    }
    step();
  }

  // --- Chiffre de dégâts qui saute ---
  function popDamage(api) {
    var layer = api.themeStage && api.themeStage.querySelector('.rpg-dmg-layer');
    if (!layer) return;
    var dmg = document.createElement('span');
    dmg.className = 'rpg-dmg';
    dmg.textContent = '-' + (Math.floor(Math.random() * 40) + 10);
    dmg.style.left = (28 + Math.random() * 44).toFixed(1) + '%';
    layer.appendChild(dmg);

    if (api.state.reduceMotion || !api.gsap) {
      setTimeout(function () {
        dmg.remove();
      }, 500);
      return;
    }

    var tl = api.gsap.timeline({
      onComplete: function () {
        dmg.remove();
        timelines = timelines.filter(function (t) {
          return t !== tl;
        });
      }
    });
    tl.fromTo(dmg, { y: 0, opacity: 0, scale: 0.6 }, { y: -46, opacity: 1, scale: 1.1, duration: 0.25, ease: 'back.out(2)' })
      .to(dmg, { y: -70, opacity: 0, duration: 0.35, ease: 'power1.in' });
    timelines.push(tl);
  }

  // --- Barre de PV/PM qui descend puis remonte ---
  function hitBar(api, which) {
    var fill = api.themeStage && api.themeStage.querySelector('[data-rpg-bar="' + which + '"]');
    if (!fill) return;
    var drop = 8 + Math.random() * 14;
    var low = Math.max(15, 100 - drop) + '%';

    if (api.state.reduceMotion || !api.gsap) {
      fill.style.width = low;
      setTimeout(function () {
        fill.style.width = '100%';
      }, 400);
      return;
    }

    var tl = api.gsap.timeline({
      onComplete: function () {
        timelines = timelines.filter(function (t) {
          return t !== tl;
        });
      }
    });
    tl.to(fill, { width: low, duration: 0.15, ease: 'power1.out' })
      .to(fill, { width: '100%', duration: 0.6, delay: 0.25, ease: 'power2.out' });
    timelines.push(tl);
  }

  // --- Son : chiptune via Tone.js, oscillateurs carré/triangle, pas de reverb ---
  var SFX = {
    toggleOn: ['C5', 'E5'],
    toggleOff: ['E5', 'C5'],
    hover: ['C6'],
    confetti: ['C5', 'E5', 'G5'],
    shake: ['C4', 'C4'],
    emoji: ['E5', 'G5', 'C6'],
    firework: ['C5', 'G5', 'C6'],
    shockwave: ['C3', 'C4'],
    counter: ['G5'],
    combo: ['C5', 'E5', 'G5', 'C6'],
    everything: ['C4', 'E4', 'G4', 'C5', 'E5', 'G5'],
    reset: ['C4'],
    theme: ['C4', 'G4', 'C5'],
    achievement: ['E5', 'G5', 'C6', 'G5']
  };

  function ensureSynth(Tone) {
    if (!synth) {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.05 }
      }).toDestination();
      synth.volume.value = -10;
    }
    return synth;
  }

  function playSfx(name, api) {
    var seq = SFX[name];
    if (!seq || !api.Tone) return;
    var s = ensureSynth(api.Tone);
    var now = api.Tone.now();
    seq.forEach(function (note, i) {
      s.triggerAttackRelease(note, '32n', now + i * 0.05);
    });
  }

  // --- Musique : boucle de donjon 8-bit courte, volume discret ---
  var MUSIC_NOTES = ['C3', 'Eb3', 'G3', 'C4', 'Bb2', 'C3', 'Eb3', 'F3'];

  function playMusic(api) {
    if (musicLoop || !api.Tone) return;
    if (!musicSynth) {
      musicSynth = new api.Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.1 }
      }).toDestination();
      musicSynth.volume.value = -18;
    }
    var i = 0;
    musicLoop = new api.Tone.Loop(function (time) {
      musicSynth.triggerAttackRelease(MUSIC_NOTES[i % MUSIC_NOTES.length], '16n', time);
      i++;
    }, '8n');
    musicLoop.start(0);
    api.Tone.Transport.start();
  }

  // --- Déclaration du thème ---
  JUICY.registerTheme({
    id: 'rpg',
    name: 'RPG rétro',
    title: 'PRESS START',
    tagline: 'Une quête pixelisée à explorer sans manette.',
    togglesTitle: "Menu d'options",
    actionsTitle: 'Compétences',

    labels: {
      // Les 19 toggles
      bg: 'Décor animé',
      trail: "Traînée d'étincelles",
      light: 'Palette diurne',
      glitch: 'Titre corrompu',
      tilt: 'Inclinaison des panneaux',
      sound: 'Bruitages',
      magnet: 'Aimant à compétences',
      cursor: 'Curseur héros',
      rain: 'Pluie de runes',
      shaketext: 'Texte tremblant',
      crt: 'Écran cathodique',
      timewarp: 'Distorsion temporelle',
      antigravity: 'Antigravité',
      negative: 'Monde miroir',
      fog: 'Brouillard de donjon',
      snow: 'Neige éternelle',
      bigtext: 'Texte géant',
      drunk: 'Ivresse du héros',
      music: 'Musique de fond',
      // Les 8 actions
      confetti: 'Pluie de gemmes',
      shake: 'Secousse tellurique',
      emoji: 'Invocation',
      firework: "Feu d'artifice",
      shockwave: 'Onde de choc',
      counter: 'Combo',
      everything: 'Technique ultime',
      reset: 'Repos au camp'
    },

    comments: {
      bg: 'Le donjon prend vie autour de vous.',
      trail: 'Des étincelles suivent votre lame.',
      light: 'Le soleil perce la voûte du donjon.',
      glitch: 'Une malédiction brouille les runes du titre.',
      tilt: "Les panneaux vacillent sous un charme d'équilibre.",
      sound: "Les bruitages du donjon s'éveillent.",
      magnet: 'Vos compétences sont attirées par la cible.',
      cursor: 'Votre curseur prend la forme d\'une flèche héroïque.',
      rain: 'Il pleut des runes anciennes.',
      shaketext: 'Un tremblement parcourt les textes du donjon.',
      crt: 'Un vieux sortilège cathodique recouvre l\'écran.',
      timewarp: 'Le temps se distend autour de vous.',
      antigravity: 'La gravité du donjon s\'inverse.',
      negative: 'Vous basculez dans le monde miroir.',
      fog: 'Un brouillard épais envahit le donjon.',
      snow: 'Une neige éternelle recouvre la scène.',
      bigtext: 'Les inscriptions grandissent démesurément.',
      drunk: 'Le héros titube, ivre de magie.',
      music: 'La mélodie du donjon commence.',
      confetti: 'Une pluie de gemmes s\'abat sur le champ de bataille !',
      shake: 'Le sol tremble sous le coup porté.',
      emoji: 'Une invocation traverse l\'écran.',
      firework: 'Un feu d\'artifice illumine le donjon.',
      shockwave: 'Une onde de choc balaie la zone.',
      counter: 'Le compteur de combo grimpe.',
      everything: 'La technique ultime est déclenchée !',
      reset: 'Retour au camp, tout est remis à neuf.',
      theme: 'Un nouveau chapitre commence.'
    },

    emojis: ['⚔️', '🛡️', '⭐', '💰', '🧪'],
    rainGlyphs: ['0', '1', '★', '♦'],
    snowGlyphs: ['❄', '✦'],
    palette: ['#f8d34c', '#4fd1c5', '#e0563c', '#7c5cff'],
    confettiOptions: { shapes: ['square'], scalar: 1, ticks: 120 },
    cursor: '▶',

    onActivate: function (api) {
      buildDecor(api);
      buildStage(api);
    },

    onDeactivate: function () {
      stopTypewriter();
      stopTimelines();
      stopMusic();
    },

    onComment: function (text, api) {
      typewriter(text, api);
    },

    onAction: function (id, api) {
      popDamage(api);
      hitBar(api, Math.random() < 0.5 ? 'hp' : 'mp');
      if (Math.random() < 0.35) {
        api.toast('🏆 Succès débloqué');
      }
    },

    sound: function (name, api) {
      playSfx(name, api);
    },

    music: function (on, api) {
      if (on) {
        playMusic(api);
      } else {
        stopMusic();
      }
    }
  });
})();
