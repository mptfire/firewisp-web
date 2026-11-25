import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import {
  applyVideoAudioLevel,
  claimFeedVideoFocus,
  isWebAudioAvailable,
  onOtherFeedVideoFocus,
  releaseFeedVideoFocus,
  resumeVideoAudioGraph,
} from '../lib/mediaAudio'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { VideoControlBar } from './VideoControlBar'

const SPEED_STEPS = [1, 1.25, 1.5, 2, 0.75]

interface FireWispVideoPlayerProps {
  src: string
  poster?: string
  compact?: boolean
  autoPlay?: boolean
  className?: string
  videoClassName?: string
}

/**
 * Unified Fire Wisp video player for feed/quote/lightbox MP4 & WebM videos:
 * - Shared dark/ember control bar with remembered volume, 200% boost & live VU meter
 * - Safe CORS auto-fallback (tries crossOrigin="anonymous" for Web Audio boost/VU, falls back transparently on opaque hosts)
 * - Global 1-audio-at-a-time coordination across feed videos and floating live mini-player
 */
export function FireWispVideoPlayer({
  src,
  poster,
  compact = false,
  autoPlay = false,
  className = '',
  videoClassName = 'w-full max-h-[560px] object-contain bg-black',
}: FireWispVideoPlayerProps) {
  const playerId = useId()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)
  const setMediaVolume = useSettingsStore((s) => s.setMediaVolume)
  const setMediaMuted = useSettingsStore((s) => s.setMediaMuted)

  const [useCors, setUseCors] = useState(true)
  const [corsReady, setCorsReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [bufferedEnd, setBufferedEnd] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const webAudioCapable = isWebAudioAvailable() && useCors && corsReady

  // Reset CORS state if video URL changes
  useEffect(() => {
    setUseCors(true)
    setCorsReady(false)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setBufferedEnd(0)
  }, [src])

  // Sync remembered volume / boost / mute to the <video>
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    applyVideoAudioLevel(video, mediaVolume, mediaMuted, webAudioCapable, playing && webAudioCapable)
  }, [mediaVolume, mediaMuted, webAudioCapable, playing])

  // Pause automatically if another feed video starts playing
  useEffect(() => {
    return onOtherFeedVideoFocus(playerId, () => {
      const v = videoRef.current
      if (v && !v.paused) v.pause()
    })
  }, [playerId])

  // Release focus cleanly on unmount so any floating mini-player can reclaim audio
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      const noneLeft = releaseFeedVideoFocus(playerId)
      if (noneLeft) {
        const live = useLiveStore.getState()
        if (live.miniPlayer && !live.mainPlayerActive && !live.activeInlineStreamKey) {
          live.setAudioOwner('mini')
        }
      }
    }
  }, [playerId])

  // Track fullscreen changes
  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
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

  const togglePlay = () => {
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

  const toggleFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => {})
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => {})
    }
  }

  const handleVolumeChange = (nextVol: number) => {
    setMediaVolume(nextVol)
    if (nextVol > 0 && mediaMuted) setMediaMuted(false)
    if (nextVol === 0 && !mediaMuted) setMediaMuted(true)
    if (videoRef.current) resumeVideoAudioGraph(videoRef.current)
    bumpControlsVisibility()
  }

  const handleToggleMute = () => {
    const nextMuted = !mediaMuted
    setMediaMuted(nextMuted)
    if (!nextMuted && mediaVolume <= 0) setMediaVolume(0.85)
    if (videoRef.current) resumeVideoAudioGraph(videoRef.current)
    bumpControlsVisibility()
  }

  const handleCycleSpeed = () => {
    const idx = SPEED_STEPS.indexOf(playbackRate)
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length]
    setPlaybackRate(next)
    if (videoRef.current) videoRef.current.playbackRate = next
    bumpControlsVisibility()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (target?.tagName === 'INPUT') return
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault()
      handleToggleMute()
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      toggleFullscreen()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      handleVolumeChange(Math.min(webAudioCapable ? 2 : 1, (mediaMuted ? 0 : mediaVolume) + 0.1))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      handleVolumeChange(Math.max(0, (mediaMuted ? 0 : mediaVolume) - 0.1))
    } else if (e.key === 'ArrowRight' && videoRef.current) {
      e.preventDefault()
      videoRef.current.currentTime = Math.min(duration || Infinity, videoRef.current.currentTime + 5)
      bumpControlsVisibility()
    } else if (e.key === 'ArrowLeft' && videoRef.current) {
      e.preventDefault()
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5)
      bumpControlsVisibility()
    }
  }

  const videoSrc = poster || autoPlay ? src : `${src}#t=0.001`

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onMouseMove={bumpControlsVisibility}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false)
      }}
      className={`relative w-full overflow-hidden bg-black group/fwvid focus:outline-none ${className}`}
    >
      <video
        key={`${src}:${useCors ? 'cors' : 'nocors'}`}
        ref={videoRef}
        src={videoSrc}
        poster={poster}
        crossOrigin={useCors ? 'anonymous' : undefined}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (useCors) setCorsReady(true)
          setDuration(Number.isFinite(v.duration) ? v.duration : 0)
          applyVideoAudioLevel(v, mediaVolume, mediaMuted, useCors && isWebAudioAvailable(), false)
        }}
        onError={() => {
          // If crossOrigin="anonymous" failed on an opaque server without CORS headers, fall back transparently
          if (useCors && !corsReady) {
            setUseCors(false)
          }
        }}
        onPlay={() => {
          setPlaying(true)
          setBuffering(false)
          claimFeedVideoFocus(playerId)
          // Auto-mute floating live mini-player so strictly 1 audio plays at a time
          const live = useLiveStore.getState()
          if (live.miniPlayer && live.audioOwner === 'mini') {
            live.setAudioOwner('main')
          }
          bumpControlsVisibility()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
          const noneLeft = releaseFeedVideoFocus(playerId)
          if (noneLeft) {
            const live = useLiveStore.getState()
            if (live.miniPlayer && !live.mainPlayerActive && !live.activeInlineStreamKey) {
              live.setAudioOwner('mini')
            }
          }
        }}
        onEnded={() => {
          setPlaying(false)
          setControlsVisible(true)
          const noneLeft = releaseFeedVideoFocus(playerId)
          if (noneLeft) {
            const live = useLiveStore.getState()
            if (live.miniPlayer && !live.mainPlayerActive && !live.activeInlineStreamKey) {
              live.setAudioOwner('mini')
            }
          }
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          setCurrentTime(v.currentTime)
          if (v.buffered.length > 0) {
            setBufferedEnd(v.buffered.end(v.buffered.length - 1))
          }
        }}
        className={`block cursor-pointer ${videoClassName}`}
      />

      {/* Center Play overlay when paused */}
      {!playing && !buffering && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition cursor-pointer z-10"
        >
          <span
            className={`${
              compact ? 'w-11 h-11' : 'w-14 h-14'
            } rounded-full bg-[#e8590c]/92 hover:bg-[#e8590c] hover:scale-105 text-white shadow-2xl flex items-center justify-center transition`}
          >
            <Play className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} fill-white ml-0.5`} />
          </span>
        </button>
      )}

      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none z-10">
          <Loader2 className="w-7 h-7 animate-spin text-[#e8590c]" />
        </div>
      )}

      <VideoControlBar
        videoEl={videoRef.current}
        playing={playing}
        isLive={false}
        compact={compact}
        visible={controlsVisible}
        volume={mediaVolume}
        muted={mediaMuted}
        canBoost={webAudioCapable}
        vuEnabled={webAudioCapable}
        currentTime={currentTime}
        duration={duration}
        bufferedEnd={bufferedEnd}
        playbackRate={playbackRate}
        isFullscreen={isFullscreen}
        onTogglePlay={togglePlay}
        onToggleMute={handleToggleMute}
        onVolumeChange={handleVolumeChange}
        onSeek={(sec) => {
          if (videoRef.current) {
            videoRef.current.currentTime = sec
            setCurrentTime(sec)
          }
        }}
        onCycleSpeed={handleCycleSpeed}
        onToggleFullscreen={toggleFullscreen}
        onInteract={bumpControlsVisibility}
      />
    </div>
  )
}
