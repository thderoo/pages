// Torrent tab of Playback Bench: download order strategies, piece map, playback.
//
// Usage (ES module):
//   import { mountTorrentTab } from './torrent.js'
//   const tab = mountTorrentTab(rootEl, { createHybridPlayer })
//   tab.destroy()
//
// WebTorrent 3.0.21 is loaded on demand from jsDelivr (pinned). sw.js (same folder,
// copy of webtorrent@3.0.21/dist/sw.min.js) must be served from the page's own origin.
// Notes on WebTorrent internals are in docs/webtorrent-browser.md. Private fields used
// (read-only unless said): torrent._selections._items, file._iterators, iterator._piece.

export const WEBTORRENT_URL = 'https://cdn.jsdelivr.net/npm/webtorrent@3.0.21/dist/webtorrent.min.js'
export const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev']

export const DEMO_TORRENTS = [
  { id: 'sintel', name: 'Sintel (mp4, 129 MB)', url: 'https://webtorrent.io/torrents/sintel.torrent' },
  { id: 'bbb', name: 'Big Buck Bunny (mp4, 276 MB)', url: 'https://webtorrent.io/torrents/big-buck-bunny.torrent' },
  { id: 'tos', name: 'Tears of Steel (webm, 571 MB)', url: 'https://webtorrent.io/torrents/tears-of-steel.torrent' },
  { id: 'cosmos', name: 'Cosmos Laundromat (mp4, 220 MB)', url: 'https://webtorrent.io/torrents/cosmos-laundromat.torrent' }
]

export const STRATEGIES = [
  { id: 'sequential', name: 'Sequential (native)', needsStream: false,
    text: 'WebTorrent asks for pieces from the first to the last. Without the player, nothing else interferes.' },
  { id: 'rarest', name: 'Rarest first (native)', needsStream: false,
    text: 'WebTorrent asks for the piece fewest peers have. With no peers (web seed only) every piece is equally rare, so the order is random.' },
  { id: 'random', name: 'Random (built here)', needsStream: false,
    text: 'The page picks missing pieces at random, four at a time, and selects only those.' },
  { id: 'headtail', name: 'Head + tail first (built here)', needsStream: false,
    text: 'The page downloads the last pieces first (an MP4 index often sits at the end), then everything from the start.' },
  { id: 'window', name: 'Playback window (built here)', needsStream: true,
    text: 'Only the pieces being played plus about 4 MiB ahead are downloaded. The window follows the playback position.' },
  { id: 'priority', name: 'Playback priority + fill (native with the player)', needsStream: true,
    text: 'The player’s reads jump the queue (priority 1) and everything else fills in from the start (priority 0).' },
  { id: 'stream', name: 'Streaming window (2 min ahead)', needsStream: true,
    text: 'The pieces covering the 2 minutes after the playhead are downloaded (video bytes = mean bit rate x time); the window follows the playhead. The player’s reads stay above it. Pieces kept are capped by the buffer size: the ones furthest behind the playhead are freed and asked again if you go back.' }
]

export const RATES = [
  { id: 'unlimited', name: 'Unlimited', bytes: -1 },
  { id: '5m', name: '5 MB/s', bytes: 5000000 },
  { id: '1m', name: '1 MB/s', bytes: 1000000 },
  { id: '600k', name: '600 KB/s', bytes: 600000 }
]
const DEFAULT_RATE = '1m'
// Request timeout: a request in flight longer than `mult` x the mean block time of this run is
// cancelled and asked again from another source. The mean is measured live (last BLOCK_WINDOW blocks).
// Default 5x (3x expired requests on network hiccups at unlimited rate).
export const TIMEOUTS = [
  { id: '2x', name: '2 x mean block time', mult: 2 },
  { id: '3x', name: '3 x mean block time', mult: 3 },
  { id: '5x', name: '5 x mean block time', mult: 5 },
  { id: '10x', name: '10 x mean block time', mult: 10 },
  { id: 'off', name: 'Off', mult: 0 }
]
const DEFAULT_TIMEOUT = '10x'
const BLOCK_WINDOW = 50 // blocks in the rolling mean
// Warm-up: blocks received in the first WARMUP_MS of a launch do not count in the mean, because the request
// pipeline is still filling (and the throttle burst is not over), so they are faster than the steady state.
// Measured on Sintel, Sequential, 2 web seed connections, 4 rates x 3 launches: steady state reached at
// 1.9-4.7 s after launch (rolling mean of 10 blocks within 20 % of the steady mean), so 5 s.
const WARMUP_MS = 5000
// No timeout before this many blocks have been measured after the warm-up: the mean of the first 4 blocks
// after 5 s is already within 16 % of the steady mean at every measured rate; 5 leaves some margin.
const MIN_BLOCKS = 5
// Floor on the timeout: at unlimited rate a block takes ~115 ms, so 3x the mean is ~350 ms and a 300 ms
// network hiccup expired bursts of 8-11 requests for nothing (2 launches out of 9). 1 s removes them and
// changes nothing at limited rates (1 MB/s: ~900 ms per block, limit ~2.7 s).
const MIN_TIMEOUT_MS = 1000
const HIDE_MS = 10000 // a piece taken away from the slow source is hidden from it this long (webconn.js RETRY_DELAY)
const TIMEOUT_MARK_MS = 1500 // a piece whose request timed out stays marked at least this long on the map
const WINDOW_BYTES = 4 * 1024 * 1024
const ANCHOR_WAIT_MS = 3000
// Streaming window strategy
const STREAM_AHEAD_S = 120 // seconds of video kept ready after the playhead
export const BUFFERS = [
  { id: '20', name: '20 MB', bytes: 20e6 },
  { id: '50', name: '50 MB', bytes: 50e6 },
  { id: '100', name: '100 MB', bytes: 100e6 },
  { id: '200', name: '200 MB', bytes: 200e6 },
  { id: '500', name: '500 MB', bytes: 500e6 }
]
const DEFAULT_BUFFER = '100'
const RANDOM_PARALLEL = 4
const TAIL_BYTES = 768 * 1024
const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|mov|ogv|avi|ts)$/i

/**
 * Builds the byte source used by the Hybrid player (mode 6) from a WebTorrent file.
 * `read(start, end)` reads the byte range [start, end] (end INCLUSIVE, like
 * file.createReadStream) and resolves a Uint8Array. `end` is clamped to size - 1.
 * @param {object} file a WebTorrent File
 * @returns {{ size: number, read: (start: number, end: number) => Promise<Uint8Array> }}
 */
export function createTorrentSource(file) {
  return {
    size: file.length,
    // no read-ahead: mediabunny's default ('network') reads 8 MiB blocks ahead of what it needs, which for a torrent
    // means pieces far outside the download window, asked for and then freed (Streaming window).
    prefetchProfile: 'fileSystem',
    async read(start, end) {
      const last = Math.min(end, file.length - 1)
      if (start < 0 || last < start) return new Uint8Array(0)
      const out = new Uint8Array(last - start + 1)
      let pos = 0
      for await (const chunk of file.createReadStream({ start, end: last })) {
        out.set(chunk, pos)
        pos += chunk.length
      }
      return pos === out.length ? out : out.subarray(0, pos)
    }
  }
}

let wtPromise = null
function loadWebTorrent() {
  if (!wtPromise) wtPromise = import(WEBTORRENT_URL).then(m => m.default)
  wtPromise.catch(() => { wtPromise = null })
  return wtPromise
}

let swPromise = null
function registerSW() {
  if (!swPromise) {
    swPromise = (async () => {
      if (!('serviceWorker' in navigator)) throw new Error('Service Workers are not available in this browser')
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' })
      await navigator.serviceWorker.ready
      return reg
    })()
    swPromise.catch(() => { swPromise = null })
  }
  return swPromise
}

const fmtBytes = n => {
  if (!isFinite(n)) return '-'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return Math.round(n / 1e3) + ' KB'
}

const fmtDur = s => {
  s = Math.round(s)
  if (s < 60) return s + ' s'
  const m = Math.floor(s / 60), r = s % 60
  return m + ' min' + (r ? ' ' + r + ' s' : '')
}

const STATE_LABELS = [
  ['received', 'Received'],
  ['verifying', 'Verifying'],
  ['inflight', 'In flight'],
  ['priority', 'Priority'],
  ['timedout', 'Timed out'],
  ['evicted', 'Evicted (freed)'],
  ['selected', 'Missing, selected'],
  ['deselected', 'Missing, deselected']
]
// state codes in the piece map
const S_DESELECTED = 0, S_SELECTED = 1, S_PRIORITY = 2, S_INFLIGHT = 3, S_VERIFYING = 4, S_RECEIVED = 5, S_TIMEDOUT = 6, S_EVICTED = 7
const STATE_VARS = ['--tt-deselected', '--tt-selected', '--tt-priority', '--tt-inflight', '--tt-verifying', '--tt-received', '--tt-timedout', '--tt-evicted']

/**
 * Mounts the Torrent tab into rootEl.
 * @param {HTMLElement} rootEl
 * @param {{ createHybridPlayer?: (videoEl: HTMLVideoElement, source: { size: number, read: (start: number, end: number) => Promise<Uint8Array> }) => any }} [options]
 * @returns {{ destroy: () => void, getRun: () => object | null }}
 */
let uidCounter = 0
export function mountTorrentTab(rootEl, { createHybridPlayer } = {}) {
  const uid = ++uidCounter
  rootEl.classList.add('tt')
  rootEl.innerHTML = `
    <section class="tt-card">
      <h2 class="tt-h">1. Torrent</h2>
      <div class="tt-row">
        <label class="tt-field"><span>Demo torrent</span>
          <select data-k="demo">${DEMO_TORRENTS.map(d => `<option value="${d.url}">${d.name}</option>`).join('')}</select></label>
        <label class="tt-field tt-grow"><span>Or paste a magnet link or .torrent URL</span>
          <input data-k="custom" type="text" placeholder="Paste a magnet link or .torrent URL" spellcheck="false" autocomplete="off"></label>
        <label class="tt-field" data-k="filebox" hidden><span>File to play</span>
          <select data-k="file"></select></label>
      </div>
      <p class="tt-note">Trackers are replaced by ${TRACKERS.join(' and ')}. The file read is the largest video file of the torrent.</p>
    </section>
    <section class="tt-card">
      <h2 class="tt-h">2. Download order</h2>
      <div class="tt-strats" role="radiogroup" aria-label="Download order">
        ${STRATEGIES.map((s, i) => `
          <label class="tt-strat">
            <input type="radio" name="tt-strat-${uid}" value="${s.id}"${i === 0 ? ' checked' : ''}>
            <span><b>${s.name}</b><small>${s.text}</small></span>
          </label>`).join('')}
      </div>
      <p class="tt-note" data-k="stratnote">Pure download strategies (sequential, rarest, random, head + tail) keep the player off until the file is complete, so the player’s own reads do not take over the order. Window, priority and streaming window start playback at once.</p>
    </section>
    <section class="tt-card">
      <div class="tt-row">
        <label class="tt-field"><span>3. Download limit</span>
          <select data-k="rate">${RATES.map(r => `<option value="${r.id}"${r.id === DEFAULT_RATE ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label class="tt-field"><span>Request timeout</span>
          <select data-k="timeout">${TIMEOUTS.map(r => `<option value="${r.id}"${r.id === DEFAULT_TIMEOUT ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label class="tt-field" data-k="bufferbox" hidden><span>Buffer size</span>
          <select data-k="buffer">${BUFFERS.map(r => `<option value="${r.id}"${r.id === DEFAULT_BUFFER ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <fieldset class="tt-field tt-players"><legend>4. Player</legend>
          <label><input type="radio" name="tt-player-${uid}" value="native" checked> Native video (Service Worker)</label>
          <label data-k="hybridlabel"><input type="radio" name="tt-player-${uid}" value="hybrid"> Hybrid (mode 6)<small data-k="hybridnote"></small></label>
        </fieldset>
        <div class="tt-actions">
          <button type="button" class="tt-btn tt-primary" data-k="start">Start</button>
          <button type="button" class="tt-btn" data-k="stop" disabled>Stop</button>
        </div>
      </div>
      <p class="tt-status" data-k="status" role="status">Idle.</p>
    </section>
    <section class="tt-card">
      <div class="tt-video" data-k="videobox"><div class="tt-video-empty" data-k="videoempty">The player appears here.</div></div>
    </section>
    <section class="tt-card">
      <div class="tt-maphead">
        <h2 class="tt-h">5. Piece map</h2>
        <button type="button" class="tt-btn tt-viewbtn" data-k="view" aria-pressed="false">Switch to 3D</button>
      </div>
      <div class="tt-legend">
        ${STATE_LABELS.map(([k, l]) => `<span><i class="tt-sw tt-sw-${k}"></i>${l}</span>`).join('')}
        <span><i class="tt-sw tt-sw-head"></i>Playhead</span>
        <span><i class="tt-sw tt-sw-win"></i>Window start / end</span>
      </div>
      <p class="tt-note tt-winnote" data-k="winnote" hidden></p>
      <div class="tt-mapbox" data-k="mapbox"><canvas data-k="map" aria-label="Piece map"></canvas><svg class="tt-vox" data-k="vox" aria-label="Piece map, 3D view" role="img" hidden></svg></div>
    </section>
    <section class="tt-card">
      <h2 class="tt-h">6. Stats</h2>
      <dl class="tt-stats" data-k="stats"></dl>
    </section>`

  const $ = k => rootEl.querySelector(`[data-k="${k}"]`)
  const el = {
    demo: $('demo'), custom: $('custom'), filebox: $('filebox'), file: $('file'), rate: $('rate'), timeout: $('timeout'), buffer: $('buffer'), bufferbox: $('bufferbox'), winnote: $('winnote'),
    start: $('start'), stop: $('stop'), status: $('status'), videobox: $('videobox'),
    mapbox: $('mapbox'), map: $('map'), vox: $('vox'), view: $('view'), stats: $('stats'), hybridlabel: $('hybridlabel'), hybridnote: $('hybridnote')
  }
  const strategyId = () => rootEl.querySelector(`input[name="tt-strat-${uid}"]:checked`).value
  const playerKind = () => rootEl.querySelector(`input[name="tt-player-${uid}"]:checked`).value

  const syncBufferField = () => { el.bufferbox.hidden = strategyId() !== 'stream' }
  rootEl.addEventListener('change', e => { if (e.target && e.target.name === `tt-strat-${uid}`) syncBufferField() })

  if (!createHybridPlayer) {
    el.hybridlabel.querySelector('input').disabled = true
    el.hybridlabel.classList.add('tt-disabled')
    el.hybridnote.textContent = ' (not available yet)'
  }

  let run = null // everything belonging to the current launch
  let destroyed = false

  function setStatus(t, bad) {
    el.status.textContent = t
    el.status.classList.toggle('tt-bad', !!bad)
  }

  const statRows = [
    ['downloaded', 'Downloaded'], ['speed', 'Download speed'], ['pieces', 'Pieces received'],
    ['meanblock', 'Mean block time'], ['timeouts', 'Timed-out requests'], ['peers', 'Peers (WebRTC)'], ['webseeds', 'Web seeds'], ['ttff', 'Time to first frame'], ['stalls', 'Stalls (waiting)'],
    ['buffer', 'Buffer held'], ['window', 'Window ahead'], ['evicted', 'Evicted pieces'],
    ['apath', 'Audio path (Hybrid)'], ['drift', 'A/V drift (Hybrid)']
  ]
  el.stats.innerHTML = statRows.map(([k, l]) => `<div><dt>${l}</dt><dd data-s="${k}">-</dd></div>`).join('')
  const setStat = (k, v) => { el.stats.querySelector(`[data-s="${k}"]`).textContent = v }
  function renderStats() {
    if (!run || !run.torrent) { for (const [k] of statRows) setStat(k, '-'); return }
    const t = run.torrent
    const n = run.n || 0
    let bytes = run.verifiedCount * (t.pieceLength || 0)
    if (run.n && t.bitfield && t.bitfield.get(n - 1)) bytes += (t.lastPieceLength || 0) - t.pieceLength
    setStat('downloaded', n ? `${fmtBytes(bytes)} / ${fmtBytes(t.length)}` : '-')
    setStat('speed', fmtBytes(t.downloadSpeed) + '/s')
    const sm = run.strategy && run.strategy.info ? run.strategy : null
    if (sm) {
      const held = sm.heldPieces()
      setStat('downloaded', `${fmtBytes(t.downloaded)} fetched in all`)
      setStat('pieces', `${held} held / ${n} (${run.verifiedCount} received in all)`)
    } else setStat('pieces', n ? `${run.verifiedCount} / ${n}` : '-')
    setStat('buffer', sm ? `${fmtBytes(sm.heldBytes())} / ${fmtBytes(sm.info.limit)}` : '-')
    setStat('window', sm && sm.info.bytes ? `${fmtDur(sm.info.sec)}${sm.info.limited ? ', limited by buffer' : ''} (${fmtBytes(sm.info.bytes)})` : '-')
    setStat('evicted', sm ? `${run.evictedTotal} (${run.refetched} fetched again)` : '-')
    if (sm && sm.info.bytes) {
      el.winnote.hidden = false
      el.winnote.textContent = `window: ${fmtDur(sm.info.sec)}${sm.info.limited ? ', limited by buffer' : ''}, pieces ${sm.info.a} to ${sm.info.b}`
    } else { el.winnote.hidden = true; el.winnote.textContent = '' }
    const wires = t.wires || []
    setStat('meanblock', run.blockTimes.length ? Math.round(run.blockTimes.reduce((a, b) => a + b, 0) / run.blockTimes.length) + ' ms (' + run.blockTimes.length + ' blocks)' : '-')
    setStat('timeouts', `${run.timeouts} (${run.relaunched} relaunched elsewhere, ${run.noOther} with no other source)`)
    setStat('peers', String(wires.filter(w => w.type !== 'webSeed').length))
    { const n = wires.filter(w => w.type === 'webSeed').length; setStat('webseeds', n + (n === 1 ? ' connection' : ' connections')) }
    setStat('ttff', run.ttff == null ? (run.videoAttached ? 'waiting...' : '-') : (run.ttff / 1000).toFixed(2) + ' s')
    setStat('stalls', String(run.stalls))
    const hp = run.player && run.playerKind === 'hybrid' ? run.player : null
    setStat('apath', hp && hp.apath ? hp.apath : '-')
    setStat('drift', hp && hp.drift != null ? (hp.drift >= 0 ? '+' : '') + hp.drift.toFixed(1) + ' ms' : '-')
  }

  // ---- piece map -------------------------------------------------------
  function cssColor(name) { return getComputedStyle(rootEl).getPropertyValue(name).trim() || '#888' }

  let view3d = false
  try { view3d = localStorage.getItem('ttMapView') === '3d' } catch (e) {}
  const voxView = createVoxView(el.vox, () => Math.max(100, el.mapbox.clientWidth))

  function drawMap() {
    const c = el.map
    if (!run || !run.n) {
      c.width = 0; c.height = 0; c.style.height = '0'
      el.mapbox.classList.add('tt-empty')
      voxView.reset(); el.vox.toggleAttribute('hidden', true)
      return
    }
    el.mapbox.classList.remove('tt-empty')
    if (view3d) { c.style.display = 'none'; el.vox.toggleAttribute('hidden', false); voxView.draw(run); return }
    c.style.display = ''; el.vox.toggleAttribute('hidden', true); voxView.reset()
    const w = Math.max(100, el.mapbox.clientWidth)
    const pitch = w >= 720 ? 11 : w >= 520 ? 9 : 6
    const gap = pitch >= 9 ? 2 : 1
    const cell = pitch - gap
    const cols = Math.max(1, Math.floor((w + gap) / pitch))
    const rows = Math.ceil(run.n / cols)
    const h = rows * pitch - gap
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      c.style.width = w + 'px'; c.style.height = h + 'px'
    }
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const colors = STATE_VARS.map(cssColor)
    const st = pieceStates(run)
    const at = i => [(i % cols) * pitch, Math.floor(i / cols) * pitch]
    for (let i = 0; i < run.n; i++) {
      const [x, y] = at(i)
      if (st[i] === S_EVICTED) { // freed: hollow square in the evicted colour (it was received, now gone)
        const lw = Math.max(1, Math.round(cell / 4))
        g.fillStyle = colors[S_DESELECTED]
        g.fillRect(x, y, cell, cell)
        g.strokeStyle = colors[S_EVICTED]
        g.lineWidth = lw
        g.strokeRect(x + lw / 2, y + lw / 2, cell - lw, cell - lw)
        continue
      }
      g.fillStyle = colors[st[i]]
      g.fillRect(x, y, cell, cell)
    }
    const ph = playheadPiece(run)
    run.ph = ph
    if (ph != null) {
      const [x, y] = at(ph)
      g.strokeStyle = cssColor('--tt-playhead')
      g.lineWidth = 2
      g.strokeRect(x - 1, y - 1, cell + 2, cell + 2)
    }
    const wi = run.strategy && run.strategy.info
    if (wi && wi.bytes) { // streaming window: bar before its first piece and after its last
      g.fillStyle = cssColor('--tt-window')
      const [x0, y0] = at(wi.a), [x1, y1] = at(wi.b)
      g.fillRect(x0 - 3, y0 - 2, 3, cell + 4)
      g.fillRect(x1 + cell, y1 - 2, 3, cell + 4)
    }
  }

  el.view.addEventListener('click', () => {
    view3d = !view3d
    try { localStorage.setItem('ttMapView', view3d ? '3d' : '2d') } catch (e) {}
    syncView()
    drawMap()
  })
  function syncView() {
    el.view.textContent = view3d ? 'Switch to 2D' : 'Switch to 3D'
    el.view.setAttribute('aria-pressed', String(view3d))
  }
  syncView()

  let drawQueued = false
  function scheduleDraw() {
    if (drawQueued || destroyed) return
    drawQueued = true
    requestAnimationFrame(() => { drawQueued = false; if (!destroyed) drawMap() })
  }

  // ---- launch / stop ---------------------------------------------------
  function torrentId() {
    const c = el.custom.value.trim()
    return c || el.demo.value
  }

  async function stop(message) {
    const r = run
    if (!r) return
    const closing = stopRun(r)
    el.videobox.innerHTML = '<div class="tt-video-empty">The player appears here.</div>'
    await closing
    el.stop.disabled = true
    el.start.disabled = false
    if (message) setStatus(message)
    scheduleDraw()
  }

  async function launch(fileIndex) {
    await stop()
    const strat = STRATEGIES.find(s => s.id === strategyId())
    const rate = RATES.find(x => x.id === el.rate.value)
    const r = run = createRun({ id: torrentId(), throttle: rate.bytes, playerKind: playerKind() })
    el.start.disabled = true; el.stop.disabled = false
    renderStats(); drawMap()
    try {
      const { pool, idx } = await openTorrent(r, { strategyId: strat.id, rate: rate.bytes, fileIndex, onStatus: setStatus, onVerified: scheduleDraw })
      if (r.stopped) return
      el.file.innerHTML = pool.map(i => `<option value="${i}"${i === idx ? ' selected' : ''}>${r.torrent.files[i].name}</option>`).join('')
      el.filebox.hidden = pool.length < 2
      const v = createRunVideo(r, { controls: true })
      el.videobox.innerHTML = ''
      el.videobox.appendChild(v)
      const attach = () => attachPlayer(r, { kind: playerKind(), createHybridPlayer, muted: true, onStatus: setStatus })
      startRun(r, {
        strategyId: strat.id,
        bufferBytes: () => BUFFERS.find(x => x.id === el.buffer.value).bytes,
        timeoutMult: () => TIMEOUTS.find(x => x.id === el.timeout.value).mult,
        attach,
        onTick() {
          renderStats()
          const d0 = performance.now(); drawMap(); r.drawMs = (r.drawMs || 0) + performance.now() - d0; r.draws = (r.draws || 0) + 1
          if (r.verifiedCount >= r.n && !(r.strategy && r.strategy.info)) setStatus('Download complete.')
        }
      })
      if (strat.needsStream) attach()
      setStatus(strat.needsStream ? 'Downloading and playing.' : 'Downloading (the player starts when the file is complete).')
    } catch (e) {
      console.error(e)
      setStatus('Failed: ' + (e && e.message ? e.message : e), true)
      el.start.disabled = false
    }
  }

  el.start.addEventListener('click', () => launch(null))
  el.stop.addEventListener('click', () => stop('Stopped.'))
  el.file.addEventListener('change', () => launch(Number(el.file.value)))
  const rerate = () => { if (run && run.client) { const x = RATES.find(q => q.id === el.rate.value); run.client.throttleDownload(x.bytes); run.throttle = x.bytes } }
  el.rate.addEventListener('change', rerate)
  const onResize = () => scheduleDraw()
  window.addEventListener('resize', onResize)
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  if (mq && mq.addEventListener) mq.addEventListener('change', onResize)

  syncBufferField()
  renderStats()

  return {
    destroy() {
      destroyed = true
      window.removeEventListener('resize', onResize)
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onResize)
      stop()
      rootEl.innerHTML = ''
      rootEl.classList.remove('tt')
    },
    getRun() { return run }
  }
}

// ======================================================================
// Engine shared by the Torrent and Player tabs: nothing below touches the DOM of a tab.
// A "run" is one launch (createRun); openTorrent connects and picks the file, createRunVideo
// makes the <video>, startRun runs the Streaming window / timeout ticker, attachPlayer starts
// playback, stopRun ends everything. pieceStates / playheadPiece / pieceTime read a run;
// createVoxView draws the 3D view of its pieces.
// ======================================================================

export function createRun({ id, throttle, playerKind }) {
  return {
    id, order: [], times: [], verifiedCount: 0, stalls: 0, ttff: null, videoAttached: false,
    t0: performance.now(), n: 0, torrent: null, file: null, client: null, video: null, stopped: false, player: null,
    throttle, playerKind,
    timeouts: 0, relaunched: 0, noOther: 0, evicted: new Set(), evictedTotal: 0, refetched: 0, healed: 0, anchor: null, seekAt: 0, timedOut: new Map(), reqInfo: new WeakMap(), blockTimes: [], hideTimers: new Set()
  }
}

export function pieceStates(run) {
    const t = run.torrent, n = run.n
    const st = new Uint8Array(n) // S_DESELECTED
    const sels = (t._selections && t._selections._items) || []
    for (const s of sels) {
      const code = s.priority > 0 ? S_PRIORITY : S_SELECTED
      for (let i = Math.max(0, s.from); i <= s.to && i < n; i++) if (code > st[i]) st[i] = code
    }
    for (const w of t.wires || []) for (const r of w.requests || []) if (r.piece < n) st[r.piece] = S_INFLIGHT
    for (let i = 0; i < n; i++) {
      if (t.bitfield.get(i)) st[i] = S_RECEIVED
      else { const p = t.pieces[i]; if (p && p.missing < p.length) st[i] = S_VERIFYING }
    }
    for (const i of run.timedOut.keys()) if (i < n && !t.bitfield.get(i)) st[i] = S_TIMEDOUT
    for (const i of run.evicted) if (i < n && !t.bitfield.get(i) && st[i] <= S_SELECTED) st[i] = S_EVICTED
    return st
  }

  // Playhead piece. At a variable bit rate "currentTime / duration x size" is off by several pieces, so the
  // position is anchored on the bytes the player really reads: after a seek (and at the start) the first read
  // of the player near the estimated position gives the piece where playback restarts (noteRead); from there the
  // position advances with the playback time at the mean bit rate. Until such a read has been seen, the linear
  // estimate is used. The first read within ANCHOR_WAIT_MS of the seek, and within 15 % of the file of the
  // estimate (at a variable bit rate the estimate was 8 pieces off on Sintel, 62 on Big Buck Bunny), is taken.
  const playerReady = r => { const v = r.video; return !!(r.file && v && r.videoAttached && isFinite(v.duration) && v.duration > 0) }
  function linearPiece(r) {
    const v = r.video
    const bytePos = r.file.offset + Math.min(1, v.currentTime / v.duration) * r.file.length
    return Math.min(r.n - 1, Math.floor(bytePos / r.torrent.pieceLength))
  }
  function noteRead(r, piece) {
    if (r.anchor || r.stopped || !playerReady(r)) return
    if (performance.now() - r.seekAt > ANCHOR_WAIT_MS) return // only the first reads after a seek: later ones (read-ahead, audio) are not the position
    if (Math.abs(piece - linearPiece(r)) <= Math.max(30, Math.ceil(0.15 * r.n))) r.anchor = { piece, time: r.video.currentTime }
  }
  export function playheadPiece(run) {
    if (!run || !run.torrent || !playerReady(run)) return null
    const r = run, v = r.video
    if (!r.anchor) return linearPiece(r)
    const pl = r.torrent.pieceLength
    const p = Math.floor(r.anchor.piece + (v.currentTime - r.anchor.time) * (r.file.length / v.duration) / pl)
    return Math.max(r.file._startPiece, Math.min(r.file._endPiece, p))
  }
  // Inverse of playheadPiece: the playback time at which piece p starts (same anchor, same mean bit rate).
  export function pieceTime(r, p) {
    const v = r.video
    if (!playerReady(r)) return 0
    const pl = r.torrent.pieceLength
    const t = r.anchor
      ? r.anchor.time + (p - r.anchor.piece) * pl * v.duration / r.file.length
      : (p * pl - r.file.offset) / r.file.length * v.duration
    return Math.max(0, Math.min(v.duration, t))
  }

  // ---- piece map, 3D view ----------------------------------------------
  // One cube per piece on a flat surface, columns = rows ~ sqrt(n), in file order row after row. Isometric, drawn
  // in SVG as hexagons (top + two sides), back to front (increasing column + row). The DOM is built once per
  // run and size; a sample only touches the cubes whose state changed. Arrival and release are animated by a
  // short-lived copy of the cube inside its own cell group (CSS transform / opacity, ANIM_MS, ease-in-out), so it
  // keeps the draw order of its cell: cubes in front of it hide it. The cube in its place changes state when the
  // fall ends (arrival) or at once (release).
  // "Not yet arrived" = 0.5 opacity is rendered by mixing the face colour with the card background (--k): same
  // look as opacity 0.5 over the card, but the faces of a cube hidden behind a neighbour do not show through.
  const SVGNS = 'http://www.w3.org/2000/svg'
  const ANIM_MS = 500, MAX_FX = 60
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const svgEl = (tag, attrs, cls) => {
    const e = document.createElementNS(SVGNS, tag)
    if (cls) e.setAttribute('class', cls)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    return e
  }

  // Generalized Hilbert curve on a width x height rectangle ("gilbert", Jakub Cerveny,
  // github.com/jakubcerveny/gilbert, Copyright (c) 2018 Jakub Cerveny, BSD 2-Clause licence), rewritten here. Returns [x0, y0, x1, y1, ...].
  function gilbert(width, height) {
    const out = []
    const sgn = v => (v > 0) - (v < 0)
    const gen = (x, y, ax, ay, bx, by) => {
      const w = Math.abs(ax + ay), h = Math.abs(bx + by)
      const dax = sgn(ax), day = sgn(ay), dbx = sgn(bx), dby = sgn(by)
      if (h === 1) { for (let i = 0; i < w; i++) { out.push(x, y); x += dax; y += day } return }
      if (w === 1) { for (let i = 0; i < h; i++) { out.push(x, y); x += dbx; y += dby } return }
      let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2), bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2)
      const w2 = Math.abs(ax2 + ay2), h2 = Math.abs(bx2 + by2)
      if (2 * w > 3 * h) { // long case: split in two along the long side
        if (w2 % 2 && w > 2) { ax2 += dax; ay2 += day }
        gen(x, y, ax2, ay2, bx, by)
        gen(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by)
      } else { // standard case: up, along, down
        if (h2 % 2 && h > 2) { bx2 += dbx; by2 += dby }
        gen(x, y, bx2, by2, ax2, ay2)
        gen(x + bx2, y + by2, ax, ay, bx - bx2, by - by2)
        gen(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby), -bx2, -by2, -(ax - ax2), -(ay - ay2))
      }
    }
    if (width >= height) gen(0, 0, width, 0, 0, height)
    else gen(0, 0, 0, height, width, 0)
    return out
  }
  // Rectangle for n cubes: the fewest empty cells, close to a square (width : height between 0.8 and 1.25), then the closest to a square.
  function voxRect(n) {
    const s = Math.sqrt(n)
    let best = null
    for (let c = Math.max(1, Math.floor(s * 0.8)); c <= Math.ceil(s * 1.25); c++) {
      const r = Math.ceil(n / c), k = [c * r - n, Math.abs(c - r)]
      if (r / c >= 0.8 && r / c <= 1.25 && (!best || k[0] < best.k[0] || (k[0] === best.k[0] && k[1] < best.k[1]))) best = { c, r, k }
    }
    return best ? [best.c, best.r] : [Math.ceil(s), Math.ceil(n / Math.ceil(s))]
  }

  /**
   * 3D view of the pieces of a run, drawn into an <svg>. draw(run) builds the cubes once per run and width,
   * then only touches the ones whose state changed; reset() empties it.
   * @param {SVGElement} svg
   * @param {() => number} getWidth width in px the view may take
   */
  export function createVoxView(svg, getWidth) {
  let vox = null
  function buildVox(run, w) {
    const n = run.n
    const [cols, rows] = voxRect(n)
    const curve = gilbert(cols, rows) // piece i sits on the i-th cell of the curve; the cells after the last piece stay empty
    const cx = i => curve[2 * i], cy = i => curve[2 * i + 1]
    const occ = new Uint8Array(cols * rows)
    for (let i = 0; i < n; i++) occ[cy(i) * cols + cx(i)] = 1
    const a = Math.min(22, w / (cols + rows)) // half width of a cube
    const b = a / Math.sqrt(3), h = 2 * b // iso: top rhombus a x b, edge height h
    const e = h, M = Math.ceil(6 * e), W = (cols + rows) * a, H = M + (cols + rows) * b + h
    svg.replaceChildren()
    svg.setAttribute('viewBox', `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`)
    svg.style.setProperty('--vd', (5 * e).toFixed(2) + 'px')
    svg.style.setProperty('--lw', (W / w).toFixed(3)) // 1 screen px of the curve, in viewBox units
    svg.style.setProperty('--sw', Math.max(0.5, a * 0.07).toFixed(2))
    const P = pts => pts.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' ')
    const top = P([[0, -b], [a, 0], [0, b], [-a, 0]])
    const left = P([[-a, 0], [0, b], [0, b + h], [-a, h]])
    const right = P([[a, 0], [0, b], [0, b + h], [a, h]])
    const col = P([[-a, 0], [0, b], [a, 0], [a, -5 * e], [0, -b - 5 * e], [-a, -5 * e]])
    const floor = k => P([[0, -b * k], [a * k, 0], [0, b * k], [-a * k, 0]]) // outline on the cube's top face
    const exists = (c, r) => c < cols && r < rows && occ[r * cols + c] === 1
    const pos = i => { const c = cx(i), r = cy(i); return [(c - r + rows) * a, M + (c + r) * b + b] }
    const faces = g => { // the three faces of a cube; the two sides only where nothing in front hides them
      g.append(svgEl('polygon', { points: top }, 'ft'))
      return g
    }
    const gLayer = svgEl('g'), marks = svgEl('g', {}, 'marks')
    const cells = new Array(n)
    const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => (cx(p) + cy(p)) - (cx(q) + cy(q)) || cx(p) - cx(q))
    for (const i of order) {
      const c = cx(i), r = cy(i)
      const [x, y] = pos(i)
      const g = svgEl('g', { transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})` }, 'v s0')
      faces(g)
      // the curve on the top face: the half of the segment to the previous and to the next piece, centre to edge
      // midpoint, drawn in the cell's own group so it keeps the draw order of the cell (the animated copy is added after it)
      const seg = []
      for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) { const [px, py] = pos(j); seg.push([(px - x) / 2, (py - y) / 2]) }
      if (seg.length) g.append(svgEl('path', { d: seg.length === 2 ? `M${seg[0][0].toFixed(2)} ${seg[0][1].toFixed(2)}L0 0L${seg[1][0].toFixed(2)} ${seg[1][1].toFixed(2)}` : `M${seg[0][0].toFixed(2)} ${seg[0][1].toFixed(2)}L0 0` }, 'cv'))
      if (!(exists(c, r + 1) && exists(c + 1, r + 1))) g.append(svgEl('polygon', { points: left }, 'fl'))
      if (!(exists(c + 1, r) && exists(c + 1, r + 1))) g.append(svgEl('polygon', { points: right }, 'fr'))
      gLayer.append(g)
      cells[i] = g
    }
    const mk = (cls, k) => { const m = svgEl('polygon', { points: floor(k) }, 'mk ' + cls); m.style.display = 'none'; marks.append(m); return m }
    const mWinA = mk('mk-win', 1), mWinB = mk('mk-win', 1), mHead = mk('mk-head', .6)
    svg.append(gLayer, marks)
    vox = {
      run, n, w, cells, pos, a, b, h, e, left, right, top, col, st: null, want: null, pend: new Uint8Array(n),
      m: { winA: mWinA, winB: mWinB, head: mHead }, mpos: { winA: -1, winB: -1, head: -1 }, nfx: 0
    }
  }

  const voxApply = (v, i, s) => {
    const g = v.cells[i]
    g.setAttribute('class', 'v s' + s)
    if (s === S_INFLIGHT && !g.querySelector('.vc')) g.insertBefore(svgEl('polygon', { points: v.col }, 'vc'), g.firstChild)
  }

  function voxAnimate(v, i, s, kind) { // a copy of the cube, in state s, falls in or flies away, inside its own cell: it keeps the draw order of the cell
    const o = svgEl('g', {}, 'v s' + s + (kind === 'fall' ? ' fx-fall' : ' fx-fly'))
    o.append(svgEl('polygon', { points: v.left }, 'fl'), svgEl('polygon', { points: v.right }, 'fr'), svgEl('polygon', { points: v.top }, 'ft'))
    v.cells[i].append(o)
    v.nfx++
    let done = false
    const end = () => {
      if (done) return
      done = true
      o.remove(); v.nfx--
      if (kind === 'fall' && vox === v) { v.pend[i] = 0; voxApply(v, i, v.want[i]) }
    }
    o.addEventListener('animationend', end)
    setTimeout(end, ANIM_MS + 400) // safety: a hidden tab does not run animations
    v.pend[i] = kind === 'fall' ? 1 : 0
  }

  function drawVox(run) {
    const w = getWidth()
    if (!vox || vox.run !== run || vox.n !== run.n || vox.w !== w) buildVox(run, w)
    const v = vox, st = pieceStates(run), n = run.n
    const first = !v.st
    const reduce = !!(reduceMq && reduceMq.matches)
    if (first) { v.st = new Uint8Array(n); v.want = new Uint8Array(n) }
    for (let i = 0; i < n; i++) {
      const s = st[i], prev = v.st[i]
      if (!first && s === prev) continue
      v.st[i] = s; v.want[i] = s
      if (first) { voxApply(v, i, s); continue }
      if (v.pend[i]) continue // falling in: shows the latest state when it lands
      const arrives = s === S_RECEIVED && prev !== S_RECEIVED, leaves = prev === S_RECEIVED && s !== S_RECEIVED
      if (arrives && !reduce && v.nfx < MAX_FX) voxAnimate(v, i, S_RECEIVED, 'fall')
      else {
        if (leaves && !reduce && v.nfx < MAX_FX) voxAnimate(v, i, S_RECEIVED, 'fly')
        voxApply(v, i, s)
      }
    }
    // marks on the surface: playhead, window start and end (outline on the top face of the cube)
    const wi = run.strategy && run.strategy.info
    const ph = playheadPiece(run)
    run.ph = ph
    const put = (key, i) => {
      if (v.mpos[key] === i) return
      v.mpos[key] = i
      const m = v.m[key]
      if (i < 0) { m.style.display = 'none'; return }
      const [x, y] = v.pos(i)
      m.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      m.style.display = ''
    }
    put('head', ph == null ? -1 : ph)
    put('winA', wi && wi.bytes ? wi.a : -1)
    put('winB', wi && wi.bytes ? wi.b : -1)
  }
  return { draw: drawVox, reset() { vox = null; svg.replaceChildren() } }
  }

  // ---- strategies ------------------------------------------------------
  // Each returns { tick() } or nothing. torrent was added with deselect:true when
  // the strategy builds its own selection.
  const OWN_SELECTION = new Set(['random', 'headtail', 'window', 'stream'])

  // The player's reads are WebTorrent stream selections; the strategies rewrite their range (clip), so two things must hold:
  //  - a selection that WebTorrent dropped because its (clipped) range was complete is put back when its reader is still
  //    alive and the range moves on (otherwise the reader waits for a piece nobody asks for);
  //  - when the reader ends, its own selection is the one removed. WebTorrent removes "the first selection with the
  //    reader's original range": with two reads of the same range (the Hybrid player reads fixed 8 MB blocks) that took
  //    the other reader's selection and left an orphan covering the whole old range.
  function reattach(t, rec) {
    const items = t._selections._items
    if (!items.includes(rec.sel)) { rec.sel.offset = 0; items.push(rec.sel); return true }
    return false
  }
  function ownDestroy(t, it, rec, restore) {
    const destroy = it.destroy.bind(it)
    it.destroy = (...a) => {
      restore()
      const items = t._selections._items
      const k = items.indexOf(rec.sel)
      if (k >= 0) items.splice(k, 1)
      const s0 = it._startPiece, e0 = it._endPiece
      it._startPiece = -1; it._endPiece = -2 // so that WebTorrent's own removal by range matches nothing
      try { return destroy(...a) } finally { it._startPiece = s0; it._endPiece = e0 }
    }
  }

  // cfg.bufferBytes() gives the buffer limit of the Streaming window.
  function setupStrategy(id, r, cfg) {
    const t = r.torrent, n = r.n
    if (id === 'random') {
      const picked = new Uint8Array(n)
      const pending = new Set()
      return {
        tick() {
          for (const i of [...pending]) if (t.bitfield.get(i)) pending.delete(i)
          while (pending.size < RANDOM_PARALLEL && r.verifiedCount + pending.size < n) {
            const missing = []
            for (let i = 0; i < n; i++) if (!picked[i] && !t.bitfield.get(i)) missing.push(i)
            if (!missing.length) break
            const i = missing[Math.floor(Math.random() * missing.length)]
            picked[i] = 1; pending.add(i)
            t.select(i, i, 0)
          }
        }
      }
    }
    if (id === 'headtail') {
      const tail = Math.max(2, Math.ceil(TAIL_BYTES / t.pieceLength))
      const from = Math.max(1, n - tail)
      let restDone = false
      t.select(from, n - 1, 0)
      return {
        tick() {
          if (restDone) return
          for (let i = from; i < n; i++) if (!t.bitfield.get(i)) return
          restDone = true
          t.select(0, from - 1, 0) // recipe J: the rest starts only once the tail is in
        }
      }
    }
    if (id === 'window') {
      const W = Math.max(2, Math.ceil(WINDOW_BYTES / t.pieceLength))
      const f = r.file
      let key = ''
      const clipped = new Map() // iterator -> { sel, orig }
      const bind = it => {
        let rec = clipped.get(it)
        if (rec) return rec
        const sel = ((t._selections && t._selections._items) || []).find(s =>
          s.isStreamSelection && s.from === it._startPiece && s.to === it._endPiece && !s.__tt)
        if (!sel) return null
        sel.__tt = true
        rec = { sel, orig: sel.to }
        clipped.set(it, rec)
        ownDestroy(t, it, rec, () => { rec.sel.to = rec.orig })
        return rec
      }
      return {
        tick() {
          // 1. window around the playback position (before metadata: from the file start)
          const ph = playheadPiece(r)
          const a = Math.max(f._startPiece, ph == null ? f._startPiece : ph)
          const b = Math.min(f._endPiece, a + W)
          let changed = false
          if (a + ':' + b !== key) {
            key = a + ':' + b
            t.deselect(0, n - 1)
            t.select(a, b, 0)
            changed = true
          }
          // 2. the player's own reads: each may run at most W pieces past its read position
          for (const it of f._iterators || []) {
            if (it.destroyed || typeof it._piece !== 'number') continue
            const rec = bind(it)
            if (!rec) continue
            if (reattach(t, rec)) changed = true
            const to = Math.min(rec.orig, Math.max(it._piece, it._startPiece) + W)
            if (rec.sel.to !== to) { rec.sel.to = to; changed = true }
          }
          if (changed) t.select(a, b, 0) // wakes the scheduler after a range change
        }
      }
    }
    if (id === 'stream') {
      // Streaming window: pieces covering STREAM_AHEAD_S after the playhead (bytes = time x mean bit rate,
      // file size / duration) are selected at priority 0, everything else is deselected; the player's own
      // reads (stream selections, priority 1) are clipped to the window; pieces kept are capped by the
      // buffer: the furthest behind the playhead are freed (see evictPiece).
      const f = r.file
      const plen = t.pieceLength
      const info = { a: f._startPiece, b: f._startPiece, bytes: 0, sec: 0, limited: false, limit: 0 }
      const keep = [] // [from, to] ranges of the player's live reads: never freed
      info.keep = keep
      const recs = new Map() // iterator -> { sel, origFrom, origTo }
      let key = ''
      let prevA = null, seeked = false
      const len = i => (i === n - 1 ? t.lastPieceLength : plen)
      const limitBytes = cfg.bufferBytes
      const heldBytes = () => { let b = 0; for (let i = 0; i < n; i++) if (t.bitfield.get(i)) b += len(i); return b }
      const heldPieces = () => { let c = 0; for (let i = 0; i < n; i++) if (t.bitfield.get(i)) c++; return c }
      // A piece a live read still has to read is never freed. Read live (not from the list `keep` made at the last
      // tick): a reader moves several pieces between two ticks, and freeing the piece it was about to read left it
      // waiting for a piece nobody asks for. The Hybrid player's reads are short and cannot be cancelled: their whole
      // range is protected; the Service Worker's reads run to the end of the file: only the pieces around the position.
      const readerNeeds = i => {
        for (const it of f._iterators || []) {
          if (it.destroyed || typeof it._piece !== 'number') continue
          if (i >= it._piece - 2 && i <= (r.playerKind === 'hybrid' ? Math.max(it._endPiece, it._piece + 1) : it._piece + 1)) return true
        }
        return false
      }
      const protectedPiece = i => (i >= info.a && i <= info.b) || keep.some(k => i >= k[0] && i <= k[1]) || readerNeeds(i)
      const bind = it => {
        let rec = recs.get(it)
        if (rec) return rec
        const sel = ((t._selections && t._selections._items) || []).find(s =>
          s.isStreamSelection && s.from === it._startPiece && s.to === it._endPiece && !s.__tt)
        if (!sel) return null
        sel.__tt = true
        rec = { sel, origFrom: sel.from, origTo: sel.to }
        recs.set(it, rec)
        ownDestroy(t, it, rec, () => { rec.sel.from = rec.origFrom; rec.sel.to = rec.origTo })
        return rec
      }
      // Frees held pieces, furthest behind the playhead first, then (none left behind) furthest ahead of the
      // window, until the held bytes fit the buffer. Called on each verified piece, so the limit is never passed.
      function enforce() {
        const limit = info.limit = limitBytes()
        let held = heldBytes()
        while (held > limit) {
          let v = -1
          for (let i = 0; i < info.a && v < 0; i++) if (t.bitfield.get(i) && !protectedPiece(i)) v = i
          for (let i = n - 1; i > info.b && v < 0; i--) if (t.bitfield.get(i) && !protectedPiece(i)) v = i
          if (v < 0) break
          held -= len(v)
          evictPiece(r, v)
        }
      }
      return {
        info, heldBytes, heldPieces, enforce,
        jump() { seeked = true },
        tick() {
          const v = r.video
          const ph = playheadPiece(r)
          const dur = r.videoAttached && v && isFinite(v.duration) && v.duration > 0 ? v.duration : 0
          const limit = limitBytes()
          const maxP = Math.max(2, Math.floor(limit / plen) - 2) // 2 pieces of margin for the player's own reads
          const rate = dur ? f.length / dur : 0 // mean bytes per second
          const wantP = dur ? Math.max(1, Math.ceil(STREAM_AHEAD_S * rate / plen)) : Math.ceil(WINDOW_BYTES / plen) // before the duration is known: 4 MiB from the start
          const P = Math.min(wantP, maxP)
          const a = Math.max(f._startPiece, ph == null ? f._startPiece : ph)
          const b = Math.min(f._endPiece, a + P - 1)
          info.limit = limit
          info.limited = !!dur && wantP > maxP
          info.bytes = (b - a + 1) * plen
          info.sec = dur ? Math.min(STREAM_AHEAD_S, info.bytes / rate) : 0
          info.a = a; info.b = b
          let changed = false
          // The position jumped (seek, or more than a window): every priority set for the old position goes.
          // The old window is deselected below (key change); the player's reads started for the old zone lose
          // their stream selection. Pieces with a request in flight are not touched: they finish.
          // Not for the Hybrid player: its reads cannot be cancelled, and one that lost its selection waits for a
          // piece nobody asks for any more, which freezes its restart queue for good. They keep their selection
          // (bounded by the size of the read) and end by themselves.
          if (seeked || (prevA != null && Math.abs(a - prevA) > P)) {
            seeked = false
            for (const it of r.playerKind === 'hybrid' ? [] : f._iterators || []) {
              if (it.destroyed || typeof it._piece !== 'number') continue
              const rec = recs.get(it) // reads seen before the jump (a read started after it has no record yet)
              if (!rec || rec.dropped) continue
              const items = t._selections._items
              const k = items.indexOf(rec.sel)
              if (k >= 0) items.splice(k, 1)
              rec.dropped = true
              changed = true
            }
          }
          prevA = a
          if (a + ':' + b !== key) {
            key = a + ':' + b
            t.deselect(0, n - 1)
            t.select(a, b, 0)
            changed = true
          }
          // the player's reads: from 2 pieces before their position to the window end (or P pieces past their
          // position when they read beyond the window, e.g. the index at the end of an MP4)
          keep.length = 0
          for (const it of f._iterators || []) {
            if (it.destroyed || typeof it._piece !== 'number') continue
            const rec = bind(it)
            if (!rec || rec.dropped) continue
            if (reattach(t, rec)) changed = true
            const from = Math.min(rec.origTo, Math.max(rec.origFrom, it._piece - 2))
            const to = Math.max(from, Math.min(rec.origTo, it._piece > b ? it._piece + P - 1 : b))
            if (rec.sel.from !== from) { rec.sel.from = from; rec.sel.offset = 0; changed = true }
            if (rec.sel.to !== to) { rec.sel.to = to; changed = true }
            keep.push([it._piece - 2, it._piece + 1]) // the pieces being read now are never freed
          }
          if (changed) t.select(a, b, 0) // wakes the scheduler after a range change
          enforce()
        }
      }
    }
    return null
  }

  // Frees a piece already received: it becomes missing again (bitfield false, so it is asked again if
  // something needs it) and its bytes are removed from the store. WebTorrent 3.0.21 has no API for this;
  // _markUnverified is its own way to "unmark" a piece (torrent.js:884), the store has no delete, so the
  // stored chunk is emptied through the layers (immediate -> cache -> fsa or memory store).
  function evictPiece(r, i) {
    const t = r.torrent
    t._markUnverified(i) // synchronous: from now on readers wait for the piece instead of reading the store
    r.evicted.add(i); r.evictedTotal++
    dropStoredBytes(t, i).then(() => {
      // a re-download that completed during the (asynchronous) emptying would be empty: mark it missing again
      if (!r.stopped && r.torrent === t && t.bitfield.get(i)) { t._markUnverified(i); r.healed++ }
    }).catch(e => console.error(e))
  }
  async function dropStoredBytes(t, i) {
    let s = t.store
    for (let depth = 0; s && depth < 4; depth++, s = s.store) {
      if (s.mem) s.mem[i] = null
      if (s.cache && typeof s.cache.remove === 'function') s.cache.remove(i)
      if (Array.isArray(s.chunks)) {
        const h = s.chunks[i]
        if (h && typeof h.createWritable === 'function') { // fsa-chunk-store: one OPFS file per piece, emptied (reads then fail with "does not exist")
          const w = await h.createWritable({ keepExistingData: false })
          await w.close()
        } else s.chunks[i] = undefined // memory-chunk-store
        return
      }
    }
  }

  // ---- request timeout -------------------------------------------------
  // WebTorrent has no per-request timeout that fits here (docs/webtorrent-browser.md): a peer wire is
  // destroyed after 30 s without any block (lib/torrent.js:77, :1328), a web seed fetch is aborted after
  // 60 s (lib/webconn.js:13). So every outgoing request is timed here: wire.request is wrapped to record
  // its start and, on success, its duration (rolling mean). A request older than mult x mean:
  //  - if another source (wire) has the piece: the piece is hidden from the slow wire (peerPieces),
  //    wire.cancel(piece, offset, length) removes the request and runs its callback with an error, so
  //    WebTorrent releases the reservation (piece.cancel / cancelRemaining) and the next _update asks
  //    a wire that still has the piece; the slow wire gets the piece back after HIDE_MS;
  //  - otherwise it is left running and counted as "no other source".
  function trackWire(r, w) {
    const orig = w.request.bind(w)
    w.request = (index, offset, length, cb) => {
      const t0 = performance.now()
      const n = w.requests.length
      const ret = orig(index, offset, length, (err, chunk) => {
        if (!err && !r.stopped) {
          const now = performance.now()
          if (now - r.t0 >= WARMUP_MS) { r.blockTimes.push(now - t0); if (r.blockTimes.length > BLOCK_WINDOW) r.blockTimes.shift() }
        }
        if (cb) cb(err, chunk)
      })
      const q = w.requests[w.requests.length - 1]
      if (w.requests.length > n && q && q.piece === index && q.offset === offset) r.reqInfo.set(q, { t0, expired: false })
      return ret
    }
  }
  // A second connection to each web seed (same server, variant URL base + './': addWebSeed refuses a
  // duplicate URL), so that a request that timed out can be asked again when the web seed is the only source.
  function addSecondWebSeed(r) {
    const t = r.torrent
    if (r.secondSeeds || !t || r.stopped) return
    r.secondSeeds = true
    for (const u of (t.urlList || []).slice()) {
      if (typeof u !== 'string' || u.endsWith('./')) continue
      if (!u.endsWith('/') && t.files.length < 2) continue // single-file web seed: the URL is the file itself
      try { t.addWebSeed(u.replace(/\/?$/, '/') + './') } catch (e) { console.error(e) }
    }
  }
  function otherSource(t, w, piece) {
    return (t.wires || []).some(x => x !== w && !x.destroyed && x.peerPieces && x.peerPieces.get(piece) &&
      (!x.peerChoking || (x.hasFast && x.peerAllowedFastSet && x.peerAllowedFastSet.includes(piece))))
  }
  function checkTimeouts(r, mult) {
    const t = r.torrent
    const now = performance.now()
    if (mult && r.blockTimes.length >= MIN_BLOCKS) {
      const limit = Math.max(MIN_TIMEOUT_MS, mult * r.blockTimes.reduce((a, b) => a + b, 0) / r.blockTimes.length)
      for (const w of t.wires || []) {
        for (const q of (w.requests || []).slice()) {
          const info = r.reqInfo.get(q)
          if (!info || info.expired || now - info.t0 <= limit) continue
          info.expired = true
          r.timeouts++
          r.timedOut.set(q.piece, { at: now })
          if (!otherSource(t, w, q.piece)) { r.noOther++; continue }
          const had = w.peerPieces.get(q.piece)
          if (had) {
            w.peerPieces.set(q.piece, false)
            if (w.peerPieces.get(q.piece)) { r.noOther++; continue } // cannot be hidden from this wire (have-all): leave it running
            const timer = setTimeout(() => { if (!w.destroyed) w.peerPieces.set(q.piece, true) }, HIDE_MS)
            r.hideTimers.add(timer)
          }
          r.relaunched++
          try { w.cancel(q.piece, q.offset, q.length) } catch (e) { console.error(e) }
        }
      }
    }
    const live = new Set()
    for (const w of t.wires || []) for (const q of w.requests || []) { const i = r.reqInfo.get(q); if (i && !i.expired) live.add(q.piece) }
    for (const [i, m] of r.timedOut) {
      // cleared once received, or once asked again (a fresh request) after the minimum display time
      if (t.bitfield.get(i) || (now - m.at >= TIMEOUT_MARK_MS && live.has(i))) r.timedOut.delete(i)
    }
  }

  // ---- launch / stop ---------------------------------------------------
  // Ends a run: ticker, timers, player, video, client. Resolves when the client is destroyed.
  export async function stopRun(r) {
    r.stopped = true
    clearInterval(r.ticker)
    for (const h of r.hideTimers || []) clearTimeout(h)
    try { r.player && r.player.destroy && r.player.destroy() } catch (e) {}
    r.player = null
    if (r.video) { r.video.removeAttribute('src'); try { r.video.load() } catch (e) {} }
    r.video = null
    if (r.client) await new Promise(res => { try { r.client.destroy(() => res()) } catch (e) { res() } })
    r.torrent = null; r.client = null
  }

  // Starts playback of the run's file in r.video. opts: { kind: 'native' | 'hybrid', createHybridPlayer, muted, onStatus }
  export function attachPlayer(r, { kind, createHybridPlayer, muted = true, onStatus = () => {} }) {
    if (r.videoAttached || r.stopped) return
    r.videoAttached = true
    const v = r.video
    const setStatus = onStatus
    v.muted = muted
    if (kind === 'hybrid' && createHybridPlayer) {
      const src = createTorrentSource(r.file)
      const rd = src.read
      src.read = (start, end) => { try { noteRead(r, Math.floor((r.file.offset + start) / r.torrent.pieceLength)) } catch (e) { console.error(e) } return rd(start, end) }
      r.player = createHybridPlayer(v, src)
      r.player.ready.then(res => { if (res && res.unsupported && !r.stopped) setStatus('Hybrid player: ' + res.unsupported, true) },
        e => { if (!r.stopped) setStatus('Hybrid player failed: ' + (e && e.message ? e.message : e), true) })
      r.player.failed.catch(e => { if (!r.stopped) setStatus('Hybrid player failed: ' + (e && e.message ? e.message : e), true) })
    } else {
      r.file.streamTo(v)
    }
    v.play().catch(() => {})
  }

  /**
   * Connects: loads WebTorrent and the Service Worker, adds the torrent, waits for its metadata, picks the file.
   * opts: { strategyId, rate (bytes/s, -1 = unlimited), fileIndex (null = largest video), onStatus(text, bad), onVerified() }
   * @returns {Promise<{ pool: number[], idx: number } | undefined>} video files of the torrent and the chosen one
   *   (undefined when the run was stopped meanwhile)
   */
  export async function openTorrent(r, { strategyId, rate, fileIndex = null, onStatus = () => {}, onVerified = () => {} }) {
    onStatus('Loading WebTorrent and the Service Worker...')
    const [WebTorrent, reg] = await Promise.all([loadWebTorrent(), registerSW()])
    if (r.stopped) return
    const client = r.client = new WebTorrent()
    client.on('error', e => { if (!r.stopped) onStatus('Client error: ' + (e.message || e), true) })
    client.createServer({ controller: reg })
    client.throttleDownload(rate)
    onStatus('Fetching the torrent metadata...')
    const opts = { addUID: true, destroyStoreOnDestroy: true, strategy: strategyId === 'rarest' ? 'rarest' : 'sequential' }
    if (OWN_SELECTION.has(strategyId)) opts.deselect = true
    const torrent = r.torrent = client.add(r.id, opts)
    torrent.on('wire', w => { trackWire(r, w); if (w.type === 'webSeed') addSecondWebSeed(r) })
    torrent.on('infoHash', () => { torrent.announce = TRACKERS.slice() }) // before discovery starts
    torrent.on('error', e => { if (!r.stopped) onStatus('Torrent error: ' + (e.message || e), true) })
    torrent.on('verified', i => {
      r.order.push(i); r.times.push(Math.round(performance.now() - r.t0)); r.verifiedCount++
      if (r.evicted.delete(i)) r.refetched++
      if (r.strategy && r.strategy.enforce) r.strategy.enforce() // synchronous: the buffer limit is never passed
      onVerified(i)
    })
    await new Promise(res => torrent.once('ready', res))
    if (r.stopped) return
    r.n = torrent.pieces.length
    // file choice: largest video, unless one is asked for
    const files = torrent.files
    const videos = files.map((f, i) => i).filter(i => VIDEO_EXT.test(files[i].name))
    const pool = videos.length ? videos : files.map((f, i) => i)
    const biggest = pool.reduce((a, b) => (files[b].length > files[a].length ? b : a), pool[0])
    const idx = fileIndex != null ? fileIndex : biggest
    r.file = files[idx]
    r.fileIndex = idx
    return { pool, idx }
  }

  // The <video> of a run (fresh per launch): counts time to first frame and stalls, notes the seeks for the playhead anchor.
  export function createRunVideo(r, { controls = true } = {}) {
    const v = r.video = document.createElement('video')
    v.controls = controls; v.playsInline = true; v.muted = true; v.preload = 'auto'
    v.addEventListener('loadeddata', () => { if (r.ttff == null) r.ttff = Math.round(performance.now() - r.t0) })
    v.addEventListener('waiting', () => { r.stalls++ })
    v.addEventListener('seeking', () => { r.anchor = null; r.seekAt = performance.now() })
    r.file.on('iterator', ({ iterator }) => { try { noteRead(r, iterator._startPiece) } catch (e) { console.error(e) } }) // reads of the Service Worker (native player)
    return v
  }

  // Sets the download strategy up and starts the 100 ms ticker (strategy, request timeouts, late player start, then onTick).
  // cfg: { strategyId, bufferBytes(), timeoutMult(), attach(), onTick() }
  export function startRun(r, cfg) {
    const v = r.video
    r.strategy = setupStrategy(cfg.strategyId, r, cfg)
    r.ticker = setInterval(() => {
      if (r.stopped || !r.torrent) return
      try { r.strategy && r.strategy.tick() } catch (e) { console.error(e) }
      try { checkTimeouts(r, cfg.timeoutMult()) } catch (e) { console.error(e) }
      if (!r.videoAttached && r.verifiedCount >= r.n) cfg.attach()
      cfg.onTick()
    }, 100)
    if (cfg.strategyId === 'stream') {
      for (const ev of ['seeking', 'timeupdate', 'loadedmetadata']) v.addEventListener(ev, () => {
        if (r.stopped) return // the video fires events while it is unloaded at stop
        try { if (ev === 'seeking') r.strategy.jump(); r.strategy.tick() } catch (e) { console.error(e) }
      })
    }
  }

