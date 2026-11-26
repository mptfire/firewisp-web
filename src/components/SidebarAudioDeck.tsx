import { useEffect, useRef, useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import {
  getActiveSoundSourceLabel,
  hasActiveSoundPlaying,
  readActiveFrequencyBands,
  subscribeAudioActivity,
  unlockSharedAudioContext,
} from '../lib/mediaAudio'
import { useSettingsStore } from '../lib/store/useSettingsStore'

const EQ_BAND_COUNT = 16

/**
 * Compact persistent sidebar audio deck underneath Live Zaps / Top Zappers:
 * - Always-available Global Volume slider (0% -> 200% boost) + Mute toggle
 * - Slow-scrolling active audio source title while sound plays ("Global Audio" when idle)
 * - Live 16-band graphic equalizer with decaying peak-hold caps that automatically appears when sound is playing
 */
export function SidebarAudioDeck() {
  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)
  const setMediaVolume = useSettingsStore((s) => s.setMediaVolume)
  const setMediaMuted = useSettingsStore((s) => s.setMediaMuted)

  const [soundPlaying, setSoundPlaying] = useState(() => hasActiveSoundPlaying())
  const [sourceLabel, setSourceLabel] = useState<string | null>(() => getActiveSoundSourceLabel())
  const [hasSpectrum, setHasSpectrum] = useState(false)
  const [bars, setBars] = useState<number[]>(() => Array(EQ_BAND_COUNT).fill(0))
  const [peaks, setPeaks] = useState<number[]>(() => Array(EQ_BAND_COUNT).fill(0))

  const scratchRef = useRef<number[]>(Array(EQ_BAND_COUNT).fill(0))
  const peaksRef = useRef<number[]>(Array(EQ_BAND_COUNT).fill(0))

  useEffect(() => {
    const sync = () => {
      setSoundPlaying(hasActiveSoundPlaying())
      setSourceLabel(getActiveSoundSourceLabel())
    }
    sync()
    return subscribeAudioActivity(sync)
  }, [])

  // Run lightweight ~28fps equalizer loop ONLY while sound is actively playing
  useEffect(() => {
    if (!soundPlaying || mediaMuted || mediaVolume <= 0) {
      setHasSpectrum(false)
      setBars(Array(EQ_BAND_COUNT).fill(0))
      peaksRef.current.fill(0)
      setPeaks(Array(EQ_BAND_COUNT).fill(0))
      return
    }

    let rafId = 0
    let lastTick = 0
    const tick = (now: number) => {
      if (now - lastTick >= 36) {
        lastTick = now
        const scratch = scratchRef.current
        const res = readActiveFrequencyBands(scratch)
        if (!res.playing) {
          setSoundPlaying(false)
          return
        }
        setHasSpectrum(res.hasSpectrum)
        const nextPeaks = peaksRef.current
        if (res.hasSpectrum) {
          for (let i = 0; i < EQ_BAND_COUNT; i++) {
            const v = scratch[i]
            nextPeaks[i] = v >= nextPeaks[i] ? v : Math.max(0, nextPeaks[i] - 0.032)
          }
        } else {
          // Graceful volume-scaled studio equalizer animation when source host restricts raw CORS FFT access
          const t = now * 0.0042
          const volScale = Math.min(1.15, Math.max(0.28, Math.min(2, mediaVolume) * 0.85))
          for (let i = 0; i < EQ_BAND_COUNT; i++) {
            const bandPos = i / (EQ_BAND_COUNT - 1)
            const shape = 0.82 - Math.abs(bandPos - 0.34) * 0.55
            const wave =
              0.42 +
              0.28 * Math.sin(t * (1.55 + (i % 5) * 0.37) + i * 0.85) +
              0.2 * Math.sin(t * (2.9 + (i % 3) * 0.52) - i * 1.35) +
              0.1 * Math.cos(t * 4.4 + i * 2.1)
            const v = Math.min(0.96, Math.max(0.08, wave * shape * volScale))
            scratch[i] = v
            nextPeaks[i] = v >= nextPeaks[i] ? v : Math.max(0, nextPeaks[i] - 0.028)
          }
        }
        setBars([...scratch])
        setPeaks([...nextPeaks])
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [soundPlaying, mediaMuted, mediaVolume])

  const effectiveVol = mediaMuted ? 0 : Math.min(2, Math.max(0, mediaVolume))
  const pct = Math.round(effectiveVol * 100)
  const isBoosted = !mediaMuted && effectiveVol > 1.005
  const fillPct = Math.min(100, (pct / 200) * 100)
  const showEq = soundPlaying && !mediaMuted && pct > 0
  const activeTitle = showEq && sourceLabel ? sourceLabel : null

  const VolumeIcon = mediaMuted || pct === 0 ? VolumeX : pct < 45 ? Volume1 : Volume2

  const handleToggleMute = () => {
    unlockSharedAudioContext()
    const nextMuted = !mediaMuted
    setMediaMuted(nextMuted)
    if (!nextMuted && mediaVolume <= 0) setMediaVolume(0.85)
  }

  const handleVolumeChange = (nextVol: number) => {
    unlockSharedAudioContext()
    setMediaVolume(nextVol)
    if (nextVol > 0 && mediaMuted) setMediaMuted(false)
    if (nextVol === 0 && !mediaMuted) setMediaMuted(true)
  }

  return (
    <div
      className={`p-2.5 rounded-2xl bg-[#15161c] border transition space-y-2 ${
        showEq ? 'border-[#e8590c]/45 shadow-[0_0_16px_-6px_rgba(232,89,12,0.45)]' : 'border-[#232530]'
      }`}
    >
      {/* Header + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 flex items-center gap-1.5">
          <VolumeIcon
            className={`w-3.5 h-3.5 shrink-0 ${
              mediaMuted || pct === 0
                ? 'text-red-400'
                : isBoosted
                  ? 'text-[#ffd43b]'
                  : showEq
                    ? 'text-[#ff922b]'
                    : 'text-[#8c8a82]'
            }`}
          />
          {activeTitle ? (
            <span className="fw-audio-marquee min-w-0 flex-1 overflow-hidden" title={activeTitle}>
              <span
                key={activeTitle}
                className="fw-audio-marquee-track text-[10px] font-semibold tracking-wide text-[#f4f1ea]"
                style={{
                  animationDuration: `${Math.max(12, Math.min(26, Math.round(activeTitle.length * 0.35 + 8)))}s`,
                }}
              >
                <span className="pr-6">{activeTitle}</span>
                <span className="pr-6" aria-hidden="true">
                  {activeTitle}
                </span>
              </span>
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9890] truncate">
              Global Audio
            </span>
          )}
        </span>
        <span
          className={`shrink-0 text-[10px] font-mono font-semibold tabular-nums ${
            mediaMuted || pct === 0
              ? 'text-red-400'
              : isBoosted
                ? 'text-[#ffd43b]'
                : 'text-[#d4d2cb]'
          }`}
        >
          {mediaMuted || pct === 0 ? 'MUTED' : `${pct}%${isBoosted ? ' BOOST' : ''}`}
        </span>
      </div>

      {/* Live 16-Band Segmented LED Graphic Equalizer (only shown when sound is actively playing) */}
      {showEq && (
        <div
          aria-label="Live audio graphic equalizer"
          title={
            hasSpectrum
              ? 'Live 16-band Web Audio FFT spectrum analyzer'
              : 'Live audio equalizer (media host restricts raw CORS spectrum sampling)'
          }
          className="relative h-12 px-2 py-1.5 rounded-xl bg-[#08090e] border border-[#242838] shadow-[inset_0_2px_10px_rgba(0,0,0,0.85)] flex items-end gap-[3px] overflow-hidden"
        >
          {bars.map((val, idx) => {
            const barPct = Math.max(5, Math.round(val * 100))
            const peakPct = Math.max(barPct, Math.round((peaks[idx] || 0) * 100))
            const peakColorClass =
              peakPct >= 82
                ? 'bg-[#ff6b6b] shadow-[0_0_6px_rgba(239,68,68,0.95)]'
                : peakPct >= 58
                  ? 'bg-[#ffe066] shadow-[0_0_5px_rgba(255,212,59,0.9)]'
                  : 'bg-[#6ee7b7] shadow-[0_0_5px_rgba(52,211,153,0.8)]'
            return (
              <div
                key={idx}
                className="relative flex-1 h-full rounded-[1.5px] bg-[#141724]/80 overflow-hidden"
              >
                {/* Level-accurate vertical spectrum fixed to full meter height, revealed via clip-path */}
                <div
                  style={{
                    clipPath: `inset(${100 - barPct}% 0 0 0)`,
                    backgroundImage: isBoosted
                      ? 'linear-gradient(to top, #059669 0%, #10b981 24%, #4ade80 44%, #facc15 62%, #ff922b 78%, #ef4444 92%, #fff3bf 100%)'
                      : 'linear-gradient(to top, #059669 0%, #10b981 28%, #4ade80 52%, #facc15 70%, #ff922b 85%, #ef4444 100%)',
                    transition: 'clip-path 65ms linear',
                  }}
                  className="absolute inset-0"
                />
                {/* Color-matched decaying peak-hold LED cap */}
                {peakPct > 10 && (
                  <span
                    style={{ bottom: `calc(${Math.min(95, peakPct)}% - 1.5px)` }}
                    className={`absolute inset-x-0 h-[2px] rounded-full z-20 ${peakColorClass}`}
                  />
                )}
              </div>
            )
          })}
          {/* Crisp horizontal LED segment dividers across all 16 bands */}
          <div
            aria-hidden="true"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to top, transparent 0px, transparent 3px, rgba(8, 9, 14, 0.9) 3px, rgba(8, 9, 14, 0.9) 4.5px)',
            }}
            className="pointer-events-none absolute inset-x-2 inset-y-1.5 z-10"
          />
        </div>
      )}

      {/* Permanent Global Volume Slider (0% -> 200% Boost) */}
      <div
        onWheel={(e) => {
          e.preventDefault()
          const delta = e.deltaY < 0 ? 0.06 : -0.06
          handleVolumeChange(Math.min(2, Math.max(0, effectiveVol + delta)))
        }}
        className="flex items-center gap-2"
        title="Global volume for all Fire Wisp videos & streams (0–100% normal, 101–200% boost · scroll wheel adjusts)"
      >
        <button
          type="button"
          onClick={handleToggleMute}
          aria-label={mediaMuted ? 'Unmute global audio' : 'Mute global audio'}
          className={`p-1 rounded-lg border transition cursor-pointer shrink-0 ${
            mediaMuted || pct === 0
              ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
              : isBoosted
                ? 'bg-[#ffd43b]/15 border-[#ffd43b]/40 text-[#ffd43b] hover:bg-[#ffd43b]/25'
                : 'bg-[#0e0e11] border-[#262938] text-[#d4d2cb] hover:border-[#e8590c]/50 hover:text-white'
          }`}
        >
          <VolumeIcon className="w-3.5 h-3.5" />
        </button>

        <div className="relative flex-1 flex items-center">
          <span
            aria-hidden="true"
            title="100% normal volume"
            className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[1.5px] bg-white/30 pointer-events-none z-10 rounded-full"
          />
          <input
            type="range"
            min={0}
            max={200}
            step={2}
            value={pct}
            aria-label="Global volume"
            onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
            style={{
              background: `linear-gradient(90deg, ${
                isBoosted
                  ? '#e8590c 0%, #f59f00 50%, #ffd43b ' + fillPct + '%'
                  : '#e8590c 0%, #ff922b ' + fillPct + '%'
              }, rgba(255,255,255,0.18) ${fillPct}%, rgba(255,255,255,0.18) 100%)`,
            }}
            className="fw-vol-slider w-full h-1.5 rounded-full appearance-none cursor-pointer"
          />
        </div>
      </div>
    </div>
  )
}
