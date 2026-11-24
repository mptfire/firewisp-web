import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Flame, Hash, RefreshCw, TrendingUp } from 'lucide-react'
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
      {/* Trending #Keywords (Ditto-style) */}
      <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
        <div className="flex items-center justify-between mb-2.5">
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
          <div className="flex flex-wrap gap-1.5 animate-pulse">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-6 w-16 rounded-full bg-[#1f212b]" />
            ))}
          </div>
        ) : trendingHashtags.length === 0 ? (
          <p className="text-xs text-[#6f6d66]">No trending tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {trendingHashtags.map(({ tag, count }) => (
              <Link
                key={tag}
                to={`/search?q=%23${encodeURIComponent(tag)}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1b1d26] hover:bg-[#e8590c]/20 border border-[#272a38] hover:border-[#e8590c]/40 text-xs text-[#e0ded7] hover:text-[#ff922b] transition"
              >
                <Hash className="w-3 h-3 text-[#f59f00]" />
                <span>{tag}</span>
                <span className="text-[10px] text-[#7c7a72] ml-0.5">{count}</span>
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
