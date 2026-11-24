import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles,
  Flame,
  Users,
  Globe,
  TrendingUp,
  Network,
  Loader2,
  ShieldCheck,
  RefreshCw,
  ArrowUp,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { Event } from 'nostr-tools/pure'
import { evaluateNoteSpam, isTopLevelNote } from '../lib/nostr/spamFilter'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore, type FeedTab } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Composer } from '../components/Composer'
import { LiveNowRow } from '../components/LiveNowRow'
import { LiveZapsCard } from '../components/LiveZapsCard'
import { NoteCard } from '../components/NoteCard'

function FeedSkeleton() {
  return (
    <div className="divide-y divide-[#20222c]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="px-4 py-4 flex gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-[#1c1e26] shrink-0" />
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="flex gap-2">
              <div className="h-3.5 w-28 rounded bg-[#1c1e26]" />
              <div className="h-3.5 w-12 rounded bg-[#181920]" />
            </div>
            <div className="h-3.5 w-full rounded bg-[#181920]" />
            <div className="h-3.5 w-4/5 rounded bg-[#181920]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function FeedPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const sessionRestored = useAuthStore((s) => s.sessionRestored)
  const tab = useNostrStore((s) => s.activeFeedTab)
  const setTab = useNostrStore((s) => s.setActiveFeedTab)
  const showRepliesInFollows = useNostrStore((s) => s.showRepliesInFollows)
  const setShowRepliesInFollows = useNostrStore((s) => s.setShowRepliesInFollows)
  const follows = useNostrStore((s) => s.follows)
  const followedHashtags = useNostrStore((s) => s.followedHashtags)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const extendedAuthors = useNostrStore((s) => s.extendedAuthors)
  const loadingExtendedGraph = useNostrStore((s) => s.loadingExtendedGraph)
  const loadingMore = useNostrStore((s) => s.loadingMore)
  const events = useNostrStore((s) => s.events)
  const deletedEventIds = useNostrStore((s) => s.deletedEventIds)
  const forYouFeedIds = useNostrStore((s) => s.forYouFeedIds)
  const forYouSuppIds = useNostrStore((s) => s.forYouSuppIds)
  const firewispFeedIds = useNostrStore((s) => s.firewispFeedIds)
  const followingFeedIds = useNostrStore((s) => s.followingFeedIds)
  const extendedFeedIds = useNostrStore((s) => s.extendedFeedIds)
  const trendingFeedIds = useNostrStore((s) => s.trendingFeedIds)
  const globalFeedIds = useNostrStore((s) => s.globalFeedIds)
  const pendingIds = useNostrStore((s) => s.pendingFeedIds[s.activeFeedTab])
  const loadingFeed = useNostrStore((s) => s.loadingFeed)
  const subscribeFeed = useNostrStore((s) => s.subscribeFeed)
  const flushPendingFeed = useNostrStore((s) => s.flushPendingFeed)
  const loadOlderFeed = useNostrStore((s) => s.loadOlderFeed)
  const clearFeedTab = useNostrStore((s) => s.clearFeedTab)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const followsLoaded = useNostrStore((s) => s.followsLoaded)
  const spamFilterEnabled = useSettingsStore((s) => s.spamFilterEnabled)
  const hideRepliesInExplore = useSettingsStore((s) => s.hideRepliesInExplore)
  const requirePowInExplore = useSettingsStore((s) => s.requirePowInExplore)
  const showFireWispTab = useSettingsStore((s) => s.showFireWispTab)
  const showExtendedTab = useSettingsStore((s) => s.showExtendedTab)
  const showExploreTab = useSettingsStore((s) => s.showExploreTab)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const setSpamFilterEnabled = useSettingsStore((s) => s.setSpamFilterEnabled)

  const visibleTabs = useMemo(() => {
    const list: [FeedTab, string, typeof Flame][] = [
      ['foryou', 'For You', Sparkles],
      ['following', 'Follows', Users],
      ['trending', 'Trending', TrendingUp],
    ]
    if (showFireWispTab) list.push(['firewisp', 'Fire Wisp', Flame])
    if (showExtendedTab) list.push(['extended', 'Extended', Network])
    if (showExploreTab) list.push(['global', 'Explore', Globe])
    return list
  }, [showFireWispTab, showExtendedTab, showExploreTab])

  // If the active tab gets hidden in Settings, fall back cleanly to For You
  useEffect(() => {
    if (!visibleTabs.some(([id]) => id === tab)) {
      setTab('foryou')
    }
  }, [visibleTabs, tab, setTab])

  const PAGE_SIZE = 40
  const [refreshTick, setRefreshTick] = useState(0)
  const [noMoreOlder, setNoMoreOlder] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [mobileLiveZapsOpen, setMobileLiveZapsOpen] = useState(false)

  useEffect(() => {
    if (!sessionRestored) return
    setNoMoreOlder(false)
    setVisibleCount(PAGE_SIZE)
    return subscribeFeed(tab)
  }, [
    sessionRestored,
    tab,
    pubkey,
    followsLoaded,
    follows,
    followedHashtags,
    userReadRelays,
    extendedAuthors,
    refreshTick,
    subscribeFeed,
  ])

  const handleRefresh = () => {
    setNoMoreOlder(false)
    setVisibleCount(PAGE_SIZE)
    clearFeedTab(tab)
    setRefreshTick((n) => n + 1)
  }

  const handleShowNew = () => {
    flushPendingFeed(tab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleLoadOlder = async (loadedCount: number) => {
    if (visibleCount < loadedCount) {
      setVisibleCount((n) => n + PAGE_SIZE)
      return
    }
    const added = await loadOlderFeed(tab)
    if (added === 0) setNoMoreOlder(true)
    else setVisibleCount((n) => n + PAGE_SIZE)
  }

  const ids =
    tab === 'foryou'
      ? forYouFeedIds
      : tab === 'firewisp'
        ? firewispFeedIds
        : tab === 'following'
          ? followingFeedIds
          : tab === 'extended'
            ? extendedFeedIds
            : tab === 'trending'
              ? trendingFeedIds
              : globalFeedIds

  const { items, spamBlockedCount, pendingCount } = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()
    const seenContentAuthors = new Map<string, Set<string>>()
    const authorCounts = new Map<string, number>()
    const followSet = new Set(follows.map((p) => p.toLowerCase()))
    const extendedSet = new Set(extendedAuthors.map((p) => p.toLowerCase()))
    const myPk = pubkey?.toLowerCase()
    let blocked = 0

    const shouldSpamFilter = (tab === 'foryou' || tab === 'global' || tab === 'trending') && spamFilterEnabled

    const resolveVisibleItem = (
      id: string,
      trackSpamBlock: boolean,
      spamSeenContent: Map<string, Set<string>>,
      spamAuthorCounts: Map<string, number>,
    ): { event: Event; repostedBy?: string } | null => {
      const ev = events[id]
      if (!ev || isEventDeleted(ev) || isEventMuted(ev)) return null

      // STRICT FOLLOWS GATE: never render unfollowed accounts inside Follows
      if (tab === 'following') {
        const evAuthor = ev.pubkey.toLowerCase()
        if (evAuthor !== myPk && !followSet.has(evAuthor)) return null
      }

      // STRICT FOR YOU GATE (when signed in): only Follows, loaded Extended WoT, or vetted Trending/Topic picks
      if (tab === 'foryou' && myPk) {
        const evAuthor = ev.pubkey.toLowerCase()
        if (
          evAuthor !== myPk &&
          !followSet.has(evAuthor) &&
          !extendedSet.has(evAuthor) &&
          !forYouSuppIds[ev.id]
        ) {
          return null
        }
      }

      let targetEv: Event = ev
      let repostedBy: string | undefined
      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? events[targetId] : undefined
        if (!inner || isEventDeleted(inner) || isEventMuted(inner)) return null
        targetEv = inner
        repostedBy = ev.pubkey
      }

      if (seen.has(targetEv.id)) return null

      // Hide replies (including reposted replies) in Follows, For You, Extended & Fire Wisp when replies are hidden
      if (
        (tab === 'following' || tab === 'foryou' || tab === 'extended' || tab === 'firewisp') &&
        !showRepliesInFollows &&
        targetEv.kind === 1 &&
        !isTopLevelNote(targetEv)
      ) {
        return null
      }

      if (
        (tab === 'global' || tab === 'trending') &&
        hideRepliesInExplore &&
        targetEv.kind === 1 &&
        !isTopLevelNote(targetEv)
      ) {
        return null
      }

      if (shouldSpamFilter) {
        const verdict = evaluateNoteSpam(targetEv, {
          myPubkey: pubkey,
          follows: followSet,
          seenContentAuthors: spamSeenContent,
          authorCounts: spamAuthorCounts,
          maxPerAuthor: tab === 'foryou' ? 3 : 2,
          requirePowBits: tab === 'global' && requirePowInExplore ? 12 : 0,
        })
        if (verdict.isSpam) {
          if (trackSpamBlock) blocked++
          return null
        }
      }

      return { event: targetEv, repostedBy }
    }

    for (const id of ids) {
      const resolved = resolveVisibleItem(id, true, seenContentAuthors, authorCounts)
      if (!resolved) continue
      seen.add(resolved.event.id)
      out.push(resolved)
    }

    // Count pending notes with fresh spam maps so authors already in `ids` don't hide the "Show new notes" pill
    let visiblePending = 0
    if (pendingIds && pendingIds.length > 0) {
      const pendingSeen = new Set<string>()
      const pendingContentAuthors = new Map<string, Set<string>>()
      const pendingAuthorCounts = new Map<string, number>()
      for (const pid of pendingIds) {
        const resolved = resolveVisibleItem(pid, false, pendingContentAuthors, pendingAuthorCounts)
        if (!resolved || pendingSeen.has(resolved.event.id)) continue
        pendingSeen.add(resolved.event.id)
        visiblePending++
      }
    }

    return { items: out, spamBlockedCount: blocked, pendingCount: visiblePending }
  }, [
    ids,
    pendingIds,
    events,
    deletedEventIds,
    deletedByAuthor,
    isEventDeleted,
    isEventMuted,
    tab,
    showRepliesInFollows,
    spamFilterEnabled,
    hideRepliesInExplore,
    requirePowInExplore,
    mutedPubkeys,
    mutedHashtags,
    mutedWords,
    privateMutedPubkeys,
    privateMutedHashtags,
    privateMutedWords,
    pubkey,
    follows,
    extendedAuthors,
    forYouSuppIds,
  ])

  return (
    <div>
      {/* Sticky Feed Tabs */}
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] flex overflow-x-auto text-xs sm:text-sm font-medium">
        {visibleTabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => {
              if (tab === id) {
                window.scrollTo({ top: 0, behavior: 'smooth' })
              } else {
                setTab(id)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }
            }}
            className={`flex-1 min-w-[74px] py-3.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
              tab === id
                ? 'border-[#e8590c] text-white'
                : 'border-transparent text-[#8c8a82] hover:text-white'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${tab === id ? 'text-[#f59f00]' : ''}`} />
            {label}
          </button>
        ))}
      </div>

      {/* Status + Controls Strip */}
      <div className="px-4 py-2 border-b border-[#20222c] bg-[#121319]/80 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-[#9a9890] min-w-0 truncate">
          {tab === 'foryou' ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">
                {pubkey
                  ? [
                      `For You · ${follows.length.toLocaleString()} follows`,
                      extendedAuthors.length > 0 ? `+ ${extendedAuthors.length} 2-hop` : null,
                      followedHashtags.length > 0 ? `+ ${followedHashtags.length} topics` : null,
                      '+ Trending',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  : 'For You · Curated Trending & Fire Wisp highlights (sign in to personalize)'}
              </span>
            </>
          ) : tab === 'extended' ? (
            <>
              <Network className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">
                {loadingExtendedGraph
                  ? 'Building your 2-hop Web of Trust graph…'
                  : extendedAuthors.length > 0
                    ? `2-hop Web of Trust · ${extendedAuthors.length} accounts endorsed by your follows`
                    : 'Sign in and follow accounts to build your spam-free 2-hop Extended feed.'}
              </span>
            </>
          ) : tab === 'following' ? (
            <>
              <Users className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">
                {pubkey
                  ? `Following ${follows.length.toLocaleString()} accounts`
                  : 'Sign in to view posts from accounts you follow.'}
              </span>
            </>
          ) : tab === 'firewisp' ? (
            <>
              <Flame className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">Fire Wisp anti-spam relay (wss://firewisp.relay.rtard.de)</span>
            </>
          ) : (
            <>
              <ShieldCheck
                className={`w-3.5 h-3.5 shrink-0 ${spamFilterEnabled ? 'text-emerald-400' : 'text-[#6f6d66]'}`}
              />
              <span className="truncate">
                {tab === 'trending'
                  ? 'Curated trending notes (trending.relays.land)'
                  : spamFilterEnabled
                    ? spamBlockedCount > 0
                      ? `Curated Explore · ${spamBlockedCount} filtered`
                      : 'Curated Explore (anti-spam ON)'
                    : 'Anti-spam filter paused'}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {(tab === 'following' || tab === 'foryou' || tab === 'extended' || tab === 'firewisp') && (
            <button
              type="button"
              onClick={() => setShowRepliesInFollows(!showRepliesInFollows)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition cursor-pointer ${
                showRepliesInFollows
                  ? 'bg-[#e8590c]/15 border-[#e8590c]/40 text-[#ff922b]'
                  : 'bg-[#181a24] border-[#282b3a] text-[#9a9890] hover:text-white'
              }`}
              title={showRepliesInFollows ? 'Click to hide replies in this feed' : 'Click to show replies in this feed'}
            >
              {showRepliesInFollows ? 'Replies: On' : 'Replies: Off'}
            </button>
          )}
          {tab === 'global' && (
            <button
              onClick={() => setSpamFilterEnabled(!spamFilterEnabled)}
              className="text-[11px] text-[#ff8a3d] hover:underline cursor-pointer"
            >
              {spamFilterEnabled ? 'Pause' : 'Enable'}
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="text-[11px] text-[#c2bfb7] hover:text-white flex items-center gap-1 cursor-pointer"
            title="Refresh feed from relays"
          >
            <RefreshCw className={`w-3 h-3 ${loadingFeed ? 'animate-spin text-[#e8590c]' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <LiveNowRow />

      {/* Mobile collapsible Live Zaps feed (desktop shows Live Zaps in the left sidebar column) */}
      <div className="md:hidden border-b border-[#20222c] bg-[#111218]/90 px-3 py-2 space-y-2">
        <button
          type="button"
          onClick={() => setMobileLiveZapsOpen((v) => !v)}
          aria-expanded={mobileLiveZapsOpen}
          className="w-full flex items-center justify-between gap-2 text-xs font-semibold text-[#ece9e1] cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#f59f00] fill-[#f59f00]/40" />
            <span>Live Zaps</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold uppercase">
              LIVE
            </span>
          </span>
          {mobileLiveZapsOpen ? (
            <ChevronUp className="w-4 h-4 text-[#8c8a82]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#8c8a82]" />
          )}
        </button>
        {mobileLiveZapsOpen && <LiveZapsCard compact />}
      </div>

      <Composer />

      {/* Jumble-style buffered new-notes pill (zero scroll jumping while reading!) */}
      {pendingCount > 0 && (
        <div className="sticky top-[102px] md:top-[52px] z-20 flex justify-center py-2 pointer-events-none">
          <button
            onClick={handleShowNew}
            className="pointer-events-auto px-4 py-1.5 rounded-full bg-[#e8590c] hover:bg-[#d9480f] text-white text-xs font-semibold shadow-lg shadow-black/40 flex items-center gap-1.5 transition cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" />
            Show {pendingCount} new {pendingCount === 1 ? 'note' : 'notes'}
          </button>
        </div>
      )}

      {loadingFeed && items.length === 0 && <FeedSkeleton />}

      {!loadingFeed && items.length === 0 && (
        <div className="py-16 px-6 text-center space-y-2">
          <p className="text-sm text-[#c2bfb7] font-medium">
            {tab === 'firewisp'
              ? 'No posts on firewisp.relay.rtard.de yet — be the first to ignite it!'
              : tab === 'following'
                ? pubkey
                  ? 'No recent notes from your follows loaded yet.'
                  : 'Sign in and follow people on Nostr to fill your Follows feed.'
                : 'No notes received from your configured relays yet.'}
          </p>
          <p className="text-xs text-[#8c8a82]">
            {tab === 'firewisp' &&
              'Fire Wisp Relay requires 12-bit NIP-13 PoW on public posts (mined automatically by Fire Wisp).'}
          </p>
        </div>
      )}

      <div>
        {items.slice(0, visibleCount).map(({ event, repostedBy }) => (
          <NoteCard
            key={`${event.id}-${repostedBy || 'orig'}`}
            event={event}
            repostedByPubkey={repostedBy}
          />
        ))}
      </div>

      {/* Pagination: reveal buffered notes first, then fetch older from relays (even when Replies: Off hid current batch) */}
      {(items.length > 0 || ids.length > 0) && (visibleCount < items.length || tab !== 'trending') && (
        <div className="py-6 flex justify-center">
          {noMoreOlder && visibleCount >= items.length ? (
            <span className="text-xs text-[#6f6d66]">No older notes found on these relays</span>
          ) : (
            <button
              disabled={loadingMore}
              onClick={() => void handleLoadOlder(items.length)}
              className="px-5 py-2 rounded-xl bg-[#161820] hover:bg-[#1e212c] border border-[#2a2d3a] text-xs font-medium text-[#d4d2cb] disabled:opacity-50 flex items-center gap-2 transition cursor-pointer"
            >
              {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#e8590c]" />}
              {loadingMore
                ? 'Loading older notes…'
                : visibleCount < items.length
                  ? `Load more (${items.length - visibleCount} ready)`
                  : 'Load older notes'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
