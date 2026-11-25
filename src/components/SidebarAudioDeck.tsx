import { useEffect, useRef, useState } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'
import {
  hasActiveSoundPlaying,
  readActiveFrequencyBands,
  subscribeAudioActivity,
} from '../lib/mediaAudio'
import { useSettingsStore } from '../lib/store/useSettingsStore'

const EQ_BAND_COUNT = 16

/**
 * Compact persistent sidebar audio deck underneath Live Zaps / Top Zappers:
 * - Always-available Global Volume slider (0% -> 200% boost) + Mute toggle
 * - Live 16-band graphic equalizer with decaying peak-hold caps that automatically appears when sound is playing
 */
export function SidebarAudioDeck() {
  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)
  const setMediaVolume = useSettingsStore((s) => s.setMediaVolume)
  const setMediaMuted = useSettingsStore((s) => s.setMediaMuted)

  const [soundPlaying, setSoundPlaying] = useState(() => hasActiveSoundPlaying())
  const [hasSpectrum, setHasSpectrum] = useState(false)
  const [bars, setBars] = useState<number[]>(() => Array(EQ_BAND_COUNT).fill(0))
  const [peaks, setPeaks] = useState<number[]>(() => Array(EQ_BAND_COUNT).fill(0))

  const scratchRef = useRef<number[]>(Array(EQ_BAND_COUNT).fill(0))
  const peaksRef = useRef<number[]>(Array(EQ_BAND_COUNT).fill(0))

  useEffect(() => {
    const sync = () => setSoundPlaying(hasActiveSoundPlaying())
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
        if (res.hasSpectrum) {
          const nextPeaks = peaksRef.current
          for (let i = 0; i < EQ_BAND_COUNT; i++) {
            const v = scratch[i]
            nextPeaks[i] = v >= nextPeaks[i] ? v : Math.max(0, nextPeaks[i] - 0.032)
          }
          setBars([...scratch])
          setPeaks([...nextPeaks])
        }
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

  const VolumeIcon = mediaMuted || pct === 0 ? VolumeX : pct < 45 ? Volume1 : Volume2

  const handleToggleMute = () => {
    const nextMuted = !mediaMuted
    setMediaMuted(nextMuted)
    if (!nextMuted && mediaVolume <= 0) setMediaVolume(0.85)
  }

  const handleVolumeChange = (nextVol: number) => {
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9890] flex items-center gap-1.5">
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
          Global Audio
        </span>
        <span
          className={`text-[10px] font-mono font-semibold tabular-nums ${
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

      {/* Live 16-Band Graphic Equalizer (only shown when sound is actively playing) */}
      {showEq && (
        <div
          aria-label="Live audio graphic equalizer"
          className="h-11 px-1.5 py-1.5 rounded-xl bg-[#0b0c12] border border-[#222534] flex items-end gap-[3px] overflow-hidden"
        >
          {hasSpectrum ? (
            bars.map((val, idx) => {
              const barPct = Math.max(6, Math.round(val * 100))
              const peakPct = Math.max(barPct, Math.round((peaks[idx] || 0) * 100))
              return (
                <div
                  key={idx}
                  className="relative flex-1 h-full flex items-end justify-center"
                >
                  <div
                    style={{ height: `${barPct}%` }}
                    className={`w-full rounded-t-[2px] transition-[height] duration-75 ${
                      isBoosted
                        ? 'bg-gradient-to-t from-[#e8590c] via-[#f59f00] to-[#fff3bf]'
                        : 'bg-gradient-to-t from-[#b91c1c] via-[#e8590c] to-[#ffd43b]'
                    }`}
                  />
                  {peakPct > 12 && (
                    <span
                      style={{ bottom: `calc(${Math.min(96, peakPct)}% - 1.5px)` }}
                      className="absolute inset-x-0 h-[2px] rounded-full bg-[#fff9db]/90"
                    />
                  )}
                </div>
              )
            })
          ) : (
            <div className="w-full h-full flex items-center justify-center gap-1.5 text-[10px] text-[#9a9890]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff922b] animate-pulse" />
              <span>Playing audio</span>
            </div>
          )}
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
