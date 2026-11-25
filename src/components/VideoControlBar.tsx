import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  Settings2,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { formatBitrate, readVideoVuLevel } from '../lib/mediaAudio'

export interface HlsQualityOption {
  index: number
  height: number
  bitrate: number
  label: string
}

interface VideoControlBarProps {
  videoEl: HTMLVideoElement | null
  playing: boolean
  isLive: boolean
  compact?: boolean
  visible: boolean
  volume: number // 0..2 (1 = 100%, 2 = 200% boost)
  muted: boolean
  canBoost: boolean
  vuEnabled: boolean
  currentTime: number
  duration: number
  bufferedEnd: number
  behindLiveSec?: number
  playbackRate?: number
  isFullscreen: boolean
  qualityLevels?: HlsQualityOption[]
  selectedQuality?: number // -1 = Auto
  activeQualityHeight?: number
  activeQualityBitrate?: number
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (nextVol: number) => void
  onSeek?: (timeSec: number) => void
  onJumpToLive?: () => void
  onCycleSpeed?: () => void
  onSelectQuality?: (levelIndex: number) => void
  onPopOut?: () => void
  onToggleFullscreen: () => void
  onInteract?: () => void
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const whole = Math.floor(sec)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = s < 10 ? `0${s}` : String(s)
  if (h > 0) {
    const mm = m < 10 ? `0${m}` : String(m)
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}

const VU_THRESHOLDS = [0.14, 0.3, 0.5, 0.72, 0.88]

function LiveVuMeter({
  videoEl,
  active,
  boosted,
}: {
  videoEl: HTMLVideoElement | null
  active: boolean
  boosted: boolean
}) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active || !videoEl) {
      setLevel(0)
      return
    }
    let rafId = 0
    let lastTick = 0
    const tick = (now: number) => {
      if (now - lastTick >= 55) {
        lastTick = now
        setLevel(readVideoVuLevel(videoEl))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [active, videoEl])

  return (
    <div
      aria-hidden="true"
      title={active ? 'Live audio level' : 'Audio muted'}
      className="flex items-end gap-[2px] h-3.5 px-1 shrink-0"
    >
      {VU_THRESHOLDS.map((th, idx) => {
        const lit = active && level >= th
        const colorClass = !lit
          ? 'bg-white/15'
          : idx >= 4
            ? boosted
              ? 'bg-[#ffd43b]'
              : 'bg-red-400'
            : idx >= 3
              ? 'bg-amber-400'
              : 'bg-emerald-400'
        const heightPct = 36 + idx * 16
        return (
          <span
            key={th}
            style={{ height: `${heightPct}%` }}
            className={`w-[2.5px] rounded-full transition-colors duration-75 ${colorClass}`}
          />
        )
      })}
    </div>
  )
}

export function VideoControlBar({
  videoEl,
  playing,
  isLive,
  compact = false,
  visible,
  volume,
  muted,
  canBoost,
  vuEnabled,
  currentTime,
  duration,
  bufferedEnd,
  behindLiveSec = 0,
  playbackRate = 1,
  isFullscreen,
  qualityLevels = [],
  selectedQuality = -1,
  activeQualityHeight,
  activeQualityBitrate,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onSeek,
  onJumpToLive,
  onCycleSpeed,
  onSelectQuality,
  onPopOut,
  onToggleFullscreen,
  onInteract,
}: VideoControlBarProps) {
  const [qualityOpen, setQualityOpen] = useState(false)
  const qualityMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!qualityOpen) return
    const onDown = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setQualityOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [qualityOpen])

  const effectiveVol = muted ? 0 : Math.min(canBoost ? 2 : 1, Math.max(0, volume))
  const sliderMax = canBoost ? 200 : 100
  const sliderPct = Math.round(effectiveVol * 100)
  const isBoosted = !muted && effectiveVol > 1.005
  const fillPercent = Math.min(100, (sliderPct / sliderMax) * 100)

  const progressPct = !isLive && duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const bufferedPct = !isLive && duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0
  const isBehindLive = isLive && behindLiveSec > 8

  const VolumeIcon =
    muted || sliderPct === 0 ? VolumeX : sliderPct < 45 ? Volume1 : Volume2

  const handleTrackSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !duration || duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeek(ratio * duration)
    onInteract?.()
  }

  const qualityBadgeLabel =
    selectedQuality === -1
      ? activeQualityHeight
        ? `Auto ${activeQualityHeight}p`
        : 'Auto'
      : qualityLevels.find((q) => q.index === selectedQuality)?.label || 'Quality'

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onInteract?.()
      }}
      onMouseMove={() => onInteract?.()}
      className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-200 ${
        visible || qualityOpen || !playing
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-gradient-to-t from-black/92 via-black/72 to-transparent pt-7 pb-2 px-2.5 sm:px-3 space-y-1.5">
        {/* VOD Seek Bar */}
        {!isLive && duration > 0 && onSeek && (
          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek video"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            onClick={handleTrackSeek}
            className="group/seek relative h-3 flex items-center cursor-pointer"
          >
            <div className="w-full h-1 group-hover/seek:h-1.5 rounded-full bg-white/20 overflow-hidden transition-all">
              <div
                style={{ width: `${bufferedPct}%` }}
                className="h-full bg-white/30 rounded-full"
              />
            </div>
            <div
              style={{ width: `${progressPct}%` }}
              className="absolute left-0 h-1 group-hover/seek:h-1.5 rounded-full bg-gradient-to-r from-[#e8590c] to-[#ffd43b] pointer-events-none transition-all"
            />
            <span
              style={{ left: `${progressPct}%` }}
              className="absolute -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#ffd43b] shadow opacity-0 group-hover/seek:opacity-100 pointer-events-none transition-opacity"
            />
          </div>
        )}

        {/* Controls Row */}
        <div className="flex items-center justify-between gap-1.5 text-white">
          {/* Left: Play/Pause + Live/Time + Audio Bar */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={onTogglePlay}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={playing ? 'Pause' : 'Play'}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-[#e8590c] text-white transition cursor-pointer shrink-0"
            >
              {playing ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>

            {isLive ? (
              isBehindLive && onJumpToLive ? (
                <button
                  type="button"
                  onClick={onJumpToLive}
                  title="Jump back to live edge"
                  className="px-1.5 py-0.5 rounded bg-[#e8590c] hover:bg-[#d9480f] text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Radio className="w-2.5 h-2.5" />
                  <span>Go Live</span>
                </button>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-red-600/90 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 shrink-0 select-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
              )
            ) : duration > 0 ? (
              <span className="text-[10px] font-mono text-[#d4d2cb] tabular-nums shrink-0 select-none">
                {formatTime(currentTime)}
                <span className="text-[#7c7a72]"> / {formatTime(duration)}</span>
              </span>
            ) : null}

            {/* Dedicated Fire Wisp Audio Bar: Mute + Slider (0..200% boost) + % + Live VU */}
            <div
              onWheel={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const delta = e.deltaY < 0 ? 0.06 : -0.06
                const next = Math.min(canBoost ? 2 : 1, Math.max(0, effectiveVol + delta))
                onVolumeChange(next)
              }}
              className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-black/55 border border-white/10 min-w-0"
              title={
                canBoost
                  ? 'Volume (0–100% normal, 101–200% loudness boost · scroll wheel adjusts)'
                  : 'Volume (scroll wheel adjusts)'
              }
            >
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute (M)' : 'Mute (M)'}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
                className={`p-0.5 rounded transition cursor-pointer shrink-0 ${
                  muted || sliderPct === 0
                    ? 'text-red-400 hover:text-red-300'
                    : isBoosted
                      ? 'text-[#ffd43b] hover:text-[#fff3bf]'
                      : 'text-[#ece9e1] hover:text-[#ff922b]'
                }`}
              >
                <VolumeIcon className="w-3.5 h-3.5" />
              </button>

              <div className={`relative flex items-center ${compact ? 'w-14 sm:w-16' : 'w-20 sm:w-28'}`}>
                {canBoost && (
                  <span
                    aria-hidden="true"
                    title="100% normal volume"
                    className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[1.5px] bg-white/35 pointer-events-none z-10 rounded-full"
                  />
                )}
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={2}
                  value={sliderPct}
                  aria-label="Volume"
                  onChange={(e) => {
                    const pct = Number(e.target.value)
                    onVolumeChange(pct / 100)
                  }}
                  style={{
                    background: `linear-gradient(90deg, ${
                      isBoosted
                        ? '#e8590c 0%, #f59f00 50%, #ffd43b ' + fillPercent + '%'
                        : '#e8590c 0%, #ff922b ' + fillPercent + '%'
                    }, rgba(255,255,255,0.2) ${fillPercent}%, rgba(255,255,255,0.2) 100%)`,
                  }}
                  className="fw-vol-slider w-full h-1.5 rounded-full appearance-none cursor-pointer"
                />
              </div>

              {!compact && (
                <span
                  className={`text-[10px] font-mono font-semibold tabular-nums w-8 text-right shrink-0 select-none ${
                    isBoosted
                      ? 'text-[#ffd43b]'
                      : muted || sliderPct === 0
                        ? 'text-red-400'
                        : 'text-[#d4d2cb]'
                  }`}
                >
                  {sliderPct}%
                </span>
              )}

              {vuEnabled && (
                <LiveVuMeter
                  videoEl={videoEl}
                  active={playing && !muted && sliderPct > 0}
                  boosted={isBoosted}
                />
              )}
            </div>
          </div>

          {/* Right: Speed / Quality / Mini-player / Fullscreen */}
          <div className="flex items-center gap-1 shrink-0">
            {!isLive && !compact && onCycleSpeed && (
              <button
                type="button"
                onClick={onCycleSpeed}
                title="Playback speed"
                className="px-1.5 py-1 rounded-lg bg-black/55 hover:bg-white/15 border border-white/10 text-[10px] font-mono font-semibold text-[#ece9e1] transition cursor-pointer"
              >
                {playbackRate}x
              </button>
            )}

            {qualityLevels.length > 1 && onSelectQuality && (
              <div className="relative" ref={qualityMenuRef}>
                <button
                  type="button"
                  onClick={() => setQualityOpen((v) => !v)}
                  title={
                    activeQualityBitrate
                      ? `Stream quality (${formatBitrate(activeQualityBitrate)})`
                      : 'Change stream quality / bitrate'
                  }
                  className="px-1.5 py-1 rounded-lg bg-black/55 hover:bg-white/15 border border-white/10 text-[10px] font-semibold text-[#ece9e1] flex items-center gap-1 transition cursor-pointer"
                >
                  <Settings2 className="w-3 h-3 text-[#ff922b]" />
                  {!compact && <span>{qualityBadgeLabel}</span>}
                </button>
                {qualityOpen && (
                  <div className="absolute right-0 bottom-full mb-1.5 w-44 rounded-xl bg-[#14151e]/98 border border-[#2c3042] shadow-2xl py-1 z-30 text-xs">
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#8c8a82] border-b border-[#222532]">
                      Quality &amp; Bitrate
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectQuality(-1)
                        setQualityOpen(false)
                      }}
                      className="w-full px-2.5 py-1.5 text-left hover:bg-white/5 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className={selectedQuality === -1 ? 'text-[#ff922b] font-semibold' : 'text-[#ece9e1]'}>
                        Auto{activeQualityHeight && selectedQuality === -1 ? ` (${activeQualityHeight}p)` : ''}
                      </span>
                      {selectedQuality === -1 && <Check className="w-3.5 h-3.5 text-[#ff922b]" />}
                    </button>
                    {qualityLevels.map((q) => (
                      <button
                        key={q.index}
                        type="button"
                        onClick={() => {
                          onSelectQuality(q.index)
                          setQualityOpen(false)
                        }}
                        className="w-full px-2.5 py-1.5 text-left hover:bg-white/5 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span
                          className={
                            selectedQuality === q.index
                              ? 'text-[#ff922b] font-semibold'
                              : 'text-[#ece9e1]'
                          }
                        >
                          {q.label}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] font-mono text-[#8c8a82]">
                          {formatBitrate(q.bitrate)}
                          {selectedQuality === q.index && (
                            <Check className="w-3.5 h-3.5 text-[#ff922b]" />
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {onPopOut && (
              <button
                type="button"
                onClick={onPopOut}
                title="Pop out mini-player"
                aria-label="Pop out mini-player"
                className="p-1.5 rounded-lg bg-black/55 hover:bg-[#e8590c] border border-white/10 text-white transition cursor-pointer"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="p-1.5 rounded-lg bg-black/55 hover:bg-white/15 border border-white/10 text-white transition cursor-pointer"
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5" />
              ) : (
                <Maximize className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
