import { useEffect, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Flame, RefreshCw, TrendingUp } from 'lucide-react'
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

function HotPostRow({ eventId }: { eventId: string }) {
  const ev = useNostrStore((s) => s.events[eventId])
  const profile = useNostrStore((s) => (ev ? s.profiles[ev.pubkey] : undefined))
  if (!ev) return null

  const authorName = profile?.display_name || profile?.name || `${ev.pubkey.slice(0, 10)}…`
  const parsed = parseNoteContent(ev)
  const firstImg = parsed.media.find((m) => m.kind === 'image')?.url
  const snippet = stripPreviewText(ev.content)

  return (
    <Link
      to={`/e/${ev.id}`}
      className="block p-2.5 rounded-xl hover:bg-white/[0.04] transition group"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar src={profile?.picture} pubkey={ev.pubkey} name={authorName} size="sm" />
          <span className="text-xs font-semibold text-white truncate group-hover:text-[#ff922b] transition">
            {authorName}
          </span>
        </div>
        <span className="text-[10px] text-[#6f6d66] shrink-0">
          {formatShortAge(ev.created_at)}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <p className="text-xs text-[#c2bfb7] line-clamp-2 leading-snug flex-1 min-w-0">
          {snippet || (firstImg ? 'Shared a photo' : 'View post')}
        </p>
        {firstImg && (
          <img
            src={firstImg}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-11 h-11 rounded-lg object-cover border border-[#252734] shrink-0"
          />
        )}
      </div>
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

      {/* Hot Posts (Ditto-style) */}
      <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
        <div className="flex items-center justify-between mb-2">
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
          <div className="space-y-3 animate-pulse pt-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-24 rounded bg-[#1f212b]" />
                <div className="h-3 w-full rounded bg-[#1b1d26]" />
                <div className="h-3 w-3/4 rounded bg-[#1b1d26]" />
              </div>
            ))}
          </div>
        ) : trendingSidebarIds.length === 0 ? (
          <p className="text-xs text-[#6f6d66]">No hot posts loaded yet.</p>
        ) : (
          <div className="divide-y divide-[#1f212b] -mx-1">
            {trendingSidebarIds.map((id) => (
              <HotPostRow key={id} eventId={id} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
