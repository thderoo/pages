# pages

Dépôt public qui publie des pages HTML statiques via GitHub Pages.

Publication : https://thderoo.github.io/pages/

## Fonctionnement

Seul le dossier `site/` est publié. Un push sur `main` déclenche le workflow
`.github/workflows/pages.yml`, qui construit et déploie `site/` sur GitHub
Pages via GitHub Actions (source « GitHub Actions », pas de branche `gh-pages`).

Le `CLAUDE.md` et le workflow ne sont jamais servis.

## Ajouter une page

1. Créer un fichier HTML autonome dans `site/`.
2. Commiter et pousser sur `main`.

Les dépendances via CDN (jsDelivr, cdnjs) et Google Fonts sont bienvenues.

Pas de générateur de site, pas de framework, pas d'index automatique : du
HTML statique, un fichier par page.

## La bibliothèque `site/lib/` — pages interactives juicy

Le but de ce dépôt est de produire vite des pages interactives, travaillées
visuellement, sans réécrire à chaque fois les effets et l'habillage. Tout ce
travail vit dans `site/lib/`, une bibliothèque JS/CSS vanilla, sans build,
qui expose un seul objet global `window.Juicy`. Une page n'a presque rien à
écrire : elle charge les feuilles et les scripts dans l'ordre, déclare où vont
ses régions de contenu, et appelle `Juicy.init(...)`. Le style d'une page
reste entièrement libre — la lib ne force aucune esthétique, seulement une
mécanique commune (régions, effets, thèmes).

`site/juicy.html` est la vitrine de la lib (les trois thèmes, tous les
effets). `site/lib-demo.html` est l'exemple minimal à copier pour démarrer
une nouvelle page.

### Squelette minimal d'une page

```html
<link rel="stylesheet" href="lib/juicy.css">
<link rel="stylesheet" href="lib/effects.css">   <!-- si des effets continus sont utilisés -->
<link rel="stylesheet" href="lib/bursts.css">    <!-- si des effets ponctuels sont utilisés -->
<link rel="stylesheet" href="lib/widgets.css">   <!-- si des briques sont utilisées -->
<link rel="stylesheet" href="lib/ui.css">        <!-- si des composants génériques (panneaux, boutons, cartes…) sont utilisés -->
<link rel="stylesheet" href="lib/themes/<id>.css"> <!-- un par thème chargé -->

<div data-juicy-region="stage">
  <h1 data-juicy-region="title">Titre</h1>
  <!-- tagline, nav, controls, actions, scene, narration, meta : au choix -->
</div>

<script defer src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/@tsparticles/slim@3/tsparticles.slim.bundle.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/tone@15/build/Tone.js"></script>

<script defer src="lib/juicy.js"></script>
<script defer src="lib/effects.js"></script>
<script defer src="lib/bursts.js"></script>
<script defer src="lib/widgets.js"></script>
<script defer src="lib/ui.js"></script>
<script defer src="lib/themes/<id>.js"></script>

<script>
document.addEventListener('DOMContentLoaded', function () {
  Juicy.init({ theme: '<id>', controls: true });
});
</script>
```

Ne charger que ce dont la page a besoin : les 4 bibliothèques CDN sont
facultatives (chaque effet qui en dépend se désactive proprement, sans
erreur, si elles manquent), de même que `effects.css`/`bursts.css`/
`widgets.css`/`ui.css` si la page n'utilise pas ces familles. `lib-demo.html`
ne charge par exemple aucune des 4 CDN.

L'ordre compte : `lib/juicy.js` avant `effects.js`/`bursts.js`/`widgets.js`
avant `lib/ui.js` avant `lib/themes/<id>.js` avant le script inline de la
page.

### Régions sémantiques

Une page place l'attribut `data-juicy-region="<nom>"` sur les éléments
qu'elle veut confier à la lib. Seule `stage` est obligatoire ; les huit
autres (`title`, `tagline`, `nav`, `controls`, `actions`, `scene`,
`narration`, `meta`) sont facultatives — un thème absent d'une région
l'ignore ou la comble par un repli propre (ex. RPG affiche un emoji si
`scene` est absent, Candy affiche toujours son sundae). Le thème actif
déplace physiquement ces éléments dans sa mise en page (`api.mount`) et les
restaure à leur emplacement d'origine si on change de thème.

Une page qui veut un décor central animé et réactif déclare `scene` (contenu
minimal : un titre de scène suffit) et `meta` (un texte de repli du genre
« Compteur : 0 · Combo : 0 » suffit) — c'est le thème actif qui construit et
anime le reste (rpg : scène de combat ; neon : radar ; candy : sundae), et
qui tient `meta` à jour avec le compteur et le combo réels.

### `Juicy.init(opts)`

- `theme` : id du thème initial (sinon le premier thème enregistré).
- `controls` : `true` par défaut — génère les interrupteurs (`controls`) et
  les boutons d'action (`actions`) automatiquement. `false` pour une page qui
  pilote elle-même les effets par code (cas de `lib-demo.html`).
- `on` : tableau d'ids d'effets continus à activer immédiatement.
- `params` : `{ <id>: {...} }`, paramètres par effet, prioritaires sur les
  presets du thème.

`Juicy.init(...)` retourne `Juicy` (chaînable : `Juicy.init({...}).fire('burst')`).

### API publique (`window.Juicy`)

`init(opts)`, `on(id, params)`, `off(id)`, `toggle(id, params)`,
`isOn(id)`, `set(id, params)`, `fire(id, params)`, `setTheme(id)`,
`widget(name, target, opts)`, `narrate(text)`, `toast(text, opts)`,
`list()`, `has(name)` (teste un global CDN), `state`, `mountControls(opts)`,
`mountThemeNav()`, `defineEffect(def)`, `defineWidget(name, factory)`,
`registerTheme(def)`.

## Les 12 effets continus (`lib/effects.js`)

Activés/coupés par `Juicy.on(id, params)` / `Juicy.off(id)` / `Juicy.toggle(id)`,
ou par les interrupteurs générés dans la région `controls`.

| id | rôle | dépend de | cible par défaut | paramètres par défaut |
|---|---|---|---|---|
| `bg` | fond animé de particules | tsParticles (+ `loadSlim`, voir pièges) | `#juicy-bg` (couche fixe du noyau) | `count:60` (ou `density`, alias prioritaire si fourni), `color:null`, `size:6`, `speed:4`, `shape:'circle'`, `links:false`, `opacity:0.75` |
| `trail` | traînée de particules au pointeur | moteur interne (canvas) | `#juicy-canvas` (couche fixe du noyau) | `color:null`, `size:13`, `life:0.6`, `spacing:8`, `shape:'circle'`, `glyph:'•'`, `fade:true` |
| `glitch` | sauts visuels périodiques | GSAP | `[data-juicy-glitch]` > région `title` | `interval:0.15`, `jitter:0.4`, `amplitude:8`, `duration:0.12`, `hueShift:50` |
| `tilt` | bascule 3D au pointeur (fenêtre entière) | GSAP | `[data-juicy-tilt]` > le contenu de `#juicy-theme-layer` s'il n'est pas vide, sinon `[data-juicy-region="stage"]` (jamais `html`/`body`, même cible que `drunk`) | `max:6`, `scale:0.94` (mesurés aux 4 coins par `getBoundingClientRect` : la cible reste dans la fenêtre à l'angle max, voir « Contraintes de rendu »), `perspective:1200` (via `transformPerspective` GSAP, jamais `el.style.perspective`), `duration:0.3`, `ease:'power2.out'` |
| `sound` | interrupteur global du son | — | — | `confirm:'toggleOn'` (nom du son de confirmation) |
| `magnet` | éléments attirés par le pointeur | GSAP | `[data-juicy-magnet]` > `.juicy-action` | `radius:90`, `strength:0.4`, `duration:0.25`, `ease:'power2.out'` |
| `cursor` | curseur personnalisé | GSAP | `#juicy-cursor` (couche fixe du noyau) | `glyph:''`, `size:30`, `color:null`, `smoothing:0.25` |
| `rain` | pluie de glyphes | moteur interne (canvas) | — (plein écran) | `preset:null` ('snow'\|'code'\|'sparks'), `glyphs:['░','▪','·']`, `density:30`, `speed:1`, `direction:'down'`, `drift:0`, `size:16`, `rotation:0`, `color:null` |
| `shaketext` | texte tremblant | GSAP | `[data-juicy-shaketext]` > régions `title`/`tagline`, `.juicy-toggle-label`, `.juicy-action-label` | `amplitude:3`, `frequency:12`, `rotation:1.5` |
| `crt` | scanlines/vignette/souffle | — (Tone.js pour le souffle) | `#juicy-overlay` (couche fixe du noyau) | `scanlineOpacity:0.12`, `vignette:0.35`, `flicker:0.35`, `breathSpeed:1.6`, `hum:true` |
| `drunk` | tangage/skew continu | GSAP | `[data-juicy-region="stage"]`, ou le contenu de `#juicy-theme-layer` s'il n'est pas vide (jamais `html`/`body`) | `angle:2.5`, `skew:1`, `duration:2.2` |
| `music` | musique de fond | délégué à `theme.music(on, ctx)` | — | `volume:-8` |

Sauf mention contraire, la colonne « cible par défaut » suit la priorité à
trois niveaux de `resolveTargets()` (contrat lib §7) : `params.selector`
explicite (passé par la page ou un preset de thème) > marqueur
`[data-juicy-<id>]` posé par la page > repli listé ci-dessus. Un preset de
thème (`registerTheme({ presets: {...} })`) peut aussi ne réécrire que
certains paramètres (couleur, taille…) sans toucher au ciblage.

`rain` a trois presets (`snow`, `code`, `sparks`, via `params.preset`) qui ne
réécrivent que les clés encore à leur défaut — un paramètre explicite passé à
côté d'un preset reste prioritaire.

## Les 7 effets ponctuels (`lib/bursts.js`)

Déclenchés par `Juicy.fire(id, params)`, ou par les boutons générés dans la
région `actions` (les 9 actions par défaut listées ci-dessous).

| id | rôle | paramètres par défaut |
|---|---|---|
| `burst` | explosion de confettis (canvas-confetti + GSAP) | `preset:'confetti'`, `origin:'pointer'`, `count/colors/shapes/spread/gravity/duration: null` (héritent du preset) |
| `shake` | secousse de l'écran | `intensity:18`, `duration:0.5` |
| `emojiRain` | pluie ponctuelle d'emojis | `glyphs:['✨','🎉','⭐']`, `count:24`, `duration:2.2`, `size:26` |
| `counter` | compteur avec fenêtre de combo | `amount:1`, `origin:'pointer'` (fenêtre de combo 1.4s) |
| `timewarp` | ralenti temporaire (`gsap.globalTimeline.timeScale`) | `scale:0.35`, `duration:4` (secondes) |
| `everything` | déclenche tout à la fois | — |
| `reset` | réinitialise l'état des effets | — |

3 presets pour `burst` (`params.preset`) :

| preset | count | spread | gravity | duration | formes |
|---|---|---|---|---|---|
| `confetti` | 60 | 70 | 620 | 1.4 | carré, cercle |
| `firework` | 90 | 360 | 260 | 1.6 | cercle, étoile |
| `shockwave` | 40 | 360 | 40 | 0.9 | cercle |

### Les 9 actions par défaut (région `actions`, ordre d'affichage)

`confetti` (burst/confetti), `firework` (burst/firework), `shockwave`
(burst/shockwave), `shake`, `emojiRain`, `counter`, `timewarp`, `everything`,
`reset`. Cooldown 700ms par défaut entre deux clics sur un même bouton
(2000ms pour `everything`, 0 pour `reset`).

## Les 7 briques réutilisables (`lib/widgets.js`)

Instanciées par `Juicy.widget(name, target, opts)`, retournent toujours
`{ el, update(patch), destroy() }`.

| nom | rôle | options principales |
|---|---|---|
| `typewriter` | texte tapé lettre à lettre | `text`, `speed:32` (car/s), `sound` (callback par lettre), `onDone` |
| `floatNumber` | nombre flottant qui s'élève puis disparaît | `value`, `color`, `prefix`, `crit`, `duration:900` (ms), cible = élément ou `{x,y}` |
| `toast` | notification empilée dans `#juicy-toasts` | `text`, `icon`, `kind`, `duration:3000` (ms) |
| `gauge` | jauge linéaire ou radiale (SVG) | `value:0`, `max:100`, `label`, `color`, `segments:0`, `shape:'linear'\|'radial'` |
| `ticker` | bandeau défilant en boucle | `items:[]`, `speed:60`, `separator:'•'` |
| `alert` | bannière d'alerte | `text`, `level:'info'`, `blink:false` |
| `prop` | élément à sprite qui change d'état | `sprite`, `states:{nom:{text?,class?}}` (objets, pas des chaînes brutes), `react(event)` (callback fourni par l'appelant), `update({state:...})` bascule directement, `update({event:...})` passe par `react` |

`Juicy.toast(text, opts)` et `Juicy.narrate(text)` sont des raccourcis vers
la brique `toast` et le canal narratif de la région `narration`.

## Composants (`lib/ui.css` / `lib/ui.js`)

Styles et composants génériques, non spécifiques à une page : jetons,
panneaux, boutons, badges, grilles, carte, liste de scores, modale. Chargés
après `widgets.*`, avant les feuilles de thème (voir squelette ci-dessus) :
chaque thème surcharge les jetons `--juicy-*` pour que ces composants
prennent son allure sans aucune autre règle. Vitrine :
`site/ui.html` (`https://thderoo.github.io/pages/ui.html`).

### Jetons (`--juicy-*`, définis sur `:root` dans `lib/ui.css`, surchargés par thème)

| jeton | rôle |
|---|---|
| `--juicy-text-xs` … `-sm` … `-md` … `-lg` … `-xl` … `-display` | échelle typographique (`clamp`) |
| `--juicy-space-1` … `-8` | espacements (4px à 40px) |
| `--juicy-radius-sm` / `-md` / `-lg` / `-pill` | rayons |
| `--juicy-shadow-sm` / `-md` / `-lg` | ombres (ou effet de bordure/lueur thématique, voir plus bas) |
| `--juicy-duration-fast` / `-base` / `-slow` | durées de transition |
| `--juicy-bg` / `-surface` / `-text` / `-muted` / `-accent` / `-accent-text` / `-danger` / `-success` | couleurs sémantiques |
| `--juicy-layout-side` | largeur des colonnes latérales de `.juicy-layout--two`/`--three` |

`rpg` (rayons nuls, bordures doubles) détourne `--juicy-shadow-*` en doubles
liserés sans flou ; `neon` (cyan sur sombre, lueur) y réinjecte la lueur déjà
définie (`--neon-glow`) ; `candy` (pastel, rayons ronds, ombres douces)
reprend ses rayons existants et des ombres larges teintées. Les trois thèmes
ne posent aucune règle de composant, seulement ces jetons, en tête de leur
feuille.

### Composants CSS

| classe | variantes | jetons lus |
|---|---|---|
| `.juicy-panel` | `--solid` (défaut) / `--glass` ; `__head` / `__body` / `__foot` | surface, text, radius-md, shadow-md, space-3/4, text-md/sm |
| `.juicy-btn` | `--primary` / `--secondary` / `--danger` / `--icon` ; `--sm` / `--lg` ; `:hover`, `:active`, `[disabled]` | accent, accent-text, surface, text, danger, radius-md/pill, shadow-sm, text-xs/sm/lg, space-1..6, duration-fast |
| `.juicy-badge` | `--primary` / `--secondary` / `--danger` | mêmes couleurs que `.juicy-btn`, radius-pill, text-xs |
| `.juicy-layout` | `--full` / `--two` / `--three` / `--stack` ; pile sous 640px | layout-side, space-4 ; borné à `100dvh`/`100vw`, `overflow:hidden` |
| `.juicy-card` | `__media` (optionnel) / `__title` / `__text` / `__actions` | surface, text, muted, radius-md, shadow-sm |
| `.juicy-scores` | `__row`, `--first` (1ᵉʳ rang), `--me` (ma ligne) | surface, accent, accent-text, muted, radius-sm |

Le retour tactile des boutons (léger enfoncement + rebond) est purement CSS
par défaut (`:active` + easing "back") ; `lib/ui.js` prend le relais en GSAP
si la lib est chargée, pour un rebond élastique.

### Modale (`Juicy.defineWidget('modal', ...)`)

```js
var m = Juicy.widget('modal', {
  title: 'Titre',
  html: '<p>…</p>',            // ou text: '…'
  actions: [
    { label: 'Annuler', variant: 'secondary', onClick: function (modal) { modal.destroy(); } },
    { label: 'Valider', variant: 'primary', onClick: function (modal) { modal.destroy(); } }
  ],
  dismissible: true             // défaut ; false retire la fermeture voile/Échap
});
m.update({ title: '…' });       // ou html/text/actions
m.destroy();                    // ferme (rendu par toute action ou par le bouton ×)
```

Centrée dans un calque dédié (`#juicy-modal-layer`, créé à la première
ouverture) avec voile derrière — pas la couche `#juicy-overlay` du noyau,
réservée aux effets (contrat §4). Fermeture au clic sur le voile et à Échap
quand `dismissible`, focus posé dans la boîte à l'ouverture et rendu à
l'ouvreur à la fermeture, animation d'entrée/sortie (GSAP si présent, CSS
sinon), respecte `prefers-reduced-motion` (rendu direct, sans transition).

## Faire grandir la lib

Chaque page construite alimente la lib. Tout ce qui est écrit pour une page
et ne porte rien de spécifique (aucun contenu, aucun nom de page, aucune
valeur en dur qui ne soit un défaut paramétrable) descend dans la lib avant
la publication de la page, et la page consomme la version de la lib, jamais
une copie locale. Cela vaut pour les styles (panneaux, boutons, cartes,
grilles, échelles typographiques, jetons de couleur) comme pour les
composants (briques JS dans `widgets.js`, effets, presets).

- Avant d'écrire un style ou un composant pour une page, chercher dans la
  lib. S'il existe presque, l'étendre plutôt que dupliquer.
- Un ajout à la lib est paramétrable, stylable par les variables de thème,
  documenté dans la table correspondante de `projects/pages/CLAUDE.md`, et
  visible dans une vitrine (`juicy.html` pour les effets et thèmes, `ui.html`
  pour les composants).
- En fin de page, relire ce qui a été écrit dans la page elle-même et
  extraire ce qui pourrait resservir. Ce qui reste dans la page est ce qui
  n'a de sens que pour elle.

## Les 3 thèmes

Un thème enregistré via `Juicy.registerTheme(def)` (voir plus bas) impose sa
propre grille — volontairement différente d'un thème à l'autre.

### `rpg` — écran de jeu plein écran, sans défilement

Hauteur fixée au viewport, aucun scroll (le contenu qui déborde est paginé,
pas scrollé). Bandeau de statut en haut avec deux jauges PV/PM (brique
`gauge`). `controls` et `actions` en deux fenêtres de menu empilées en bas à
gauche, bordures pixel à double trait. `narration` dans une boîte de
dialogue fixe en bas, pleine largeur, rendue à la machine à écrire
(`typewriter`). Navigation clavier (flèches + Entrée), curseur `▶` devant
l'item sélectionné. Police Press Start 2P.

### `neon` — console de cockpit, trois colonnes

Panneau gauche fixe en angles coupés (`clip-path`) pour `controls` (liste
dense d'interrupteurs à voyant), panneau droit symétrique pour `actions`
(modules d'armement, chacun avec un cadran radial `gauge`). Centre en viseur
pour `scene` (réticule). `narration` en barre de télémétrie défilante
(brique `ticker`), fixée en bas d'écran. Mobile : les deux panneaux latéraux
deviennent des tiroirs qui se déplient au clic, jamais empilés en colonne.
Tout en majuscules, police Orbitron / Share Tech Mono.

### `candy` — étal de desserts, présentoir à étages

Plein écran, sans défilement (comme les deux autres thèmes, voir
« Contraintes de rendu ») : chaque région posée sur une assiette/un plateau,
présentoir à étages, tout en rondeurs, mis à l'échelle par étage
(`--candy-item-scale`, mesuré en JS) pour toujours tenir dans la fenêtre.
`scene` est toujours un sundae (brique `prop`) qui grandit, même sans région
`scene` déclarée par la page. `narration` en bulle de chantilly. Contrôles
répartis sur les présentoirs plutôt qu'alignés en grille ; en dessous de
600px, deux onglets (Réglages / Actions) remplacent l'affichage simultané
des deux présentoirs de contrôles. Polices Fredoka / Baloo 2.

### Ajouter un thème

```js
Juicy.registerTheme({
  id: 'mon-theme',
  name: 'Mon thème',              // affiché dans le sélecteur de thème (nav)
  texts: { title, tagline, controlsTitle, actionsTitle },
  labels: { bg: '…', trail: '…', /* un par toggle et par action */ },
  lines: { theme: '…', bg: '…', confetti: '…' },  // narration auto par évènement
  palette: ['#...', '#...'],       // couleurs par défaut des particules
  emojis: ['🎲'],
  cursor: '▶',
  presets: { rain: {...}, bg: {...}, burst: {...} }, // défauts par effet, propres au thème
  layout(api) {                    // OBLIGATOIRE EN PRATIQUE : construit le chrome
    api.mount('title', quelquePartDuChrome);
    // ...
  },
  teardown(api) {},                // détruit ce que layout() a créé (le noyau vide le DOM)
  onEffect(id, on, api) {},
  onFire(id, api) {},
  narrate(text, api) {},
  sound(name, api) {},             // vocabulaire fermé, voir liste ci-dessous
  music(on, api) {}
});
```

Seuls `id` et `name` sont obligatoires ; tout hook qui jette est rattrapé par
le noyau (`console.warn`, jamais une erreur qui casse la page). `api` reçu
par les hooks = le `ctx` d'effet, moins `params`/`id`, plus `api.region(name)`,
`api.mount(name, el)` et `api.themeLayer`.

Vocabulaire fermé de `sound(name)` (le noyau n'appelle jamais un autre nom) :
`toggleOn`, `toggleOff`, `hover`, `select`, `confetti`, `firework`,
`shockwave`, `shake`, `emoji`, `counter`, `combo`, `everything`, `reset`,
`theme`, `achievement`, `alert`, `type`.

La grille du nouveau thème doit rester visuellement distincte des trois
autres (position des contrôles, défilement ou non, navigation) — ce n'est pas
un habillage de couleurs sur une structure commune.

### Pièges connus

- Une racine de thème posée dans `#juicy-theme-layer` (`api.themeLayer`)
  hérite de `pointer-events:none` (couches fixes du noyau, contrat §4) : le
  thème doit explicitement remettre `pointer-events:auto` sur sa propre
  racine, sinon aucun clic n'atteint ses contrôles. S'il compte défiler
  (page qui déborde le viewport, comme `candy`), il doit aussi gérer son
  propre défilement (`overflow-y:auto` sur sa racine ou sur `#juicy-theme-layer`
  scopé au thème) : une couche fixe pleine fenêtre ne défile jamais toute
  seule.
- Le fond d'un thème doit se peindre sur `html`, pas sur `body` : `#juicy-bg`
  (couche du noyau où `bg` dessine ses particules, z-index:-1) est positionnée
  par rapport à `html`, sous `body`. Un thème qui peint son propre décor sur
  `body` (couleur ou dégradé opaque) le pose visuellement au-dessus de
  `#juicy-bg` et rend l'effet `bg` invisible sous l'habillage du thème, même
  quand il fonctionne correctement.
- Un `transform` CSS (y compris une animation qui anime `transform`, ex.
  `rotate()`) posé sur un descendant gonfle le `scrollHeight`/`scrollWidth`
  rapporté par ses ANCÊTRES sous Chromium, même sous `overflow:hidden` — ce
  n'est pas un vrai débordement visuel, mais ça déclenche à tort le garde-fou
  `checkFit()` (mesuré : le balayage radial de `neon`, en `rotate()`). Pour un
  élément décoratif animé en boucle (aiguille, balayage, curseur…), animer une
  autre propriété que `transform` — ex. une variable personnalisée typée par
  `@property` (`syntax: '<angle>'`) pilotant un `conic-gradient`, comme le
  fait `neon.css` pour `.neon-radar-sweep`.

## Contraintes de rendu

Tout tient sur la page, dans les trois thèmes : jamais de défilement, ni de
la page ni d'un conteneur interne (un thème peut border ses propres
sous-zones en `overflow:hidden`/`clip`, jamais en `overflow:auto`/`scroll`
qui laisserait apparaître une scrollbar). Un thème qui reçoit plus de
contenu que sa mise en page ne prévoit se redimensionne (mesuré en JS,
jamais en dur) plutôt que de déborder : voir les `clamp()` CSS et les
recherches par dichotomie sur une variable personnalisée d'échelle
(`--rpg-item-scale`, `--candy-item-scale`, `--neon-item-scale`) dans les
thèmes existants.

Le noyau vérifie ça lui-même : `checkFit()` (`lib/juicy.js`) compare, pour
`html` et pour chaque élément de `#juicy-theme-layer`, `scrollHeight`/
`scrollWidth` à `clientHeight`/`clientWidth` (+1px de tolérance), après
chaque bascule de thème et sur un redimensionnement débounce (150ms). Une
ligne `overflow <sélecteur> <scroll>/<client>` (`console.warn`) par
dépassement trouvé, `fit ok` sinon — seulement si le journal est actif
(`Juicy.init({log:true})` ou `?juicy-log`). Un élément volontairement plus
large que sa fenêtre visible (bandeau défilant en boucle, clippé par
`overflow:hidden` — ex. la brique `ticker`) n'est pas un débordement de
page : le marquer, lui ou son conteneur direct, avec
`data-juicy-marquee="true"` l'exempte du garde-fou (voir `neon.js`, la
région `narration`).

À vérifier avant de considérer un changement de mise en page terminé : les
trois viewports 1440×900 (desktop), 1280×720 (desktop réduit) et 375×812
(mobile), dans les trois thèmes, `fit ok` partout — `tools/watch.js
--viewport <LxH> --switch <id>` (voir plus bas) relaie directement les
lignes du journal.

## Suivre les effets

`lib/juicy.js` tient un journal : une ligne horodatée par événement (init,
changement de thème, démarrage/arrêt d'un effet continu, déclenchement d'un
effet ponctuel, `timewarp`, création/destruction de widget, erreur
rattrapée). Silencieux par défaut. Pour l'activer : `Juicy.init({ log: true })`
ou `?juicy-log` dans l'URL de la page. Les thèmes et les pages peuvent aussi
écrire dedans avec `Juicy.log(...)`.

Une ligne ressemble à :

```
[juicy +2.481s] start tilt params={"max":14,...} targets=21
```

`+2.481s` : secondes depuis `Juicy.init()`. `targets=N` : nombre d'éléments
que l'effet cible réellement — présent pour tout effet qui cible des
éléments (absent pour un effet plein écran comme `rain`). `console.warn` (au
lieu de `console.info`) si l'effet démarre avec `targets=0` ou si une lib CDN
qu'il attend manque.

**`targets=0` est un bug.** Un effet qui démarre sans rien à animer ne fait
rien de visible, silencieusement — c'est exactement ce que le journal existe
pour révéler.

Pour vérifier un scénario depuis la ligne de commande, `tools/watch.js`
(voir `tools/README.md` pour l'installation) ouvre une page sous Chromium,
active le journal, relaie chaque ligne au terminal, et rejoue une suite
d'actions par de vrais clics souris :

```
node tools/watch.js juicy.html --theme rpg --toggle bg,glitch --wait 1000 \
  --fire burst --switch neon --diff
```

`--diff` imprime, pour chaque action, `changed` (pixels changés entre les
captures avant/après) et `changedOutsideControl` (le même total hors la
boîte du contrôle cliqué) — c'est `changedOutsideControl` qui dit si l'effet
a fait quelque chose de visible, pas `changed` (qui inclut le contrôle
lui-même changeant d'apparence, ex. un toggle qui s'allume). Voir
`node tools/watch.js --help` pour toutes les options (thèmes CDN sans accès
réseau : `--cdn-cache`, mobile : `--viewport`, `prefers-reduced-motion` :
`--reduced-motion`).
