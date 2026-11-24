import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, PictureInPicture2, Play, Radio, Shield } from 'lucide-react'
import { createSafeHlsConfig } from '../lib/nostr/hlsSafe'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'

interface HlsVideoPlayerProps {
  streamUrl: string
  posterUrl?: string
  title?: string
  isLive?: boolean
  autoStart?: boolean
  compact?: boolean
  forceMuted?: boolean
  onPopOut?: () => void
  onPlaybackStart?: () => void
  onPlaybackReady?: () => void
  onRequestFocus?: () => void
  onVideoElement?: (el: HTMLVideoElement | null) => void
  onStreamOffline?: () => void
}

export function HlsVideoPlayer({
  streamUrl,
  posterUrl,
  title,
  isLive = true,
  autoStart = false,
  compact = false,
  forceMuted,
  onPopOut,
  onPlaybackStart,
  onPlaybackReady,
  onRequestFocus,
  onVideoElement,
  onStreamOffline,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isLiveRef = useRef(isLive)
  const forceMutedRef = useRef(forceMuted)
  const onStreamOfflineRef = useRef(onStreamOffline)
  const onPlaybackStartRef = useRef(onPlaybackStart)
  const onPlaybackReadyRef = useRef(onPlaybackReady)
  const onRequestFocusRef = useRef(onRequestFocus)
  isLiveRef.current = isLive
  forceMutedRef.current = forceMuted
  onStreamOfflineRef.current = onStreamOffline
  onPlaybackStartRef.current = onPlaybackStart
  onPlaybackReadyRef.current = onPlaybackReady
  onRequestFocusRef.current = onRequestFocus

  const safeStreamUrl = useMemo(() => sanitizePublicHttpsUrl(streamUrl), [streamUrl])
  const safePosterUrl = useMemo(() => sanitizePublicHttpsUrl(posterUrl) || undefined, [posterUrl])

  const [started, setStarted] = useState(autoStart)
  const [retryNonce, setRetryNonce] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamHost = useMemo(() => {
    if (!safeStreamUrl) return 'external stream'
    try {
      return new URL(safeStreamUrl).hostname
    } catch {
      return 'external stream'
    }
  }, [safeStreamUrl])

  useEffect(() => {
    if (autoStart) setStarted(true)
  }, [autoStart])

  useEffect(() => {
    setError(null)
    setBuffering(false)
  }, [safeStreamUrl])

  useEffect(() => {
    if (!started) return
    onPlaybackStartRef.current?.()
    const video = videoRef.current
    if (!video) return
    if (!safeStreamUrl) {
      setError('Stream URL is invalid or blocked for security.')
      setBuffering(false)
      return
    }

    let destroyed = false
    let hlsInstance: { destroy: () => void } | null = null
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let nativeCanPlay: (() => void) | null = null
    let nativeErr: (() => void) | null = null

    if (typeof forceMutedRef.current === 'boolean') {
      video.muted = forceMutedRef.current
    }
    setError(null)
    setBuffering(true)

    const destroyHls = () => {
      if (hlsInstance) {
        hlsInstance.destroy()
        hlsInstance = null
      }
    }

    const isHls = /\.m3u8(\?.*)?$/i.test(safeStreamUrl) || safeStreamUrl.includes('/hls/')

    void (async () => {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try {
          const { default: Hls } = await import('hls.js')
          if (destroyed) return
          if (!Hls.isSupported()) {
            setError('Your browser does not support HLS live playback.')
            setBuffering(false)
            return
          }
          const hls = new Hls(
            createSafeHlsConfig(Hls, {
              lowLatencyMode: true,
              backBufferLength: 30,
            }),
          )
          hlsInstance = hls
          hls.loadSource(safeStreamUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            setBuffering(false)
            onPlaybackReadyRef.current?.()
            void video.play().catch(() => {})
          })
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (destroyed || !data.fatal) return

            const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
            const notifyOffline = () => {
              if (isLiveRef.current && isOnline) {
                onStreamOfflineRef.current?.()
              }
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
              mediaRecoveryAttempts++
              if (mediaRecoveryAttempts === 2) hls.swapAudioCodec()
              hls.recoverMediaError()
              return
            }

            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              const statusCode = data.response?.code
              const definitiveOffline =
                statusCode === 404 || statusCode === 410 || statusCode === 403
              if (!definitiveOffline && networkRecoveryAttempts < 1) {
                networkRecoveryAttempts++
                hls.startLoad()
                return
              }
              destroyHls()
              setError(
                isLiveRef.current && onStreamOfflineRef.current
                  ? 'Stream could not be loaded — it may be offline. Hidden from Live Now; click Retry to reconnect.'
                  : 'Stream appears offline or unreachable. Click Retry to reconnect.',
              )
              setBuffering(false)
              notifyOffline()
              return
            }

            destroyHls()
            setError(
              isLiveRef.current && onStreamOfflineRef.current
                ? 'Stream could not be played — it may be offline. Hidden from Live Now; click Retry to try again.'
                : 'Unable to play this live stream.',
            )
            setBuffering(false)
            notifyOffline()
          })
        } catch (err) {
          if (!destroyed) {
            destroyHls()
            setError(err instanceof Error ? err.message : 'Failed to initialize HLS player')
            setBuffering(false)
          }
        }
      } else {
        // Safari native HLS or direct MP4/WebM recording
        video.src = safeStreamUrl
        nativeCanPlay = () => {
          if (!destroyed) {
            setBuffering(false)
            onPlaybackReadyRef.current?.()
            void video.play().catch(() => {})
          }
        }
        nativeErr = () => {
          if (!destroyed) {
            const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
            setError(
              isLiveRef.current && onStreamOfflineRef.current
                ? 'Stream could not be loaded — it may be offline. Hidden from Live Now; click Retry to reconnect.'
                : 'Stream could not be loaded. It may be offline.',
            )
            setBuffering(false)
            if (isLiveRef.current && isOnline) {
              onStreamOfflineRef.current?.()
            }
          }
        }
        video.addEventListener('canplay', nativeCanPlay, { once: true })
        video.addEventListener('error', nativeErr, { once: true })
      }
    })()

    return () => {
      destroyed = true
      destroyHls()
      if (nativeCanPlay) video.removeEventListener('canplay', nativeCanPlay)
      if (nativeErr) video.removeEventListener('error', nativeErr)
      if (
        typeof document !== 'undefined' &&
        document.pictureInPictureElement &&
        document.pictureInPictureElement === video
      ) {
        void document.exitPictureInPicture().catch(() => {})
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [started, safeStreamUrl, retryNonce])

  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof forceMuted !== 'boolean') return
    if (video.muted !== forceMuted) {
      video.muted = forceMuted
    }
    if (!forceMuted && video.paused && started && !error) {
      void video.play().catch(() => {})
    }
  }, [forceMuted, started, error])

  useEffect(() => {
    onVideoElement?.(started ? videoRef.current : null)
    return () => onVideoElement?.(null)
  }, [started, onVideoElement])

  return (
    <div
      className={`relative w-full aspect-video bg-black overflow-hidden group/player ${
        compact ? '' : 'rounded-xl border border-[#232530]'
      }`}
    >
      {!started ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          {safePosterUrl && (
            <img
              src={safePosterUrl}
              alt={title || 'Live stream preview'}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-45"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/30" />

          <div className="relative z-10 flex flex-col items-center gap-3 max-w-md">
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="w-16 h-16 rounded-full bg-[#e8590c] hover:bg-[#d9480f] text-white shadow-2xl shadow-black/60 flex items-center justify-center transition hover:scale-105 cursor-pointer"
              aria-label="Play live stream"
            >
              <Play className="w-7 h-7 fill-white ml-0.5" />
            </button>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white flex items-center justify-center gap-1.5">
                {isLive && <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />}
                <span>Click to play {isLive ? 'live stream' : 'recording'}</span>
              </div>
              <div className="text-[11px] text-[#c2bfb7] flex items-center justify-center gap-1">
                <Shield className="w-3 h-3 text-[#f59f00]" />
                <span>
                  Connects directly to <span className="font-mono text-white">{streamHost}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            controls
            playsInline
            muted={forceMuted === true}
            onVolumeChange={(e) => {
              // If this pane is muted in Watch With mode and the user clicks unmute on native controls, hand audio/chat focus to this stream
              if (forceMutedRef.current === true && !e.currentTarget.muted) {
                if (onRequestFocusRef.current) {
                  onRequestFocusRef.current()
                } else {
                  e.currentTarget.muted = true
                }
              }
            }}
            poster={safePosterUrl}
            className="w-full h-full object-contain bg-black"
          />
          {onPopOut && !error && (
            <button
              type="button"
              onClick={onPopOut}
              title="Pop out mini-player so you can keep watching while browsing"
              className="absolute top-2.5 right-2.5 z-10 px-2.5 py-1.5 rounded-lg bg-black/75 hover:bg-[#e8590c] border border-white/15 text-[11px] font-semibold text-white flex items-center gap-1.5 opacity-90 sm:opacity-0 sm:group-hover/player:opacity-100 focus:opacity-100 transition shadow-lg cursor-pointer"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              <span>Mini-player</span>
            </button>
          )}
          {buffering && !error && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-[#e8590c]" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="w-7 h-7 text-[#f59f00]" />
              <p className="text-sm text-[#e0ded7] max-w-sm">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setRetryNonce((n) => n + 1)
                }}
                className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-white cursor-pointer"
              >
                Retry Stream
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
