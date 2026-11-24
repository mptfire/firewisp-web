import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Flame,
  Heart,
  MessageCircle,
  Play,
  RefreshCw,
  Repeat2,
  Zap,
} from 'lucide-react'
import { parseNoteContent } from '../lib/nostr/content'
import { useNostrStore } from '../lib/store/useNostrStore'
import { Avatar } from './Avatar'

function formatShortAge(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function stripPreviewText(raw: string): string {
  return raw
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/nostr:[0-9a-z]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function TrendingPostCard({ eventId }: { eventId: string }) {
  const ev = useNostrStore((s) => s.events[eventId])
  const profile = useNostrStore((s) => (ev ? s.profiles[ev.pubkey] : undefined))
  const likes = useNostrStore((s) => s.reactionCounts[eventId] || 0)
  const reposts = useNostrStore((s) => s.repostCounts[eventId] || 0)
  const replies = useNostrStore((s) => s.replyCounts[eventId] || 0)
  const zapSats = useNostrStore((s) => s.zapTotalsSats[eventId] || 0)

  if (!ev) return null

  const authorName = profile?.display_name || profile?.name || `${ev.pubkey.slice(0, 10)}…`
  const handle = profile?.nip05 ? profile.nip05.replace(/^_@/, '') : null
  const parsed = parseNoteContent(ev)
  const firstImg = parsed.media.find((m) => m.kind === 'image')?.url
  const hasVideo = parsed.media.some((m) => m.kind === 'video')
  const snippet = stripPreviewText(ev.content)
  const hasStats = likes > 0 || reposts > 0 || replies > 0 || zapSats > 0

  return (
    <Link
      to={`/e/${ev.id}`}
      className="block p-3 rounded-xl bg-[#1a1c24]/75 hover:bg-[#202330] border border-[#252836] hover:border-[#e8590c]/40 transition group"
    >
      {/* Author header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar src={profile?.picture} pubkey={ev.pubkey} name={authorName} size="sm" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate group-hover:text-[#ff922b] transition leading-tight">
              {authorName}
            </div>
            {handle && (
              <div className="text-[10px] text-[#7c7a72] truncate leading-tight">{handle}</div>
            )}
          </div>
        </div>
        <span className="text-[10px] text-[#7c7a72] shrink-0 self-start pt-0.5">
          {formatShortAge(ev.created_at)}
        </span>
      </div>

      {/* Text snippet */}
      {snippet && (
        <p className="text-xs text-[#d6d3cb] line-clamp-3 leading-relaxed break-words">
          {snippet}
        </p>
      )}

      {/* Rich media preview */}
      {firstImg && (
        <div className="mt-2 rounded-lg overflow-hidden border border-[#2a2d3d] bg-[#111218]">
          <img
            src={firstImg}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full max-h-32 object-cover group-hover:scale-[1.02] transition duration-300"
          />
        </div>
      )}
      {!firstImg && hasVideo && (
        <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-[#13141b] border border-[#2a2d3d] text-[11px] text-[#c2bfb7] flex items-center gap-1.5">
          <Play className="w-3 h-3 text-[#f59f00] fill-[#f59f00]" />
          <span>Video attachment</span>
        </div>
      )}

      {/* Engagement footer */}
      {hasStats && (
        <div className="mt-2 pt-1.5 border-t border-[#242736]/80 flex items-center gap-3 text-[11px] text-[#8c8a82]">
          {replies > 0 && (
            <span className="flex items-center gap-1">
              <MessageCircle className="w-3 h-3" />
              {formatCompact(replies)}
            </span>
          )}
          {reposts > 0 && (
            <span className="flex items-center gap-1 text-emerald-400/90">
              <Repeat2 className="w-3 h-3" />
              {formatCompact(reposts)}
            </span>
          )}
          {likes > 0 && (
            <span className="flex items-center gap-1 text-rose-400/90">
              <Heart className="w-3 h-3" />
              {formatCompact(likes)}
            </span>
          )}
          {zapSats > 0 && (
            <span className="flex items-center gap-1 text-[#f59f00] ml-auto font-medium">
              <Zap className="w-3 h-3 fill-[#f59f00]/30" />
              {formatCompact(zapSats)}
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

export function TrendingSidebar() {
  const navigate = useNavigate()
  const trendingSidebarIds = useNostrStore((s) => s.trendingSidebarIds)
  const loadingTrends = useNostrStore((s) => s.loadingTrends)
  const loadTrendingSidebar = useNostrStore((s) => s.loadTrendingSidebar)
  const setActiveFeedTab = useNostrStore((s) => s.setActiveFeedTab)

  useEffect(() => {
    if (trendingSidebarIds.length === 0 && !loadingTrends) {
      void loadTrendingSidebar()
    }
  }, [trendingSidebarIds.length, loadingTrends, loadTrendingSidebar])

  return (
    <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#9a9890] flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-[#e8590c]" />
          Trending Posts
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadTrendingSidebar(true)}
            disabled={loadingTrends}
            title="Refresh trending posts"
            className="p-1 rounded-lg text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw
              className={`w-3 h-3 ${loadingTrends ? 'animate-spin text-[#e8590c]' : ''}`}
            />
          </button>
          <button
            onClick={() => {
              setActiveFeedTab('trending')
              navigate('/')
            }}
            className="text-[11px] text-[#ff8a3d] hover:underline cursor-pointer"
          >
            See all
          </button>
        </div>
      </div>

      {loadingTrends && trendingSidebarIds.length === 0 ? (
        <div className="space-y-2.5 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-xl bg-[#1a1c24]/70 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-[#252836]" />
                <div className="h-3 w-24 rounded bg-[#252836]" />
              </div>
              <div className="h-3 w-full rounded bg-[#222533]" />
              <div className="h-3 w-4/5 rounded bg-[#222533]" />
            </div>
          ))}
        </div>
      ) : trendingSidebarIds.length === 0 ? (
        <p className="text-xs text-[#6f6d66]">No trending posts loaded yet.</p>
      ) : (
        <div className="space-y-2.5">
          {trendingSidebarIds.map((id) => (
            <TrendingPostCard key={id} eventId={id} />
          ))}
        </div>
      )}
    </div>
  )
}
