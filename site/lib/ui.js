/*
 * ui.js — composants d'interface de la bibliothèque Juicy. Chargé après
 * `lib/juicy.js` et avant les thèmes.
 *
 * Le noyau fournit déjà `juicy.ui.text`, `juicy.ui.button` et
 * `juicy.ui.toggle`. Ce fichier ajoute les autres composants du contrat
 * (`panel`, `badge`, `card`, `scores`, `modal`, `cursor`) et peut remplacer
 * les trois premiers, à signature identique, en posant ses fabriques sur
 * le thème (`theme.ui`) ou en enrichissant `juicy.ui` après `Juicy.create`.
 *
 * Rempli par le mandat pixi.ui ; ce fichier ne définit encore rien.
 */
(function () {
  'use strict';
  if (!window.Juicy) { console.warn('[juicy] ui.js chargé sans le noyau'); return; }
})();
