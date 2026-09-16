#!/usr/bin/env node
/*
 * tools/watch.js — ouvre une page de site/ sous Chromium (playwright-core),
 * active le journal Juicy par l'URL (?juicy-log), relaie chaque ligne de
 * console au terminal telle quelle, et rejoue un scénario d'actions passé en
 * arguments par de vrais clics souris. Outil de dev, jamais publié (hors
 * site/, voir .gitignore).
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

const CDN_FILES = {
  'https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js': 'gsap.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js': 'confetti.browser.min.js',
  'https://cdn.jsdelivr.net/npm/@tsparticles/slim@3/tsparticles.slim.bundle.min.js': 'tsparticles.slim.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/tone@15/build/Tone.js': 'Tone.js',
};

function printHelp() {
  console.log(`
node tools/watch.js <page.html> [options] [actions...]

Ouvre <page.html> (relatif à site/) sous Chromium (/opt/pw-browsers/chromium,
via playwright-core), servi par python3 -m http.server (jamais file://).
Active le journal Juicy par l'URL (?juicy-log) sauf --no-log, relaie chaque
ligne de console au terminal telle quelle, puis rejoue les actions dans
l'ordre où elles apparaissent sur la ligne de commande, par de vrais clics
souris (page.mouse.click au centre de la cible, document.elementFromPoint
vérifié avant le clic).

Options globales (n'importe où sur la ligne) :
  --cdn-cache <dossier>   sert les libs CDN + Google Fonts depuis ce dossier
                          (contournement TLS du bac à sable ; fichiers
                          attendus : gsap.min.js, confetti.browser.min.js,
                          tsparticles.slim.bundle.min.js, Tone.js, fonts.css)
  --diff                  imprime le nombre de pixels changés (screenshot
                          avant/après) pour chaque action ; pour un clic
                          (toggle/fire/switch), imprime changed (total) et
                          changedOutsideControl (hors la boîte englobante du
                          contrôle cliqué, agrandie de 8px — un toggle ou un
                          bouton change lui-même d'apparence au clic, ce
                          n'est pas l'effet qu'il déclenche)
  --viewport <LxH>        taille de viewport, ex. 375x812 (défaut 1280x800)
  --reduced-motion        émule prefers-reduced-motion: reduce
  --no-log                n'ajoute pas ?juicy-log (pour vérifier le silence
                          par défaut du journal)
  --help, -h              affiche cette aide

Actions (exécutées dans l'ordre d'apparition) :
  --theme <id>            bascule le thème initial si différent du défaut
  --toggle <a,b,c>        clique le toggle de chaque effet continu, un par un
  --fire <a,b,c>          clique le bouton de chaque action ponctuelle (id
                          d'action, ex. confetti, ou id d'effet alias vers
                          son bouton par défaut, ex. burst -> confetti)
  --switch <id>           clique le bouton de nav pour basculer de thème
  --wait <ms>             attend ms millisecondes
  --screenshot <chemin>   capture le viewport dans <chemin>

Exemple :
  node tools/watch.js juicy.html --cdn-cache /chemin/vers/cdn-cache \\
    --theme rpg --toggle bg,glitch --wait 1000 --fire burst --switch neon \\
    --screenshot out.png --diff
`);
}

function parseArgs(argv) {
  let page = null;
  let cdnCache = null;
  let diff = false;
  let noLog = false;
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
    } else if (a === '--no-log') {
      noLog = true;
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

  return { page, cdnCache, diff, noLog, viewport, reducedMotion, actions };
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
    // On retire les url(...gstatic...) : les octets de police eux-mêmes ne
    // sont pas mis en cache, et laisser le navigateur les requêter échouerait
    // contre le certificat invalide du bac à sable, avec une ligne "Failed to
    // load resource" comptée comme erreur console. Sans src valide, aucune
    // requête n'est émise : le thème retombe sur sa police de repli, sans
    // conséquence pour ce qui est vérifié ici (interactions, journal, diffs).
    const raw = fs.readFileSync(fontsCssPath, 'utf8');
    const body = raw.replace(/@font-face\s*\{[^}]*\}/g, '');
    await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body }));
  }
  await context.route('https://fonts.gstatic.com/**', (route) => route.abort());
}

// excludeRect (optionnel, en px CSS viewport) : boîte englobante du contrôle
// qui vient d'être cliqué, agrandie de 8px. Un toggle ou un bouton d'action
// change lui-même d'apparence au clic (état actif, voyant, etc.) — sans
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

async function waitSwitchDone(page) {
  await page
    .waitForFunction(() => !document.documentElement.classList.contains('juicy-switching'), { timeout: 2000 })
    .catch(() => {});
}

async function withDiff(page, enabled, run) {
  const before = enabled ? await page.screenshot() : null;
  // `run` peut retourner la boîte englobante (px CSS) du contrôle cliqué,
  // à exclure du diff (voir diffPixelCount).
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

async function doTheme(page, diff, id) {
  console.log(`> theme ${id}`);
  await withDiff(page, diff, async () => {
    await page.evaluate((themeId) => {
      if (window.Juicy && window.Juicy.state.theme !== themeId) window.Juicy.setTheme(themeId);
    }, id);
    await waitSwitchDone(page);
    await page.waitForTimeout(150);
  });
}

async function measureAndVerify(page, selector) {
  // La cible peut encore bouger juste après l'action précédente (transform
  // GSAP en cours de résorption) : on remesure et on revérifie juste avant
  // de cliquer, plutôt que de cliquer sur des coordonnées obsolètes.
  let box, hit;
  for (let attempt = 0; attempt < 3; attempt++) {
    box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
    }, selector);
    if (!box) return { box: null, hit: false };
    hit = await page.evaluate(
      ({ x, y, sel }) => {
        const el = document.elementFromPoint(x, y);
        return !!(el && el.closest(sel));
      },
      { x: box.x, y: box.y, sel: selector }
    );
    if (hit) break;
    await page.waitForTimeout(150);
  }
  return { box, hit };
}

async function doClick(page, diff, kind, id, selector, isThemeSwitch) {
  console.log(`> ${kind} ${id}`);
  const found = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  }, selector);
  if (!found) {
    console.log(`  ! cible introuvable : ${selector}`);
    return;
  }
  await page.waitForTimeout(50);

  await withDiff(page, diff, async () => {
    // Mesure et vérification faites ici, juste avant le clic : la capture
    // "before" de withDiff prend elle-même du temps, pendant lequel une
    // cible mesurée trop tôt pourrait avoir bougé.
    const { box, hit } = await measureAndVerify(page, selector);
    if (!box) {
      console.log(`  ! cible disparue : ${selector}`);
      return;
    }
    if (!hit) {
      // Cliquer quand même risquerait de toucher un tout autre élément à ces
      // coordonnées (vu en pratique : un raté sur un toggle a fini par
      // cliquer un bouton de thème voisin, en 375px). Ne pas cliquer à
      // l'aveugle : signaler le raté et ne rien faire plutôt que fausser la
      // suite du scénario.
      console.log(`  ! elementFromPoint ne trouve pas la cible en (${box.x.toFixed(0)},${box.y.toFixed(0)}) après 3 essais — clic annulé`);
      return;
    }
    await page.mouse.click(box.x, box.y);
    if (isThemeSwitch) await waitSwitchDone(page);
    await page.waitForTimeout(300);
    return { x: box.left, y: box.top, width: box.width, height: box.height };
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

// Les boutons d'action générés portent l'id de l'action (ex. "confetti"),
// pas celui de l'effet ponctuel qu'ils déclenchent (ex. "burst" avec le
// preset "confetti", cf. CLAUDE.md « Les 9 actions par défaut »). --fire
// accepte les deux : id d'action direct, ou id d'effet via cet alias vers
// son bouton par défaut.
const FIRE_ID_ALIASES = { burst: 'confetti' };

async function performAction(page, diff, action) {
  switch (action.type) {
    case 'theme':
      return doTheme(page, diff, action.value);
    case 'toggle':
      return doClick(page, diff, 'toggle', action.value, `[data-juicy-toggle="${action.value}"]`, false);
    case 'fire': {
      const buttonId = FIRE_ID_ALIASES[action.value] || action.value;
      return doClick(page, diff, 'fire', action.value, `[data-juicy-action="${buttonId}"]`, false);
    }
    case 'switch':
      return doClick(page, diff, 'switch', action.value, `[data-juicy-theme-btn="${action.value}"]`, true);
    case 'wait':
      return doWait(page, diff, action.value);
    case 'screenshot':
      return doScreenshot(page, action.value);
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

    const url = `http://127.0.0.1:${port}/${opts.page}` + (opts.noLog ? '' : '?juicy-log');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Juicy && window.Juicy.state, { timeout: 5000 }).catch(() => {});
    await waitSwitchDone(page);

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
