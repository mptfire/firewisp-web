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
}

const graphByVideo = new WeakMap<HTMLVideoElement, VideoAudioGraph>()
const failedVideos = new WeakSet<HTMLVideoElement>()

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
    analyser.fftSize = 128
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
