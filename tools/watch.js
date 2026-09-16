#!/usr/bin/env node
/*
 * tools/watch.js — ouvre une page de site/ (Juicy sur PixiJS 8) sous
 * Chromium (playwright-core), active le journal de la lib par l'URL
 * (?juicy-log), relaie chaque ligne de console au terminal telle quelle, et
 * rejoue un scénario d'actions passé en arguments par de vrais clics souris
 * sur les objets Pixi. Outil de dev, jamais publié (hors site/, voir
 * .gitignore).
 *
 * Un contrôle (interrupteur, bouton d'action, bouton de nav) se trouve par
 * son id via `juicy.slots` (bornes globales `getBounds()`) et s'atteint par
 * `juicy.app.renderer.events.rootBoundary.hitTest(cx, cy)` en son centre —
 * même mécanique que le harnais du noyau (mandat pixi.core), voir
 * `.swarm/pages/findings/pixi-concept.md`.
 *
 * Usage : node tools/watch.js <page.html> [options] [actions...]
 * node tools/watch.js --help pour le détail.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const SITE_DIR = path.resolve(__dirname, '..', 'site');
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

// Fichiers attendus dans --cdn-cache : les libs chargées par les pages Juicy
// (voir pixi-concept.md « Pile ») + la CSS Google Fonts.
const CDN_FILES = {
  'https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js': 'pixi.min.js',
  'https://cdn.jsdelivr.net/npm/pixi-filters@6/dist/pixi-filters.min.js': 'pixi-filters.min.js',
  'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js': 'gsap.min.js',
  'https://cdn.jsdelivr.net/npm/gsap@3/dist/PixiPlugin.min.js': 'PixiPlugin.min.js',
  'https://cdn.jsdelivr.net/npm/tone@15/build/Tone.js': 'Tone.js',
};

function printHelp() {
  console.log(`
node tools/watch.js <page.html> [options] [actions...]

Ouvre <page.html> (relatif à site/) sous Chromium (/opt/pw-browsers/chromium,
via playwright-core), servi par python3 -m http.server (jamais file://).
Ajoute ?juicy-log à l'URL, relaie chaque ligne du journal de la lib (et toute
autre ligne de console) au terminal, attend que \`Juicy.instance\` existe,
puis rejoue les actions dans l'ordre où elles apparaissent sur la ligne de
commande.

Un contrôle se trouve par son id dans \`juicy.content.controls\` /
\`.actions\` / \`.nav\`, à l'index correspondant dans \`juicy.slots.<nom>.items\`
(même ordre). Ses bornes viennent de \`getBounds()\` passées par
\`juicy.layers.project()\` — identité tant qu'aucun effet ne déforme l'image
de la scène, bornes réellement affichées quand \`tilt\` est actif. Le clic réel
(page.mouse.click) vise leur centre, et la cible n'est considérée atteinte
que si ce centre est dans la fenêtre et si
\`juicy.app.renderer.events.rootBoundary.hitTest(cx, cy)\` rend le contrôle ou
un de ses enfants — sinon le clic est annulé et signalé, jamais fait à
l'aveugle.

Options globales (n'importe où sur la ligne) :
  --cdn-cache <dossier>   sert pixi.min.js, pixi-filters.min.js, gsap.min.js,
                          PixiPlugin.min.js, Tone.js et la CSS Google Fonts
                          depuis ce dossier (contournement TLS du bac à
                          sable ; aucune URL n'est changée dans la page)
  --diff                  imprime le nombre de pixels changés (capture
                          avant/après) pour chaque action ; pour un clic
                          (toggle/fire/switch), imprime changed (total) et
                          changedOutsideControl (hors les bornes du contrôle
                          cliqué, agrandies de 8px — un interrupteur ou un
                          bouton change lui-même d'apparence au clic, ce
                          n'est pas l'effet qu'il déclenche)
  --viewport <LxH>        taille de viewport, ex. 375x812 (défaut 1280x800)
  --reduced-motion        émule prefers-reduced-motion: reduce
  --help, -h              affiche cette aide

Actions (exécutées dans l'ordre d'apparition) :
  --theme <id>            bascule le thème initial si différent du défaut
                          (appel direct à juicy.setTheme, pas un clic)
  --toggle <a,b,c>        clique l'interrupteur de chaque id de
                          juicy.content.controls, un par un
  --fire <a,b,c>          clique le bouton de chaque id de
                          juicy.content.actions, un par un
  --switch <id>           clique le bouton de nav du thème <id>
  --wait <ms>             attend ms millisecondes
  --screenshot <chemin>   capture le viewport dans <chemin>
  --reach                 liste chaque contrôle (controls + actions) avec
                          ses bornes globales, le résultat du hitTest, et un
                          total « atteints/total » en dernière ligne

Exemples :
  node tools/watch.js juicy.html --theme plain --reach \\
    --viewport 375x812 --cdn-cache /chemin/vers/cdn-cache

  node tools/watch.js juicy.html --toggle crt --wait 800 --fire confetti \\
    --diff --cdn-cache /chemin/vers/cdn-cache
`);
}

function parseArgs(argv) {
  let page = null;
  let cdnCache = null;
  let diff = false;
  let viewport = { width: 1280, height: 800 };
  let reducedMotion = false;
  const actions = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--cdn-cache') {
      cdnCache = argv[++i];
    } else if (a === '--diff') {
      diff = true;
    } else if (a === '--reduced-motion') {
      reducedMotion = true;
    } else if (a === '--viewport') {
      const m = /^(\d+)x(\d+)$/.exec(argv[++i] || '');
      if (!m) { console.error('--viewport attend LxH, ex. 375x812'); process.exit(1); }
      viewport = { width: Number(m[1]), height: Number(m[2]) };
    } else if (a === '--theme') {
      actions.push({ type: 'theme', value: argv[++i] });
    } else if (a === '--toggle') {
      String(argv[++i] || '').split(',').filter(Boolean).forEach((id) => actions.push({ type: 'toggle', value: id }));
    } else if (a === '--fire') {
      String(argv[++i] || '').split(',').filter(Boolean).forEach((id) => actions.push({ type: 'fire', value: id }));
    } else if (a === '--switch') {
      actions.push({ type: 'switch', value: argv[++i] });
    } else if (a === '--wait') {
      actions.push({ type: 'wait', value: Number(argv[++i]) });
    } else if (a === '--screenshot') {
      actions.push({ type: 'screenshot', value: argv[++i] });
    } else if (a === '--reach') {
      actions.push({ type: 'reach' });
    } else if (!a.startsWith('--') && page === null) {
      page = a;
    } else {
      console.error('Argument inconnu : ' + a);
      process.exit(1);
    }
  }

  if (!page) {
    printHelp();
    process.exit(1);
  }

  return { page, cdnCache, diff, viewport, reducedMotion, actions };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startHttpServer(port, dir) {
  return spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    const ok = await new Promise((resolve) => {
      http.get(url, (res) => { res.resume(); resolve(true); }).on('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error('python3 -m http.server ne répond pas après 5s');
}

async function installCdnCache(context, cacheDir) {
  for (const [url, file] of Object.entries(CDN_FILES)) {
    const filePath = path.join(cacheDir, file);
    if (!fs.existsSync(filePath)) {
      console.error(`! --cdn-cache: fichier manquant ${filePath}`);
      continue;
    }
    const body = fs.readFileSync(filePath);
    await context.route(url, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body }));
  }
  const fontsCssPath = path.join(cacheDir, 'fonts.css');
  if (fs.existsSync(fontsCssPath)) {
    // Les octets de police eux-mêmes ne sont pas en cache : on retire les
    // @font-face pour qu'aucune requête ne parte vers fonts.gstatic.com (le
    // certificat du bac à sable la ferait échouer, comptée comme erreur
    // console). Sans src valide, le thème retombe sur sa police système —
    // sans conséquence pour ce que watch.js vérifie (interactions, journal,
    // diffs de pixels).
    const raw = fs.readFileSync(fontsCssPath, 'utf8');
    const body = raw.replace(/@font-face\s*\{[^}]*\}/g, '');
    await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body }));
  }
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort());
}

// excludeRect (optionnel, en px CSS viewport) : bornes globales du contrôle
// qui vient d'être cliqué, agrandies de 8px. Un interrupteur ou un bouton
// change lui-même d'apparence au clic (voyant, état actif…) — sans
// l'exclure, le diff compte ce changement du contrôle, pas celui de l'effet
// qu'il déclenche. `changed` reste le total ; `changedOutsideControl` est ce
// qui reste hors de cette boîte, seul chiffre comparé au seuil du Done si.
function diffPixelCount(bufA, bufB, excludeRect) {
  const { PNG } = require('pngjs');
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`tailles de capture différentes (${a.width}x${a.height} vs ${b.width}x${b.height})`);
  }
  const THRESHOLD = 12; // tolérance anti-bruit d'encodage/antialiasing
  let ex0 = 0, ex1 = 0, ey0 = 0, ey1 = 0;
  if (excludeRect) {
    ex0 = excludeRect.x - 8;
    ex1 = excludeRect.x + excludeRect.width + 8;
    ey0 = excludeRect.y - 8;
    ey1 = excludeRect.y + excludeRect.height + 8;
  }
  let changed = 0;
  let changedOutsideControl = 0;
  const width = a.width;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (dr > THRESHOLD || dg > THRESHOLD || db > THRESHOLD) {
      changed++;
      if (excludeRect) {
        const pixelIndex = i / 4;
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        if (x < ex0 || x >= ex1 || y < ey0 || y >= ey1) changedOutsideControl++;
      } else {
        changedOutsideControl++;
      }
    }
  }
  return { changed, changedOutsideControl };
}

async function withDiff(page, enabled, run) {
  const before = enabled ? await page.screenshot() : null;
  // `run` peut retourner les bornes globales (px CSS) du contrôle cliqué, à
  // exclure du diff (voir diffPixelCount).
  const excludeRect = await run();
  if (enabled) {
    const after = await page.screenshot();
    const { changed, changedOutsideControl } = diffPixelCount(before, after, excludeRect || null);
    if (excludeRect) {
      console.log(`  diff changed=${changed} changedOutsideControl=${changedOutsideControl} px`);
    } else {
      console.log(`  diff ${changed} px`);
    }
  }
}

// Trouve le nœud Pixi d'un contrôle par son id et rend ses bornes affichées
// (bornes globales passées par la projection de la scène, cf. juicy.layers),
// le point testé et le résultat du hitTest. kind : 'control' | 'action' | 'nav'.
// Même mécanique que le harnais du mandat pixi.core (rootBoundary.hitTest,
// bornes >0 et dans la fenêtre, hit sur le contrôle ou un de ses enfants).
async function locate(page, kind, id) {
  return page.evaluate(({ kind, id }) => {
    const j = window.Juicy && window.Juicy.instance;
    if (!j) return { ok: false, error: "pas d'instance Juicy" };
    let list, slot;
    if (kind === 'control') { list = (j.content.controls || []).map((c) => c.id); slot = j.slots.controls; }
    else if (kind === 'action') { list = (j.content.actions || []).map((a) => a.id); slot = j.slots.actions; }
    else if (kind === 'nav') { list = Array.isArray(j.content.nav) ? j.content.nav : j.themes.list(); slot = j.slots.nav; }
    else return { ok: false, error: 'genre de contrôle inconnu : ' + kind };
    const idx = list.indexOf(id);
    if (idx < 0 || !slot || !slot.items[idx]) return { ok: false, error: 'contrôle introuvable : ' + kind + ' ' + id };
    const node = slot.items[idx];
    const b = node.getBounds();
    const scene = { x: b.x, y: b.y, width: b.width, height: b.height };
    // Un effet peut projeter l'image de la scène (perspective du tilt) : les
    // bornes rendues par getBounds() sont celles de la scène, pas celles de
    // l'image affichée. `juicy.layers.project` les ramène à l'écran — identité
    // tant qu'aucun effet ne déclare de projection.
    const project = (p) => (j.layers && typeof j.layers.project === 'function') ? j.layers.project(p) : p;
    const corners = [
      project({ x: scene.x, y: scene.y }),
      project({ x: scene.x + scene.width, y: scene.y }),
      project({ x: scene.x + scene.width, y: scene.y + scene.height }),
      project({ x: scene.x, y: scene.y + scene.height }),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const rect = {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      width: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      height: Math.max.apply(null, ys) - Math.min.apply(null, ys),
    };
    const mid = project({ x: scene.x + scene.width / 2, y: scene.y + scene.height / 2 });
    const cx = mid.x;
    const cy = mid.y;
    const screen = j.screen;
    const within = rect.width > 0 && rect.height > 0 &&
      rect.x >= -1 && rect.y >= -1 &&
      rect.x + rect.width <= screen.width + 1 && rect.y + rect.height <= screen.height + 1;
    let hitNode = null;
    try { hitNode = j.app.renderer.events.rootBoundary.hitTest(cx, cy); } catch (e) { hitNode = null; }
    let hit = false, n = hitNode;
    while (n) { if (n === node) { hit = true; break; } n = n.parent; }
    return { ok: true, rect, scene, cx, cy, within, hit, reachable: within && hit };
  }, { kind, id });
}

// Pixi n'installe la racine de son arbre d'événements (celle que hitTest
// interroge) qu'au premier pointeur réel reçu par la page : sans ce
// déplacement, rootBoundary.hitTest ne rend jamais rien, même sur une cible
// par ailleurs correcte. Un vrai mouvement de souris avant tout hitTest ou
// clic, une fois par page.
async function primeEvents(page, viewport) {
  await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height - 4));
  await page.mouse.move(2, 2);
  await sleep(120);
}

async function armThemeWait(page) {
  await page.evaluate(() => {
    window.__juicyThemeDone = false;
    const j = window.Juicy && window.Juicy.instance;
    if (!j) return;
    let off = null;
    off = j.on('theme', () => { window.__juicyThemeDone = true; if (off) off(); });
  });
}

async function waitThemeDone(page) {
  await page.waitForFunction(() => window.__juicyThemeDone === true, { timeout: 3000 }).catch(() => {});
}

async function doTheme(page, diff, id) {
  console.log(`> theme ${id}`);
  await withDiff(page, diff, async () => {
    await page.evaluate((themeId) => {
      const j = window.Juicy && window.Juicy.instance;
      if (j && (!j.theme || j.theme.id !== themeId)) return j.setTheme(themeId);
      return Promise.resolve(true);
    }, id);
    await page.waitForTimeout(150);
  });
}

async function doClick(page, diff, label, kind, id, waitTheme) {
  console.log(`> ${label} ${id}`);
  const loc = await locate(page, kind, id);
  if (!loc.ok) { console.log(`  ! ${loc.error}`); return; }
  if (!loc.within) { console.log(`  ! bornes hors fenêtre : ${JSON.stringify(loc.rect)}`); return; }
  if (!loc.hit) { console.log(`  ! hitTest ne trouve pas la cible en (${Math.round(loc.cx)},${Math.round(loc.cy)}) — clic annulé`); return; }

  if (waitTheme) await armThemeWait(page);
  await withDiff(page, diff, async () => {
    await page.mouse.click(loc.cx, loc.cy);
    if (waitTheme) await waitThemeDone(page);
    await page.waitForTimeout(300);
    return loc.rect;
  });
}

async function doWait(page, diff, ms) {
  console.log(`> wait ${ms}ms`);
  await withDiff(page, diff, async () => {
    await page.waitForTimeout(ms);
  });
}

async function doScreenshot(page, dest) {
  const resolved = path.resolve(process.cwd(), dest);
  await page.screenshot({ path: resolved });
  console.log(`> screenshot ${resolved}`);
}

async function doReach(page) {
  console.log('> reach');
  const ids = await page.evaluate(() => {
    const j = window.Juicy && window.Juicy.instance;
    if (!j) return { controls: [], actions: [] };
    return {
      controls: (j.content.controls || []).map((c) => c.id),
      actions: (j.content.actions || []).map((a) => a.id),
    };
  });
  let ok = 0, total = 0;
  const row = async (kind, prefix, id) => {
    const loc = await locate(page, kind, id);
    total++;
    const reachable = loc.ok && loc.reachable;
    if (reachable) ok++;
    const size = loc.ok ? `${Math.round(loc.rect.width)}x${Math.round(loc.rect.height)}` : '?';
    console.log(`  ${prefix}:${id} ${size} ${reachable ? 'ok' : 'KO'}${loc.ok ? '' : ' (' + loc.error + ')'}`);
  };
  for (const id of ids.controls) await row('control', 't', id);
  for (const id of ids.actions) await row('action', 'a', id);
  console.log(`  reach ${ok}/${total}`);
}

async function performAction(page, diff, action) {
  switch (action.type) {
    case 'theme':
      return doTheme(page, diff, action.value);
    case 'toggle':
      return doClick(page, diff, 'toggle', 'control', action.value, false);
    case 'fire':
      return doClick(page, diff, 'fire', 'action', action.value, false);
    case 'switch':
      return doClick(page, diff, 'switch', 'nav', action.value, true);
    case 'wait':
      return doWait(page, diff, action.value);
    case 'screenshot':
      return doScreenshot(page, action.value);
    case 'reach':
      return doReach(page);
    default:
      return undefined;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pagePath = path.join(SITE_DIR, opts.page);
  if (!fs.existsSync(pagePath)) {
    console.error(`Page introuvable : ${pagePath}`);
    process.exit(1);
  }

  const port = await getFreePort();
  const server = startHttpServer(port, SITE_DIR);
  let browser = null;

  const cleanup = () => {
    if (browser) browser.close().catch(() => {});
    server.kill();
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    await waitForServer(port);

    const { chromium } = require('playwright-core');
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
    const context = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: 1,
      reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
    });

    if (opts.cdnCache) await installCdnCache(context, opts.cdnCache);

    const page = await context.newPage();
    let consoleLines = 0;
    let errorCount = 0;
    let warnCount = 0;
    page.on('console', (msg) => {
      consoleLines++;
      if (msg.type() === 'error') errorCount++;
      if (msg.type() === 'warning') {
        warnCount++;
        console.log('[WARN] ' + msg.text());
      } else {
        console.log(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      errorCount++;
      console.log('[pageerror] ' + err.message);
    });

    const url = `http://127.0.0.1:${port}/${opts.page}?juicy-log`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Juicy && window.Juicy.instance && window.Juicy.instance.theme, { timeout: 5000 }).catch(() => {});
    await primeEvents(page, opts.viewport);

    for (const action of opts.actions) {
      await performAction(page, opts.diff, action);
    }

    console.log(`--- done: consoleLines=${consoleLines} errorCount=${errorCount} warnCount=${warnCount} ---`);

    await browser.close();
    browser = null;
    server.kill();
    process.exit(errorCount > 0 ? 1 : 0);
  } catch (e) {
    console.error('watch.js failed:', e);
    cleanup();
    process.exit(1);
  }
}

main();
