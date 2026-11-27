import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles,
  Flame,
  Users,
  Globe,
  TrendingUp,
  Network,
  Hash,
  List,
  Lock,
  Pin,
  Server,
  Loader2,
  ShieldCheck,
  RefreshCw,
  ArrowUp,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type { Event } from 'nostr-tools/pure'
import { extractEventHashtags } from '../lib/nostr/content'
import { evaluateWotStatus } from '../lib/nostr/wot'
import { getListFeedDTag, makeListFeedKey } from '../lib/nostr/followSets'
import {
  capActiveRelaySetUrls,
  getCustomFeedStorageKey,
  getInterestFeedDTag,
  getRelaySetFeedDTag,
  isAnyCustomFeedKey,
  isInterestFeedKey,
  isRelaySetFeedKey,
  makeInterestFeedKey,
  makeRelaySetFeedKey,
} from '../lib/nostr/nip51Sets'
import { evaluateNoteSpam, isTopLevelNote } from '../lib/nostr/spamFilter'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore, type FeedTab } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { useWotStore } from '../lib/store/useWotStore'
import { Composer } from '../components/Composer'
import { LiveNowRow } from '../components/LiveNowRow'
import { LiveZapsCard } from '../components/LiveZapsCard'
import { NoteCard } from '../components/NoteCard'

const EMPTY_IDS: string[] = []

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
  const tab = useNostrStore((s) => s.activeFeedTab)
  const setTab = useNostrStore((s) => s.setActiveFeedTab)
  const activeListDTag = getListFeedDTag(tab)
  const activeInterestDTag = getInterestFeedDTag(tab)
  const activeRelaySetDTag = getRelaySetFeedDTag(tab)
  const customStorageKey = isAnyCustomFeedKey(tab) ? getCustomFeedStorageKey(tab) : null
  const listsMap = useListsStore((s) => s.lists)
  const interestSets = useListsStore((s) => s.interestSets)
  const relaySets = useListsStore((s) => s.relaySets)
  const listsLoading = useListsStore((s) => s.loading)
  const activeList = activeListDTag ? listsMap[activeListDTag] : undefined
  const activeInterestSet = activeInterestDTag ? interestSets[activeInterestDTag] : undefined
  const activeRelaySet = activeRelaySetDTag ? relaySets[activeRelaySetDTag] : undefined
  const showRepliesInFollows = useNostrStore((s) => s.showRepliesInFollows)
  const setShowRepliesInFollows = useNostrStore((s) => s.setShowRepliesInFollows)
  const follows = useNostrStore((s) => s.follows)
  const followedHashtags = useNostrStore((s) => s.followedHashtags)
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
  const zappedFeedIds = useNostrStore((s) => s.zappedFeedIds)
  const globalFeedIds = useNostrStore((s) => s.globalFeedIds)
  const activeListFeedIds = useNostrStore((s) =>
    customStorageKey ? (s.listFeedIds[customStorageKey] ?? EMPTY_IDS) : EMPTY_IDS,
  )
  const pendingIds = useNostrStore((s) => s.pendingFeedIds[s.activeFeedTab] ?? EMPTY_IDS)
  const loadingFeed = useNostrStore((s) => s.loadingFeed)
  const feedRefreshTick = useNostrStore((s) => s.feedRefreshTick)
  const bumpFeedRefresh = useNostrStore((s) => s.bumpFeedRefresh)
  const flushPendingFeed = useNostrStore((s) => s.flushPendingFeed)
  const loadOlderFeed = useNostrStore((s) => s.loadOlderFeed)
  const clearFeedTab = useNostrStore((s) => s.clearFeedTab)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const spamFilterEnabled = useSettingsStore((s) => s.spamFilterEnabled)
  const hideRepliesInExplore = useSettingsStore((s) => s.hideRepliesInExplore)
  const requirePowInExplore = useSettingsStore((s) => s.requirePowInExplore)
  const showFireWispTab = useSettingsStore((s) => s.showFireWispTab)
  const showExtendedTab = useSettingsStore((s) => s.showExtendedTab)
  const showExploreTab = useSettingsStore((s) => s.showExploreTab)
  const showZappedTab = useSettingsStore((s) => s.showZappedTab)
  const forYouIncludeFollows = useSettingsStore((s) => s.forYouIncludeFollows)
  const forYouIncludeExtended = useSettingsStore((s) => s.forYouIncludeExtended)
  const forYouIncludeTopics = useSettingsStore((s) => s.forYouIncludeTopics)
  const forYouIncludeWotZapped = useSettingsStore((s) => s.forYouIncludeWotZapped)
  const forYouIncludeTrending = useSettingsStore((s) => s.forYouIncludeTrending)
  const setForYouIncludeFollows = useSettingsStore((s) => s.setForYouIncludeFollows)
  const setForYouIncludeExtended = useSettingsStore((s) => s.setForYouIncludeExtended)
  const setForYouIncludeTopics = useSettingsStore((s) => s.setForYouIncludeTopics)
  const setForYouIncludeWotZapped = useSettingsStore((s) => s.setForYouIncludeWotZapped)
  const setForYouIncludeTrending = useSettingsStore((s) => s.setForYouIncludeTrending)
  const wotFilterZapped = useSettingsStore((s) => s.wotFilterZapped)
  const setWotFilterZapped = useSettingsStore((s) => s.setWotFilterZapped)
  const wotFilterExplore = useSettingsStore((s) => s.wotFilterExplore)
  const setWotFilterExplore = useSettingsStore((s) => s.setWotFilterExplore)
  const wotMinVouches = useSettingsStore((s) => s.wotMinVouches)
  const nip85Enabled = useSettingsStore((s) => s.nip85Enabled)
  const nip85MinRank = useSettingsStore((s) => s.nip85MinRank)
  const wotEntries = useWotStore((s) => s.entries)
  const nip85Scores = useWotStore((s) => s.nip85Scores)
  const sidebarFeedMode = useSettingsStore((s) => s.sidebarFeedMode)
  const pinnedListTabs = useSettingsStore((s) => s.pinnedListTabs)
  const togglePinnedListTab = useSettingsStore((s) => s.togglePinnedListTab)
  const showLiveZaps = useSettingsStore((s) => s.showLiveZaps)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const setSpamFilterEnabled = useSettingsStore((s) => s.setSpamFilterEnabled)

  const visibleTabs = useMemo(() => {
    const sbDTag = getListFeedDTag(sidebarFeedMode)
    const sbIntDTag = getInterestFeedDTag(sidebarFeedMode)
    const sbRelayDTag = getRelaySetFeedDTag(sidebarFeedMode)
    const sbList = sbDTag ? listsMap[sbDTag] : undefined
    const sbInt = sbIntDTag ? interestSets[sbIntDTag] : undefined
    const sbRelay = sbRelayDTag ? relaySets[sbRelayDTag] : undefined
    const thirdTab: [FeedTab, string, typeof Flame] =
      sidebarFeedMode === 'zapped'
        ? ['zapped', 'Zapped', Zap]
        : sidebarFeedMode === 'extended'
          ? ['extended', 'Extended', Network]
          : sidebarFeedMode === 'global'
            ? ['global', 'Explore', Globe]
            : sidebarFeedMode === 'firewisp'
              ? ['firewisp', 'Wisp Relay', Flame]
              : sbDTag && (sbList || listsLoading)
                ? [sidebarFeedMode, sbList?.name || 'List', List]
                : sbIntDTag && (sbInt || listsLoading)
                  ? [sidebarFeedMode, sbInt?.name || 'Interests', Hash]
                  : sbRelayDTag && (sbRelay || listsLoading)
                    ? [sidebarFeedMode, sbRelay?.name || 'Relays', Server]
                    : ['trending', 'Trending', TrendingUp]

    const list: [FeedTab, string, typeof Flame][] = [
      ['foryou', 'For You', Sparkles],
      ['following', 'Follows', Users],
      thirdTab,
    ]
    const seen = new Set<FeedTab>(list.map(([id]) => id))
    const addTab = (id: FeedTab, label: string, Icon: typeof Flame) => {
      if (seen.has(id)) return
      seen.add(id)
      list.push([id, label, Icon])
    }
    if (showFireWispTab) addTab('firewisp', 'Wisp Relay', Flame)
    if (showExtendedTab) addTab('extended', 'Extended', Network)
    if (showExploreTab) addTab('global', 'Explore', Globe)
    if (showZappedTab) addTab('zapped', 'Zapped', Zap)

    for (const pinKey of pinnedListTabs) {
      if (isInterestFeedKey(pinKey)) {
        const dTag = getInterestFeedDTag(pinKey)!
        const pinned = interestSets[dTag]
        if (pinned) addTab(makeInterestFeedKey(dTag), pinned.name, Hash)
      } else if (isRelaySetFeedKey(pinKey)) {
        const dTag = getRelaySetFeedDTag(pinKey)!
        const pinned = relaySets[dTag]
        if (pinned) addTab(makeRelaySetFeedKey(dTag), pinned.name, Server)
      } else {
        const pinned = listsMap[pinKey]
        if (pinned) addTab(makeListFeedKey(pinKey), pinned.name, List)
      }
    }

    if (activeListDTag && !seen.has(tab)) {
      if (activeList) addTab(tab, activeList.name, List)
      else if (listsLoading) addTab(tab, 'List', List)
    } else if (activeInterestDTag && !seen.has(tab)) {
      if (activeInterestSet) addTab(tab, activeInterestSet.name, Hash)
      else if (listsLoading) addTab(tab, 'Interests', Hash)
    } else if (activeRelaySetDTag && !seen.has(tab)) {
      if (activeRelaySet) addTab(tab, activeRelaySet.name, Server)
      else if (listsLoading) addTab(tab, 'Relays', Server)
    }
    return list
  }, [
    sidebarFeedMode,
    showFireWispTab,
    showExtendedTab,
    showExploreTab,
    showZappedTab,
    pinnedListTabs,
    listsMap,
    interestSets,
    relaySets,
    listsLoading,
    activeListDTag,
    activeList,
    activeInterestDTag,
    activeInterestSet,
    activeRelaySetDTag,
    activeRelaySet,
    tab,
  ])

  // Follow the 3rd-column feed selector cleanly when its tab swaps (or fall back to For You)
  useEffect(() => {
    if (!visibleTabs.some(([id]) => id === tab)) {
      const isThirdSlotMode =
        tab === 'trending' ||
        tab === 'zapped' ||
        tab === 'extended' ||
        tab === 'global' ||
        tab === 'firewisp'
      if (isThirdSlotMode && visibleTabs.some(([id]) => id === sidebarFeedMode)) {
        setTab(sidebarFeedMode)
      } else {
        setTab('foryou')
      }
    }
  }, [visibleTabs, tab, sidebarFeedMode, setTab])

  const PAGE_SIZE = 40
  const [noMoreOlder, setNoMoreOlder] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [mobileLiveZapsOpen, setMobileLiveZapsOpen] = useState(false)

  useEffect(() => {
    setNoMoreOlder(false)
    setVisibleCount(PAGE_SIZE)
  }, [tab, pubkey, feedRefreshTick])

  const handleRefresh = () => {
    setNoMoreOlder(false)
    setVisibleCount(PAGE_SIZE)
    clearFeedTab(tab)
    bumpFeedRefresh()
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

  const ids = customStorageKey
    ? activeListFeedIds
    : tab === 'foryou'
      ? forYouFeedIds
      : tab === 'firewisp'
        ? firewispFeedIds
        : tab === 'following'
          ? followingFeedIds
          : tab === 'extended'
            ? extendedFeedIds
            : tab === 'trending'
              ? trendingFeedIds
              : tab === 'zapped'
                ? zappedFeedIds
                : globalFeedIds

  const { items, spamBlockedCount, pendingCount } = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()
    const seenContentAuthors = new Map<string, Set<string>>()
    const authorCounts = new Map<string, number>()
    const followSet = new Set(follows.map((p) => p.toLowerCase()))
    const extendedSet = new Set(extendedAuthors.map((p) => p.toLowerCase()))
    const listMemberSet = activeList
      ? new Set(activeList.members.map((p) => p.toLowerCase()))
      : null
    const interestTagSet = activeInterestSet
      ? new Set(activeInterestSet.items.map((t) => t.toLowerCase()))
      : null
    const myPk = pubkey?.toLowerCase()
    let blocked = 0

    const shouldSpamFilter =
      (tab === 'foryou' || tab === 'global' || tab === 'trending' || tab === 'zapped') &&
      spamFilterEnabled

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

      // STRICT LIST GATE: only members of the selected NIP-51 list appear here
      if (activeListDTag) {
        if (!listMemberSet || !listMemberSet.has(ev.pubkey.toLowerCase())) return null
      }

      // STRICT INTEREST GATE: must match at least one hashtag from the active Interest set
      if (activeInterestDTag) {
        if (!interestTagSet || !extractEventHashtags(ev).some((h) => interestTagSet.has(h))) {
          return null
        }
      }

      // STRICT FOR YOU GATE (when signed in): only enabled Follows, enabled Extended WoT, or vetted Trending/Topic picks
      if (tab === 'foryou' && myPk) {
        const evAuthor = ev.pubkey.toLowerCase()
        const allowedFollow = forYouIncludeFollows && (evAuthor === myPk || followSet.has(evAuthor))
        const allowedExtended = forYouIncludeExtended && extendedSet.has(evAuthor)
        if (!allowedFollow && !allowedExtended && !forYouSuppIds[ev.id]) {
          return null
        }
      }

      // Optional WoT filter on Zapped / Explore feeds
      if (myPk && ((tab === 'zapped' && wotFilterZapped) || (tab === 'global' && wotFilterExplore))) {
        const wot = evaluateWotStatus({
          targetPubkey: ev.pubkey,
          myPubkey: myPk,
          followsSet: followSet,
          entries: wotEntries,
          minVouches: wotMinVouches,
          nip85Scores: nip85Enabled ? nip85Scores : undefined,
          nip85MinRank,
        })
        if (!wot.trusted) return null
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

      // Hide replies (including reposted replies) in Follows, For You, Extended, Fire Wisp & Custom Sets when replies are hidden
      if (
        (tab === 'following' ||
          tab === 'foryou' ||
          tab === 'extended' ||
          tab === 'firewisp' ||
          Boolean(customStorageKey)) &&
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
    forYouIncludeFollows,
    forYouIncludeExtended,
    forYouSuppIds,
    wotFilterZapped,
    wotFilterExplore,
    wotEntries,
    wotMinVouches,
    nip85Enabled,
    nip85Scores,
    nip85MinRank,
    customStorageKey,
    activeListDTag,
    activeList,
    activeInterestDTag,
    activeInterestSet,
  ])

  const activeCustomPinKey = activeListDTag
    ? activeListDTag
    : activeInterestDTag || activeRelaySetDTag
      ? tab
      : null
  const activeCustomExists = activeListDTag
    ? Boolean(activeList)
    : activeInterestDTag
      ? Boolean(activeInterestSet)
      : activeRelaySetDTag
        ? Boolean(activeRelaySet)
        : false
  const activeCustomManagePath = activeListDTag
    ? `/lists/${encodeURIComponent(activeListDTag)}`
    : activeInterestDTag
      ? `/lists/interests/${encodeURIComponent(activeInterestDTag)}`
      : activeRelaySetDTag
        ? `/lists/relays/${encodeURIComponent(activeRelaySetDTag)}`
        : '/lists'
  const isPinnedActiveList = activeCustomPinKey
    ? pinnedListTabs.includes(activeCustomPinKey)
    : false

  return (
    <div>
      {/* Sticky Feed Tabs */}
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] flex overflow-x-auto text-xs sm:text-sm font-medium">
        {visibleTabs.map(([id, label, Icon]) => {
          const isCustomTab = isAnyCustomFeedKey(id)
          const inactiveAccent = isInterestFeedKey(id)
            ? 'text-amber-400'
            : isRelaySetFeedKey(id)
              ? 'text-cyan-400'
              : isCustomTab
                ? 'text-purple-400'
                : ''
          return (
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
              className={`flex-1 min-w-[74px] py-3.5 px-2.5 flex items-center justify-center gap-1.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
                tab === id
                  ? 'border-[#e8590c] text-white'
                  : 'border-transparent text-[#8c8a82] hover:text-white'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${
                  tab === id ? 'text-[#f59f00]' : inactiveAccent
                }`}
              />
              <span className="max-w-[140px] truncate">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Status + Controls Strip */}
      <div className="px-4 py-2 border-b border-[#20222c] bg-[#121319]/80 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5 text-[#9a9890] min-w-0">
          {tab === 'foryou' ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="font-medium text-[#d4d2cb] shrink-0">
                {pubkey
                  ? 'For You'
                  : 'For You · Curated Trending & Fire Wisp highlights (sign in to personalize)'}
              </span>
              {pubkey && (
                <div className="inline-flex flex-wrap items-center gap-1 ml-1">
                  <button
                    type="button"
                    aria-pressed={forYouIncludeFollows}
                    onClick={() => {
                      setForYouIncludeFollows(!forYouIncludeFollows)
                      clearFeedTab('foryou')
                    }}
                    title="Include direct posts and reposts from your followed accounts"
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                      forYouIncludeFollows
                        ? 'bg-sky-500/15 border-sky-400/50 text-sky-300'
                        : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        forYouIncludeFollows ? 'bg-sky-400' : 'bg-[#4f4d47]'
                      }`}
                    />
                    <span>{follows.length.toLocaleString()} Follows</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={forYouIncludeExtended}
                    onClick={() => {
                      setForYouIncludeExtended(!forYouIncludeExtended)
                      clearFeedTab('foryou')
                    }}
                    title="Include posts from accounts endorsed by your follows (2-hop Web of Trust)"
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                      forYouIncludeExtended
                        ? 'bg-violet-500/15 border-violet-400/50 text-violet-300'
                        : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        forYouIncludeExtended ? 'bg-violet-400' : 'bg-[#4f4d47]'
                      }`}
                    />
                    <span>
                      +{' '}
                      {extendedAuthors.length > 0
                        ? `${extendedAuthors.length} 2-hop`
                        : loadingExtendedGraph
                          ? '2-hop…'
                          : '2-hop'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={forYouIncludeWotZapped}
                    onClick={() => {
                      setForYouIncludeWotZapped(!forYouIncludeWotZapped)
                      clearFeedTab('foryou')
                    }}
                    title="Include posts zapped by or sent to your 1-hop & 2-hop Web of Trust"
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                      forYouIncludeWotZapped
                        ? 'bg-[#f59f00]/15 border-[#f59f00]/50 text-[#ffd43b]'
                        : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        forYouIncludeWotZapped ? 'bg-[#ffd43b]' : 'bg-[#4f4d47]'
                      }`}
                    />
                    <span>+ WoT Zaps</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={forYouIncludeTrending}
                    onClick={() => {
                      setForYouIncludeTrending(!forYouIncludeTrending)
                      clearFeedTab('foryou')
                    }}
                    title="Include spam-filtered global trending highlights"
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                      forYouIncludeTrending
                        ? 'bg-[#e8590c]/15 border-[#e8590c]/50 text-[#ff922b]'
                        : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        forYouIncludeTrending ? 'bg-[#ff922b]' : 'bg-[#4f4d47]'
                      }`}
                    />
                    <span>+ Trending</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={forYouIncludeTopics}
                    onClick={() => {
                      setForYouIncludeTopics(!forYouIncludeTopics)
                      clearFeedTab('foryou')
                    }}
                    title="Include notes matching your NIP-51 kind-10015 & kind-30015 followed hashtags"
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition cursor-pointer ${
                      forYouIncludeTopics
                        ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        forYouIncludeTopics ? 'bg-emerald-400' : 'bg-[#4f4d47]'
                      }`}
                    />
                    <span>
                      + Topics{followedHashtags.length > 0 ? ` (${followedHashtags.length})` : ''}
                    </span>
                  </button>
                </div>
              )}
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
          ) : activeListDTag ? (
            <>
              <List className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              {activeList?.isPrivate && (
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" aria-label="Private list" />
              )}
              <span className="truncate">
                {activeList
                  ? `${activeList.name} · ${activeList.members.length} ${activeList.members.length === 1 ? 'person' : 'people'}`
                  : listsLoading
                    ? 'Loading list…'
                    : 'List not found'}
              </span>
            </>
          ) : activeInterestDTag ? (
            <>
              <Hash className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              {activeInterestSet?.isPrivate && (
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" aria-label="Private set" />
              )}
              <span className="truncate">
                {activeInterestSet
                  ? `${activeInterestSet.name} · ${activeInterestSet.items.length} ${activeInterestSet.items.length === 1 ? 'hashtag' : 'hashtags'}`
                  : listsLoading
                    ? 'Loading interest set…'
                    : 'Interest set not found'}
              </span>
            </>
          ) : activeRelaySetDTag ? (
            <>
              <Server className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              {activeRelaySet?.isPrivate && (
                <Lock className="w-3 h-3 text-emerald-400 shrink-0" aria-label="Private set" />
              )}
              <span className="truncate">
                {activeRelaySet
                  ? `${activeRelaySet.name} · ${capActiveRelaySetUrls(activeRelaySet.items).length} active relays`
                  : listsLoading
                    ? 'Loading relay set…'
                    : 'Relay set not found'}
              </span>
            </>
          ) : tab === 'zapped' ? (
            <>
              <Zap className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">Zapped · Posts receiving verified Lightning zaps</span>
              {pubkey && (
                <button
                  type="button"
                  aria-pressed={wotFilterZapped}
                  onClick={() => setWotFilterZapped(!wotFilterZapped)}
                  title="Show only zapped posts by authors in your Web of Trust"
                  className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border inline-flex items-center gap-1 transition cursor-pointer shrink-0 ${
                    wotFilterZapped
                      ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-300'
                      : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  WoT only
                </button>
              )}
            </>
          ) : tab === 'firewisp' ? (
            <>
              <Flame className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              <span className="truncate">Fire Wisp anti-spam relay (wss://relay.firewisp.de)</span>
            </>
          ) : (
            <>
              <ShieldCheck
                className={`w-3.5 h-3.5 shrink-0 ${spamFilterEnabled ? 'text-emerald-400' : 'text-[#6f6d66]'}`}
              />
              <span className="truncate">
                {tab === 'trending'
                  ? 'Live global trending & most-zapped notes (4h + 24h)'
                  : spamFilterEnabled
                    ? spamBlockedCount > 0
                      ? `Curated Explore · ${spamBlockedCount} filtered`
                      : 'Curated Explore (anti-spam ON)'
                    : 'Anti-spam filter paused'}
              </span>
              {tab === 'global' && pubkey && (
                <button
                  type="button"
                  aria-pressed={wotFilterExplore}
                  onClick={() => setWotFilterExplore(!wotFilterExplore)}
                  title="Show only Explore posts from authors inside your Web of Trust"
                  className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border inline-flex items-center gap-1 transition cursor-pointer shrink-0 ${
                    wotFilterExplore
                      ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-300'
                      : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  WoT only
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeCustomPinKey && activeCustomExists && (
            <>
              <button
                type="button"
                onClick={() => togglePinnedListTab(activeCustomPinKey)}
                title={isPinnedActiveList ? 'Unpin from Feed tabs' : 'Pin to Feed tabs'}
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition inline-flex items-center gap-1 cursor-pointer ${
                  isPinnedActiveList
                    ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                    : 'bg-[#0e0e11] border-[#262938] text-[#9a9890] hover:text-white'
                }`}
              >
                <Pin className="w-2.5 h-2.5" />
                {isPinnedActiveList ? 'Pinned' : 'Pin'}
              </button>
              <Link
                to={activeCustomManagePath}
                className="text-[11px] text-purple-300 hover:underline whitespace-nowrap"
              >
                Manage
              </Link>
            </>
          )}
          {(tab === 'following' ||
            tab === 'foryou' ||
            tab === 'extended' ||
            tab === 'firewisp' ||
            Boolean(customStorageKey)) && (
            <button
              type="button"
              aria-pressed={showRepliesInFollows}
              onClick={() => setShowRepliesInFollows(!showRepliesInFollows)}
              title={
                showRepliesInFollows
                  ? 'Replies shown in feed — click to hide'
                  : 'Replies hidden in feed — click to show'
              }
              className={`md:hidden px-2 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                showRepliesInFollows
                  ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
              }`}
            >
              Replies
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
      {showLiveZaps && (
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
      )}

      <Composer />

      {/* Jumble-style buffered new-notes pill (zero scroll jumping while reading!) */}
      {pendingCount > 0 && (
        <div className="sticky top-[calc(102px+env(safe-area-inset-top,0px))] md:top-[52px] z-20 flex justify-center py-2 pointer-events-none">
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
        <div className="py-16 px-6 text-center space-y-3">
          <p className="text-sm text-[#c2bfb7] font-medium">
            {activeListDTag
              ? !activeList
                ? 'List not found or still syncing from relays.'
                : activeList.members.length === 0
                  ? `No people in "${activeList.name}" yet.`
                  : `No recent notes from "${activeList.name}" in the last 7 days.`
              : activeInterestDTag
                ? !activeInterestSet
                  ? 'Interest set not found or still syncing from relays.'
                  : activeInterestSet.items.length === 0
                    ? `No hashtags in "${activeInterestSet.name}" yet.`
                    : `No recent notes matching "${activeInterestSet.name}" hashtags in the last 7 days.`
                : activeRelaySetDTag
                  ? !activeRelaySet
                    ? 'Relay set not found or still syncing from relays.'
                    : capActiveRelaySetUrls(activeRelaySet.items).length === 0
                      ? `No valid wss:// relays in "${activeRelaySet.name}" yet.`
                      : `No notes received from "${activeRelaySet.name}" relays yet.`
                  : tab === 'zapped'
                    ? 'No verified zapped posts loaded from relays yet.'
                    : tab === 'firewisp'
                    ? 'No posts on relay.firewisp.de yet — be the first to ignite it!'
                    : tab === 'following'
                      ? pubkey
                        ? 'No recent notes from your follows loaded yet.'
                        : 'Sign in and follow people on Nostr to fill your Follows feed.'
                      : tab === 'foryou' &&
                          pubkey &&
                          !forYouIncludeFollows &&
                          !forYouIncludeExtended &&
                          !forYouIncludeWotZapped &&
                          !forYouIncludeTrending &&
                          (!forYouIncludeTopics || followedHashtags.length === 0)
                        ? 'All For You sources are turned off. Click any source pill above to enable it.'
                        : 'No notes received from your configured relays yet.'}
          </p>
          {customStorageKey && (
            <Link
              to={activeCustomExists ? activeCustomManagePath : '/lists'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white transition"
            >
              <List className="w-3.5 h-3.5" />
              {activeList
                ? activeList.members.length === 0
                  ? 'Add people'
                  : 'Manage list'
                : activeInterestSet
                  ? activeInterestSet.items.length === 0
                    ? 'Add hashtags'
                    : 'Manage interests'
                  : activeRelaySet
                    ? activeRelaySet.items.length === 0
                      ? 'Add relays'
                      : 'Manage relays'
                    : 'Back to Lists'}
            </Link>
          )}
          {tab === 'firewisp' && (
            <p className="text-xs text-[#8c8a82]">
              Fire Wisp Relay requires 12-bit NIP-13 PoW on public posts (mined automatically by Fire Wisp).
            </p>
          )}
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
