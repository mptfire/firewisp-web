import { create } from 'zustand'
import { verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import type { SubCloser } from 'nostr-tools/pool'
import { nostrPool, type RelayStatus } from '../nostr/pool'
import { CLIENT_TAG_VALUE, CURATED_EXPLORE_RELAYS, FIREWISP_RELAY, TRENDING_RELAY } from '../constants'
import { sanitizeRelayUrl } from '../sanitize'
import { minePowAsync } from '../crypto/nip13'
import { extractEventHashtags, extractReplyRefs } from '../nostr/content'
import { evaluateNoteSpam, isTopLevelNote } from '../nostr/spamFilter'
import { createGiftWrappedDm, KIND_DM_RELAYS, unwrapGiftWrap, type DecryptedDm } from '../nostr/nip17'
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
const PROFILES_CACHE_KEY = 'firewisp_profiles_cache_v1'
const MAX_CACHED_PROFILES = 400

export type FeedTab = 'foryou' | 'global' | 'trending' | 'firewisp' | 'following' | 'extended'

function loadBookmarks(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function loadCachedProfiles(): Record<string, NostrProfile> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(PROFILES_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, NostrProfile>) : {}
  } catch {
    return {}
  }
}

let profileSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSaveProfiles() {
  if (typeof localStorage === 'undefined') return
  if (profileSaveTimer) return
  profileSaveTimer = setTimeout(() => {
    profileSaveTimer = null
    try {
      const profiles = useNostrStore.getState().profiles
      const entries = Object.entries(profiles)
      const trimmed =
        entries.length > MAX_CACHED_PROFILES
          ? Object.fromEntries(
              entries
                .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
                .slice(0, MAX_CACHED_PROFILES),
            )
          : profiles
      localStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(trimmed))
    } catch {
      // ignore quota errors
    }
  }, 1500)
}

export interface NostrState {
  relayStatuses: Record<string, RelayStatus>
  events: Record<string, Event>
  profiles: Record<string, NostrProfile>
  follows: string[]
  followedHashtags: string[]
  userReadRelays: string[]
  userWriteRelays: string[]
  bookmarks: string[]

  // Social aggregates
  replyCounts: Record<string, number>
  reactionCounts: Record<string, number>
  userLiked: Record<string, boolean>
  repostCounts: Record<string, number>
  // targetEventId -> array of the current user's kind-6 repost event IDs (enables NIP-09 undo repost!)
  userRepostIds: Record<string, string[]>
  deletedEventIds: Record<string, boolean>
  zapTotalsSats: Record<string, number>

  // Feed UI state (persisted across route transitions so Back never resets tab!)
  activeFeedTab: FeedTab
  showRepliesInFollows: boolean

  // Feeds
  forYouFeedIds: string[]
  forYouSuppIds: Record<string, boolean>
  firewispFeedIds: string[]
  followingFeedIds: string[]
  extendedFeedIds: string[]
  trendingFeedIds: string[]
  globalFeedIds: string[]
  pendingFeedIds: Record<FeedTab, string[]>
  extendedAuthors: string[]
  loadingExtendedGraph: boolean
  loadingMore: boolean
  trendingSidebarIds: string[]
  loadingTrends: boolean
  notificationIds: string[]
  dms: DecryptedDm[]

  loadingFeed: boolean
  powBusyMessage: string | null
  toastMessage: string | null

  setToast: (msg: string | null) => void
  setActiveFeedTab: (tab: FeedTab) => void
  setShowRepliesInFollows: (show: boolean) => void
  flushPendingFeed: (tab: FeedTab) => void
  loadOlderFeed: (tab: FeedTab) => Promise<number>
  loadTrendingSidebar: (force?: boolean) => Promise<void>
  initPoolListener: () => () => void
  ingestEvent: (event: Event) => void
  fetchProfiles: (pubkeys: string[]) => Promise<void>
  loadUserGraph: (pubkey: string) => Promise<void>
  loadExtendedNetwork: () => Promise<string[]>
  clearFeedTab: (tab: FeedTab) => void
  resetUserState: () => void
  subscribeFeed: (tab: FeedTab) => () => void
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

// Track last fetch timestamp per pubkey (60s miss cooldown so failed fetches can recover later)
const requestedProfilesAt = new Map<string, number>()
const replySeen = new Set<string>()
const reactionSeen = new Set<string>()
const repostSeen = new Set<string>()
const zapSeen = new Set<string>()
const seenDmWraps = new Set<string>()

function clipStr(val: unknown, maxLen: number): string | undefined {
  return typeof val === 'string' && val.length > 0 ? val.slice(0, maxLen) : undefined
}

function parseProfileEvent(event: Event): NostrProfile | null {
  try {
    const raw = JSON.parse(event.content) as Record<string, unknown>
    return {
      pubkey: event.pubkey,
      name: clipStr(raw.name, 120),
      display_name: clipStr(raw.display_name, 120),
      about: clipStr(raw.about, 1000),
      picture: clipStr(raw.picture, 500),
      banner: clipStr(raw.banner, 500),
      nip05: clipStr(raw.nip05, 200),
      lud16: clipStr(raw.lud16, 200),
      website: clipStr(raw.website, 500),
      updatedAt: event.created_at,
    }
  } catch {
    return null
  }
}

export function parseBolt11Sats(bolt11: string): number {
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

export function parseZapReceiptInfo(ev: Event): { senderPubkey: string; sats: number; comment?: string } {
  const bolt11 = ev.tags.find((t) => t[0] === 'bolt11' && t[1])?.[1]
  const sats = bolt11 ? parseBolt11Sats(bolt11) : 0
  const desc = ev.tags.find((t) => t[0] === 'description' && t[1])?.[1]
  if (desc) {
    try {
      const parsed = JSON.parse(desc) as { pubkey?: unknown; content?: unknown }
      if (typeof parsed.pubkey === 'string' && /^[0-9a-f]{64}$/i.test(parsed.pubkey)) {
        return {
          senderPubkey: parsed.pubkey.toLowerCase(),
          sats,
          comment: typeof parsed.content === 'string' && parsed.content.trim() ? parsed.content.trim() : undefined,
        }
      }
    } catch {
      // fallback to receipt pubkey
    }
  }
  return { senderPubkey: ev.pubkey.toLowerCase(), sats }
}

function insertSortedUnique(ids: string[], ev: Event, eventsMap: Record<string, Event>): string[] {
  if (ids.includes(ev.id)) return ids
  const next = [ev.id, ...ids]
  next.sort((a, b) => (eventsMap[b]?.created_at || 0) - (eventsMap[a]?.created_at || 0))
  return next.slice(0, 500)
}

/** Matches Wisp Android FeedSubscriptionManager dynamic follow window scaling */
function getFollowWindowSeconds(followCount: number): number {
  if (followCount <= 10) return 7 * 86400
  if (followCount <= 30) return 5 * 86400
  if (followCount <= 75) return 3 * 86400
  if (followCount <= 150) return 2 * 86400
  if (followCount <= 300) return 36 * 3600
  return 24 * 3600
}

export const useNostrStore = create<NostrState>((set, get) => ({
  relayStatuses: {},
  events: {},
  profiles: loadCachedProfiles(),
  follows: [],
  followedHashtags: [],
  userReadRelays: [],
  userWriteRelays: [],
  bookmarks: loadBookmarks(),

  replyCounts: {},
  reactionCounts: {},
  userLiked: {},
  repostCounts: {},
  userRepostIds: {},
  deletedEventIds: {},
  zapTotalsSats: {},

  activeFeedTab: 'foryou',
  showRepliesInFollows: false,

  forYouFeedIds: [],
  forYouSuppIds: {},
  firewispFeedIds: [],
  followingFeedIds: [],
  extendedFeedIds: [],
  trendingFeedIds: [],
  globalFeedIds: [],
  pendingFeedIds: {
    foryou: [],
    global: [],
    trending: [],
    firewisp: [],
    following: [],
    extended: [],
  },
  extendedAuthors: [],
  loadingExtendedGraph: false,
  loadingMore: false,
  trendingSidebarIds: [],
  loadingTrends: false,
  notificationIds: [],
  dms: [],

  loadingFeed: false,
  powBusyMessage: null,
  toastMessage: null,

  setToast: (toastMessage) => set({ toastMessage }),
  setActiveFeedTab: (activeFeedTab) => set({ activeFeedTab }),
  setShowRepliesInFollows: (showRepliesInFollows) => set({ showRepliesInFollows }),

  flushPendingFeed: (tab) => {
    set((s) => {
      const pending = s.pendingFeedIds[tab]
      if (!pending || pending.length === 0) return s
      const mergeInto = (current: string[]) => {
        const merged = [...new Set([...pending, ...current])]
        merged.sort((a, b) => (s.events[b]?.created_at || 0) - (s.events[a]?.created_at || 0))
        return merged.slice(0, 500)
      }
      const nextPending = { ...s.pendingFeedIds, [tab]: [] }
      if (tab === 'foryou') {
        return { forYouFeedIds: mergeInto(s.forYouFeedIds), pendingFeedIds: nextPending }
      }
      if (tab === 'firewisp') {
        return { firewispFeedIds: mergeInto(s.firewispFeedIds), pendingFeedIds: nextPending }
      }
      if (tab === 'following') {
        return { followingFeedIds: mergeInto(s.followingFeedIds), pendingFeedIds: nextPending }
      }
      if (tab === 'extended') {
        return { extendedFeedIds: mergeInto(s.extendedFeedIds), pendingFeedIds: nextPending }
      }
      if (tab === 'trending') {
        return {
          trendingFeedIds: [...new Set([...pending, ...s.trendingFeedIds])].slice(0, 200),
          pendingFeedIds: nextPending,
        }
      }
      return { globalFeedIds: mergeInto(s.globalFeedIds), pendingFeedIds: nextPending }
    })
  },

  clearFeedTab: (tab) => {
    set((s) => {
      const nextPending = { ...s.pendingFeedIds, [tab]: [] }
      if (tab === 'foryou') return { forYouFeedIds: [], forYouSuppIds: {}, pendingFeedIds: nextPending }
      if (tab === 'firewisp') return { firewispFeedIds: [], pendingFeedIds: nextPending }
      if (tab === 'following') return { followingFeedIds: [], pendingFeedIds: nextPending }
      if (tab === 'extended') return { extendedFeedIds: [], pendingFeedIds: nextPending }
      if (tab === 'trending') return { trendingFeedIds: [], pendingFeedIds: nextPending }
      return { globalFeedIds: [], pendingFeedIds: nextPending }
    })
  },

  resetUserState: () => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(PROFILES_CACHE_KEY)
      } catch {
        // ignore
      }
    }
    set((s) => ({
      follows: [],
      followedHashtags: [],
      userReadRelays: [],
      userWriteRelays: [],
      forYouFeedIds: [],
      forYouSuppIds: {},
      followingFeedIds: [],
      extendedFeedIds: [],
      extendedAuthors: [],
      pendingFeedIds: { ...s.pendingFeedIds, foryou: [], following: [], extended: [] },
      notificationIds: [],
      dms: [],
    }))
  },

  initPoolListener: () => {
    return nostrPool.onStatusChange((relayStatuses) => set({ relayStatuses }))
  },

  isEventMuted: (event) => {
    const { mutedPubkeys, mutedHashtags, mutedWords } = useSettingsStore.getState()
    if (mutedPubkeys.includes(event.pubkey.toLowerCase())) return true
    if (mutedHashtags.length > 0) {
      const tags = extractEventHashtags(event)
      if (tags.some((t) => mutedHashtags.includes(t))) return true
    }
    if (mutedWords && mutedWords.length > 0 && event.content) {
      const lower = event.content.toLowerCase()
      if (mutedWords.some((w) => w.length >= 2 && lower.includes(w))) return true
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
      set((s) => {
        const nextProfiles = { ...s.profiles, [event.pubkey]: parsed }
        scheduleSaveProfiles()
        return { profiles: nextProfiles }
      })
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

    // Standard notes / gallery / comments — also count replies cleanly
    if ((event.kind === 1 || event.kind === 1111) && !replySeen.has(event.id)) {
      const refs = extractReplyRefs(event)
      const directTarget = refs.replyId || refs.rootId
      if (directTarget) {
        replySeen.add(event.id)
        set((s) => ({
          events: s.events[event.id] ? s.events : { ...s.events, [event.id]: event },
          replyCounts: {
            ...s.replyCounts,
            [directTarget]: (s.replyCounts[directTarget] || 0) + 1,
          },
        }))
        return
      }
    }

    if (!state.events[event.id]) {
      set((s) => ({ events: { ...s.events, [event.id]: event } }))
    }
  },

  fetchProfiles: async (pubkeys) => {
    const existing = get().profiles
    const now = Date.now()
    const needed = [...new Set(pubkeys.map((p) => p.toLowerCase()))].filter((p) => {
      if (existing[p]) return false
      const lastTry = requestedProfilesAt.get(p)
      // Allow retrying profile misses after 60s
      return !lastTry || now - lastTry > 60_000
    })
    if (needed.length === 0) return
    for (const p of needed) requestedProfilesAt.set(p, now)

    const relays = [
      ...new Set([
        ...useSettingsStore.getState().getReadRelays(),
        ...get().userReadRelays,
      ]),
    ].slice(0, 8)
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
    const [contactEvents, bookmarkEvents, relayListEvents, interestEvents, muteEvents] = await Promise.all([
      nostrPool.query(relays, { kinds: [3], authors: [pubkey], limit: 3 }, 4000),
      nostrPool.query(relays, { kinds: [10003], authors: [pubkey], limit: 2 }, 3500),
      nostrPool.query(relays, { kinds: [10002], authors: [pubkey], limit: 2 }, 3500),
      nostrPool.query(relays, { kinds: [10015, 30015], authors: [pubkey], limit: 25 }, 3500),
      nostrPool.query(relays, { kinds: [10000], authors: [pubkey], limit: 2 }, 3500),
    ])

    // Sync NIP-51 kind-10000 mute list (public + NIP-44 private encrypted tags, matching Wisp Android!)
    if (muteEvents.length > 0) {
      const latestMute = muteEvents[0]
      const allMuteTags: string[][] = [...latestMute.tags]
      if (latestMute.content) {
        const signer = useAuthStore.getState().signer
        if (signer?.canEncrypt) {
          try {
            const decrypted = await signer.nip44Decrypt(pubkey, latestMute.content)
            const parsed = JSON.parse(decrypted) as unknown
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (Array.isArray(item) && item.every((x) => typeof x === 'string')) {
                  allMuteTags.push(item as string[])
                }
              }
            }
          } catch {
            // Encrypted with legacy NIP-04 or signer declined — keep public tags cleanly
          }
        }
      }
      const pubkeys: string[] = []
      const hashtags: string[] = []
      const words: string[] = []
      for (const t of allMuteTags) {
        if (t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1])) pubkeys.push(t[1].toLowerCase())
        else if (t[0] === 't' && t[1]) hashtags.push(t[1])
        else if (t[0] === 'word' && t[1]) words.push(t[1])
      }
      if (pubkeys.length > 0 || hashtags.length > 0 || words.length > 0) {
        useSettingsStore.getState().mergeRemoteMutes({ pubkeys, hashtags, words })
      }
    }

    if (interestEvents.length > 0) {
      const tagSet = new Set<string>()
      for (const ev of interestEvents) {
        for (const t of ev.tags) {
          if (t[0] === 't' && t[1]) {
            const clean = t[1].trim().toLowerCase().replace(/^#/, '')
            if (clean) tagSet.add(clean)
          }
        }
      }
      set({ followedHashtags: [...tagSet].slice(0, 40) })
    }

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
      // Clear any signed-out For You notes when the user's real follow graph arrives
      set({ follows, forYouFeedIds: [], forYouSuppIds: {} })
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

  loadTrendingSidebar: async (force = false) => {
    if (get().loadingTrends) return
    if (!force && get().trendingSidebarIds.length > 0) return
    set({ loadingTrends: true })
    try {
      const trendingRaw = await nostrPool.query([TRENDING_RELAY], { kinds: [1], limit: 120 }, 4500)
      if (trendingRaw.length === 0) return

      // Pick top 6 Trending Posts (distinct authors, non-spam, readable text or media)
      const hotSeenContent = new Map<string, Set<string>>()
      const hotAuthors = new Set<string>()
      const hotPosts: Event[] = []
      for (const ev of trendingRaw) {
        if (!isTopLevelNote(ev) || get().isEventMuted(ev)) continue
        const pk = ev.pubkey.toLowerCase()
        if (hotAuthors.has(pk)) continue
        const verdict = evaluateNoteSpam(ev, { seenContentAuthors: hotSeenContent, maxPerAuthor: 1 })
        if (verdict.isSpam) continue
        const textOnly = ev.content
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/nostr:[0-9a-z]+/gi, '')
          .trim()
        const hasMedia = /https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|avif|mp4|webm)/i.test(ev.content)
        if (textOnly.length < 20 && !hasMedia) continue
        hotAuthors.add(pk)
        hotPosts.push(ev)
        if (hotPosts.length >= 6) break
      }

      for (const ev of hotPosts) get().ingestEvent(ev)
      if (hotPosts.length > 0) {
        void get().fetchProfiles(hotPosts.map((e) => e.pubkey))
        const hotIds = hotPosts.map((e) => e.id)
        const metaRelays = [...new Set([...useSettingsStore.getState().getReadRelays(), TRENDING_RELAY])].slice(0, 6)
        void nostrPool
          .query(metaRelays, { kinds: [1, 6, 7, 9735], '#e': hotIds, limit: 200 }, 3500)
          .then((meta) => {
            for (const m of meta) get().ingestEvent(m)
          })
      }

      set((s) => {
        const eventsMap = { ...s.events }
        for (const ev of hotPosts) eventsMap[ev.id] = ev
        return {
          events: eventsMap,
          trendingSidebarIds: hotPosts.map((e) => e.id),
        }
      })
    } finally {
      set({ loadingTrends: false })
    }
  },

  loadOlderFeed: async (tab) => {
    if (get().loadingMore) return 0
    const s = get()
    const currentIds =
      tab === 'foryou'
        ? s.forYouFeedIds
        : tab === 'firewisp'
          ? s.firewispFeedIds
          : tab === 'following'
            ? s.followingFeedIds
            : tab === 'extended'
              ? s.extendedFeedIds
              : tab === 'trending'
                ? s.trendingFeedIds
                : s.globalFeedIds
    if (currentIds.length === 0) return 0

    let oldest = Math.floor(Date.now() / 1000)
    for (const id of currentIds) {
      const ts = s.events[id]?.created_at
      if (ts && ts < oldest) oldest = ts
    }
    const until = oldest - 1
    if (until <= 0) return 0

    const readRelays = useSettingsStore.getState().getReadRelays()
    const mergedFollowingRelays = [...new Set([...readRelays, ...s.userReadRelays])].slice(0, 10)
    const targetRelays =
      tab === 'firewisp'
        ? [FIREWISP_RELAY]
        : tab === 'trending'
          ? [TRENDING_RELAY]
          : tab === 'global'
            ? CURATED_EXPLORE_RELAYS
            : mergedFollowingRelays

    const myPubkey = useAuthStore.getState().pubkey
    set({ loadingMore: true })
    try {
      let fetched: Event[] = []
      if (tab === 'foryou') {
        if (myPubkey && s.follows.length > 0) {
          const allAuthors = [
            ...new Set([
              myPubkey.toLowerCase(),
              ...s.follows.map((p) => p.toLowerCase()),
              ...s.extendedAuthors.slice(0, 150).map((p) => p.toLowerCase()),
            ]),
          ]
          const queries: Promise<Event[]>[] = []
          for (let i = 0; i < Math.min(allAuthors.length, 2000); i += 250) {
            queries.push(
              nostrPool.query(
                mergedFollowingRelays,
                { kinds: [1, 6, 20, 21, 22], authors: allAuthors.slice(i, i + 250), until, limit: 35 },
                4500,
              ),
            )
          }
          const results = await Promise.all(queries)
          fetched = results.flat()
        } else {
          fetched = await nostrPool.query(
            CURATED_EXPLORE_RELAYS,
            { kinds: [1, 6, 20, 21, 22], until, limit: 50 },
            4500,
          )
        }
      } else if (tab === 'following') {
        const allAuthors = [...new Set([...(myPubkey ? [myPubkey.toLowerCase()] : []), ...s.follows.map((p) => p.toLowerCase())])]
        const allowed = new Set(allAuthors)
        const queries: Promise<Event[]>[] = []
        for (let i = 0; i < Math.min(allAuthors.length, 2000); i += 250) {
          queries.push(
            nostrPool.query(
              targetRelays,
              { kinds: [1, 6, 20, 21, 22], authors: allAuthors.slice(i, i + 250), until, limit: 40 },
              4500,
            ),
          )
        }
        const results = await Promise.all(queries)
        fetched = results.flat().filter((ev) => allowed.has(ev.pubkey.toLowerCase()))
      } else if (tab === 'extended') {
        const allowed = new Set(s.extendedAuthors.map((p) => p.toLowerCase()))
        const res = await nostrPool.query(
          targetRelays,
          { kinds: [1, 20, 21, 22], authors: s.extendedAuthors.slice(0, 200), until, limit: 50 },
          4500,
        )
        fetched = res.filter((ev) => allowed.has(ev.pubkey.toLowerCase()))
      } else {
        fetched = await nostrPool.query(
          targetRelays,
          { kinds: tab === 'trending' ? [1] : [1, 6, 20, 21, 22], until, limit: 50 },
          4500,
        )
      }

      let added = 0
      const authors = new Set<string>()
      for (const ev of fetched) {
        get().ingestEvent(ev)
        authors.add(ev.pubkey)
      }
      if (authors.size > 0) void get().fetchProfiles([...authors])

      // Background-fetch engagement counts for the older batch
      const olderIds = fetched.slice(0, 40).map((e) => e.id)
      if (olderIds.length > 0) {
        void nostrPool
          .query(targetRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': olderIds, limit: 250 }, 3500)
          .then((metaEvents) => {
            for (const m of metaEvents) get().ingestEvent(m)
          })
      }

      set((st) => {
        const eventsMap = { ...st.events }
        for (const ev of fetched) eventsMap[ev.id] = ev
        const mergeOlder = (ids: string[]) => {
          const existing = new Set(ids)
          const fresh = fetched.map((e) => e.id).filter((id) => !existing.has(id))
          added = fresh.length
          const merged = [...ids, ...fresh]
          merged.sort((a, b) => (eventsMap[b]?.created_at || 0) - (eventsMap[a]?.created_at || 0))
          return merged.slice(0, 800)
        }
        if (tab === 'foryou') return { events: eventsMap, forYouFeedIds: mergeOlder(st.forYouFeedIds) }
        if (tab === 'firewisp') return { events: eventsMap, firewispFeedIds: mergeOlder(st.firewispFeedIds) }
        if (tab === 'following') return { events: eventsMap, followingFeedIds: mergeOlder(st.followingFeedIds) }
        if (tab === 'extended') return { events: eventsMap, extendedFeedIds: mergeOlder(st.extendedFeedIds) }
        if (tab === 'trending') return { events: eventsMap, trendingFeedIds: mergeOlder(st.trendingFeedIds) }
        return { events: eventsMap, globalFeedIds: mergeOlder(st.globalFeedIds) }
      })

      return added
    } finally {
      set({ loadingMore: false })
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
    const followedHashtags = get().followedHashtags
    const extendedAuthors = get().extendedAuthors
    const myPubkey = useAuthStore.getState().pubkey

    if (tab === 'following' && !myPubkey) {
      set({ loadingFeed: false })
      return () => {}
    }

    // While signed in and waiting for kind-3 follows to load, NEVER fall back to global explore!
    if ((tab === 'foryou' || tab === 'following') && myPubkey && follows.length === 0) {
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

    const allowedForYouAuthors =
      tab === 'foryou' && myPubkey && follows.length > 0
        ? new Set([
            myPubkey.toLowerCase(),
            ...follows.map((p) => p.toLowerCase()),
            ...extendedAuthors.slice(0, 150).map((p) => p.toLowerCase()),
          ])
        : null
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

    let initialEoseDone = false
    const handleEvent = (ev: Event) => {
      // STRICT AUTHOR GATE: never allow buggy relays or race conditions to leak unfollowed spam into For You/Follows/Extended
      if (allowedForYouAuthors && !allowedForYouAuthors.has(ev.pubkey.toLowerCase())) {
        return
      }
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
          const existingList =
            tab === 'foryou'
              ? s.forYouFeedIds
              : tab === 'firewisp'
                ? s.firewispFeedIds
                : tab === 'following'
                  ? s.followingFeedIds
                  : tab === 'extended'
                    ? s.extendedFeedIds
                    : tab === 'trending'
                      ? s.trendingFeedIds
                      : s.globalFeedIds

          // After initial EOSE, buffer newer live notes into pendingFeedIds so reading doesn't jump scroll!
          if (initialEoseDone && existingList.length > 0 && !existingList.includes(ev.id)) {
            const topTs = eventsMap[existingList[0]]?.created_at || 0
            if (ev.created_at > topTs) {
              const curPending = s.pendingFeedIds[tab] || []
              if (curPending.includes(ev.id)) return { events: eventsMap }
              return {
                events: eventsMap,
                pendingFeedIds: {
                  ...s.pendingFeedIds,
                  [tab]: [ev.id, ...curPending].slice(0, 100),
                },
              }
            }
          }

          if (tab === 'foryou') {
            return {
              events: eventsMap,
              forYouFeedIds: insertSortedUnique(s.forYouFeedIds, ev, eventsMap),
            }
          }
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
      if (tab === 'foryou') {
        const since = Math.floor(Date.now() / 1000) - getFollowWindowSeconds(follows.length)
        if (myPubkey && follows.length > 0) {
          // Match Wisp Android: use Extended authors ONLY if already computed, otherwise direct Follows
          const blendedAuthors = [
            ...new Set([
              myPubkey.toLowerCase(),
              ...follows.map((p) => p.toLowerCase()),
              ...extendedAuthors.slice(0, 150).map((p) => p.toLowerCase()),
            ]),
          ]
          const chunks: Array<{ kinds: number[]; authors: string[]; since: number; limit: number }> = []
          for (let i = 0; i < Math.min(blendedAuthors.length, 2000); i += 250) {
            chunks.push({
              kinds: [1, 6, 20, 21, 22],
              authors: blendedAuthors.slice(i, i + 250),
              since,
              limit: 40,
            })
          }
          return chunks
        }
        return [{ kinds: [1, 6, 20, 21, 22], limit: 40 }]
      }
      if (tab === 'following') {
        const allAuthors = [...(allowedFollowingAuthors || [])]
        if (allAuthors.length === 0) return []
        const since = Math.floor(Date.now() / 1000) - getFollowWindowSeconds(follows.length)
        const chunks: Array<{ kinds: number[]; authors: string[]; since: number; limit: number }> = []
        for (let i = 0; i < Math.min(allAuthors.length, 2000); i += 250) {
          chunks.push({
            kinds: [1, 6, 20, 21, 22],
            authors: allAuthors.slice(i, i + 250),
            since,
            limit: 60,
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
    let eoseHandled = false
    const finishInitialLoad = () => {
      if (eoseHandled) return
      eoseHandled = true
      initialEoseDone = true
      flushAuthors()
      set({ loadingFeed: false })
      const s = get()
      const ids =
        tab === 'foryou'
          ? s.forYouFeedIds.slice(0, 50)
          : tab === 'firewisp'
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
          .query(targetRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': ids, limit: 300 }, 3500)
          .then((metaEvents) => {
            for (const m of metaEvents) get().ingestEvent(m)
          })
      }
    }

    // Safety timeout so a single stalled relay never leaves the feed skeleton stuck
    const eoseFallbackTimer = setTimeout(finishInitialLoad, 6000)

    const primaryRelays =
      tab === 'foryou' && (!myPubkey || follows.length === 0) ? CURATED_EXPLORE_RELAYS : targetRelays

    const subs: SubCloser[] = filters.map((filter) =>
      nostrPool.subscribe(primaryRelays, filter, {
        onevent: handleEvent,
        oneose: () => {
          eoseRemaining--
          if (eoseRemaining > 0) return
          clearTimeout(eoseFallbackTimer)
          finishInitialLoad()
        },
      }),
    )

    // Wisp Android For You supplementary sources: strictly spam-filtered Trending (24h, max 10)
    // + followed NIP-51 hashtags queried ONLY from curated anti-spam relays (max 10)
    let cancelled = false
    if (tab === 'foryou') {
      const since24h = Math.floor(Date.now() / 1000) - 86400
      const suppSeenContent = new Map<string, Set<string>>()
      const suppAuthorCounts = new Map<string, number>()
      const filterCleanSupp = (evs: Event[], cap: number) => {
        const out: Event[] = []
        for (const e of evs) {
          if (e.created_at < since24h) continue
          if (!isTopLevelNote(e)) continue
          if (get().isEventMuted(e)) continue
          if (extractEventHashtags(e).length > 4) continue
          const textOnly = e.content
            .replace(/https?:\/\/[^\s]+/gi, '')
            .replace(/nostr:[0-9a-z]+/gi, '')
            .trim()
          if (textOnly.length < 30) continue
          const verdict = evaluateNoteSpam(e, {
            myPubkey,
            follows: allowedForYouAuthors || undefined,
            seenContentAuthors: suppSeenContent,
            authorCounts: suppAuthorCounts,
            maxPerAuthor: 1,
          })
          // Zero-tolerance on supplementary non-follow picks (score must be <= 0)
          if (verdict.isSpam || verdict.score > 0) continue
          out.push(e)
          if (out.length >= cap) break
        }
        return out
      }

      const trendingPromise = nostrPool
        .query([TRENDING_RELAY], { kinds: [1], limit: 20 }, 4000)
        .then((evs) => filterCleanSupp(evs, 5))

      const hashtagQueries: Promise<Event[]>[] = []
      if (followedHashtags.length > 0) {
        const curatedTagRelays = ['wss://nostr.wine', FIREWISP_RELAY]
        for (let i = 0; i < Math.min(followedHashtags.length, 20); i += 10) {
          hashtagQueries.push(
            nostrPool
              .query(
                curatedTagRelays,
                { kinds: [1], '#t': followedHashtags.slice(i, i + 10), since: since24h, limit: 20 },
                4500,
              )
              .then((evs) => filterCleanSupp(evs, 5)),
          )
        }
      }

      const signedOutFallback = !myPubkey
        ? [nostrPool.query([FIREWISP_RELAY], { kinds: [1, 20, 21, 22], limit: 20 }, 3500)]
        : []

      void Promise.allSettled([trendingPromise, ...hashtagQueries, ...signedOutFallback]).then((results) => {
        if (cancelled) return
        const suppEvents: Event[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') suppEvents.push(...r.value)
        }
        if (suppEvents.length === 0) return
        const suppAuthors = new Set<string>()
        for (const ev of suppEvents) {
          get().ingestEvent(ev)
          suppAuthors.add(ev.pubkey)
        }
        if (suppAuthors.size > 0) void get().fetchProfiles([...suppAuthors])
        set((st) => {
          const eventsMap = { ...st.events }
          const nextSuppIds = { ...st.forYouSuppIds }
          let nextIds = st.forYouFeedIds
          for (const ev of suppEvents) {
            eventsMap[ev.id] = ev
            nextSuppIds[ev.id] = true
            nextIds = insertSortedUnique(nextIds, ev, eventsMap)
          }
          return { events: eventsMap, forYouFeedIds: nextIds, forYouSuppIds: nextSuppIds }
        })
      })
    }

    return () => {
      cancelled = true
      clearTimeout(eoseFallbackTimer)
      if (batchTimer) clearTimeout(batchTimer)
      for (const s of subs) s.close()
    }
  },

  subscribeNotifications: (pubkey) => {
    const relays = [
      ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
    ].slice(0, 10)
    const sub = nostrPool.subscribe(
      relays,
      { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: 60 },
      {
        onevent: (ev) => {
          const actorPubkey =
            ev.kind === 9735 ? parseZapReceiptInfo(ev).senderPubkey : ev.pubkey.toLowerCase()
          if (actorPubkey === pubkey.toLowerCase()) return
          get().ingestEvent(ev)
          void get().fetchProfiles([actorPubkey])
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
    const relays = [
      ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
    ].slice(0, 10)
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
        forYouFeedIds: insertSortedUnique(s.forYouFeedIds, signed, eventsMap),
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

    const wasFollowing = current.includes(clean)
    try {
      const ev = await signer.signEvent({
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: next.map((p) => ['p', p]),
        content: '',
      })
      set({ follows: next })
      const writeRelays = [
        ...new Set([...useSettingsStore.getState().getWriteRelays(), ...get().userWriteRelays]),
      ]
      await nostrPool.publish(writeRelays, ev)
      set({ toastMessage: wasFollowing ? 'Unfollowed' : 'Followed' })
    } catch (err) {
      set({
        toastMessage: err instanceof Error ? err.message : 'Failed to update follow list',
      })
    }
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
        const writeRelays = [...new Set([...useSettingsStore.getState().getWriteRelays(), ...get().userWriteRelays])]
        await nostrPool.publish(writeRelays, ev)
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
    const writeRelays = [...new Set([...useSettingsStore.getState().getWriteRelays(), ...get().userWriteRelays])]
    // Resolve recipient's NIP-17 kind-10050 DM inbox relays so encrypted wraps route privately & reliably
    let recipientRelays = writeRelays
    try {
      const readRelays = [...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays])].slice(0, 6)
      const dmRelayEvents = await nostrPool.query(
        readRelays,
        { kinds: [KIND_DM_RELAYS], authors: [recipientPubkey.toLowerCase()], limit: 2 },
        2500,
      )
      if (dmRelayEvents.length > 0) {
        const inbox = dmRelayEvents[0].tags
          .filter((t) => t[0] === 'relay' && t[1])
          .map((t) => sanitizeRelayUrl(t[1]))
          .filter((u): u is string => Boolean(u))
        if (inbox.length > 0) recipientRelays = [...new Set(inbox)].slice(0, 6)
      }
    } catch {
      // Fallback cleanly to writeRelays
    }
    await Promise.all([
      nostrPool.publish(recipientRelays, recipientWrap),
      nostrPool.publish(writeRelays, selfWrap),
    ])
    set((s) => ({
      dms: [...s.dms, dm].sort((a, b) => a.createdAt - b.createdAt),
    }))
    return dm
  },
}))
