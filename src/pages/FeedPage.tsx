import { useEffect, useMemo, useState } from 'react'
import { Flame, Users, Globe, Loader2 } from 'lucide-react'
import type { Event } from 'nostr-tools/pure'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { Composer } from '../components/Composer'
import { NoteCard } from '../components/NoteCard'

type FeedTab = 'firewisp' | 'following' | 'global'

export function FeedPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const follows = useNostrStore((s) => s.follows)
  const events = useNostrStore((s) => s.events)
  const deletedEventIds = useNostrStore((s) => s.deletedEventIds)
  const firewispFeedIds = useNostrStore((s) => s.firewispFeedIds)
  const followingFeedIds = useNostrStore((s) => s.followingFeedIds)
  const globalFeedIds = useNostrStore((s) => s.globalFeedIds)
  const loadingFeed = useNostrStore((s) => s.loadingFeed)
  const subscribeFeed = useNostrStore((s) => s.subscribeFeed)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)

  const [tab, setTab] = useState<FeedTab>('global')

  useEffect(() => {
    return subscribeFeed(tab)
  }, [tab, pubkey, follows.length, subscribeFeed])

  const ids =
    tab === 'firewisp'
      ? firewispFeedIds
      : tab === 'following'
        ? followingFeedIds
        : globalFeedIds

  const items = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (deletedEventIds[id]) continue
      const ev = events[id]
      if (!ev || isEventMuted(ev)) continue
      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? events[targetId] : undefined
        if (inner && !deletedEventIds[inner.id] && !isEventMuted(inner) && !seen.has(inner.id)) {
          seen.add(inner.id)
          out.push({ event: inner, repostedBy: ev.pubkey })
        }
      } else if (!seen.has(ev.id)) {
        seen.add(ev.id)
        out.push({ event: ev })
      }
    }
    return out
  }, [ids, events, deletedEventIds, isEventMuted])

  return (
    <div>
      {/* Sticky Feed Tabs */}
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] grid grid-cols-3 text-sm font-medium">
        {(
          [
            ['global', 'Explore', Globe],
            ['firewisp', 'Fire Wisp', Flame],
            ['following', 'Following', Users],
          ] as [FeedTab, string, typeof Flame][]
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`py-3.5 flex items-center justify-center gap-1.5 border-b-2 transition cursor-pointer ${
              tab === id
                ? 'border-[#e8590c] text-white'
                : 'border-transparent text-[#8c8a82] hover:text-white'
            }`}
          >
            <Icon className={`w-4 h-4 ${tab === id ? 'text-[#f59f00]' : ''}`} />
            {label}
          </button>
        ))}
      </div>

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
