import { memo, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Flame,
  Globe,
  Hash,
  Heart,
  List,
  MessageCircle,
  Network,
  Play,
  Radio,
  RefreshCw,
  Repeat2,
  Server,
  Zap,
} from 'lucide-react'
import { parseNoteContent } from '../lib/nostr/content'
import { getListFeedDTag, makeListFeedKey } from '../lib/nostr/followSets'
import {
  getInterestFeedDTag,
  getRelaySetFeedDTag,
  makeInterestFeedKey,
  makeRelaySetFeedKey,
} from '../lib/nostr/nip51Sets'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import {
  useSettingsStore,
  type BuiltinSidebarFeedMode,
  type SidebarFeedMode,
} from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

const SIDEBAR_FEED_OPTIONS: Array<{ value: BuiltinSidebarFeedMode; label: string }> = [
  { value: 'trending', label: 'Trending Posts' },
  { value: 'extended', label: 'Extended' },
  { value: 'global', label: 'Explore' },
  { value: 'firewisp', label: 'Wisp Relay' },
]

const EMPTY_IDS: string[] = []

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

const TrendingPostCard = memo(function TrendingPostCard({ eventId }: { eventId: string }) {
  const ev = useNostrStore((s) => s.events[eventId])
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const profile = useNostrStore((s) => (ev ? s.profiles[ev.pubkey] : undefined))
  const likes = useNostrStore((s) => s.reactionCounts[eventId] || 0)
  const reposts = useNostrStore((s) => s.repostCounts[eventId] || 0)
  const replies = useNostrStore((s) => s.replyCounts[eventId] || 0)
  const zapSats = useNostrStore((s) => s.zapTotalsSats[eventId] || 0)

  const parsed = useMemo(() => (ev ? parseNoteContent(ev) : null), [ev])
  const hidden = useMemo(() => {
    if (!ev) return true
    return isEventDeleted(ev) || isEventMuted(ev)
  }, [
    ev,
    isEventDeleted,
    isEventMuted,
    deletedByAuthor,
    mutedPubkeys,
    privateMutedPubkeys,
    mutedHashtags,
    privateMutedHashtags,
    mutedWords,
    privateMutedWords,
  ])

  if (!ev || !parsed || hidden) return null

  const authorName = profile?.display_name || profile?.name || `${ev.pubkey.slice(0, 10)}…`
  const handle = profile?.nip05 ? profile.nip05.replace(/^_@/, '') : null
  const firstImg = parsed.media.find((m) => m.kind === 'image')?.url
  const firstVideo = parsed.media.find((m) => m.kind === 'video')
  const firstYoutube = parsed.youtube[0]
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
            className="w-full max-h-40 object-cover group-hover:scale-[1.02] transition duration-300"
          />
        </div>
      )}
      {!firstImg && firstVideo && (
        <div className="mt-2 relative rounded-lg overflow-hidden border border-[#2a2d3d] bg-black aspect-video max-h-40">
          {firstVideo.poster ? (
            <img
              src={firstVideo.poster}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300"
            />
          ) : (
            <video
              src={`${firstVideo.url}#t=0.001`}
              preload="metadata"
              muted
              playsInline
              className="w-full h-full object-cover pointer-events-none"
            />
          )}
          <div className="absolute inset-0 bg-black/25 flex items-center justify-center pointer-events-none">
            <span className="w-9 h-9 rounded-full bg-black/75 border border-white/20 text-white flex items-center justify-center shadow-lg">
              <Play className="w-4 h-4 fill-white ml-0.5" />
            </span>
          </div>
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-bold tracking-wider uppercase text-[#f59f00]">
            Video
          </span>
        </div>
      )}
      {!firstImg && !firstVideo && firstYoutube && (
        <div className="mt-2 relative rounded-lg overflow-hidden border border-[#2a2d3d] bg-black aspect-video max-h-40">
          <img
            src={firstYoutube.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300"
          />
          <div className="absolute inset-0 bg-black/25 flex items-center justify-center pointer-events-none">
            <span className="w-9 h-9 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg">
              <Play className="w-4 h-4 fill-white ml-0.5" />
            </span>
          </div>
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-bold tracking-wider uppercase text-red-400">
            YouTube
          </span>
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
})

export function TrendingSidebar() {
  const navigate = useNavigate()
  const pubkey = useAuthStore((s) => s.pubkey)
  const sidebarFeedMode = useSettingsStore((s) => s.sidebarFeedMode)
  const setSidebarFeedMode = useSettingsStore((s) => s.setSidebarFeedMode)

  const postIds = useNostrStore((s) => s.sidebarFeedIds[sidebarFeedMode] ?? EMPTY_IDS)
  const loading = useNostrStore((s) => Boolean(s.sidebarFeedLoading[sidebarFeedMode]))
  const loadingExtendedGraph = useNostrStore((s) => s.loadingExtendedGraph)
  const follows = useNostrStore((s) => s.follows)
  const followsLoaded = useNostrStore((s) => s.followsLoaded)
  const loadSidebarFeed = useNostrStore((s) => s.loadSidebarFeed)
  const setActiveFeedTab = useNostrStore((s) => s.setActiveFeedTab)
  const listsMap = useListsStore((s) => s.lists)
  const interestSets = useListsStore((s) => s.interestSets)
  const relaySets = useListsStore((s) => s.relaySets)
  const listsLoading = useListsStore((s) => s.loading)
  const sortedLists = useMemo(
    () => Object.values(listsMap).sort((a, b) => a.name.localeCompare(b.name)),
    [listsMap],
  )
  const sortedInterestSets = useMemo(
    () => Object.values(interestSets).sort((a, b) => a.name.localeCompare(b.name)),
    [interestSets],
  )
  const sortedRelaySets = useMemo(
    () => Object.values(relaySets).sort((a, b) => a.name.localeCompare(b.name)),
    [relaySets],
  )
  const selectedListDTag = getListFeedDTag(sidebarFeedMode)
  const selectedInterestDTag = getInterestFeedDTag(sidebarFeedMode)
  const selectedRelaySetDTag = getRelaySetFeedDTag(sidebarFeedMode)
  const selectedList = selectedListDTag ? listsMap[selectedListDTag] : undefined
  const selectedInterest = selectedInterestDTag ? interestSets[selectedInterestDTag] : undefined
  const selectedRelaySet = selectedRelaySetDTag ? relaySets[selectedRelaySetDTag] : undefined
  const selectedSetObj = selectedInterest || selectedRelaySet
  const isCustomSetMode = Boolean(selectedListDTag || selectedInterestDTag || selectedRelaySetDTag)
  const selectedCustomObj = selectedList || selectedSetObj
  const selectedCustomCount = selectedList
    ? selectedList.members.length
    : selectedSetObj
      ? selectedSetObj.items.length
      : 0
  const selectedCustomItemsKey = selectedList
    ? selectedList.members.join(',')
    : selectedSetObj
      ? selectedSetObj.items.join(',')
      : ''
  const attemptedKeyRef = useRef<string>('')
  const attemptedModeRef = useRef<string>('')

  const isBusy =
    loading ||
    (sidebarFeedMode === 'extended' && loadingExtendedGraph) ||
    (isCustomSetMode && listsLoading && !selectedCustomObj)

  // Initial load whenever the user switches mode (and once follows / lists finish loading)
  useEffect(() => {
    if (isCustomSetMode) {
      if (!pubkey || (listsLoading && !selectedCustomObj) || !selectedCustomObj) return
      const attemptKey = `${sidebarFeedMode}\0${selectedCustomItemsKey}`
      if (attemptedKeyRef.current === attemptKey) return
      const prevMode = attemptedModeRef.current
      attemptedKeyRef.current = attemptKey
      attemptedModeRef.current = sidebarFeedMode
      const hasCached = (useNostrStore.getState().sidebarFeedIds[sidebarFeedMode]?.length ?? 0) > 0
      const itemsChanged = prevMode === sidebarFeedMode
      if (itemsChanged || !hasCached) {
        void loadSidebarFeed(sidebarFeedMode, itemsChanged)
      }
      return
    }
    if (sidebarFeedMode === 'extended' && pubkey && !followsLoaded) return
    const attemptKey =
      sidebarFeedMode === 'extended'
        ? `${sidebarFeedMode}:${pubkey || 'anon'}:${follows.length}`
        : sidebarFeedMode
    if (attemptedKeyRef.current === attemptKey) return
    attemptedKeyRef.current = attemptKey
    attemptedModeRef.current = sidebarFeedMode
    if ((useNostrStore.getState().sidebarFeedIds[sidebarFeedMode]?.length ?? 0) === 0) {
      void loadSidebarFeed(sidebarFeedMode)
    }
  }, [
    sidebarFeedMode,
    isCustomSetMode,
    selectedCustomObj,
    selectedCustomItemsKey,
    listsLoading,
    pubkey,
    followsLoaded,
    follows.length,
    loadSidebarFeed,
  ])

  // Auto-refresh active sidebar feed every 5 minutes while the tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void loadSidebarFeed(sidebarFeedMode, true)
    }, 5 * 60_000)
    return () => clearInterval(id)
  }, [sidebarFeedMode, loadSidebarFeed])

  const ModeIcon = selectedListDTag
    ? List
    : selectedInterestDTag
      ? Hash
      : selectedRelaySetDTag
        ? Server
        : sidebarFeedMode === 'extended'
          ? Network
          : sidebarFeedMode === 'global'
            ? Globe
            : sidebarFeedMode === 'firewisp'
              ? Radio
              : Flame

  const handleSeeAll = () => {
    setActiveFeedTab(sidebarFeedMode)
    navigate('/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const emptyMessage = isCustomSetMode
    ? !pubkey
      ? 'Sign in to view posts from this set.'
      : listsLoading && !selectedCustomObj
        ? 'Syncing your sets from relays…'
        : !selectedCustomObj
          ? 'This set was not found on your relays.'
          : selectedCustomCount === 0
            ? selectedInterestDTag
              ? 'No hashtags in this set yet.'
              : selectedRelaySetDTag
                ? 'No relays in this set yet.'
                : 'No people in this list yet.'
            : selectedRelaySetDTag
              ? 'No recent posts loaded from these relays yet.'
              : 'No recent posts in the last 7 days.'
    : sidebarFeedMode === 'extended'
      ? !pubkey
        ? 'Sign in to see posts from your Extended Web of Trust.'
        : follows.length === 0
          ? 'Follow a few accounts to populate your Extended network.'
          : 'No Extended network posts loaded yet.'
      : sidebarFeedMode === 'global'
        ? 'No Explore posts loaded yet.'
        : sidebarFeedMode === 'firewisp'
          ? 'No recent posts on Wisp Relay yet.'
          : 'No trending posts loaded yet.'

  const emptyManageLink = selectedListDTag
    ? `/lists/${encodeURIComponent(selectedListDTag)}`
    : selectedInterestDTag
      ? `/lists/interests/${encodeURIComponent(selectedInterestDTag)}`
      : selectedRelaySetDTag
        ? `/lists/relays/${encodeURIComponent(selectedRelaySetDTag)}`
        : '/lists'

  return (
    <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <ModeIcon
            className={`w-3.5 h-3.5 shrink-0 ${
              selectedInterestDTag
                ? 'text-amber-400'
                : selectedRelaySetDTag
                  ? 'text-cyan-400'
                  : selectedListDTag
                    ? 'text-purple-400'
                    : 'text-[#e8590c]'
            }`}
          />
          <select
            aria-label="Sidebar feed source"
            value={sidebarFeedMode}
            onChange={(e) => setSidebarFeedMode(e.target.value as SidebarFeedMode)}
            title="Switch right sidebar feed"
            className="w-full min-w-0 px-2 py-1 rounded-lg bg-[#0e0e11] border border-[#262938] hover:border-[#3b4057] text-xs font-semibold text-[#e4e1d8] focus:outline-none focus:border-[#e8590c] truncate cursor-pointer"
          >
            <optgroup label="Built-in" className="bg-[#14151e] text-[#9a9890]">
              {SIDEBAR_FEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#14151e] text-white">
                  {opt.label}
                </option>
              ))}
            </optgroup>
            {((pubkey && sortedLists.length > 0) || Boolean(selectedListDTag)) && (
              <optgroup label="Your Lists" className="bg-[#14151e] text-[#9a9890]">
                {sortedLists.map((l) => (
                  <option
                    key={l.dTag}
                    value={makeListFeedKey(l.dTag)}
                    className="bg-[#14151e] text-white"
                  >
                    {l.name} ({l.members.length})
                  </option>
                ))}
                {selectedListDTag && !selectedList && (
                  <option value={sidebarFeedMode} className="bg-[#14151e] text-white">
                    {listsLoading ? 'Loading list…' : 'Saved list'}
                  </option>
                )}
              </optgroup>
            )}
            {((pubkey && sortedInterestSets.length > 0) || Boolean(selectedInterestDTag)) && (
              <optgroup label="Interest Sets" className="bg-[#14151e] text-[#9a9890]">
                {sortedInterestSets.map((s) => (
                  <option
                    key={s.dTag}
                    value={makeInterestFeedKey(s.dTag)}
                    className="bg-[#14151e] text-white"
                  >
                    {s.name} (#{s.items.length})
                  </option>
                ))}
                {selectedInterestDTag && !selectedInterest && (
                  <option value={sidebarFeedMode} className="bg-[#14151e] text-white">
                    {listsLoading ? 'Loading interests…' : 'Saved interest set'}
                  </option>
                )}
              </optgroup>
            )}
            {((pubkey && sortedRelaySets.length > 0) || Boolean(selectedRelaySetDTag)) && (
              <optgroup label="Relay Sets" className="bg-[#14151e] text-[#9a9890]">
                {sortedRelaySets.map((s) => (
                  <option
                    key={s.dTag}
                    value={makeRelaySetFeedKey(s.dTag)}
                    className="bg-[#14151e] text-white"
                  >
                    {s.name} ({s.items.length})
                  </option>
                ))}
                {selectedRelaySetDTag && !selectedRelaySet && (
                  <option value={sidebarFeedMode} className="bg-[#14151e] text-white">
                    {listsLoading ? 'Loading relays…' : 'Saved relay set'}
                  </option>
                )}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadSidebarFeed(sidebarFeedMode, true)}
            disabled={isBusy}
            title="Refresh posts"
            className="p-1 rounded-lg text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer disabled:opacity-40"
          >
            <RefreshCw
              className={`w-3 h-3 ${isBusy ? 'animate-spin text-[#e8590c]' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={handleSeeAll}
            className="text-[11px] text-[#ff8a3d] hover:underline cursor-pointer whitespace-nowrap"
          >
            See all
          </button>
        </div>
      </div>

      {isBusy && postIds.length === 0 ? (
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
      ) : postIds.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-[#6f6d66]">{emptyMessage}</p>
          {isCustomSetMode && selectedCustomObj && selectedCustomCount === 0 && (
            <Link
              to={emptyManageLink}
              className="inline-block text-[11px] text-purple-300 hover:underline font-medium"
            >
              {selectedInterestDTag ? 'Add hashtags →' : selectedRelaySetDTag ? 'Add relays →' : 'Add people →'}
            </Link>
          )}
          {isCustomSetMode && !listsLoading && !selectedCustomObj && (
            <button
              type="button"
              onClick={() => setSidebarFeedMode('trending')}
              className="text-[11px] text-[#ff8a3d] hover:underline cursor-pointer"
            >
              Switch back to Trending
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {postIds.map((id) => (
            <TrendingPostCard key={id} eventId={id} />
          ))}
        </div>
      )}
    </div>
  )
}
