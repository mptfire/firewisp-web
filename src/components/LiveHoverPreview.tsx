import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'
import {
  applyVideoAudioLevel,
  isIosDevice,
  isWebAudioAvailable,
  reportVideoSoundActive,
  unlockSharedAudioContext,
} from '../lib/mediaAudio'
import { createSafeHlsConfig } from '../lib/nostr/hlsSafe'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useSettingsStore } from '../lib/store/useSettingsStore'

export type HoverPreviewStatus = 'connecting' | 'playing' | 'audio-only' | 'error'

interface LiveHoverPreviewProps {
  streamUrl: string
  rightOffset?: boolean | 'wide'
  onStatusChange?: (status: HoverPreviewStatus) => void
}

/**
 * Lightweight muted live-stream preview mounted only while hovering a stream card.
 * Uses lowest starting HLS bitrate capped to the preview box, validates every
 * manifest/segment URL against public HTTPS SSRF guards, and tears down cleanly
 * on mouse leave or timeout.
 */
export function LiveHoverPreview({
  streamUrl,
  rightOffset = false,
  onStatusChange,
}: LiveHoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)
  onStatusChangeRef.current = onStatusChange

  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)
  const ios = useMemo(() => isIosDevice(), [])

  const [status, setStatus] = useState<HoverPreviewStatus>('connecting')
  const [muted, setMuted] = useState(true)
  const [isMseStream, setIsMseStream] = useState(false)

  const effectiveMuted = muted || mediaMuted
  const webAudioCapable = isWebAudioAvailable() && isMseStream && !ios

  const updateStatus = (next: HoverPreviewStatus) => {
    setStatus(next)
    onStatusChangeRef.current?.(next)
  }

  useEffect(() => {
    const video = videoRef.current
    const safeUrl = sanitizePublicHttpsUrl(streamUrl)
    setMuted(true)
    setIsMseStream(false)
    if (!video || !safeUrl) {
      updateStatus('error')
      return
    }

    let destroyed = false
    let hlsInstance: { destroy: () => void } | null = null
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let nativeCanPlay: (() => void) | null = null
    let nativeErr: (() => void) | null = null

    const teardown = () => {
      destroyed = true
      clearTimeout(timeout)
      reportVideoSoundActive(video, false)
      video.removeEventListener('playing', markPlaying)
      video.removeEventListener('loadeddata', onResize)
      video.removeEventListener('resize', onResize)
      if (nativeCanPlay) video.removeEventListener('canplay', nativeCanPlay)
      if (nativeErr) video.removeEventListener('error', nativeErr)
      if (hlsInstance) {
        hlsInstance.destroy()
        hlsInstance = null
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    const markPlaying = () => {
      if (destroyed) return
      clearTimeout(timeout)
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        updateStatus('playing')
      } else {
        updateStatus('audio-only')
      }
    }

    const onResize = () => {
      if (!destroyed && video.videoWidth > 0 && video.videoHeight > 0) {
        clearTimeout(timeout)
        updateStatus('playing')
      }
    }

    const safePlay = () => {
      void video.play().catch((err: unknown) => {
        if (destroyed) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        teardown()
        updateStatus('error')
      })
    }

    updateStatus('connecting')
    video.muted = true
    video.volume = Math.min(1, useSettingsStore.getState().mediaVolume)
    video.addEventListener('playing', markPlaying)
    video.addEventListener('loadeddata', onResize)
    video.addEventListener('resize', onResize)

    const timeout = setTimeout(() => {
      if (!destroyed && video.readyState < 2) {
        teardown()
        updateStatus('error')
      }
    }, 10000)

    const isHls = /\.m3u8(\?.*)?$/i.test(safeUrl) || safeUrl.includes('/hls/')

    const attachNativePreview = () => {
      video.removeAttribute('crossorigin')
      video.src = safeUrl
      nativeCanPlay = () => {
        if (destroyed) return
        safePlay()
      }
      nativeErr = () => {
        if (destroyed) return
        teardown()
        updateStatus('error')
      }
      video.addEventListener('canplay', nativeCanPlay, { once: true })
      video.addEventListener('error', nativeErr, { once: true })
    }

    void (async () => {
      if (isHls) {
        try {
          // ALWAYS prefer hls.js whenever MSE / ManagedMediaSource is supported so Chromium's
          // native HLS engine never hits Range 206 ERR_CONTENT_LENGTH_MISMATCH on hosts like streamstr.net.
          const { default: Hls } = await import('hls.js')
          if (destroyed) return
          if (!Hls.isSupported()) {
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
              attachNativePreview()
              return
            }
            teardown()
            updateStatus('error')
            return
          }
          const hls = new Hls(
            createSafeHlsConfig(Hls, {
              lowLatencyMode: true,
              startLevel: 0,
              capLevelToPlayerSize: true,
              maxBufferLength: 4,
              maxMaxBufferLength: 6,
              backBufferLength: 0,
            }),
          )
          hlsInstance = hls
          setIsMseStream(true)
          hls.loadSource(safeUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            safePlay()
          })
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (destroyed || !data.fatal) return
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 1) {
              mediaRecoveryAttempts++
              hls.recoverMediaError()
              return
            }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              const statusCode = data.response?.code
              const definitiveOffline = statusCode === 404 || statusCode === 410
              if (!definitiveOffline && networkRecoveryAttempts < 2) {
                networkRecoveryAttempts++
                if (networkRecoveryAttempts === 1) {
                  hls.startLoad()
                } else {
                  hls.loadSource(safeUrl)
                }
                return
              }
            }
            teardown()
            updateStatus('error')
          })
        } catch {
          if (!destroyed) {
            teardown()
            updateStatus('error')
          }
        }
      } else {
        attachNativePreview()
      }
    })()

    return teardown
  }, [streamUrl])

  // Keep preview audio strictly synced with Global Audio volume (0–200% boost) & mute + equalizer
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const isPlayingState = status === 'playing' || status === 'audio-only'
    applyVideoAudioLevel(
      video,
      mediaVolume,
      effectiveMuted,
      webAudioCapable,
      isPlayingState && !effectiveMuted && webAudioCapable,
    )
    reportVideoSoundActive(video, isPlayingState && !effectiveMuted && mediaVolume > 0)
    return () => {
      reportVideoSoundActive(video, false)
    }
  }, [mediaVolume, effectiveMuted, webAudioCapable, status])

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const video = videoRef.current
    if (!video) return
    unlockSharedAudioContext()
    const nextMuted = !muted
    const st = useSettingsStore.getState()
    if (!nextMuted && st.mediaMuted) {
      st.setMediaMuted(false)
      if (st.mediaVolume <= 0) st.setMediaVolume(0.85)
    }
    const targetVol = useSettingsStore.getState().mediaVolume
    applyVideoAudioLevel(video, targetVol, nextMuted, webAudioCapable, !nextMuted && webAudioCapable)
    setMuted(nextMuted)
    if (!nextMuted && video.paused) {
      void video.play().catch(() => {})
    }
  }

  return (
    <>
      <video
        ref={videoRef}
        muted={effectiveMuted}
        playsInline
        className={`absolute inset-0 w-full h-full object-cover bg-black transition-opacity duration-200 pointer-events-none ${
          status === 'playing' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Top-right mute/unmute toggle while live preview is active */}
      {(status === 'playing' || status === 'audio-only') && (
        <button
          type="button"
          onClick={toggleMute}
          title={effectiveMuted ? 'Unmute preview (uses Global Audio volume)' : 'Mute preview'}
          aria-label={effectiveMuted ? 'Unmute preview' : 'Mute preview'}
          className={`absolute top-2 ${
            rightOffset === 'wide' ? 'right-16' : rightOffset ? 'right-9' : 'right-2'
          } z-20 p-1 rounded-md bg-black/75 hover:bg-black/95 border border-white/15 text-white transition cursor-pointer`}
        >
          {effectiveMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#ff922b]" />}
        </button>
      )}

      {/* Compact bottom-left preview status pill */}
      {status === 'connecting' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[9px] font-medium text-[#ece9e1] flex items-center gap-1 pointer-events-none">
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[#ff922b]" />
          Preview…
        </span>
      )}
      {status === 'audio-only' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-medium text-[#ff922b] pointer-events-none">
          {muted ? 'Audio stream · Click 🔇' : 'Audio playing'}
        </span>
      )}
      {status === 'error' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-medium text-[#b8b5ad] pointer-events-none">
          Preview offline
        </span>
      )}
    </>
  )
}
