/*
 * lib/ui.js — briques génériques de Juicy (mandat lib.ui), compagnon de
 * lib/ui.css. Chargé après lib/widgets.js : window.Juicy.defineWidget et
 * Juicy.has existent déjà (contrat §2, même convention que widgets.js).
 *
 * Apporte :
 * - le retour tactile GSAP des .juicy-btn (le repli sans GSAP est purement
 *   CSS, voir ui.css : :active + easing "back" suffit) ;
 * - le widget modal, Juicy.defineWidget('modal', ...), voir CLAUDE.md
 *   section « Composants » pour l'API appelante.
 */
(function () {
  'use strict';

  function juicy() {
    return window.Juicy;
  }

  function reducedMotion() {
    try {
      var j = juicy();
      return !!(j && j.state && j.state.reduceMotion);
    } catch (e) {
      return false;
    }
  }

  function hasGsap() {
    try {
      var j = juicy();
      return !!(j && typeof j.has === 'function' && j.has('gsap'));
    } catch (e) {
      return false;
    }
  }

  /* ---------------- retour tactile des boutons ---------------- */

  function initButtonFeedback() {
    if (!hasGsap()) return; // repli CSS déjà actif par défaut (ui.css)
    var gsap = window.gsap;
    document.documentElement.setAttribute('data-juicy-gsap-btn', 'true');

    function press(el) {
      if (reducedMotion()) return;
      gsap.to(el, { scale: 0.94, duration: 0.08, overwrite: 'auto' });
    }
    function release(el) {
      if (reducedMotion()) {
        gsap.set(el, { scale: 1 });
        return;
      }
      gsap.to(el, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.55)', overwrite: 'auto' });
    }
    function target(e) {
      return e.target && e.target.closest ? e.target.closest('.juicy-btn') : null;
    }

    document.addEventListener('pointerdown', function (e) {
      var btn = target(e);
      if (btn && !btn.disabled) press(btn);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        var btn = target(e);
        if (btn) release(btn);
      });
    });
  }

  /* ---------------- widget modal ---------------- */

  function defineModal() {
    var j = juicy();
    if (!j || typeof j.defineWidget !== 'function') return;

    // Signature (target, opts) comme tout widget (contrat §8), mais la
    // modale n'a pas de cible sur la page : l'appel documenté est
    // Juicy.widget('modal', { title, ... }), donc `target` porte les
    // options. On retombe sur `opts` si un appelant passe explicitement
    // (null, { ... }) comme les autres briques sans cible (ex. toast).
    j.defineWidget('modal', function (target, opts) {
      var o = target && typeof target === 'object' ? target : (opts || {});
      var dismissible = o.dismissible !== false;
      var instant = reducedMotion();

      var layer = document.getElementById('juicy-modal-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'juicy-modal-layer';
        document.body.appendChild(layer);
      }
      layer.style.pointerEvents = 'auto';

      var opener = document.activeElement;

      var veil = document.createElement('div');
      veil.className = 'juicy-modal-veil';

      var box = document.createElement('div');
      box.className = 'juicy-modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.tabIndex = -1;
      if (o.title) box.setAttribute('aria-label', o.title);

      var head = document.createElement('div');
      head.className = 'juicy-modal__head';
      var titleEl = document.createElement('div');
      titleEl.className = 'juicy-modal__title';
      titleEl.textContent = o.title || '';
      head.appendChild(titleEl);

      var closeBtn = null;
      if (dismissible) {
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'juicy-btn juicy-btn--icon juicy-btn--sm';
        closeBtn.setAttribute('aria-label', 'Fermer');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function () {
          destroy();
        });
        head.appendChild(closeBtn);
      }
      box.appendChild(head);

      var body = document.createElement('div');
      body.className = 'juicy-modal__body';
      if (o.html) body.innerHTML = o.html;
      else if (o.text) body.textContent = o.text;
      box.appendChild(body);

      var actionsEl = null;
      function renderActions(actions) {
        if (actionsEl) {
          actionsEl.remove();
          actionsEl = null;
        }
        if (!actions || !actions.length) return;
        actionsEl = document.createElement('div');
        actionsEl.className = 'juicy-modal__actions';
        actions.forEach(function (action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'juicy-btn juicy-btn--' + (action.variant || 'secondary');
          btn.textContent = action.label || '';
          btn.addEventListener('click', function () {
            if (typeof action.onClick === 'function') action.onClick(instance);
          });
          actionsEl.appendChild(btn);
        });
        box.appendChild(actionsEl);
      }
      renderActions(o.actions);

      veil.appendChild(box);
      layer.appendChild(veil);

      if (dismissible) {
        veil.addEventListener('click', function (e) {
          if (e.target === veil) destroy();
        });
      }
      function onKeydown(e) {
        if (e.key === 'Escape' && dismissible) destroy();
      }
      document.addEventListener('keydown', onKeydown);

      function focusBox() {
        var focusable = box.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusable || box).focus();
      }

      if (instant) {
        veil.setAttribute('data-open', 'true');
      } else {
        // deux temps : monter fermé, ouvrir au frame suivant pour que la
        // transition CSS parte bien de l'état initial (opacity:0/scale:.92).
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            veil.setAttribute('data-open', 'true');
          });
        });
      }
      focusBox();

      var destroyed = false;
      function destroy() {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener('keydown', onKeydown);

        function cleanup() {
          veil.remove();
          if (!layer.children.length) layer.style.pointerEvents = 'none';
        }
        if (instant) {
          cleanup();
        } else {
          veil.setAttribute('data-open', 'false');
          veil.addEventListener('transitionend', cleanup, { once: true });
          setTimeout(cleanup, 500); // filet si la transition ne se déclenche pas
        }
        if (opener && typeof opener.focus === 'function') {
          try {
            opener.focus();
          } catch (e) {}
        }
      }

      var instance = {
        el: box,
        update: function (patch) {
          patch = patch || {};
          if (typeof patch.title === 'string') {
            titleEl.textContent = patch.title;
            if (patch.title) box.setAttribute('aria-label', patch.title);
          }
          if (typeof patch.html === 'string') body.innerHTML = patch.html;
          if (typeof patch.text === 'string') body.textContent = patch.text;
          if (patch.actions) renderActions(patch.actions);
        },
        destroy: destroy
      };
      return instance;
    });
  }

  initButtonFeedback();
  defineModal();
})();
