// Player tab of Playback Bench: a torrent video player with its own controls.
// Streaming window strategy and Hybrid player (mode 6) are fixed; the engine is the one of the Torrent tab
// (torrent.js). While the video starts, seeks or waits for data, the 3D view of the pieces is shown over it.
//
// Usage (ES module):
//   import { mountPlayerTab } from './player.js'
//   const tab = mountPlayerTab(rootEl, { createHybridPlayer })
//   tab.pause()    // leaving the tab: the video pauses, the download goes on
//   tab.destroy()

import {
  DEMO_TORRENTS, BUFFERS, TIMEOUTS, RATES,
  createRun, openTorrent, createRunVideo, startRun, attachPlayer, stopRun, createVoxView, pieceTime
} from './torrent.js'

const STRATEGY = 'stream'
const HIDE_CONTROLS_MS = 2500
const SEEK_SHOW_MS = 400 // the animation shows at least this long after a seek, even when the data was there
const STALL_MS = 500 // position still while playing is requested: waiting for data
const DEFAULT_BUFFER = '100', DEFAULT_TIMEOUT = '10x', DEFAULT_RATE = 'unlimited'
const SEEK_SMALL = 5, SEEK_BIG = 10

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fullExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
}
const icon = d => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${d}"></path></svg>`

const fmtTime = s => {
  if (!isFinite(s) || s < 0) s = 0
  s = Math.floor(s)
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0')
}
const fmtSpeed = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB/s' : Math.round(n / 1e3) + ' KB/s'
const fmtMB = n => (n / 1e6).toFixed(1) + ' MB'

/**
 * Mounts the Player tab into rootEl.
 * @param {HTMLElement} rootEl
 * @param {{ createHybridPlayer: Function }} options
 * @returns {{ destroy: () => void, getRun: () => object | null, pause: () => void }}
 */
export function mountPlayerTab(rootEl, { createHybridPlayer }) {
  rootEl.classList.add('pl')
  rootEl.innerHTML = `
    <section class="pl-card">
      <div class="pl-row">
        <label class="pl-field"><span>Demo torrent</span>
          <select data-k="demo">${DEMO_TORRENTS.map(d => `<option value="${d.url}">${d.name}</option>`).join('')}</select></label>
        <label class="pl-field pl-grow"><span>Or paste a magnet link or .torrent URL</span>
          <input data-k="custom" type="text" placeholder="Paste a magnet link or .torrent URL" spellcheck="false" autocomplete="off"></label>
        <label class="pl-field" data-k="filebox" hidden><span>File to play</span>
          <select data-k="file"></select></label>
        <div class="pl-actions">
          <button type="button" class="pl-btn pl-primary" data-k="start">Play</button>
          <button type="button" class="pl-btn" data-k="stop" disabled>Stop</button>
        </div>
      </div>
      <p class="pl-status" data-k="status" role="status">Pick a torrent and press Play.</p>
    </section>
    <div class="pl-stage" data-k="stage" tabindex="0" aria-label="Video player">
      <div class="pl-video" data-k="videobox"></div>
      <div class="pl-empty" data-k="empty">The video appears here.</div>
      <div class="pl-load pl-off" data-k="load" aria-live="polite">
        <svg class="tt-vox" data-k="vox" role="img" aria-label="Pieces being downloaded, 3D view"></svg>
        <p data-k="loadtext"></p>
      </div>
      <div class="pl-flash" data-k="flash" aria-live="polite"></div>
      <dl class="pl-stats" data-k="stats" hidden></dl>
      <div class="pl-menu" data-k="menu" hidden>
        <label><span>Buffer size</span>
          <select data-k="buffer">${BUFFERS.map(r => `<option value="${r.id}"${r.id === DEFAULT_BUFFER ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label><span>Request timeout</span>
          <select data-k="timeout">${TIMEOUTS.map(r => `<option value="${r.id}"${r.id === DEFAULT_TIMEOUT ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label><span>Download limit</span>
          <select data-k="rate">${RATES.map(r => `<option value="${r.id}"${r.id === DEFAULT_RATE ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
      </div>
      <div class="pl-ctrl" data-k="ctrl" hidden>
        <div class="pl-bar" data-k="bar" role="slider" aria-label="Seek" aria-valuemin="0" tabindex="-1" title="Light: downloaded. Outline: 2 min window.">
          <canvas data-k="barcv"></canvas>
          <div class="pl-hover" data-k="hover" hidden><span data-k="hovertime"></span></div>
        </div>
        <div class="pl-bottom">
          <button type="button" class="pl-ib" data-k="play" aria-label="Play">${icon(ICONS.play)}</button>
          <button type="button" class="pl-ib" data-k="mute" aria-label="Mute">${icon(ICONS.volume)}</button>
          <input type="range" class="pl-vol" data-k="vol" min="0" max="100" value="100" aria-label="Volume">
          <span class="pl-time" data-k="time">0:00 / 0:00</span>
          <span class="pl-spacer"></span>
          <button type="button" class="pl-ib pl-txt" data-k="subs" aria-label="Subtitles" disabled title="No subtitles">CC</button>
          <button type="button" class="pl-ib pl-txt" data-k="info" aria-label="Stats" aria-pressed="false">i</button>
          <button type="button" class="pl-ib" data-k="gear" aria-label="Settings" aria-expanded="false">${icon(ICONS.gear)}</button>
          <button type="button" class="pl-ib" data-k="full" aria-label="Fullscreen">${icon(ICONS.full)}</button>
        </div>
      </div>
    </div>`

  const $ = k => rootEl.querySelector(`[data-k="${k}"]`)
  const el = {}
  for (const k of ['demo', 'custom', 'filebox', 'file', 'start', 'stop', 'status', 'stage', 'videobox', 'empty', 'load', 'vox', 'loadtext', 'flash', 'stats', 'menu',
    'buffer', 'timeout', 'rate', 'ctrl', 'bar', 'barcv', 'hover', 'hovertime', 'play', 'mute', 'vol', 'time', 'subs', 'info', 'gear', 'full']) el[k] = $(k)

  let run = null
  let destroyed = false
  const state = { muted: false, volume: 1, loading: false, lastT: 0, lastAdvance: 0, hasPlayed: false, seekAt: -1e9, lastMove: performance.now(), seekDrag: null, tickN: 0 }
  const voxView = createVoxView(el.vox, () => voxWidth())

  function setStatus(t, bad) {
    el.status.textContent = t
    el.status.classList.toggle('pl-bad', !!bad)
    if (run && !run.video) el.loadtext.textContent = t
  }
  let flashTimer = 0
  function flash(t) {
    el.flash.textContent = t
    el.flash.classList.add('pl-on')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => el.flash.classList.remove('pl-on'), 900)
  }

  // ---- loading overlay ---------------------------------------------------
  // The 3D view is 60 % of the video area's height (CSS); its on-screen width is what the cube size and the
  // 1-px curve are computed for. Before the first build there is no viewBox yet: estimate it from the iso
  // proportions of a near-square surface (width / height ~ 1.42).
  function voxWidth() {
    const r = el.vox.getBoundingClientRect()
    if (el.vox.getAttribute('viewBox') && r.width > 0) return Math.round(r.width)
    return Math.max(100, Math.round(Math.min(0.94 * el.stage.clientWidth, 0.6 * el.stage.clientHeight * 1.42)))
  }
  const windowPct = r => {
    const info = r.strategy && r.strategy.info
    if (!info || !info.bytes || !r.torrent) return null
    let held = 0
    for (let i = info.a; i <= info.b; i++) if (r.torrent.bitfield.get(i)) held++
    return Math.round(100 * held / (info.b - info.a + 1))
  }
  let loadOffTimer = 0
  function setLoading(on) {
    if (on === state.loading) return
    state.loading = on
    clearTimeout(loadOffTimer)
    if (on) el.load.classList.remove('pl-off')
    else loadOffTimer = setTimeout(() => { if (!state.loading) el.load.classList.add('pl-off') }, 350) // after the fade: nothing updates any more
    el.load.classList.toggle('pl-show', on)
  }
  function updateLoading(r) {
    const v = r.video
    if (!v) return
    const now = performance.now()
    if (v.currentTime !== state.lastT) { state.lastT = v.currentTime; state.lastAdvance = now }
    const advancing = now - state.lastAdvance < STALL_MS
    // "played" = 0.25 s of progress with enough data (the position can jump on its own to the first packet, 0.067 s)
    if (!state.hasPlayed) {
      if (v.readyState >= 3 && !v.paused && !v.seeking) {
        if (state.base == null) state.base = v.currentTime
        if (v.currentTime - state.base >= 0.25) state.hasPlayed = true
      } else state.base = null
    }
    const wants = !v.paused && !v.ended
    const starting = !state.hasPlayed && (wants || r.ttff == null)
    const seeking = v.seeking
    const stalled = state.hasPlayed && wants && !advancing
    const on = starting || seeking || stalled || now - state.seekAt < SEEK_SHOW_MS
    setLoading(on)
    if (on) {
      const pct = windowPct(r)
      const label = starting ? 'Starting' : 'Buffering'
      el.loadtext.textContent = pct == null ? 'Fetching the torrent…' : `${label}… ${pct} % of the window`
      voxView.draw(r)
    }
  }

  // ---- progress bar --------------------------------------------------------
  const css = name => getComputedStyle(rootEl).getPropertyValue(name).trim()
  function drawBar(r) {
    const cv = el.barcv
    const w = el.bar.clientWidth, h = el.bar.clientHeight
    if (!w) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px' }
    const g = cv.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    const v = r.video
    const D = v && isFinite(v.duration) ? v.duration : 0
    const th = 6, y = (h - th) / 2
    g.fillStyle = 'rgba(255,255,255,.22)'
    g.fillRect(0, y, w, th)
    if (!D || !r.torrent || !r.file) return
    const X = t => Math.max(0, Math.min(w, t / D * w))
    // downloaded: ranges of pieces held (file pieces), converted to time with the playhead anchor
    g.fillStyle = 'rgba(255,255,255,.5)'
    const a0 = r.file._startPiece, b0 = r.file._endPiece
    let s = -1
    for (let i = a0; i <= b0 + 1; i++) {
      const has = i <= b0 && r.torrent.bitfield.get(i)
      if (has && s < 0) s = i
      if (!has && s >= 0) { const x0 = X(pieceTime(r, s)), x1 = X(pieceTime(r, i)); g.fillRect(x0, y, Math.max(1, x1 - x0), th); s = -1 }
    }
    const info = r.strategy && r.strategy.info
    if (info && info.bytes) {
      const x0 = X(pieceTime(r, info.a)), x1 = X(pieceTime(r, info.b + 1))
      g.strokeStyle = css('--pl-window') || '#3bc9db'
      g.lineWidth = 2
      g.strokeRect(x0 + 1, y - 3, Math.max(2, x1 - x0 - 2), th + 6)
    }
    const xp = X(v.currentTime)
    g.fillStyle = css('--pl-accent') || '#6c9bff'
    g.fillRect(0, y, xp, th)
    g.beginPath(); g.arc(xp, h / 2, 7, 0, Math.PI * 2); g.fill()
  }
  const barTime = ev => {
    const v = run && run.video
    if (!v || !isFinite(v.duration)) return null
    const b = el.bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * v.duration
  }
  el.bar.addEventListener('pointerdown', ev => {
    const t = barTime(ev); if (t == null) return
    state.seekDrag = ev.pointerId
    try { el.bar.setPointerCapture(ev.pointerId) } catch (e) { /* ignore */ }
    showHover(ev, t)
  })
  el.bar.addEventListener('pointermove', ev => {
    const t = barTime(ev); if (t == null) return
    showHover(ev, t)
  })
  el.bar.addEventListener('pointerup', ev => {
    if (state.seekDrag == null) return
    state.seekDrag = null
    const t = barTime(ev)
    if (t != null) seekTo(t)
  })
  el.bar.addEventListener('pointerleave', () => { if (state.seekDrag == null) el.hover.hidden = true })
  function showHover(ev, t) {
    const b = el.bar.getBoundingClientRect()
    el.hover.hidden = false
    el.hover.style.left = Math.max(0, Math.min(b.width, ev.clientX - b.left)) + 'px'
    el.hovertime.textContent = fmtTime(t)
  }
  function seekTo(t) {
    const v = run && run.video
    if (!v || !isFinite(v.duration)) return
    state.lastAdvance = performance.now()
    v.currentTime = Math.max(0, Math.min(v.duration, t))
  }

  // ---- controls ----------------------------------------------------------------
  function syncControls() {
    const v = run && run.video
    const playing = !!v && !v.paused
    el.play.innerHTML = icon(playing ? ICONS.pause : ICONS.play)
    el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    const m = state.muted || state.volume === 0
    el.mute.innerHTML = icon(m ? ICONS.muted : ICONS.volume)
    el.mute.setAttribute('aria-label', m ? 'Unmute' : 'Mute')
    el.vol.value = String(Math.round((state.muted ? 0 : state.volume) * 100))
    const fs = document.fullscreenElement === el.stage
    el.full.innerHTML = icon(fs ? ICONS.fullExit : ICONS.full)
    el.full.setAttribute('aria-label', fs ? 'Exit fullscreen' : 'Fullscreen')
    if (v) {
      el.time.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(isFinite(v.duration) ? v.duration : 0)
      el.bar.setAttribute('aria-valuemax', String(Math.round(isFinite(v.duration) ? v.duration : 0)))
      el.bar.setAttribute('aria-valuenow', String(Math.round(v.currentTime)))
    }
    const hp = run && run.player
    const hasSubs = !!(hp && hp.hasSubs)
    el.subs.disabled = !hasSubs
    el.subs.title = hasSubs ? 'Subtitles' : 'No subtitles'
    el.stage.classList.toggle('pl-paused', !playing)
  }
  function applyAudio() {
    const v = run && run.video
    if (!v) return
    v.volume = state.volume
    // the hybrid player forces the video element muted when it plays the audio by Web Audio (AC-3): not touched here
    if (!(run.player && run.player.apath && /^Web Audio/.test(run.player.apath))) v.muted = state.muted
    syncControls()
  }
  function togglePlay() {
    const v = run && run.video; if (!v) return
    if (v.paused) v.play().catch(() => {}); else v.pause()
  }
  function toggleMute() { state.muted = !state.muted; applyAudio(); flash(state.muted ? 'Muted' : 'Volume ' + Math.round(state.volume * 100) + ' %') }
  function changeVolume(d) {
    state.volume = Math.max(0, Math.min(1, Math.round((state.volume + d) * 100) / 100))
    if (d > 0) state.muted = false
    applyAudio(); flash('Volume ' + Math.round(state.volume * 100) + ' %')
  }
  function toggleFullscreen() {
    if (document.fullscreenElement === el.stage) document.exitFullscreen().catch(() => {})
    else if (el.stage.requestFullscreen) el.stage.requestFullscreen().catch(() => {})
  }
  function toggleStats(force) {
    const on = force == null ? el.stats.hidden : force
    el.stats.hidden = !on
    el.info.setAttribute('aria-pressed', String(on))
    if (on) renderStats()
  }
  function toggleMenu(force) {
    const on = force == null ? el.menu.hidden : force
    el.menu.hidden = !on
    el.gear.setAttribute('aria-expanded', String(on))
    wake()
  }
  el.play.addEventListener('click', togglePlay)
  el.mute.addEventListener('click', toggleMute)
  el.vol.addEventListener('input', () => { state.volume = el.vol.value / 100; state.muted = false; applyAudio() })
  el.vol.addEventListener('change', () => el.vol.blur())
  el.full.addEventListener('click', toggleFullscreen)
  el.info.addEventListener('click', () => toggleStats())
  el.gear.addEventListener('click', () => toggleMenu())
  el.subs.addEventListener('click', () => flash('No subtitles'))
  // a touch tap on a stage whose controls are hidden only brings them back (it does not pause)
  el.videobox.addEventListener('pointerdown', ev => { state.tapWasIdle = ev.pointerType !== 'mouse' && el.stage.classList.contains('pl-idle') })
  el.videobox.addEventListener('click', () => {
    if (state.tapWasIdle) { state.tapWasIdle = false; return }
    if (run && run.video) { togglePlay(); el.stage.focus({ preventScroll: true }) }
  })
  el.videobox.addEventListener('dblclick', toggleFullscreen)
  el.rate.addEventListener('change', () => { if (run && run.client) { const x = RATES.find(q => q.id === el.rate.value); run.client.throttleDownload(x.bytes); run.throttle = x.bytes } })
  const onFs = () => { syncControls(); wake() }
  document.addEventListener('fullscreenchange', onFs)

  // controls hide after HIDE_CONTROLS_MS without movement while playing
  function wake() { state.lastMove = performance.now(); el.stage.classList.remove('pl-idle') }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) el.stage.addEventListener(ev, wake)
  function updateIdle() {
    const v = run && run.video
    const idle = !!v && !v.paused && el.menu.hidden && performance.now() - state.lastMove > HIDE_CONTROLS_MS
    el.stage.classList.toggle('pl-idle', idle)
  }

  // keyboard shortcuts (only while this tab is shown and a video is loaded)
  const onKey = ev => {
    if (destroyed || !rootEl.offsetParent || !run || !run.video) return
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return
    const t = ev.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const v = run.video
    const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
    let used = true
    if (key === ' ' || key === 'k') togglePlay()
    else if (key === 'ArrowLeft') { seekTo(v.currentTime - SEEK_SMALL); flash('-' + SEEK_SMALL + ' s') }
    else if (key === 'ArrowRight') { seekTo(v.currentTime + SEEK_SMALL); flash('+' + SEEK_SMALL + ' s') }
    else if (key === 'j') { seekTo(v.currentTime - SEEK_BIG); flash('-' + SEEK_BIG + ' s') }
    else if (key === 'l') { seekTo(v.currentTime + SEEK_BIG); flash('+' + SEEK_BIG + ' s') }
    else if (key === 'ArrowUp') changeVolume(0.1)
    else if (key === 'ArrowDown') changeVolume(-0.1)
    else if (key === 'm') toggleMute()
    else if (key === 'f') toggleFullscreen()
    else if (key === 'c') { if (!el.subs.disabled) el.subs.click(); else flash('No subtitles') }
    else if (key === 'i') toggleStats()
    else used = false
    if (used) { ev.preventDefault(); wake() }
  }
  document.addEventListener('keydown', onKey)

  // ---- stats panel ------------------------------------------------------------
  const statRows = [['speed', 'Download'], ['peers', 'Peers'], ['buffer', 'Buffer'], ['window', 'Window'], ['drift', 'A/V drift'], ['apath', 'Audio path'], ['dropped', 'Dropped frames'], ['stalls', 'Stalls']]
  el.stats.innerHTML = statRows.map(([k, l]) => `<div><dt>${l}</dt><dd data-s="${k}">-</dd></div>`).join('')
  const setStat = (k, v) => { el.stats.querySelector(`[data-s="${k}"]`).textContent = v }
  function renderStats() {
    const r = run
    if (!r || !r.torrent) { for (const [k] of statRows) setStat(k, '-'); return }
    const t = r.torrent, sm = r.strategy && r.strategy.info ? r.strategy : null
    const wires = t.wires || []
    setStat('speed', fmtSpeed(t.downloadSpeed))
    const web = wires.filter(w => w.type === 'webSeed').length
    setStat('peers', `${wires.length - web} peers, ${web} web seed${web === 1 ? '' : 's'}`)
    setStat('buffer', sm ? `${fmtMB(sm.heldBytes())} / ${fmtMB(sm.info.limit)}` : '-')
    setStat('window', sm && sm.info.bytes ? `${Math.round(sm.info.sec)} s${sm.info.limited ? ' (buffer-limited)' : ''}, pieces ${sm.info.a}-${sm.info.b}` : '-')
    const hp = r.player
    setStat('drift', hp && hp.drift != null ? (hp.drift >= 0 ? '+' : '') + hp.drift.toFixed(1) + ' ms' : '-')
    setStat('apath', hp && hp.apath ? hp.apath : '-')
    const q = r.video && r.video.getVideoPlaybackQuality ? r.video.getVideoPlaybackQuality() : null
    setStat('dropped', q ? `${q.droppedVideoFrames} / ${q.totalVideoFrames}` : '-')
    setStat('stalls', String(r.stalls))
  }

  // ---- launch / stop -------------------------------------------------------------
  const torrentId = () => el.custom.value.trim() || el.demo.value

  async function stop(message) {
    const r = run
    if (!r) return
    run = null
    const closing = stopRun(r)
    voxView.reset()
    setLoading(false)
    el.load.classList.add('pl-off')
    el.videobox.replaceChildren()
    el.empty.hidden = false
    el.ctrl.hidden = true
    el.stage.classList.remove('pl-idle', 'pl-started')
    await closing
    el.stop.disabled = true
    el.start.disabled = false
    if (message) setStatus(message)
  }

  async function launch(fileIndex) {
    await stop()
    const rate = RATES.find(x => x.id === el.rate.value)
    const r = run = createRun({ id: torrentId(), throttle: rate.bytes, playerKind: 'hybrid' })
    Object.assign(state, { lastT: 0, lastAdvance: performance.now(), hasPlayed: false, base: null })
    el.start.disabled = true; el.stop.disabled = false
    el.empty.hidden = true
    el.stage.classList.add('pl-started')
    setLoading(true)
    el.loadtext.textContent = 'Fetching the torrent…'
    const onStatus = (t, bad) => { if (run === r) { setStatus(t, bad); if (bad) { setLoading(false); el.empty.hidden = false; el.empty.textContent = t } } }
    try {
      const res = await openTorrent(r, { strategyId: STRATEGY, rate: rate.bytes, fileIndex, onStatus })
      if (r.stopped || !res) return
      const { pool, idx } = res
      el.file.innerHTML = pool.map(i => `<option value="${i}"${i === idx ? ' selected' : ''}>${r.torrent.files[i].name}</option>`).join('')
      el.filebox.hidden = pool.length < 2
      const v = createRunVideo(r, { controls: false })
      v.volume = state.volume
      el.videobox.replaceChildren(v)
      el.ctrl.hidden = false
      for (const ev of ['play', 'pause', 'volumechange', 'ended']) v.addEventListener(ev, syncControls)
      v.addEventListener('seeking', () => { state.seekAt = performance.now(); state.lastAdvance = state.seekAt; if (run === r) tick(r) })
      const attach = () => attachPlayer(r, { kind: 'hybrid', createHybridPlayer, muted: state.muted, onStatus })
      startRun(r, {
        strategyId: STRATEGY,
        bufferBytes: () => BUFFERS.find(x => x.id === el.buffer.value).bytes,
        timeoutMult: () => TIMEOUTS.find(x => x.id === el.timeout.value).mult,
        attach,
        onTick() { if (run === r) tick(r) }
      })
      attach()
      setStatus('Playing ' + r.torrent.files[idx].name)
      wake(); syncControls()
    } catch (e) {
      console.error(e)
      onStatus('Failed: ' + (e && e.message ? e.message : e), true)
      el.start.disabled = false
    }
  }

  function tick(r) {
    if (destroyed || !rootEl.offsetParent) return // tab hidden: the download goes on, the screen does not update
    updateLoading(r)
    updateIdle()
    if (!el.ctrl.hidden && !el.stage.classList.contains('pl-idle')) { syncControls(); drawBar(r) }
    if (!el.stats.hidden && (state.tickN++ % 3 === 0)) renderStats()
  }

  el.start.addEventListener('click', () => launch(null))
  el.stop.addEventListener('click', () => stop('Stopped.'))
  el.file.addEventListener('change', () => launch(Number(el.file.value)))
  const onResize = () => { if (run) drawBar(run) }
  window.addEventListener('resize', onResize)
  syncControls()

  return {
    destroy() {
      destroyed = true
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      window.removeEventListener('resize', onResize)
      stop()
      rootEl.innerHTML = ''
      rootEl.classList.remove('pl')
    },
    getRun() { return run },
    pause() { const v = run && run.video; if (v && !v.paused) v.pause(); if (document.fullscreenElement === el.stage) document.exitFullscreen().catch(() => {}) }
  }
}
