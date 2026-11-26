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
  makePrivateDTag,
  makePublicDTag,
  parseFollowSetEvent,
  type FollowSet,
} from '../nostr/followSets'
import { nostrPool } from '../nostr/pool'
import { useAuthStore } from './useAuthStore'
import { useNostrStore } from './useNostrStore'
import { useSettingsStore } from './useSettingsStore'

const PUBLIC_LISTS_CACHE_KEY = 'firewisp_public_lists_v1'
const listMutationQueues = new Map<string, Promise<unknown>>()

function enqueueListMutation<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = listMutationQueues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  listMutationQueues.set(
    key,
    next.catch(() => undefined),
  )
  return next
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
  loading: boolean
  syncStatus: 'idle' | 'syncing' | 'synced' | 'locked'
  deletedCoords: Record<string, number>

  fetchOwnLists: (pubkey: string) => Promise<void>
  createList: (name: string, isPrivate?: boolean) => Promise<FollowSet | null>
  renameList: (dTag: string, newName: string) => Promise<boolean>
  deleteList: (dTag: string) => Promise<boolean>
  addMember: (dTag: string, memberPubkey: string, displayName?: string) => Promise<boolean>
  removeMember: (dTag: string, memberPubkey: string, displayName?: string) => Promise<boolean>
  resetLists: () => void
}

async function signAndPublishList(params: {
  dTag: string
  title: string
  members: readonly string[]
  isPrivate: boolean
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

export const useListsStore = create<ListsState>((set, get) => ({
  ownerPubkey: null,
  lists: {},
  loading: false,
  syncStatus: 'idle',
  deletedCoords: {},

  fetchOwnLists: async (rawPubkey) => {
    const pubkey = rawPubkey.trim().toLowerCase()
    if (!isValidHex64(pubkey)) return

    const cachedPublic = loadPublicListsCache(pubkey)
    set((s) => ({
      ownerPubkey: pubkey,
      loading: true,
      syncStatus: 'syncing',
      lists: Object.keys(s.lists).length > 0 && s.ownerPubkey === pubkey ? s.lists : cachedPublic,
    }))

    try {
      const { readRelays } = getRelays()
      if (readRelays.length === 0) {
        set({ loading: false, syncStatus: 'synced' })
        return
      }

      const [setEvents, delEvents] = await Promise.all([
        nostrPool.query(readRelays, { kinds: [KIND_FOLLOW_SET], authors: [pubkey], limit: 100 }, 4000),
        nostrPool.query(
          readRelays,
          { kinds: [5], authors: [pubkey], '#k': [String(KIND_FOLLOW_SET)], limit: 100 },
          3500,
        ),
      ])

      if (useAuthStore.getState().pubkey?.toLowerCase() !== pubkey) return

      const deletedMap: Record<string, number> = { ...get().deletedCoords }
      for (const del of delEvents) {
        for (const t of del.tags) {
          if (t[0] === 'a' && t[1]?.startsWith(`${KIND_FOLLOW_SET}:${pubkey}:`)) {
            deletedMap[t[1]] = Math.max(deletedMap[t[1]] || 0, del.created_at)
          }
        }
      }

      const latestByDTag = new Map<string, Event>()
      for (const ev of setEvents) {
        const dTag = ev.tags.find((t) => t[0] === 'd' && t[1])?.[1]
        if (!dTag || isAppStateDTag(dTag)) continue
        const coord = `${KIND_FOLLOW_SET}:${pubkey}:${dTag}`
        if (deletedMap[coord] && ev.created_at <= deletedMap[coord]) continue
        const prev = latestByDTag.get(dTag)
        if (!prev || ev.created_at > prev.created_at) {
          latestByDTag.set(dTag, ev)
        }
      }

      const signer = useAuthStore.getState().signer
      const nextLists: Record<string, FollowSet> = {}
      const memberPool = new Set<string>()
      let anyLocked = false

      for (const [dTag, ev] of latestByDTag.entries()) {
        let decTags: string[][] | null | undefined
        if (ev.content && ev.content.trim()) {
          const dec = await decryptMuteListContent(signer, pubkey, ev.content)
          decTags = dec ? dec.tags : null
        }
        const parsed = parseFollowSetEvent(ev, decTags)
        if (!parsed) continue
        if (parsed.isLocked) anyLocked = true
        nextLists[dTag] = parsed
        for (const pk of parsed.members) memberPool.add(pk)
      }

      if (useAuthStore.getState().pubkey?.toLowerCase() !== pubkey) return

      // Preserve any newly created local list that hasn't echoed yet from relays
      for (const [dTag, existing] of Object.entries(get().lists)) {
        const coord = `${KIND_FOLLOW_SET}:${pubkey}:${dTag}`
        if (deletedMap[coord] && existing.createdAt <= deletedMap[coord]) continue
        if (!nextLists[dTag] || existing.createdAt > nextLists[dTag].createdAt) {
          nextLists[dTag] = existing
          for (const pk of existing.members) memberPool.add(pk)
        }
      }

      savePublicListsCache(pubkey, nextLists)
      set({
        lists: nextLists,
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
        const { list, okCount, totalRelays } = await signAndPublishList({
          dTag,
          title: cleanName,
          members: [],
          isPrivate,
        })
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(signer.pubkey, nextLists)
        set({ lists: nextLists, ownerPubkey: signer.pubkey.toLowerCase(), syncStatus: 'synced' })
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
      const optimistic: FollowSet = { ...prev, name: cleanName }
      set((s) => ({ lists: { ...s.lists, [dTag]: optimistic } }))

      try {
        const { list } = await signAndPublishList({
          dTag,
          title: cleanName,
          members: prev.members,
          isPrivate: prev.isPrivate,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(signer.pubkey, nextLists)
        set({ lists: nextLists })
        useNostrStore.getState().setToast(`Renamed list to "${cleanName}"`)
        return true
      } catch (err) {
        set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
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
      const nowSec = Math.floor(Date.now() / 1000)

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
        await nostrPool.publish(writeRelays, delEvent)
        useNostrStore.getState().setToast(`Deleted list "${prev.name}"`)
        return true
      } catch (err) {
        // Restore on sign failure
        set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
        savePublicListsCache(pk, get().lists)
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

      const nextMembers = [...prev.members, member]
      const optimistic: FollowSet = {
        ...prev,
        members: nextMembers,
        publicMembers: prev.isPrivate ? prev.publicMembers : nextMembers,
        privateMembers: prev.isPrivate ? nextMembers : prev.privateMembers,
      }
      set((s) => ({ lists: { ...s.lists, [dTag]: optimistic } }))

      try {
        const { list } = await signAndPublishList({
          dTag,
          title: prev.name,
          members: nextMembers,
          isPrivate: prev.isPrivate,
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(signer.pubkey, nextLists)
        set({ lists: nextLists })
        const label = displayName?.trim() || `${member.slice(0, 8)}…`
        useNostrStore.getState().setToast(`Added ${label} to ${list.name}`)
        return true
      } catch (err) {
        set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
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
          baseEvent: { created_at: prev.createdAt },
          basePublicTags: prev.rawPublicTags,
          basePrivateTags: prev.rawPrivateTags,
        })
        const nextLists = { ...get().lists, [dTag]: list }
        savePublicListsCache(signer.pubkey, nextLists)
        set({ lists: nextLists })
        const label = displayName?.trim() || `${member.slice(0, 8)}…`
        useNostrStore.getState().setToast(`Removed ${label} from ${list.name}`)
        return true
      } catch (err) {
        set((s) => ({ lists: { ...s.lists, [dTag]: prev } }))
        useNostrStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Failed to remove person from list')
        return false
      }
    })
  },

  resetLists: () => {
    set({
      ownerPubkey: null,
      lists: {},
      loading: false,
      syncStatus: 'idle',
      deletedCoords: {},
    })
  },
}))
