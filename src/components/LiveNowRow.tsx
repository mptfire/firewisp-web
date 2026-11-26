import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  PictureInPicture2,
  Play,
  Radio,
} from 'lucide-react'
import {
  encodeLiveNaddr,
  getStreamPrimaryPubkey,
  isLiveStreamFresh,
  isStreamFollowed,
  sortLiveStreams,
} from '../lib/nostr/nip53'
import { formatAudioSourceLabel, isConnectionSaveData } from '../lib/mediaAudio'
import { useLiveStore, type LiveStreamEntry } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { LiveHoverPreview, type HoverPreviewStatus } from './LiveHoverPreview'

const HOVER_PREVIEW_DELAY_MS = 350

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

function LiveStreamPreviewCard({
  stream,
  isFollowed,
  followerCount,
  onWatchWith,
}: {
  stream: LiveStreamEntry
  isFollowed: boolean
  followerCount?: number
  onWatchWith?: (stream: LiveStreamEntry) => void
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

  const hostName = profile?.display_name || profile?.name || `${displayPubkey.slice(0, 8)}…`
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
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(hover: hover)').matches) {
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
      className={`relative w-48 sm:w-52 rounded-xl bg-[#13151d] hover:bg-[#1a1d28] border overflow-hidden transition shrink-0 group flex flex-col shadow-md shadow-black/50 ${
        isFollowed
          ? 'border-emerald-500/45 hover:border-emerald-400'
          : 'border-[#1d202d] hover:border-[#e8590c]/60'
      }`}
    >
      {/* 16:9 Stream Thumbnail Preview */}
      <div className="relative z-[6] aspect-video w-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] overflow-hidden">
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
            sourceLabel={formatAudioSourceLabel(hostName, title, previewUrl)}
            rightOffset={onWatchWith ? 'wide' : true}
            onStatusChange={setPreviewStatus}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />

        {/* Top-left LIVE + Following badges */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 pointer-events-none">
          <span className="px-1.5 py-0.5 rounded bg-red-600/95 text-white text-[9px] font-bold tracking-wider uppercase flex items-center gap-1 shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
          {isFollowed && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-600/95 text-white text-[9px] font-bold tracking-wide shadow">
              Following
            </span>
          )}
        </div>

        {/* Top-right Pop-out / Watch With buttons (sibling of Link, accessible on mouse, keyboard & touch) */}
        {previewUrl && (
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
            {onWatchWith && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleMouseLeave()
                  onWatchWith(stream)
                }}
                title="Watch With — open side-by-side in split view"
                aria-label={`Watch ${title} side-by-side`}
                className="p-1 rounded-md bg-black/75 hover:bg-[#e8590c] border border-white/15 text-white opacity-95 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition shadow cursor-pointer"
              >
                <Columns2 className="w-3.5 h-3.5" />
              </button>
            )}
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
              className="p-1 rounded-md bg-black/75 hover:bg-[#e8590c] border border-white/15 text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition shadow cursor-pointer"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Center hover play controls: Big Yellow Full Play (Live screen) + smaller Red Mini Play (Mini-player) */}
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition pointer-events-none">
          <Link
            to={`/live/${naddr}`}
            onClick={() => handleMouseLeave()}
            title={`Open ${title} on Live screen`}
            aria-label={`Open ${title} on Live screen`}
            className={`pointer-events-auto w-11 h-11 rounded-full text-black flex flex-col items-center justify-center gap-[1px] border border-yellow-200/70 shadow-lg transition hover:scale-105 ${
              previewStatus === 'playing'
                ? 'bg-yellow-400/85 hover:bg-yellow-400 backdrop-blur-xs'
                : 'bg-yellow-400/95 hover:bg-yellow-300'
            }`}
          >
            <Play className="w-4 h-4 fill-black ml-0.5" />
            <span className="text-[8.5px] font-extrabold leading-none tracking-tight">Full</span>
          </Link>
          {previewUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
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
              title="Open in Mini-player"
              aria-label={`Play ${title} in mini-player`}
              className="pointer-events-auto w-9 h-9 rounded-full bg-red-600/90 hover:bg-red-500 border border-red-300/50 backdrop-blur-xs text-white flex flex-col items-center justify-center gap-[1px] shadow-lg transition hover:scale-105 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-white ml-0.5" />
              <span className="text-[8px] font-bold leading-none tracking-tight">Mini</span>
            </button>
          )}
        </div>

        {/* Bottom-right viewer/chatter pill */}
        {statLabel && (
          <span className="absolute bottom-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[10px] font-medium text-[#ece9e1] pointer-events-none">
            {statLabel}
          </span>
        )}
      </div>

      {/* Host & Title Footer */}
      <Link to={`/live/${naddr}`} className="p-2 flex items-center gap-2 min-w-0">
        <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#f4f1ea] group-hover:text-[#ff922b] truncate leading-tight transition">
            {title}
          </div>
          <div className="text-[11px] text-[#8c8a82] truncate leading-tight mt-0.5 flex items-center gap-1">
            <span className="truncate">{hostName}</span>
            {typeof followerCount === 'number' && followerCount > 0 && (
              <span className="text-[10px] text-[#6f6d66] shrink-0">
                · {formatCompactCount(followerCount)}
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  )
}

function LiveNowCompactPill({
  stream,
  isFollowed,
}: {
  stream: LiveStreamEntry
  isFollowed: boolean
}) {
  const displayPubkey = getStreamPrimaryPubkey(stream.activity)
  const profile = useNostrStore((s) => s.profiles[displayPubkey])
  const hostName = profile?.display_name || profile?.name || `${displayPubkey.slice(0, 8)}…`
  const title = stream.activity.title || `${hostName}'s stream`
  const naddr = useMemo(
    () =>
      encodeLiveNaddr(
        stream.activity.hostPubkey,
        stream.activity.dTag,
        stream.activity.relayHints,
      ),
    [stream.activity.hostPubkey, stream.activity.dTag, stream.activity.relayHints],
  )
  const viewers = stream.activity.currentParticipants
  const chatters = stream.chatters.length
  const statLabel =
    viewers && viewers > 0
      ? `${viewers.toLocaleString()} watching`
      : chatters > 0
        ? `${chatters} chatting`
        : null

  return (
    <Link
      to={`/live/${naddr}`}
      className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border transition shrink-0 group ${
        isFollowed
          ? 'bg-emerald-500/12 hover:bg-emerald-500/22 border-emerald-500/40 hover:border-emerald-400'
          : 'bg-[#e8590c]/12 hover:bg-[#e8590c]/22 border-[#e8590c]/30 hover:border-[#e8590c]/60'
      }`}
    >
      <div className="relative shrink-0">
        <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="sm" />
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#0e0e11]" />
      </div>
      <span className="text-xs font-medium text-[#f4f1ea] group-hover:text-white max-w-[160px] truncate">
        {title}
      </span>
      {statLabel && (
        <span className="text-[11px] text-[#9a9890] shrink-0">{statLabel}</span>
      )}
    </Link>
  )
}

export function LiveNowRow({
  forceShow = false,
  excludeATag,
  onWatchWith,
}: {
  /** Render regardless of the global "Show Live Now bar" setting (used by the stream page reveal panel). */
  forceShow?: boolean
  /** Hide the stream currently being watched. */
  excludeATag?: string
  /** Optional Watch With callback when rendered on a stream page. */
  onWatchWith?: (stream: LiveStreamEntry) => void
} = {}) {
  const showLiveNowBarSetting = useSettingsStore((s) => s.showLiveNowBar)
  const liveBarExpandedSetting = useSettingsStore((s) => s.liveBarExpanded)
  const setLiveBarExpanded = useSettingsStore((s) => s.setLiveBarExpanded)
  const showLiveNowBar = forceShow || showLiveNowBarSetting
  const isExpanded = forceShow || liveBarExpandedSetting
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const follows = useNostrStore((s) => s.follows)
  const liveStreams = useLiveStore((s) => s.liveStreams)
  const followerCounts = useLiveStore((s) => s.streamerFollowerCounts)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  // Periodically prune stale/expired streams while the tab stays open
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(t)
  }, [])

  const followSet = useMemo(
    () => new Set(follows.map((p) => p.toLowerCase())),
    [follows],
  )

  const activeStreams = useMemo(() => {
    const mutedSet = new Set(
      [...mutedPubkeys, ...privateMutedPubkeys].map((p) => p.toLowerCase()),
    )
    const filtered = Object.values(liveStreams).filter((s) => {
      if (!isLiveStreamFresh(s, nowSec)) return false
      if (excludeATag && s.aTagValue === excludeATag) return false
      const hostPk = getStreamPrimaryPubkey(s.activity).toLowerCase()
      if (mutedSet.has(hostPk) || mutedSet.has(s.activity.hostPubkey.toLowerCase())) {
        return false
      }
      return true
    })
    return sortLiveStreams(filtered, followSet, followerCounts).slice(0, 15)
  }, [liveStreams, mutedPubkeys, privateMutedPubkeys, followSet, followerCounts, nowSec, excludeATag])

  const updateScrollArrows = () => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    updateScrollArrows()
    window.addEventListener('resize', updateScrollArrows)
    return () => window.removeEventListener('resize', updateScrollArrows)
  }, [activeStreams.length, showLiveNowBar, isExpanded])

  // Attach native non-passive wheel listener so horizontal wheel scroll cleanly prevents vertical scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (el.scrollWidth <= el.clientWidth) return
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
      if (!atStart && !atEnd) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [activeStreams.length, showLiveNowBar, isExpanded])

  if (!showLiveNowBar || activeStreams.length === 0) return null

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  if (!isExpanded) {
    return (
      <div className="border-b border-[#20222c] bg-[#111218]/90 px-3 py-2 flex items-center gap-2">
        <Link
          to="/live"
          title="Browse all live streams"
          className="px-2 py-1 rounded-md bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shrink-0 transition"
        >
          <Radio className="w-3 h-3 animate-pulse" />
          LIVE
        </Link>
        {!forceShow && (
          <button
            type="button"
            aria-expanded={false}
            aria-label="Expand Live Now to full stream cards"
            title="Expand to full stream cards"
            onClick={() => setLiveBarExpanded(true)}
            className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] border border-[#2d3042] text-white transition cursor-pointer shrink-0"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
        <div
          ref={scrollRef}
          onScroll={updateScrollArrows}
          className="live-scroll flex-1 min-w-0 flex items-center gap-2 overflow-x-auto pb-0.5"
        >
          {activeStreams.map((stream) => (
            <LiveNowCompactPill
              key={stream.aTagValue}
              stream={stream}
              isFollowed={isStreamFollowed(stream.activity, followSet)}
            />
          ))}
        </div>
        {(canScrollLeft || canScrollRight) && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={!canScrollLeft}
              onClick={() => scrollByAmount(-220)}
              aria-label="Scroll live streams left"
              className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] disabled:opacity-30 border border-[#2d3042] text-white transition cursor-pointer disabled:cursor-default"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!canScrollRight}
              onClick={() => scrollByAmount(220)}
              aria-label="Scroll live streams right"
              className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] disabled:opacity-30 border border-[#2d3042] text-white transition cursor-pointer disabled:cursor-default"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={
        forceShow
          ? 'bg-[#090a0e] px-3 pt-2.5 pb-2 space-y-2'
          : 'mx-2.5 my-2.5 rounded-2xl bg-[#090a0e] border-2 border-[#040407] shadow-[0_0_0_1px_#232635,inset_0_2px_10px_rgba(0,0,0,0.75)] px-3 pt-2.5 pb-2 space-y-2'
      }
    >
      {/* Header Row: LIVE NOW count + compact toggle + scroll arrows */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE NOW
          </span>
          <span className="text-[11px] text-[#8c8a82]">
            {activeStreams.length} {activeStreams.length === 1 ? 'stream' : 'streams'}
          </span>
          {!forceShow && (
            <button
              type="button"
              aria-expanded={true}
              aria-label="Collapse Live Now to compact bar"
              title="Collapse to compact bar"
              onClick={() => setLiveBarExpanded(false)}
              className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] border border-[#2d3042] text-white transition cursor-pointer shrink-0"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          )}
          {!forceShow && (
            <Link
              to="/live"
              className="text-[11px] font-medium text-[#ff8a3d] hover:underline ml-1"
            >
              Browse all →
            </Link>
          )}
        </div>

        {(canScrollLeft || canScrollRight) && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canScrollLeft}
              onClick={() => scrollByAmount(-240)}
              aria-label="Scroll live streams left"
              className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] disabled:opacity-30 border border-[#2d3042] text-white transition cursor-pointer disabled:cursor-default"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={!canScrollRight}
              onClick={() => scrollByAmount(240)}
              aria-label="Scroll live streams right"
              className="p-1 rounded-lg bg-[#1a1c26] hover:bg-[#e8590c] disabled:opacity-30 border border-[#2d3042] text-white transition cursor-pointer disabled:cursor-default"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Horizontal Scrollable Preview Cards */}
      <div
        ref={scrollRef}
        onScroll={updateScrollArrows}
        className="live-scroll flex items-stretch gap-2.5 overflow-x-auto pb-2"
      >
        {activeStreams.map((stream) => {
          const pk = getStreamPrimaryPubkey(stream.activity)
          return (
            <LiveStreamPreviewCard
              key={stream.aTagValue}
              stream={stream}
              isFollowed={isStreamFollowed(stream.activity, followSet)}
              followerCount={
                followerCounts[pk] ?? followerCounts[stream.activity.hostPubkey.toLowerCase()]
              }
              onWatchWith={onWatchWith}
            />
          )
        })}
      </div>
    </div>
  )
}
