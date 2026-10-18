/*
 * heisei.js : socle commun de l'animation des écrans ds-heisei. Expose window.Heisei.
 * Seule dépendance : window.gsap (GSAP 3, chargé avant ce script). Sans GSAP rien ne s'anime, mais les minuteries
 * continuent (setTimeout / setInterval) pour que les données vivent. Le script se charge en fin de <body>.
 * Le mouvement passe par GSAP ; les styles d'animation sont dans heisei-anim.css.
 */
(function () {
  'use strict';

  var H = {};
  var root = document.documentElement;
  var ok = !!window.gsap;
  var gsap = window.gsap;
  H.ok = ok;

  // Une image d'avance (1/60 s) : GSAP ne bat qu'aux images, un appel prévu à l'instant T tombe sur la première image
  // après T ; on le prend à l'image la plus proche pour que « 5 appels en 5 s » restent 5.
  var IMAGE = 1 / 60;

  // GSAP endort son ticker quand rien ne tourne (gsap.ticker.time se figerait) : un écouteur le garde éveillé.
  // Pas de lissage des à-coups : le temps simulé doit suivre le temps réel sans dérive.
  if (ok) {
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add(function () {});
  }

  // ------------------------------------------------------------------ mouvement réduit
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  H.reduced = !!(mq && mq.matches);
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function (e) { H.reduced = e.matches; });
  }
  H.dur = function (s) { return H.reduced ? 0 : s; };

  // ------------------------------------------------------------------ recherche par jeton data-anim
  H.q = function (nom, racine) {
    return (racine || document).querySelector('[data-anim~="' + nom + '"]');
  };
  H.qa = function (nom, racine) {
    return Array.prototype.slice.call((racine || document).querySelectorAll('[data-anim~="' + nom + '"]'));
  };

  // ------------------------------------------------------------------ générateur pseudo-aléatoire déterministe
  // mulberry32, amorcé par un hachage (FNV-1a) du nom : deux chargements donnent la même suite.
  H.rng = function (nom) {
    var h = 2166136261;
    var s = String(nom);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var a = h >>> 0;
    var f = function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = function (min, max) { return min + Math.floor(f() * (max - min + 1)); };
    f.pick = function (tab) { return tab[Math.floor(f() * tab.length)]; };
    f.around = function (valeur, amplitude) { return valeur + (f() * 2 - 1) * amplitude; };
    return f;
  };

  // ------------------------------------------------------------------ petits outils
  H.pad = function (n, largeur) {
    var s = String(Math.abs(Math.trunc(n)));
    while (s.length < largeur) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  };

  // Retire les premiers enfants de parent au-delà de max (les plus anciens en tête) ; rend le nombre retiré.
  H.trim = function (parent, max) {
    var retires = 0;
    while (parent.children.length > max) {
      parent.removeChild(parent.firstElementChild);
      retires++;
    }
    return retires;
  };

  // Parmi un tableau de cases, les n premières reçoivent classeAllumee, les autres classeEteinte ; seules les cases qui changent sont touchées.
  H.lit = function (cellules, n, classeAllumee, classeEteinte) {
    for (var i = 0; i < cellules.length; i++) {
      var c = cellules[i];
      var pour = i < n;
      var a = pour ? classeAllumee : classeEteinte;
      var b = pour ? classeEteinte : classeAllumee;
      if (a && !c.classList.contains(a)) c.classList.add(a);
      if (b && c.classList.contains(b)) c.classList.remove(b);
    }
  };

  H.fade = function (el, vers, duree) {
    if (!ok) return null;
    return gsap.to(el, { opacity: vers, duration: H.dur(duree === undefined ? 0.4 : duree), ease: 'power1.out' });
  };

  // Écrit un texte et, hors mouvement réduit, joue une rémanence courte (le phosphore met un instant à se fixer).
  H.write = function (el, texte) {
    if (el.textContent !== texte) {
      el.textContent = texte;
      if (ok && !H.reduced) {
        gsap.fromTo(el, { opacity: 0.45 }, { opacity: 1, duration: 0.4, ease: 'power1.out', clearProps: 'opacity', overwrite: 'auto' });
      }
    }
    return el;
  };

  H.cursor = function (el) { el.classList.add('h-curseur'); };
  H.cursorStop = function (el) { el.classList.remove('h-curseur'); };

  // ------------------------------------------------------------------ minuteries
  // every(sec, fn, premier) : fn(n) après premier s, puis toutes les sec s, sur le temps GSAP. Les instants sont calculés
  // depuis le départ (pas depuis l'appel précédent) : aucune dérive. Une seule tween vivante par minuterie.
  H.every = function (sec, fn, premier) {
    if (premier === undefined) premier = sec;
    var n = 0;
    var mort = false;
    var appel = null;
    var h1 = null;
    var h2 = null;
    if (!ok) {
      h1 = setTimeout(function () {
        fn(n++);
        h2 = setInterval(function () { fn(n++); }, sec * 1000);
      }, premier * 1000);
      return { stop: function () { mort = true; clearTimeout(h1); clearInterval(h2); } };
    }
    var base = gsap.globalTimeline.time();
    var prevoir = function () {
      var cible = base + premier + n * sec - IMAGE;
      appel = gsap.delayedCall(Math.max(0, cible - gsap.globalTimeline.time()), tir);
    };
    var tir = function () {
      if (mort) return;
      fn(n++);
      if (!mort) prevoir();
    };
    prevoir();
    return { stop: function () { mort = true; if (appel) appel.kill(); } };
  };

  H.after = function (sec, fn) {
    if (!ok) {
      var t = setTimeout(fn, sec * 1000);
      return { stop: function () { clearTimeout(t); } };
    }
    var appel = gsap.delayedCall(Math.max(0, sec - IMAGE), fn);
    return { stop: function () { appel.kill(); } };
  };

  H.loop = function (premier, periode, fn) { return H.every(periode, fn, premier); };

  // ------------------------------------------------------------------ temps simulé
  // Le temps de l'écran part de « H07.11.03 23:47:12 » (année japonaise H07 = 1995 : 1988 + n) quand l'allumage
  // est fini, puis avance d'une seconde par seconde de temps GSAP (gsap.ticker.time).
  var horloge = function () { return ok ? gsap.ticker.time : performance.now() / 1000; };
  var T = { epoch: Date.UTC(1995, 10, 3, 23, 47, 12), debut: null };

  var ecoule = function () { return T.debut === null ? 0 : horloge() - T.debut; };
  var parties = function () {
    var d = new Date(T.epoch + Math.floor(ecoule() + 0.02) * 1000);
    return {
      date: 'H' + H.pad(d.getUTCFullYear() - 1988, 2) + '.' + H.pad(d.getUTCMonth() + 1, 2) + '.' + H.pad(d.getUTCDate(), 2),
      h: H.pad(d.getUTCHours(), 2), m: H.pad(d.getUTCMinutes(), 2), s: H.pad(d.getUTCSeconds(), 2)
    };
  };

  H.time = {
    set: function (texte) {
      var m = /^H(\d+)\.(\d+)\.(\d+) (\d+):(\d+):(\d+)$/.exec(texte);
      if (!m) throw new Error('Heisei.time.set : format attendu H07.11.03 23:47:12');
      T.epoch = Date.UTC(1988 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (T.debut !== null) T.debut = horloge();
    },
    stamp: function () { var p = parties(); return p.date + ' ' + p.h + ':' + p.m + ':' + p.s; },
    hms: function () { var p = parties(); return p.h + ':' + p.m + ':' + p.s; },
    hm: function () { var p = parties(); return p.h + ':' + p.m; },
    now: function () { return ecoule(); }
  };

  // Met l'horloge de l'écran à jour chaque seconde (la première fois à +1 s), sans toucher l'élément si le texte ne change pas.
  H.clock = function (el, format) {
    var lire = format === 'hms' ? H.time.hms : H.time.stamp;
    return H.every(1, function () {
      var t = lire();
      if (el.textContent !== t) el.textContent = t;
    });
  };

  // ------------------------------------------------------------------ allumage et prêt
  var fini = false;
  var resoudre = null;
  H.ready = new Promise(function (res) { resoudre = res; });
  H.onReady = function (fn) {
    if (fini) fn(); else H.ready.then(fn);
  };

  var repos = function () {
    T.debut = horloge();
    root.dataset.heisei = 'rest';
    fini = true;
    resoudre();
  };

  // Le verre d'un élément : son descendant direct .k-verre s'il en a un, sinon l'élément lui-même.
  var zoneDe = function (g) {
    for (var i = 0; i < g.children.length; i++) {
      if (g.children[i].classList.contains('k-verre')) return g.children[i];
    }
    return g;
  };

  var noeud = function (classe) {
    var d = document.createElement('div');
    d.className = classe;
    return d;
  };

  // Construit l'overlay d'un verre : mêmes coordonnées et même contour que la zone, tout est éteint.
  var overlay = function (zone, cadre) {
    var r = zone.getBoundingClientRect();
    var ov = noeud('h-allume');
    var haut = noeud('h-allume-haut');
    var bas = noeud('h-allume-bas');
    var trait = noeud('h-allume-trait');
    ov.appendChild(haut);
    ov.appendChild(bas);
    ov.appendChild(trait);
    document.body.appendChild(ov);
    gsap.set(ov, { left: r.left - cadre.left, top: r.top - cadre.top, width: r.width, height: r.height });
    var contour = getComputedStyle(zone).clipPath;
    if (contour && contour !== 'none') gsap.set(ov, { clipPath: contour });
    gsap.set(trait, { scaleX: 0, opacity: 0 });
    return { ov: ov, haut: haut, bas: bas, trait: trait };
  };

  H.boot = function () {
    root.classList.add('h-on');
    if (H.reduced || !ok) {
      repos();
      return;
    }
    root.dataset.heisei = 'allume';
    var cadre = document.body.getBoundingClientRect();
    var verres = H.qa('glass').map(function (g) { return overlay(zoneDe(g), cadre); });
    var n = verres.length;
    if (!n) {
      repos();
      return;
    }
    // Chaque verre démarre pas secondes après le précédent ; le tout dure au plus 1,7 s.
    var pas = n > 1 ? Math.min(0.18, (1.7 - 0.45) / (n - 1)) : 0;
    var tl = gsap.timeline({
      onComplete: function () {
        verres.forEach(function (v) { if (v.ov.parentNode) v.ov.parentNode.removeChild(v.ov); });
        repos();
      }
    });
    verres.forEach(function (v, i) {
      var t = i * pas;
      tl.to(v.trait, { scaleX: 1, opacity: 1, duration: 0.12, ease: 'power1.out' }, t);
      tl.to(v.haut, { scaleY: 0, duration: 0.3, ease: 'power2.out' }, t + 0.12);
      tl.to(v.bas, { scaleY: 0, duration: 0.3, ease: 'power2.out' }, t + 0.12);
      tl.to(v.trait, { opacity: 0, duration: 0.3 }, t + 0.12);
      tl.call(function () { if (v.ov.parentNode) v.ov.parentNode.removeChild(v.ov); }, null, t + 0.45);
    });
  };

  // ------------------------------------------------------------------ sélection
  // suivreSelection(elements, fn) : fn(element, index) à chaque passage de aria-selected à « true » sur un élément de la liste.
  // Un seul MutationObserver pour tous les éléments ; l'état initial n'est pas un changement, donc aucun appel au démarrage.
  H.suivreSelection = function (elements, fn) {
    var liste = Array.prototype.slice.call(elements);
    var obs = new MutationObserver(function (enregistrements) {
      enregistrements.forEach(function (r) {
        var el = r.target;
        if (el.getAttribute('aria-selected') === 'true' && r.oldValue !== 'true') fn(el, liste.indexOf(el));
      });
    });
    liste.forEach(function (el) {
      obs.observe(el, { attributes: true, attributeFilter: ['aria-selected'], attributeOldValue: true });
    });
    return obs;
  };

  // glisseBarre(depart, arrivee, duree) : fait glisser la barre de sélection (::before du wrapper h-ligne) du départ à l'arrivée.
  // La barre est placée par --lx --ly --lw --lh : on anime ces quatre variables sur l'arrivée, puis on remet son style d'origine.
  var NOMS_BARRE = ['--lx', '--ly', '--lw', '--lh'];
  H.glisseBarre = function (depart, arrivee, duree) {
    if (!ok || H.reduced || !depart || !arrivee || depart === arrivee) return null;
    var st = arrivee.style;
    // Origine de l'arrivée : texte exact des quatre variables, mémorisé la première fois.
    if (!arrivee._heiseiOrigine) {
      arrivee._heiseiOrigine = NOMS_BARRE.map(function (n) { return st.getPropertyValue(n); });
    }
    var remettre = function () {
      NOMS_BARRE.forEach(function (n, i) { st.setProperty(n, arrivee._heiseiOrigine[i]); });
    };
    // Un glissement déjà en cours sur cette arrivée est tué, et son origine remise avant de repartir.
    if (gsap.getTweensOf(arrivee, true).length) {
      gsap.killTweensOf(arrivee);
      remettre();
    }
    var lire = function (el, n) { return parseFloat(el.style.getPropertyValue(n)); };
    var d = { x: lire(depart, '--lx'), y: lire(depart, '--ly'), w: lire(depart, '--lw'), h: lire(depart, '--lh') };
    var a = { x: lire(arrivee, '--lx'), y: lire(arrivee, '--ly'), w: lire(arrivee, '--lw'), h: lire(arrivee, '--lh') };
    var rd = depart.getBoundingClientRect();
    var ra = arrivee.getBoundingClientRect();
    var dx = rd.left - ra.left;
    var dy = rd.top - ra.top;
    return gsap.fromTo(arrivee,
      { '--lx': (d.x + dx) + 'px', '--ly': (d.y + dy) + 'px', '--lw': d.w + 'px', '--lh': d.h + 'px' },
      { '--lx': a.x + 'px', '--ly': a.y + 'px', '--lw': a.w + 'px', '--lh': a.h + 'px',
        duration: duree, ease: 'power2.inOut', onComplete: remettre });
  };

  window.Heisei = H;
  H.boot();
})();
