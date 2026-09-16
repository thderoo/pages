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
`widgets.css` si la page n'utilise pas ces familles. `lib-demo.html` ne
charge par exemple aucune des 4 CDN.

L'ordre compte : `lib/juicy.js` avant `effects.js`/`bursts.js`/`widgets.js`
avant `lib/themes/<id>.js` avant le script inline de la page.

### Régions sémantiques

Une page place l'attribut `data-juicy-region="<nom>"` sur les éléments
qu'elle veut confier à la lib. Seule `stage` est obligatoire ; les huit
autres (`title`, `tagline`, `nav`, `controls`, `actions`, `scene`,
`narration`, `meta`) sont facultatives — un thème absent d'une région
l'ignore ou la comble par un repli propre (ex. RPG affiche un emoji si
`scene` est absent, Candy affiche toujours son sundae). Le thème actif
déplace physiquement ces éléments dans sa mise en page (`api.mount`) et les
restaure à leur emplacement d'origine si on change de thème.

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

| id | rôle | dépend de | paramètres par défaut |
|---|---|---|---|
| `bg` | fond animé de particules | tsParticles | `count:60` (ou `density`, alias prioritaire si fourni), `color:null`, `size:3`, `speed:1`, `shape:'circle'`, `links:false`, `opacity:0.6` |
| `trail` | traînée de particules au pointeur | moteur interne | `color:null`, `size:6`, `life:0.6`, `spacing:18`, `shape:'circle'`, `glyph:'•'`, `fade:true` |
| `glitch` | sauts visuels périodiques | GSAP | `selector:'[data-juicy-glitch]'`, `interval:0.9`, `jitter:0.6`, `amplitude:6`, `duration:0.08`, `hueShift:40` |
| `tilt` | bascule 3D au survol | GSAP | `selector:'[data-juicy-tilt]'`, `max:14`, `perspective:700`, `scale:1.03`, `duration:0.3`, `ease:'power2.out'` |
| `sound` | interrupteur global du son | — | `confirm:'toggleOn'` (nom du son de confirmation) |
| `magnet` | éléments attirés par le pointeur | GSAP | `selector:'[data-juicy-magnet]'`, `radius:90`, `strength:0.4`, `duration:0.25`, `ease:'power2.out'` |
| `cursor` | curseur personnalisé | GSAP | `glyph:''`, `size:18`, `color:null`, `smoothing:0.25` |
| `rain` | pluie de glyphes | moteur interne | `preset:null` ('snow'\|'code'\|'sparks'), `glyphs:['░','▪','·']`, `density:30`, `speed:1`, `direction:'down'`, `drift:0`, `size:16`, `rotation:0`, `color:null` |
| `shaketext` | texte tremblant | GSAP | `selector:'[data-juicy-shaketext]'`, `amplitude:3`, `frequency:12`, `rotation:1.5` |
| `crt` | scanlines/vignette/souffle | — (Tone.js pour le souffle) | `scanlineOpacity:0.12`, `vignette:0.35`, `flicker:0.04`, `breathSpeed:4`, `hum:true` |
| `drunk` | tangage/skew continu | GSAP | `selector:'[data-juicy-region="stage"]'`, `angle:2.5`, `skew:1`, `duration:2.2` |
| `music` | musique de fond | délégué à `theme.music(on, ctx)` | `volume:-8` |

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

### `candy` — étal de desserts, page qui défile

Défilement vertical assumé (pas de plein écran forcé) : chaque région posée
sur une assiette/un plateau, présentoir à étages en quinconce, tout en
rondeurs. `scene` est toujours un sundae (brique `prop`) qui grandit, même
sans région `scene` déclarée par la page. `narration` en bulle de chantilly.
Contrôles répartis sur les présentoirs plutôt qu'alignés en grille. Polices
Fredoka / Baloo 2.

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
