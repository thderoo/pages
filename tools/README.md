# tools

Outils de dev pour ce dépôt, non publiés (hors `site/`). Installer avec
`npm install` dans ce dossier avant le premier usage : `package.json`
déclare `playwright-core` et `pngjs`, et `node_modules/` est ignoré par git.

`watch.js` observe une page Juicy sur PixiJS depuis la ligne de commande :
ouvre la page sous Chromium, active le journal de la lib (`?juicy-log`),
relaie chaque ligne de console au terminal, et rejoue un scénario par de
vrais clics souris sur les objets Pixi (les contrôles se trouvent par leur
id via `juicy.slots`, s'atteignent par `hitTest` du système d'événements de
Pixi, et se cliquent au centre de leurs bornes globales). Voir
`watch.js --help` pour le détail des options et `--reach` pour un inventaire
« atteints/total » sans cliquer, et la section « Vérification » de
`.swarm/pages/findings/pixi-concept.md` pour la méthode.
