import { useEffect, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Flame,
  Heart,
  MessageCircle,
  Play,
  RefreshCw,
  Repeat2,
  TrendingUp,
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

/** Smooth Ditto-style 24h activity sparkline SVG */
function TrendSparkline({ buckets }: { buckets: number[] }) {
  const gradId = useId()
  const w = 56
  const h = 24
  const pad = 2
  const maxVal = Math.max(...buckets, 1)
  const stepX = buckets.length > 1 ? (w - pad * 2) / (buckets.length - 1) : 0

  const coords = buckets.map((v, i) => ({
    x: pad + i * stepX,
    y: h - pad - (v / maxVal) * (h - pad * 2 - 2),
  }))

  let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]
    const curr = coords[i]
    const cx = ((prev.x + curr.x) / 2).toFixed(1)
    linePath += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)}, ${cx} ${((prev.y + curr.y) / 2).toFixed(1)}`
    if (i === coords.length - 1) {
      linePath += ` T ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
    }
  }
  const areaPath = `${linePath} L ${(w - pad).toFixed(1)} ${h} L ${pad} ${h} Z`

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8590c" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#e8590c" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke="#ff8a3d"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HotPostCard({ eventId }: { eventId: string }) {
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

      {/* Rich Ditto-style media preview */}
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
  const trendingHashtags = useNostrStore((s) => s.trendingHashtags)
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
    <>
      {/* Trending #Keywords with sparklines (Ditto-style) */}
      <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9a9890] flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-[#f59f00]" />
            Trending
          </span>
          <button
            onClick={() => void loadTrendingSidebar(true)}
            disabled={loadingTrends}
            title="Refresh trends"
            className="p-1 rounded-lg text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${loadingTrends ? 'animate-spin text-[#e8590c]' : ''}`} />
          </button>
        </div>

        {loadingTrends && trendingHashtags.length === 0 ? (
          <div className="space-y-2.5 animate-pulse pt-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="h-3.5 w-24 rounded bg-[#1f212b]" />
                  <div className="h-2.5 w-20 rounded bg-[#1b1d26]" />
                </div>
                <div className="h-5 w-14 rounded bg-[#1b1d26]" />
              </div>
            ))}
          </div>
        ) : trendingHashtags.length === 0 ? (
          <p className="text-xs text-[#6f6d66]">No trending tags yet.</p>
        ) : (
          <div className="divide-y divide-[#1f212b] -mx-1">
            {trendingHashtags.map(({ tag, accounts, uses, buckets }) => (
              <Link
                key={tag}
                to={`/search?q=%23${encodeURIComponent(tag)}`}
                className="flex items-center justify-between gap-2 px-2 py-2 rounded-xl hover:bg-white/[0.04] transition group"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white group-hover:text-[#ff922b] truncate transition">
                    #{tag}
                  </div>
                  <div className="text-[11px] text-[#8c8a82] truncate">
                    {accounts} {accounts === 1 ? 'person' : 'people'} · {uses}{' '}
                    {uses === 1 ? 'post' : 'posts'}
                  </div>
                </div>
                <TrendSparkline buckets={buckets} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Hot Posts (Ditto-style rich cards) */}
      <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#9a9890] flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-[#e8590c]" />
            Hot Posts
          </span>
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

        {loadingTrends && trendingSidebarIds.length === 0 ? (
          <div className="space-y-2.5 animate-pulse">
            {[0, 1, 2].map((i) => (
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
          <p className="text-xs text-[#6f6d66]">No hot posts loaded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {trendingSidebarIds.map((id) => (
              <HotPostCard key={id} eventId={id} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
