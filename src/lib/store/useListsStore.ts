import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { isValidHex64 } from '../sanitize'
import {
  buildFollowSetDeletionTags,
  buildUpdatedFollowSetPayload,
  computeNextReplaceableCreatedAt,
  decryptMuteListContent,
  encryptMuteListTags,
  isAppStateDTag,
  KIND_FOLLOW_SET,
  makeListFeedKey,
  makePrivateDTag,
  makePublicDTag,
  parseFollowSetEvent,
  type FollowSet,
} from '../nostr/followSets'
import {
  buildNip51SetDeletionTags,
  buildUpdatedNip51SetPayload,
  KIND_BOOKMARK_SET,
  KIND_INTEREST_SET,
  KIND_RELAY_SET,
  makeInterestFeedKey,
  makeRelaySetFeedKey,
  normalizeNip51SetItem,
  parseNip51SetEvent,
  SET_KIND_TO_TYPE,
  type Nip51ItemSet,
  type Nip51SetKind,
} from '../nostr/nip51Sets'
import { nostrPool } from '../nostr/pool'
import { useAuthStore } from './useAuthStore'
import { useNostrStore, type FeedTab } from './useNostrStore'
import { useSettingsStore, type SidebarFeedMode } from './useSettingsStore'

const PUBLIC_LISTS_CACHE_KEY = 'firewisp_public_lists_v1'
const PUBLIC_SETS_CACHE_KEY = 'firewisp_public_nip51_sets_v1'
const listMutationQueues = new Map<string, Promise<unknown>>()

function enqueueListMutation<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = listMutationQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  const tail = next
    .catch(() => undefined)
    .finally(() => {
      if (listMutationQueues.get(key) === tail) {
        listMutationQueues.delete(key)
      }
    })
  listMutationQueues.set(key, tail)
  return next
}

function getSetBucketKey(kind: Nip51SetKind): 'bookmarkSets' | 'interestSets' | 'relaySets' {
  if (kind === KIND_BOOKMARK_SET) return 'bookmarkSets'
  if (kind === KIND_INTEREST_SET) return 'interestSets'
  return 'relaySets'
}

function getCustomFeedKeyForItemSet(kind: Nip51SetKind, dTag: string): FeedTab | null {
  if (kind === KIND_INTEREST_SET) return makeInterestFeedKey(dTag)
  if (kind === KIND_RELAY_SET) return makeRelaySetFeedKey(dTag)
  return null
}

function loadPublicListsCache(pubkey: string): Record<string, FollowSet> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(PUBLIC_LISTS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { pubkey?: unknown; lists?: unknown }
    if (
      typeof parsed.pubkey !== 'string' ||
      parsed.pubkey.toLowerCase() !== pubkey.toLowerCase() ||
      !Array.isArray(parsed.lists)
    ) {
      return {}
    }
    const map: Record<string, FollowSet> = {}
    for (const item of parsed.lists) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Partial<FollowSet>
      if (
        typeof candidate.dTag !== 'string' ||
        isAppStateDTag(candidate.dTag) ||
        candidate.isPrivate
      ) {
        continue
      }
      const members = Array.isArray(candidate.members)
        ? candidate.members.filter((m): m is string => typeof m === 'string' && isValidHex64(m))
        : []
      map[candidate.dTag] = {
        pubkey: pubkey.toLowerCase(),
        dTag: candidate.dTag,
        name: typeof candidate.name === 'string' && candidate.name ? candidate.name : candidate.dTag,
        members,
        publicMembers: members,
        privateMembers: [],
        isPrivate: false,
        isLocked: false,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
        eventId: typeof candidate.eventId === 'string' ? candidate.eventId : '',
        rawPublicTags: Array.isArray(candidate.rawPublicTags) ? candidate.rawPublicTags : [],
        rawPrivateTags: [],
      }
    }
    return map
  } catch {
    return {}
  }
}

function savePublicListsCache(pubkey: string, lists: Record<string, FollowSet>) {
  if (typeof localStorage === 'undefined') return
  try {
    // PRIVACY INVARIANT: Only public lists are ever cached to localStorage.
    // Private lists & decrypted members remain strictly in RAM and vanish on sign-out.
    const publicOnly = Object.values(lists)
      .filter((l) => !l.isPrivate)
      .map((l) => ({
        dTag: l.dTag,
        name: l.name,
        members: l.publicMembers,
        createdAt: l.createdAt,
        eventId: l.eventId,
        rawPublicTags: l.rawPublicTags,
      }))
    localStorage.setItem(
      PUBLIC_LISTS_CACHE_KEY,
      JSON.stringify({ pubkey: pubkey.toLowerCase(), lists: publicOnly }),
    )
  } catch {
    // ignore storage quota errors
  }
}

function loadPublicSetsCache(pubkey: string): {
  bookmarkSets: Record<string, Nip51ItemSet>
  interestSets: Record<string, Nip51ItemSet>
  relaySets: Record<string, Nip51ItemSet>
} {
  const empty = { bookmarkSets: {}, interestSets: {}, relaySets: {} }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(PUBLIC_SETS_CACHE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { pubkey?: unknown; sets?: unknown }
    if (
      typeof parsed.pubkey !== 'string' ||
      parsed.pubkey.toLowerCase() !== pubkey.toLowerCase() ||
      !Array.isArray(parsed.sets)
    ) {
      return empty
    }
    const out = {
      bookmarkSets: {} as Record<string, Nip51ItemSet>,
      interestSets: {} as Record<string, Nip51ItemSet>,
      relaySets: {} as Record<string, Nip51ItemSet>,
    }
    for (const item of parsed.sets) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Partial<Nip51ItemSet>
      const kind = candidate.kind
      if (
        (kind !== KIND_BOOKMARK_SET &&
          kind !== KIND_INTEREST_SET &&
          kind !== KIND_RELAY_SET) ||
        typeof candidate.dTag !== 'string' ||
        isAppStateDTag(candidate.dTag) ||
        candidate.isPrivate
      ) {
        continue
      }
      const items = Array.isArray(candidate.items)
        ? candidate.items
            .filter((x): x is string => typeof x === 'string')
            .map((x) => normalizeNip51SetItem(kind, x))
            .filter((x): x is string => Boolean(x))
        : []
      const entry: Nip51ItemSet = {
        kind,
        type: SET_KIND_TO_TYPE[kind],
        pubkey: pubkey.toLowerCase(),
        dTag: candidate.dTag,
        name: typeof candidate.name === 'string' && candidate.name ? candidate.name : candidate.dTag,
        items,
        publicItems: items,
        privateItems: [],
        isPrivate: false,
        isLocked: false,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
        eventId: typeof candidate.eventId === 'string' ? candidate.eventId : '',
        rawPublicTags: Array.isArray(candidate.rawPublicTags) ? candidate.rawPublicTags : [],
        rawPrivateTags: [],
      }
      out[getSetBucketKey(kind)][candidate.dTag] = entry
    }
    return out
  } catch {
    return empty
  }
}

function savePublicSetsCache(
  pubkey: string,
  state: {
    bookmarkSets: Record<string, Nip51ItemSet>
    interestSets: Record<string, Nip51ItemSet>
    relaySets: Record<string, Nip51ItemSet>
  },
) {
  if (typeof localStorage === 'undefined') return
  try {
    // PRIVACY INVARIANT: Only public sets are ever cached to localStorage.
    // Private sets & decrypted items remain strictly in RAM and vanish on sign-out.
    const allSets = [
      ...Object.values(state.bookmarkSets),
      ...Object.values(state.interestSets),
      ...Object.values(state.relaySets),
    ]
    const publicOnly = allSets
      .filter((s) => !s.isPrivate)
      .map((s) => ({
        kind: s.kind,
        dTag: s.dTag,
        name: s.name,
        items: s.publicItems,
        createdAt: s.createdAt,
        eventId: s.eventId,
        rawPublicTags: s.rawPublicTags,
      }))
    localStorage.setItem(
      PUBLIC_SETS_CACHE_KEY,
      JSON.stringify({ pubkey: pubkey.toLowerCase(), sets: publicOnly }),
    )
  } catch {
    // ignore storage quota errors
  }
}

function getRelays() {
  const settings = useSettingsStore.getState()
  const nostr = useNostrStore.getState()
  const readRelays = [
    ...new Set([...settings.getReadRelays(), ...nostr.userReadRelays, ...nostr.userWriteRelays]),
  ].slice(0, 10)
  const writeRelays = [
    ...new Set([...settings.getWriteRelays(), ...nostr.userWriteRelays]),
  ].slice(0, 10)
  return { readRelays, writeRelays }
}

function requireSigner() {
  const auth = useAuthStore.getState()
  if (!auth.signer?.canSign) {
    auth.openAuthModal()
    if (auth.pubkey) {
      useNostrStore
        .getState()
        .setToast('Sign in with a signing key (extension, Bunker, or nsec) to edit lists')
    }
    return null
  }
  return auth.signer
}

export interface ListsState {
  ownerPubkey: string | null
  lists: Record<string, FollowSet>
  bookmarkSets: Record<string, Nip51ItemSet>
  interestSets: Record<string, Nip51ItemSet>
  relaySets: Record<string, Nip51ItemSet>
  loading: boolean
  syncStatus: 'idle' | 'syncing' | 'synced' | 'locked'
  deletedCoords: Record<string, number>

  fetchOwnLists: (pubkey: string) => Promise<void>
  createList: (name: string, isPrivate?: boolean) => Promise<FollowSet | null>
  renameList: (dTag: string, newName: string) => Promise<boolean>
  deleteList: (dTag: string) => Promise<boolean>
  addMember: (dTag: string, memberPubkey: string, displayName?: string) => Promise<boolean>
  removeMember: (dTag: string, memberPubkey: string, displayName?: string) => Promise<boolean>

  createItemSet: (
    kind: Nip51SetKind,
    name: string,
    isPrivate?: boolean,
  ) => Promise<Nip51ItemSet | null>
  renameItemSet: (kind: Nip51SetKind, dTag: string, newName: string) => Promise<boolean>
  deleteItemSet: (kind: Nip51SetKind, dTag: string) => Promise<boolean>
  addItemToSet: (
    kind: Nip51SetKind,
    dTag: string,
    rawItem: string,
    displayLabel?: string,
  ) => Promise<boolean>
  removeItemFromSet: (
    kind: Nip51SetKind,
    dTag: string,
    rawItem: string,
    displayLabel?: string,
  ) => Promise<boolean>

  resetLists: () => void
}

async function signAndPublishList(params: {
  dTag: string
  title: string
  members: readonly string[]
  isPrivate: boolean
  existingPrivateMembers?: readonly string[]
  baseEvent?: Pick<Event, 'created_at'> | null
  basePublicTags?: readonly string[][]
  basePrivateTags?: readonly string[][]
  isLocked?: boolean
}): Promise<{ list: FollowSet; okCount: number; totalRelays: number }> {
  const signer = requireSigner()
  if (!signer) throw new Error('Signing key required')

  const { publicTags, privateTags } = buildUpdatedFollowSetPayload(params)
  let content = ''
  if (privateTags.length > 0) {
    content = await encryptMuteListTags(signer, signer.pubkey, privateTags)
  }

  const createdAt = computeNextReplaceableCreatedAt(params.baseEvent)
  const signed = await signer.signEvent({
    kind: KIND_FOLLOW_SET,
    created_at: createdAt,
    tags: publicTags,
    content,
  })

  const { writeRelays } = getRelays()
  if (writeRelays.length === 0) throw new Error('No write relays configured')

  const results = await nostrPool.publish(writeRelays, signed)
  const okCount = results.filter((r) => r.ok).length
  if (okCount === 0) {
    throw new Error('Relays did not accept the updated list')
  }

  const parsed = parseFollowSetEvent(signed, privateTags)
  if (!parsed) throw new Error('Failed to parse updated list')
  return { list: parsed, okCount, totalRelays: writeRelays.length }
}

async function signAndPublishItemSet(params: {
  kind: Nip51SetKind
  dTag: string
  title: string
  items: readonly string[]
  isPrivate: boolean
  existingPrivateItems?: readonly string[]
  baseEvent?: Pick<Event, 'created_at'> | null
  basePublicTags?: readonly string[][]
  basePrivateTags?: readonly string[][]
  isLocked?: boolean
}): Promise<{ setObj: Nip51ItemSet; okCount: number; totalRelays: number }> {
  const signer = requireSigner()
  if (!signer) throw new Error('Signing key required')

  const { publicTags, privateTags } = buildUpdatedNip51SetPayload(params)
  let content = ''
  if (privateTags.length > 0) {
    content = await encryptMuteListTags(signer, signer.pubkey, privateTags)
  }

  const createdAt = computeNextReplaceableCreatedAt(params.baseEvent)
  const signed = await signer.signEvent({
    kind: params.kind,
    created_at: createdAt,
    tags: publicTags,
    content,
  })

  const { writeRelays } = getRelays()
  if (writeRelays.length === 0) throw new Error('No write relays configured')

  const results = await nostrPool.publish(writeRelays, signed)
  const okCount = results.filter((r) => r.ok).length
  if (okCount === 0) {
    throw new Error('Relays did not accept the updated list')
  }

  const parsed = parseNip51SetEvent(signed, privateTags)
  if (!parsed) throw new Error('Failed to parse updated list')
  return { setObj: parsed, okCount, totalRelays: writeRelays.length }
}

const ALL_SET_KINDS = [KIND_FOLLOW_SET, KIND_RELAY_SET, KIND_BOOKMARK_SET, KIND_INTEREST_SET]

export const useListsStore = create<ListsState>((set, get) => ({
  ownerPubkey: null,
  lists: {},
  bookmarkSets: {},
  interestSets: {},
  relaySets: {},
  loading: false,
  syncStatus: 'idle',
  deletedCoords: {},

  fetchOwnLists: async (rawPubkey) => {
    const pubkey = rawPubkey.trim().toLowerCase()
    if (!isValidHex64(pubkey)) return

    const cachedPublic = loadPublicListsCache(pubkey)
    const cachedSets = loadPublicSetsCache(pubkey)
    set((s) => {
      const sameOwner = s.ownerPubkey === pubkey
      return {
        ownerPubkey: pubkey,
        loading: true,
        syncStatus: 'syncing',
        lists: sameOwner && Object.keys(s.lists).length > 0 ? s.lists : cachedPublic,
        bookmarkSets:
          sameOwner && Object.keys(s.bookmarkSets).length > 0
            ? s.bookmarkSets
            : cachedSets.bookmarkSets,
        interestSets:
          sameOwner && Object.keys(s.interestSets).length > 0
            ? s.interestSets
            : cachedSets.interestSets,
        relaySets:
          sameOwner && Object.keys(s.relaySets).length > 0
            ? s.relaySets
            : cachedSets.relaySets,
      }
    })

    try {
      const { readRelays } = getRelays()
      if (readRelays.length === 0) {
        set({ loading: false, syncStatus: 'synced' })
        return
      }

      const [setEvents, delEvents] = await Promise.all([
        nostrPool.query(readRelays, { kinds: ALL_SET_KINDS, authors: [pubkey], limit: 200 }, 4000),
        nostrPool.query(
          readRelays,
          {
            kinds: [5],
            authors: [pubkey],
            '#k': ALL_SET_KINDS.map((k) => String(k)),
            limit: 150,
          },
          3500,
        ),
      ])

      if (useAuthStore.getState().pubkey?.toLowerCase() !== pubkey) return

      const deletedMap: Record<string, number> = { ...get().deletedCoords }
      for (const del of delEvents) {
        for (const t of del.tags) {
          if (t[0] !== 'a' || !t[1]) continue
          const parts = t[1].split(':')
          const k = Number(parts[0])
          if (ALL_SET_KINDS.includes(k) && parts[1]?.toLowerCase() === pubkey) {
            const normCoord = `${parts[0]}:${parts[1].toLowerCase()}:${parts.slice(2).join(':')}`
            deletedMap[normCoord] = Math.max(deletedMap[normCoord] || 0, del.created_at)
          }
        }
      }

      const latestByCoord = new Map<string, Event>()
      for (const ev of setEvents) {
        if (!ALL_SET_KINDS.includes(ev.kind)) continue
        const dTag = ev.tags.find((t) => t[0] === 'd' && t[1])?.[1]
        if (!dTag || isAppStateDTag(dTag)) continue
        const coord = `${ev.kind}:${pubkey}:${dTag}`
        if (deletedMap[coord] && ev.created_at <= deletedMap[coord]) continue
        const prev = latestByCoord.get(coord)
        if (!prev || ev.created_at > prev.created_at) {
          latestByCoord.set(coord, ev)
        }
      }

      const signer = useAuthStore.getState().signer
      const nextLists: Record<string, FollowSet> = {}
      const nextBookmarks: Record<string, Nip51ItemSet> = {}
      const nextInterests: Record<string, Nip51ItemSet> = {}
      const nextRelays: Record<string, Nip51ItemSet> = {}
      const memberPool = new Set<string>()
      let anyLocked = false

      for (const ev of latestByCoord.values()) {
        let decTags: string[][] | null | undefined
        if (ev.content && ev.content.trim()) {
          const dec = await decryptMuteListContent(signer, pubkey, ev.content)
          decTags = dec ? dec.tags : null
        }

        if (ev.kind === KIND_FOLLOW_SET) {
          const parsed = parseFollowSetEvent(ev, decTags)
          if (!parsed) continue
          if (parsed.isLocked) anyLocked = true
          nextLists[parsed.dTag] = parsed
          for (const pk of parsed.members) memberPool.add(pk)
        } else {
          const parsed = parseNip51SetEvent(ev, decTags)
          if (!parsed) continue
          if (parsed.isLocked) anyLocked = true
          if (parsed.kind === KIND_BOOKMARK_SET) nextBookmarks[parsed.dTag] = parsed
          else if (parsed.kind === KIND_INTEREST_SET) nextInterests[parsed.dTag] = parsed
          else nextRelays[parsed.dTag] = parsed
        }
      }

      if (useAuthStore.getState().pubkey?.toLowerCase() !== pubkey) return

      // Preserve any newly created local lists/sets that haven't echoed yet from relays
      for (const [dTag, existing] of Object.entries(get().lists)) {
        const coord = `${KIND_FOLLOW_SET}:${pubkey}:${dTag}`
        if (deletedMap[coord] && existing.createdAt <= deletedMap[coord]) continue
        if (!nextLists[dTag] || existing.createdAt > nextLists[dTag].createdAt) {
          nextLists[dTag] = existing
          for (const pk of existing.members) memberPool.add(pk)
        }
      }

      const mergeLocalBucket = (
        kind: Nip51SetKind,
        local: Record<string, Nip51ItemSet>,
        target: Record<string, Nip51ItemSet>,
      ) => {
        for (const [dTag, existing] of Object.entries(local)) {
          const coord = `${kind}:${pubkey}:${dTag}`
          if (deletedMap[coord] && existing.createdAt <= deletedMap[coord]) continue
          if (!target[dTag] || existing.createdAt > target[dTag].createdAt) {
            target[dTag] = existing
          }
        }
      }
      mergeLocalBucket(KIND_BOOKMARK_SET, get().bookmarkSets, nextBookmarks)
      mergeLocalBucket(KIND_INTEREST_SET, get().interestSets, nextInterests)
      mergeLocalBucket(KIND_RELAY_SET, get().relaySets, nextRelays)

      savePublicListsCache(pubkey, nextLists)
      savePublicSetsCache(pubkey, {
        bookmarkSets: nextBookmarks,
        interestSets: nextInterests,
        relaySets: nextRelays,
      })

      set({
        lists: nextLists,
        bookmarkSets: nextBookmarks,
        interestSets: nextInterests,
        relaySets: nextRelays,
        deletedCoords: deletedMap,
        loading: false,
        syncStatus: anyLocked ? 'locked' : 'synced',
      })

      if (memberPool.size > 0) {
        void useNostrStore.getState().fetchProfiles([...memberPool].slice(0, 120))
      }
    } catch {
      set({ loading: false, syncStatus: 'synced' })
    }
  },

  createList: async (rawName, isPrivate = false) => {
    const cleanName = rawName.trim()
    if (!cleanName) return null
    const signer = requireSigner()
    if (!signer) return null

    const dTag = isPrivate
      ? makePrivateDTag()
      : makePublicDTag(cleanName, Object.keys(get().lists))

    return enqueueListMutation(dTag, async () => {
      try {
        const pk = signer.pubkey.toLowerCase()
        const { list, okCount, totalRelays } = await signAndPublishList({
          dTag,
          title: cleanName,
          members: [],
          isPrivate,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return null
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(pk, nextLists)
        set({ lists: nextLists, ownerPubkey: pk, syncStatus: 'synced' })
        useNostrStore
          .getState()
          .setToast(
            `Created ${isPrivate ? 'private ' : ''}list "${cleanName}" (${okCount}/${totalRelays} relays)`,
          )
        return list
      } catch (err) {
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to create list')
        return null
      }
    })
  },

  renameList: async (dTag, rawNewName) => {
    const cleanName = rawNewName.trim()
    if (!cleanName) return false
    const signer = requireSigner()
    if (!signer) return false

    return enqueueListMutation(dTag, async () => {
      const prev = get().lists[dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      const pk = signer.pubkey.toLowerCase()
      const optimistic: FollowSet = { ...prev, name: cleanName }
      set((s) => ({ lists: { ...s.lists, [dTag]: optimistic } }))

      try {
        const { list } = await signAndPublishList({
          dTag,
          title: cleanName,
          members: prev.members,
          isPrivate: prev.isPrivate,
          existingPrivateMembers: prev.privateMembers,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(pk, nextLists)
        set({ lists: nextLists })
        useNostrStore.getState().setToast(`Renamed list to "${cleanName}"`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to rename list')
        return false
      }
    })
  },

  deleteList: async (dTag) => {
    const signer = requireSigner()
    if (!signer) return false

    return enqueueListMutation(dTag, async () => {
      const prev = get().lists[dTag]
      if (!prev) return false
      const pk = signer.pubkey.toLowerCase()
      const coord = `${KIND_FOLLOW_SET}:${pk}:${dTag}`
      const nowSec = computeNextReplaceableCreatedAt({ created_at: prev.createdAt })
      const prevDeletedTs = get().deletedCoords[coord]

      const remaining = { ...get().lists }
      delete remaining[dTag]
      savePublicListsCache(pk, remaining)
      set((s) => ({
        lists: remaining,
        deletedCoords: { ...s.deletedCoords, [coord]: nowSec },
      }))

      try {
        const delEvent = await signer.signEvent({
          kind: 5,
          created_at: nowSec,
          tags: buildFollowSetDeletionTags(pk, dTag, prev.eventId),
          content: '',
        })
        const { writeRelays } = getRelays()
        const results = writeRelays.length > 0 ? await nostrPool.publish(writeRelays, delEvent) : []
        const okCount = results.filter((r) => r.ok).length
        if (okCount === 0) {
          throw new Error('Relays did not accept list deletion')
        }
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const feedKey = makeListFeedKey(dTag)
        const settings = useSettingsStore.getState()
        settings.unpinListTab(dTag)
        if (settings.sidebarFeedMode === feedKey) {
          settings.setSidebarFeedMode('trending')
        }
        const nostr = useNostrStore.getState()
        nostr.clearFeedTab(feedKey)
        if (nostr.activeFeedTab === feedKey) {
          nostr.setActiveFeedTab('foryou')
        }
        useNostrStore.getState().setToast(`Deleted list "${prev.name}"`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => {
            const nextDeleted = { ...s.deletedCoords }
            if (prevDeletedTs === undefined) delete nextDeleted[coord]
            else nextDeleted[coord] = prevDeletedTs
            return {
              lists: { ...s.lists, [dTag]: prev },
              deletedCoords: nextDeleted,
            }
          })
          savePublicListsCache(pk, get().lists)
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to delete list')
        return false
      }
    })
  },

  addMember: async (dTag, rawMemberPubkey, displayName) => {
    const member = rawMemberPubkey.trim().toLowerCase()
    if (!isValidHex64(member)) return false
    const signer = requireSigner()
    if (!signer) return false

    return enqueueListMutation(dTag, async () => {
      const prev = get().lists[dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      if (prev.members.includes(member)) return true

      const pk = signer.pubkey.toLowerCase()
      const nextMembers = [...prev.members, member]
      const optimistic: FollowSet = {
        ...prev,
        members: nextMembers,
        publicMembers: prev.isPrivate ? prev.publicMembers : [...prev.publicMembers, member],
        privateMembers: prev.isPrivate ? nextMembers : prev.privateMembers,
      }
      set((s) => ({ lists: { ...s.lists, [dTag]: optimistic } }))

      try {
        const { list } = await signAndPublishList({
          dTag,
          title: prev.name,
          members: nextMembers,
          isPrivate: prev.isPrivate,
          existingPrivateMembers: prev.privateMembers,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(pk, nextLists)
        set({ lists: nextLists })
        const label = displayName?.trim() || `${member.slice(0, 8)}…`
        useNostrStore.getState().setToast(`Added ${label} to ${list.name}`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to add person to list')
        return false
      }
    })
  },

  removeMember: async (dTag, rawMemberPubkey, displayName) => {
    const member = rawMemberPubkey.trim().toLowerCase()
    if (!isValidHex64(member)) return false
    const signer = requireSigner()
    if (!signer) return false

    return enqueueListMutation(dTag, async () => {
      const prev = get().lists[dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      if (!prev.members.includes(member)) return true

      const pk = signer.pubkey.toLowerCase()
      const nextMembers = prev.members.filter((m) => m !== member)
      const optimistic: FollowSet = {
        ...prev,
        members: nextMembers,
        publicMembers: prev.publicMembers.filter((m) => m !== member),
        privateMembers: prev.privateMembers.filter((m) => m !== member),
      }
      set((s) => ({ lists: { ...s.lists, [dTag]: optimistic } }))

      try {
        const { list } = await signAndPublishList({
          dTag,
          title: prev.name,
          members: nextMembers,
          isPrivate: prev.isPrivate,
          existingPrivateMembers: prev.privateMembers,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(pk, nextLists)
        set({ lists: nextLists })
        const label = displayName?.trim() || `${member.slice(0, 8)}…`
        useNostrStore.getState().setToast(`Removed ${label} from ${list.name}`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to remove person from list')
        return false
      }
    })
  },

  createItemSet: async (kind, rawName, isPrivate = false) => {
    const cleanName = rawName.trim()
    if (!cleanName) return null
    const signer = requireSigner()
    if (!signer) return null

    const bucketKey = getSetBucketKey(kind)
    const dTag = isPrivate
      ? makePrivateDTag()
      : makePublicDTag(cleanName, Object.keys(get()[bucketKey]))

    return enqueueListMutation(`${kind}:${dTag}`, async () => {
      try {
        const pk = signer.pubkey.toLowerCase()
        const { setObj, okCount, totalRelays } = await signAndPublishItemSet({
          kind,
          dTag,
          title: cleanName,
          items: [],
          isPrivate,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return null
        const nextBucket = { ...get()[bucketKey], [dTag]: setObj }
        const snapshot = {
          bookmarkSets: get().bookmarkSets,
          interestSets: get().interestSets,
          relaySets: get().relaySets,
          [bucketKey]: nextBucket,
        }
        savePublicSetsCache(pk, snapshot)
        set({
          [bucketKey]: nextBucket,
          ownerPubkey: pk,
          syncStatus: 'synced',
        })
        useNostrStore
          .getState()
          .setToast(
            `Created ${isPrivate ? 'private ' : ''}list "${cleanName}" (${okCount}/${totalRelays} relays)`,
          )
        return setObj
      } catch (err) {
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to create list')
        return null
      }
    })
  },

  renameItemSet: async (kind, dTag, rawNewName) => {
    const cleanName = rawNewName.trim()
    if (!cleanName) return false
    const signer = requireSigner()
    if (!signer) return false

    const bucketKey = getSetBucketKey(kind)
    return enqueueListMutation(`${kind}:${dTag}`, async () => {
      const prev = get()[bucketKey][dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      const pk = signer.pubkey.toLowerCase()
      const optimistic: Nip51ItemSet = { ...prev, name: cleanName }
      set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: optimistic } }))

      try {
        const { setObj } = await signAndPublishItemSet({
          kind,
          dTag,
          title: cleanName,
          items: prev.items,
          isPrivate: prev.isPrivate,
          existingPrivateItems: prev.privateItems,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextBucket = { ...get()[bucketKey], [dTag]: setObj }
        savePublicSetsCache(pk, {
          bookmarkSets: get().bookmarkSets,
          interestSets: get().interestSets,
          relaySets: get().relaySets,
          [bucketKey]: nextBucket,
        })
        set({ [bucketKey]: nextBucket })
        useNostrStore.getState().setToast(`Renamed list to "${cleanName}"`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to rename list')
        return false
      }
    })
  },

  deleteItemSet: async (kind, dTag) => {
    const signer = requireSigner()
    if (!signer) return false

    const bucketKey = getSetBucketKey(kind)
    return enqueueListMutation(`${kind}:${dTag}`, async () => {
      const prev = get()[bucketKey][dTag]
      if (!prev) return false
      const pk = signer.pubkey.toLowerCase()
      const coord = `${kind}:${pk}:${dTag}`
      const nowSec = computeNextReplaceableCreatedAt({ created_at: prev.createdAt })
      const prevDeletedTs = get().deletedCoords[coord]

      const remaining = { ...get()[bucketKey] }
      delete remaining[dTag]
      savePublicSetsCache(pk, {
        bookmarkSets: get().bookmarkSets,
        interestSets: get().interestSets,
        relaySets: get().relaySets,
        [bucketKey]: remaining,
      })
      set((s) => ({
        [bucketKey]: remaining,
        deletedCoords: { ...s.deletedCoords, [coord]: nowSec },
      }))

      try {
        const delEvent = await signer.signEvent({
          kind: 5,
          created_at: nowSec,
          tags: buildNip51SetDeletionTags(kind, pk, dTag, prev.eventId),
          content: '',
        })
        const { writeRelays } = getRelays()
        const results = writeRelays.length > 0 ? await nostrPool.publish(writeRelays, delEvent) : []
        const okCount = results.filter((r) => r.ok).length
        if (okCount === 0) {
          throw new Error('Relays did not accept list deletion')
        }
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const feedKey = getCustomFeedKeyForItemSet(kind, dTag)
        if (feedKey) {
          const settings = useSettingsStore.getState()
          settings.unpinListTab(feedKey)
          if (settings.sidebarFeedMode === (feedKey as SidebarFeedMode)) {
            settings.setSidebarFeedMode('trending')
          }
          const nostr = useNostrStore.getState()
          nostr.clearFeedTab(feedKey)
          if (nostr.activeFeedTab === feedKey) {
            nostr.setActiveFeedTab('foryou')
          }
        }
        useNostrStore.getState().setToast(`Deleted list "${prev.name}"`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => {
            const nextDeleted = { ...s.deletedCoords }
            if (prevDeletedTs === undefined) delete nextDeleted[coord]
            else nextDeleted[coord] = prevDeletedTs
            return {
              [bucketKey]: { ...s[bucketKey], [dTag]: prev },
              deletedCoords: nextDeleted,
            }
          })
          savePublicSetsCache(pk, {
            bookmarkSets: get().bookmarkSets,
            interestSets: get().interestSets,
            relaySets: get().relaySets,
          })
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to delete list')
        return false
      }
    })
  },

  addItemToSet: async (kind, dTag, rawItem, displayLabel) => {
    const item = normalizeNip51SetItem(kind, rawItem)
    if (!item) return false
    const signer = requireSigner()
    if (!signer) return false

    const bucketKey = getSetBucketKey(kind)
    return enqueueListMutation(`${kind}:${dTag}`, async () => {
      const prev = get()[bucketKey][dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      if (prev.items.includes(item)) return true

      const pk = signer.pubkey.toLowerCase()
      const nextItems = [...prev.items, item]
      const optimistic: Nip51ItemSet = {
        ...prev,
        items: nextItems,
        publicItems: prev.isPrivate ? prev.publicItems : [...prev.publicItems, item],
        privateItems: prev.isPrivate ? nextItems : prev.privateItems,
      }
      set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: optimistic } }))

      try {
        const { setObj } = await signAndPublishItemSet({
          kind,
          dTag,
          title: prev.name,
          items: nextItems,
          isPrivate: prev.isPrivate,
          existingPrivateItems: prev.privateItems,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextBucket = { ...get()[bucketKey], [dTag]: setObj }
        savePublicSetsCache(pk, {
          bookmarkSets: get().bookmarkSets,
          interestSets: get().interestSets,
          relaySets: get().relaySets,
          [bucketKey]: nextBucket,
        })
        set({ [bucketKey]: nextBucket })
        const label = displayLabel?.trim() || item.slice(0, 28)
        useNostrStore.getState().setToast(`Added ${label} to ${setObj.name}`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to update list')
        return false
      }
    })
  },

  removeItemFromSet: async (kind, dTag, rawItem, displayLabel) => {
    const item = normalizeNip51SetItem(kind, rawItem)
    if (!item) return false
    const signer = requireSigner()
    if (!signer) return false

    const bucketKey = getSetBucketKey(kind)
    return enqueueListMutation(`${kind}:${dTag}`, async () => {
      const prev = get()[bucketKey][dTag]
      if (!prev) return false
      if (prev.isLocked) {
        useNostrStore
          .getState()
          .setToast('Unlock & decrypt your encrypted list first before editing')
        return false
      }
      if (!prev.items.includes(item)) return true

      const pk = signer.pubkey.toLowerCase()
      const nextItems = prev.items.filter((x) => x !== item)
      const optimistic: Nip51ItemSet = {
        ...prev,
        items: nextItems,
        publicItems: prev.publicItems.filter((x) => x !== item),
        privateItems: prev.privateItems.filter((x) => x !== item),
      }
      set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: optimistic } }))

      try {
        const { setObj } = await signAndPublishItemSet({
          kind,
          dTag,
          title: prev.name,
          items: nextItems,
          isPrivate: prev.isPrivate,
          existingPrivateItems: prev.privateItems,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        if (useAuthStore.getState().pubkey?.toLowerCase() !== pk) return false
        const nextBucket = { ...get()[bucketKey], [dTag]: setObj }
        savePublicSetsCache(pk, {
          bookmarkSets: get().bookmarkSets,
          interestSets: get().interestSets,
          relaySets: get().relaySets,
          [bucketKey]: nextBucket,
        })
        set({ [bucketKey]: nextBucket })
        const label = displayLabel?.trim() || item.slice(0, 28)
        useNostrStore.getState().setToast(`Removed ${label} from ${setObj.name}`)
        return true
      } catch (err) {
        if (useAuthStore.getState().pubkey?.toLowerCase() === pk) {
          set((s) => ({ [bucketKey]: { ...s[bucketKey], [dTag]: prev } }))
        }
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to update list')
        return false
      }
    })
  },

  resetLists: () => {
    set({
      ownerPubkey: null,
      lists: {},
      bookmarkSets: {},
      interestSets: {},
      relaySets: {},
      loading: false,
      syncStatus: 'idle',
      deletedCoords: {},
    })
  },
}))
