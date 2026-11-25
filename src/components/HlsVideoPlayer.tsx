import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Play, Radio, Shield } from 'lucide-react'
import type Hls from 'hls.js'
import {
  applyVideoAudioLevel,
  claimFeedVideoFocus,
  isWebAudioAvailable,
  resumeVideoAudioGraph,
} from '../lib/mediaAudio'
import { createSafeHlsConfig } from '../lib/nostr/hlsSafe'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { VideoControlBar, type HlsQualityOption } from './VideoControlBar'

const SPEED_STEPS = [1, 1.25, 1.5, 2, 0.75]

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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)
  const setMediaVolume = useSettingsStore((s) => s.setMediaVolume)
  const setMediaMuted = useSettingsStore((s) => s.setMediaMuted)

  const safeStreamUrl = useMemo(() => sanitizePublicHttpsUrl(streamUrl), [streamUrl])
  const safePosterUrl = useMemo(() => sanitizePublicHttpsUrl(posterUrl) || undefined, [posterUrl])

  const [started, setStarted] = useState(autoStart)
  const [retryNonce, setRetryNonce] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [behindLiveSec, setBehindLiveSec] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isMseStream, setIsMseStream] = useState(false)
  const [nativeCorsOk, setNativeCorsOk] = useState(false)
  const [qualityLevels, setQualityLevels] = useState<HlsQualityOption[]>([])
  const [selectedQuality, setSelectedQuality] = useState(-1)
  const [activeQualityHeight, setActiveQualityHeight] = useState<number | undefined>(undefined)
  const [activeQualityBitrate, setActiveQualityBitrate] = useState<number | undefined>(undefined)

  const effectiveMuted = forceMuted === true ? true : mediaMuted
  const webAudioCapable = isWebAudioAvailable() && (isMseStream || nativeCorsOk)

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
    setQualityLevels([])
    setSelectedQuality(-1)
    setActiveQualityHeight(undefined)
    setActiveQualityBitrate(undefined)
  }, [safeStreamUrl])

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  const bumpControlsVisibility = () => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false)
      }
    }, 2600)
  }

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
    let hlsInstance: Hls | null = null
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let nativeCanPlay: (() => void) | null = null
    let nativeErr: (() => void) | null = null

    const st = useSettingsStore.getState()
    const startMuted = forceMutedRef.current === true ? true : st.mediaMuted
    video.muted = startMuted
    video.volume = Math.min(1, st.mediaVolume)
    setError(null)
    setBuffering(true)
    setIsMseStream(false)
    setNativeCorsOk(false)

    const destroyHls = () => {
      if (hlsInstance) {
        hlsInstance.destroy()
        hlsInstance = null
      }
      hlsRef.current = null
    }

    const isHls = /\.m3u8(\?.*)?$/i.test(safeStreamUrl) || safeStreamUrl.includes('/hls/')

    void (async () => {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try {
          const { default: HlsCtor } = await import('hls.js')
          if (destroyed) return
          if (!HlsCtor.isSupported()) {
            setError('Your browser does not support HLS live playback.')
            setBuffering(false)
            return
          }
          const hls = new HlsCtor(
            createSafeHlsConfig(HlsCtor, {
              lowLatencyMode: true,
              capLevelToPlayerSize: true,
              maxBufferLength: 12,
              maxMaxBufferLength: 24,
              backBufferLength: 15,
            }),
          )
          hlsInstance = hls
          hlsRef.current = hls
          setIsMseStream(true)
          hls.loadSource(safeStreamUrl)
          hls.attachMedia(video)

          const syncLevels = () => {
            if (destroyed) return
            const opts: HlsQualityOption[] = hls.levels
              .map((lvl, index) => ({
                index,
                height: lvl.height || 0,
                bitrate: lvl.bitrate || 0,
                label: lvl.height ? `${lvl.height}p` : `Stream ${index + 1}`,
              }))
              .sort((a, b) => (b.height || b.bitrate) - (a.height || a.bitrate))
            setQualityLevels(opts)
          }

          hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            syncLevels()
            setBuffering(false)
            onPlaybackReadyRef.current?.()
            void video.play().catch(() => {})
          })

          hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_evt, data) => {
            if (destroyed) return
            const lvl = hls.levels[data.level]
            if (lvl) {
              setActiveQualityHeight(lvl.height || undefined)
              setActiveQualityBitrate(lvl.bitrate || undefined)
            }
          })

          hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
            if (destroyed || !data.fatal) return

            const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
            const notifyOffline = () => {
              if (isLiveRef.current && isOnline) {
                onStreamOfflineRef.current?.()
              }
            }

            if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttempts < 2) {
              mediaRecoveryAttempts++
              if (mediaRecoveryAttempts === 2) hls.swapAudioCodec()
              hls.recoverMediaError()
              return
            }

            if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
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
        // Safari native HLS or direct MP4/WebM recording (attempt CORS first, fall back cleanly on opaque hosts)
        let triedWithoutCors = false
        video.crossOrigin = 'anonymous'
        video.src = safeStreamUrl
        nativeCanPlay = () => {
          if (!destroyed) {
            setNativeCorsOk(!triedWithoutCors)
            setBuffering(false)
            onPlaybackReadyRef.current?.()
            void video.play().catch(() => {})
          }
        }
        nativeErr = () => {
          if (destroyed) return
          if (!triedWithoutCors) {
            triedWithoutCors = true
            setNativeCorsOk(false)
            video.removeAttribute('crossorigin')
            video.src = safeStreamUrl
            video.load()
            return
          }
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
        video.addEventListener('canplay', nativeCanPlay)
        video.addEventListener('error', nativeErr)
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

  const prevForceMutedRef = useRef(forceMuted)

  // Continuously apply global volume/boost/mute + forceMuted audio focus rules
  useEffect(() => {
    const video = videoRef.current
    const wasForceMuted = prevForceMutedRef.current
    prevForceMutedRef.current = forceMuted
    if (!video || !started) return
    applyVideoAudioLevel(
      video,
      mediaVolume,
      effectiveMuted,
      webAudioCapable,
      playing && webAudioCapable,
    )
    if (wasForceMuted === true && forceMuted === false && video.paused && !error) {
      void video.play().catch(() => {})
    }
  }, [started, mediaVolume, effectiveMuted, webAudioCapable, playing, forceMuted, error])

  useEffect(() => {
    onVideoElement?.(started ? videoRef.current : null)
    return () => onVideoElement?.(null)
  }, [started, onVideoElement])

  const handleTogglePlay = () => {
    const v = videoRef.current
    if (!v) return
    bumpControlsVisibility()
    if (v.paused) {
      resumeVideoAudioGraph(v)
      void v.play().catch(() => {})
    } else {
      v.pause()
    }
  }

  const handleToggleMute = () => {
    if (forceMuted === true && onRequestFocusRef.current) {
      onRequestFocusRef.current()
      if (mediaMuted) setMediaMuted(false)
      if (mediaVolume <= 0) setMediaVolume(0.85)
    } else {
      const next = !mediaMuted
      setMediaMuted(next)
      if (!next && mediaVolume <= 0) setMediaVolume(0.85)
    }
    if (videoRef.current) resumeVideoAudioGraph(videoRef.current)
    bumpControlsVisibility()
  }

  const handleVolumeChange = (nextVol: number) => {
    if (forceMuted === true && nextVol > 0 && onRequestFocusRef.current) {
      onRequestFocusRef.current()
    }
    setMediaVolume(nextVol)
    if (nextVol > 0 && mediaMuted) setMediaMuted(false)
    if (nextVol === 0 && !mediaMuted) setMediaMuted(true)
    if (videoRef.current) resumeVideoAudioGraph(videoRef.current)
    bumpControlsVisibility()
  }

  const handleJumpToLive = () => {
    const v = videoRef.current
    if (!v) return
    const hls = hlsRef.current
    if (hls && typeof hls.liveSyncPosition === 'number' && Number.isFinite(hls.liveSyncPosition)) {
      v.currentTime = hls.liveSyncPosition
    } else if (v.seekable.length > 0) {
      v.currentTime = Math.max(0, v.seekable.end(v.seekable.length - 1) - 1)
    }
    if (v.paused) void v.play().catch(() => {})
    setBehindLiveSec(0)
    bumpControlsVisibility()
  }

  const handleSelectQuality = (levelIndex: number) => {
    setSelectedQuality(levelIndex)
    const hls = hlsRef.current
    if (hls) {
      hls.nextLevel = levelIndex
    }
    bumpControlsVisibility()
  }

  const handleCycleSpeed = () => {
    const idx = SPEED_STEPS.indexOf(playbackRate)
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length]
    setPlaybackRate(next)
    if (videoRef.current) videoRef.current.playbackRate = next
    bumpControlsVisibility()
  }

  const handleToggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => {})
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => {})
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!started || error) return
    const target = e.target as HTMLElement | null
    if (target?.tagName === 'INPUT') return
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault()
      handleTogglePlay()
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      handleToggleMute()
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      handleToggleFullscreen()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      handleVolumeChange(Math.min(webAudioCapable ? 2 : 1, (effectiveMuted ? 0 : mediaVolume) + 0.1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      handleVolumeChange(Math.max(0, (effectiveMuted ? 0 : mediaVolume) - 0.1))
    } else if (!isLive && e.key === 'ArrowRight' && videoRef.current) {
      e.preventDefault()
      videoRef.current.currentTime = Math.min(duration || Infinity, videoRef.current.currentTime + 5)
      bumpControlsVisibility()
    } else if (!isLive && e.key === 'ArrowLeft' && videoRef.current) {
      e.preventDefault()
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5)
      bumpControlsVisibility()
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={() => {
        if (started) bumpControlsVisibility()
      }}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false)
      }}
      className={`relative w-full aspect-video bg-black overflow-hidden group/player focus:outline-none ${
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
            playsInline
            muted={effectiveMuted}
            onClick={handleTogglePlay}
            onDoubleClick={handleToggleFullscreen}
            onPlay={() => {
              setPlaying(true)
              setBuffering(false)
              if (forceMutedRef.current !== true) {
                claimFeedVideoFocus('hls-live-player')
              }
              bumpControlsVisibility()
            }}
            onPause={() => {
              setPlaying(false)
              setControlsVisible(true)
            }}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              setDuration(Number.isFinite(v.duration) ? v.duration : 0)
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              setCurrentTime(v.currentTime)
              if (v.buffered.length > 0) {
                setBufferedEnd(v.buffered.end(v.buffered.length - 1))
              }
              if (isLiveRef.current) {
                const livePos = hlsRef.current?.liveSyncPosition
                if (typeof livePos === 'number' && Number.isFinite(livePos)) {
                  setBehindLiveSec(Math.max(0, livePos - v.currentTime))
                } else if (v.seekable.length > 0) {
                  setBehindLiveSec(Math.max(0, v.seekable.end(v.seekable.length - 1) - v.currentTime))
                }
              }
            }}
            poster={safePosterUrl}
            className="w-full h-full object-contain bg-black cursor-pointer"
          />

          {!error && (
            <VideoControlBar
              videoEl={videoRef.current}
              playing={playing}
              isLive={isLive}
              compact={compact}
              visible={controlsVisible}
              volume={mediaVolume}
              muted={effectiveMuted}
              canBoost={webAudioCapable}
              vuEnabled={webAudioCapable}
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              behindLiveSec={behindLiveSec}
              playbackRate={playbackRate}
              isFullscreen={isFullscreen}
              qualityLevels={qualityLevels}
              selectedQuality={selectedQuality}
              activeQualityHeight={activeQualityHeight}
              activeQualityBitrate={activeQualityBitrate}
              onTogglePlay={handleTogglePlay}
              onToggleMute={handleToggleMute}
              onVolumeChange={handleVolumeChange}
              onSeek={
                !isLive
                  ? (sec) => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = sec
                        setCurrentTime(sec)
                      }
                    }
                  : undefined
              }
              onJumpToLive={isLive ? handleJumpToLive : undefined}
              onCycleSpeed={!isLive ? handleCycleSpeed : undefined}
              onSelectQuality={qualityLevels.length > 1 ? handleSelectQuality : undefined}
              onPopOut={onPopOut}
              onToggleFullscreen={handleToggleFullscreen}
              onInteract={bumpControlsVisibility}
            />
          )}

          {buffering && !error && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none z-10">
              <Loader2 className="w-8 h-8 animate-spin text-[#e8590c]" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 p-6 text-center z-30">
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
