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
    text: 'The player’s reads jump the queue (priority 1) and everything else fills in from the start (priority 0).' }
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
export const TIMEOUTS = [
  { id: '2x', name: '2 x mean block time', mult: 2 },
  { id: '3x', name: '3 x mean block time', mult: 3 },
  { id: '5x', name: '5 x mean block time', mult: 5 },
  { id: 'off', name: 'Off', mult: 0 }
]
const DEFAULT_TIMEOUT = '3x'
const BLOCK_WINDOW = 50 // blocks in the rolling mean
const MIN_BLOCKS = 10 // no timeout before this many blocks have been measured
const HIDE_MS = 10000 // a piece taken away from the slow source is hidden from it this long (webconn.js RETRY_DELAY)
const TIMEOUT_MARK_MS = 1500 // a piece whose request timed out stays marked at least this long on the map
const WINDOW_BYTES = 4 * 1024 * 1024
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

const STATE_LABELS = [
  ['received', 'Received'],
  ['verifying', 'Verifying'],
  ['inflight', 'In flight'],
  ['priority', 'Priority'],
  ['timedout', 'Timed out'],
  ['selected', 'Missing, selected'],
  ['deselected', 'Missing, deselected']
]
// state codes in the piece map
const S_DESELECTED = 0, S_SELECTED = 1, S_PRIORITY = 2, S_INFLIGHT = 3, S_VERIFYING = 4, S_RECEIVED = 5, S_TIMEDOUT = 6
const STATE_VARS = ['--tt-deselected', '--tt-selected', '--tt-priority', '--tt-inflight', '--tt-verifying', '--tt-received', '--tt-timedout']

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
      <p class="tt-note" data-k="stratnote">Pure download strategies (sequential, rarest, random, head + tail) keep the player off until the file is complete, so the player’s own reads do not take over the order. Window and priority start playback at once.</p>
    </section>
    <section class="tt-card">
      <div class="tt-row">
        <label class="tt-field"><span>3. Download limit</span>
          <select data-k="rate">${RATES.map(r => `<option value="${r.id}"${r.id === DEFAULT_RATE ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label class="tt-field"><span>Request timeout</span>
          <select data-k="timeout">${TIMEOUTS.map(r => `<option value="${r.id}"${r.id === DEFAULT_TIMEOUT ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
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
      <h2 class="tt-h">5. Piece map</h2>
      <div class="tt-legend">
        ${STATE_LABELS.map(([k, l]) => `<span><i class="tt-sw tt-sw-${k}"></i>${l}</span>`).join('')}
        <span><i class="tt-sw tt-sw-head"></i>Playhead</span>
      </div>
      <div class="tt-mapbox" data-k="mapbox"><canvas data-k="map" aria-label="Piece map"></canvas></div>
    </section>
    <section class="tt-card">
      <h2 class="tt-h">6. Stats</h2>
      <dl class="tt-stats" data-k="stats"></dl>
    </section>`

  const $ = k => rootEl.querySelector(`[data-k="${k}"]`)
  const el = {
    demo: $('demo'), custom: $('custom'), filebox: $('filebox'), file: $('file'), rate: $('rate'), timeout: $('timeout'),
    start: $('start'), stop: $('stop'), status: $('status'), videobox: $('videobox'),
    mapbox: $('mapbox'), map: $('map'), stats: $('stats'), hybridlabel: $('hybridlabel'), hybridnote: $('hybridnote')
  }
  const strategyId = () => rootEl.querySelector(`input[name="tt-strat-${uid}"]:checked`).value
  const playerKind = () => rootEl.querySelector(`input[name="tt-player-${uid}"]:checked`).value

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
    setStat('pieces', n ? `${run.verifiedCount} / ${n}` : '-')
    const wires = t.wires || []
    setStat('meanblock', run.blockTimes.length ? Math.round(run.blockTimes.reduce((a, b) => a + b, 0) / run.blockTimes.length) + ' ms (' + run.blockTimes.length + ' blocks)' : '-')
    setStat('timeouts', `${run.timeouts} (${run.relaunched} relaunched elsewhere, ${run.noOther} with no other source)`)
    setStat('peers', String(wires.filter(w => w.type !== 'webSeed').length))
    setStat('webseeds', String(wires.filter(w => w.type === 'webSeed').length))
    setStat('ttff', run.ttff == null ? (run.videoAttached ? 'waiting...' : '-') : (run.ttff / 1000).toFixed(2) + ' s')
    setStat('stalls', String(run.stalls))
    const hp = run.player && run.playerKind === 'hybrid' ? run.player : null
    setStat('apath', hp && hp.apath ? hp.apath : '-')
    setStat('drift', hp && hp.drift != null ? (hp.drift >= 0 ? '+' : '') + hp.drift.toFixed(1) + ' ms' : '-')
  }

  // ---- piece map -------------------------------------------------------
  function cssColor(name) { return getComputedStyle(rootEl).getPropertyValue(name).trim() || '#888' }

  function pieceStates() {
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
    return st
  }

  function playheadPiece() {
    const v = run.video
    if (!run.file || !v || !isFinite(v.duration) || !(v.duration > 0)) return null
    if (!run.videoAttached) return null
    const t = run.torrent
    const bytePos = run.file.offset + Math.min(1, v.currentTime / v.duration) * run.file.length
    return Math.min(run.n - 1, Math.floor(bytePos / t.pieceLength))
  }

  function drawMap() {
    const c = el.map
    if (!run || !run.n) {
      c.width = 0; c.height = 0; c.style.height = '0'
      el.mapbox.classList.add('tt-empty')
      return
    }
    el.mapbox.classList.remove('tt-empty')
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
    const st = pieceStates()
    const at = i => [(i % cols) * pitch, Math.floor(i / cols) * pitch]
    for (let i = 0; i < run.n; i++) {
      const [x, y] = at(i)
      g.fillStyle = colors[st[i]]
      g.fillRect(x, y, cell, cell)
    }
    const ph = playheadPiece()
    if (ph != null) {
      const [x, y] = at(ph)
      g.strokeStyle = cssColor('--tt-playhead')
      g.lineWidth = 2
      g.strokeRect(x - 1, y - 1, cell + 2, cell + 2)
    }
  }
  let drawQueued = false
  function scheduleDraw() {
    if (drawQueued || destroyed) return
    drawQueued = true
    requestAnimationFrame(() => { drawQueued = false; if (!destroyed) drawMap() })
  }

  // ---- strategies ------------------------------------------------------
  // Each returns { tick() } or nothing. torrent was added with deselect:true when
  // the strategy builds its own selection.
  const OWN_SELECTION = new Set(['random', 'headtail', 'window'])

  function setupStrategy(id, r) {
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
        const destroy = it.destroy.bind(it)
        it.destroy = (...a) => { rec.sel.to = rec.orig; return destroy(...a) } // removal matches the original range
        return rec
      }
      return {
        tick() {
          // 1. window around the playback position (before metadata: from the file start)
          const ph = playheadPiece()
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
            const to = Math.min(rec.orig, Math.max(it._piece, it._startPiece) + W)
            if (rec.sel.to !== to) { rec.sel.to = to; changed = true }
          }
          if (changed) t.select(a, b, 0) // wakes the scheduler after a range change
        }
      }
    }
    return null
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
        if (!err && !r.stopped) { r.blockTimes.push(performance.now() - t0); if (r.blockTimes.length > BLOCK_WINDOW) r.blockTimes.shift() }
        if (cb) cb(err, chunk)
      })
      const q = w.requests[w.requests.length - 1]
      if (w.requests.length > n && q && q.piece === index && q.offset === offset) r.reqInfo.set(q, { t0, expired: false })
      return ret
    }
  }
  function otherSource(t, w, piece) {
    return (t.wires || []).some(x => x !== w && !x.destroyed && x.peerPieces && x.peerPieces.get(piece) &&
      (!x.peerChoking || (x.hasFast && x.peerAllowedFastSet && x.peerAllowedFastSet.includes(piece))))
  }
  function checkTimeouts(r) {
    const t = r.torrent
    const mult = TIMEOUTS.find(x => x.id === el.timeout.value).mult
    const now = performance.now()
    if (mult && r.blockTimes.length >= MIN_BLOCKS) {
      const limit = mult * r.blockTimes.reduce((a, b) => a + b, 0) / r.blockTimes.length
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
  function torrentId() {
    const c = el.custom.value.trim()
    return c || el.demo.value
  }

  async function stop(message) {
    const r = run
    if (!r) return
    r.stopped = true
    clearInterval(r.ticker)
    for (const h of r.hideTimers || []) clearTimeout(h)
    try { r.player && r.player.destroy && r.player.destroy() } catch (e) {}
    r.player = null
    if (r.video) { r.video.removeAttribute('src'); try { r.video.load() } catch (e) {} }
    r.video = null
    el.videobox.innerHTML = '<div class="tt-video-empty">The player appears here.</div>'
    if (r.client) await new Promise(res => { try { r.client.destroy(() => res()) } catch (e) { res() } })
    r.torrent = null; r.client = null
    el.stop.disabled = true
    el.start.disabled = false
    if (message) setStatus(message)
    scheduleDraw()
  }

  function attachPlayer(r) {
    if (r.videoAttached || r.stopped) return
    r.videoAttached = true
    const v = r.video
    const kind = playerKind()
    v.muted = true
    if (kind === 'hybrid' && createHybridPlayer) {
      r.player = createHybridPlayer(v, createTorrentSource(r.file))
      r.player.ready.then(res => { if (res && res.unsupported && !r.stopped) setStatus('Hybrid player: ' + res.unsupported, true) },
        e => { if (!r.stopped) setStatus('Hybrid player failed: ' + (e && e.message ? e.message : e), true) })
      r.player.failed.catch(e => { if (!r.stopped) setStatus('Hybrid player failed: ' + (e && e.message ? e.message : e), true) })
    } else {
      r.file.streamTo(v)
    }
    v.play().catch(() => {})
  }

  async function launch(fileIndex) {
    await stop()
    const id = torrentId()
    const strat = STRATEGIES.find(s => s.id === strategyId())
    const rate = RATES.find(x => x.id === el.rate.value)
    const r = run = {
      id, strat, order: [], times: [], verifiedCount: 0, stalls: 0, ttff: null, videoAttached: false,
      t0: performance.now(), n: 0, torrent: null, file: null, client: null, video: null, stopped: false, player: null,
      throttle: rate.bytes, playerKind: playerKind(),
      timeouts: 0, relaunched: 0, noOther: 0, timedOut: new Map(), reqInfo: new WeakMap(), blockTimes: [], hideTimers: new Set()
    }
    el.start.disabled = true; el.stop.disabled = false
    renderStats(); drawMap()
    try {
      setStatus('Loading WebTorrent and the Service Worker...')
      const [WebTorrent, reg] = await Promise.all([loadWebTorrent(), registerSW()])
      if (r.stopped) return
      const client = r.client = new WebTorrent()
      client.on('error', e => { if (!r.stopped) setStatus('Client error: ' + (e.message || e), true) })
      client.createServer({ controller: reg })
      client.throttleDownload(rate.bytes)
      setStatus('Fetching the torrent metadata...')
      const opts = { addUID: true, destroyStoreOnDestroy: true, strategy: strat.id === 'rarest' ? 'rarest' : 'sequential' }
      if (OWN_SELECTION.has(strat.id)) opts.deselect = true
      const torrent = r.torrent = client.add(id, opts)
      torrent.on('wire', w => trackWire(r, w))
      torrent.on('infoHash', () => { torrent.announce = TRACKERS.slice() }) // before discovery starts
      torrent.on('error', e => { if (!r.stopped) setStatus('Torrent error: ' + (e.message || e), true) })
      torrent.on('verified', i => {
        r.order.push(i); r.times.push(Math.round(performance.now() - r.t0)); r.verifiedCount++
        scheduleDraw()
      })
      await new Promise(res => torrent.once('ready', res))
      if (r.stopped) return
      r.n = torrent.pieces.length
      // file choice: largest video, unless the user picked one
      const files = torrent.files
      const videos = files.map((f, i) => i).filter(i => VIDEO_EXT.test(files[i].name))
      const pool = videos.length ? videos : files.map((f, i) => i)
      const biggest = pool.reduce((a, b) => (files[b].length > files[a].length ? b : a), pool[0])
      const idx = fileIndex != null ? fileIndex : biggest
      r.file = files[idx]
      el.file.innerHTML = pool.map(i => `<option value="${i}"${i === idx ? ' selected' : ''}>${files[i].name}</option>`).join('')
      el.filebox.hidden = pool.length < 2
      r.fileIndex = idx

      // video element (fresh per launch)
      const v = r.video = document.createElement('video')
      v.controls = true; v.playsInline = true; v.muted = true; v.preload = 'auto'
      v.addEventListener('loadeddata', () => { if (r.ttff == null) r.ttff = Math.round(performance.now() - r.t0) })
      v.addEventListener('waiting', () => { r.stalls++ })
      el.videobox.innerHTML = ''
      el.videobox.appendChild(v)

      r.strategy = setupStrategy(strat.id, r)
      r.ticker = setInterval(() => {
        if (r.stopped || !r.torrent) return
        try { r.strategy && r.strategy.tick() } catch (e) { console.error(e) }
        try { checkTimeouts(r) } catch (e) { console.error(e) }
        if (!r.videoAttached && r.verifiedCount >= r.n) attachPlayer(r)
        renderStats(); drawMap()
        if (r.verifiedCount >= r.n) setStatus('Download complete.')
      }, 100)
      if (strat.needsStream) attachPlayer(r)
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

