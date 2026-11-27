import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Disc3, FileText, Music2, Pause, Play } from 'lucide-react'
import {
  formatTrackDuration,
  KIND_MUSIC_PLAYLIST,
  KIND_MUSIC_TRACK,
  parseMusicPlaylistEvent,
  parseMusicTrackEvent,
  type NostrMusicPlaylist,
  type NostrMusicTrack,
} from '../lib/nostr/nostrMusic'
import { nostrPool } from '../lib/nostr/pool'
import { sanitizePublicRelayUrl } from '../lib/sanitize'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'

const MUSIC_FALLBACK_RELAYS = [
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.snort.social',
]

interface CachedMusicBundle {
  playlist: NostrMusicPlaylist | null
  tracks: NostrMusicTrack[]
}

const bundleCache = new Map<string, CachedMusicBundle>()

interface NostrMusicCardProps {
  kind: 34139 | 36787
  pubkey: string
  dTag: string
  bech32: string
  relays?: string[]
}

export const NostrMusicCard = memo(function NostrMusicCard({
  kind,
  pubkey,
  dTag,
  bech32,
  relays = [],
}: NostrMusicCardProps) {
  const aTag = `${kind}:${pubkey.toLowerCase()}:${dTag}`
  const authorProfile = useNostrStore((s) => s.profiles[pubkey.toLowerCase()])
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const readRelays = useSettingsStore((s) => s.getReadRelays)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)

  const [bundle, setBundle] = useState<CachedMusicBundle | null>(() => bundleCache.get(aTag) ?? null)
  const [loading, setLoading] = useState<boolean>(() => !bundleCache.has(aTag))
  const [activeIdx, setActiveIdx] = useState(0)
  const [urlAttemptIdx, setUrlAttemptIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingPlayRef = useRef(false)

  useEffect(() => {
    const cleanPk = pubkey.toLowerCase()
    if (!authorProfile) void fetchProfiles([cleanPk])
  }, [pubkey, authorProfile, fetchProfiles])

  useEffect(() => {
    const existing = bundleCache.get(aTag)
    if (existing) {
      setBundle(existing)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    const safeHintRelays = relays
      .map((r) => sanitizePublicRelayUrl(r))
      .filter((r): r is string => Boolean(r))
    const queryRelays = [
      ...new Set([...safeHintRelays, ...readRelays(), ...userReadRelays, ...MUSIC_FALLBACK_RELAYS]),
    ].slice(0, 10)

    void (async () => {
      try {
        const cleanPk = pubkey.toLowerCase()
        const primaryEvs = await nostrPool.query(
          queryRelays,
          { kinds: [kind], authors: [cleanPk], '#d': [dTag], limit: 3 },
          4500,
        )
        if (cancelled) return
        const latest = [...primaryEvs].sort((a, b) => b.created_at - a.created_at)[0]
        if (!latest) {
          setLoading(false)
          return
        }

        if (kind === KIND_MUSIC_TRACK) {
          const track = parseMusicTrackEvent(latest)
          const next: CachedMusicBundle = { playlist: null, tracks: track ? [track] : [] }
          if (track) bundleCache.set(aTag, next)
          if (!cancelled) {
            setBundle(next)
            setLoading(false)
          }
          return
        }

        const playlist = parseMusicPlaylistEvent(latest)
        if (!playlist) {
          setLoading(false)
          return
        }

        let tracks: NostrMusicTrack[] = []
        if (playlist.trackRefs.length > 0) {
          const byAuthor = new Map<string, string[]>()
          for (const ref of playlist.trackRefs) {
            const arr = byAuthor.get(ref.pubkey) || []
            arr.push(ref.dTag)
            byAuthor.set(ref.pubkey, arr)
          }
          const trackEvGroups = await Promise.all(
            [...byAuthor.entries()].map(([author, dTags]) =>
              nostrPool.query(
                queryRelays,
                { kinds: [KIND_MUSIC_TRACK], authors: [author], '#d': dTags, limit: dTags.length * 2 },
                5000,
              ),
            ),
          )
          if (cancelled) return

          const trackByATag = new Map<string, NostrMusicTrack>()
          for (const ev of trackEvGroups.flat()) {
            const parsed = parseMusicTrackEvent(ev)
            if (!parsed) continue
            const prev = trackByATag.get(parsed.aTag)
            if (!prev || parsed.createdAt > prev.createdAt) {
              trackByATag.set(parsed.aTag, parsed)
            }
          }
          tracks = playlist.trackRefs
            .map((ref) => trackByATag.get(ref.aTag))
            .filter((t): t is NostrMusicTrack => Boolean(t))
        }

        const next: CachedMusicBundle = { playlist, tracks }
        if (tracks.length > 0) bundleCache.set(aTag, next)
        if (!cancelled) {
          setBundle(next)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [aTag, dTag, kind, pubkey, relays, readRelays, userReadRelays])

  const playlist = bundle?.playlist || null
  const tracks = bundle?.tracks || []
  const activeTrack = tracks[activeIdx] || null
  const activeUrl = activeTrack?.audioUrls[urlAttemptIdx] || ''

  const coverUrl = useMemo(
    () => activeTrack?.imageUrl || playlist?.imageUrl || authorProfile?.picture || undefined,
    [activeTrack?.imageUrl, playlist?.imageUrl, authorProfile?.picture],
  )

  const headerTitle =
    playlist?.title || activeTrack?.album || activeTrack?.title || 'Nostr Audio Release'
  const headerSubtitle =
    playlist?.artist ||
    activeTrack?.artist ||
    authorProfile?.display_name ||
    authorProfile?.name ||
    `${pubkey.slice(0, 10)}…`

  useEffect(() => {
    if (!pendingPlayRef.current || !audioRef.current || !activeUrl) return
    pendingPlayRef.current = false
    void audioRef.current.play().catch(() => {
      setIsPlaying(false)
    })
  }, [activeUrl])

  const selectTrack = (index: number, autoPlay = true) => {
    if (index === activeIdx && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        void audioRef.current.play().catch(() => {})
      }
      return
    }
    pendingPlayRef.current = autoPlay
    setActiveIdx(index)
    setUrlAttemptIdx(0)
  }

  if (loading && !bundle) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-2 p-3 rounded-xl bg-[#151720] border border-[#272a36] flex items-center gap-3 text-xs text-[#8f8d85]"
      >
        <Disc3 className="w-4 h-4 text-[#f59f00] animate-spin shrink-0" />
        <span className="truncate">Loading Nostr audio ({kind === KIND_MUSIC_PLAYLIST ? 'album' : 'track'})…</span>
      </div>
    )
  }

  if (!activeTrack) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-2 px-3 py-2 rounded-xl bg-[#14161e] border border-[#242734] text-xs text-[#8a8880] truncate"
        title={bech32}
      >
        nostr:{bech32}
      </div>
    )
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="my-2.5 rounded-xl overflow-hidden border border-[#2e3140] bg-[#14161f] shadow-sm"
    >
      <div className="p-3 flex items-center gap-3">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={headerTitle}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-lg object-cover border border-[#2b2e3d] bg-[#0b0b0e] shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-[#1d202d] border border-[#2b2e3d] flex items-center justify-center shrink-0">
            <Music2 className="w-6 h-6 text-[#f59f00]" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#f59f00]">
            <span>{playlist ? playlist.type : 'Track'}</span>
            {tracks.length > 1 && <span>· {tracks.length} tracks</span>}
            {(playlist?.released || activeTrack.released) && (
              <span className="text-[#8a8880] font-normal">
                · {playlist?.released || activeTrack.released}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold text-white truncate">{headerTitle}</div>
          <div className="text-xs text-[#a8a59d] truncate">{headerSubtitle}</div>
          {playlist && (
            <div className="text-[11px] text-[#ff922b] truncate mt-0.5">
              Playing: {activeTrack.title}
            </div>
          )}
        </div>

        {activeTrack.lyrics && (
          <button
            type="button"
            onClick={() => setShowLyrics((v) => !v)}
            className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer shrink-0 ${
              showLyrics
                ? 'bg-[#f59f00]/15 border-[#f59f00]/45 text-[#ffb74d]'
                : 'bg-[#1b1d28] border-[#2d3042] text-[#b4b1a9] hover:text-white'
            }`}
            title="Toggle lyrics"
          >
            <FileText className="w-3 h-3" />
            Lyrics
          </button>
        )}
      </div>

      <div className="px-3 pb-2.5">
        <audio
          ref={audioRef}
          src={activeUrl}
          controls
          preload="none"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() => {
            if (urlAttemptIdx + 1 < activeTrack.audioUrls.length) {
              pendingPlayRef.current = true
              setUrlAttemptIdx((i) => i + 1)
            } else {
              setIsPlaying(false)
            }
          }}
          onEnded={() => {
            if (activeIdx + 1 < tracks.length) {
              selectTrack(activeIdx + 1, true)
            } else {
              setIsPlaying(false)
            }
          }}
          className="w-full h-9"
        />
      </div>

      {tracks.length > 1 && (
        <div className="max-h-48 overflow-y-auto border-t border-[#232635] divide-y divide-[#1f212e] bg-[#10121a]">
          {tracks.map((tr, idx) => {
            const active = idx === activeIdx
            const dur = formatTrackDuration(tr.durationSec)
            return (
              <button
                key={tr.aTag}
                type="button"
                onClick={() => selectTrack(idx, true)}
                className={`w-full px-3 py-1.5 flex items-center gap-2.5 text-left text-xs transition cursor-pointer ${
                  active
                    ? 'bg-[#f59f00]/10 text-[#ffb74d]'
                    : 'text-[#d0cdc4] hover:bg-[#191b26]'
                }`}
              >
                <span className="w-5 text-[11px] text-[#7e7c74] tabular-nums shrink-0 flex items-center justify-center">
                  {active && isPlaying ? (
                    <Pause className="w-3 h-3 text-[#f59f00]" />
                  ) : active ? (
                    <Play className="w-3 h-3 text-[#f59f00]" />
                  ) : (
                    tr.trackNumber ?? idx + 1
                  )}
                </span>
                <span className="flex-1 truncate font-medium">{tr.title}</span>
                {dur && (
                  <span className="text-[11px] text-[#7e7c74] tabular-nums shrink-0">{dur}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {showLyrics && activeTrack.lyrics && (
        <div className="px-3 py-2.5 border-t border-[#232635] bg-[#0e1017] max-h-56 overflow-y-auto text-xs text-[#c7c4bc] whitespace-pre-wrap leading-relaxed">
          {activeTrack.lyrics}
        </div>
      )}
    </div>
  )
})
