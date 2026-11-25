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
const audioActivityListeners = new Set<() => void>()

function notifyAudioActivity() {
  for (const cb of audioActivityListeners) {
    try {
      cb()
    } catch {
      // ignore listener errors
    }
  }
}

export function reportVideoSoundActive(video: HTMLVideoElement | null, active: boolean): void {
  if (!video) return
  const had = activeSoundVideos.has(video)
  if (active && !had) {
    activeSoundVideos.add(video)
    notifyAudioActivity()
  } else if (!active && had) {
    activeSoundVideos.delete(video)
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

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  )
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
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null

  try {
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(video)
    const gain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.76
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
 * Returns a normalized 0..1 live audio level for the VU meter, or 0 if unavailable/silent.
 */
export function readVideoVuLevel(video: HTMLVideoElement): number {
  const graph = graphByVideo.get(video)
  if (!graph || graph.ctx.state !== 'running' || video.paused || video.muted) return 0
  graph.analyser.getByteTimeDomainData(graph.data)
  let sumSq = 0
  const len = graph.data.length
  for (let i = 0; i < len; i++) {
    const norm = (graph.data[i] - 128) / 128
    sumSq += norm * norm
  }
  const rms = Math.sqrt(sumSq / len)
  // Boost perceptual sensitivity for typical speech/music RMS (0.02..0.35 -> 0..1)
  return Math.min(1, Math.pow(rms * 3.4, 0.78))
}

/**
 * Reads normalized 0..1 logarithmic frequency spectrum bands from whichever video is currently outputting sound.
 * Reuses pre-allocated typed arrays to keep 30fps equalizer rendering allocation-light.
 */
export function readActiveFrequencyBands(
  outBands: number[],
): { playing: boolean; hasSpectrum: boolean } {
  let activeVideo: HTMLVideoElement | null = null
  let activeGraph: VideoAudioGraph | null = null

  for (const v of activeSoundVideos) {
    if (v.paused || v.muted) continue
    activeVideo = v
    const g = graphByVideo.get(v)
    if (g && g.ctx.state === 'running') {
      activeGraph = g
      break
    }
  }

  if (!activeVideo) {
    for (let i = 0; i < outBands.length; i++) outBands[i] = 0
    return { playing: false, hasSpectrum: false }
  }

  if (!activeGraph) {
    for (let i = 0; i < outBands.length; i++) outBands[i] = 0
    return { playing: true, hasSpectrum: false }
  }

  const freq = activeGraph.freqData
  activeGraph.analyser.getByteFrequencyData(freq)
  // Map bins 1..64 (~187 Hz to ~12 kHz) logarithmically across outBands.length bars
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
    // Slight high-band tilt so treble bars look lively alongside strong bass
    const tilt = 1 + (i / count) * 0.25
    outBands[i] = Math.min(1, Math.pow((peak / 255) * tilt, 0.92))
  }
  return { playing: true, hasSpectrum: true }
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
