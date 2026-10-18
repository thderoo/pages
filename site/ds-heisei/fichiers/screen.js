/*
 * Écran fichiers (gestionnaire de fichiers) : horloge, copie périodique de 7 fichiers, choix d'un dossier de l'arbre
 * (barre glissante, chemin, tableau, capacité, barre d'état) et choix d'une ligne du tableau.
 * La sélection vient de aria-selected (script clavier de l'index.html) : Heisei.suivreSelection appelle les mêmes
 * fonctions que le clic. Les éléments se trouvent par jeton data-anim (Heisei.q / Heisei.qa). Socle : system/heisei.js.
 */
(function () {
  'use strict';

  var H = window.Heisei;
  if (!H) return;
  var gsap = window.gsap;

  // ------------------------------------------------------------------ rythmes
  var PREMIER = 20;        // premier événement de copie (s après ready)
  var PERIODE = 60;        // période des événements (s)
  var PAS = 0.1;           // pas du compteur d'octets de la copie (s)
  var PAS_FICHIER = 27;    // pas pour remplir un fichier entier (2,7 s)
  var PAS_REPRISE = 20;    // pas pour finir PLAN-A.DOC (2,0 s)
  var PAS_TENUE = 3;       // barre pleine entre deux fichiers (0,3 s), puis elle se vide d'un coup
  var PAS_FIN = 10;        // barre pleine après le dernier fichier (1 s)
  var MESSAGE = 8;         // durée du message COPY DONE (s)
  var APPARITION = 0.4;    // apparition / disparition de la boîte (s)
  var GLISSE = 0.3;        // barre de sélection de l'arbre (s)
  var CASES = 24;          // cases de la barre de copie
  var CASES_CAP = 15;      // cases du verre de capacité

  // Ordre des dossiers de l'arbre, dans l'ordre des treeitem de l'index.html (position = rang du treeitem).
  var ORDRE = ['sys', 'work', 'data', 'report', 'ledger', 'memo', 'temp', 'util', 'backup', 'archive'];
  var RANG_REPORT = ORDRE.indexOf('report');

  // Classes du kit selon l'état d'une ligne d'alerte (le reste de la sélection vient de aria-selected).
  var C = {
    texte: 'k-phosphore-texte',
    texteAl: 'k-alerte-texte',
    icone: 'k-phosphore-segment',
    iconeAl: 'k-alerte-segment',
    celOn: 'k-phosphore-segment-sombre',
    celOff: 'k-phosphore-segment-eteint'
  };

  // ------------------------------------------------------------------ petits outils
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  // Octets / 1000 tronqués à une décimale (36 250 donne 36.2).
  var ko = function (o) { return (Math.floor(o / 100) / 10).toFixed(1); };
  var poser = function (el, texte) { if (el.textContent !== texte) el.textContent = texte; };

  // ------------------------------------------------------------------ données inventées
  var VOLUMES = { A: [6.1, 10.0], B: [14.2, 20.0], C: [52.6, 60.0] };

  // Fichiers possibles par dossier (nom 8.3 en capitales) ; le dossier en tire n au hasard (graine fixe), triés par nom.
  var THEMES = {
    sys: { vol: 'A', chemin: 'A:\\SYSTEM\\H07', n: 11, noms: 'AUTOEXEC.BAT CONFIG.SYS COMMAND.COM KEYBOARD.SYS DISPLAY.SYS HIMEM.SYS SETUP.EXE FORMAT.COM CHKDSK.COM DRIVER.SYS COUNTRY.SYS LOADER.COM README.TXT SYSTEM.INI' },
    work: { vol: 'B', chemin: 'B:\\WORK\\H07', n: 12, noms: 'MEMO-0901.TXT SCHED95.XLS ROSTER.DBF INBOX.DAT OUTBOX.DAT NOTES.TXT TODO.TXT PROJ-A.DOC PROJ-B.DOC DRAFT01.DOC DRAFT02.DOC CALC.EXE ADDRESS.DBF PHONE.DBF MINUTES.DOC' },
    data: { vol: 'B', chemin: 'A:\\DATA\\H07', n: 15, noms: 'CUSTOMER.DBF ORDERS.DBF STOCK.DBF PRICE95.XLS PRICE94.XLS SUPPLIER.DBF INDEX1.DAT INDEX2.DAT TAXES.XLS PAYROLL.DBF EXPORT.TXT IMPORT.TXT CODES.DAT REGION.DAT TOTALS.XLS BACKUP.DAT STAT-Q2.XLS STAT-Q3.XLS' },
    ledger: { vol: 'B', chemin: 'A:\\DATA\\LEDGER\\H07', n: 16, noms: 'LEDGER94.DBF LEDGER95.DBF JOURNAL.DBF ACCT-001.DAT ACCT-002.DAT ACCT-003.DAT BALANCE.XLS CASH-Q1.XLS CASH-Q2.XLS CASH-Q3.XLS ENTRY.TXT AUDIT.DOC VOUCHER.DBF TRIAL.XLS CLOSING.DOC INVOICE.DBF RECEIPT.DBF CHART.DAT' },
    memo: { vol: 'B', chemin: 'A:\\DATA\\MEMO\\H07', n: 9, noms: 'MEMO-0801.TXT MEMO-0815.TXT MEMO-0902.TXT MEMO-0930.TXT MEMO-1015.TXT NOTICE.DOC CIRCULAR.DOC AGENDA.TXT MINUTES.TXT REPLY.DOC FORWARD.TXT' },
    temp: { vol: 'B', chemin: 'A:\\DATA\\TEMP\\H07', n: 7, noms: 'TMP0001.$$$ TMP0002.$$$ SCRATCH.TMP CACHE.DAT UNDO.DAT PRINT.SPL SORT.TMP WORK.TMP EDIT.BAK' },
    util: { vol: 'B', chemin: 'A:\\UTIL\\H07', n: 14, noms: 'SCANDISK.EXE DEFRAG.EXE UNDELETE.COM TREE.COM XCOPY.EXE ATTRIB.EXE BACKUP.EXE RESTORE.EXE LABEL.COM MEM.EXE EDIT.COM DOSKEY.COM SORT.EXE MORE.COM FIND.EXE PRINT.EXE' },
    backup: { vol: 'B', chemin: 'A:\\BACKUP\\H07', n: 6, noms: 'FULL0901.BAK FULL1001.BAK INCR1020.BAK INCR1027.BAK INCR1103.BAK CATALOG.DAT LOG.TXT' },
    archive: { vol: 'C', chemin: 'C:\\ARCHIVE\\H07', n: 13, noms: 'ARC-9401.LZH ARC-9402.LZH ARC-9403.LZH ARC-9404.LZH ARC-9501.LZH ARC-9502.LZH INDEX.DAT LABELS.TXT OLDMAIL.DAT OLDLEDG.DBF YEAR94.XLS YEAR93.XLS CATALOG.DOC NOTES94.TXT' }
  };

  // Taille (octets) plausible par extension.
  var TAILLES = {
    DOC: [8000, 60000], XLS: [10000, 40000], TXT: [300, 20000], DBF: [20000, 320000], EXE: [20000, 150000],
    COM: [4000, 60000], SYS: [1000, 60000], BAT: [100, 3000], DAT: [512, 120000], INI: [200, 6000],
    LZH: [60000, 400000], BAK: [5000, 200000], TMP: [0, 4096], SPL: [1000, 40000], $$$: [0, 4096]
  };

  var inventer = function (id) {
    var t = THEMES[id];
    var rng = H.rng('fichiers-' + id);
    var noms = t.noms.split(' ');
    for (var i = noms.length - 1; i > 0; i--) {
      var j = rng.int(0, i);
      var x = noms[i]; noms[i] = noms[j]; noms[j] = x;
    }
    noms = noms.slice(0, t.n).sort();
    var fichiers = noms.map(function (nom) {
      var ext = nom.split('.')[1];
      var lim = TAILLES[ext];
      var octets = Math.round(rng.int(lim[0], lim[1]) / 2) * 2;
      var mois = rng.int(6, 11);
      var jour = mois === 11 ? rng.int(1, 3) : rng.int(1, 28);
      var a = rng();
      return {
        nom: nom, type: ext, octets: octets, taille: fmt(octets),
        date: 'H07.' + H.pad(mois, 2) + '.' + H.pad(jour, 2),
        attr: a < 0.78 ? 'A' : (a < 0.9 ? 'R' : 'H'), al: false
      };
    });
    var dirs = rng.int(0, 6);
    return {
      id: id, vol: t.vol, chemin: t.vol + t.chemin.slice(1), fichiers: fichiers, sel: 0,
      statut: 'FILES  ' + H.pad(fichiers.length, 2) + '   DIRS  ' + H.pad(dirs, 2)
    };
  };

  // ------------------------------------------------------------------ éléments
  var chemin, stFiles, stSel, stFree, capTxt, capCels, capMetre, dlg, dSrc, dPct, dFile, dCels;
  var ligs = [];       // les 17 lignes du tableau : { row, el, icone, cells[5], al, vis }
  var CHAMPS = ['nom', 'type', 'taille', 'date', 'attr'];
  var dossiers = {};   // id -> { id, vol, chemin, fichiers[], sel, statut, repos }
  var arbre = [];      // les 10 treeitem de l'arbre, dans l'ordre de ORDRE
  var ligneArbre = null; // treeitem qui porte la barre de sélection
  var cur = null;      // dossier affiché
  var msg = null;      // message d'état (COPY DONE) tant qu'il masque la sélection
  var selTexte = '';   // texte de sélection courant (SELECTED ...)

  var lireDOM = function () {
    chemin = H.q('chemin');
    stFiles = H.q('st-files');
    stSel = H.q('st-sel');
    stFree = H.q('st-free');
    capTxt = H.q('cap-txt');
    capCels = H.qa('cap-cel');
    capMetre = capCels[0].parentElement;
    dlg = H.q('dialog');
    dSrc = H.q('d-src');
    dPct = H.q('d-pct');
    dFile = H.q('d-file');
    dCels = H.qa('d-cel');
    // Textes de l'arbre : le span du jeton « clic dossier » est le enfant du treeitem (qui porte aria-selected).
    arbre = H.qa('dossier').filter(function (e) { return e.parentElement.getAttribute('role') === 'treeitem'; })
      .map(function (e) { return e.parentElement; });
    H.qa('ligne').forEach(function (el) {
      ligs.push({
        row: el.parentElement, el: el, icone: H.q('icone', el),
        cells: CHAMPS.map(function (c) { return H.q(c, el); }), vis: true
      });
    });
  };

  // REPORT : le tableau de repos, lu dans le DOM tel quel.
  var lireRepos = function () {
    var fichiers = ligs.map(function (l) {
      var v = l.cells.map(function (c) { return c.textContent; });
      return {
        nom: v[0], type: v[1], taille: v[2], date: v[3], attr: v[4],
        octets: parseInt(v[2].replace(/,/g, ''), 10), al: l.cells[0].classList.contains(C.texteAl)
      };
    });
    var sel = 0;
    ligs.forEach(function (l, i) { if (l.row.getAttribute('aria-selected') === 'true') sel = i; });
    return {
      id: 'report', vol: 'B', chemin: chemin.textContent, fichiers: fichiers, sel: sel, repos: sel,
      statut: stFiles.textContent
    };
  };

  // ------------------------------------------------------------------ tableau
  // Couleurs de texte et d'icône selon l'état d'alerte de la ligne (pas de sélection : elle vient de aria-selected).
  var aspect = function (l, al) {
    l.cells.forEach(function (c) {
      c.classList.toggle(C.texteAl, al);
      c.classList.toggle(C.texte, !al);
    });
    l.icone.classList.toggle(C.iconeAl, al);
    l.icone.classList.toggle(C.icone, !al);
    l.al = al;
  };

  var ecrireLigne = function (l, f, direct) {
    CHAMPS.forEach(function (c, k) {
      if (direct) poser(l.cells[k], f[c]); else H.write(l.cells[k], f[c]);
    });
  };

  var majSel = function () {
    var f = cur.fichiers[cur.sel];
    selTexte = 'SELECTED ' + f.nom + '  ' + f.taille;
    if (msg === null) H.write(stSel, selTexte);
  };

  // Appelée par la sélection d'une ligne (clic ou clavier) : même effet que le clic du worktree.
  // Une ligne masquée (au-delà du nombre de fichiers du dossier) ne peut pas être sélectionnée : sa sélection est annulée
  // et la ligne précédente reprend aria-selected.
  var choisirLigne = function (i) {
    if (i < 0 || i === cur.sel) return;
    if (i >= cur.fichiers.length) {
      ligs[i].row.setAttribute('aria-selected', 'false');
      ligs[cur.sel].row.setAttribute('aria-selected', 'true');
      return;
    }
    cur.sel = i;
    majSel();
  };

  var montrerTableau = function (d) {
    ligs.forEach(function (l, i) {
      var f = d.fichiers[i];
      if (!f) {
        l.row.setAttribute('aria-selected', 'false');
        if (l.vis) {
          l.vis = false;
          gsap.to(l.el, { autoAlpha: 0, duration: H.dur(APPARITION), ease: 'power1.out', overwrite: 'auto' });
        }
        return;
      }
      aspect(l, f.al);
      l.row.setAttribute('aria-selected', String(i === d.sel));
      if (l.vis) {
        ecrireLigne(l, f, false);
      } else {
        l.vis = true;
        ecrireLigne(l, f, true);
        gsap.to(l.el, { autoAlpha: 1, duration: H.dur(APPARITION), ease: 'power1.out', clearProps: 'opacity,visibility', overwrite: 'auto' });
      }
    });
  };

  var choisirDossier = function (id) {
    var d = dossiers[id];
    if (!d || d === cur) return;
    cur = d;
    if (d.repos === undefined) d.sel = 0; else d.sel = d.repos;
    // chemin, tableau, barre d'état, capacité
    H.write(chemin, d.chemin);
    montrerTableau(d);
    H.write(stFiles, d.statut);
    var v = VOLUMES[d.vol];
    H.write(stFree, d.vol + ': FREE  ' + (v[1] - v[0]).toFixed(1) + 'MB');
    var texte = d.vol + ': ' + v[0].toFixed(1) + 'MB / ' + v[1].toFixed(1) + 'MB';
    H.write(capTxt, texte);
    var allumees = Math.floor(CASES_CAP * v[0] / v[1]);
    H.lit(capCels, allumees, C.celOn, C.celOff);
    capMetre.setAttribute('aria-valuenow', String(allumees));
    capMetre.setAttribute('aria-valuetext', texte);
    majSel();
  };

  // ------------------------------------------------------------------ copie
  var LISTE = ['BUDGET.XLS', 'MEMO-1002.TXT', 'PLAN-A.DOC', 'PLAN-B.DOC', 'REPORT.EXE', 'SALES-Q3.XLS', 'STAFF.DBF'];
  var copies = [];      // les 7 fichiers copiés (tailles lues dans le tableau de repos)
  var copie = null;     // { tic } pendant une copie
  var etat = null;      // { f, o0, S, k, phase, t }

  var rendu = function (f, o) {
    var taille = copies[f].octets;
    var pct = Math.floor(o * 100 / taille);
    H.lit(dCels, Math.ceil(pct * CASES / 100), C.celOn, C.celOff);
    poser(dPct, pct + '%');
    poser(dFile, 'FILE ' + H.pad(f + 1, 2) + ' / 07   ' + ko(o) + 'KB / ' + ko(taille) + 'KB');
  };

  var source = function (f) { return 'SRC  B:\\DATA\\REPORT\\' + copies[f].nom; };

  var fin = function () {
    copie.tic.stop();
    copie = null;
    gsap.to(dlg, { autoAlpha: 0, duration: H.dur(APPARITION), ease: 'power1.out', overwrite: 'auto' });
    msg = 'COPY DONE 07 FILES';
    H.write(stSel, msg);
    H.after(MESSAGE, function () {
      msg = null;
      H.write(stSel, selTexte);
    });
  };

  var pas = function () {
    var e = etat;
    if (e.phase === 'copie') {
      e.k++;
      var taille = copies[e.f].octets;
      rendu(e.f, Math.round(e.o0 + (taille - e.o0) * e.k / e.S));
      if (e.k >= e.S) {
        e.phase = 'tenue';
        e.t = e.f === 6 ? PAS_FIN : PAS_TENUE;
      }
      return;
    }
    e.t--;
    if (e.t > 0) return;
    if (e.f === 6) { fin(); return; }
    e.f++;
    e.o0 = 0;
    e.S = PAS_FICHIER;
    e.k = 0;
    e.phase = 'copie';
    H.write(dSrc, source(e.f));
    rendu(e.f, 0);
  };

  var demarrer = function (f, o0, S) {
    etat = { f: f, o0: o0, S: S, k: 0, phase: 'copie', t: 0 };
    copie = { tic: H.every(PAS, pas) };
  };

  var evenement = function (n) {
    if (copie) return;
    if (n === 0) {
      // la copie reprend là où le repos l'a laissée : PLAN-A.DOC, 22 900 octets
      demarrer(2, 22900, PAS_REPRISE);
      return;
    }
    poser(dSrc, source(0));
    rendu(0, 0);
    copie = { tic: null };
    gsap.to(dlg, {
      autoAlpha: 1, duration: H.dur(APPARITION), ease: 'power1.out', clearProps: 'opacity,visibility', overwrite: 'auto',
      onComplete: function () { demarrer(0, 0, PAS_FICHIER); }
    });
  };

  // ------------------------------------------------------------------ démarrage
  H.onReady(function () {
    var horloge = H.q('clock');
    if (horloge) H.clock(horloge);
    if (!H.ok) return;

    lireDOM();
    dossiers.report = lireRepos();
    Object.keys(THEMES).forEach(function (id) { dossiers[id] = inventer(id); });
    cur = dossiers.report;
    copies = LISTE.map(function (nom) {
      return dossiers.report.fichiers.filter(function (f) { return f.nom === nom; })[0];
    });
    selTexte = stSel.textContent;
    ligneArbre = arbre[RANG_REPORT];

    // Arbre : la sélection (aria-selected) déclenche le changement de dossier et le glissement de la barre.
    H.suivreSelection(arbre, function (el, i) {
      var id = ORDRE[i];
      if (!id || dossiers[id] === cur) return;
      H.glisseBarre(ligneArbre, el, GLISSE);
      ligneArbre = el;
      choisirDossier(id);
    });

    // Icône REPORT : au repos elle est au-dessus de la barre (z-index de la feuille de l'écran) et reçoit le clic
    // elle-même ; son clic sélectionne le treeitem REPORT, comme le clic du worktree.
    var icones = H.qa('dossier').filter(function (e) { return e.parentElement.getAttribute('role') !== 'treeitem'; });
    icones[RANG_REPORT].addEventListener('click', function () { arbre[RANG_REPORT].click(); });

    // Tableau : la sélection d'une ligne déclenche le même effet que le clic.
    H.suivreSelection(ligs.map(function (l) { return l.row; }), function (el, i) { choisirLigne(i); });

    H.every(PERIODE, evenement, PREMIER);
  });
})();
