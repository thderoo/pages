/*
 * effects.js — effets continus, effets ponctuels et son de la bibliothèque
 * Juicy. Chargé après `lib/juicy.js`.
 *
 * Effet continu  : Juicy.effects.define(id, { start(juicy), stop(juicy), update?(juicy, dt) })
 *                  `start` peut retourner le nombre d'éléments ciblés (ou
 *                  { targets: N }) : le noyau l'inscrit au journal.
 * Effet ponctuel : Juicy.effects.define(id, { fire(juicy, opts) })
 *
 * Rempli par le mandat pixi.effects ; ce fichier ne définit encore rien.
 */
(function () {
  'use strict';
  if (!window.Juicy) { console.warn('[juicy] effects.js chargé sans le noyau'); return; }
  // Juicy.effects.define('crt', { start: …, stop: … });
})();
