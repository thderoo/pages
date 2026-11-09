// Hybrid player (mode 6 of Playback Bench): video by MSE (fragmented MP4, or WebM for VP8, remuxed by mediabunny),
// audio by MSE (AAC, Opus) or decoded in wasm and played by Web Audio (AC-3, E-AC-3), ASS subtitles by JASSUB.
//
// Usage (ES module):
//   import { createHybridPlayer } from './hybrid-player.js'
//   const player = createHybridPlayer(videoEl, source, { name, loop, fps })
//   await player.ready      // resolves null, or { unsupported: 'reason' } (then the player is already destroyed)
//   player.destroy()
//
// `source` is a URL string, a Blob/File, or { size, read(start, end) } where `end` is INCLUSIVE and
// read resolves a Uint8Array of exactly end - start + 1 bytes (clamped to size - 1 by the caller side).
// The caller owns videoEl (creation, insertion, play(), controls). The video is the clock: Web Audio is
// anchored on video.currentTime. Seeking outside the buffered range restarts the remux from the key frame
// before the target (SourceBuffer emptied, new muxer). ASS subtitles: Matroska files given as URL or Blob only.
// Returned object: { ready, failed, destroy(), apath, drift, subs, fps, audioState, hasSubs }.
// Libraries: ./vendor/mode6-libs.js (see its header), loaded on first use.

const AHEAD = 8 // seconds of video muxed ahead of the playhead
const AUDIO_AHEAD = 6 // seconds of decoded audio scheduled ahead of the playhead
const CODEC_LABEL = { aac: 'AAC', opus: 'Opus', ac3: 'AC-3', eac3: 'E-AC-3', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', dts: 'DTS' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const msgOf = e => (e && typeof e === 'object' && e.message ? String(e.message) : String(e))

let libsPromise = null
function loadLibs() {
  if (!libsPromise) {
    libsPromise = import(new URL('./vendor/mode6-libs.js', import.meta.url).href).then(l => { l.registerAc3Decoder(); return l })
    libsPromise.catch(() => { libsPromise = null })
  }
  return libsPromise
}

export function createHybridPlayer(v, source, { name = '', loop = false, fps: fpsHint = 0 } = {}) {
  const m = {
    dead: false, sess: 0, gen: 0, sources: [], ctx: null, input: null, jassub: null, demuxer: null,
    timer: 0, anchor: null, apath: null, drift: null, subs: '', fps: 0, ms: null, url: null
  }
  const listeners = []
  const on = (target, ev, fn) => { target.addEventListener(ev, fn); listeners.push([target, ev, fn]) }
  let failReject
  const failed = new Promise((_, rej) => { failReject = rej })
  failed.catch(() => {})
  const fail = e => { if (!m.dead) failReject(e) }
  const stopSources = () => { for (const s of m.sources) { try { s.stop() } catch (e) { /* already stopped */ } } m.sources = [] }

  function destroy() {
    if (m.dead) return
    m.dead = true; m.gen++; m.sess++
    clearInterval(m.timer)
    for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn)
    stopSources()
    if (m.ctx) { try { m.ctx.close() } catch (e) { /* ignore */ } }
    if (m.jassub) { try { m.jassub.destroy().catch(() => {}) } catch (e) { /* ignore */ } }
    if (m.demuxer) { try { m.demuxer.destroy() } catch (e) { /* ignore */ } }
    if (m.input) { try { m.input.dispose() } catch (e) { /* ignore */ } }
    if (m.url) { URL.revokeObjectURL(m.url); m.url = null }
  }

  async function init() {
    const L = await loadLibs()
    if (m.dead) return null
    const { MB } = L
    const vendor = new URL('./vendor/', import.meta.url).href
    const unsupported = reason => { destroy(); return { unsupported: reason } }

    // 1. Demux: tracks, codecs, what MSE accepts
    let mbSource
    if (typeof source === 'string') mbSource = new MB.UrlSource(source)
    else if (source instanceof Blob) mbSource = new MB.BlobSource(source)
    else mbSource = new MB.CustomSource({ getSize: () => source.size, read: (start, end) => source.read(start, end - 1), prefetchProfile: 'network' })
    const input = m.input = new MB.Input({ source: mbSource, formats: MB.ALL_FORMATS })
    let vt; let at
    try {
      vt = await input.getPrimaryVideoTrack()
      at = await input.getPrimaryAudioTrack()
    } catch (e) { return unsupported('mediabunny cannot read this file: ' + msgOf(e)) }
    if (m.dead) return null
    if (!vt) return unsupported('No video track found in this file')
    const vcfg = await vt.getDecoderConfig()
    if (!vcfg) return unsupported('mediabunny cannot read the video codec parameters')
    const vcodec = vcfg.codec.replace(/^hev1/, 'hvc1')
    // Fragmented MP4 by default; WebM for the codecs Chrome refuses in MP4 (VP8)
    let container = 'mp4'
    let vMime = 'video/mp4; codecs="' + vcodec + '"'
    if (!MediaSource.isTypeSupported(vMime)) {
      const w = 'video/webm; codecs="' + vcodec + '"'
      if (/^(vp8|vp09|av01)/.test(vcodec) && MediaSource.isTypeSupported(w)) { container = 'webm'; vMime = w }
      else return unsupported('This browser refuses the video codec in Media Source Extensions (' + vcodec + ')')
    }

    let audioMode = 'none'; let acfg = null; let aname = ''
    if (at) {
      aname = CODEC_LABEL[at.codec] || String(at.codec)
      acfg = await at.getDecoderConfig()
      const mseAudio = container === 'webm' ? ['opus', 'vorbis'] : ['aac', 'opus']
      const inMse = acfg && mseAudio.includes(at.codec) && MediaSource.isTypeSupported('video/' + container + '; codecs="' + vcodec + ', ' + acfg.codec + '"')
      if (inMse) audioMode = 'mse'
      else if (await at.canDecode()) audioMode = 'webaudio'
    }
    m.apath = audioMode === 'mse' ? 'MSE (' + aname + ')'
      : audioMode === 'webaudio' ? 'Web Audio (' + aname + ', wasm decoder)'
        : at ? 'none (' + aname + ' not playable)' : 'none (no audio track)'
    const mime = audioMode === 'mse' ? 'video/' + container + '; codecs="' + vcodec + ', ' + acfg.codec + '"' : vMime
    const duration = await input.computeDuration()
    let fps = 0
    try { fps = (await vt.computePacketStats(120)).averagePacketRate } catch (e) { /* unknown */ }
    m.fps = fps > 0 ? fps : 0
    if (m.dead) return null

    // 2. MediaSource on the caller's <video>
    if (audioMode !== 'mse') v.muted = true
    const ms = m.ms = new MediaSource()
    m.url = URL.createObjectURL(ms)
    v.src = m.url
    await new Promise(r => ms.addEventListener('sourceopen', r, { once: true }))
    if (m.dead) return null
    if (Number.isFinite(duration) && duration > 0) ms.duration = duration
    const sb = ms.addSourceBuffer(mime)

    // 3. Remux to fragmented MP4 (no re-encoding) and feed MSE, at most AHEAD seconds ahead.
    //    One "session" per start position; a seek outside the buffer starts a new one and the old one stops.
    const waitEnd = () => new Promise(res => {
      const done = () => { sb.removeEventListener('updateend', done); res() }
      sb.addEventListener('updateend', done)
    })
    async function startSession(my, startT) {
      const alive = () => !m.dead && my === m.sess
      const append = data => new Promise((res, rej) => {
        const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); res() }
        const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); rej(new Error('MSE refused the appended data')) }
        if (!alive()) { res(); return }
        sb.addEventListener('updateend', done); sb.addEventListener('error', bad)
        try { sb.appendBuffer(data) } catch (e) { bad() }
      })
      const out = new MB.Output({
        format: container === 'webm' ? new MB.WebMOutputFormat({ appendOnly: true, minimumClusterDuration: 1 }) : new MB.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
        target: new MB.StreamTarget(new WritableStream({ write: c => append(c.data) }))
      })
      const vsrc = new MB.EncodedVideoPacketSource(vt.codec)
      out.addVideoTrack(vsrc, { frameRate: m.fps > 0 ? m.fps : (fpsHint || 24) })
      const asrc = audioMode === 'mse' ? new MB.EncodedAudioPacketSource(at.codec) : null
      if (asrc) out.addAudioTrack(asrc)
      await out.start()
      let vfirst; let afirst
      if (startT > 0) {
        vfirst = (await new MB.EncodedPacketSink(vt).getKeyPacket(startT)) || undefined
        if (vfirst && at && asrc) afirst = (await new MB.EncodedPacketSink(at).getPacket(vfirst.timestamp)) || undefined
      }
      // Never gate while less than 2 s are buffered ahead: a fragment is only written once the next key frame
      // arrives, so with a long GOP the gate would otherwise wait for data that only the pump can produce.
      const bufferedAhead = () => {
        const b = v.buffered; const t = v.currentTime
        for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.05 && t < b.end(i)) return b.end(i) - t
        return 0
      }
      const gate = async ts => { while (alive() && ts > v.currentTime + AHEAD && bufferedAhead() > 2) await sleep(100) }
      const pump = async (track, src, cfg, first) => {
        let isFirst = true
        for await (const p of new MB.EncodedPacketSink(track).packets(first)) {
          await gate(p.timestamp)
          if (!alive()) return
          await src.add(p, isFirst ? { decoderConfig: cfg } : undefined)
          isFirst = false
        }
      }
      Promise.all([pump(vt, vsrc, vcfg, vfirst), asrc ? pump(at, asrc, acfg, afirst) : null]).then(async () => {
        if (!alive()) return
        await out.finalize()
        if (alive() && ms.readyState === 'open') ms.endOfStream()
      }).catch(e => { if (alive()) fail(e) })
    }
    let chain = Promise.resolve()
    const restart = t => {
      const my = ++m.sess
      chain = chain.then(async () => {
        if (my !== m.sess || m.dead) return
        if (sb.updating && ms.readyState === 'open') { try { sb.abort() } catch (e) { /* ignore */ } }
        if (sb.updating) await waitEnd()
        const ended = waitEnd()
        try { sb.remove(0, Infinity) } catch (e) { return } // also reopens an ended MediaSource
        await ended
        if (my !== m.sess || m.dead) return
        if (ms.readyState === 'open') { try { sb.abort() } catch (e) { /* ignore */ } } // parser back to "waiting for init segment"
        await startSession(my, t)
      }).catch(e => { if (!m.dead) fail(e) })
    }
    const buffered = t => {
      const b = v.buffered
      for (let i = 0; i < b.length; i++) if (b.start(i) <= t && t < b.end(i) - 0.05) return true
      return false
    }
    on(v, 'seeking', () => { if (!m.dead && !buffered(v.currentTime)) restart(v.currentTime) })
    await startSession(++m.sess, 0)

    // 4. Audio decoded by mediabunny, played by Web Audio, anchored on the video clock
    if (audioMode === 'webaudio') {
      let ctx
      try { ctx = new AudioContext({ sampleRate: acfg.sampleRate }) } catch (e) { ctx = new AudioContext() }
      m.ctx = ctx
      const asink = new MB.AudioBufferSink(at)
      const resync = async () => {
        const gen = ++m.gen
        const live = () => !m.dead && gen === m.gen && !v.paused
        stopSources()
        m.anchor = null
        const t0 = v.currentTime; const w0 = performance.now()
        while (live() && v.currentTime <= t0 + 0.02 && performance.now() - w0 < 2000) await sleep(20)
        if (!live()) return
        const it = asink.buffers(Math.max(0, v.currentTime - 0.05))[Symbol.asyncIterator]()
        try {
          let step = await it.next() // decoding the first buffer takes time: do it before taking the anchor
          if (!live() || step.done) return
          await ctx.resume()
          if (!live()) return
          const a = { ctx: ctx.currentTime, media: v.currentTime }
          m.anchor = a
          for (; !step.done; step = await it.next()) {
            const wb = step.value
            while (live() && wb.timestamp > v.currentTime + AUDIO_AHEAD) await sleep(100)
            if (!live()) return
            const when = a.ctx + (wb.timestamp - a.media)
            const now = ctx.currentTime
            const s = ctx.createBufferSource()
            s.buffer = wb.buffer; s.connect(ctx.destination)
            if (when >= now) s.start(when)
            else if (now - when < wb.duration) s.start(now, now - when)
            else continue
            s.onended = () => { const i = m.sources.indexOf(s); if (i >= 0) m.sources.splice(i, 1) }
            m.sources.push(s)
          }
        } catch (e) { if (live()) fail(e) } finally { try { await it.return() } catch (e) { /* ignore */ } }
      }
      const halt = () => { m.gen++; stopSources(); m.anchor = null; m.drift = null; if (!m.dead) ctx.suspend().catch(() => {}) }
      on(v, 'playing', resync)
      on(v, 'seeked', () => { if (!v.paused) resync() }) // a seek inside the buffer fires no 'playing'
      on(v, 'pause', halt)
      on(v, 'waiting', halt)
      on(v, 'seeking', halt)
      let bad = 0
      m.timer = setInterval(() => {
        const a = m.anchor
        if (!a || v.paused || ctx.state !== 'running') return
        m.drift = ((ctx.currentTime - a.ctx) - (v.currentTime - a.media)) * 1000
        bad = Math.abs(m.drift) > 60 ? bad + 1 : 0
        if (bad >= 2) { bad = 0; resync() }
      }, 500)
    }

    // 5. Loop at the end of the clip (bench): back to 0, a seek like any other
    if (loop) {
      on(v, 'ended', async () => {
        if (m.dead) return
        try { v.currentTime = 0; await v.play() } catch (e) { fail(e) }
      })
    }

    // 6. ASS subtitles of Matroska files: web-demuxer extracts, JASSUB draws over the video
    const subName = name || (source && source.name) || (typeof source === 'string' ? source.split(/[?#]/)[0] : '')
    const mkv = /\.(mkv|webm)$/i.test(subName)
    if (mkv && (typeof source === 'string' || source instanceof Blob)) {
      (async () => {
        const wd = new L.WebDemuxer({ wasmFilePath: vendor + 'web-demuxer.wasm' })
        m.demuxer = wd
        await wd.load(source)
        const sub = (await wd.getAVStreams()).find(s => s.codec_type_string === 'subtitle' && (s.codec_name === 'ass' || s.codec_name === 'ssa'))
        if (!sub || m.dead) return
        const dec = new TextDecoder()
        const fmt = s => { const t = Math.max(0, s); return Math.floor(t / 3600) + ':' + String(Math.floor(t % 3600 / 60)).padStart(2, '0') + ':' + (t % 60).toFixed(2).padStart(5, '0') }
        let ass = dec.decode(sub.extradata).trimEnd() + '\n'
        const reader = wd.readAVPacket(0, duration + 1, 3, sub.index).getReader()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const p = dec.decode(value.data).split(',') // ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
          ass += 'Dialogue: ' + p[1] + ',' + fmt(value.timestamp) + ',' + fmt(value.timestamp + value.duration) + ',' + p.slice(2).join(',') + '\n'
        }
        if (m.dead) return
        m.jassub = new L.JASSUB({
          video: v,
          subContent: ass,
          queryFonts: false,
          workerUrl: vendor + 'jassub-worker-bundle.js',
          wasmUrl: vendor + 'jassub-worker.wasm',
          modernWasmUrl: vendor + 'jassub-worker-modern.wasm',
          wasmWorkerUrl: vendor + 'jassub-worker.js',
          modernWasmWorkerUrl: vendor + 'jassub-worker-modern.js'
        })
        m.subs = 'Subtitles: ASS track drawn by JASSUB over the video'
      })().catch(e => { if (!m.dead) m.subs = 'Subtitles: ASS track could not be loaded (' + msgOf(e) + ')' })
    } else if (mkv) {
      m.subs = 'Subtitles: not extracted from a streamed source (the whole file would have to be read)'
    }
    return null
  }

  const ready = init().catch(e => { if (m.dead) return null; throw e })
  return {
    ready,
    failed,
    destroy,
    get apath() { return m.apath },
    get drift() { return m.drift },
    get subs() { return m.subs },
    get fps() { return m.fps },
    get audioState() { return m.ctx ? m.ctx.state : null },
    get hasSubs() { return !!m.jassub }
  }
}
