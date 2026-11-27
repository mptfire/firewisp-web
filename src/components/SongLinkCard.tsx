import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Music2, Pause, Play } from 'lucide-react'
import {
  applyVideoAudioLevel,
  claimFeedVideoFocus,
  formatAudioSourceLabel,
  onOtherFeedVideoFocus,
  releaseFeedVideoFocus,
  reportVideoSoundActive,
} from '../lib/mediaAudio'
import {
  fetchItunesTrackMeta,
  type ItunesTrackMeta,
  type SongLinkRef,
} from '../lib/nostr/songLink'
import { useSettingsStore } from '../lib/store/useSettingsStore'

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const whole = Math.floor(sec)
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Privacy-first inline song.link / album.link / odesli card:
 * - Never mounts third-party iframes (`odesli.co` is blocked by server CSP and would leak telemetry).
 * - For iTunes track IDs (`/i/<id>`), fetches public CORS track metadata (artwork + title + artist)
 *   and plays the 30-second AAC/M4A preview via a native `<audio>` element integrated into Global Audio.
 */
export function SongLinkCard({
  song,
  compact = false,
  authorName,
}: {
  song: SongLinkRef
  compact?: boolean
  authorName?: string
}) {
  const inlineMediaPlayback = useSettingsStore((s) => s.inlineMediaPlayback)
  const mobileDataSaving = useSettingsStore((s) => s.mobileDataSaving)
  const mediaVolume = useSettingsStore((s) => s.mediaVolume)
  const mediaMuted = useSettingsStore((s) => s.mediaMuted)

  const playerId = useId()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mountedRef = useRef(true)

  const [meta, setMeta] = useState<ItunesTrackMeta | null>(null)
  const [metaRequested, setMetaRequested] = useState(
    () => Boolean(song.itunesTrackId) && !mobileDataSaving,
  )
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(30)
  const [playbackError, setPlaybackError] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!song.itunesTrackId || !metaRequested) return
    let cancelled = false
    setLoadingMeta(true)
    fetchItunesTrackMeta(song.itunesTrackId)
      .then((res) => {
        if (cancelled || !mountedRef.current) return
        setMeta(res)
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoadingMeta(false)
      })
    return () => {
      cancelled = true
    }
  }, [song.itunesTrackId, metaRequested])

  // Sync Global Audio volume / mute changes while loaded
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    applyVideoAudioLevel(el, Math.min(1, mediaVolume), mediaMuted, false, false)
  }, [mediaVolume, mediaMuted, playing])

  // Yield focus when another player starts playing
  useEffect(() => {
    return onOtherFeedVideoFocus(playerId, () => {
      const el = audioRef.current
      if (el && !el.paused) {
        el.pause()
      }
    })
  }, [playerId])

  // Clean up Global Audio registration on unmount
  useEffect(() => {
    const el = audioRef.current
    return () => {
      if (el) {
        reportVideoSoundActive(el, false)
      }
      releaseFeedVideoFocus(playerId)
    }
  }, [playerId])

  const sourceLabel = formatAudioSourceLabel(
    meta?.artistName || authorName,
    meta?.trackName || meta?.collectionName || song.host,
    song.url,
  )

  const handleTogglePlay = async () => {
    const el = audioRef.current
    if (!el || !meta?.previewUrl) return
    setPlaybackError(false)
    if (!el.paused) {
      el.pause()
      return
    }
    try {
      claimFeedVideoFocus(playerId)
      applyVideoAudioLevel(el, Math.min(1, mediaVolume), mediaMuted, false, false)
      await el.play()
      reportVideoSoundActive(el, true, sourceLabel)
    } catch {
      setPlaybackError(true)
      reportVideoSoundActive(el, false)
      releaseFeedVideoFocus(playerId)
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current
    if (!el || !Number.isFinite(duration) || duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrentTime(el.currentTime)
  }

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="rounded-xl overflow-hidden border border-[#262834] bg-[#0e0f15] hover:border-[#343748] transition"
    >
      <div className={`flex items-center gap-3 ${compact ? 'p-2.5' : 'p-3'}`}>
        <div
          className={`shrink-0 rounded-lg overflow-hidden border border-[#262834] bg-[#161822] flex items-center justify-center ${
            compact ? 'w-12 h-12' : 'w-14 h-14'
          }`}
        >
          {meta?.artworkUrl ? (
            <img
              src={meta.artworkUrl}
              alt={meta.trackName || 'Album artwork'}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <Music2 className="w-5 h-5 text-[#ff922b]" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-white truncate">
                {meta?.trackName || (loadingMeta ? 'Loading track info…' : 'Shared Music Track')}
              </div>
              <div className="text-[11px] text-[#9b988f] truncate">
                {meta?.artistName
                  ? meta.collectionName
                    ? `${meta.artistName} • ${meta.collectionName}`
                    : meta.artistName
                  : song.url.replace(/^https?:\/\//, '')}
              </div>
            </div>
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#181a24] border border-[#2a2d3d] text-[10px] font-semibold uppercase tracking-wide text-[#ff922b]">
              {song.host}
            </span>
          </div>

          {song.itunesTrackId && mobileDataSaving && !metaRequested && (
            <button
              type="button"
              onClick={() => setMetaRequested(true)}
              className="text-[11px] font-medium text-[#ff922b] hover:text-[#ffa94d] cursor-pointer"
            >
              Load track preview
            </button>
          )}

          {meta?.previewUrl && inlineMediaPlayback && (
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void handleTogglePlay()}
                aria-label={playing ? 'Pause 30 second preview' : 'Play 30 second preview'}
                className="shrink-0 w-7 h-7 rounded-full bg-[#e8590c] hover:bg-[#ff6b1a] text-white flex items-center justify-center transition cursor-pointer"
              >
                {playing ? (
                  <Pause className="w-3.5 h-3.5 fill-white" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                )}
              </button>

              <div
                onClick={handleSeek}
                role="slider"
                tabIndex={0}
                aria-label="Track preview progress"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentTime)}
                onKeyDown={(e) => {
                  const el = audioRef.current
                  if (!el) return
                  if (e.key === 'ArrowRight') {
                    e.preventDefault()
                    el.currentTime = Math.min(duration, el.currentTime + 5)
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault()
                    el.currentTime = Math.max(0, el.currentTime - 5)
                  }
                }}
                className="relative flex-1 h-2 rounded-full bg-[#1e202c] overflow-hidden cursor-pointer"
              >
                <div
                  className="h-full bg-[#ff922b] transition-[width] duration-75"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <span className="shrink-0 text-[10px] font-mono text-[#9b988f] tabular-nums">
                {formatClock(currentTime)} / {formatClock(duration)}
              </span>

              <audio
                ref={audioRef}
                preload="none"
                src={meta.previewUrl}
                onPlay={() => {
                  setPlaying(true)
                  const el = audioRef.current
                  if (el) reportVideoSoundActive(el, true, sourceLabel)
                }}
                onPause={() => {
                  setPlaying(false)
                  const el = audioRef.current
                  if (el) reportVideoSoundActive(el, false)
                  releaseFeedVideoFocus(playerId)
                }}
                onEnded={() => {
                  setPlaying(false)
                  setCurrentTime(0)
                  const el = audioRef.current
                  if (el) reportVideoSoundActive(el, false)
                  releaseFeedVideoFocus(playerId)
                }}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setDuration(d)
                }}
                onTimeUpdate={(e) => {
                  setCurrentTime(e.currentTarget.currentTime)
                }}
                onError={() => {
                  setPlaybackError(true)
                  setPlaying(false)
                  const el = audioRef.current
                  if (el) reportVideoSoundActive(el, false)
                  releaseFeedVideoFocus(playerId)
                }}
              />
            </div>
          )}

          {playbackError && (
            <div className="text-[11px] text-amber-400">Preview unavailable — open on {song.host}.</div>
          )}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-[#76746c]">
              {meta?.previewUrl
                ? inlineMediaPlayback
                  ? '30s iTunes preview'
                  : 'Inline audio disabled in Settings'
                : song.itunesTrackId && loadingMeta
                  ? 'Checking preview…'
                  : 'Multi-platform music link'}
            </span>
            <a
              href={song.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#ff922b] hover:text-[#ffa94d]"
            >
              Open on {song.host}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
