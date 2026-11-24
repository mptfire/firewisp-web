import { useEffect, useMemo, useState } from 'react'
import { Flame, Users, Globe, TrendingUp, Network, Loader2, ShieldCheck } from 'lucide-react'
import type { Event } from 'nostr-tools/pure'
import { evaluateNoteSpam, isTopLevelNote } from '../lib/nostr/spamFilter'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Composer } from '../components/Composer'
import { NoteCard } from '../components/NoteCard'

type FeedTab = 'global' | 'trending' | 'firewisp' | 'following' | 'extended'

export function FeedPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const follows = useNostrStore((s) => s.follows)
  const extendedAuthors = useNostrStore((s) => s.extendedAuthors)
  const loadingExtendedGraph = useNostrStore((s) => s.loadingExtendedGraph)
  const events = useNostrStore((s) => s.events)
  const deletedEventIds = useNostrStore((s) => s.deletedEventIds)
  const firewispFeedIds = useNostrStore((s) => s.firewispFeedIds)
  const followingFeedIds = useNostrStore((s) => s.followingFeedIds)
  const extendedFeedIds = useNostrStore((s) => s.extendedFeedIds)
  const trendingFeedIds = useNostrStore((s) => s.trendingFeedIds)
  const globalFeedIds = useNostrStore((s) => s.globalFeedIds)
  const loadingFeed = useNostrStore((s) => s.loadingFeed)
  const subscribeFeed = useNostrStore((s) => s.subscribeFeed)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const spamFilterEnabled = useSettingsStore((s) => s.spamFilterEnabled)
  const hideRepliesInExplore = useSettingsStore((s) => s.hideRepliesInExplore)
  const requirePowInExplore = useSettingsStore((s) => s.requirePowInExplore)
  const setSpamFilterEnabled = useSettingsStore((s) => s.setSpamFilterEnabled)

  const [tab, setTab] = useState<FeedTab>('global')

  useEffect(() => {
    return subscribeFeed(tab)
  }, [tab, pubkey, follows.length, extendedAuthors.length, subscribeFeed])

  const ids =
    tab === 'firewisp'
      ? firewispFeedIds
      : tab === 'following'
        ? followingFeedIds
        : tab === 'extended'
          ? extendedFeedIds
          : tab === 'trending'
            ? trendingFeedIds
            : globalFeedIds

  const { items, spamBlockedCount } = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()
    const seenContentAuthors = new Map<string, Set<string>>()
    const authorCounts = new Map<string, number>()
    const followSet = new Set(follows)
    let blocked = 0

    const shouldSpamFilter = (tab === 'global' || tab === 'trending') && spamFilterEnabled

    for (const id of ids) {
      if (deletedEventIds[id]) continue
      const ev = events[id]
      if (!ev || isEventMuted(ev)) continue

      let targetEv: Event = ev
      let repostedBy: string | undefined
      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? events[targetId] : undefined
        if (!inner || deletedEventIds[inner.id] || isEventMuted(inner)) continue
        targetEv = inner
        repostedBy = ev.pubkey
      }

      if (seen.has(targetEv.id)) continue

      if (
        (tab === 'global' || tab === 'trending') &&
        hideRepliesInExplore &&
        targetEv.kind === 1 &&
        !isTopLevelNote(targetEv)
      ) {
        continue
      }

      if (shouldSpamFilter) {
        const verdict = evaluateNoteSpam(targetEv, {
          myPubkey: pubkey,
          follows: followSet,
          seenContentAuthors,
          authorCounts,
          maxPerAuthor: 2,
          requirePowBits: tab === 'global' && requirePowInExplore ? 12 : 0,
        })
        if (verdict.isSpam) {
          blocked++
          continue
        }
      }

      seen.add(targetEv.id)
      out.push({ event: targetEv, repostedBy })
    }
    return { items: out, spamBlockedCount: blocked }
  }, [
    ids,
    events,
    deletedEventIds,
    isEventMuted,
    tab,
    spamFilterEnabled,
    hideRepliesInExplore,
    requirePowInExplore,
    pubkey,
    follows,
  ])

  return (
    <div>
      {/* Sticky Feed Tabs */}
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] flex overflow-x-auto text-xs sm:text-sm font-medium">
        {(
          [
            ['global', 'Explore', Globe],
            ['trending', 'Trending', TrendingUp],
            ['firewisp', 'Fire Wisp', Flame],
            ['following', 'Follows', Users],
            ['extended', 'Extended', Network],
          ] as [FeedTab, string, typeof Flame][]
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 min-w-[76px] py-3.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
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

      {(tab === 'global' || tab === 'trending') && (
        <div className="px-4 py-2 border-b border-[#20222c] bg-[#121319]/80 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-[#9a9890]">
            <ShieldCheck
              className={`w-3.5 h-3.5 ${spamFilterEnabled ? 'text-emerald-400' : 'text-[#6f6d66]'}`}
            />
            <span>
              {tab === 'trending'
                ? 'Curated trending feed (trending.relays.land)'
                : spamFilterEnabled
                  ? spamBlockedCount > 0
                    ? `Curated Explore (nostr.wine + Primal + Fire Wisp) · ${spamBlockedCount} filtered`
                    : 'Curated Explore (nostr.wine + Primal + Fire Wisp · anti-spam ON)'
                  : 'Anti-spam filter paused'}
            </span>
          </div>
          {tab === 'global' && (
            <button
              onClick={() => setSpamFilterEnabled(!spamFilterEnabled)}
              className="text-[11px] text-[#ff8a3d] hover:underline shrink-0 cursor-pointer"
            >
              {spamFilterEnabled ? 'Pause' : 'Enable'}
            </button>
          )}
        </div>
      )}

      {tab === 'extended' && (
        <div className="px-4 py-2 border-b border-[#20222c] bg-[#121319]/80 text-xs text-[#9a9890] flex items-center gap-1.5">
          <Network className="w-3.5 h-3.5 text-[#f59f00]" />
          <span>
            {loadingExtendedGraph
              ? 'Building your 2-hop Web of Trust graph…'
              : extendedAuthors.length > 0
                ? `2-hop Web of Trust · ${extendedAuthors.length} accounts endorsed by your follows`
                : 'Sign in and follow accounts to build your spam-free 2-hop Extended feed.'}
          </span>
        </div>
      )}

      <Composer />

      {loadingFeed && items.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-2 text-sm text-[#8c8a82]">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
          <span>Connecting to Nostr relays…</span>
        </div>
      )}

      {!loadingFeed && items.length === 0 && (
        <div className="py-16 px-6 text-center space-y-2">
          <p className="text-sm text-[#c2bfb7] font-medium">
            {tab === 'firewisp'
              ? 'No posts on firewisp.relay.rtard.de yet — be the first to ignite it!'
              : tab === 'following'
                ? 'Follow people on Nostr to fill your Following feed.'
                : 'No notes received from your configured relays yet.'}
          </p>
          <p className="text-xs text-[#8c8a82]">
            {tab === 'firewisp' &&
              'Fire Wisp Relay requires 12-bit NIP-13 PoW on public posts (mined automatically by Fire Wisp).'}
          </p>
        </div>
      )}

      <div>
        {items.map(({ event, repostedBy }) => (
          <NoteCard
            key={`${event.id}-${repostedBy || 'orig'}`}
            event={event}
            repostedByPubkey={repostedBy}
          />
        ))}
      </div>
    </div>
  )
}
