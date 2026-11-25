import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  PictureInPicture2,
  Play,
  Radio,
  Search,
  Users,
  X,
} from 'lucide-react'
import {
  decodeLiveNaddr,
  encodeLiveNaddr,
  getStreamPrimaryPubkey,
  isLiveStreamFresh,
  isStreamFollowed,
  sortLiveStreams,
} from '../lib/nostr/nip53'
import { isConnectionSaveData } from '../lib/mediaAudio'
import { useLiveStore, type LiveStreamEntry } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'
import { LiveHoverPreview, type HoverPreviewStatus } from '../components/LiveHoverPreview'

const HOVER_PREVIEW_DELAY_MS = 350

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function extractNaddr(raw: string): string | null {
  const m = /(naddr1[0-9a-z]+)/i.exec(raw.trim())
  return m ? m[1] : null
}

function LiveDirectoryCard({
  stream,
  isFollowed,
  followerCount,
  onSelectTag,
}: {
  stream: LiveStreamEntry
  isFollowed: boolean
  followerCount?: number
  onSelectTag: (tag: string) => void
}) {
  const displayPubkey = getStreamPrimaryPubkey(stream.activity)
  const profile = useNostrStore((s) => s.profiles[displayPubkey])
  const hoverStreamPreview = useSettingsStore((s) => s.hoverStreamPreview)
  const mobileDataSaving = useSettingsStore((s) => s.mobileDataSaving)
  const openMiniPlayer = useLiveStore((s) => s.openMiniPlayer)
  const isInMiniPlayer = useLiveStore((s) => s.miniPlayer?.aTag === stream.aTagValue)

  const [imgFailed, setImgFailed] = useState(false)
  const [hoverActive, setHoverActive] = useState(false)
  const [previewStatus, setPreviewStatus] = useState<HoverPreviewStatus | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hostName = profile?.display_name || profile?.name || `${displayPubkey.slice(0, 10)}…`
  const title = stream.activity.title || `${hostName}'s stream`
  const thumb = stream.activity.image
  const previewUrl = stream.activity.streamingUrl || stream.activity.recordingUrl
  const naddr = useMemo(
    () =>
      encodeLiveNaddr(
        stream.activity.hostPubkey,
        stream.activity.dTag,
        stream.activity.relayHints,
      ),
    [stream.activity.hostPubkey, stream.activity.dTag, stream.activity.relayHints],
  )

  useEffect(() => {
    setImgFailed(false)
  }, [thumb])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const handleMouseEnter = () => {
    if (!hoverStreamPreview || mobileDataSaving || isConnectionSaveData() || !previewUrl || isInMiniPlayer) {
      return
    }
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      !window.matchMedia('(hover: hover)').matches
    ) {
      return
    }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      setHoverActive(true)
    }, HOVER_PREVIEW_DELAY_MS)
  }

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverActive(false)
    setPreviewStatus(null)
  }

  const viewers = stream.activity.currentParticipants
  const chatters = stream.chatters.length
  const statLabel =
    viewers && viewers > 0
      ? `${viewers.toLocaleString()} watching`
      : chatters > 0
        ? `${chatters} chatting`
        : null

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative rounded-2xl bg-[#13151d] hover:bg-[#191c27] border overflow-hidden transition group flex flex-col shadow-md shadow-black/50 ${
        isFollowed
          ? 'border-emerald-500/45 hover:border-emerald-400'
          : 'border-[#222534] hover:border-[#e8590c]/60'
      }`}
    >
      {/* 16:9 Stream Preview */}
      <div className="relative aspect-video w-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] overflow-hidden">
        <Link
          to={`/live/${naddr}`}
          aria-label={`Watch ${title}`}
          className="block w-full h-full"
        >
          {thumb && !imgFailed ? (
            <img
              src={thumb}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center opacity-80">
              <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="lg" />
            </div>
          )}
        </Link>

        {hoverActive && !isInMiniPlayer && previewUrl && (
          <LiveHoverPreview
            streamUrl={previewUrl}
            rightOffset
            onStatusChange={setPreviewStatus}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25 pointer-events-none" />

        {/* Top-left LIVE + Following badges */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 pointer-events-none">
          <span className="px-2 py-0.5 rounded bg-red-600/95 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
          {isFollowed && (
            <span className="px-2 py-0.5 rounded bg-emerald-600/95 text-white text-[10px] font-bold tracking-wide shadow">
              Following
            </span>
          )}
        </div>

        {/* Top-right Mini-Player button */}
        {previewUrl && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleMouseLeave()
              openMiniPlayer({
                aTag: stream.aTagValue,
                naddr,
                streamUrl: previewUrl,
                posterUrl: thumb,
                title,
                hostName,
                isLive: stream.activity.status === 'live',
              })
            }}
            title="Pop out mini-player and keep browsing"
            aria-label={`Pop out ${title} in mini-player`}
            className="absolute top-2.5 right-2.5 z-20 p-1.5 rounded-lg bg-black/75 hover:bg-[#e8590c] border border-white/15 text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition shadow cursor-pointer"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Center hover play button */}
        {previewStatus !== 'playing' && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-[#e8590c]/90 text-white flex items-center justify-center shadow-xl">
              <Play className="w-5 h-5 fill-white ml-0.5" />
            </div>
          </div>
        )}

        {/* Bottom-right viewer/chatter count */}
        {statLabel && (
          <span className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[11px] font-medium text-[#ece9e1] pointer-events-none">
            {statLabel}
          </span>
        )}
      </div>

      {/* Stream details */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        <Link to={`/live/${naddr}`} className="flex items-start gap-2.5 min-w-0">
          <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="sm" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[#f4f1ea] group-hover:text-[#ff922b] line-clamp-1 transition leading-snug">
              {title}
            </h3>
            <div className="text-xs text-[#9a9890] truncate mt-0.5 flex items-center gap-1">
              <span className="truncate">{hostName}</span>
              {typeof followerCount === 'number' && followerCount > 0 && (
                <span className="text-[11px] text-[#6f6d66] shrink-0">
                  · {formatCompactCount(followerCount)} followers
                </span>
              )}
            </div>
          </div>
        </Link>

        {stream.activity.summary && (
          <p className="text-xs text-[#b5b2a8] line-clamp-2 leading-relaxed">
            {stream.activity.summary}
          </p>
        )}

        {(stream.activity.hashtags?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-auto pt-0.5">
            {(stream.activity.hashtags || []).slice(0, 4).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSelectTag(tag)}
                className="px-2 py-0.5 rounded-md bg-[#1d202d] hover:bg-[#e8590c]/20 border border-[#2a2e40] hover:border-[#e8590c]/50 text-[10px] text-[#c7c4bc] hover:text-[#ff922b] transition cursor-pointer"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function LiveDirectoryPage() {
  const navigate = useNavigate()
  const liveStreams = useLiveStore((s) => s.liveStreams)
  const followerCounts = useLiveStore((s) => s.streamerFollowerCounts)
  const follows = useNostrStore((s) => s.follows)
  const profiles = useNostrStore((s) => s.profiles)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)

  const [query, setQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'following'>('all')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(t)
  }, [])

  const followSet = useMemo(
    () => new Set(follows.map((p) => p.toLowerCase())),
    [follows],
  )

  const allFreshSorted = useMemo(() => {
    const mutedSet = new Set([...mutedPubkeys, ...privateMutedPubkeys].map((p) => p.toLowerCase()))
    const fresh = Object.values(liveStreams).filter((s) => {
      if (!isLiveStreamFresh(s, nowSec)) return false
      const primaryPk = getStreamPrimaryPubkey(s.activity)
      if (mutedSet.has(primaryPk) || mutedSet.has(s.activity.hostPubkey.toLowerCase())) {
        return false
      }
      return true
    })
    return sortLiveStreams(fresh, followSet, followerCounts)
  }, [liveStreams, mutedPubkeys, privateMutedPubkeys, followSet, followerCounts, nowSec])

  const followedCount = useMemo(
    () => allFreshSorted.filter((s) => isStreamFollowed(s.activity, followSet)).length,
    [allFreshSorted, followSet],
  )

  const topTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allFreshSorted) {
      for (const raw of s.activity.hashtags || []) {
        const clean = raw.trim().toLowerCase()
        if (!clean || clean.length > 24) continue
        counts.set(clean, (counts.get(clean) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag)
  }, [allFreshSorted])

  const visibleStreams = useMemo(() => {
    const cleanQ = query.trim().toLowerCase()
    return allFreshSorted.filter((s) => {
      if (filterMode === 'following' && !isStreamFollowed(s.activity, followSet)) {
        return false
      }
      if (selectedTag) {
        const hasTag = (s.activity.hashtags || []).some((t) => t.toLowerCase() === selectedTag)
        if (!hasTag) return false
      }
      if (!cleanQ) return true
      const pk = getStreamPrimaryPubkey(s.activity)
      const prof = profiles[pk]
      const hay = [
        s.activity.title,
        s.activity.summary,
        prof?.display_name,
        prof?.name,
        prof?.nip05,
        s.activity.dTag,
        ...(s.activity.hashtags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(cleanQ)
    })
  }, [allFreshSorted, filterMode, followSet, selectedTag, query, profiles])

  const pastedNaddr = useMemo(() => extractNaddr(query), [query])
  const validPastedNaddr = useMemo(
    () => (pastedNaddr && decodeLiveNaddr(pastedNaddr) ? pastedNaddr : null),
    [pastedNaddr],
  )

  return (
    <div className="min-h-screen">
      {/* Sticky Header */}
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/92 backdrop-blur-md border-b border-[#20222c] px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shrink-0">
              <Radio className="w-3 h-3 animate-pulse" />
              LIVE
            </span>
            <h1 className="font-bold text-base text-white truncate">Live Streams</h1>
            <span className="text-xs text-[#8c8a82] shrink-0">
              {allFreshSorted.length} {allFreshSorted.length === 1 ? 'stream' : 'streams'}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-[#15161c] border border-[#252836] rounded-xl p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-[#e8590c] text-white'
                  : 'text-[#9a9890] hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('following')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                filterMode === 'following'
                  ? 'bg-emerald-600 text-white'
                  : 'text-[#9a9890] hover:text-white'
              }`}
            >
              <Users className="w-3 h-3" />
              Following
              {followedCount > 0 && (
                <span className="text-[10px] opacity-85">({followedCount})</span>
              )}
            </button>
          </div>
        </div>

        {/* Search / paste naddr input */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#7c7a72] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search live streams, hosts, tags, or paste naddr1…"
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-[#15161c] border border-[#262938] focus:border-[#e8590c] focus:outline-none text-xs text-white placeholder-[#7c7a72]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7c7a72] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {validPastedNaddr && (
            <button
              type="button"
              onClick={() => navigate(`/live/${validPastedNaddr}`)}
              className="px-3 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-white text-xs font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer"
            >
              Open Stream
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Active tag chips */}
        {topTags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="px-2 py-0.5 rounded-lg bg-[#e8590c]/20 border border-[#e8590c]/50 text-[#ff922b] text-[11px] font-medium flex items-center gap-1 shrink-0 cursor-pointer"
              >
                #{selectedTag}
                <X className="w-3 h-3" />
              </button>
            )}
            {topTags
              .filter((t) => t !== selectedTag)
              .map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag)}
                  className="px-2 py-0.5 rounded-lg bg-[#161822] hover:bg-[#202332] border border-[#262938] text-[11px] text-[#b5b2a8] hover:text-white shrink-0 transition cursor-pointer"
                >
                  #{tag}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Stream Grid */}
      <div className="p-4">
        {visibleStreams.length === 0 ? (
          <div className="py-16 text-center space-y-2.5">
            <div className="w-12 h-12 rounded-2xl bg-[#15161c] border border-[#252836] mx-auto flex items-center justify-center text-[#7c7a72]">
              <Radio className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-[#d4d2cb]">
              {allFreshSorted.length === 0
                ? 'Discovering active Nostr live streams…'
                : filterMode === 'following'
                  ? 'None of the accounts you follow are live right now.'
                  : 'No live streams match that filter.'}
            </p>
            {(filterMode !== 'all' || selectedTag || query) && (
              <button
                type="button"
                onClick={() => {
                  setFilterMode('all')
                  setSelectedTag(null)
                  setQuery('')
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#1d202d] hover:bg-[#262a3b] border border-[#2f3449] text-xs font-semibold text-[#ff922b] cursor-pointer"
              >
                Show all live streams
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {visibleStreams.map((stream) => {
              const pk = getStreamPrimaryPubkey(stream.activity)
              return (
                <LiveDirectoryCard
                  key={stream.aTagValue}
                  stream={stream}
                  isFollowed={isStreamFollowed(stream.activity, followSet)}
                  followerCount={
                    followerCounts[pk] ?? followerCounts[stream.activity.hostPubkey.toLowerCase()]
                  }
                  onSelectTag={(tag) => setSelectedTag((cur) => (cur === tag.toLowerCase() ? null : tag.toLowerCase()))}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
