import { create } from 'zustand'
import { verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import type { SubCloser } from 'nostr-tools/pool'
import { nostrPool, type RelayStatus } from '../nostr/pool'
import { CLIENT_TAG_VALUE, CURATED_EXPLORE_RELAYS, DEFAULT_RELAYS, FIREWISP_RELAY, TRENDING_RELAY, type RelayEntry } from '../constants'
import { sanitizePublicRelayUrl } from '../sanitize'
import { minePowAsync } from '../crypto/nip13'
import { extractEventHashtags, extractReplyRefs } from '../nostr/content'
import {
  applyMuteListMutations,
  buildBud03BlossomListTags,
  buildNip65RelayListTags,
  computeNextReplaceableCreatedAt,
  decryptMuteListContent,
  encryptMuteListTags,
  extractMuteItemsFromTags,
  KIND_BLOSSOM_SERVER_LIST,
  KIND_MUTE_LIST,
  KIND_RELAY_LIST,
  normalizeMuteValue,
  type MuteListMutation,
} from '../nostr/lists'
import { evaluateNoteSpam, isTopLevelNote } from '../nostr/spamFilter'
import { fetchGlobalTrendingEvents, mergeTrendingNotes } from '../nostr/trending'
import { createGiftWrappedDm, KIND_DM_RELAYS, unwrapGiftWrap, type DecryptedDm } from '../nostr/nip17'
import { useAuthStore } from './useAuthStore'
import { useSettingsStore, type SidebarFeedMode } from './useSettingsStore'

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
  // NIP-09 author-verified deletions: targetEventId -> deleting author pubkeys[] (prevents forged pre-load deletions)
  deletedByAuthor: Record<string, string[]>
  zapTotalsSats: Record<string, number>
  followsLoaded: boolean
  rawFollowsEvent: Event | null
  rawBookmarksEvent: Event | null
  rawMuteListEvent: Event | null

  // Feed UI state (persisted across route transitions so Back never resets tab!)
  activeFeedTab: FeedTab
  showRepliesInFollows: boolean
  feedRefreshTick: number

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
  sidebarFeedIds: Record<SidebarFeedMode, string[]>
  sidebarFeedLoading: Record<SidebarFeedMode, boolean>
  notificationIds: string[]
  notificationsLastSeenAt: number
  readNotificationIds: Record<string, true>
  muteListSyncStatus: 'idle' | 'syncing' | 'synced' | 'locked' | 'empty'
  muteListHasRemoteEncrypted: boolean
  muteListPublishing: boolean
  dms: DecryptedDm[]

  loadingFeed: boolean
  powBusyMessage: string | null
  toastMessage: string | null
  pendingShareText: string | null

  setToast: (msg: string | null) => void
  setPendingShareText: (text: string | null) => void
  setActiveFeedTab: (tab: FeedTab) => void
  setShowRepliesInFollows: (show: boolean) => void
  bumpFeedRefresh: () => void
  flushPendingFeed: (tab: FeedTab) => void
  loadOlderFeed: (tab: FeedTab) => Promise<number>
  loadTrendingSidebar: (force?: boolean) => Promise<void>
  loadSidebarFeed: (mode: SidebarFeedMode, force?: boolean) => Promise<void>
  initPoolListener: () => () => void
  ingestEvent: (event: Event) => void
  fetchProfiles: (pubkeys: string[]) => Promise<void>
  loadUserGraph: (pubkey: string) => Promise<void>
  syncMuteList: (pubkey: string) => Promise<{
    publicCount: number
    privateCount: number
    status: 'synced' | 'locked' | 'empty'
  }>
  loadExtendedNetwork: () => Promise<string[]>
  clearFeedTab: (tab: FeedTab) => void
  resetUserState: () => void
  subscribeFeed: (tab: FeedTab) => () => void
  subscribeNotifications: (pubkey: string) => () => void
  markNotificationRead: (pubkey: string, eventId: string) => void
  markNotificationsRead: (pubkey: string, latestSec?: number) => void
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
  blockPubkey: (targetPubkey: string, displayName?: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  unblockPubkey: (targetPubkey: string, displayName?: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  muteHashtagGlobal: (tag: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  unmuteHashtagGlobal: (tag: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  muteWordGlobal: (word: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  unmuteWordGlobal: (word: string) => Promise<{
    synced: boolean
    okCount: number
    totalRelays: number
  }>
  pushLocalMutesToNostr: () => Promise<{
    pushedCount: number
    okCount: number
    totalRelays: number
  }>
  publishRelayList: (relays: RelayEntry[]) => Promise<{
    okCount: number
    totalRelays: number
    publishedCount: number
  }>
  publishBlossomList: (servers: string[]) => Promise<{
    okCount: number
    totalRelays: number
    publishedCount: number
  }>
  sendDm: (recipientPubkey: string, plaintext: string) => Promise<DecryptedDm>

  isEventMuted: (event: Event) => boolean
  isEventDeleted: (event: Pick<Event, 'id' | 'pubkey'>) => boolean
}

const NOTIF_SEEN_STORAGE_KEY = 'firewisp_notif_seen_v1'
const MAX_STORED_READ_NOTIF_IDS = 300

interface StoredNotifReadState {
  lastSeenAt: number
  readIds: string[]
}

function loadNotifReadState(pubkey: string): {
  lastSeenAt: number
  readIds: Record<string, true>
} {
  const clean = pubkey.toLowerCase()
  const fallback = Math.floor(Date.now() / 1000) - 12 * 3600
  if (typeof localStorage === 'undefined') return { lastSeenAt: fallback, readIds: {} }
  try {
    const raw = localStorage.getItem(NOTIF_SEEN_STORAGE_KEY)
    if (!raw) return { lastSeenAt: fallback, readIds: {} }
    const map = JSON.parse(raw) as Record<string, unknown>
    const val = map[clean]
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return { lastSeenAt: Math.floor(val), readIds: {} }
    }
    if (val && typeof val === 'object') {
      const entry = val as Partial<StoredNotifReadState>
      const lastSeenAt =
        typeof entry.lastSeenAt === 'number' &&
        Number.isFinite(entry.lastSeenAt) &&
        entry.lastSeenAt > 0
          ? Math.floor(entry.lastSeenAt)
          : fallback
      const readIds: Record<string, true> = {}
      if (Array.isArray(entry.readIds)) {
        for (const id of entry.readIds.slice(-MAX_STORED_READ_NOTIF_IDS)) {
          if (typeof id === 'string' && id.length > 0) readIds[id] = true
        }
      }
      return { lastSeenAt, readIds }
    }
  } catch {
    // ignore storage errors
  }
  return { lastSeenAt: fallback, readIds: {} }
}

function saveNotifReadState(
  pubkey: string,
  lastSeenAt: number,
  readIds: Record<string, true>,
): void {
  const clean = pubkey.toLowerCase()
  if (typeof localStorage === 'undefined') return
  try {
    let map: Record<string, StoredNotifReadState | number> = {}
    const raw = localStorage.getItem(NOTIF_SEEN_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          map[k] = Math.floor(v)
        } else if (v && typeof v === 'object') {
          const e = v as Partial<StoredNotifReadState>
          if (typeof e.lastSeenAt === 'number' && Number.isFinite(e.lastSeenAt)) {
            map[k] = {
              lastSeenAt: Math.floor(e.lastSeenAt),
              readIds: Array.isArray(e.readIds)
                ? e.readIds
                    .filter((id): id is string => typeof id === 'string' && id.length > 0)
                    .slice(-MAX_STORED_READ_NOTIF_IDS)
                : [],
            }
          }
        }
      }
    }
    map[clean] = {
      lastSeenAt: Math.floor(lastSeenAt),
      readIds: Object.keys(readIds).slice(-MAX_STORED_READ_NOTIF_IDS),
    }
    localStorage.setItem(NOTIF_SEEN_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore storage errors
  }
}

// Track last fetch timestamp per pubkey (60s miss cooldown so failed fetches can recover later)
const requestedProfilesAt = new Map<string, number>()
const replySeen = new Set<string>()
const reactionSeen = new Set<string>()
const repostSeen = new Set<string>()
const zapSeen = new Set<string>()
const seenDmWraps = new Set<string>()

// RAM-only cache of the latest decrypted NIP-51 kind-10000 private tags (wiped on Sign Out).
// Prevents repeated NIP-07 / Bunker decrypt prompts during consecutive blocks while ALWAYS querying
// relays first so updates made from other Nostr clients are never overwritten.
let decryptedMuteListCache: { eventId: string; privateTags: string[][] } | null = null
let muteMutationTail: Promise<void> = Promise.resolve()

function enqueueMuteMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = muteMutationTail.then(task, task)
  muteMutationTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function applyVerifiedMuteTagsToSettings(
  publicTags: readonly string[][],
  privateTags: readonly string[][],
) {
  const pubItems = extractMuteItemsFromTags(publicTags)
  const privItems = extractMuteItemsFromTags(privateTags)
  const st = useSettingsStore.getState()
  if (pubItems.pubkeys.length > 0 || pubItems.hashtags.length > 0 || pubItems.words.length > 0) {
    st.mergeRemoteMutes(pubItems)
  }
  st.setPrivateMutes(privItems)
  // Keep private-only encrypted mutes out of plaintext localStorage so they stay encrypted-only
  // and never appear duplicated in both Settings lists.
  const pubPkSet = new Set(pubItems.pubkeys)
  const pubTagSet = new Set(pubItems.hashtags)
  const pubWordSet = new Set(pubItems.words)
  st.removeLocalMutes({
    pubkeys: privItems.pubkeys.filter((p) => !pubPkSet.has(p)),
    hashtags: privItems.hashtags.filter((t) => !pubTagSet.has(t)),
    words: privItems.words.filter((w) => !pubWordSet.has(w)),
  })
  return { pubItems, privItems }
}

type MuteSyncOutcome = {
  status: 'published' | 'unchanged' | 'locked' | 'no-signer' | 'no-encrypt' | 'relay-failed'
  okCount: number
  totalRelays: number
  error?: string
}

async function mutateNostrMuteList(
  mutations: MuteListMutation[],
  get: () => NostrState,
  set: (partial: Partial<NostrState> | ((s: NostrState) => Partial<NostrState>)) => void,
): Promise<MuteSyncOutcome> {
  const signer = useAuthStore.getState().signer
  if (!signer?.canSign) {
    return { status: 'no-signer', okCount: 0, totalRelays: 0 }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'relay-failed', okCount: 0, totalRelays: 0, error: 'Offline' }
  }

  const pubkey = signer.pubkey.toLowerCase()
  set({ muteListPublishing: true })
  try {
    const readRelays = [
      ...new Set([
        ...useSettingsStore.getState().getReadRelays(),
        ...get().userReadRelays,
        ...get().userWriteRelays,
        ...DEFAULT_RELAYS.map((r) => r.url),
      ]),
    ].slice(0, 12)

    const cached = get().rawMuteListEvent
    const hasValidCached = Boolean(cached && cached.pubkey.toLowerCase() === pubkey)

    // If we don't have a cached kind-10000 yet and relays are still connecting, wait briefly
    // before querying so a freshly opened session never mistakes a cold socket for an empty list.
    if (!hasValidCached) {
      const statuses = nostrPool.getStatuses()
      const knownCount = Object.keys(statuses).length
      const hasConnected = readRelays.some((u) => statuses[u] === 'connected')
      if (knownCount > 0 && !hasConnected) {
        await nostrPool.ensureConnected(readRelays.slice(0, 6)).catch(() => {})
      }
    }

    let fetched: Event[] = []
    let queryFailed = false
    try {
      fetched = await nostrPool.query(
        readRelays,
        { kinds: [KIND_MUTE_LIST], authors: [pubkey], limit: 4 },
        4500,
      )
    } catch {
      queryFailed = true
    }

    if (queryFailed && !hasValidCached) {
      return { status: 'relay-failed', okCount: 0, totalRelays: 0 }
    }

    const candidates = hasValidCached && cached ? [...fetched, cached] : fetched
    const baseEvent =
      candidates.length > 0
        ? [...candidates].sort((a, b) => b.created_at - a.created_at)[0]
        : null

    // Fail-closed guard: if we previously detected an encrypted remote mute list for this user
    // and relays returned nothing now, refuse to overwrite it with a fresh list.
    if (!baseEvent && get().muteListHasRemoteEncrypted) {
      return { status: 'locked', okCount: 0, totalRelays: 0 }
    }

    let existingPrivateTags: string[][] = []
    if (baseEvent?.content && baseEvent.content.trim()) {
      if (decryptedMuteListCache && decryptedMuteListCache.eventId === baseEvent.id) {
        existingPrivateTags = decryptedMuteListCache.privateTags.map((t) => [...t])
      } else {
        const dec = await decryptMuteListContent(signer, pubkey, baseEvent.content)
        if (!dec) {
          // CRITICAL FAIL-CLOSED: Never overwrite an encrypted kind-10000 we could not decrypt!
          set({
            rawMuteListEvent: baseEvent,
            muteListHasRemoteEncrypted: true,
            muteListSyncStatus: 'locked',
          })
          return { status: 'locked', okCount: 0, totalRelays: 0 }
        }
        existingPrivateTags = dec.tags
        decryptedMuteListCache = {
          eventId: baseEvent.id,
          privateTags: dec.tags.map((t) => [...t]),
        }
      }
    }

    const { publicTags, privateTags, changed } = applyMuteListMutations({
      publicTags: baseEvent?.tags || [],
      privateTags: existingPrivateTags,
      mutations,
    })

    if (!changed) {
      if (baseEvent) {
        set({
          rawMuteListEvent: baseEvent,
          muteListSyncStatus: 'synced',
          muteListHasRemoteEncrypted: privateTags.length > 0,
        })
        applyVerifiedMuteTagsToSettings(publicTags, privateTags)
      }
      return { status: 'unchanged', okCount: 0, totalRelays: 0 }
    }

    let encryptedContent = ''
    try {
      encryptedContent = await encryptMuteListTags(signer, pubkey, privateTags)
    } catch (err) {
      return {
        status: 'no-encrypt',
        okCount: 0,
        totalRelays: 0,
        error: err instanceof Error ? err.message : 'Encryption unavailable',
      }
    }

    let signed: Event
    try {
      signed = await signer.signEvent({
        kind: KIND_MUTE_LIST,
        created_at: computeNextReplaceableCreatedAt(baseEvent),
        tags: publicTags,
        content: encryptedContent,
      })
    } catch (err) {
      return {
        status: 'locked',
        okCount: 0,
        totalRelays: 0,
        error: err instanceof Error ? err.message : 'Signing declined',
      }
    }

    const targets = [
      ...new Set([
        ...get().userWriteRelays,
        ...useSettingsStore.getState().getWriteRelays(),
        ...DEFAULT_RELAYS.map((r) => r.url),
      ]),
    ].slice(0, 14)

    const results = await nostrPool.publish(targets, signed)
    const okCount = results.filter((r) => r.ok).length
    if (okCount === 0) {
      return { status: 'relay-failed', okCount: 0, totalRelays: targets.length }
    }

    decryptedMuteListCache = {
      eventId: signed.id,
      privateTags: privateTags.map((t) => [...t]),
    }
    set({
      rawMuteListEvent: signed,
      muteListSyncStatus: 'synced',
      muteListHasRemoteEncrypted: privateTags.length > 0,
    })
    applyVerifiedMuteTagsToSettings(publicTags, privateTags)
    return { status: 'published', okCount, totalRelays: targets.length }
  } finally {
    set({ muteListPublishing: false })
  }
}

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
  deletedByAuthor: {},
  zapTotalsSats: {},
  followsLoaded: false,
  rawFollowsEvent: null,
  rawBookmarksEvent: null,
  rawMuteListEvent: null,

  activeFeedTab: 'foryou',
  showRepliesInFollows: false,
  feedRefreshTick: 0,

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
  sidebarFeedIds: {
    trending: [],
    extended: [],
    global: [],
    firewisp: [],
  },
  sidebarFeedLoading: {
    trending: false,
    extended: false,
    global: false,
    firewisp: false,
  },
  notificationIds: [],
  notificationsLastSeenAt: 0,
  readNotificationIds: {},
  muteListSyncStatus: 'idle',
  muteListHasRemoteEncrypted: false,
  muteListPublishing: false,
  dms: [],

  loadingFeed: false,
  powBusyMessage: null,
  toastMessage: null,
  pendingShareText: null,

  setToast: (toastMessage) => set({ toastMessage }),
  setPendingShareText: (pendingShareText) => set({ pendingShareText }),
  setActiveFeedTab: (activeFeedTab) => set({ activeFeedTab }),
  setShowRepliesInFollows: (showRepliesInFollows) => set({ showRepliesInFollows }),
  bumpFeedRefresh: () => set((s) => ({ feedRefreshTick: s.feedRefreshTick + 1 })),

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
    seenDmWraps.clear()
    decryptedMuteListCache = null
    useSettingsStore.getState().clearPrivateSessionMutes()
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(PROFILES_CACHE_KEY)
        localStorage.removeItem(BOOKMARKS_KEY)
        localStorage.removeItem(NOTIF_SEEN_STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    set((s) => ({
      profiles: {},
      follows: [],
      followsLoaded: false,
      rawFollowsEvent: null,
      rawBookmarksEvent: null,
      rawMuteListEvent: null,
      followedHashtags: [],
      userReadRelays: [],
      userWriteRelays: [],
      bookmarks: [],
      userLiked: {},
      userRepostIds: {},
      forYouFeedIds: [],
      forYouSuppIds: {},
      followingFeedIds: [],
      extendedFeedIds: [],
      extendedAuthors: [],
      sidebarFeedIds: { ...s.sidebarFeedIds, extended: [] },
      pendingFeedIds: { ...s.pendingFeedIds, foryou: [], following: [], extended: [] },
      notificationIds: [],
      notificationsLastSeenAt: 0,
      readNotificationIds: {},
      muteListSyncStatus: 'idle',
      muteListHasRemoteEncrypted: false,
      muteListPublishing: false,
      dms: [],
    }))
  },

  initPoolListener: () => {
    return nostrPool.onStatusChange((relayStatuses) => set({ relayStatuses }))
  },

  isEventMuted: (event) => {
    const st = useSettingsStore.getState()
    const pk = event.pubkey.toLowerCase()
    if (st.mutedPubkeys.includes(pk) || st.privateMutedPubkeys.includes(pk)) return true
    const allTags =
      st.privateMutedHashtags.length > 0
        ? [...st.mutedHashtags, ...st.privateMutedHashtags]
        : st.mutedHashtags
    if (allTags.length > 0) {
      const tags = extractEventHashtags(event)
      if (tags.some((t) => allTags.includes(t))) return true
    }
    const allWords =
      st.privateMutedWords.length > 0
        ? [...st.mutedWords, ...st.privateMutedWords]
        : st.mutedWords
    if (allWords.length > 0 && event.content) {
      const lower = event.content
        .replace(/[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g, '')
        .toLowerCase()
      if (allWords.some((w) => w.length >= 2 && lower.includes(w))) return true
    }
    return false
  },

  isEventDeleted: (event) => {
    const deleters = get().deletedByAuthor[event.id]
    if (!deleters || deleters.length === 0) return false
    return deleters.includes(event.pubkey.toLowerCase())
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

    // Kind 5: NIP-09 strictly author-verified deletion (prevents forged pre-load censorship!)
    if (event.kind === 5) {
      const targetIds = event.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1])
      if (targetIds.length === 0) return
      const deleterPk = event.pubkey.toLowerCase()
      set((s) => {
        const nextDeleted = { ...s.deletedEventIds }
        const nextByAuthor = { ...s.deletedByAuthor }
        const nextUserReposts = { ...s.userRepostIds }
        const nextRepostCounts = { ...s.repostCounts }

        for (const tid of targetIds) {
          const existingDeleters = nextByAuthor[tid] || []
          if (!existingDeleters.includes(deleterPk)) {
            nextByAuthor[tid] = [...existingDeleters, deleterPk]
          }

          const targetEv = s.events[tid]
          // Only set deletedEventIds[tid] when we can cryptographically confirm author ownership
          if (targetEv) {
            if (targetEv.pubkey.toLowerCase() !== deleterPk) continue
            nextDeleted[tid] = true
          }

          // Only undo the current user's repost state if the deleter IS the current user
          if (myPubkey && deleterPk === myPubkey) {
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
        }
        return {
          deletedEventIds: nextDeleted,
          deletedByAuthor: nextByAuthor,
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
      if (get().isEventDeleted(event)) return
      const targetId = event.tags.find((t) => t[0] === 'e' && t[1])?.[1]
      // Also parse embedded reposted note ONLY if its cryptographic signature & ID match
      if (event.content && event.content.startsWith('{')) {
        try {
          const inner = JSON.parse(event.content) as Event
          const allowedKind =
            inner?.kind === 1 || inner?.kind === 20 || inner?.kind === 21 || inner?.kind === 22
          if (
            inner?.id &&
            inner?.pubkey &&
            allowedKind &&
            (!targetId || inner.id === targetId) &&
            verifyEvent(inner)
          ) {
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
    const batch = needed.slice(0, 100)
    for (const p of batch) requestedProfilesAt.set(p, now)

    const relays = [
      ...new Set([
        ...useSettingsStore.getState().getReadRelays(),
        ...get().userReadRelays,
      ]),
    ].slice(0, 8)
    try {
      const events = await nostrPool.query(
        relays,
        { kinds: [0], authors: batch },
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
    try {
      const [contactEvents, bookmarkEvents, relayListEvents, interestEvents, muteEvents, blossomEvents] = await Promise.all([
        nostrPool.query(relays, { kinds: [3], authors: [pubkey], limit: 3 }, 4000),
        nostrPool.query(relays, { kinds: [10003], authors: [pubkey], limit: 2 }, 3500),
        nostrPool.query(relays, { kinds: [10002], authors: [pubkey], limit: 3 }, 3500),
        nostrPool.query(relays, { kinds: [10015, 30015], authors: [pubkey], limit: 25 }, 3500),
        nostrPool.query(relays, { kinds: [10000], authors: [pubkey], limit: 2 }, 3500),
        nostrPool.query(relays, { kinds: [10063], authors: [pubkey], limit: 3 }, 3500),
      ])

      // Sync BUD-03 kind-10063 Blossom media server list (user's published servers prioritized first)
      if (blossomEvents.length > 0) {
        const latestBlossom = [...blossomEvents].sort((a, b) => b.created_at - a.created_at)[0]
        const remoteServers = latestBlossom.tags
          .filter((t) => t[0] === 'server' && t[1])
          .map((t) => t[1].trim())
        if (remoteServers.length > 0) {
          useSettingsStore.getState().mergeRemoteBlossomServers(remoteServers)
        }
      }

      // Parse NIP-65 kind-10002 relays first so mute lists living on user's custom relays are never missed
      let nip65Read: string[] = []
      if (relayListEvents.length > 0) {
        const latestRelayList = [...relayListEvents].sort((a, b) => b.created_at - a.created_at)[0]
        const readList: string[] = []
        const writeList: string[] = []
        for (const t of latestRelayList.tags) {
          if (t[0] !== 'r' || !t[1]) continue
          const clean = sanitizePublicRelayUrl(t[1])
          if (!clean) continue
          const marker = t[2]
          if (!marker || marker === 'read') readList.push(clean)
          if (!marker || marker === 'write') writeList.push(clean)
        }
        nip65Read = [...new Set(readList)].slice(0, 12)
        set({
          userReadRelays: nip65Read,
          userWriteRelays: [...new Set(writeList)].slice(0, 12),
        })
      }

      // If user has NIP-65 read relays beyond our initial query set, also check them for a newer kind-10000 mute list
      let allMuteEvents = muteEvents
      const extraMuteRelays = nip65Read.filter((r) => !relays.includes(r)).slice(0, 6)
      if (extraMuteRelays.length > 0) {
        try {
          const extraMutes = await nostrPool.query(
            extraMuteRelays,
            { kinds: [10000], authors: [pubkey], limit: 2 },
            3500,
          )
          if (extraMutes.length > 0) {
            allMuteEvents = [...muteEvents, ...extraMutes]
          }
        } catch {
          // ignore extra relay query failure
        }
      }

      // Sync NIP-51 kind-10000 mute list:
      // Public tags go to persisted settings; decrypted private tags stay strictly in RAM!
      if (allMuteEvents.length > 0) {
        const latestMute = [...allMuteEvents].sort((a, b) => b.created_at - a.created_at)[0]
        set({ rawMuteListEvent: latestMute })
        const pubItems = extractMuteItemsFromTags(latestMute.tags)
        if (pubItems.pubkeys.length > 0 || pubItems.hashtags.length > 0 || pubItems.words.length > 0) {
          useSettingsStore.getState().mergeRemoteMutes(pubItems)
        }

        if (latestMute.content && latestMute.content.trim()) {
          set({ muteListHasRemoteEncrypted: true })
          const signer = useAuthStore.getState().signer
          const dec = await decryptMuteListContent(signer, pubkey, latestMute.content)
          if (dec) {
            decryptedMuteListCache = {
              eventId: latestMute.id,
              privateTags: dec.tags.map((t) => [...t]),
            }
            applyVerifiedMuteTagsToSettings(latestMute.tags, dec.tags)
            set({ muteListSyncStatus: 'synced' })
          } else {
            set({ muteListSyncStatus: 'locked' })
          }
        } else {
          decryptedMuteListCache = { eventId: latestMute.id, privateTags: [] }
          useSettingsStore.getState().setPrivateMutes({ pubkeys: [], hashtags: [], words: [] })
          set({ muteListHasRemoteEncrypted: false, muteListSyncStatus: 'synced' })
        }
      } else {
        set({ muteListHasRemoteEncrypted: false, muteListSyncStatus: 'empty' })
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

      if (contactEvents.length > 0) {
        const latest = [...contactEvents].sort((a, b) => b.created_at - a.created_at)[0]
        const follows = [
          ...new Set(
            latest.tags
              .filter((t) => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]))
              .map((t) => t[1].toLowerCase()),
          ),
        ]
        // Clear any signed-out For You notes when the user's real follow graph arrives
        set({ follows, rawFollowsEvent: latest, forYouFeedIds: [], forYouSuppIds: {} })
        void get().fetchProfiles([pubkey, ...follows.slice(0, 60)])
      } else {
        void get().fetchProfiles([pubkey])
      }

      if (bookmarkEvents.length > 0) {
        const latestBm = [...bookmarkEvents].sort((a, b) => b.created_at - a.created_at)[0]
        const remoteIds = latestBm.tags
          .filter((t) => t[0] === 'e' && t[1])
          .map((t) => t[1])
        const merged = [...new Set([...remoteIds, ...get().bookmarks])]
        set({ bookmarks: merged, rawBookmarksEvent: latestBm })
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(merged))
        }
      }
    } finally {
      set({ followsLoaded: true })
    }
  },

  syncMuteList: async (pubkey) => {
    set({ muteListSyncStatus: 'syncing' })
    const relays = [
      ...new Set([
        ...useSettingsStore.getState().getReadRelays(),
        ...get().userReadRelays,
        ...get().userWriteRelays,
      ]),
    ].slice(0, 12)
    try {
      const muteEvents = await nostrPool.query(
        relays,
        { kinds: [KIND_MUTE_LIST], authors: [pubkey], limit: 4 },
        4500,
      )
      if (muteEvents.length === 0) {
        set({ muteListSyncStatus: 'empty', muteListHasRemoteEncrypted: false })
        return { publicCount: 0, privateCount: 0, status: 'empty' }
      }
      const latestMute = [...muteEvents].sort((a, b) => b.created_at - a.created_at)[0]
      set({ rawMuteListEvent: latestMute })
      const pubItems = extractMuteItemsFromTags(latestMute.tags)
      if (pubItems.pubkeys.length > 0 || pubItems.hashtags.length > 0 || pubItems.words.length > 0) {
        useSettingsStore.getState().mergeRemoteMutes(pubItems)
      }
      if (!latestMute.content || !latestMute.content.trim()) {
        decryptedMuteListCache = { eventId: latestMute.id, privateTags: [] }
        useSettingsStore.getState().setPrivateMutes({ pubkeys: [], hashtags: [], words: [] })
        set({ muteListSyncStatus: 'synced', muteListHasRemoteEncrypted: false })
        return { publicCount: pubItems.pubkeys.length, privateCount: 0, status: 'synced' }
      }
      set({ muteListHasRemoteEncrypted: true })
      const signer = useAuthStore.getState().signer
      const dec = await decryptMuteListContent(signer, pubkey, latestMute.content)
      if (!dec) {
        set({ muteListSyncStatus: 'locked' })
        return { publicCount: pubItems.pubkeys.length, privateCount: 0, status: 'locked' }
      }
      decryptedMuteListCache = {
        eventId: latestMute.id,
        privateTags: dec.tags.map((t) => [...t]),
      }
      const { privItems } = applyVerifiedMuteTagsToSettings(latestMute.tags, dec.tags)
      set({ muteListSyncStatus: 'synced' })
      return {
        publicCount: pubItems.pubkeys.length,
        privateCount: privItems.pubkeys.length,
        status: 'synced',
      }
    } catch {
      set({ muteListSyncStatus: 'locked' })
      return { publicCount: 0, privateCount: 0, status: 'locked' }
    }
  },

  loadExtendedNetwork: async () => {
    const existing = get().extendedAuthors
    if (existing.length > 0 || get().loadingExtendedGraph) return existing
    const follows = get().follows
    if (follows.length === 0) return []
    set({ loadingExtendedGraph: true })
    try {
      const relays = [
        ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
      ].slice(0, 10)
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
    await get().loadSidebarFeed('trending', force)
  },

  loadSidebarFeed: async (mode, force = false) => {
    if (get().sidebarFeedLoading[mode]) return
    if (!force && get().sidebarFeedIds[mode].length > 0) return

    set((s) => ({
      sidebarFeedLoading: { ...s.sidebarFeedLoading, [mode]: true },
      ...(mode === 'trending' ? { loadingTrends: true } : {}),
    }))

    try {
      const settings = useSettingsStore.getState()
      const readRelays = [...new Set([...settings.getReadRelays(), ...get().userReadRelays])].slice(0, 8)
      const myPubkey = useAuthStore.getState().pubkey
      const followSet = new Set(get().follows.map((p) => p.toLowerCase()))
      const picked: Event[] = []
      const seenIds = new Set<string>()
      const seenContent = new Map<string, Set<string>>()
      const authorCounts = new Map<string, number>()

      const hasReadableContent = (ev: Event, minChars: number) => {
        const textOnly = ev.content
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/nostr:[0-9a-z]+/gi, '')
          .trim()
        const hasMedia =
          /https?:\/\/[^\s]+\.(png|jpe?g|gif|webp|avif|mp4|webm|mov)/i.test(ev.content) ||
          /youtu(?:\.be|be\.com)/i.test(ev.content)
        return textOnly.length >= minChars || hasMedia
      }

      if (mode === 'trending') {
        const since48h = Math.floor(Date.now() / 1000) - 48 * 3600
        const [globalBundle, relayRaw] = await Promise.all([
          fetchGlobalTrendingEvents(4000),
          nostrPool.query([TRENDING_RELAY], { kinds: [1], since: since48h, limit: 60 }, 4000),
        ])

        for (const p of globalBundle.profiles) get().ingestEvent(p)
        for (const z of globalBundle.zaps) get().ingestEvent(z)

        const mergedCandidates = mergeTrendingNotes({
          hotNotes: globalBundle.hotNotes,
          trending24hNotes: globalBundle.trending24hNotes,
          relayTrendingNotes: relayRaw,
          maxPerAuthor: 1,
          limit: 80,
        })

        for (const ev of mergedCandidates) {
          if (seenIds.has(ev.id) || !isTopLevelNote(ev) || get().isEventMuted(ev)) continue
          const pk = ev.pubkey.toLowerCase()
          if ((authorCounts.get(pk) || 0) >= 1) continue
          const verdict = evaluateNoteSpam(ev, { seenContentAuthors: seenContent, maxPerAuthor: 1 })
          if (verdict.isSpam) continue
          if (!hasReadableContent(ev, 20)) continue
          seenIds.add(ev.id)
          authorCounts.set(pk, 1)
          picked.push(ev)
          if (picked.length >= 6) break
        }
      } else if (mode === 'extended') {
        let extendedAuthors = get().extendedAuthors
        if (extendedAuthors.length === 0 && get().follows.length > 0) {
          extendedAuthors = await get().loadExtendedNetwork()
        }
        if (extendedAuthors.length > 0) {
          const allowed = new Set(extendedAuthors.map((p) => p.toLowerCase()))
          const raw = await nostrPool.query(
            readRelays,
            { kinds: [1], authors: extendedAuthors.slice(0, 150), limit: 60 },
            4000,
          )
          const sorted = [...raw].sort((a, b) => b.created_at - a.created_at)
          for (const ev of sorted) {
            const pk = ev.pubkey.toLowerCase()
            if (!allowed.has(pk) || seenIds.has(ev.id) || !isTopLevelNote(ev) || get().isEventMuted(ev)) {
              continue
            }
            if ((authorCounts.get(pk) || 0) >= 1) continue
            if (settings.spamFilterEnabled) {
              const verdict = evaluateNoteSpam(ev, {
                myPubkey,
                follows: followSet,
                seenContentAuthors: seenContent,
                maxPerAuthor: 1,
              })
              if (verdict.isSpam) continue
            }
            if (!hasReadableContent(ev, 12)) continue
            seenIds.add(ev.id)
            authorCounts.set(pk, 1)
            picked.push(ev)
            if (picked.length >= 6) break
          }
        }
      } else if (mode === 'global') {
        const raw = await nostrPool.query(CURATED_EXPLORE_RELAYS, { kinds: [1], limit: 80 }, 4000)
        const sorted = [...raw].sort((a, b) => b.created_at - a.created_at)
        for (const ev of sorted) {
          if (seenIds.has(ev.id) || get().isEventMuted(ev)) continue
          if (settings.hideRepliesInExplore && !isTopLevelNote(ev)) continue
          const pk = ev.pubkey.toLowerCase()
          if ((authorCounts.get(pk) || 0) >= 1) continue
          if (settings.spamFilterEnabled) {
            const verdict = evaluateNoteSpam(ev, {
              myPubkey,
              follows: followSet,
              seenContentAuthors: seenContent,
              maxPerAuthor: 1,
              requirePowBits: settings.requirePowInExplore ? 12 : 0,
            })
            if (verdict.isSpam) continue
          }
          if (!hasReadableContent(ev, 15)) continue
          seenIds.add(ev.id)
          authorCounts.set(pk, 1)
          picked.push(ev)
          if (picked.length >= 6) break
        }
      } else {
        // Fire Wisp Relay (wss://relay.firewisp.de)
        const raw = await nostrPool.query([FIREWISP_RELAY], { kinds: [1], limit: 50 }, 4000)
        const sorted = [...raw].sort((a, b) => b.created_at - a.created_at)
        for (const ev of sorted) {
          if (seenIds.has(ev.id) || !isTopLevelNote(ev) || get().isEventMuted(ev)) continue
          const pk = ev.pubkey.toLowerCase()
          const count = authorCounts.get(pk) || 0
          if (count >= 2) continue
          if (!ev.content.trim()) continue
          seenIds.add(ev.id)
          authorCounts.set(pk, count + 1)
          picked.push(ev)
          if (picked.length >= 6) break
        }
      }

      for (const ev of picked) get().ingestEvent(ev)
      if (picked.length > 0) {
        const missingProfilePks = picked
          .map((e) => e.pubkey)
          .filter((pk) => !get().profiles[pk])
        if (missingProfilePks.length > 0) void get().fetchProfiles(missingProfilePks)
        const pickedIds = picked.map((e) => e.id)
        const metaRelays = [
          ...new Set([
            ...(mode === 'firewisp' ? [FIREWISP_RELAY] : []),
            ...readRelays,
          ]),
        ].slice(0, 6)
        void nostrPool
          .query(metaRelays, { kinds: [1, 6, 7, 9735], '#e': pickedIds, limit: 200 }, 3500)
          .then((meta) => {
            for (const m of meta) get().ingestEvent(m)
          })
      }

      const nextIds = picked.map((e) => e.id)
      set((s) => {
        const eventsMap = { ...s.events }
        for (const ev of picked) eventsMap[ev.id] = ev
        const resolvedIds =
          nextIds.length > 0 || mode === 'extended' || mode === 'firewisp'
            ? nextIds
            : s.sidebarFeedIds[mode]
        return {
          events: eventsMap,
          sidebarFeedIds: { ...s.sidebarFeedIds, [mode]: resolvedIds },
          ...(mode === 'trending' ? { trendingSidebarIds: resolvedIds } : {}),
        }
      })
    } finally {
      set((s) => ({
        sidebarFeedLoading: { ...s.sidebarFeedLoading, [mode]: false },
        ...(mode === 'trending' ? { loadingTrends: false } : {}),
      }))
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
        const engagementRelays = tab === 'trending' ? mergedFollowingRelays : targetRelays
        void nostrPool
          .query(engagementRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': olderIds, limit: 250 }, 3500)
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

    // While signed in and still loading kind-3 follows, wait cleanly before subscribing;
    // once loaded, a 0-follow account still subscribes to its own notes (never stuck on skeleton!).
    if (
      (tab === 'foryou' || tab === 'following') &&
      myPubkey &&
      follows.length === 0 &&
      !get().followsLoaded
    ) {
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
        // Fetch live global 4h most-zapped + 24h trending (cryptographically verified) in parallel with trending.relays.land
        const since48h = Math.floor(Date.now() / 1000) - 48 * 3600
        return [{ kinds: [1], since: since48h, limit: 80 }]
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
        const engagementRelays = tab === 'trending' ? mergedFollowingRelays : targetRelays
        void nostrPool
          .query(engagementRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': ids, limit: 300 }, 3500)
          .then((metaEvents) => {
            for (const m of metaEvents) get().ingestEvent(m)
          })
      }
    }

    // For Trending tab, also pull cryptographically verified global 4h most-zapped + 24h trending notes
    let trendingCancelled = false
    if (tab === 'trending') {
      void fetchGlobalTrendingEvents(4500).then((bundle) => {
        if (trendingCancelled) return
        for (const p of bundle.profiles) get().ingestEvent(p)
        for (const z of bundle.zaps) get().ingestEvent(z)

        const relayNotes = get()
          .trendingFeedIds.map((id) => get().events[id])
          .filter((e): e is Event => Boolean(e))
        const merged = mergeTrendingNotes({
          hotNotes: bundle.hotNotes,
          trending24hNotes: bundle.trending24hNotes,
          relayTrendingNotes: relayNotes,
          limit: 120,
        })
        if (merged.length === 0) return

        for (const ev of merged) get().ingestEvent(ev)
        const missingPks = merged
          .map((e) => e.pubkey)
          .filter((pk) => !get().profiles[pk])
        if (missingPks.length > 0) void get().fetchProfiles(missingPks)

        set((s) => {
          const eventsMap = { ...s.events }
          for (const ev of merged) eventsMap[ev.id] = ev
          return {
            events: eventsMap,
            trendingFeedIds: merged.map((e) => e.id),
            loadingFeed: false,
          }
        })

        const topIds = merged.slice(0, 45).map((e) => e.id)
        if (topIds.length > 0) {
          void nostrPool
            .query(
              mergedFollowingRelays,
              { kinds: [1, 5, 6, 7, 1111, 9735], '#e': topIds, limit: 300 },
              3500,
            )
            .then((metaEvents) => {
              for (const m of metaEvents) get().ingestEvent(m)
            })
        }
      })
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
      trendingCancelled = true
      clearTimeout(eoseFallbackTimer)
      if (batchTimer) clearTimeout(batchTimer)
      for (const s of subs) s.close()
    }
  },

  markNotificationRead: (pubkey, eventId) => {
    if (!eventId) return
    const state = get()
    if (state.readNotificationIds[eventId]) return
    const nextRead: Record<string, true> = { ...state.readNotificationIds, [eventId]: true }
    const keys = Object.keys(nextRead)
    if (keys.length > MAX_STORED_READ_NOTIF_IDS) {
      for (const oldKey of keys.slice(0, keys.length - MAX_STORED_READ_NOTIF_IDS)) {
        delete nextRead[oldKey]
      }
    }
    const baseSeen =
      state.notificationsLastSeenAt > 0
        ? state.notificationsLastSeenAt
        : loadNotifReadState(pubkey).lastSeenAt
    saveNotifReadState(pubkey, baseSeen, nextRead)
    set({ notificationsLastSeenAt: baseSeen, readNotificationIds: nextRead })
  },

  markNotificationsRead: (pubkey, latestSec) => {
    const nowSec = Math.floor(Date.now() / 1000)
    const next = Math.max(nowSec, latestSec || 0, get().notificationsLastSeenAt)
    saveNotifReadState(pubkey, next, {})
    set({ notificationsLastSeenAt: next, readNotificationIds: {} })
  },

  subscribeNotifications: (pubkey) => {
    const cleanPk = pubkey.toLowerCase()
    const stored = loadNotifReadState(cleanPk)
    set((s) => ({
      notificationsLastSeenAt:
        s.notificationsLastSeenAt > stored.lastSeenAt
          ? s.notificationsLastSeenAt
          : stored.lastSeenAt,
      readNotificationIds: { ...stored.readIds, ...s.readNotificationIds },
    }))
    const relays = [
      ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
    ].slice(0, 10)
    const pendingActors = new Set<string>()
    let actorTimer: ReturnType<typeof setTimeout> | null = null
    const queueActorProfile = (pk: string) => {
      pendingActors.add(pk)
      if (!actorTimer) {
        actorTimer = setTimeout(() => {
          actorTimer = null
          const batch = [...pendingActors]
          pendingActors.clear()
          if (batch.length > 0) void get().fetchProfiles(batch)
        }, 300)
      }
    }
    const sub = nostrPool.subscribe(
      relays,
      { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: 60 },
      {
        onevent: (ev) => {
          const actorPubkey =
            ev.kind === 9735 ? parseZapReceiptInfo(ev).senderPubkey : ev.pubkey.toLowerCase()
          if (actorPubkey === pubkey.toLowerCase()) return
          get().ingestEvent(ev)
          queueActorProfile(actorPubkey)
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
    return () => {
      if (actorTimer) clearTimeout(actorTimer)
      sub.close()
    }
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
      const parentRefs = extractReplyRefs(replyTo)
      if (parentRefs.rootId && parentRefs.rootId !== replyTo.id) {
        tags.push(['e', parentRefs.rootId, FIREWISP_RELAY, 'root'])
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

    // Extract #hashtags into `t` tags (strip URLs first so #fragments aren't tagged)
    const hashtags = content.replace(/https?:\/\/\S+/gi, ' ').match(/#[a-zA-Z0-9_]{1,64}/g) || []
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
    try {
      // SAFETY: Fetch latest kind-3 before modifying if not yet loaded so we NEVER wipe a follow list!
      let baseEvent = get().rawFollowsEvent
      if (!baseEvent) {
        const readRelays = [
          ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
        ].slice(0, 10)
        const latest = await nostrPool.query(
          readRelays,
          { kinds: [3], authors: [signer.pubkey], limit: 3 },
          4000,
        )
        if (latest.length > 0) {
          baseEvent = [...latest].sort((a, b) => b.created_at - a.created_at)[0]
          const syncedFollows = [
            ...new Set(
              baseEvent.tags
                .filter((t) => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]))
                .map((t) => t[1].toLowerCase()),
            ),
          ]
          set({ rawFollowsEvent: baseEvent, follows: syncedFollows, followsLoaded: true })
        }
      }

      const existingTags = baseEvent ? baseEvent.tags.map((t) => [...t]) : get().follows.map((p) => ['p', p])
      const wasFollowing = existingTags.some(
        (t) => t[0] === 'p' && t[1]?.toLowerCase() === clean,
      )
      const nextTags = wasFollowing
        ? existingTags.filter((t) => !(t[0] === 'p' && t[1]?.toLowerCase() === clean))
        : [...existingTags, ['p', clean]]
      const nextFollows = [
        ...new Set(
          nextTags
            .filter((t) => t[0] === 'p' && t[1] && /^[0-9a-f]{64}$/i.test(t[1]))
            .map((t) => t[1].toLowerCase()),
        ),
      ]

      const ev = await signer.signEvent({
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: nextTags,
        content: baseEvent?.content || '',
      })
      set({ follows: nextFollows, rawFollowsEvent: ev, followsLoaded: true })
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
    const wasBookmarked = current.includes(eventId)
    const next = wasBookmarked
      ? current.filter((id) => id !== eventId)
      : [eventId, ...current]
    set({ bookmarks: next })
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next))
    }
    const signer = useAuthStore.getState().signer
    if (signer?.canSign) {
      try {
        let baseEvent = get().rawBookmarksEvent
        if (!baseEvent) {
          const readRelays = [
            ...new Set([...useSettingsStore.getState().getReadRelays(), ...get().userReadRelays]),
          ].slice(0, 10)
          const latest = await nostrPool.query(
            readRelays,
            { kinds: [10003], authors: [signer.pubkey], limit: 2 },
            3500,
          )
          if (latest.length > 0) {
            baseEvent = [...latest].sort((a, b) => b.created_at - a.created_at)[0]
          }
        }
        // Preserve non-`e` tags and any private encrypted content in kind-10003
        const preservedOtherTags = (baseEvent?.tags || []).filter((t) => t[0] !== 'e')
        const existingEIds = (baseEvent?.tags || [])
          .filter((t) => t[0] === 'e' && t[1])
          .map((t) => t[1])
        const mergedEIds = wasBookmarked
          ? [...new Set([...next, ...existingEIds])].filter((id) => id !== eventId)
          : [...new Set([eventId, ...next, ...existingEIds])]
        const nextTags = [...preservedOtherTags, ...mergedEIds.map((id) => ['e', id])]

        const ev = await signer.signEvent({
          kind: 10003,
          created_at: Math.floor(Date.now() / 1000),
          tags: nextTags,
          content: baseEvent?.content || '',
        })
        set({ bookmarks: mergedEIds, rawBookmarksEvent: ev })
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(mergedEIds))
        }
        const writeRelays = [
          ...new Set([...useSettingsStore.getState().getWriteRelays(), ...get().userWriteRelays]),
        ]
        await nostrPool.publish(writeRelays, ev)
      } catch {
        // Local bookmark still saved
      }
    }
  },

  blockPubkey: async (targetPubkey, displayName) => {
    const clean = normalizeMuteValue('p', targetPubkey)
    if (!clean) return { synced: false, okCount: 0, totalRelays: 0 }
    const label = displayName?.trim() || `${clean.slice(0, 8)}…`
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useSettingsStore.getState().mutePubkey(clean)
      set({ toastMessage: `Blocked ${label} (local only — sign in to sync globally)` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    // Optimistically hide immediately in RAM (never leaked to plaintext localStorage while syncing)
    useSettingsStore.getState().addPrivateMute('p', clean)
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'add', type: 'p', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Blocked ${label} · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `${label} is already in your Nostr mute list` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    // Safety fallback: keep blocked locally so the user stays hidden on this device
    useSettingsStore.getState().mutePubkey(clean)
    if (res.status === 'locked') {
      set({
        toastMessage: `Blocked ${label} locally — approve Nostr decryption/signing in Settings to sync globally`,
      })
    } else if (res.status === 'no-encrypt') {
      set({
        toastMessage: `Blocked ${label} locally — ${res.error || 'signer cannot encrypt mute list'}`,
      })
    } else {
      set({ toastMessage: `Blocked ${label} locally — relays did not confirm Nostr sync` })
    }
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  unblockPubkey: async (targetPubkey, displayName) => {
    const clean = normalizeMuteValue('p', targetPubkey)
    if (!clean) return { synced: false, okCount: 0, totalRelays: 0 }
    const label = displayName?.trim() || `${clean.slice(0, 8)}…`
    useSettingsStore.getState().unmutePubkey(clean)
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      set({ toastMessage: `Unblocked ${label}` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'remove', type: 'p', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Unblocked ${label} · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `Unblocked ${label}` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    if (res.status === 'locked') {
      set({
        toastMessage: `Unblocked ${label} for this session — approve decryption/signing to update Nostr mute list`,
      })
    } else {
      set({ toastMessage: `Unblocked ${label} locally — relays did not confirm Nostr sync` })
    }
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  muteHashtagGlobal: async (tag) => {
    const clean = normalizeMuteValue('t', tag)
    if (!clean) return { synced: false, okCount: 0, totalRelays: 0 }
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useSettingsStore.getState().muteHashtag(clean)
      set({ toastMessage: `Muted #${clean} (local only)` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    useSettingsStore.getState().addPrivateMute('t', clean)
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'add', type: 't', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Muted #${clean} · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `#${clean} is already in your Nostr mute list` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    useSettingsStore.getState().muteHashtag(clean)
    set({ toastMessage: `Muted #${clean} locally — could not sync to Nostr` })
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  unmuteHashtagGlobal: async (tag) => {
    const clean = normalizeMuteValue('t', tag)
    if (!clean) return { synced: false, okCount: 0, totalRelays: 0 }
    useSettingsStore.getState().unmuteHashtag(clean)
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      set({ toastMessage: `Unmuted #${clean}` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'remove', type: 't', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Unmuted #${clean} · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `Unmuted #${clean}` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    set({ toastMessage: `Unmuted #${clean} locally — could not sync to Nostr` })
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  muteWordGlobal: async (word) => {
    const clean = normalizeMuteValue('word', word)
    if (!clean) {
      set({ toastMessage: 'Muted words must be at least 2 characters' })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useSettingsStore.getState().addMutedWord(clean)
      set({ toastMessage: `Muted word "${clean}" (local only)` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    useSettingsStore.getState().addPrivateMute('word', clean)
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'add', type: 'word', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Muted word "${clean}" · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `"${clean}" is already in your Nostr mute list` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    useSettingsStore.getState().addMutedWord(clean)
    set({ toastMessage: `Muted word "${clean}" locally — could not sync to Nostr` })
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  unmuteWordGlobal: async (word) => {
    const clean = normalizeMuteValue('word', word)
    if (!clean) return { synced: false, okCount: 0, totalRelays: 0 }
    useSettingsStore.getState().removeMutedWord(clean)
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      set({ toastMessage: `Removed muted word "${clean}"` })
      return { synced: false, okCount: 0, totalRelays: 0 }
    }
    const res = await enqueueMuteMutation(() =>
      mutateNostrMuteList([{ op: 'remove', type: 'word', value: clean }], get, set),
    )
    if (res.status === 'published') {
      set({
        toastMessage: `Removed muted word "${clean}" · Synced to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { synced: true, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      set({ toastMessage: `Removed muted word "${clean}"` })
      return { synced: true, okCount: 0, totalRelays: 0 }
    }
    set({ toastMessage: `Removed muted word "${clean}" locally — could not sync to Nostr` })
    return { synced: false, okCount: 0, totalRelays: res.totalRelays }
  },

  pushLocalMutesToNostr: async () => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      throw new Error('Sign in with a signing method (NIP-07, Bunker, or key) to sync mutes to Nostr')
    }
    const st = useSettingsStore.getState()
    const pubRemote = extractMuteItemsFromTags(get().rawMuteListEvent?.tags || [])
    const pubPkSet = new Set(pubRemote.pubkeys)
    const pubTagSet = new Set(pubRemote.hashtags)
    const pubWordSet = new Set(pubRemote.words)

    const localPubkeys = st.mutedPubkeys.filter((p) => !pubPkSet.has(p))
    const localTags = st.mutedHashtags.filter((t) => !pubTagSet.has(t))
    const localWords = st.mutedWords.filter((w) => !pubWordSet.has(w))
    const mutations: MuteListMutation[] = [
      ...localPubkeys.map((value) => ({ op: 'add' as const, type: 'p' as const, value })),
      ...localTags.map((value) => ({ op: 'add' as const, type: 't' as const, value })),
      ...localWords.map((value) => ({ op: 'add' as const, type: 'word' as const, value })),
    ]
    if (mutations.length === 0) {
      return { pushedCount: 0, okCount: 0, totalRelays: 0 }
    }
    const res = await enqueueMuteMutation(() => mutateNostrMuteList(mutations, get, set))
    if (res.status === 'published') {
      set({
        toastMessage: `Synced ${mutations.length} local ${mutations.length === 1 ? 'mute' : 'mutes'} to Nostr (${res.okCount}/${res.totalRelays} relays)`,
      })
      return { pushedCount: mutations.length, okCount: res.okCount, totalRelays: res.totalRelays }
    }
    if (res.status === 'unchanged') {
      return { pushedCount: 0, okCount: 0, totalRelays: 0 }
    }
    if (res.status === 'locked') {
      throw new Error('Approve decryption & signing in your Nostr signer first so your existing encrypted mute list is preserved')
    }
    if (res.status === 'no-encrypt') {
      throw new Error(res.error || 'Your signer does not support NIP-44 or NIP-04 encryption')
    }
    throw new Error('Relays did not confirm your updated kind-10000 mute list — try again')
  },

  publishRelayList: async (relays) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      throw new Error('Sign in with a signing method (NIP-07, Bunker, or key) to publish your relay list')
    }
    const { tags, readRelays, writeRelays } = buildNip65RelayListTags(relays)
    if (tags.length === 0) {
      throw new Error('Add at least one public wss:// relay with Read or Write enabled')
    }
    const signed = await signer.signEvent({
      kind: KIND_RELAY_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    })
    const targets = [
      ...new Set([
        ...writeRelays,
        ...get().userWriteRelays,
        ...useSettingsStore.getState().getWriteRelays(),
        ...DEFAULT_RELAYS.map((r) => r.url),
      ]),
    ].slice(0, 14)
    const results = await nostrPool.publish(targets, signed)
    const okCount = results.filter((r) => r.ok).length
    if (okCount === 0) {
      throw new Error('Could not publish relay list to any relay — check your connection and try again')
    }
    set({
      userReadRelays: readRelays,
      userWriteRelays: writeRelays,
      toastMessage: `Published ${tags.length} relays (NIP-65) to ${okCount}/${targets.length} relays`,
    })
    return { okCount, totalRelays: targets.length, publishedCount: tags.length }
  },

  publishBlossomList: async (servers) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      throw new Error('Sign in with a signing method (NIP-07, Bunker, or key) to publish your Blossom list')
    }
    const { tags, servers: cleanServers } = buildBud03BlossomListTags(servers)
    if (tags.length === 0) {
      throw new Error('Add at least one public https:// Blossom server first')
    }
    const signed = await signer.signEvent({
      kind: KIND_BLOSSOM_SERVER_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    })
    const targets = [
      ...new Set([
        ...get().userWriteRelays,
        ...useSettingsStore.getState().getWriteRelays(),
        ...DEFAULT_RELAYS.map((r) => r.url),
      ]),
    ].slice(0, 12)
    const results = await nostrPool.publish(targets, signed)
    const okCount = results.filter((r) => r.ok).length
    if (okCount === 0) {
      throw new Error('Could not publish Blossom list to any relay — check your connection and try again')
    }
    set({
      toastMessage: `Published ${cleanServers.length} Blossom ${cleanServers.length === 1 ? 'server' : 'servers'} (BUD-03) to ${okCount}/${targets.length} relays`,
    })
    return { okCount, totalRelays: targets.length, publishedCount: cleanServers.length }
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
          .map((t) => sanitizePublicRelayUrl(t[1]))
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
