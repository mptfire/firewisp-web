import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Headphones,
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
import { formatClock } from '../lib/format'
import { formatBitrate, readVideoFrequencyBands } from '../lib/mediaAudio'

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
  hideVolumeSlider?: boolean
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
  isSingleBitrate?: boolean
  audioOnly?: boolean
  canAudioOnly?: boolean
  mobileDataSaving?: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolumeChange: (nextVol: number) => void
  onSeek?: (timeSec: number) => void
  onJumpToLive?: () => void
  onCycleSpeed?: () => void
  onSelectQuality?: (levelIndex: number) => void
  onToggleAudioOnly?: () => void
  onPopOut?: () => void
  onToggleFullscreen: () => void
  onInteract?: () => void
}

const MINI_EQ_BANDS = 5

function LiveVuMeter({
  videoEl,
  active,
  boosted,
  volume,
}: {
  videoEl: HTMLVideoElement | null
  active: boolean
  boosted: boolean
  volume: number
}) {
  const [bands, setBands] = useState<number[]>(() => Array(MINI_EQ_BANDS).fill(0))
  const scratchRef = useRef<number[]>(Array(MINI_EQ_BANDS).fill(0))
  const volumeRef = useRef(volume)
  volumeRef.current = volume

  useEffect(() => {
    if (!active) {
      setBands(Array(MINI_EQ_BANDS).fill(0))
      return
    }
    let rafId = 0
    let lastTick = 0
    const tick = (now: number) => {
      if (typeof document !== 'undefined' && document.hidden) {
        rafId = 0
        return
      }
      if (now - lastTick >= 42) {
        lastTick = now
        const scratch = scratchRef.current
        const hasReal = videoEl ? readVideoFrequencyBands(videoEl, scratch) : false
        if (!hasReal) {
          const t = now * 0.0046
          const volScale = Math.min(1.1, Math.max(0.28, Math.min(2, volumeRef.current) * 0.85))
          for (let i = 0; i < MINI_EQ_BANDS; i++) {
            const wave =
              0.44 +
              0.3 * Math.sin(t * (1.7 + i * 0.42) + i * 1.1) +
              0.2 * Math.cos(t * (3.1 + i * 0.35) - i * 1.6)
            scratch[i] = Math.min(0.95, Math.max(0.12, wave * volScale))
          }
        }
        setBands([...scratch])
      }
      rafId = requestAnimationFrame(tick)
    }

    const onVisChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && !rafId) {
        rafId = requestAnimationFrame(tick)
      }
    }

    if (typeof document === 'undefined' || !document.hidden) {
      rafId = requestAnimationFrame(tick)
    }
    document?.addEventListener('visibilitychange', onVisChange)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      document?.removeEventListener('visibilitychange', onVisChange)
    }
  }, [active, videoEl])

  return (
    <div
      aria-hidden="true"
      title={active ? 'Live audio equalizer' : 'Audio muted'}
      className="flex items-end gap-[2px] h-3.5 px-1 shrink-0"
    >
      {bands.map((val, idx) => {
        const pct = active ? Math.max(14, Math.round(val * 100)) : 18
        return (
          <div
            key={idx}
            className="relative w-[3px] h-full rounded-full bg-white/15 overflow-hidden"
          >
            {active && (
              <div
                style={{
                  clipPath: `inset(${100 - pct}% 0 0 0)`,
                  backgroundImage: boosted
                    ? 'linear-gradient(to top, #10b981 0%, #4ade80 42%, #facc15 68%, #ff922b 86%, #fff3bf 100%)'
                    : 'linear-gradient(to top, #10b981 0%, #4ade80 45%, #facc15 72%, #ff922b 88%, #ef4444 100%)',
                  transition: 'clip-path 60ms linear',
                }}
                className="absolute inset-0"
              />
            )}
          </div>
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
  hideVolumeSlider = false,
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
  isSingleBitrate = false,
  audioOnly = false,
  canAudioOnly = false,
  mobileDataSaving = false,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onSeek,
  onJumpToLive,
  onCycleSpeed,
  onSelectQuality,
  onToggleAudioOnly,
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

  const wheelBoxRef = useRef<HTMLDivElement | null>(null)
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelHandlerRef.current = (e: WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY < 0 ? 0.06 : -0.06
    const next = Math.min(canBoost ? 2 : 1, Math.max(0, effectiveVol + delta))
    onVolumeChange(next)
  }

  useEffect(() => {
    const el = wheelBoxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => wheelHandlerRef.current(e)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
                {formatClock(currentTime)}
                <span className="text-[#7c7a72]"> / {formatClock(duration)}</span>
              </span>
            ) : null}

            {/* Dedicated Fire Wisp Audio Bar: Mute + Slider (0..200% boost) + % + Live VU */}
            <div
              ref={wheelBoxRef}
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

              {!hideVolumeSlider && (
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
              )}

              {!compact && !hideVolumeSlider && (
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
                  volume={effectiveVol}
                />
              )}
            </div>
          </div>

          {/* Right: Live Bitrate / Audio-Only / Speed / Quality / Mini-player / Fullscreen */}
          <div className="flex items-center gap-1 shrink-0">
            {isLive && activeQualityBitrate && activeQualityBitrate > 0 && !compact && (
              <span
                title={
                  isSingleBitrate && activeQualityBitrate >= 5_000_000
                    ? `Single-bitrate source (${formatBitrate(activeQualityBitrate)}) — broadcaster publishes no lower quality`
                    : mobileDataSaving
                      ? `Live stream bitrate (${formatBitrate(activeQualityBitrate)}) · Mobile Data Saving active`
                      : `Live stream bitrate (${formatBitrate(activeQualityBitrate)})`
                }
                className={`hidden sm:inline-flex items-center px-1.5 py-1 rounded-lg border text-[10px] font-mono tabular-nums select-none ${
                  isSingleBitrate && activeQualityBitrate >= 5_000_000
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                    : mobileDataSaving || audioOnly
                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                      : 'bg-black/55 border-white/10 text-[#b8b5ad]'
                }`}
              >
                {formatBitrate(activeQualityBitrate)}
              </span>
            )}

            {isLive && canAudioOnly && onToggleAudioOnly && (
              <button
                type="button"
                onClick={onToggleAudioOnly}
                title={
                  audioOnly
                    ? 'Audio-Only mode ON (lowest bitrate) — click to restore video'
                    : 'Audio-Only mode — drop to lowest stream bitrate to save data'
                }
                aria-label={audioOnly ? 'Exit audio-only mode' : 'Audio-only mode'}
                className={`px-1.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                  audioOnly
                    ? 'bg-emerald-600/30 hover:bg-emerald-600/45 border-emerald-500/55 text-emerald-200'
                    : 'bg-black/55 hover:bg-white/15 border-white/10 text-[#ece9e1]'
                }`}
              >
                <Headphones className="w-3 h-3" />
                {!compact && <span className="hidden md:inline">{audioOnly ? 'Audio Only' : 'Audio'}</span>}
              </button>
            )}

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
