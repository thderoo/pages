/*
 * screen.js : animation de l'écran messagerie (client de courrier).
 * Socle : window.Heisei (system/heisei.js) et GSAP. Sans GSAP, l'écran reste au repos et ce script ne fait rien.
 * Éléments trouvés par jeton data-anim uniquement (Heisei.q / Heisei.qa). Tout démarre après Heisei.ready.
 * Sélection : la ligne ou le dossier choisi est celui dont aria-selected passe à vrai (souris ou clavier). Ce script
 * n'écoute ni le clic ni le clavier des lignes et des dossiers.
 *
 * Ce qui bouge :
 *   - allumage des verres (jeton glass, géré par le socle) ;
 *   - curseurs de la recherche et de la réponse (clignotement du socle, en phase) ;
 *   - saisie de la réponse en boucle de 60 s, avec compteur CHARS et curseur qui suit ;
 *   - bande d'état : POP3 OK / RECV, compteurs du dossier ouvert ;
 *   - événement : un message arrive dans INBOX toutes les 60 s (premier à +20 s) ;
 *   - interaction : choix d'un message ou d'un dossier (barre de sélection glissée par le socle).
 */
(function () {
  'use strict';

  // ================================================================ rythmes (secondes)
  var PREMIER_EVENEMENT = 20;   // premier message qui arrive, après ready
  var PERIODE_EVENEMENT = 60;   // un message toutes les 60 s
  var DUREE_RECV = 2;           // POP3 RECV
  var LU_APRES = 20;            // la nouvelle ligne est marquée lue au bout de 20 s
  var PREMIERE_SAISIE = 10;     // premier départ de la saisie, après ready
  var PERIODE_SAISIE = 60;      // la saisie repart 60 s après le début de la précédente
  var FRAPPE = 0.18;            // un caractère toutes les 180 ms (saisie et effacement)
  var EFFACE_APRES = 40;        // effacement 40 s après la fin de la saisie
  var DUREE_LIGNE = 0.4;        // apparition et décalage d'une ligne
  var DUREE_BARRE = 0.3;        // déplacement d'une barre de sélection
  var DUREE_VALEUR = 0.4;       // fondu d'une valeur
  var DELAI_NOUVELLE_LIGNE = 0.3; // la nouvelle ligne s'écrit quand les autres ont fini de glisser
  var EASE = 'power1.out';

  // ================================================================ autres constantes
  var LIGNES = 11;              // lignes de la liste
  var TEXTE_SAISIE = ' the form number.';
  var QUOTA_TOTAL = 1024;       // MB
  var ESPACEMENT_RECV = '1.2px'; // espacement des lettres de « RECV » (2,55 px au repos) pour que le mot tienne dans le verre
  var CELLULES_QUOTA = 14;     // 6 allumées + 8 éteintes au repos (la fine tranche entre les deux ne compte pas)

  // ================================================================ classes de changement d'aspect
  // Seules ces classes sont posées ou retirées. Un groupe = un jeton ; un état = la classe ajoutée, et toutes les
  // autres classes du groupe sont retirées. La couleur de la sélection ne passe pas par ces classes : elle vient
  // de aria-selected (system/heisei.css).
  //   groupe   jeton            état -> classe ajoutée
  //   marque   rm               nonlu k-phosphore-segment | lu k-marque-carre-creux | alerte k-alerte-puce | (aucune : ligne sélectionnée)
  //   texte    rx rs rh         normal k-phosphore-texte-sourd | alerte k-alerte-texte
  //   filet    rf               on k-phosphore-segment-eteint | (aucune : ligne sélectionnée)
  //   quota    qcell            on k-phosphore-segment | off k-phosphore-segment-eteint-clair
  var CLASSES = {
    marque: { nonlu: 'k-phosphore-segment', lu: 'k-marque-carre-creux', alerte: 'k-alerte-puce' },
    texte: { normal: 'k-phosphore-texte-sourd', alerte: 'k-alerte-texte' },
    filet: { on: 'k-phosphore-segment-eteint' },
    quota: { on: 'k-phosphore-segment', off: 'k-phosphore-segment-eteint-clair' }
  };

  // ================================================================ TABLES DEBUT
  // Contraintes de largeur (vérifiées par un script) : expéditeur 11 caractères au plus (8 pour le nom d'un
  // destinataire, précédé de « TO »), sujet 22, ligne de corps 63, ligne de citation 60, nom de pièce jointe 15.

  // Nom -> service (affiché dans le champ FROM ou TO du volet de lecture).
  var PEOPLE = {
    'TANAKA.H': 'SYSTEMS DEPT', 'SATO.M': 'ACCOUNTING DEPT', 'SYS-ADMIN': 'SYSTEMS DEPT', 'YAMADA.K': 'PLANNING DEPT',
    'WATANABE.T': 'SALES DEPT', 'HR-DEPT': 'PERSONNEL DEPT', 'KOBAYASHI.A': 'GENERAL AFFAIRS', 'ITO.S': 'PURCHASING DEPT',
    'NAKAMURA.Y': 'SECRETARIAT', 'ADM-OFFICE': 'ADMIN OFFICE', 'SUZUKI.R': 'FACILITIES DEPT', 'TAKAHASHI.N': 'LEGAL DEPT',
    'MORI.J': 'SALES DEPT', 'KATO.E': 'ACCOUNTING DEPT', 'HAYASHI.M': 'PLANNING DEPT', 'SAITO.H': 'SYSTEMS DEPT',
    'MATSUDA.T': 'PURCHASING DEPT', 'INOUE.Y': 'GENERAL AFFAIRS', 'KIMURA.D': 'FACILITIES DEPT', 'SHIMIZU.A': 'SECRETARIAT'
  };

  // Un message. corps et citation : lignes séparées par « | ». o : u non lu, a alerte, s envoyé (qui = destinataire),
  // q citation, pj [nom, taille], draft brouillon de repos (réponse déjà commencée).
  function M(qui, sujet, heure, corps, o) {
    o = o || {};
    return {
      who: qui, subj: sujet, time: heure, date: 'H07.11.03',
      body: corps.split('|'), quote: o.q ? o.q.split('|') : [], pj: o.pj || null,
      unread: !!o.u, alert: !!o.a, sent: !!o.s, draft: !!o.draft
    };
  }

  // INBOX : les 11 lignes de repos, de la plus récente à la plus ancienne.
  var INBOX = [
    M('TANAKA.H', 'RE: SERVER ROOM ACCESS', '23:41',
      'Good evening. The key card for the server room on 5F is ready.|Please collect it from the security desk before Friday.|Access hours are 08:00 to 20:00, and the log is checked weekly.|If the night shift needs entry, contact me first.|Thank you.',
      { u: 1, draft: 1, q: 'On 10/30 you wrote:|Could I get access to the server room on 5F?|I need to replace a drive in the file server.', pj: ['ACCESS-FORM.TXT', '2KB'] }),
    M('SATO.M', 'MONTHLY REPORT 10', '23:12',
      'Good evening.|The October report is attached for your review.|Sales are up four percent from September.|Please send any corrections by Monday.',
      { u: 1, pj: ['REPORT-10.XLS', '38KB'] }),
    M('SYS-ADMIN', 'BACKUP JOB-0412 DONE', '22:58',
      'Backup job 0412 finished at 22:51.|All 14 volumes were copied without errors.|Tape 07 has been put back in the cabinet.',
      { u: 1 }),
    M('YAMADA.K', 'MEETING NOTES 10/30', '22:30',
      'Good evening.|Here are the notes from the meeting on 10/30.|The next meeting is on Monday at 10:00.|Please read item 3 before then.',
      { u: 1, pj: ['NOTES-1030.TXT', '3KB'] }),
    M('WATANABE.T', 'LEAVE REQUEST', '21:47',
      'Good evening.|I would like to take leave on November 10.|Mr. Ito will cover my work on that day.|Thank you for your consideration.'),
    M('HR-DEPT', 'NOTICE 07-114', '20:15',
      'Notice 07-114: the winter schedule starts on November 6.|Office hours are 08:30 to 17:30 on weekdays.|Please keep your badge visible inside the building.'),
    M('KOBAYASHI.A', 'RE: PRINTER 3F', '19:52',
      'Good evening.|The printer on 3F was repaired this afternoon.|Please tell me if the paper jams again.|Thank you.',
      { q: 'On 10/31 you wrote:|The printer on 3F jams every few pages.' }),
    M('ITO.S', 'ESTIMATE 0933', '18:20',
      'Estimate 0933 for the new disk array is ready.|The total is within the budget we discussed.|Please approve it by Wednesday.',
      { pj: ['ESTIMATE.TXT', '4KB'] }),
    M('SYS-ADMIN', 'DISK USAGE WARNING', '17:44',
      'Warning: disk usage on file server 02 is at 91 percent.|Please delete old files from your shared folders.|The nightly cleanup will run at 23:00.',
      { u: 1, a: 1 }),
    M('NAKAMURA.Y', 'LUNCH ORDER', '12:05',
      'Thank you.|I will collect the lunch orders until 11:30.|The menu is on the board in the break room.'),
    M('ADM-OFFICE', 'FORM 22 REMINDER', '09:30',
      'This is a reminder about form 22.|Please return it to the office by Friday.|Late forms cannot be processed this month.|Thank you.')
  ];

  var URGENT = [
    M('SYS-ADMIN', 'UPS BATTERY LOW', '23:30',
      'Warning: the UPS in room 5F is running on battery.|About 12 minutes of power are left.|Please save your work and log off now.',
      { u: 1, a: 1 }),
    M('HR-DEPT', 'FIRE DRILL 11/04', '21:10',
      'A fire drill will be held on November 4 at 10:00.|All staff must gather in the east parking lot.|Please read the attached map.',
      { u: 1, a: 1, pj: ['EXIT-MAP.TXT', '1KB'] })
  ];

  // Dossier SENT : « qui » est le destinataire (la liste affiche TO NAME.X).
  var SENT = [
    M('TANAKA.H', 'SERVER ROOM ACCESS', '22:40',
      'Good evening.|Could I get access to the server room on 5F?|I need to replace a drive in the file server.|Thank you.', { s: 1 }),
    M('SATO.M', 'RE: MONTHLY REPORT 09', '21:58',
      'Thank you for the report.|I have two small corrections for page 3.|I will send them tomorrow.', { s: 1 }),
    M('ITO.S', 'ESTIMATE REQUEST', '20:30',
      'Good evening.|Could you send an estimate for a new disk array?|We need about 2 TB of space.|Thank you.', { s: 1 }),
    M('HR-DEPT', 'LEAVE APPLICATION', '18:45',
      'Please find my leave application for November 20.|I will finish the handover before I go.|Thank you.', { s: 1 }),
    M('MORI.J', 'ROOM BOOKING 4F', '17:10',
      'Good evening.|Is the meeting room on 4F free on Thursday afternoon?|We need it from 14:00 to 16:00.', { s: 1 }),
    M('KATO.E', 'LUNCH NEXT WEEK', '16:20',
      'Would you like to have lunch together next week?|I know a small noodle shop near the station.|Please tell me which day suits you.', { s: 1 }),
    M('YAMADA.K', 'RE: MEETING NOTES', '15:05',
      'Thank you for the notes.|I have added my comments to item 2.|Please check them before Monday.', { s: 1 }),
    M('INOUE.Y', 'PHONE LIST', '13:40',
      'Good evening.|My extension is now 4417, not 4471.|Please correct the phone list.', { s: 1 }),
    M('SUZUKI.R', 'TAPE LABELS', '11:25',
      'Could you print new labels for the backup tapes?|We need 20 labels, numbered 01 to 20.|Thank you.', { s: 1 }),
    M('SATO.M', 'EXPENSE SHEET', '10:00',
      'The expense sheet for October is attached.|All receipts are in the blue folder on my desk.',
      { s: 1, pj: ['EXPENSE-10.XLS', '21KB'] }),
    M('KIMURA.D', 'RE: DESK MOVE', '08:45',
      'Thank you for the notice.|I will move my desk on Saturday morning.|Please unlock the cabinet on 5F.', { s: 1 })
  ];

  var DRAFT = [
    M('SATO.M', 'YEAR END SCHEDULE', '23:20',
      'Good evening.|I am writing about the year end schedule.|Could we meet on Tuesday to decide the dates?', { s: 1 })
  ];

  var ARCHIVE = [
    M('SATO.M', 'AUDIT RESULT Q2', '17:30',
      'The audit for the second quarter is finished.|No major problems were found.|The full report is in the shared folder.'),
    M('HR-DEPT', 'NEW HIRE ORIENTATION', '16:05',
      'The orientation for new staff is on September 2.|Please meet them at the front desk at 09:00.|Thank you.'),
    M('SYS-ADMIN', 'SERVER MOVE PLAN', '15:20',
      'The file servers will move to room 5F in October.|The move takes place over the weekend.|Please do not use the servers on Saturday.'),
    M('ADM-OFFICE', 'FIRE DRILL 09/12', '14:40',
      'A fire drill will be held on September 12 at 10:00.|Please leave the building by the nearest stairs.'),
    M('NAKAMURA.Y', 'SUMMER HOURS', '13:10',
      'Good evening.|Summer hours end this Friday.|From Monday the office opens at 08:30 again.'),
    M('KATO.E', 'TRAVEL CLAIM 0807', '12:25',
      'Your travel claim 0807 has been paid.|The money will arrive in your account on the 25th.|Thank you.'),
    M('SUZUKI.R', 'KEY CARD RENEWAL', '11:50',
      'Key cards expire at the end of this month.|Please bring your old card to the security desk.'),
    M('SATO.M', 'PAYROLL NOTICE 09', '10:35',
      'The payroll for September will be paid on the 25th.|Please check your slip and report any errors.'),
    M('YAMADA.K', 'DRIVE REPLACEMENT', '09:50',
      'Good evening.|The failed drive in the file server was replaced.|The array is rebuilding and will be ready by noon.'),
    M('KOBAYASHI.A', 'OFFICE LAYOUT 5F', '09:15',
      'The new layout for the 5F office is attached.|Please tell me if your desk should be elsewhere.',
      { pj: ['LAYOUT-5F.TXT', '6KB'] }),
    M('ITO.S', 'WELCOME PARTY', '08:40',
      'We will welcome the new staff on Friday evening.|The party starts at 18:30 in the break room.|Thank you.')
  ];

  var PROJECTS = [
    M('TAKAHASHI.N', 'NETWATCH V4.2 PLAN', '22:15',
      'Good evening.|The plan for NETWATCH V4.2 is attached.|The first test is set for the second week of November.|Please send me your comments.',
      { u: 1, pj: ['PLAN-V42.TXT', '12KB'] }),
    M('SAITO.H', 'NODE MAP REVISION', '20:45',
      'The node map was revised after the last audit.|Nodes 004 and 011 now have their own labels.|Please use the new map from tomorrow.'),
    M('SUZUKI.R', 'CABLE WORK 4F', '19:30',
      'Cable work on 4F starts on Monday at 08:00.|The network will be down for about one hour.|Thank you for your patience.'),
    M('ITO.S', 'SWITCH ORDER 0925', '18:05',
      'The order for four new switches was sent today.|Delivery is expected in two weeks.'),
    M('SYS-ADMIN', 'BACKUP POLICY', '16:50',
      'The backup policy was updated this week.|Full backups now run every Sunday at 01:00.|Daily backups keep the last 14 days.'),
    M('HAYASHI.M', 'MIGRATION STEP 3', '15:40',
      'Step 3 of the migration is planned for Saturday.|Please finish your tests by Friday noon.|Thank you.'),
    M('MATSUDA.T', 'TEST SCHEDULE', '14:25',
      'Good evening.|The test schedule for November is attached.|Each test takes about two hours.',
      { pj: ['TESTS-11.TXT', '2KB'] }),
    M('SAITO.H', 'PORT AUDIT', '13:10',
      'The port audit found three unused ports on the 4F switch.|I closed them this morning.'),
    M('KIMURA.D', 'RACK LAYOUT B', '11:55',
      'The layout for rack B is ready.|Heavy devices go at the bottom of the rack.|Please check the labels before the move.'),
    M('SYS-ADMIN', 'UPS REPLACEMENT', '10:30',
      'The old UPS in room 5F will be replaced in November.|The new unit lasts about 30 minutes under full load.'),
    M('TANAKA.H', 'WIRING DIAGRAM', '09:05',
      'Good evening.|The wiring diagram for the server room is attached.|Please tell me if you find any errors.',
      { pj: ['WIRING-5F.TXT', '9KB'] })
  ];

  var TRASH = [
    M('SYS-ADMIN', 'OLD NEWSLETTER', '20:00',
      'The newsletter for August is available in the shared folder.|No action is needed.'),
    M('YAMADA.K', 'MEETING CANCELLED', '18:30',
      'The meeting on Thursday is cancelled.|We will meet again next week.|Thank you.'),
    M('NAKAMURA.Y', 'RAFFLE TICKETS', '16:45',
      'Good evening.|Raffle tickets are on sale at the front desk.|Each ticket costs 100 yen.'),
    M('HR-DEPT', 'PHONE SURVEY', '15:10',
      'Please answer the short phone survey by Friday.|It takes about five minutes.'),
    M('ADM-OFFICE', 'PARKING NOTICE', '13:55',
      'The parking lot will be closed on Sunday.|Please use the street parking nearby.'),
    M('KATO.E', 'DUPLICATE REPORT', '12:20',
      'Please ignore my last message.|It was sent twice by mistake.'),
    M('SUZUKI.R', 'LUNCH MENU 10/12', '11:05',
      'The lunch menu for October 12 is curry or grilled fish.|Please order before 10:30.'),
    M('ITO.S', 'SALE ON TAPES', '10:15',
      'A shop is selling backup tapes at a low price this week.|The offer ends on Friday.'),
    M('HAYASHI.M', 'TEST MESSAGE', '09:00',
      'This is a test message.|Please ignore it.')
  ];

  // Arrivées : deux tables. Un message qui arrive prend un expéditeur de QUI et un sujet (avec son corps) de QUOI.
  var QUI = ['TAKAHASHI.N', 'SUZUKI.R', 'MORI.J', 'KATO.E', 'HAYASHI.M', 'SAITO.H', 'MATSUDA.T', 'INOUE.Y', 'KIMURA.D', 'SHIMIZU.A'];
  var QUOI = [
    { subj: 'PRINTER ROOM 3F', body: 'Good evening.|The printer room on 3F will be closed tomorrow.|Please use the printer on 4F instead.|Thank you.' },
    { subj: 'QUARTERLY SCHEDULE', body: 'The schedule for the next quarter is ready.|Please check your dates and tell me about any conflict.|Thank you.' },
    { subj: 'LUNCH ORDER FRIDAY', body: 'Good evening.|I am collecting the lunch orders for Friday.|Please reply before noon tomorrow.' },
    { subj: 'BACKUP TAPE LOG', body: 'The tape log for this week is attached.|Tape 09 shows one read error and needs a check.|Please confirm when the check is done.', pj: ['TAPE-LOG.TXT', '5KB'] },
    { subj: 'NIGHT SHIFT ROTA', body: 'Good evening.|The night shift rota for November is attached.|Please swap shifts among yourselves if needed.', pj: ['ROTA-11.TXT', '1KB'] },
    { subj: 'ELEVATOR INSPECTION', body: 'The elevators will be inspected on Thursday morning.|Please use the stairs between 09:00 and 11:00.|Thank you for your patience.' },
    { subj: 'PHONE LIST UPDATE', body: 'A new phone list is attached.|Please correct your own entry and send it back.', pj: ['PHONES.TXT', '8KB'] },
    { subj: 'PARKING PERMITS', body: 'New parking permits are ready at the front desk.|Bring your old permit when you collect the new one.|Thank you.' },
    { subj: 'RE: DESK MOVE 5F', body: 'Good evening.|The desks on 5F will be moved on Saturday.|Please empty your drawers before you leave on Friday.', quote: 'On 10/31 you wrote:|When will the desks on 5F be moved?' },
    { subj: 'MEETING ROOM 2F', body: 'The meeting room on 2F is free on Wednesday.|You can book it until 17:00.|Thank you.' }
  ];
  // ================================================================ TABLES FIN


  // Dossiers, dans l'ordre du panneau. count : compte affiché ; unread : non lus (baisse quand on lit un message).
  var DOSSIERS = [
    { nom: 'INBOX', count: 12, unread: 5, list: INBOX },
    { nom: 'URGENT', count: 2, unread: 2, list: URGENT },
    { nom: 'SENT', count: 148, unread: 0, list: SENT },
    { nom: 'DRAFT', count: 1, unread: 0, list: DRAFT },
    { nom: 'ARCHIVE', count: 1204, unread: 0, list: ARCHIVE },
    { nom: 'PROJECTS', count: 37, unread: 1, list: PROJECTS },
    { nom: 'TRASH', count: 9, unread: 0, list: TRASH }
  ];

  // ================================================================ démarrage
  var H = window.Heisei;
  var gsap = window.gsap;
  if (!H || !H.ok || !gsap) return;

  // ---------------------------------------------------------------- éléments
  // Lignes de messages : wrappers de rôle option (ordre du DOM). Dossiers : wrappers de rôle option, un par nom.
  var rows = H.qa('row');
  var R = rows.map(function (el) {
    return { el: el, rm: H.q('rm', el), rx: H.q('rx', el), rs: H.q('rs', el), rh: H.q('rh', el), rf: H.q('rf', el), cache: false };
  });
  var fnom = H.qa('fnom');
  var fcompte = H.qa('fcompte');
  var dossiers = fnom.map(function (e) { return e.parentNode; });
  var qcell = H.qa('qcell');
  var medidor = qcell[0].parentNode;   // role="meter" du quota : ses cases sont ses enfants directs
  var quotaTxt = H.q('quota-txt');
  var titreJp = H.q('ltitre-jp');
  var titreLat = H.q('ltitre-latin');
  var lval = H.qa('lval');
  var lbody = H.qa('lbody');
  var lquote = H.qa('lquote');
  var lpj = H.qa('lpj');
  var rTo = H.q('r-to');
  var rSub = H.q('r-sub');
  var rb = [H.q('rb1'), H.q('rb2'), H.q('rb3')];
  var rChars = H.q('r-chars');
  var curRep = H.q('cursor-reply');
  var curRech = H.q('cursor-search');
  var etatG = H.q('etat-g');
  var pop = H.q('pop');

  // ---------------------------------------------------------------- état
  var vue = { dossier: 0, liste: INBOX };
  var draft = INBOX[0];
  var selMsg = draft;
  var genSaisie = 0;            // change à chaque choix : annule la saisie ou l'effacement en cours
  var quota = 412;
  var REPOS = { rb: rb.map(function (e) { return e.textContent; }), chars: rChars.textContent };
  var REST_LEN = REPOS.rb[2].length;
  var BASE_CHARS = parseInt(REPOS.chars, 10);
  var base = document.body.getBoundingClientRect().top;
  var tops = R.map(function (r) { return r.el.getBoundingClientRect().top - base; });
  var quotaLit = Math.ceil(quota * CELLULES_QUOTA / QUOTA_TOTAL);
  var adv = 0;                  // avance d'un caractère du corps de la réponse (mesurée une fois les polices chargées)
  var hLigne = 0;               // interligne du corps de la réponse
  var debutX = rb[0].getBoundingClientRect().left - curRep.getBoundingClientRect().left; // décalage du curseur : début du texte

  // ---------------------------------------------------------------- outils
  function etat(el, groupe, cle) {
    var g = CLASSES[groupe];
    for (var k in g) {
      if (k !== cle && el.classList.contains(g[k])) el.classList.remove(g[k]);
    }
    if (cle && g[cle] && !el.classList.contains(g[cle])) el.classList.add(g[cle]);
  }

  function direct(el, texte) {
    if (el.textContent !== texte) el.textContent = texte;
  }

  function remanence(el) {
    if (H.reduced) return;
    gsap.fromTo(el, { opacity: 0.45 }, { opacity: 1, duration: DUREE_VALEUR, ease: EASE, clearProps: 'opacity', overwrite: 'auto' });
  }

  // Fondu vers 0 ou 1 ; à 1 le style en ligne est retiré (aucun résidu au repos).
  function opacite(el, vers, duree) {
    gsap.killTweensOf(el, 'opacity');
    var d = H.dur(duree);
    if (!d) {
      if (vers === 1) gsap.set(el, { clearProps: 'opacity' }); else gsap.set(el, { opacity: vers });
      return;
    }
    var v = { opacity: vers, duration: d, ease: EASE };
    if (vers === 1) v.clearProps = 'opacity';
    gsap.to(el, v);
  }

  // L'avance d'un caractère se mesure sur la ligne de repos, après le chargement des polices.
  function mesurer() {
    if (adv && hLigne) return;
    if (document.fonts && document.fonts.status !== 'loaded') return;
    var r3 = rb[2].getBoundingClientRect();
    adv = r3.width / REST_LEN;
    hLigne = r3.top - rb[1].getBoundingClientRect().top;
  }

  // Curseur de la réponse : ligne 0 à 2, n caractères sur cette ligne (au repos : ligne 2, REST_LEN caractères).
  function curseur(ligne, n) {
    mesurer();
    // Corps vide : le curseur se pose au début du texte ; sinon il suit le dernier caractère, au même écart qu'au repos.
    var x = n ? (n - REST_LEN) * adv : debutX;
    var y = (ligne - 2) * hLigne;
    if (!x && !y) gsap.set(curRep, { clearProps: 'transform' }); else gsap.set(curRep, { x: x, y: y });
  }

  // ---------------------------------------------------------------- liste
  function marqueDe(m) { return m.alert ? 'alerte' : (m.unread ? 'nonlu' : 'lu'); }

  function styleLigne(i) {
    var r = R[i];
    var m = vue.liste[i];
    if (!m) return;
    var sel = (m === selMsg);
    etat(r.rm, 'marque', sel ? null : marqueDe(m));
    etat(r.rf, 'filet', sel ? null : 'on');
    var t = m.alert ? 'alerte' : 'normal';
    etat(r.rx, 'texte', t);
    etat(r.rs, 'texte', t);
    etat(r.rh, 'texte', t);
  }

  function texteLigne(i, ecrire) {
    var r = R[i];
    var m = vue.liste[i];
    ecrire(r.rx, m ? (m.sent ? 'TO ' + m.who : m.who) : '');
    ecrire(r.rs, m ? m.subj : '');
    ecrire(r.rh, m ? m.time : '');
  }

  function viderLigne(i) {
    var r = R[i];
    direct(r.rx, '');
    direct(r.rs, '');
    direct(r.rh, '');
    etat(r.rm, 'marque', null);
    etat(r.rf, 'filet', null);
  }

  // La ligne de rang j porte aria-selected (sa barre est son ::before) ; j < 0 : aucune ligne choisie.
  // Une valeur déjà juste n'est pas réécrite. Le suivi ignore cette écriture : le message est déjà le choisi.
  function selectionLigne(j) {
    R.forEach(function (r, k) {
      var v = String(k === j);
      if (r.el.getAttribute('aria-selected') !== v) r.el.setAttribute('aria-selected', v);
    });
  }

  function cacher(i) {
    R[i].cache = true;
    gsap.set(R[i].el, { opacity: 0, pointerEvents: 'none' });
  }

  function montrer(i) {
    var r = R[i];
    gsap.set(r.el, { clearProps: 'pointerEvents' });
    if (r.cache) {
      r.cache = false;
      gsap.set(r.el, { opacity: 0 });
      opacite(r.el, 1, DUREE_LIGNE);
    } else {
      gsap.set(r.el, { clearProps: 'opacity' });
    }
  }

  // Réécrit les 11 lignes depuis la liste affichée ; les lignes en trop sont vides et cachées par opacité.
  function rendu(ecrire) {
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      gsap.killTweensOf(r.el);
      gsap.set(r.el, { clearProps: 'transform' });
      if (vue.liste[i]) {
        texteLigne(i, ecrire);
        styleLigne(i);
        montrer(i);
      } else {
        texteLigne(i, direct);
        cacher(i);
      }
    }
  }

  // ---------------------------------------------------------------- volet de lecture et réponse
  function lecture(m) {
    var nom = m.who + (PEOPLE[m.who] ? '  (' + PEOPLE[m.who] + ')' : '');
    H.write(lval[0], m.sent ? 'YOU' : nom);
    H.write(lval[1], m.sent ? nom : 'YOU');
    H.write(lval[2], m.date + ' ' + m.time);
    H.write(lval[3], m.subj);
    var i;
    for (i = 0; i < lbody.length; i++) H.write(lbody[i], m.body[i] || '');
    for (i = 0; i < lquote.length; i++) H.write(lquote[i], m.quote[i] ? '> ' + m.quote[i] : '');
    if (m.pj) {
      H.write(lpj[1], m.pj[0]);
      H.write(lpj[2], m.pj[1]);
    }
    for (i = 0; i < lpj.length; i++) opacite(lpj[i], m.pj ? 1 : 0, DUREE_VALEUR);
  }

  // « RE: » + sujet, sans empiler plus de deux « RE: ».
  function sujetReponse(s) {
    var n = 0;
    while (s.indexOf('RE: ') === 0) { s = s.slice(4); n++; }
    return (n >= 1 ? 'RE: RE: ' : 'RE: ') + s;
  }

  function reponse(m) {
    mesurer();   // avant de vider le corps : la mesure se fait sur le texte de repos
    var repos = (m === draft);
    H.write(rTo, m.who);
    H.write(rSub, sujetReponse(m.subj));
    for (var i = 0; i < rb.length; i++) H.write(rb[i], repos ? REPOS.rb[i] : '');
    H.write(rChars, repos ? REPOS.chars : H.pad(0, 3));
    curseur(repos ? 2 : 0, repos ? REST_LEN : 0);
  }

  function statut() {
    var d = DOSSIERS[vue.dossier];
    H.write(etatG, d.nom + ' ' + H.pad(d.count, 2) + ' / UNREAD ' + H.pad(d.unread, 2));
  }

  // ---------------------------------------------------------------- choix
  // Appelé quand aria-selected passe à vrai sur une ligne : la ligne est déjà choisie à l'écran (clic ou clavier).
  function marquerLu(d, m) {
    if (m.unread) {
      m.unread = false;
      d.unread--;
    }
  }

  function selectionner(m) {
    var avant = vue.liste.indexOf(selMsg);
    var apres = vue.liste.indexOf(m);
    selMsg = m;
    genSaisie++;
    if (avant >= 0) styleLigne(avant);
    if (apres >= 0) styleLigne(apres);
    if (avant >= 0 && apres >= 0 && avant !== apres) H.glisseBarre(R[avant].el, R[apres].el, DUREE_BARRE);
    lecture(m);
    reponse(m);
    statut();
  }

  function clicLigne(i) {
    var m = vue.liste[i];
    // Ligne en trop (masquée) : la sélection précédente est rétablie.
    if (!m) { selectionLigne(vue.liste.indexOf(selMsg)); return; }
    if (m === selMsg) return;
    marquerLu(DOSSIERS[vue.dossier], m);
    selectionner(m);
  }

  function ouvrir(k) {
    var d = DOSSIERS[k];
    var avantDossier = vue.dossier;
    var avantLigne = vue.liste.indexOf(selMsg);
    vue.dossier = k;
    vue.liste = d.list;
    selMsg = d.list[0];
    genSaisie++;
    H.write(titreLat, d.nom);
    opacite(titreJp, k === 0 ? 1 : 0, DUREE_VALEUR);
    rendu(H.write);
    selectionLigne(0);
    if (avantLigne > 0) H.glisseBarre(R[avantLigne].el, R[0].el, DUREE_BARRE);
    if (avantDossier !== k) H.glisseBarre(dossiers[avantDossier], dossiers[k], DUREE_BARRE);
    lecture(selMsg);
    reponse(selMsg);
    statut();
  }

  // ---------------------------------------------------------------- événement : un message arrive
  var rngArrivee = H.rng('messagerie.arrivee');
  var dernier = { qui: -1, quoi: -1 };

  // Tire un rang différent du précédent.
  function tirer(n, prec) {
    return prec < 0 ? rngArrivee.int(0, n - 1) : (prec + 1 + rngArrivee.int(0, n - 2)) % n;
  }

  function nouveauMessage() {
    dernier.qui = tirer(QUI.length, dernier.qui);
    dernier.quoi = tirer(QUOI.length, dernier.quoi);
    var q = QUOI[dernier.quoi];
    var m = M(QUI[dernier.qui], q.subj, H.time.hm(), q.body, { u: 1, q: q.quote, pj: q.pj });
    m.date = H.time.stamp().slice(0, 9);
    return m;
  }

  function glisser(el, dy) {
    if (H.reduced) return;
    gsap.fromTo(el, { y: dy }, { y: 0, duration: DUREE_LIGNE, ease: EASE, clearProps: 'transform', overwrite: 'auto' });
  }

  // La liste INBOX est affichée : chaque ligne prend le message du rang précédent et glisse de ce rang jusqu'au sien.
  // La barre suit le message choisi : elle est le ::before de sa ligne, qui glisse avec elle.
  function decaler(m) {
    var i;
    for (i = 0; i < R.length; i++) gsap.killTweensOf(R[i].el, 'y');
    for (i = R.length - 1; i >= 1; i--) {
      texteLigne(i, direct);
      styleLigne(i);
      glisser(R[i].el, tops[i - 1] - tops[i]);
    }
    viderLigne(0);
    selectionLigne(vue.liste.indexOf(selMsg));
    H.after(H.dur(DELAI_NOUVELLE_LIGNE), function () {
      if (vue.dossier !== 0 || vue.liste[0] !== m) return;
      texteLigne(0, H.write);
      styleLigne(0);
    });
  }

  function allumerQuota() {
    var n = Math.min(CELLULES_QUOTA, Math.ceil(quota * CELLULES_QUOTA / QUOTA_TOTAL));
    if (n === quotaLit) return;
    var avant = quotaLit;
    quotaLit = n;
    H.lit(qcell, n, CLASSES.quota.on, CLASSES.quota.off);
    for (var c = avant; c < n; c++) if (qcell[c]) remanence(qcell[c]);
  }

  function arrivee() {
    var d = DOSSIERS[0];
    var m = nouveauMessage();
    d.list.unshift(m);
    if (d.list.length > LIGNES) d.list.pop();   // la dernière sort de la liste, mais reste comptée
    d.count++;
    d.unread++;
    quota++;
    H.write(fcompte[0], H.pad(d.count, 2));
    H.write(quotaTxt, 'QUOTA  ' + quota + ' / ' + QUOTA_TOTAL + ' MB');
    // Jauge : valuetext = texte de la valeur affichée (sans le libellé) ; valuenow = mégaoctets utilisés.
    medidor.setAttribute('aria-valuetext', quota + ' / ' + QUOTA_TOTAL + ' MB');
    medidor.setAttribute('aria-valuenow', String(quota));
    allumerQuota();
    H.write(pop, 'RECV');
    gsap.set(pop, { letterSpacing: ESPACEMENT_RECV });   // « POP3 RECV » est plus long que le verre : espacement resserré
    H.after(DUREE_RECV, function () {
      H.write(pop, 'OK');
      gsap.set(pop, { clearProps: 'letterSpacing' });
    });
    if (vue.dossier === 0) decaler(m);
    statut();
    H.after(LU_APRES, function () {
      if (!m.unread) return;
      marquerLu(d, m);
      var i = vue.dossier === 0 ? vue.liste.indexOf(m) : -1;
      if (i >= 0) {
        styleLigne(i);
        remanence(R[i].rm);
      }
      statut();
    });
  }

  // ---------------------------------------------------------------- saisie de la réponse
  function ecrire(n) {
    rb[2].textContent = REPOS.rb[2] + TEXTE_SAISIE.slice(0, n);
    rChars.textContent = H.pad(BASE_CHARS + n, 3);
    curseur(2, REST_LEN + n);
  }

  function effacer(g) {
    if (g !== genSaisie) return;
    var j = TEXTE_SAISIE.length;
    var t = null;
    t = H.every(FRAPPE, function () {
      if (g !== genSaisie) { if (t) t.stop(); return; }
      j--;
      ecrire(j);
      if (j <= 0 && t) t.stop();
    }, 0);
  }

  function saisie() {
    if (selMsg !== draft) return;   // un autre message est choisi : le champ est vide
    var g = genSaisie;
    var i = 0;
    var t = null;
    t = H.every(FRAPPE, function () {
      if (g !== genSaisie) { if (t) t.stop(); return; }
      i++;
      ecrire(i);
      if (i >= TEXTE_SAISIE.length) {
        if (t) t.stop();
        H.after(EFFACE_APRES, function () { effacer(g); });
      }
    }, 0);
  }

  // ---------------------------------------------------------------- suivi de la sélection (clic ou clavier)
  H.onReady(function () {
    mesurer();
    H.cursor(curRech);
    H.cursor(curRep);
    H.suivreSelection(rows, function (el, i) { clicLigne(i); });
    H.suivreSelection(dossiers, function (el, k) { if (k !== vue.dossier) ouvrir(k); });
    H.every(PERIODE_SAISIE, saisie, PREMIERE_SAISIE);
    H.every(PERIODE_EVENEMENT, arrivee, PREMIER_EVENEMENT);
  });
})();
