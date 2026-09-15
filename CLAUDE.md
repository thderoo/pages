# pages

Dépôt public qui publie des pages HTML statiques via GitHub Pages.

Publication : https://thderoo.github.io/pages/

## Fonctionnement

Seul le dossier `site/` est publié. Un push sur `main` déclenche le workflow
`.github/workflows/pages.yml`, qui construit et déploie `site/` sur GitHub
Pages via GitHub Actions (source « GitHub Actions », pas de branche `gh-pages`).

Le `CLAUDE.md` et le workflow ne sont jamais servis.

## Ajouter une page

1. Créer un fichier HTML autonome dans `site/` (CSS et JS inline, aucune
   dépendance externe).
2. Commiter et pousser sur `main`.

Pas de générateur de site, pas de framework, pas d'index automatique : du
HTML statique, un fichier par page.
