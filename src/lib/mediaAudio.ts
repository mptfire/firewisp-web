/**
 * Shared Web Audio API gain (up to 200% boost) + live VU analyser + global feed-video focus coordinator.
 *
 * Safety rules:
 * - Only attaches `createMediaElementSource` when CORS is guaranteed (same-origin MSE blob: or
 *   crossOrigin="anonymous" loaded cleanly) so cross-origin opaque media is NEVER silenced.
 * - Reuses a single AudioGraph per <video> element via WeakMap (browsers forbid attaching twice).
 */

interface VideoAudioGraph {
  ctx: AudioContext
  source: MediaElementAudioSourceNode
  gain: GainNode
  analyser: AnalyserNode
  data: Uint8Array<ArrayBuffer>
  freqData: Uint8Array<ArrayBuffer>
}

const graphByVideo = new WeakMap<HTMLVideoElement, VideoAudioGraph>()
const failedVideos = new WeakSet<HTMLVideoElement>()
const activeSoundVideos = new Set<HTMLVideoElement>()
const soundSourceLabels = new Map<HTMLVideoElement, string>()
const audioActivityListeners = new Set<() => void>()

// Single shared AudioContext across all Fire Wisp players (avoids Chrome's 6-context cap
// and ensures any single user click/tap unlocks live FFT spectrum analysis for all streams).
let sharedAudioCtx: AudioContext | null = null
let gestureListenersInstalled = false

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  )
}

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
    return sharedAudioCtx
  }
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  try {
    sharedAudioCtx = new Ctor()
    return sharedAudioCtx
  } catch {
    return null
  }
}

export function unlockSharedAudioContext(): void {
  const ctx = getSharedAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
}

function ensureGestureUnlockListeners(): void {
  if (gestureListenersInstalled || typeof window === 'undefined') return
  gestureListenersInstalled = true
  const onGesture = () => {
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') return
    unlockSharedAudioContext()
  }
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
  window.addEventListener('keydown', onGesture, { capture: true, passive: true })
  window.addEventListener('click', onGesture, { capture: true, passive: true })
}

ensureGestureUnlockListeners()

function notifyAudioActivity() {
  for (const cb of audioActivityListeners) {
    try {
      cb()
    } catch {
      // ignore listener errors
    }
  }
}

function cleanLabelText(raw?: string | null): string {
  return (raw || '').replace(/\s+/g, ' ').trim()
}

export function formatAudioSourceLabel(
  primary?: string | null,
  secondary?: string | null,
  fallbackUrl?: string | null,
): string {
  const p = cleanLabelText(primary)
  const s = cleanLabelText(secondary)
  let out = ''
  if (p && s) {
    const pl = p.toLowerCase()
    const sl = s.toLowerCase()
    out = pl === sl || sl.startsWith(pl) ? s : `${p} — ${s}`
  } else {
    out = p || s
  }
  if (!out && fallbackUrl) {
    try {
      const parsed = new URL(fallbackUrl)
      out = parsed.hostname.replace(/^www\./, '')
    } catch {
      out = 'Audio stream'
    }
  }
  return (out || 'Audio stream').slice(0, 120)
}

export function reportVideoSoundActive(
  video: HTMLVideoElement | null,
  active: boolean,
  sourceLabel?: string,
): void {
  if (!video) return
  const had = activeSoundVideos.has(video)
  const cleanLabel = cleanLabelText(sourceLabel)
  if (active) {
    const prevLabel = soundSourceLabels.get(video) || ''
    if (!had) {
      activeSoundVideos.add(video)
    }
    if (cleanLabel && prevLabel !== cleanLabel) {
      soundSourceLabels.set(video, cleanLabel)
    }
    if (!had || (cleanLabel && prevLabel !== cleanLabel)) {
      notifyAudioActivity()
    }
  } else if (had || soundSourceLabels.has(video)) {
    activeSoundVideos.delete(video)
    soundSourceLabels.delete(video)
    notifyAudioActivity()
  }
}

export function subscribeAudioActivity(cb: () => void): () => void {
  audioActivityListeners.add(cb)
  return () => {
    audioActivityListeners.delete(cb)
  }
}

export function hasActiveSoundPlaying(): boolean {
  for (const v of activeSoundVideos) {
    if (!v.paused && !v.muted) return true
  }
  return false
}

export function getActiveSoundSourceLabel(): string | null {
  const list = [...activeSoundVideos]
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]
    if (!v.paused && !v.muted) {
      return soundSourceLabels.get(v) || null
    }
  }
  return null
}

export function isWebAudioAvailable(): boolean {
  return Boolean(getAudioContextCtor())
}

export function ensureVideoAudioGraph(video: HTMLVideoElement): VideoAudioGraph | null {
  const existing = graphByVideo.get(video)
  if (existing) {
    if (existing.ctx.state === 'suspended') {
      void existing.ctx.resume().catch(() => {})
    }
    return existing
  }
  if (failedVideos.has(video)) return null
  const ctx = getSharedAudioContext()
  if (!ctx) return null

  try {
    const source = ctx.createMediaElementSource(video)
    const gain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.minDecibels = -85
    analyser.maxDecibels = -15
    analyser.smoothingTimeConstant = 0.72
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    const graph: VideoAudioGraph = {
      ctx,
      source,
      gain,
      analyser,
      data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
      freqData: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    }
    graphByVideo.set(video, graph)
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    return graph
  } catch {
    failedVideos.add(video)
    return null
  }
}

export function resumeVideoAudioGraph(video: HTMLVideoElement): void {
  unlockSharedAudioContext()
  const existing = graphByVideo.get(video)
  if (existing && existing.ctx.state === 'suspended') {
    void existing.ctx.resume().catch(() => {})
  }
}

/**
 * Applies volume (0..2, where >1 is loudness boost) and mute state to a <video> element.
 * Uses Web Audio GainNode when `allowWebAudio` is true and boost or an existing graph is active.
 */
export function applyVideoAudioLevel(
  video: HTMLVideoElement,
  volume0to2: number,
  muted: boolean,
  allowWebAudio: boolean,
  wantAnalyser = false,
): boolean {
  const clamped = Number.isFinite(volume0to2) ? Math.min(2, Math.max(0, volume0to2)) : 0.85
  const existing = graphByVideo.get(video)

  if (muted || clamped <= 0) {
    video.muted = true
    if (existing) {
      existing.gain.gain.value = 0
    }
    return Boolean(existing)
  }

  video.muted = false

  const needsGraph = allowWebAudio && (clamped > 1 || wantAnalyser || Boolean(existing))
  if (needsGraph) {
    const graph = ensureVideoAudioGraph(video)
    if (graph) {
      video.volume = 1
      graph.gain.gain.value = clamped
      if (graph.ctx.state === 'suspended') {
        void graph.ctx.resume().catch(() => {})
      }
      return true
    }
  }

  video.volume = Math.min(1, clamped)
  return false
}

/**
 * Fills `outBands` with normalized 0..1 logarithmic frequency spectrum bands for a specific `<video>`.
 * Returns `true` when real Web Audio FFT spectrum data was written, or `false` if unavailable/suspended.
 */
export function readVideoFrequencyBands(
  video: HTMLVideoElement,
  outBands: number[],
): boolean {
  const graph = graphByVideo.get(video)
  if (!graph || video.paused || video.muted) {
    for (let i = 0; i < outBands.length; i++) outBands[i] = 0
    return false
  }
  if (graph.ctx.state === 'suspended') {
    void graph.ctx.resume().catch(() => {})
  }
  if (graph.ctx.state !== 'running') {
    for (let i = 0; i < outBands.length; i++) outBands[i] = 0
    return false
  }
  const freq = graph.freqData
  graph.analyser.getByteFrequencyData(freq)
  const count = outBands.length
  const maxBin = Math.min(freq.length - 1, 72)
  for (let i = 0; i < count; i++) {
    const startRatio = Math.pow(i / count, 1.45)
    const endRatio = Math.pow((i + 1) / count, 1.45)
    const lo = Math.max(1, Math.floor(1 + startRatio * (maxBin - 1)))
    const hi = Math.max(lo, Math.min(maxBin, Math.ceil(1 + endRatio * (maxBin - 1))))
    let peak = 0
    for (let b = lo; b <= hi; b++) {
      if (freq[b] > peak) peak = freq[b]
    }
    const tilt = 1 + (i / count) * 0.25
    outBands[i] = Math.min(1, Math.pow((peak / 255) * tilt, 0.92))
  }
  return true
}

/**
 * Returns a normalized 0..1 live audio level for the VU meter, or 0 if unavailable/silent.
 * Uses logarithmic dB-scaled FFT bins (-85..-15 dB) so normal speech/stream audio registers cleanly
 * instead of quantizing to zero in 8-bit linear time-domain sampling.
 */
export function readVideoVuLevel(video: HTMLVideoElement): number {
  const graph = graphByVideo.get(video)
  if (!graph || video.paused || video.muted) return 0
  if (graph.ctx.state === 'suspended') {
    void graph.ctx.resume().catch(() => {})
  }
  if (graph.ctx.state !== 'running') return 0
  const freq = graph.freqData
  graph.analyser.getByteFrequencyData(freq)
  const maxBin = Math.min(freq.length - 1, 56)
  let sum = 0
  let peak = 0
  for (let b = 1; b <= maxBin; b++) {
    const v = freq[b] / 255
    sum += v
    if (v > peak) peak = v
  }
  const avg = sum / maxBin
  return Math.min(1, Math.pow(peak * 0.65 + avg * 0.65, 0.9))
}

/**
 * Reads normalized 0..1 logarithmic frequency spectrum bands from whichever video is currently outputting sound.
 * Reuses pre-allocated typed arrays to keep 30fps equalizer rendering allocation-light.
 */
export function readActiveFrequencyBands(
  outBands: number[],
): { playing: boolean; hasSpectrum: boolean } {
  let activeVideo: HTMLVideoElement | null = null

  for (const v of activeSoundVideos) {
    if (v.paused || v.muted) continue
    activeVideo = v
    if (readVideoFrequencyBands(v, outBands)) {
      return { playing: true, hasSpectrum: true }
    }
  }

  for (let i = 0; i < outBands.length; i++) outBands[i] = 0
  return { playing: Boolean(activeVideo), hasSpectrum: false }
}

/**
 * Coordinates global 1-audio-at-a-time playback across regular feed MP4/WebM players.
 */
const FEED_VIDEO_FOCUS_EVENT = 'fw-feed-video-focus'
let activeFeedVideoIds = new Set<string>()

export function claimFeedVideoFocus(playerId: string): void {
  activeFeedVideoIds.add(playerId)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FEED_VIDEO_FOCUS_EVENT, { detail: { playerId } }))
  }
}

export function releaseFeedVideoFocus(playerId: string): boolean {
  activeFeedVideoIds.delete(playerId)
  return activeFeedVideoIds.size === 0
}

export function onOtherFeedVideoFocus(
  myPlayerId: string,
  cb: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (ev: Event) => {
    const otherId = (ev as CustomEvent<{ playerId?: string }>).detail?.playerId
    if (otherId && otherId !== myPlayerId) {
      cb()
    }
  }
  window.addEventListener(FEED_VIDEO_FOCUS_EVENT, handler)
  return () => window.removeEventListener(FEED_VIDEO_FOCUS_EVENT, handler)
}

export function formatBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return ''
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/i.test(ua)) return true
  // iPadOS 13+ desktop UA reports MacIntel with multi-touch points
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
}

export function isConnectionSaveData(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection
  if (!conn) return false
  return Boolean(conn.saveData || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g')
}

export interface HlsLevelMetrics {
  height?: number
  bitrate?: number
}

/**
 * Picks the highest HLS level index allowed under Mobile Data Saving mode
 * (<= 480p and <= 2.2 Mbps, falling back to the lowest available level 0).
 */
export function selectDataSaverMaxLevel(levels: readonly HlsLevelMetrics[]): number {
  if (levels.length <= 1) return -1
  let bestIdx = 0
  let bestScore = -1
  levels.forEach((lvl, idx) => {
    const h = lvl.height || 0
    const b = lvl.bitrate || 0
    const withinHeight = h === 0 || h <= 480
    const withinBitrate = b === 0 || b <= 2_200_000
    if (withinHeight && withinBitrate) {
      const score = h > 0 ? h : b
      if (score >= bestScore) {
        bestScore = score
        bestIdx = idx
      }
    }
  })
  return bestIdx
}

/**
 * Picks the lowest-bitrate HLS level index (used for Audio-Only, muted Watch With/Mini-player, and hidden tabs).
 */
export function selectLowestBitrateLevel(levels: readonly HlsLevelMetrics[]): number {
  if (levels.length <= 1) return -1
  let minIdx = 0
  let minMetric = Infinity
  levels.forEach((lvl, idx) => {
    const metric =
      lvl.bitrate && lvl.bitrate > 0
        ? lvl.bitrate
        : lvl.height && lvl.height > 0
          ? lvl.height * 1000
          : Infinity
    if (metric < minMetric) {
      minMetric = metric
      minIdx = idx
    }
  })
  return minIdx
}
