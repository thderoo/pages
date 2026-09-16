/*
 * themes/rpg.js — thème « RPG » de la bibliothèque Juicy.
 *
 * Un thème :
 *   Juicy.themes.register({
 *     id, name,
 *     tokens: { colors, fonts, radius, gap, sizes },
 *     skin:   { button, toggle, text },
 *     layout(juicy, w, h) -> { <slot>: { x, y, width, height, … } },
 *     paint(juicy, w, h, plan),
 *     decor(juicy, frame) -> Container,
 *     update(juicy, dt),
 *     transition: { out(juicy), in(juicy) }
 *   });
 * Tout hook absent retombe sur celui du thème `plain` du noyau.
 *
 * Rempli par le mandat pixi.rpg ; l'enregistrement est encore vide.
 */
(function () {
  'use strict';
  if (!window.Juicy) { console.warn('[juicy] themes/rpg.js chargé sans le noyau'); return; }
  Juicy.themes.register({ id: 'rpg', name: 'RPG' });
})();
