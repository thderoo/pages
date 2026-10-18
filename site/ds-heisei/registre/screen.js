/*
 * Écran registre : animation. Dépend de GSAP (CDN) et de system/heisei.js (window.Heisei).
 * Les éléments se trouvent par jeton data-anim (Heisei.q / Heisei.qa) ; l'aspect change par classList avec les classes
 * du kit listées dans CL. Les valeurs inventées viennent des tables en tête de fichier et de Heisei.rng.
 *
 * Ce que l'écran fait :
 *   - allumage : data-anim="glass" (système) ;
 *   - curseurs de la recherche et du champ GRADE : Heisei.cursor ;
 *   - événement (période 60 s, premier à +20 s) : une demande de E-0042 est validée (verrou, statut, cachet, badge,
 *     LAST EDIT) ; à partir du 2e, une nouvelle demande arrive en tête de HISTORY puis est validée 8 s plus tard ;
 *   - sélection (souris ou clavier, même chemin : aria-selected) d'une des 12 lignes : la fiche suit le salarié ;
 *     d'un des 6 onglets : la fiche change de jeu ; d'une des 4 options GRADE : le grade du salarié change.
 */
(function () {
  'use strict';

  var H = window.Heisei;
  if (!H) return;
  var gsap = window.gsap;

  // ------------------------------------------------------------------ rythme (secondes)
  var PREMIER = 20;        // premier événement, après ready
  var PERIODE = 60;        // période des événements
  var DELAI_VALID = 8;     // arrivée d'une demande -> début de sa validation
  var T_STATUT = 3;        // début de validation -> statut approuvé
  var T_LOCK_FIN = 6;      // début de validation -> verrou relâché
  var DUREE_RECOLOR = 0.6; // fondu de couleur d'une ligne ou du badge validés
  var DUREE_CACHET = 0.6;  // cachet PENDING qui s'efface ou revient
  var REMANENCE = 0.45;    // opacité de départ d'un texte qui change en même temps que sa couleur (comme Heisei.write)
  var DUREE_BARRE = 0.3;   // glissement de la barre de sélection et fondu des textes de ligne
  var DUREE_ONGLET = 0.3;  // fondu d'onglet et de champs de la fiche

  // ------------------------------------------------------------------ classes du kit (jeton, retirée, ajoutée)
  // Sens « allumé » : la classe retirée est celle du repos, la classe ajoutée celle de l'état actif.
  // Le texte et la couleur de la ligne choisie viennent de aria-selected (heisei.css) ; seule la marque est basculée ici.
  var CL = {
    rowMark: { token: 'r-mark', retire: 'k-marque-carre-clair', ajoute: 'k-marque-contour', geometrie: 'reg-recherche-marque-sel' },
    flag: { token: 'c-f0..c-f5', retire: '', ajoute: 'k-formulaire-case-cochee' },
    alert: { token: 'hr0 / v-badge', retire: 'k-alerte-texte', ajoute: 'k-phosphore-texte' }  // validé : orange -> phosphore
  };

  var APPR = '承認 APPROVED';
  var PEND = '保留 PENDING';

  // ------------------------------------------------------------------ données inventées
  var DEPTS = { GA: 'GENERAL AFFAIRS', SL: 'SALES', EN: 'ENGINEERING', FN: 'FINANCE', HR: 'HUMAN RESOURCES' };
  var SECTIONS = { GA: 'ADMIN SECTION', SL: 'DOMESTIC SALES', EN: 'SYSTEMS DEVELOPMENT', FN: 'ACCOUNTING SECTION', HR: 'PERSONNEL SECTION' };

  // Demandes tirées à chaque arrivée.
  var EVENTS = ['BADGE RENEWAL REQUEST', 'ADDRESS CHANGE REQUEST', 'DEPT TRANSFER REQUEST', 'TRAINING RECORD REQUEST'];

  // Événements d'historique des autres salariés (8 types, mélangés par salarié).
  var PAST = ['DEPT TRANSFER TO {svc}', 'GRADE {g1} TO {g2}', 'ANNUAL REVIEW 94', 'ADDRESS CHANGE', 'HEALTH CHECK RECORDED',
    'TRAINING JOB-SAFETY', 'ANNUAL REVIEW 93', 'BADGE RENEWED'];

  var QUALS = ['FORKLIFT', 'CRANE OPERATOR', 'FIRE CONTROL', 'FIRST AID', 'SAFETY OFFICER', 'ELECTRICIAN', 'BOOKKEEPING',
    'HAZMAT', 'PC OPERATOR', 'WELDING'];
  var ISSUERS = ['TOKYO LABOR BUREAU', 'FIRE DEPARTMENT', 'RED CROSS TOKYO'];
  var GIVEN = ['YUKO', 'AYA', 'RIE', 'MAKI', 'EMI', 'SAKI', 'NANA'];
  var PLANS = ['HEALTH PLAN A', 'HEALTH PLAN B', 'UNION PLAN'];

  // code, service, nom, n° complet, naissance, sexe, sang, poste, grade, poste téléphonique, adresse, responsable,
  // cases FLAGS (commute, dorm, union, night, health, security), demande en attente en tête d'historique, badge.
  var RAW = [
    ['E-0042', 'GA', 'TANAKA HIROSHI', 'E-0042-17', 'S45.04.12', 'M', 'A', 'SECTION CHIEF', 4, '2217', 'SUGINAMI-KU TOKYO 166-0004', 'E-0007-03 MORI K.', [1, 0, 1, 0, 1, 1], true, 'H07.11.30'],
    ['E-0043', 'SL', 'TANAKA MIDORI', 'E-0043-05', 'S48.09.23', 'F', 'B', 'SENIOR CLERK', 3, '2218', 'NERIMA-KU TOKYO 176-0001', 'E-0011-05 ONO S.', [1, 1, 0, 0, 1, 1], true, 'H07.12.15'],
    ['E-0117', 'EN', 'TAKAHASHI KEN', 'E-0117-11', 'S40.01.30', 'M', 'O', 'SR ENGINEER', 5, '3104', 'SETAGAYA-KU TOKYO 154-0017', 'E-0013-02 ITO M.', [0, 0, 1, 1, 1, 1], false, 'H08.03.31'],
    ['E-0118', 'GA', 'TANABE SATOSHI', 'E-0118-03', 'S49.06.02', 'M', 'A', 'CLERK', 2, '2230', 'ITABASHI-KU TOKYO 173-0004', 'E-0007-03 MORI K.', [1, 1, 0, 0, 1, 0], false, 'H08.01.20'],
    ['E-0119', 'FN', 'TANIGUCHI RYO', 'E-0119-08', 'S43.11.17', 'F', 'B', 'ACCOUNTANT', 4, '4120', 'NAKANO-KU TOKYO 164-0001', 'E-0021-04 KATO H.', [1, 0, 1, 1, 1, 1], false, 'H08.06.30'],
    ['E-0120', 'SL', 'TAKADA YUKIO', 'E-0120-21', 'S38.03.08', 'M', 'O', 'TEAM LEADER', 5, '5018', 'TOSHIMA-KU TOKYO 171-0014', 'E-0011-05 ONO S.', [0, 0, 1, 0, 1, 1], false, 'H08.09.15'],
    ['E-0121', 'HR', 'TANAKA TAKESHI', 'E-0121-14', 'S50.12.25', 'M', 'A', 'ASSISTANT', 2, '1102', 'ARAKAWA-KU TOKYO 116-0002', 'E-0003-01 SAITO Y.', [1, 0, 0, 0, 1, 1], true, 'H07.11.20'],
    ['E-0122', 'EN', 'TAKEDA NAOKO', 'E-0122-09', 'S46.05.19', 'F', 'A', 'ENGINEER', 3, '3111', 'SUMIDA-KU TOKYO 130-0001', 'E-0013-02 ITO M.', [1, 1, 1, 0, 1, 0], false, 'H08.02.28'],
    ['E-0123', 'GA', 'TANIMOTO JUN', 'E-0123-02', 'S50.08.04', 'M', 'B', 'CLERK', 1, '2241', 'KOTO-KU TOKYO 135-0001', 'E-0007-03 MORI K.', [0, 1, 0, 1, 1, 1], false, 'H08.04.10'],
    ['E-0124', 'FN', 'TAKAGI AKIRA', 'E-0124-16', 'S41.02.14', 'M', 'O', 'MANAGER', 6, '4101', 'ADACHI-KU TOKYO 120-0005', 'E-0021-04 KATO H.', [1, 0, 1, 0, 1, 1], false, 'H08.07.31'],
    ['E-0125', 'SL', 'TAMURA EMI', 'E-0125-07', 'S49.10.30', 'F', 'A', 'SALES REP', 3, '5030', 'EDOGAWA-KU TOKYO 132-0021', 'E-0011-05 ONO S.', [1, 0, 0, 1, 1, 0], false, 'H08.05.15'],
    ['E-0126', 'HR', 'TAKAYAMA OSAMU', 'E-0126-12', 'S44.07.07', 'M', 'B', 'DIRECTOR', 6, '1100', 'MEGURO-KU TOKYO 152-0004', 'E-0003-01 SAITO Y.', [1, 0, 1, 0, 1, 1], false, 'H08.08.31']
  ];

  // Historique de repos de E-0042 (copie du HTML) : date, code, événement, par, en attente.
  var HIST0 = [
    ['H07.10.28', 'CHG-0388', 'BADGE RENEWAL REQUEST', 'SATO-K', true],
    ['H07.10.02', 'CHG-0371', 'DEPT TRANSFER TO GA', 'MORI-K', false],
    ['H07.07.15', 'GHG-0342', 'GRADE G-3 TO G-4', 'MORI-K', false],
    ['H07.04.01', 'CHG-0310', 'ANNUAL REVIEW 94', 'HR-02', false],
    ['H06.12.20', 'CHG-0287', 'ADDRESS CHANGE', 'SATO-K', false],
    ['H06.09.05', 'CHG-0259', 'HEALTH CHECK RECORDED', 'CLINIC', false],
    ['H06.04.01', 'CHG-0211', 'ANNUAL REVIEW 93', 'HR-02', false],
    ['H05.11.11', 'CHG-0178', 'TRAINING JOB-SAFETY', 'HR-02', false]
  ];

  function pad(n, w) { return H.pad(n, w); }
  function fmtDate(ms) {
    var d = new Date(ms);
    return 'H' + pad(d.getUTCFullYear() - 1988, 2) + '.' + pad(d.getUTCMonth() + 1, 2) + '.' + pad(d.getUTCDate(), 2);
  }
  function rdate(r, y0, y1) {
    return 'H' + pad(r.int(y0, y1), 2) + '.' + pad(r.int(1, 12), 2) + '.' + pad(r.int(1, 28), 2);
  }
  function shuffle(tab, r) {
    var a = tab.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = r.int(0, i);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Historique inventé d'un salarié autre que E-0042 : 8 lignes décroissantes en date et en code.
  function genHist(p) {
    var r = H.rng('registre-hist-' + p.code);
    var ms = Date.UTC(1995, 9, 28) - r.int(0, 60) * 86400000;
    var n = r.int(520, 700);
    var types = shuffle(PAST, r);
    var rows = [];
    for (var i = 0; i < 8; i++) {
      var e, b, pend = false;
      if (i === 0 && p.pending) {
        e = 'BADGE RENEWAL REQUEST'; b = 'SATO-K'; pend = true;
      } else {
        e = types[i].replace('{svc}', p.svc).replace('{g1}', 'G-' + Math.max(1, p.grade - 1)).replace('{g2}', 'G-' + p.grade);
        b = /^HEALTH/.test(e) ? 'CLINIC' : /^(ANNUAL|TRAINING)/.test(e) ? 'HR-02' : r.pick(['MORI-K', 'SATO-K']);
      }
      rows.push([fmtDate(ms), 'CHG-' + pad(n, 4), e, b, pend]);
      ms -= r.int(25, 90) * 86400000;
      n -= r.int(10, 45);
    }
    return rows;
  }

  var P = RAW.map(function (a, i) {
    var p = {
      code: a[0], svc: a[1], name: a[2], emp: a[3], birth: a[4], sex: a[5], blood: a[6], pos: a[7], grade: a[8],
      ext: a[9], addr: a[10], mgr: a[11], flags: a[12], pending: a[13], exp: a[14], expAlert: a[13], lock: 'NONE'
    };
    p.num = parseInt(p.code.slice(2), 10);
    p.phone = '03-5550-' + pad(p.num + 100, 4);
    var r = H.rng('registre-p-' + p.code);
    var by = r.pick(['MORI-K', 'HR-02', 'SATO-K']);
    p.last = i === 0 ? 'H07.10.28 23:31 SATO-K' : fmtDate(Date.UTC(1995, 9, 1) + r.int(0, 26) * 86400000) + ' ' + pad(r.int(8, 22), 2) + ':' + pad(r.int(0, 59), 2) + ' ' + by;
    p.hist = i === 0 ? HIST0.map(function (x) { return x.slice(); }) : genHist(p);
    return p;
  });

  // ------------------------------------------------------------------ jeux de textes par onglet
  // spec(p) rend : titres des 4 groupes, champs {emplacement: [étiquette, valeur]}, 6 cases [étiquette, cochée], état du badge.
  // Un emplacement absent est caché (opacité). Limites en caractères = celles de l'emplacement de repos.
  function flagsOf(p, tab, n) {
    var r = H.rng('registre-flags-' + p.code + '-' + tab);
    var o = [];
    for (var i = 0; i < n; i++) o.push(r() < 0.6 ? 1 : 0);
    return o;
  }
  function hasEvent(p, re) {
    return p.hist.some(function (h) { return re.test(h[2]); }) ? 1 : 0;
  }

  var TABS = [
    { // BASIC : le repos
      spec: function (p) {
        return {
          titles: ['IDENTITY', 'POST', 'CONTACT', 'FLAGS'],
          slots: {
            nom: ['NAME', p.name], emp: ['EMP NO', p.emp], birth: ['BIRTH', p.birth], sex: ['SEX', p.sex], blood: ['BLOOD', p.blood],
            dept: ['DEPT', DEPTS[p.svc]], pos: ['POSITION', p.pos], grade: ['GRADE', 'G-' + p.grade],
            hired: ['HIRED'], status: ['STATUS'], contract: ['CONTRACT'],
            phone: ['PHONE', p.phone], ext: ['EXT', p.ext], addr: ['ADDRESS', p.addr], mgr: ['MANAGER', p.mgr],
            badge: ['BADGE EXPIRY', p.exp]
          },
          flags: [['COMMUTE ALLOWANCE', p.flags[0]], ['DORMITORY', p.flags[1]], ['UNION MEMBER', p.flags[2]],
            ['NIGHT SHIFT', p.flags[3]], ['HEALTH CHECK DONE', p.flags[4]], ['SECURITY BADGE', p.flags[5]]],
          badgeAlert: p.expAlert
        };
      }
    },
    { // EMPLOYMENT
      spec: function (p) {
        var r = H.rng('registre-emp-' + p.code);
        var hy = r.int(Math.max(1, parseInt(p.birth.slice(1, 3), 10) - 45), 6);
        var hired = 'H' + pad(hy, 2) + '.' + pad(r.int(1, 12), 2) + '.01';
        var kind = r.pick(['FULL-TIME', 'FULL-TIME', 'FULL-TIME', 'PART-TIME', 'CONTRACT']);
        var f = flagsOf(p, 'emp', 6);
        return {
          titles: ['CONTRACT', 'POST', 'STATUS', 'FLAGS'],
          slots: {
            nom: ['TYPE', kind], emp: ['HIRED', hired], birth: ['TERM', kind === 'CONTRACT' ? 'FIXED' : 'PERMANENT'],
            dept: ['DEPT', DEPTS[p.svc]], pos: ['POSITION', p.pos], grade: ['GRADE', 'G-' + p.grade],
            phone: ['STATE', 'ACTIVE'], ext: ['YEARS', pad(7 - hy, 2)], addr: ['SECTION', SECTIONS[p.svc]], mgr: ['MGR', p.mgr],
            badge: ['NEXT REVIEW', 'H08.04.01']
          },
          flags: [['ON PAYROLL', 1], ['PROBATION', 0], ['OVERTIME OK', f[2]], ['SHIFT WORK', f[3]], ['PENSION ENROLLED', 1], ['BONUS ELIGIBLE', f[5]]],
          badgeAlert: false
        };
      }
    },
    { // QUALIFICATIONS
      spec: function (p) {
        var r = H.rng('registre-qual-' + p.code);
        var q = shuffle(QUALS, r);
        var c2 = q.slice(2).filter(function (s) { return s.length <= 13; })[0];
        var f = flagsOf(p, 'qual', 6);
        return {
          titles: ['LICENSE', 'CERT', 'DATES', 'FLAGS'],
          slots: {
            nom: ['LICENSE', q[0]], emp: ['NO', 'Q-' + pad(p.num, 4) + '-' + pad(r.int(1, 19), 2)], birth: ['ISSUED', rdate(r, 1, 6)],
            dept: ['CERT 1', q[1]], pos: ['CERT 2', c2],
            phone: ['EXPIRES', rdate(r, 8, 11)], ext: ['COUNT', '03'], addr: ['ISSUER', r.pick(ISSUERS)], mgr: ['EXAMINER', p.mgr],
            badge: ['RENEWAL DUE', rdate(r, 8, 9)]
          },
          flags: [['FORKLIFT LICENSE', f[0]], ['CRANE', f[1]], ['FIRE WARDEN', f[2]], ['FIRST AID', f[3]], ['SAFETY OFFICER', f[4]], ['HAZMAT', f[5]]],
          badgeAlert: false
        };
      }
    },
    { // HISTORY : derniers changements, lus dans les données du salarié
      spec: function (p) {
        var h0 = p.hist[0];
        var h1 = p.hist[1];
        var ok = p.hist.filter(function (h) { return !h[4]; }).length;
        return {
          titles: ['LATEST', 'PREV', 'COUNTS', 'FLAGS'],
          slots: {
            nom: ['LATEST', h0[1]], emp: ['DATE', h0[0]], birth: ['STATUS', h0[4] ? 'PENDING' : 'APPROVED'],
            dept: ['CODE', h1[1]], pos: ['DATE', h1[0]],
            phone: ['APPROVED', pad(ok, 2)], ext: ['PEND', pad(8 - ok, 1)], addr: ['LAST EVENT', h0[2]], mgr: ['LAST BY', h0[3]],
            badge: ['LAST EDIT', p.last.slice(0, 9)]
          },
          flags: [['REQUEST PENDING', h0[4] ? 1 : 0], ['DEPT MOVE', hasEvent(p, /^DEPT/)], ['GRADE CHANGE', hasEvent(p, /^GRADE/)],
            ['ADDRESS', hasEvent(p, /^ADDRESS/)], ['HEALTH CHECK', hasEvent(p, /^HEALTH/)], ['TRAINING', hasEvent(p, /^TRAINING/)]],
          badgeAlert: false
        };
      }
    },
    { // FAMILY
      spec: function (p) {
        var r = H.rng('registre-fam-' + p.code);
        var spouse = r() < 0.75 ? p.name.split(' ')[0] + ' ' + r.pick(GIVEN) : 'NONE';
        var kids = r.int(0, 3);
        var f = flagsOf(p, 'fam', 6);
        return {
          titles: ['DEPEND', 'INSURANCE', 'COVER', 'FLAGS'],
          slots: {
            nom: ['SPOUSE', spouse], emp: ['CHILDREN', pad(kids, 2)], birth: ['DEPEND', pad(kids + (spouse === 'NONE' ? 0 : 1), 2)],
            dept: ['PLAN', r.pick(PLANS)], pos: ['CARD NO', 'K-' + pad(p.num, 4) + '-' + p.emp.slice(7)],
            phone: ['MEDICAL', r.pick(['70 PERCENT', '80 PERCENT'])], ext: ['DENTAL', '70'], addr: ['HOME', p.addr],
            mgr: ['CONTACT', spouse === 'NONE' ? p.mgr : spouse],
            badge: ['INS EXPIRY', rdate(r, 8, 9)]
          },
          flags: [['SPOUSE ALLOWANCE', spouse === 'NONE' ? 0 : 1], ['CHILD', kids ? 1 : 0], ['HOUSING AID', f[2]], ['DEPENDENTS', f[3]],
            ['HEALTH INSURED', 1], ['PENSION', 1]],
          badgeAlert: false
        };
      }
    },
    { // ATTACH
      spec: function (p) {
        var r = H.rng('registre-att-' + p.code);
        var kb = function () { return pad(r.int(8, 96), 2) + ' KB'; };
        var f = flagsOf(p, 'att', 6);
        return {
          titles: ['FILES', 'SIZE', 'INDEX', 'FLAGS'],
          slots: {
            nom: ['PHOTO', 'PHOTO.IMG'], emp: ['COUNT', '04'], birth: ['LATEST', rdate(r, 7, 7)],
            dept: ['PHOTO', kb()], pos: ['CONTRACT', kb()],
            phone: ['FILE 1', 'CONTRACT.TXT'], ext: ['PAGES', pad(r.int(2, 12), 2)], addr: ['FILE 2', 'HEALTH-CHECK.TXT'], mgr: ['FILE 3', 'LICENSE.IMG'],
            badge: ['SCAN DATE', rdate(r, 6, 7)]
          },
          flags: [['PHOTO ON FILE', 1], ['CV', f[1]], ['CONTRACT', 1], ['ID COPY', f[3]], ['MEDICAL FILE', f[4]], ['LICENSE COPY', f[5]]],
          badgeAlert: false
        };
      }
    }
  ];

  var SLOTS = ['nom', 'emp', 'birth', 'sex', 'blood', 'dept', 'pos', 'grade', 'hired', 'status', 'contract', 'phone', 'ext', 'addr', 'mgr', 'badge'];

  // ------------------------------------------------------------------ éléments
  var el = {};
  var rows, marks, tabs, gradeOpts, cursors, caseEls, labFlag, titles, histCells, slotEls, valEl, labEl, jpEls;
  var cur = 0;   // salarié affiché
  var tab = 0;   // onglet actif
  var SHOWN = {}; // clé -> visible (absent = visible)
  var arrivee = false; // vrai pendant le rendu de l'arrivée d'une demande : la ligne du haut entre en fondu

  function grab() {
    ['lock', 'rec', 'etat', 'ftitle', 'cachet-pend', 'lastedit'].forEach(function (k) { el[k] = H.q(k); });
    rows = H.qa('row');
    marks = rows.map(function (r) { return H.q('r-mark', r); });
    tabs = H.qa('tab');
    gradeOpts = H.qa('grade');
    cursors = H.qa('cursor');
    caseEls = [0, 1, 2, 3, 4, 5].map(function (i) { return H.q('c-f' + i); });
    labFlag = [0, 1, 2, 3, 4, 5].map(function (i) { return H.q('l-f' + i); });
    titles = [1, 2, 3, 4].map(function (i) { return H.q('t-' + i); });
    histCells = [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return H.qa('hr' + i); });
    jpEls = H.qa('jp');
    slotEls = {}; valEl = {}; labEl = {};
    SLOTS.forEach(function (s) {
      slotEls[s] = H.qa('s-' + s);
      valEl[s] = H.q('v-' + s);
      labEl[s] = H.q('l-' + s);
    });
  }

  // ------------------------------------------------------------------ outils d'aspect
  function put(e, texte, anim) {
    var change = e.textContent !== texte;
    if (anim) H.write(e, texte);
    else if (change) e.textContent = texte;
    return change;
  }

  // Change les classes et enchaîne la couleur de l'ancien état au nouveau, sans couleur codée.
  // opacite : opacité de départ si le texte change dans le même temps (rémanence). Un seul tween par élément : deux
  // tweens simultanés à clearProps différents laissent un style en ligne résiduel (vérifié sur gsap 3.13.0).
  // Avant un nouveau tween sur un élément, les tweens en cours sont tués et son couleur et opacité en ligne remises à
  // zéro : sinon deux tweens qui se chevauchent (deux onglets en un même instant) laissent une couleur figée.
  // Réservé aux éléments de texte que screen.js recolore (badge, cellules de la ligne du haut de HISTORY).
  function reprendre(e) {
    if (H.ok) gsap.killTweensOf(e);
    e.style.color = '';
    e.style.opacity = '';
  }

  function recolor(e, change, duree, opacite) {
    if (!H.ok || H.dur(duree) === 0) { change(); return; }
    var c0 = getComputedStyle(e).color;
    reprendre(e);
    change();
    var c1 = getComputedStyle(e).color;
    var de = { color: c0 };
    var vers = { color: c1, duration: duree, ease: 'power1.inOut', clearProps: 'color', overwrite: 'auto' };
    if (opacite !== undefined) {
      de.opacity = opacite;
      vers.opacity = 1;
      vers.clearProps += ',opacity';
    }
    gsap.fromTo(e, de, vers);
  }

  function vis(els, on, cle, duree) {
    if ((SHOWN[cle] !== false) === on) return;
    SHOWN[cle] = on;
    els.forEach(function (e) {
      if (cursors.indexOf(e) >= 0) {   // l'animation CSS du curseur écrase l'opacité : on joue sur la visibilité
        e.style.visibility = on ? '' : 'hidden';
        return;
      }
      if (H.ok && H.dur(duree) > 0) {
        gsap.to(e, { opacity: on ? 1 : 0, duration: duree, ease: 'power1.out', overwrite: true, clearProps: on ? 'opacity' : '' });
      } else {
        if (H.ok) gsap.killTweensOf(e);
        e.style.opacity = on ? '' : '0';
      }
    });
  }

  function setClass(e, classe, on) {
    if (classe) e.classList.toggle(classe, on);
  }

  // Case FLAGS : la classe du kit et aria-checked suivent le même état affiché.
  function setFlag(e, on) {
    setClass(e, CL.flag.ajoute, on);
    e.setAttribute('aria-checked', String(!!on));
  }

  // Bascule des classes d'alerte d'une cellule de la ligne du haut : orange (en attente) ou phosphore (validée).
  function recolorRang0(c, enAttente) {
    return function () {
      c.classList.toggle(CL.alert.retire, enAttente);
      c.classList.toggle(CL.alert.ajoute, !enAttente);
    };
  }

  // ------------------------------------------------------------------ rendu de la fiche
  function render() {
    var p = P[cur];
    var sp = TABS[tab].spec(p);

    // En-tête et compteurs.
    put(el.ftitle, p.emp + '  ' + p.name, true);
    put(el.rec, 'REC ' + pad(p.num, 4) + ' / 0318', true);
    put(el.lock, 'LOCK ' + (cur === 0 ? p.lock : 'NONE'), true);
    put(el.etat, cur === 0 ? '12 HITS / 0318' : 'HIT ' + pad(cur + 1, 2) + ' / 12', true);
    put(el.lastedit, 'LAST EDIT ' + p.last, true);

    // Titres des groupes.
    for (var i = 0; i < 4; i++) put(titles[i], sp.titles[i], true);

    // Champs. Le badge change de texte et de couleur dans un même tween (voir recolor) quand son état d'alerte change.
    var badgeRec = (valEl.badge.classList.contains(CL.alert.retire)) !== !!sp.badgeAlert;
    var badgeTexte = false;
    SLOTS.forEach(function (s) {
      var d = sp.slots[s];
      var avant = SHOWN['s-' + s] !== false;
      if (d) {
        put(labEl[s], d[0], avant);
        if (d[1] !== undefined) {
          if (s === 'grade') {
            put(valEl.grade, d[1], avant);
          } else if (s === 'badge') {
            if (!badgeRec && valEl[s].textContent !== d[1]) reprendre(valEl[s]);
            badgeTexte = put(valEl[s], d[1], avant && !badgeRec);
          } else {
            put(valEl[s], d[1], avant);
          }
        }
      }
      vis(slotEls[s], !!d, 's-' + s, DUREE_ONGLET);
    });
    vis(jpEls, tab === 0, 'jp', DUREE_ONGLET);

    // Cases FLAGS.
    for (i = 0; i < 6; i++) {
      put(labFlag[i], sp.flags[i][0], true);
      setFlag(caseEls[i], !!sp.flags[i][1]);
    }

    // Badge : orange tant que la demande de badge est en attente.
    var badge = valEl.badge;
    if (badgeRec) {
      recolor(badge, function () {
        badge.classList.toggle(CL.alert.retire, !!sp.badgeAlert);
        badge.classList.toggle(CL.alert.ajoute, !sp.badgeAlert);
      }, DUREE_RECOLOR, badgeTexte ? REMANENCE : undefined);
    }

    // Tableau HISTORY. Les cellules du rang 0 dont la couleur change (statut validé, demande arrivée) changent de texte
    // et de couleur dans un même tween ; la ligne qui arrive y entre en fondu depuis l'opacité 0.
    for (var r = 0; r < 8; r++) {
      var row = p.hist[r];
      var texts = [row[0], row[1], row[2], row[3], row[4] ? PEND : APPR];
      var cells = histCells[r];
      var enAttente = !!row[4];
      var rec = r === 0 && cells[0].classList.contains(CL.alert.retire) !== enAttente;
      for (i = 0; i < 5; i++) {
        if (!rec && cells[i].textContent !== texts[i]) reprendre(cells[i]);
        var texteChange = put(cells[i], texts[i], !rec);
        if (rec) {
          recolor(cells[i], recolorRang0(cells[i], enAttente), DUREE_RECOLOR,
            arrivee ? 0 : (texteChange ? REMANENCE : undefined));
        }
      }
    }
    arrivee = false;
    vis([el['cachet-pend']], !!p.hist[0][4], 'cachet', DUREE_CACHET);
  }

  // ------------------------------------------------------------------ interactions
  // Marque de la ligne choisie : carré clair pour les autres, contour à la géométrie de sélection pour celle-ci.
  function paintMark(k, on) {
    var m = marks[k];
    m.classList.toggle(CL.rowMark.retire, !on);
    m.classList.toggle(CL.rowMark.ajoute, on);
    m.classList.toggle(CL.rowMark.geometrie, on);
  }

  // Passage de aria-selected à une ligne : la barre glisse de l'ancienne à la nouvelle (glisseBarre), la marque suit.
  function pick(k) {
    if (k === cur) return;
    var depart = rows[cur];
    paintMark(cur, false);
    cur = k;
    paintMark(k, true);
    H.glisseBarre(depart, rows[k], DUREE_BARRE);
    gradeSuit();
    render();
  }

  // Liste GRADE : quatre options fixes G-2 à G-5 (HEAD). gradeSel = indice de l'option sélectionnée (G-4 au départ).
  var gradeSel = 2;
  // Pose la sélection sur l'option d'indice i, sans glissement et sans focus (changement de salarié, retour de clic).
  function gradePose(i) {
    gradeOpts.forEach(function (o, j) { o.setAttribute('aria-selected', String(j === i)); });
    gradeSel = i;
  }
  // Changement de salarié : la sélection suit son grade s'il est entre G-2 et G-5 ; sinon elle reste celle de HEAD.
  function gradeSuit() {
    var i = P[cur].grade - 2;
    if (i >= 0 && i <= 3) gradePose(i);
  }
  // Clic ou Entrée sur une option : la barre glisse de l'option sélectionnée à celle-ci, le champ GRADE affiche sa valeur,
  // et ce grade reste celui du salarié affiché.
  function pickGrade(k) {
    var n = parseInt(gradeOpts[k].textContent.trim().slice(2), 10);
    var p = P[cur];
    if (!TABS[tab].spec(p).slots.grade) { gradePose(gradeSel); return; } // option cachée par l'onglet : rien ne change
    if (n === p.grade) { gradePose(gradeSel); return; }
    var depart = gradeOpts[gradeSel];
    p.grade = n;
    gradeSel = k;
    render();
    H.glisseBarre(depart, gradeOpts[k], DUREE_BARRE);
  }

  function pickTab(i) {
    if (i === tab) return;
    // La classe k-onglet-actif et aria-selected sont posées par le script clavier : rien à faire ici.
    var ancien = tabs[tab];
    tab = i;
    if (H.ok && !H.reduced) {
      [ancien, tabs[i]].forEach(function (t) {
        gsap.fromTo(t, { opacity: 0.55 }, { opacity: 1, duration: DUREE_ONGLET, ease: 'power1.out', clearProps: 'opacity', overwrite: 'auto' });
      });
    }
    render();
  }

  // ------------------------------------------------------------------ événement
  var evenements = H.rng('registre-events');

  // Une nouvelle demande arrive en tête de l'historique de E-0042 ; les autres descendent d'un rang.
  function arrival() {
    var p = P[0];
    var dernier = parseInt(p.hist[0][1].slice(4), 10);
    p.hist.unshift([H.time.stamp().slice(0, 9), 'CHG-' + pad(dernier + 1, 4), evenements.pick(EVENTS), 'SATO-K', true]);
    p.hist.pop();
    if (cur !== 0) return;
    arrivee = true;
    render();
    arrivee = false;
  }

  function setLock(v) {
    P[0].lock = v;
    if (cur === 0) put(el.lock, 'LOCK ' + v, true);
  }

  // La demande en tête est approuvée ; un renouvellement de badge repousse l'échéance d'un an.
  function approve() {
    var p = P[0];
    var h = p.hist[0];
    if (!h[4]) return;
    h[4] = false;
    if (/^BADGE RENEWAL/.test(h[2])) p.exp = 'H' + pad(parseInt(p.exp.slice(1, 3), 10) + 1, 2) + p.exp.slice(3);
    p.expAlert = false;
    p.last = H.time.stamp().slice(0, 9) + ' ' + H.time.hm() + ' SATO-K';
    if (cur === 0) render();
  }

  function validation() {
    setLock('SATO-K');
    H.after(T_STATUT, approve);
    H.after(T_LOCK_FIN, function () { setLock('NONE'); });
  }

  // ------------------------------------------------------------------ démarrage
  H.onReady(function () {
    grab();
    cursors.forEach(function (c) { H.cursor(c); });
    // Clic et clavier passent par aria-selected (script de HEAD) : on observe ce passage, sans écouteur sur les options.
    H.suivreSelection(rows, function (e, k) { pick(k); });
    H.suivreSelection(tabs, function (e, i) { pickTab(i); });
    H.suivreSelection(gradeOpts, function (e, k) { pickGrade(k); });
    H.every(PERIODE, function (n) {
      if (n === 0) {
        validation();
      } else {
        arrival();
        H.after(DELAI_VALID, validation);
      }
    }, PREMIER);
  });
})();
