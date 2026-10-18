/*
 * screen.js : animation de l'écran maitresse (console de supervision réseau).
 * Dépend de window.Heisei (system/heisei.js) et de GSAP. Aucun élément n'est trouvé autrement que par [data-anim~="jeton"].
 *
 * Contenu : horloge, compteurs, jauges, graphes IN/OUT et journal qui vivent (cycle de 5 s) ; l'événement ND-011
 * (alerte qui se résout puis se relève) ; le choix d'un nœud au clic (liste ou topologie).
 */
(function () {
  'use strict';

  const H = window.Heisei;
  if (!H) return;
  const OK = H.ok;

  // ------------------------------------------------------------------ classes du kit utilisées pour changer d'aspect
  const C = {
    texte: 'k-phosphore-texte',        // texte phosphore (vert pâle)
    texteAlerte: 'k-alerte-texte',     // texte orange sodium
    puce: 'k-phosphore-segment',       // puce de la liste, segment allumé d'une jauge
    puceAlerte: 'k-alerte-puce',       // puce orange de la liste
    segment: 'k-phosphore-segment',    // case allumée
    segmentAlerte: 'k-alerte-segment', // case allumée orange, segment orange de la liaison
    segmentEteint: 'k-phosphore-segment-eteint', // case éteinte
    trait: 'k-phosphore-trait',        // trait de liaison vert
    selection: 'k-phosphore-selection' // aplat clair et texte sombre de la sélection
  };

  // ------------------------------------------------------------------ rythmes et mesures (secondes, sauf mention)
  const CYCLE = 5;                       // cycle de mesure
  const LOG_MIN = 7, LOG_MAX = 11;       // intervalle entre deux lignes du journal
  const EVT_PREMIER = 20, EVT_PERIODE = 60; // événement ND-011
  const PALIERS = [1.4, 3.4, 5.4, 7.4];  // instants des 4 valeurs de latence (le dernier + BASCULE = 8 s)
  const BASCULE = 0.6;                   // passage orange <-> vert
  const DIP = 0.15;                      // opacité au creux de la bascule
  const GLISSE = 0.5;                    // glissement d'un pas des courbes
  const BARRE = 0.3;                     // déplacement des barres de sélection
  const MORPH = 0.5;                     // passage des panneaux aux valeurs d'un nœud
  const PKT_AMP = 0.04, RETR_AMP = 2, SESS_AMP = 3; // amplitudes autour de la valeur de repos
  const DERIVE_MAX = 2;                  // écart maximal d'une jauge à son repos, en cases
  const LAT_PALIERS_RESOLUTION = [83, 68, 53, 7];
  const LAT_PALIERS_RELEVEMENT = [53, 68, 83, 98];
  const TEMP_NORMAL = 64;                // TEMP-5F hors alerte (%)
  const ALERT_X = 1.5;                   // niveau des courbes de ND-011 en alerte, par rapport à son profil
  const PROFIL = { cpu: [6, 64], mem: [22, 84], temp: [32, 72], loss: [1, 2], inN: [10, 55], outN: [5, 40] };
  const AR = 0.55, BURST_P = 0.04, BURST_MIN = 8, BURST_MAX = 20, BURST_DECAY = 0.8; // forme des courbes

  const q = H.q, qa = H.qa;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (s) => parseFloat(s);
  const poser = (el, vars) => { if (OK) window.gsap.set(el, vars); };

  const setTexte = (el, cls) => { el.classList.remove(C.texte, C.texteAlerte, C.selection); el.classList.add(cls); };

  // ------------------------------------------------------------------ éléments
  const rows = {};
  qa('ligne').forEach((row) => {
    rows[row.dataset.id] = { row, puce: q('n-puce', row), code: q('n-code', row), nom: q('n-nom', row), lat: q('n-lat', row) };
  });
  const IDS = Object.keys(rows).sort();
  const boxes = {};
  qa('b-code').forEach((e) => { boxes[e.dataset.id] = { code: e }; });
  qa('b-nom').forEach((e) => { boxes[e.dataset.id].nom = e; });
  const rects = {};   // rectangle de chaque boîte de la topologie (lu sur sa zone de clic)
  // Zones de clic des 14 boîtes de la topologie : elles font choisir le nœud par sa ligne de la liste.
  const zones = qa('clic');
  zones.forEach((z) => {
    rects[z.dataset.id] = { x: num(z.style.left), y: num(z.style.top), w: num(z.style.width), h: num(z.style.height) };
  });
  const barreBoite = q('sel-boite');

  // ------------------------------------------------------------------ état
  let sel = 'ND-004';       // nœud choisi
  let alertOn = true;       // l'alerte ND-011 est levée au repos
  let lat11 = 98;           // latence de ND-011 (liste, bar, jauge, journal)

  // ------------------------------------------------------------------ jauges
  const fmtPct = (v) => Math.round(v) + '%';
  const fmtMs = (v) => H.pad(Math.round(v), 2) + 'ms';
  const fmtLoss = (v) => v.toFixed(2) + '%';
  const fmtLink = (v) => Math.round(v) + '/14';

  function Gauge(nom, fmt, o) {
    this.nom = nom;
    this.cells = qa('jauge-' + nom);
    this.part = q('jauge-' + nom + '-p');
    this.val = q('val-' + nom);
    this.fmt = fmt;
    this.deadText = o && o.deadText;
    this.max = this.cells.length;
    this.rng = H.rng('jauge-' + nom);
    const lit = this.cells.filter((c) => c.classList.contains(C.segment) || c.classList.contains(C.segmentAlerte));
    this.n = lit.length;
    this.n0 = lit.length;
    this.alert = this.cells[0].classList.contains(C.segmentAlerte);
    this.base = num(this.val.textContent);
    this.v = this.base;
    this.partMin = lit.length;       // le morceau de case est allumé dès que la jauge atteint son repos
    this.perCase = this.base / this.n0;
    this.off = 0;
    this.dead = false;
    this.fixed = false;
    this.rest = { n0: this.n0, base: this.base, alert: this.alert };
  }

  const G = {
    cpu: new Gauge('cpu', fmtPct),
    mem: new Gauge('mem', fmtPct),
    lat: new Gauge('lat', fmtMs, { deadText: '--' }),
    loss: new Gauge('loss', fmtLoss),
    temp: new Gauge('temp', fmtPct)
  };
  const GA = [G.cpu, G.mem, G.lat, G.loss, G.temp];
  const LINK = new Gauge('link', fmtLink);
  G.temp.fixed = true;

  function draw(g, n, v, ecrire, mort) {
    n = Math.round(n);
    const on = g.alert ? C.segmentAlerte : C.segment;
    const etranger = g.alert ? C.segment : C.segmentAlerte;
    g.cells.forEach((c) => { if (c.classList.contains(etranger)) c.classList.remove(etranger); });
    H.lit(g.cells, n, on, C.segmentEteint);
    if (g.part) H.lit([g.part], n >= g.partMin ? 1 : 0, C.segment, C.segmentEteint);
    const t = (mort === undefined ? g.dead : mort) && g.deadText ? g.deadText : g.fmt(v);
    if (ecrire) H.write(g.val, t);
    else if (g.val.textContent !== t) g.val.textContent = t;
    // Le meter suit ce qui est affiché : valuetext = texte de la valeur, valuenow = cases allumées.
    const meter = g.cells[0] && g.cells[0].closest('[role="meter"]');
    if (meter) {
      meter.setAttribute('aria-valuenow', String(n));
      meter.setAttribute('aria-valuetext', g.val.textContent);
    }
    g.n = n;
    g.v = v;
  }

  // Une case au plus par tick, écart maximal DERIVE_MAX autour du repos du nœud.
  function derive(g) {
    if (g.dead || g.fixed) return;
    const off = clamp(g.off + g.rng.int(-1, 1), -DERIVE_MAX, DERIVE_MAX);
    const n = clamp(g.n0 + off, 1, g.max);
    g.off = n - g.n0;
    // La latence reste celle de la liste (tous les nœuds, ND-004 compris) : seules les cases bougent.
    const v = g === G.lat ? g.base : g.base * n / g.n0;
    draw(g, n, v, true);
  }

  // ------------------------------------------------------------------ profil d'un nœud
  const profils = {};
  function profil(id) {
    if (!profils[id]) {
      const r = H.rng(id);
      profils[id] = {
        cpu: r.int(PROFIL.cpu[0], PROFIL.cpu[1]), mem: r.int(PROFIL.mem[0], PROFIL.mem[1]),
        temp: r.int(PROFIL.temp[0], PROFIL.temp[1]), loss: r.int(PROFIL.loss[0], PROFIL.loss[1]),
        inN: r.int(PROFIL.inN[0], PROFIL.inN[1]), outN: r.int(PROFIL.outN[0], PROFIL.outN[1])
      };
    }
    return profils[id];
  }

  const latDe = (id) => parseInt(rows[id].lat.textContent, 10);

  // Cibles des cinq jauges pour le nœud id (n0 : cases allumées, base : valeur affichée à n0).
  function cibles(id) {
    const p = profil(id);
    const mort = isNaN(latDe(id));
    const par = (g, valeur) => ({ n0: clamp(Math.round(valeur / g.perCase), 1, g.max), base: valeur });
    const T = {};
    if (id === 'ND-004') {
      T.cpu = { n0: G.cpu.rest.n0, base: G.cpu.rest.base };
      T.mem = { n0: G.mem.rest.n0, base: G.mem.rest.base };
      T.loss = { n0: G.loss.rest.n0, base: G.loss.rest.base };
    } else {
      T.cpu = par(G.cpu, p.cpu);
      T.mem = par(G.mem, p.mem);
      T.loss = { n0: p.loss, base: p.loss * G.loss.perCase };
    }
    const L = mort ? 0 : latDe(id);
    const n = Math.ceil(L / G.lat.perCase);
    T.lat = { n0: clamp(n, 1, G.lat.max), base: L, fixed: n >= G.lat.max, alert: id === 'ND-011' && alertOn };
    if (id === 'ND-004' || id === 'ND-011') {
      T.temp = alertOn
        ? { n0: G.temp.rest.n0, base: G.temp.rest.base, alert: true }
        : { n0: clamp(Math.round(TEMP_NORMAL / G.temp.perCase), 1, G.temp.max), base: TEMP_NORMAL };
    } else {
      T.temp = par(G.temp, p.temp);
    }
    if (mort) GA.forEach((g) => { T[g.nom] = { n0: 1, base: 0, dead: true }; });
    return T;
  }

  // ------------------------------------------------------------------ courbes
  function Chart(nom) {
    this.nom = nom;
    this.poly = q('courbe-' + nom);
    this.area = q('aire-' + nom);
    const pts = this.poly.getAttribute('points').trim().split(/\s+/).map((s) => s.split(',').map(num));
    this.xs = pts.map((p) => p[0]);
    this.ys = pts.map((p) => p[1]);
    this.rest = this.ys.slice();
    const r = this.area.getBoundingClientRect();
    this.left = r.left; this.top = r.top; this.h = r.height; this.bottom = r.bottom;
    this.lo = this.top + 1.5; this.hi = this.bottom - 1.5;
    const tri = this.ys.slice().sort((a, b) => a - b);
    this.restBase = tri[Math.floor(tri.length / 2)];
    let d = 0;
    for (let i = 1; i < this.ys.length; i++) d += Math.abs(this.ys[i] - this.ys[i - 1]);
    this.restNoise = d / (this.ys.length - 1);
    this.base = this.restBase;
    this.noise = this.restNoise;
    this.dead = false;
    this.rng = H.rng(nom);
    this.st = { burst: 0 };
    this.tw = null;
    this.cible = this.ys;
  }
  const CH = { in: new Chart('in'), out: new Chart('out') };
  const CHA = [CH.in, CH.out];

  const f2 = (v) => String(Math.round(v * 100) / 100);
  function tracer(c, ys) {
    c.poly.setAttribute('points', ys.map((y, i) => f2(c.xs[i]) + ',' + f2(y)).join(' '));
    const bas = f2(c.h);
    const poly = 'polygon(' + [f2(c.xs[0] - c.left) + 'px ' + bas + 'px']
      .concat(ys.map((y, i) => f2(c.xs[i] - c.left) + 'px ' + f2(y - c.top) + 'px'))
      .concat([f2(c.xs[ys.length - 1] - c.left) + 'px ' + bas + 'px']).join(', ') + ')';
    poser(c.area, { clipPath: poly });
  }

  function finirCourbe(c) {
    if (c.tw) {
      c.tw.kill();
      c.tw = null;
      c.ys = c.cible;
      tracer(c, c.ys);
    }
  }

  // Fait glisser la courbe vers le tableau `vers` (même nombre de points) en `duree` s.
  function glisser(c, vers, duree) {
    finirCourbe(c);
    const de = c.ys;
    c.cible = vers;
    if (!OK || duree <= 0) {
      c.ys = vers;
      tracer(c, vers);
      return;
    }
    const o = { p: 0 };
    c.tw = window.gsap.to(o, {
      p: 1, duration: duree, ease: 'power1.out',
      onUpdate: () => tracer(c, de.map((y, i) => y + o.p * (vers[i] - y))),
      onComplete: () => { c.tw = null; c.ys = vers; tracer(c, vers); }
    });
  }

  function pasY(c, r, prev, st) {
    if (st.burst < 1 && r() < BURST_P) st.burst = r.int(BURST_MIN, BURST_MAX) * c.h / 100;
    const y = c.base + AR * (prev - c.base) + r.around(0, c.noise) - st.burst;
    st.burst *= BURST_DECAY;
    return clamp(y, c.lo, c.hi);
  }

  // Série complète pour le nœud id : { ys, base, noise, dead }.
  function serie(c, id) {
    if (id === 'ND-004') return { ys: c.rest.slice(), base: c.restBase, noise: c.restNoise, dead: false };
    if (isNaN(latDe(id))) {
      const plat = c.hi - 2;
      return { ys: c.rest.map(() => plat), base: plat, noise: 0, dead: true };
    }
    const p = profil(id);
    const niveau = (c.nom === 'in' ? p.inN : p.outN) * (id === 'ND-011' && alertOn ? ALERT_X : 1);
    const base = clamp(c.bottom - niveau / 100 * c.h, c.lo + 4, c.hi - 1.5);
    const r = H.rng(id + '-' + c.nom);
    const sim = { base, noise: c.restNoise, h: c.h, lo: c.lo, hi: c.hi };
    const st = { burst: 0 };
    const ys = [];
    let y = base;
    for (let i = 0; i < c.rest.length; i++) { y = pasY(sim, r, y, st); ys.push(y); }
    return { ys, base, noise: c.restNoise, dead: false };
  }

  function tickCourbe(c) {
    finirCourbe(c);
    if (c.dead) return;
    const vers = c.ys.slice(1);
    vers.push(pasY(c, c.rng, c.ys[c.ys.length - 1], c.st));
    glisser(c, vers, H.dur(GLISSE));
  }

  // ------------------------------------------------------------------ panneaux d'un nœud
  let morph = null;

  function appliquerJauges() {
    GA.forEach((g) => {
      const t = g.tgt;
      g.n0 = t.n0; g.base = t.base; g.dead = !!t.dead; g.off = 0;
      g.fixed = g.nom === 'temp' || !!t.fixed;
      draw(g, g.to.n, g.to.v, false, g.dead);
    });
  }

  function finirMorph() {
    if (morph) {
      morph.kill();
      morph = null;
      appliquerJauges();
    }
  }

  // Jauges et courbes passent aux valeurs du nœud id en `duree` s.
  function montrer(id, duree) {
    finirMorph();
    const T = cibles(id);
    GA.forEach((g) => {
      const t = T[g.nom];
      g.tgt = t;
      g.from = { n: g.n, v: g.v };
      g.to = { n: t.dead ? 0 : t.n0, v: t.dead ? 0 : t.base };
      g.alert = !!t.alert;
    });
    CHA.forEach((c) => {
      const s = serie(c, id);
      c.base = s.base; c.noise = s.noise; c.dead = s.dead; c.st = { burst: 0 };
      glisser(c, s.ys, duree);
    });
    if (!OK || duree <= 0) {
      appliquerJauges();
      return;
    }
    const o = { p: 0 };
    morph = window.gsap.to(o, {
      p: 1, duration: duree, ease: 'power1.out',
      onUpdate: () => GA.forEach((g) => draw(g, g.from.n + (g.to.n - g.from.n) * o.p, g.from.v + (g.to.v - g.from.v) * o.p, false, false)),
      onComplete: () => { morph = null; appliquerJauges(); }
    });
  }

  // ------------------------------------------------------------------ journal
  const logEls = [];
  const LOG = [];
  for (let i = 1; i <= 9; i++) {
    const els = qa('log' + i);
    logEls.push(els);
    LOG.push({ alert: els[0].classList.contains(C.texteAlerte), h: els[0].textContent, nd: els[1].textContent, msg: els[2].textContent });
  }

  function peindreLigne(i, anime) {
    const e = LOG[i];
    [e.h, e.nd, e.msg].forEach((t, k) => {
      const el = logEls[i][k];
      setTexte(el, e.alert ? C.texteAlerte : C.texte);
      if (anime) H.write(el, t);
      else if (el.textContent !== t) el.textContent = t;
    });
  }

  function pousserLigne(alerte, nd, msg) {
    LOG.unshift({ alert: alerte, h: H.time.hms(), nd, msg });
    LOG.pop();
    for (let i = 0; i < LOG.length; i++) peindreLigne(i, i === 0);
  }

  const logRng = H.rng('log');
  const pingNodes = IDS.filter((id) => id !== 'ND-011' && id !== 'ND-013');
  const GENRES = ['ping', 'ping', 'ping', 'mail', 'snmp', 'backup', 'tape'];
  let snmp = 0;
  LOG.forEach((e) => { const m = /CYCLE (\d+)/.exec(e.msg); if (m) snmp = Math.max(snmp, parseInt(m[1], 10)); });
  let sauvegarde = 0;

  function nouvelleLigne() {
    const genre = logRng.pick(GENRES);
    if (genre === 'ping') {
      const nd = logRng.pick(pingNodes);
      pousserLigne(false, nd, 'PING OK ' + rows[nd].lat.textContent);
    } else if (genre === 'mail') {
      pousserLigne(false, 'ND-005', 'QUEUE 000 MAIL OK');
    } else if (genre === 'snmp') {
      snmp++;
      pousserLigne(false, 'SYS', 'SNMP POLL CYCLE ' + H.pad(snmp, 4) + ' DONE');
    } else if (genre === 'backup') {
      if (sauvegarde >= 90) sauvegarde = 0;
      sauvegarde = Math.min(99, sauvegarde + logRng.int(6, 14));
      pousserLigne(false, 'ND-007', 'BACKUP PROGRESS ' + H.pad(sauvegarde, 2) + '%');
    } else {
      pousserLigne(false, 'ND-014', 'TAPE READY');
    }
  }

  function chaineJournal() {
    H.after(logRng.int(LOG_MIN, LOG_MAX), () => { nouvelleLigne(); chaineJournal(); });
  }

  // ------------------------------------------------------------------ compteurs
  const cPkt = q('pkt'), cErr = q('err'), cRetr = q('retr'), cSess = q('sess');
  const repos = { pkt: num(cPkt.textContent), retr: num(cRetr.textContent), sess: num(cSess.textContent) };
  const rPkt = H.rng('pkt'), rRetr = H.rng('retr'), rSess = H.rng('sess');
  const etatErr = q('etat-err');

  // Au premier tick, la jauge de latence passe à la valeur de la liste (avant, elle garde celle du HTML).
  let latListe = false;

  function tick() {
    finirMorph();
    H.write(cPkt, H.pad(Math.round(repos.pkt * (1 + rPkt.around(0, PKT_AMP))), 5));
    H.write(cRetr, H.pad(repos.retr + rRetr.int(-RETR_AMP, RETR_AMP), 3));
    H.write(cSess, H.pad(repos.sess + rSess.int(-SESS_AMP, SESS_AMP), 4));
    if (!latListe) {
      latListe = true;
      G.lat.base = isNaN(latDe(sel)) ? 0 : latDe(sel);
    }
    GA.forEach(derive);
    CHA.forEach(tickCourbe);
  }

  // ------------------------------------------------------------------ événement ND-011
  const r11 = rows['ND-011'];
  const liens = qa('lien11');
  const etiquette = q('lien11-lab');
  const banJp = [q('ban-jp'), q('ban-alert')];
  const banND = q('ban-nd'), banMsg = q('ban-msg');
  const banDecalage = num(banND.style.left) - num(banJp[0].style.left);
  const contour = q('contour11'), contourVert = qa('contour11-vert');
  const valLink = LINK;
  let marque = null;   // nœud dont les textes de boîte portent la sélection

  const classeBoite = (id) => (id === 'ND-011' && alertOn ? C.texteAlerte : C.texte);

  function ecrireLat11(v, direct) {
    lat11 = v;
    const t = H.pad(v, 2) + 'ms';
    const poser2 = (el) => { if (direct) el.textContent = t; else H.write(el, t); };
    poser2(r11.lat);
    if (sel === 'ND-011') {
      const T = cibles('ND-011');
      const g = G.lat;
      g.tgt = T.lat;
      g.to = { n: T.lat.n0, v: T.lat.base };
      g.n0 = T.lat.n0; g.base = T.lat.base; g.fixed = !!T.lat.fixed; g.off = 0;
      draw(g, g.n0, g.base, true, false);
    }
  }

  // Tout ce qui est orange dans l'état alerte passe au vert (normal vrai) ou revient à l'orange (normal faux).
  function echanger(normal) {
    alertOn = !normal;
    const ct = alertOn ? C.texteAlerte : C.texte;
    [r11.code, r11.nom, r11.lat].forEach((e) => setTexte(e, ct));
    r11.puce.classList.remove(C.puce, C.puceAlerte);
    r11.puce.classList.add(alertOn ? C.puceAlerte : C.puce);
    if (marque !== 'ND-011') [boxes['ND-011'].code, boxes['ND-011'].nom].forEach((e) => setTexte(e, ct));
    liens.forEach((e) => { e.classList.remove(C.segmentAlerte, C.trait); e.classList.add(alertOn ? C.segmentAlerte : C.trait); });
    setTexte(etiquette, ct);
    setTexte(banND, ct);
    setTexte(banMsg, ct);
    banMsg.textContent = alertOn ? 'LATENCY HIGH' : 'LATENCY NORMAL';
    poser([banND, banMsg], { x: alertOn ? 0 : -banDecalage });
    H.write(cErr, alertOn ? '003' : '002');
    H.write(etatErr, alertOn ? '1' : '0');
    draw(LINK, alertOn ? 11 : 13, alertOn ? 13 : 14, true);
    montrer(sel, H.dur(MORPH));
    if (alertOn) pousserLigne(true, 'ND-011', 'LATENCY ' + H.pad(lat11, 2) + 'ms THRESHOLD 80ms');
    else pousserLigne(false, 'ND-011', 'LATENCY ' + H.pad(lat11, 2) + 'ms NORMAL');
  }

  function basculer(normal) {
    if (H.reduced || !OK) {
      echanger(normal);
      poser(banJp, normal ? { opacity: 0 } : { clearProps: 'opacity' });
      poser(contour, normal ? { opacity: 0 } : { clearProps: 'opacity' });
      poser(contourVert, { opacity: normal ? 1 : 0 });
      return;
    }
    const gsap = window.gsap;
    const creux = [r11.puce, r11.code, r11.nom, r11.lat, etiquette, banND, banMsg].concat(liens);
    if (marque !== 'ND-011') creux.push(boxes['ND-011'].code, boxes['ND-011'].nom);
    if (sel === 'ND-004' || sel === 'ND-011') G.temp.cells.forEach((c) => creux.push(c));
    if (sel === 'ND-011') G.lat.cells.forEach((c) => creux.push(c));
    const d = BASCULE / 2;
    const tl = gsap.timeline();
    tl.to(creux, { opacity: DIP, duration: d, ease: 'power1.out' }, 0);
    tl.call(() => echanger(normal), null, d);
    tl.to(creux, { opacity: 1, duration: d, ease: 'power1.out', clearProps: 'opacity' }, d);
    if (normal) {
      tl.to(banJp, { opacity: 0, duration: BASCULE, ease: 'power1.out' }, 0);
      tl.to(contour, { opacity: 0, duration: BASCULE, ease: 'power1.out' }, 0);
      tl.to(contourVert, { opacity: 1, duration: BASCULE, ease: 'power1.out' }, 0);
    } else {
      tl.to(banJp, { opacity: 1, duration: BASCULE, ease: 'power1.out', clearProps: 'opacity' }, 0);
      tl.to(contour, { opacity: 1, duration: BASCULE, ease: 'power1.out', clearProps: 'opacity' }, 0);
      tl.to(contourVert, { opacity: 0, duration: BASCULE, ease: 'power1.out' }, 0);
    }
  }

  function evenement(n) {
    const resolution = n % 2 === 0;
    const paliers = resolution ? LAT_PALIERS_RESOLUTION : LAT_PALIERS_RELEVEMENT;
    PALIERS.forEach((t, i) => {
      H.after(t, () => {
        const dernier = i === PALIERS.length - 1;
        ecrireLat11(paliers[i], dernier);
        if (dernier) basculer(resolution);
      });
    });
  }

  // ------------------------------------------------------------------ choix d'un nœud
  let tweenBoite = null, cibleBoite = null, boiteVisible = false;

  // La barre de sélection de la liste glisse de la ligne qui perd la sélection à celle qui la prend (barre de HEAD).
  function deplacerListe(avant, id) {
    H.glisseBarre(rows[avant].row, rows[id].row, BARRE);
  }

  function finBoite(id) {
    const b = boxes[id];
    setTexte(b.code, C.selection);
    setTexte(b.nom, C.selection);
    marque = id;
  }

  function deplacerBoite(avant, id) {
    if (tweenBoite) {
      tweenBoite.kill();
      tweenBoite = null;
      finBoite(cibleBoite);
    }
    cibleBoite = id;
    if (marque) {
      const b = boxes[marque];
      setTexte(b.code, classeBoite(marque));
      setTexte(b.nom, classeBoite(marque));
      marque = null;
    }
    const r = rects[id];
    const place = { x: r.x, y: r.y, scaleX: r.w, scaleY: r.h };
    if (!OK) return;
    if (H.reduced) {
      poser(barreBoite, Object.assign({ transformOrigin: '0 0', opacity: 1 }, place));
      boiteVisible = true;
      finBoite(id);
      return;
    }
    const gsap = window.gsap;
    if (!boiteVisible) {
      gsap.set(barreBoite, Object.assign({ transformOrigin: '0 0' }, place));
      boiteVisible = true;
      tweenBoite = gsap.to(barreBoite, { opacity: 1, duration: BARRE, ease: 'power1.out', onComplete: () => { tweenBoite = null; finBoite(id); } });
    } else {
      tweenBoite = gsap.to(barreBoite, Object.assign({ duration: BARRE, ease: 'power1.out', onComplete: () => { tweenBoite = null; finBoite(id); } }, place));
    }
  }

  function choisir(id) {
    if (id === sel) return;
    const avant = sel;
    sel = id;
    deplacerListe(avant, id);
    deplacerBoite(avant, id);
    montrer(id, H.dur(MORPH));
    pousserLigne(false, id, 'SELECTED BY OPERATOR');
  }

  // ------------------------------------------------------------------ démarrage
  H.onReady(() => {
    H.clock(q('clock'));
    H.every(CYCLE, tick);
    chaineJournal();
    // Le choix d'un nœud passe par aria-selected : clic ou clavier sur la liste, clic sur la boîte de la topologie.
    H.suivreSelection(IDS.map((id) => rows[id].row), (el, i) => choisir(IDS[i]));
    zones.forEach((z) => z.addEventListener('click', () => rows[z.dataset.id].row.click()));
    if (!OK) return;
    H.loop(EVT_PREMIER, EVT_PERIODE, evenement);
  });
})();
