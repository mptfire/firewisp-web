import { create } from 'zustand'
import { verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import type { SubCloser } from 'nostr-tools/pool'
import { nostrPool, type RelayStatus } from '../nostr/pool'
import { CLIENT_TAG_VALUE, CURATED_EXPLORE_RELAYS, FIREWISP_RELAY, TRENDING_RELAY } from '../constants'
import { sanitizeRelayUrl } from '../sanitize'
import { minePowAsync } from '../crypto/nip13'
import { extractEventHashtags } from '../nostr/content'
import { createGiftWrappedDm, unwrapGiftWrap, type DecryptedDm } from '../nostr/nip17'
import { useAuthStore } from './useAuthStore'
import { useSettingsStore } from './useSettingsStore'

export interface NostrProfile {
  pubkey: string
  name?: string
  display_name?: string
  about?: string
  picture?: string
  banner?: string
  nip05?: string
  lud16?: string
  website?: string
  updatedAt: number
}

const BOOKMARKS_KEY = 'firewisp_bookmarks_v1'

function loadBookmarks(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export interface NostrState {
  relayStatuses: Record<string, RelayStatus>
  events: Record<string, Event>
  profiles: Record<string, NostrProfile>
  follows: string[]
  userReadRelays: string[]
  userWriteRelays: string[]
  bookmarks: string[]

  // Social aggregates
  reactionCounts: Record<string, number>
  userLiked: Record<string, boolean>
  repostCounts: Record<string, number>
  // targetEventId -> array of the current user's kind-6 repost event IDs (enables NIP-09 undo repost!)
  userRepostIds: Record<string, string[]>
  deletedEventIds: Record<string, boolean>
  zapTotalsSats: Record<string, number>

  // Feeds
  firewispFeedIds: string[]
  followingFeedIds: string[]
  extendedFeedIds: string[]
  trendingFeedIds: string[]
  globalFeedIds: string[]
  extendedAuthors: string[]
  loadingExtendedGraph: boolean
  notificationIds: string[]
  dms: DecryptedDm[]

  loadingFeed: boolean
  powBusyMessage: string | null
  toastMessage: string | null

  setToast: (msg: string | null) => void
  initPoolListener: () => () => void
  ingestEvent: (event: Event) => void
  fetchProfiles: (pubkeys: string[]) => Promise<void>
  loadUserGraph: (pubkey: string) => Promise<void>
  loadExtendedNetwork: () => Promise<string[]>
  clearFeedTab: (tab: 'firewisp' | 'following' | 'extended' | 'trending' | 'global') => void
  resetUserState: () => void
  subscribeFeed: (tab: 'firewisp' | 'following' | 'extended' | 'trending' | 'global') => () => void
  subscribeNotifications: (pubkey: string) => () => void
  subscribeDms: () => () => void

  publishNote: (params: {
    content: string
    extraTags?: string[][]
    replyTo?: Event
    kind?: number
  }) => Promise<Event>
  toggleLike: (target: Event) => Promise<void>
  toggleRepost: (target: Event) => Promise<void>
  toggleFollow: (targetPubkey: string) => Promise<void>
  toggleBookmark: (eventId: string) => Promise<void>
  sendDm: (recipientPubkey: string, plaintext: string) => Promise<DecryptedDm>

  isEventMuted: (event: Event) => boolean
}

const requestedProfiles = new Set<string>()
const reactionSeen = new Set<string>()
const repostSeen = new Set<string>()
const zapSeen = new Set<string>()
const seenDmWraps = new Set<string>()

function parseProfileEvent(event: Event): NostrProfile | null {
  try {
    const raw = JSON.parse(event.content) as Record<string, unknown>
    return {
      pubkey: event.pubkey,
      name: typeof raw.name === 'string' ? raw.name : undefined,
      display_name: typeof raw.display_name === 'string' ? raw.display_name : undefined,
      about: typeof raw.about === 'string' ? raw.about : undefined,
      picture: typeof raw.picture === 'string' ? raw.picture : undefined,
      banner: typeof raw.banner === 'string' ? raw.banner : undefined,
      nip05: typeof raw.nip05 === 'string' ? raw.nip05 : undefined,
      lud16: typeof raw.lud16 === 'string' ? raw.lud16 : undefined,
      website: typeof raw.website === 'string' ? raw.website : undefined,
      updatedAt: event.created_at,
    }
  } catch {
    return null
  }
}

function parseBolt11Sats(bolt11: string): number {
  const m = bolt11.toLowerCase().match(/^ln(?:bc|tb|bcrt)(\d+)([munp])/)
  if (!m) return 0
  const num = Number(m[1])
  if (!Number.isFinite(num)) return 0
  switch (m[2]) {
    case 'm':
      return Math.round(num * 100_000)
    case 'u':
      return Math.round(num * 100)
    case 'n':
      return Math.round(num * 0.1)
    case 'p':
      return Math.round(num * 0.0001)
    default:
      return 0
  }
}

function insertSortedUnique(ids: string[], ev: Event, eventsMap: Record<string, Event>): string[] {
  if (ids.includes(ev.id)) return ids
  const next = [ev.id, ...ids]
  next.sort((a, b) => (eventsMap[b]?.created_at || 0) - (eventsMap[a]?.created_at || 0))
  return next.slice(0, 500)
}

export const useNostrStore = create<NostrState>((set, get) => ({
  relayStatuses: {},
  events: {},
  profiles: {},
  follows: [],
  userReadRelays: [],
  userWriteRelays: [],
  bookmarks: loadBookmarks(),

  reactionCounts: {},
  userLiked: {},
  repostCounts: {},
  userRepostIds: {},
  deletedEventIds: {},
  zapTotalsSats: {},

  firewispFeedIds: [],
  followingFeedIds: [],
  extendedFeedIds: [],
  trendingFeedIds: [],
  globalFeedIds: [],
  extendedAuthors: [],
  loadingExtendedGraph: false,
  notificationIds: [],
  dms: [],

  loadingFeed: false,
  powBusyMessage: null,
  toastMessage: null,

  setToast: (toastMessage) => set({ toastMessage }),

  clearFeedTab: (tab) => {
    if (tab === 'firewisp') set({ firewispFeedIds: [] })
    else if (tab === 'following') set({ followingFeedIds: [] })
    else if (tab === 'extended') set({ extendedFeedIds: [] })
    else if (tab === 'trending') set({ trendingFeedIds: [] })
    else set({ globalFeedIds: [] })
  },

  resetUserState: () => {
    set({
      follows: [],
      userReadRelays: [],
      userWriteRelays: [],
      followingFeedIds: [],
      extendedFeedIds: [],
      extendedAuthors: [],
      notificationIds: [],
      dms: [],
    })
  },

  initPoolListener: () => {
    return nostrPool.onStatusChange((relayStatuses) => set({ relayStatuses }))
  },

  isEventMuted: (event) => {
    const { mutedPubkeys, mutedHashtags } = useSettingsStore.getState()
    if (mutedPubkeys.includes(event.pubkey.toLowerCase())) return true
    if (mutedHashtags.length > 0) {
      const tags = extractEventHashtags(event)
      if (tags.some((t) => mutedHashtags.includes(t))) return true
    }
    return false
  },

  ingestEvent: (event) => {
    const state = get()
    const myPubkey = useAuthStore.getState().pubkey?.toLowerCase()

    // Kind 0: Profile metadata
    if (event.kind === 0) {
      const existing = state.profiles[event.pubkey]
      if (existing && existing.updatedAt >= event.created_at) return
      const parsed = parseProfileEvent(event)
      if (!parsed) return
      set((s) => ({ profiles: { ...s.profiles, [event.pubkey]: parsed } }))
      return
    }

    // Kind 5: NIP-09 author-verified deletion (handles undo repost & deleted notes!)
    if (event.kind === 5) {
      const targetIds = event.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1])
      if (targetIds.length === 0) return
      set((s) => {
        const nextDeleted = { ...s.deletedEventIds }
        const nextUserReposts = { ...s.userRepostIds }
        const nextRepostCounts = { ...s.repostCounts }

        for (const tid of targetIds) {
          const targetEv = s.events[tid]
          // Verify author ownership if we have the original event (NIP-09)
          if (targetEv && targetEv.pubkey !== event.pubkey) continue
          nextDeleted[tid] = true

          // If this deleted one of the user's repost events, undo repost state cleanly
          for (const [repostedTarget, ids] of Object.entries(nextUserReposts)) {
            if (ids.includes(tid)) {
              nextUserReposts[repostedTarget] = ids.filter((id) => id !== tid)
              nextRepostCounts[repostedTarget] = Math.max(
                0,
                (nextRepostCounts[repostedTarget] || 1) - 1,
              )
            }
          }
        }
        return {
          deletedEventIds: nextDeleted,
          userRepostIds: nextUserReposts,
          repostCounts: nextRepostCounts,
        }
      })
      return
    }

    // Kind 7: Reaction
    if (event.kind === 7) {
      if (reactionSeen.has(event.id)) return
      reactionSeen.add(event.id)
      const targetId = [...event.tags].reverse().find((t) => t[0] === 'e' && t[1])?.[1]
      if (!targetId) return
      set((s) => ({
        events: { ...s.events, [event.id]: event },
        reactionCounts: {
          ...s.reactionCounts,
          [targetId]: (s.reactionCounts[targetId] || 0) + 1,
        },
        userLiked:
          myPubkey && event.pubkey.toLowerCase() === myPubkey
            ? { ...s.userLiked, [targetId]: true }
            : s.userLiked,
      }))
      return
    }

    // Kind 6: Repost
    if (event.kind === 6) {
      if (state.deletedEventIds[event.id]) return
      const targetId = event.tags.find((t) => t[0] === 'e' && t[1])?.[1]
      // Also parse embedded reposted note ONLY if its cryptographic signature verifies
      if (event.content && event.content.startsWith('{')) {
        try {
          const inner = JSON.parse(event.content) as Event
          if (inner?.id && inner?.pubkey && inner?.kind === 1 && verifyEvent(inner)) {
            if (!state.events[inner.id]) {
              set((s) => ({ events: { ...s.events, [inner.id]: inner } }))
            }
          }
        } catch {
          // ignore invalid or forged embedded JSON
        }
      }
      if (!targetId || repostSeen.has(event.id)) return
      repostSeen.add(event.id)
      set((s) => {
        const isMine = Boolean(myPubkey && event.pubkey.toLowerCase() === myPubkey)
        const existingMine = s.userRepostIds[targetId] || []
        return {
          events: { ...s.events, [event.id]: event },
          repostCounts: {
            ...s.repostCounts,
            [targetId]: (s.repostCounts[targetId] || 0) + 1,
          },
          userRepostIds: isMine
            ? {
                ...s.userRepostIds,
                [targetId]: existingMine.includes(event.id)
                  ? existingMine
                  : [...existingMine, event.id],
              }
            : s.userRepostIds,
        }
      })
      return
    }

    // Kind 9735: Zap receipt
    if (event.kind === 9735) {
      if (zapSeen.has(event.id)) return
      zapSeen.add(event.id)
      const targetId = event.tags.find((t) => t[0] === 'e' && t[1])?.[1]
      const bolt11 = event.tags.find((t) => t[0] === 'bolt11' && t[1])?.[1]
      if (!targetId || !bolt11) return
      const sats = parseBolt11Sats(bolt11)
      if (sats <= 0) return
      set((s) => ({
        events: { ...s.events, [event.id]: event },
        zapTotalsSats: {
          ...s.zapTotalsSats,
          [targetId]: (s.zapTotalsSats[targetId] || 0) + sats,
        },
      }))
      return
    }

    // Standard notes / gallery / comments
    if (!state.events[event.id]) {
      set((s) => ({ events: { ...s.events, [event.id]: event } }))
    }
  },

  fetchProfiles: async (pubkeys) => {
    const existing = get().profiles
    const needed = [...new Set(pubkeys.map((p) => p.toLowerCase()))].filter(
      (p) => !existing[p] && !requestedProfiles.has(p),
    )
    if (needed.length === 0) return
    for (const p of needed) requestedProfiles.add(p)

    const relays = useSettingsStore.getState().getReadRelays()
    try {
      const events = await nostrPool.query(
        relays,
        { kinds: [0], authors: needed.slice(0, 100) },
        3500,
      )
      for (const ev of events) {
        get().ingestEvent(ev)
      }
    } catch {
      // ignore
    }
  },

  loadUserGraph: async (pubkey) => {
    const relays = useSettingsStore.getState().getReadRelays()
    const [contactEvents, bookmarkEvents, relayListEvents] = await Promise.all([
      nostrPool.query(relays, { kinds: [3], authors: [pubkey], limit: 3 }, 4000),
      nostrPool.query(relays, { kinds: [10003], authors: [pubkey], limit: 2 }, 3500),
      nostrPool.query(relays, { kinds: [10002], authors: [pubkey], limit: 2 }, 3500),
    ])

    if (relayListEvents.length > 0) {
      const nip65Read: string[] = []
      const nip65Write: string[] = []
      for (const t of relayListEvents[0].tags) {
        if (t[0] !== 'r' || !t[1]) continue
        const clean = sanitizeRelayUrl(t[1])
        if (!clean) continue
        const marker = t[2]
        if (!marker || marker === 'read') nip65Read.push(clean)
        if (!marker || marker === 'write') nip65Write.push(clean)
      }
      set({
        userReadRelays: [...new Set(nip65Read)].slice(0, 10),
        userWriteRelays: [...new Set(nip65Write)].slice(0, 10),
      })
    }

    if (contactEvents.length > 0) {
      const latest = contactEvents[0]
      const follows = [
        ...new Set(
          latest.tags
            .filter((t) => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]))
            .map((t) => t[1].toLowerCase()),
        ),
      ]
      set({ follows })
      void get().fetchProfiles([pubkey, ...follows.slice(0, 60)])
    } else {
      void get().fetchProfiles([pubkey])
    }

    if (bookmarkEvents.length > 0) {
      const remoteIds = bookmarkEvents[0].tags
        .filter((t) => t[0] === 'e' && t[1])
        .map((t) => t[1])
      const merged = [...new Set([...remoteIds, ...get().bookmarks])]
      set({ bookmarks: merged })
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(merged))
      }
    }
  },

  loadExtendedNetwork: async () => {
    const existing = get().extendedAuthors
    if (existing.length > 0 || get().loadingExtendedGraph) return existing
    const follows = get().follows
    if (follows.length === 0) return []
    set({ loadingExtendedGraph: true })
    try {
      const relays = useSettingsStore.getState().getReadRelays()
      // Sample up to 60 direct follows' kind-3 contact lists and keep 2-hop pubkeys endorsed by >= 3 follows
      const sample = follows.slice(0, 60)
      const contactLists = await nostrPool.query(
        relays,
        { kinds: [3], authors: sample, limit: sample.length * 2 },
        4500,
      )
      const latestByAuthor = new Map<string, Event>()
      for (const ev of contactLists) {
        const prev = latestByAuthor.get(ev.pubkey)
        if (!prev || ev.created_at > prev.created_at) {
          latestByAuthor.set(ev.pubkey, ev)
        }
      }
      const followSet = new Set(follows)
      const myPubkey = useAuthStore.getState().pubkey?.toLowerCase()
      const votes = new Map<string, number>()
      for (const ev of latestByAuthor.values()) {
        const seenInList = new Set<string>()
        for (const t of ev.tags) {
          if (t[0] !== 'p' || !t[1] || !/^[0-9a-f]{64}$/i.test(t[1])) continue
          const pk = t[1].toLowerCase()
          if (seenInList.has(pk) || followSet.has(pk) || pk === myPubkey) continue
          seenInList.add(pk)
          votes.set(pk, (votes.get(pk) || 0) + 1)
        }
      }
      const minVotes = sample.length >= 15 ? 3 : 2
      const qualified = [...votes.entries()]
        .filter(([, count]) => count >= minVotes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 200)
        .map(([pk]) => pk)
      set({ extendedAuthors: qualified })
      return qualified
    } finally {
      set({ loadingExtendedGraph: false })
    }
  },

  subscribeFeed: (tab) => {
    set({ loadingFeed: true })
    const readRelays = useSettingsStore.getState().getReadRelays()
    const userReadRelays = get().userReadRelays
    const mergedFollowingRelays = [...new Set([...readRelays, ...userReadRelays])].slice(0, 10)
    const targetRelays =
      tab === 'firewisp'
        ? [FIREWISP_RELAY]
        : tab === 'trending'
          ? [TRENDING_RELAY]
          : tab === 'global'
            ? CURATED_EXPLORE_RELAYS
            : mergedFollowingRelays
    const follows = get().follows
    const extendedAuthors = get().extendedAuthors
    const myPubkey = useAuthStore.getState().pubkey

    if (tab === 'following' && !myPubkey) {
      set({ loadingFeed: false })
      return () => {}
    }

    if (tab === 'extended' && extendedAuthors.length === 0) {
      if (follows.length > 0) {
        void get().loadExtendedNetwork()
      } else {
        set({ loadingFeed: false })
      }
      return () => {}
    }

    const allowedFollowingAuthors =
      tab === 'following'
        ? new Set(
            [...(myPubkey ? [myPubkey.toLowerCase()] : []), ...follows.map((p) => p.toLowerCase())],
          )
        : null
    const allowedExtendedAuthors =
      tab === 'extended'
        ? new Set(extendedAuthors.map((p) => p.toLowerCase()))
        : null

    const authorBatch = new Set<string>()
    let batchTimer: ReturnType<typeof setTimeout> | null = null

    const flushAuthors = () => {
      if (authorBatch.size === 0) return
      const list = [...authorBatch]
      authorBatch.clear()
      void get().fetchProfiles(list)
    }

    const handleEvent = (ev: Event) => {
      // STRICT AUTHOR GATE: never allow buggy relays or race conditions to leak unfollowed spam into Follows/Extended
      if (allowedFollowingAuthors && !allowedFollowingAuthors.has(ev.pubkey.toLowerCase())) {
        return
      }
      if (allowedExtendedAuthors && !allowedExtendedAuthors.has(ev.pubkey.toLowerCase())) {
        return
      }

      get().ingestEvent(ev)
      authorBatch.add(ev.pubkey)
      if (!batchTimer) {
        batchTimer = setTimeout(() => {
          batchTimer = null
          flushAuthors()
        }, 400)
      }

      if (ev.kind === 1 || ev.kind === 20 || ev.kind === 21 || ev.kind === 22 || ev.kind === 6) {
        set((s) => {
          const eventsMap = { ...s.events, [ev.id]: ev }
          if (tab === 'firewisp') {
            return {
              events: eventsMap,
              firewispFeedIds: insertSortedUnique(s.firewispFeedIds, ev, eventsMap),
            }
          }
          if (tab === 'following') {
            return {
              events: eventsMap,
              followingFeedIds: insertSortedUnique(s.followingFeedIds, ev, eventsMap),
            }
          }
          if (tab === 'extended') {
            return {
              events: eventsMap,
              extendedFeedIds: insertSortedUnique(s.extendedFeedIds, ev, eventsMap),
            }
          }
          if (tab === 'trending') {
            // Preserve trending relay order (newest/hottest first without letting stale items stick on refresh)
            if (s.trendingFeedIds.includes(ev.id)) return { events: eventsMap }
            const next = [...s.trendingFeedIds, ev.id].slice(0, 150)
            return {
              events: eventsMap,
              trendingFeedIds: next,
            }
          }
          return {
            events: eventsMap,
            globalFeedIds: insertSortedUnique(s.globalFeedIds, ev, eventsMap),
          }
        })
      }
    }

    // Build filters — chunk large follow lists (e.g. 890+ follows) into batches of 250 authors
    // so EVERY followed account's posts are fetched without hitting per-REQ filter limits.
    const filters = (() => {
      if (tab === 'following') {
        const allAuthors = [...(allowedFollowingAuthors || [])]
        if (allAuthors.length === 0) return []
        const since = Math.floor(Date.now() / 1000) - 3 * 86400
        const chunks: Array<{ kinds: number[]; authors: string[]; since: number; limit: number }> = []
        for (let i = 0; i < Math.min(allAuthors.length, 2000); i += 250) {
          chunks.push({
            kinds: [1, 6, 20, 21, 22],
            authors: allAuthors.slice(i, i + 250),
            since,
            limit: 100,
          })
        }
        return chunks
      }
      if (tab === 'extended') {
        return [{ kinds: [1, 20, 21, 22], authors: extendedAuthors.slice(0, 200), limit: 80 }]
      }
      if (tab === 'trending') {
        // trending.relays.land serves curated kind-1 trending notes directly
        return [{ kinds: [1], limit: 80 }]
      }
      return [{ kinds: [1, 6, 20, 21, 22], limit: 60 }]
    })()

    if (filters.length === 0) {
      set({ loadingFeed: false })
      return () => {}
    }

    let eoseRemaining = filters.length
    const subs: SubCloser[] = filters.map((filter) =>
      nostrPool.subscribe(targetRelays, filter, {
        onevent: handleEvent,
        oneose: () => {
          eoseRemaining--
          if (eoseRemaining > 0) return
          flushAuthors()
          set({ loadingFeed: false })
          const s = get()
          const ids =
            tab === 'firewisp'
              ? s.firewispFeedIds.slice(0, 40)
              : tab === 'following'
                ? s.followingFeedIds.slice(0, 50)
                : tab === 'extended'
                  ? s.extendedFeedIds.slice(0, 40)
                  : tab === 'trending'
                    ? s.trendingFeedIds.slice(0, 40)
                    : s.globalFeedIds.slice(0, 40)
          if (ids.length > 0) {
            void nostrPool
              .query(targetRelays, { kinds: [5, 6, 7, 9735], '#e': ids, limit: 250 }, 3500)
              .then((metaEvents) => {
                for (const m of metaEvents) get().ingestEvent(m)
              })
          }
        },
      }),
    )

    return () => {
      if (batchTimer) clearTimeout(batchTimer)
      for (const s of subs) s.close()
    }
  },

  subscribeNotifications: (pubkey) => {
    const relays = useSettingsStore.getState().getReadRelays()
    const sub = nostrPool.subscribe(
      relays,
      { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: 60 },
      {
        onevent: (ev) => {
          if (ev.pubkey.toLowerCase() === pubkey.toLowerCase()) return
          get().ingestEvent(ev)
          void get().fetchProfiles([ev.pubkey])
          set((s) => ({
            events: { ...s.events, [ev.id]: ev },
            notificationIds: insertSortedUnique(
              s.notificationIds,
              ev,
              { ...s.events, [ev.id]: ev },
            ),
          }))
        },
      },
    )
    return () => sub.close()
  },

  subscribeDms: () => {
    const signer = useAuthStore.getState().signer
    if (!signer || !signer.canEncrypt) return () => {}
    const relays = useSettingsStore.getState().getReadRelays()
    const sub = nostrPool.subscribe(
      relays,
      { kinds: [1059], '#p': [signer.pubkey], limit: 80 },
      {
        onevent: (wrap) => {
          if (seenDmWraps.has(wrap.id)) return
          seenDmWraps.add(wrap.id)
          void unwrapGiftWrap(wrap, signer)
            .then((dm) => {
              if (!dm) return
              void get().fetchProfiles([dm.peerPubkey])
              set((s) => {
                if (s.dms.some((existing) => existing.id === dm.id)) return s
                const next = [...s.dms, dm].sort((a, b) => a.createdAt - b.createdAt)
                return { dms: next }
              })
            })
            .catch(() => {
              // Ignore undecryptable or spoofed wraps fail-closed
            })
        },
      },
    )
    return () => sub.close()
  },

  publishNote: async ({ content, extraTags = [], replyTo, kind = 1 }) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      throw new Error('Sign in with a signing method (NIP-07, Bunker, or key) to publish')
    }
    const settings = useSettingsStore.getState()
    const tags: string[][] = [...extraTags]

    if (replyTo) {
      const rootTag = replyTo.tags.find((t) => t[0] === 'e' && t[3] === 'root')
      if (rootTag) {
        tags.push(['e', rootTag[1], FIREWISP_RELAY, 'root'])
        tags.push(['e', replyTo.id, FIREWISP_RELAY, 'reply'])
      } else {
        tags.push(['e', replyTo.id, FIREWISP_RELAY, 'root'])
      }
      const pSet = new Set<string>([replyTo.pubkey])
      for (const pt of replyTo.tags) {
        if (pt[0] === 'p' && pt[1]) pSet.add(pt[1])
      }
      for (const p of pSet) tags.push(['p', p])
    }

    // Extract #hashtags into `t` tags
    const hashtags = content.match(/#[a-zA-Z0-9_]{1,64}/g) || []
    const tSeen = new Set<string>()
    for (const h of hashtags) {
      const clean = h.slice(1).toLowerCase()
      if (!tSeen.has(clean)) {
        tSeen.add(clean)
        tags.push(['t', clean])
      }
    }

    if (settings.clientTagEnabled) {
      tags.push(['client', CLIENT_TAG_VALUE])
    }

    let unsigned: UnsignedEvent = {
      kind,
      pubkey: signer.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: content.trim(),
    }

    if (settings.notePowEnabled && settings.notePowBits > 0) {
      set({ powBusyMessage: `Mining ${settings.notePowBits}-bit NIP-13 PoW…` })
      try {
        const mined = await minePowAsync(unsigned, settings.notePowBits)
        unsigned = mined.event
      } finally {
        set({ powBusyMessage: null })
      }
    }

    const signed = await signer.signEvent({
      kind: unsigned.kind,
      created_at: unsigned.created_at,
      tags: unsigned.tags,
      content: unsigned.content,
    })

    const writeRelays = [...new Set([...settings.getWriteRelays(), ...get().userWriteRelays])]
    const results = await nostrPool.publish(writeRelays, signed)
    const okCount = results.filter((r) => r.ok).length

    get().ingestEvent(signed)
    set((s) => {
      const eventsMap = { ...s.events, [signed.id]: signed }
      return {
        events: eventsMap,
        firewispFeedIds: insertSortedUnique(s.firewispFeedIds, signed, eventsMap),
        followingFeedIds: insertSortedUnique(s.followingFeedIds, signed, eventsMap),
        globalFeedIds: insertSortedUnique(s.globalFeedIds, signed, eventsMap),
        toastMessage:
          okCount > 0
            ? `Published to ${okCount}/${writeRelays.length} relays`
            : 'Warning: relays did not confirm publish',
      }
    })
    return signed
  },

  toggleLike: async (target) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      return
    }
    if (get().userLiked[target.id]) return
    const settings = useSettingsStore.getState()

    let unsigned: UnsignedEvent = {
      kind: 7,
      pubkey: signer.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', target.id],
        ['p', target.pubkey],
      ],
      content: '+',
    }

    if (settings.reactionPowEnabled && settings.reactionPowBits > 0) {
      set({ powBusyMessage: `Mining ${settings.reactionPowBits}-bit reaction PoW…` })
      try {
        const mined = await minePowAsync(unsigned, settings.reactionPowBits)
        unsigned = mined.event
      } finally {
        set({ powBusyMessage: null })
      }
    }

    const signed = await signer.signEvent({
      kind: unsigned.kind,
      created_at: unsigned.created_at,
      tags: unsigned.tags,
      content: unsigned.content,
    })
    get().ingestEvent(signed)
    const writeRelays = [...new Set([...settings.getWriteRelays(), ...get().userWriteRelays])]
    await nostrPool.publish(writeRelays, signed)
  },

  toggleRepost: async (target) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      return
    }
    const settings = useSettingsStore.getState()
    const writeRelays = [...new Set([...settings.getWriteRelays(), ...get().userWriteRelays])]
    const existingRepostIds = get().userRepostIds[target.id] || []

    // Undo repost via NIP-09 deletion (matching Fire Wisp Android #106!)
    if (existingRepostIds.length > 0) {
      const delEvent = await signer.signEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...existingRepostIds.map((id) => ['e', id]), ['k', '6']],
        content: 'Undo repost',
      })
      get().ingestEvent(delEvent)
      await nostrPool.publish(writeRelays, delEvent)
      set({ toastMessage: 'Repost removed' })
      return
    }

    const tags: string[][] = [
      ['e', target.id, FIREWISP_RELAY],
      ['p', target.pubkey],
    ]
    if (settings.clientTagEnabled) tags.push(['client', CLIENT_TAG_VALUE])

    const repost = await signer.signEvent({
      kind: 6,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify(target),
    })
    get().ingestEvent(repost)
    await nostrPool.publish(writeRelays, repost)
    set({ toastMessage: 'Reposted' })
  },

  toggleFollow: async (targetPubkey) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      return
    }
    const clean = targetPubkey.toLowerCase()
    const current = get().follows
    const next = current.includes(clean)
      ? current.filter((p) => p !== clean)
      : [...current, clean]

    const ev = await signer.signEvent({
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: next.map((p) => ['p', p]),
      content: '',
    })
    set({ follows: next })
    await nostrPool.publish(useSettingsStore.getState().getWriteRelays(), ev)
    set({ toastMessage: current.includes(clean) ? 'Unfollowed' : 'Followed' })
  },

  toggleBookmark: async (eventId) => {
    const current = get().bookmarks
    const next = current.includes(eventId)
      ? current.filter((id) => id !== eventId)
      : [eventId, ...current]
    set({ bookmarks: next })
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next))
    }
    const signer = useAuthStore.getState().signer
    if (signer?.canSign) {
      try {
        const ev = await signer.signEvent({
          kind: 10003,
          created_at: Math.floor(Date.now() / 1000),
          tags: next.map((id) => ['e', id]),
          content: '',
        })
        await nostrPool.publish(useSettingsStore.getState().getWriteRelays(), ev)
      } catch {
        // Local bookmark still saved
      }
    }
  },

  sendDm: async (recipientPubkey, plaintext) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canEncrypt) {
      throw new Error('Your sign-in method does not support NIP-44 encrypted DMs')
    }
    const { recipientWrap, selfWrap, dm } = await createGiftWrappedDm(
      signer,
      recipientPubkey,
      plaintext.trim(),
    )
    const writeRelays = useSettingsStore.getState().getWriteRelays()
    await Promise.all([
      nostrPool.publish(writeRelays, recipientWrap),
      nostrPool.publish(writeRelays, selfWrap),
    ])
    set((s) => ({
      dms: [...s.dms, dm].sort((a, b) => a.createdAt - b.createdAt),
    }))
    return dm
  },
}))
