# pages

Dépôt public qui publie des pages HTML statiques via GitHub Pages.

Publication : https://thderoo.github.io/pages/

## Fonctionnement

Seul le dossier `site/` est publié. Un push sur `main` déclenche le workflow
`.github/workflows/pages.yml`, qui construit et déploie `site/` sur GitHub
Pages via GitHub Actions (source « GitHub Actions », pas de branche `gh-pages`).

Le `CLAUDE.md`, `tools/` et le workflow ne sont jamais servis.

## Ajouter une page

1. Créer un fichier HTML autonome dans `site/`.
2. Commiter et pousser sur `main`.

Les dépendances via CDN (jsDelivr, cdnjs) et Google Fonts sont bienvenues.

Pas de générateur de site, pas de framework, pas d'index automatique : du
HTML statique, un fichier par page.

`site/index.html` est une page de test indépendante de la lib : ne pas y
toucher.

## La bibliothèque `site/lib/` — pages juicy sur PixiJS

Une page Juicy n'est pas un document avec des effets par-dessus : c'est une
scène WebGL plein écran, comme un jeu. Un seul `<canvas>`, aucun autre DOM
que la couche d'accessibilité. Titre, tagline, interrupteurs, boutons,
narration, décor : tout est dessiné par Pixi, placé par le thème, et tient
dans la fenêtre par construction.

La lib est du JS vanilla sans build, chargé par `<script>`, et expose un
seul global `window.Juicy`.

- `site/juicy.html` — la vitrine : 12 interrupteurs, 9 boutons, 4 thèmes.
- `site/ui.html` — la vitrine des composants d'interface.
- `site/lib-demo.html` — l'exemple minimal, à copier pour démarrer.

### Squelette d'une page

Les balises exactes, dans cet ordre. Pixi doit être là avant les filtres,
GSAP avant PixiPlugin, et `lib/juicy.js` avant tout le reste de la lib.

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ma page</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="juicy.css">
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-filters@6/dist/pixi-filters.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/PixiPlugin.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/tone@15/build/Tone.js" defer></script>
<script src="lib/juicy.js"></script>
<script src="lib/effects.js"></script>
<script src="lib/ui.js"></script>
<script src="lib/themes/rpg.js"></script>
<script src="lib/themes/neon.js"></script>
<script src="lib/themes/candy.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function () {
  Juicy.create({
    theme: 'plain',
    fonts: ['Press Start 2P', 'Orbitron', 'Fredoka'],
    content: {
      title: 'Ma page',
      tagline: 'Deux boutons, un décor, quatre thèmes.',
      nav: true,
      actions: [
        { id: 'secousse', label: 'Secouer' },
        { id: 'zoom',     label: 'Zoomer' }
      ],
      scene: 'decor'
    }
  }).then(function (juicy) {
    juicy.on('action', function (e) {
      if (e.id === 'secousse') juicy.camera.shake(18, 600);
      if (e.id === 'zoom') juicy.camera.zoom(juicy.camera.state.zoom > 1 ? 1 : 1.35);
    });
  });
});
</script>
</body>
</html>
```

`juicy.css` ne fait que trois choses : `html, body` en 100 %,
`overflow: hidden`, `canvas { display: block }`. Rien d'autre ne se style en
CSS — le reste appartient au thème.

Les trois fichiers de thèmes sont facultatifs : sans eux la page tourne en
thème `plain`, qui est dans le noyau. Mais si `content.nav` est vrai, la
barre de navigation ne liste que les thèmes effectivement chargés.

### `Juicy.create(options)`

Rend une `Promise` qui résout sur l'objet `juicy` une fois les polices
chargées et le premier rendu fait. Un seul appel par page.

| option | défaut | rôle |
|---|---|---|
| `theme` | premier thème enregistré (`plain`) | id du thème initial ; `?juicy-theme=<id>` dans l'URL l'emporte |
| `log` | `false` | journal console ; `?juicy-log` dans l'URL l'active |
| `fonts` | `[]` | familles Google Fonts chargées avant le premier rendu (2,5 s de patience, puis on rend quand même) |
| `content` | `{}` | ce que la page a à montrer, voir ci-dessous |

`content` décrit des emplacements. **Un emplacement absent du `content`
n'existe pas** : le thème ne dessine rien pour lui et redonne la place aux
autres.

| champ | type | effet |
|---|---|---|
| `title` | chaîne | le titre |
| `tagline` | chaîne | la ligne sous le titre |
| `nav` | `true` ou tableau d'ids | barre de changement de thème ; `true` = tous les thèmes chargés |
| `controls` | `[{ id, label, effect }]` | interrupteurs ; `effect` est l'id d'un effet continu |
| `actions` | `[{ id, label, burst }]` | boutons ; `burst` est l'id d'un effet ponctuel, facultatif |
| `scene` | `'decor'` ou `(juicy, frame) => Container` | `'decor'` laisse le thème construire son décor animé ; une fonction rend le contenu propre à la page, que le thème place dans son cadre |
| `narration` | tableau de chaînes | lignes affichées par le thème |
| `meta` | `true` ou `(juicy, state) => string` | ligne de compteur/combo ; `true` = c'est le thème qui la formule |

Un bouton sans `burst` ne déclenche rien tout seul : il émet l'événement
`action`, à la page d'en faire quelque chose.

### L'objet `juicy`

| membre | ce que c'est |
|---|---|
| `app` | la `PIXI.Application` plein écran (`resizeTo: window`, `autoDensity`) |
| `layers` | `background`, `world`, `ui`, `overlay`, `cursor` — voir plus bas |
| `camera` | `pan(x, y, opts)`, `zoom(k, opts)`, `rotate(a, opts)`, `shake(strength, ms)`, `reset(opts)`, `state` |
| `slots` | les conteneurs nommés, voir plus bas |
| `state` | `{ counter, combo }` |
| `content` | le `content` passé à `create`, modifiable puis `relayout(true)` |
| `theme` | la définition du thème actif |
| `tokens`, `skin` | couleurs, polices, tailles, styles des composants du thème actif |
| `themes` | `register(def)`, `get(id)`, `has(id)`, `list()`, `current()`, `set(id)` |
| `effects` | `define`, `get`, `has`, `list`, `isOn`, `enable`, `disable`, `toggle`, `fire` |
| `ui` | les fabriques de composants du thème actif, voir plus bas |
| `audio` | `play(name)`, `level` (0..1, analyseur), `enabled` |
| `errors` | les exceptions attrapées dans les effets, `{ effect, phase, error }` |
| `reduced` | `true` si `prefers-reduced-motion: reduce` |
| `screen` | `{ width, height }` |
| `on(nom, fn)`, `off`, `emit` | événements `toggle`, `action`, `layout`, `theme`, `error` |
| `relayout(rebuild, rebuildScene)` | recalcule la mise en page |
| `setTheme(id)` | change de thème avec sa transition |
| `log(msg)` | écrit une ligne `[juicy +X.XXXs] …` si le journal est actif |

Les couches, dans l'ordre de rendu :

```
app.stage
 ├─ scene
 │   ├─ background   peint par le thème (fond, décor de fond)
 │   └─ world        la caméra : tout ce qui se déplace, zoome, tourne
 │       └─ slots    title, tagline, nav, controls, actions, scene,
 │                   narration, meta
 ├─ ui               au-dessus de la caméra, non transformé
 ├─ overlay          plein écran, `eventMode: 'passive'`
 └─ cursor           le curseur dessiné, `eventMode: 'none'`
```

**Les emplacements vivent dans `world`** : la caméra les emporte. Chacun
expose `.items[]` (les objets construits depuis `content`, dans le même
ordre), `.box` (la boîte que le thème lui a donnée) et `.rect` (ses bornes
réelles à l'écran).

### Effets continus

Un interrupteur les allume et les éteint. `juicy.effects.toggle(id)`,
`.enable(id)`, `.disable(id)`, `.isOn(id)`.

| id | ce qu'il fait |
|---|---|
| `bg` | milliers de particules dans `world`, dérivées par un champ de flux, repoussées par le pointeur |
| `trail` | comète au pointeur : chaîne de sprites à inertie plus braises émises en continu |
| `glitch` | découpe de l'image rendue en tranches + séparation RVB, par crises |
| `tilt` | vraie perspective : la scène est rendue dans une `RenderTexture` projetée sur un maillage |
| `sound` | nappe réactive : particules pilotées par l'analyseur audio |
| `magnet` | les objets des emplacements s'écartent ou se collent au pointeur |
| `cursor` | curseur dessiné : réticule, halo, lignes de visée, satellites, magnétisme au survol |
| `rain` | averse en `ParticleContainer` devant la scène, avec vent, gerbes au sol et éclairs |
| `shaketext` | les textes tremblent et se dédoublent |
| `crt` | tube cathodique : courbure, lignes, bruit, vignettage, bande de balayage |
| `drunk` | caméra qui tangue (rotation compensée par un dézoom), déformation en bulle, vision double |
| `music` | boucle générative Tone.js qui alimente `juicy.audio.level` |

### Effets ponctuels

Un bouton les déclenche. `juicy.effects.fire(id, opts)` ; `opts.x` / `opts.y`
donnent le point d'origine, sinon c'est le dernier point du pointeur, sinon
le centre.

| id | ce qu'il fait | options |
|---|---|---|
| `confetti` | gerbe de confettis | `x`, `y` |
| `firework` | fusée qui monte et explose | `x`, `y` |
| `shockwave` | onde de choc sur l'image rendue | `x`, `y` |
| `shake` | secousse de la caméra | `strength` (15), `ms` (620) |
| `emojiRain` | pluie d'emojis | `x`, `y` |
| `counter` | incrémente `state.counter` et le fait sauter | `value` |
| `timewarp` | ralentit le temps puis le relâche | — |
| `everything` | allume tous les effets continus et tire tous les ponctuels | — |
| `reset` | coupe tout, efface tout, remet la caméra à zéro | — |

### Composants d'interface

`juicy.ui.<fabrique>(opts)` rend un `Container` Pixi, habillé par le thème
actif. Les fabriques du noyau sont remplacées par `Juicy.ui.extend(map)`, et
un thème peut encore les redéfinir dans son champ `ui` : c'est lui qui gagne.
`juicy.ui` est recomposé à chaque changement de thème.

| fabrique | opts | ce qu'elle rend en plus |
|---|---|---|
| `style(role, over)` | — | un style de texte du thème (`title`, `tagline`, `label`, `meta`, `narration`, `nav`) |
| `text(str, o)` | `role`, `fill`, `fontSize`, `wrapWidth`, `align` | un `PIXI.Text` habillé |
| `button` | `label`, `width`, `height`, `active`, `onPress`, `accessibleTitle`, `skin` | `setLabel`, `setWidth`, `setActive` |
| `toggle` | `label`, `value`, `width`, `height`, `onChange`, `accessibleTitle`, `skin` | `setValue` |
| `panel` | `width`, `height`, `title`, `draggable`, `skin` | `content`, `setTitle`, `setSize` |
| `badge` | `label`, `value`, `skin` | `setValue`, `pulse` |
| `card` | `width`, `height`, `title`, `back`, `lines`, `backLines`, `skin` | `flip` |
| `scores` | `entries: [{ name, value }]`, `width`, `rows`, `skin` | `setEntries`, `bump` |
| `modal` | `title`, `body`, `actions`, `width`, `blur`, `skin` | `open`, `close` |
| `cursor` | `trail`, `magnet`, `size`, `skin` | `setEnabled`, `setTrail`, `setMagnet` |
| `clampToScreen(node, margin)` | — | ramène un objet dans la fenêtre |
| `draggable(node, skin)` | — | rend un objet saisissable à la souris |

`site/ui.html` les montre tous, dans les quatre thèmes.

### Thèmes

| id | nom | l'univers |
|---|---|---|
| `plain` | Sobre | dans le noyau, sans dépendance : colonnes nettes, décor d'anneau qui tourne |
| `rpg` | RPG | pixel art, fenêtres à bordure, arène en bandeau large, texte à la machine à écrire |
| `neon` | Néon | grille GLSL en fuite, balayage radar, plaques biseautées, cockpit |
| `candy` | Confiserie | fond shader pastel, coupe glacée en gelée, macarons, napperon |

Un thème est un objet passé à `Juicy.themes.register(def)` (ou, depuis un
fichier de thème, `Juicy.themes.register({...})` au chargement) :

```js
{
  id: 'mien',
  name: 'Le mien',
  tokens: { colors: {…}, fonts: {…}, radius, gap, sizes: {…} },
  skin:   { button: {…}, toggle: {…}, panel: {…}, badge: {…}, card: {…},
            scores: {…}, modal: {…}, cursor: {…}, text: {…} },
  layout: function (juicy, w, h) { return plan; },
  paint:  function (juicy, w, h, plan) { /* dessine dans layers.background */ },
  decor:  function (juicy, frame) { return container; },
  update: function (juicy, dt) { /* animation du décor */ },
  meta:   function (juicy, state) { return 'score ' + state.counter; },
  ui:     { button: maFabrique, … },
  transition: { out: function (j) {}, in: function (j) {} }
}
```

Tous les champs sauf `id` et `name` sont facultatifs : ce qui manque retombe
sur `plain`. `tokens` et `skin` sont fusionnés avec ceux de `plain`, on ne
déclare que ce qu'on change.

**La signature de mise en page** est `layout(juicy, w, h)` et elle rend un
*plan* : une boîte par emplacement, en pixels écran.

```js
layout: function (j, w, h) {
  var narrow = w < 900;
  return {
    title:     { x: 40, y: 40, width: 400, height: 70, align: 'left' },
    tagline:   { x: 40, y: 112, width: 500, height: 30 },
    nav:       { x: w - 524, y: 40, width: 484, height: 44, align: 'right', gap: 10 },
    controls:  { x: 80, y: 168, width: 200, height: 620, columns: 1, gap: 12,
                 itemAlign: 'left' },
    actions:   { x: w - 300, y: 168, width: 220, height: 500, columns: 1 },
    scene:     { x: w / 2 - 250, y: h / 2 - 250, width: 500, height: 500,
                 scaleUp: true },
    narration: { x: 40, y: h - 100, width: w - 80, height: 24, align: 'center' },
    meta:      { x: w - 240, y: 94, width: 200, height: 20, align: 'right' }
  };
}
```

| clé de boîte | effet |
|---|---|
| `x`, `y`, `width`, `height` | la boîte, en pixels écran |
| `align` | `left`, `center`, `right` — position du contenu dans la boîte |
| `valign` | `top`, `middle`, `bottom` |
| `columns` | nombre de colonnes pour les listes (`controls`, `actions`, `nav`) |
| `gap` | espace entre les objets |
| `itemAlign` | alignement de chaque objet dans sa colonne |
| `scaleUp` | autorise l'agrandissement du contenu pour remplir la boîte |

Un emplacement absent du plan reçoit une boîte de secours et une ligne
d'avertissement dans le journal : c'est un bug de thème.

Le cycle est toujours le même :
`layout` → construction des objets → application des boîtes → `paint` →
caméra → `fit ok` / `overflow` dans le journal.

### Ajouter un thème

1. Copier `site/lib/themes/candy.js` (le plus court des trois) dans
   `site/lib/themes/<id>.js`.
2. Changer `id` et `name`, refaire `tokens` et `skin`.
3. Écrire `layout(j, w, h)` : c'est le cœur du travail. Traiter au moins un
   cas large et un cas étroit (`w < 900`). Tout doit tenir dans la fenêtre
   en 1440×900, 1280×720 et 375×812.
4. Écrire `paint(j, w, h, plan)` (le fond) et `decor(j, frame)` (le contenu
   du cadre central quand `content.scene === 'decor'`), plus `update(j, dt)`
   si le décor bouge.
5. Redéfinir des fabriques dans `ui` si l'univers l'exige. Ne pas redéfinir
   ce qui se règle par `skin`.
6. Ajouter la balise `<script src="lib/themes/<id>.js"></script>` aux pages
   qui doivent le proposer, après `lib/ui.js`.
7. Vérifier avec `tools/watch.js` : `fit ok` dans les trois tailles, zéro
   avertissement, et tous les contrôles atteignables (`--reach`).

### Suivre les effets

`tools/watch.js` ouvre une page sous Chromium, sert `site/` par
`python3 -m http.server` (jamais `file://`), ajoute `?juicy-log`, relaie le
journal au terminal et rejoue un scénario par de **vrais clics souris** sur
les objets Pixi.

```sh
cd tools && npm install          # une fois : playwright-core, pngjs
node tools/watch.js juicy.html --reach
node tools/watch.js juicy.html --viewport 375x812 --toggle crt,rain --wait 3000
node tools/watch.js juicy.html --switch neon --fire confetti --diff
node tools/watch.js ui.html --theme candy --screenshot /tmp/candy.png
```

| option | rôle |
|---|---|
| `--viewport LxH` | taille de la fenêtre (défaut 1280x800) |
| `--reduced-motion` | émule `prefers-reduced-motion: reduce` |
| `--cdn-cache <dir>` | sert les scripts CDN depuis un dossier local, sans changer une URL de la page |
| `--diff` | nombre de pixels changés par action, dont ceux hors des bornes du contrôle cliqué |
| `--theme <id>` | thème initial (appel direct, pas un clic) |
| `--toggle a,b,c` | clique l'interrupteur de chaque id |
| `--fire a,b,c` | clique le bouton de chaque id |
| `--switch <id>` | clique le bouton de nav d'un thème |
| `--wait <ms>` | attend |
| `--screenshot <fichier>` | capture le viewport |
| `--reach` | inventaire « atteints/total » sans cliquer |

Un contrôle n'est **atteint** que si ses bornes globales, passées par
`juicy.layers.project()`, tiennent dans la fenêtre *et* si
`juicy.app.renderer.events.rootBoundary.hitTest()` en leur centre rend le
contrôle ou un de ses enfants. Sinon le clic est annulé et signalé, jamais
fait à l'aveugle.

Ce que le journal écrit :

- `fit ok <w>x<h> · <slot> x,y wxh · …` après chaque mise en page ; un
  `overflow <slot> …` est un bug.
- `targets=N` au démarrage d'un effet continu ; `targets=0` passe en
  avertissement, l'effet n'a rien trouvé à animer.
- `fps=N frame=X.XXms` toutes les 5 s de temps réel.

### Contraintes de rendu

- **Tout tient dans la fenêtre par construction.** La mise en page est une
  fonction de (largeur, hauteur), pas un empilement qui déborde. Tailles de
  référence : 1440×900, 1280×720, 375×812.
- **`frame` sous 8 ms** en 1440×900, tous les effets continus allumés. Sous
  le SwiftShader du bac à sable `fps` plafonne vers 10 quel que soit le
  contenu : seul `frame`, le coût processeur d'une image, est exploitable.
  Les cinq premières secondes compilent les shaders et ne comptent pas.
- **`prefers-reduced-motion` respecté** : `juicy.reduced` est vrai, les
  mouvements s'aplatissent, les particules se réduisent, les transitions
  deviennent instantanées.
- **Accessibilité** : chaque interrupteur et chaque bouton porte
  `accessible: true` et un `accessibleTitle`.
- **Aucun DOM** hors du canvas et de la couche d'accessibilité de Pixi.

### Pièges connus

- **Un enfant plein écran non interactif avale les clics.** Tout ce qui
  couvre la scène sans devoir être cliqué doit porter `eventMode: 'none'` ;
  `overlay` est en `'passive'`. `alpha = 0.001` ne préserve pas les clics et
  `visible = false` élague la branche : pour garder un objet cliquable et
  invisible, c'est `eventMode` qu'on règle, pas l'opacité.
- **Ne jamais mesurer une fenêtre de temps en cumulant `ticker.deltaMS`** :
  Pixi le plafonne à `maxElapsedMS = 100 ms`, ce qui produit un `fps=10`
  parfaitement stable — un artefact, pas une mesure.
- **Pour figer la scène, `app.ticker.speed = 0`**, jamais `ticker.stop()`,
  qui casse les tweens en cours.
- **`ParticleContainer.dynamicProperties` n'a pas de clé `scale`** : les
  clés sont `vertex`, `position`, `rotation`, `color`, `uvs`. Une échelle qui
  varie passe par `vertex`.
- **Un `Sprite` créé sur `Texture.WHITE` puis retexturé garde `scale = 256`** :
  remettre l'échelle après avoir changé la texture.
- **Dans un fragment shader maison, `uniform highp vec4 uInputSize;` est
  obligatoire** si on lit la taille de l'image d'entrée.
- **Un filtre posé sur `layers.scene` traverse toute l'interface**, qui vit
  dans `world`. Un bloom y délave les plaques claires et mange un libellé
  sombre ; baisser sa `resolution` détruit les traits fins de l'interface.
- **Un effet qui déplace les contrôles fait rater le clic suivant.** Passer
  par `juicy.layers.project()` avant de viser, comme le fait `watch.js`.
- **Pixi n'installe sa racine d'événements qu'au premier vrai pointeur** :
  un `page.mouse.move` est nécessaire avant tout `hitTest`.
- **`relayout` déclenché depuis un gestionnaire d'événement détruit l'objet
  qui traite encore son clic.** Différer d'un tour de boucle
  (`setTimeout(…, 0)`), comme le fait la narration de `juicy.html`.
- **`scaleUp` sur une grille de pixels la rend floue** : l'éviter pour un
  décor en pixel art.
- **Comparer deux captures d'une page qui suit le pointeur** demande
  `reducedMotion: 'reduce'`, sinon la moindre inertie suffit à faire diverger
  l'image.

### Faire grandir la lib

- **Un effet** se déclare avec `Juicy.effects.define(id, def)` dans
  `site/lib/effects.js`. Continu : `{ start(juicy), stop(juicy),
  update?(juicy, dt) }` — `start` rend le nombre de cibles trouvées, qui
  part au journal en `targets=N`. Ponctuel : `{ fire(juicy, opts) }`. Un
  effet ne suppose jamais qu'un emplacement existe : il lit `juicy.slots` et
  sort proprement s'il ne trouve rien.
- **Un composant** s'ajoute à `site/lib/ui.js` puis se branche par
  `Juicy.ui.extend({ nom: fabrique })`. Il lit `juicy.skin` et `juicy.tokens`
  du thème actif, jamais des couleurs en dur.
- **Un thème** suit la procédure « Ajouter un thème » plus haut.
- **Le noyau** (`site/lib/juicy.js`) ne bouge que si les trois précédents ne
  suffisent pas. Une nouveauté qui ne sert qu'à une page appartient à la page.
