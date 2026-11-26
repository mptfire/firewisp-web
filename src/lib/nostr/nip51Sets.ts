import type { Event } from 'nostr-tools/pure'
import { isValidHex64, sanitizePublicRelayUrl } from '../sanitize'
import { isAppStateDTag, type ListFeedKey } from './followSets'

export const KIND_RELAY_SET = 30002
export const KIND_BOOKMARK_SET = 30003
export const KIND_INTEREST_SET = 30015
export const MAX_RELAY_SET_ACTIVE_RELAYS = 8

export type Nip51SetKind =
  | typeof KIND_RELAY_SET
  | typeof KIND_BOOKMARK_SET
  | typeof KIND_INTEREST_SET

export type Nip51SetType = 'bookmarks' | 'interests' | 'relays'

export const SET_TYPE_TO_KIND: Record<Nip51SetType, Nip51SetKind> = {
  bookmarks: KIND_BOOKMARK_SET,
  interests: KIND_INTEREST_SET,
  relays: KIND_RELAY_SET,
}

export const SET_KIND_TO_TYPE: Record<Nip51SetKind, Nip51SetType> = {
  [KIND_BOOKMARK_SET]: 'bookmarks',
  [KIND_INTEREST_SET]: 'interests',
  [KIND_RELAY_SET]: 'relays',
}

export const SET_ITEM_TAG: Record<Nip51SetKind, 'e' | 't' | 'relay'> = {
  [KIND_BOOKMARK_SET]: 'e',
  [KIND_INTEREST_SET]: 't',
  [KIND_RELAY_SET]: 'relay',
}

export interface Nip51ItemSet {
  kind: Nip51SetKind
  type: Nip51SetType
  pubkey: string
  dTag: string
  name: string
  items: string[]
  publicItems: string[]
  privateItems: string[]
  isPrivate: boolean
  isLocked: boolean
  createdAt: number
  eventId: string
  rawPublicTags: string[][]
  rawPrivateTags: string[][]
}

export type InterestFeedKey = `interest:${string}`
export type RelaySetFeedKey = `relayset:${string}`
export type CustomFeedKey = ListFeedKey | InterestFeedKey | RelaySetFeedKey

export function makeInterestFeedKey(dTag: string): InterestFeedKey {
  return `interest:${dTag}`
}

export function isInterestFeedKey(value: unknown): value is InterestFeedKey {
  return (
    typeof value === 'string' &&
    value.startsWith('interest:') &&
    value.length > 9 &&
    !isAppStateDTag(value.slice(9))
  )
}

export function getInterestFeedDTag(value: string): string | null {
  return isInterestFeedKey(value) ? value.slice(9) : null
}

export function makeRelaySetFeedKey(dTag: string): RelaySetFeedKey {
  return `relayset:${dTag}`
}

export function isRelaySetFeedKey(value: unknown): value is RelaySetFeedKey {
  return (
    typeof value === 'string' &&
    value.startsWith('relayset:') &&
    value.length > 9 &&
    !isAppStateDTag(value.slice(9))
  )
}

export function getRelaySetFeedDTag(value: string): string | null {
  return isRelaySetFeedKey(value) ? value.slice(9) : null
}

export function isAnyCustomFeedKey(value: unknown): value is CustomFeedKey {
  if (typeof value !== 'string') return false
  if (
    value.startsWith('list:') &&
    value.length > 5 &&
    !isAppStateDTag(value.slice(5))
  ) {
    return true
  }
  return isInterestFeedKey(value) || isRelaySetFeedKey(value)
}

export function getCustomFeedStorageKey(tab: CustomFeedKey): string {
  if (tab.startsWith('list:')) return tab.slice(5)
  return tab
}

const HASHTAG_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/i

export function normalizeNip51SetItem(kind: Nip51SetKind, raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (kind === KIND_BOOKMARK_SET) {
    return isValidHex64(clean) ? clean.toLowerCase() : null
  }
  if (kind === KIND_INTEREST_SET) {
    const tag = clean.replace(/^#+/, '').trim().toLowerCase()
    return HASHTAG_RE.test(tag) ? tag : null
  }
  return sanitizePublicRelayUrl(clean)
}

export function capActiveRelaySetUrls(relays: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of relays) {
    const safe = sanitizePublicRelayUrl(raw)
    if (!safe || seen.has(safe)) continue
    seen.add(safe)
    out.push(safe)
    if (out.length >= MAX_RELAY_SET_ACTIVE_RELAYS) break
  }
  return out
}

function normalizeTagArray(raw: readonly unknown[]): string[][] {
  const out: string[][] = []
  for (const item of raw) {
    if (Array.isArray(item) && item.length > 0 && item.every((x) => typeof x === 'string')) {
      out.push([...(item as string[])])
    }
  }
  return out
}

export function isNip51ItemSetKind(kind: number): kind is Nip51SetKind {
  return kind === KIND_RELAY_SET || kind === KIND_BOOKMARK_SET || kind === KIND_INTEREST_SET
}

export function parseNip51SetEvent(
  event: Pick<Event, 'id' | 'kind' | 'pubkey' | 'content' | 'tags' | 'created_at'>,
  decryptedPrivateTags?: readonly string[][] | null,
): Nip51ItemSet | null {
  if (!isNip51ItemSetKind(event.kind)) return null
  const kind = event.kind
  const itemTag = SET_ITEM_TAG[kind]
  const rawPublicTags = normalizeTagArray(event.tags || [])
  const dTag = rawPublicTags.find((t) => t[0] === 'd' && typeof t[1] === 'string')?.[1]
  if (!dTag || isAppStateDTag(dTag)) return null

  const pubItems = new Set<string>()
  let pubTitle: string | undefined
  let pubName: string | undefined

  for (const t of rawPublicTags) {
    if (t[0] === itemTag && t[1]) {
      const normalized = normalizeNip51SetItem(kind, t[1])
      if (normalized) pubItems.add(normalized)
    } else if (t[0] === 'title' && t[1]?.trim()) {
      pubTitle = t[1].trim()
    } else if (t[0] === 'name' && t[1]?.trim()) {
      pubName = t[1].trim()
    }
  }

  const privItems = new Set<string>()
  let privTitle: string | undefined
  let privName: string | undefined
  const rawPrivateTags = Array.isArray(decryptedPrivateTags)
    ? normalizeTagArray(decryptedPrivateTags)
    : []

  for (const t of rawPrivateTags) {
    if (t[0] === itemTag && t[1]) {
      const normalized = normalizeNip51SetItem(kind, t[1])
      if (normalized) privItems.add(normalized)
    } else if (t[0] === 'title' && t[1]?.trim()) {
      privTitle = t[1].trim()
    } else if (t[0] === 'name' && t[1]?.trim()) {
      privName = t[1].trim()
    }
  }

  const hasEncryptedContent = Boolean(event.content && event.content.trim())
  const isLocked = hasEncryptedContent && decryptedPrivateTags === null
  const isPrivate = hasEncryptedContent && pubItems.size === 0

  const allItems = [...new Set([...pubItems, ...privItems])]
  const resolvedName =
    pubTitle || pubName || privTitle || privName || (isPrivate && isLocked ? 'Encrypted list' : dTag)

  return {
    kind,
    type: SET_KIND_TO_TYPE[kind],
    pubkey: event.pubkey.toLowerCase(),
    dTag,
    name: resolvedName,
    items: allItems,
    publicItems: [...pubItems],
    privateItems: [...privItems],
    isPrivate,
    isLocked,
    createdAt: event.created_at,
    eventId: event.id,
    rawPublicTags,
    rawPrivateTags,
  }
}

export function buildUpdatedNip51SetPayload(params: {
  kind: Nip51SetKind
  dTag: string
  title: string
  items: readonly string[]
  isPrivate: boolean
  basePublicTags?: readonly string[][]
  basePrivateTags?: readonly string[][]
  isLocked?: boolean
}): {
  publicTags: string[][]
  privateTags: string[][]
} {
  if (params.isLocked) {
    throw new Error('Cannot modify a locked encrypted list until it has been decrypted')
  }
  const itemTag = SET_ITEM_TAG[params.kind]
  const cleanTitle = params.title.trim() || params.dTag
  const reservedPublic = new Set(['d', 'title', 'name', itemTag])
  const reservedPrivate = new Set(['title', 'name', itemTag])

  const validItems: string[] = []
  const seen = new Set<string>()
  for (const raw of params.items) {
    const normalized = normalizeNip51SetItem(params.kind, raw)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    validItems.push(normalized)
  }

  const preservedPublic = (params.basePublicTags || [])
    .filter((t) => !reservedPublic.has(t[0]))
    .map((t) => [...t])
  const preservedPrivate = (params.basePrivateTags || [])
    .filter((t) => !reservedPrivate.has(t[0]))
    .map((t) => [...t])

  if (params.isPrivate) {
    return {
      publicTags: [['d', params.dTag], ...preservedPublic],
      privateTags: [
        ['title', cleanTitle],
        ...validItems.map((item) => [itemTag, item]),
        ...preservedPrivate,
      ],
    }
  }

  return {
    publicTags: [
      ['d', params.dTag],
      ['title', cleanTitle],
      ...validItems.map((item) => [itemTag, item]),
      ...preservedPublic,
    ],
    privateTags: preservedPrivate,
  }
}

export function buildNip51SetDeletionTags(
  kind: Nip51SetKind,
  pubkey: string,
  dTag: string,
  eventId?: string,
): string[][] {
  const tags: string[][] = [['a', `${kind}:${pubkey.toLowerCase()}:${dTag}`]]
  if (eventId && isValidHex64(eventId)) tags.push(['e', eventId.toLowerCase()])
  tags.push(['k', String(kind)])
  return tags
}
