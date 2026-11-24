import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Play, Radio } from 'lucide-react'
import { encodeLiveNaddr } from '../lib/nostr/nip53'
import { useLiveStore, type LiveStreamEntry } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

function LiveStreamPreviewCard({ stream }: { stream: LiveStreamEntry }) {
  const displayPubkey = stream.activity.streamerPubkey || stream.activity.hostPubkey
  const profile = useNostrStore((s) => s.profiles[displayPubkey])
  const [imgFailed, setImgFailed] = useState(false)

  const hostName = profile?.display_name || profile?.name || `${displayPubkey.slice(0, 8)}…`
  const title = stream.activity.title || `${hostName}'s stream`
  const thumb = stream.activity.image
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
      className="w-48 sm:w-52 rounded-xl bg-[#161820] hover:bg-[#1c1f2b] border border-[#262938] hover:border-[#e8590c]/60 overflow-hidden transition shrink-0 group flex flex-col"
    >
      {/* 16:9 Stream Thumbnail Preview */}
      <div className="relative aspect-video w-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] overflow-hidden">
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

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />

        {/* Top-left LIVE badge */}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600/95 text-white text-[9px] font-bold tracking-wider uppercase flex items-center gap-1 shadow">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </span>

        {/* Hover play icon */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-[#e8590c]/90 text-white flex items-center justify-center shadow-lg">
            <Play className="w-4 h-4 fill-white ml-0.5" />
          </div>
        </div>

        {/* Bottom-right viewer/chatter pill */}
        {statLabel && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[10px] font-medium text-[#ece9e1]">
            {statLabel}
          </span>
        )}
      </div>

      {/* Host & Title Footer */}
      <div className="p-2 flex items-center gap-2 min-w-0">
        <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-[#f4f1ea] group-hover:text-[#ff922b] truncate leading-tight transition">
            {title}
          </div>
          <div className="text-[11px] text-[#8c8a82] truncate leading-tight mt-0.5">
            {hostName}
          </div>
        </div>
      </div>
    </Link>
  )
}

export function LiveNowRow() {
  const showLiveNowBar = useSettingsStore((s) => s.showLiveNowBar)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const liveStreams = useLiveStore((s) => s.liveStreams)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const activeStreams = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600
    return Object.values(liveStreams)
      .filter((s) => {
        if (s.activity.status !== 'live' || !s.activity.streamingUrl) return false
        const hostPk = (s.activity.streamerPubkey || s.activity.hostPubkey).toLowerCase()
        if (mutedPubkeys.includes(hostPk) || mutedPubkeys.includes(s.activity.hostPubkey)) {
          return false
        }
        // Match Wisp Android: surface streams with active chatters or freshly started within 6h
        return s.chatters.length > 0 || s.activity.createdAt >= cutoff
      })
      .sort((a, b) => {
        if (b.chatters.length !== a.chatters.length) return b.chatters.length - a.chatters.length
        return b.activity.createdAt - a.activity.createdAt
      })
      .slice(0, 15)
  }, [liveStreams, mutedPubkeys])

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
  }, [activeStreams.length])

  if (!showLiveNowBar || activeStreams.length === 0) return null

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  return (
    <div className="border-b border-[#20222c] bg-[#111218]/90 px-3 pt-2.5 pb-2 space-y-2">
      {/* Header Row: LIVE NOW count + scroll arrows */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE NOW
          </span>
          <span className="text-[11px] text-[#8c8a82]">
            {activeStreams.length} {activeStreams.length === 1 ? 'stream' : 'streams'}
          </span>
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
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && scrollRef.current) {
            const el = scrollRef.current
            if (el.scrollWidth > el.clientWidth) {
              e.preventDefault()
              el.scrollLeft += e.deltaY
            }
          }
        }}
        className="live-scroll flex items-stretch gap-2.5 overflow-x-auto pb-2"
      >
        {activeStreams.map((stream) => (
          <LiveStreamPreviewCard key={stream.aTagValue} stream={stream} />
        ))}
      </div>
    </div>
  )
}
