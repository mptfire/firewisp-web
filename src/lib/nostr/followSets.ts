import type { Event } from 'nostr-tools/pure'
import { isValidHex64 } from '../sanitize'
import {
  computeNextReplaceableCreatedAt,
  decryptMuteListContent,
  encryptMuteListTags,
} from './lists'

export const KIND_FOLLOW_SET = 30000

export interface FollowSet {
  pubkey: string
  dTag: string
  name: string
  members: string[]
  publicMembers: string[]
  privateMembers: string[]
  isPrivate: boolean
  isLocked: boolean
  createdAt: number
  eventId: string
  rawPublicTags: string[][]
  rawPrivateTags: string[][]
}

const RESERVED_PUBLIC_TAGS = new Set(['d', 'title', 'name', 'p'])
const RESERVED_PRIVATE_TAGS = new Set(['title', 'name', 'p'])

/**
 * Filters out internal client/Ditto state coordinates like `notifications/lastOpened`
 * or `chats/<hex>/lastOpened` so they are never exposed or overwritten as user Lists.
 */
export function isAppStateDTag(dTag: string): boolean {
  const clean = dTag.trim()
  return !clean || clean.includes('/')
}

export type ListFeedKey = `list:${string}`

export function makeListFeedKey(dTag: string): ListFeedKey {
  return `list:${dTag}`
}

export function isListFeedKey(value: unknown): value is ListFeedKey {
  return (
    typeof value === 'string' &&
    value.startsWith('list:') &&
    value.length > 5 &&
    !isAppStateDTag(value.slice(5))
  )
}

export function getListFeedDTag(value: string): string | null {
  return isListFeedKey(value) ? value.slice(5) : null
}

export function makePublicDTag(name: string, existingDTags?: Iterable<string>): string {
  const used = new Set(existingDTags || [])
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export function makePrivateDTag(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `p-${hex}`
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

export function parseFollowSetEvent(
  event: Pick<Event, 'id' | 'kind' | 'pubkey' | 'content' | 'tags' | 'created_at'>,
  decryptedPrivateTags?: readonly string[][] | null,
): FollowSet | null {
  if (event.kind !== KIND_FOLLOW_SET) return null
  const rawPublicTags = normalizeTagArray(event.tags || [])
  const dTag = rawPublicTags.find((t) => t[0] === 'd' && typeof t[1] === 'string')?.[1]
  if (!dTag || isAppStateDTag(dTag)) return null

  const pubMembers = new Set<string>()
  let pubTitle: string | undefined
  let pubName: string | undefined

  for (const t of rawPublicTags) {
    if (t[0] === 'p' && t[1] && isValidHex64(t[1].trim())) {
      pubMembers.add(t[1].trim().toLowerCase())
    } else if (t[0] === 'title' && t[1]?.trim()) {
      pubTitle = t[1].trim()
    } else if (t[0] === 'name' && t[1]?.trim()) {
      pubName = t[1].trim()
    }
  }

  const privMembers = new Set<string>()
  let privTitle: string | undefined
  let privName: string | undefined
  const rawPrivateTags = Array.isArray(decryptedPrivateTags)
    ? normalizeTagArray(decryptedPrivateTags)
    : []

  for (const t of rawPrivateTags) {
    if (t[0] === 'p' && t[1] && isValidHex64(t[1].trim())) {
      privMembers.add(t[1].trim().toLowerCase())
    } else if (t[0] === 'title' && t[1]?.trim()) {
      privTitle = t[1].trim()
    } else if (t[0] === 'name' && t[1]?.trim()) {
      privName = t[1].trim()
    }
  }

  const hasEncryptedContent = Boolean(event.content && event.content.trim())
  const isLocked = hasEncryptedContent && decryptedPrivateTags === null
  const isPrivate = hasEncryptedContent && pubMembers.size === 0

  const allMembers = [...new Set([...pubMembers, ...privMembers])]
  const resolvedName =
    pubTitle || pubName || privTitle || privName || (isPrivate && isLocked ? 'Encrypted list' : dTag)

  return {
    pubkey: event.pubkey.toLowerCase(),
    dTag,
    name: resolvedName,
    members: allMembers,
    publicMembers: [...pubMembers],
    privateMembers: [...privMembers],
    isPrivate,
    isLocked,
    createdAt: event.created_at,
    eventId: event.id,
    rawPublicTags,
    rawPrivateTags,
  }
}

export function buildUpdatedFollowSetPayload(params: {
  dTag: string
  title: string
  members: readonly string[]
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
  const cleanTitle = params.title.trim() || params.dTag
  const validMembers = [
    ...new Set(
      params.members
        .map((m) => m.trim().toLowerCase())
        .filter((m) => isValidHex64(m)),
    ),
  ]

  const preservedPublic = (params.basePublicTags || [])
    .filter((t) => !RESERVED_PUBLIC_TAGS.has(t[0]))
    .map((t) => [...t])
  const preservedPrivate = (params.basePrivateTags || [])
    .filter((t) => !RESERVED_PRIVATE_TAGS.has(t[0]))
    .map((t) => [...t])

  if (params.isPrivate) {
    return {
      publicTags: [['d', params.dTag], ...preservedPublic],
      privateTags: [
        ['title', cleanTitle],
        ...validMembers.map((pk) => ['p', pk]),
        ...preservedPrivate,
      ],
    }
  }

  return {
    publicTags: [
      ['d', params.dTag],
      ['title', cleanTitle],
      ...validMembers.map((pk) => ['p', pk]),
      ...preservedPublic,
    ],
    privateTags: preservedPrivate,
  }
}

export function buildFollowSetDeletionTags(
  pubkey: string,
  dTag: string,
  eventId?: string,
): string[][] {
  const tags: string[][] = [['a', `${KIND_FOLLOW_SET}:${pubkey.toLowerCase()}:${dTag}`]]
  if (eventId && isValidHex64(eventId)) tags.push(['e', eventId.toLowerCase()])
  tags.push(['k', String(KIND_FOLLOW_SET)])
  return tags
}

export { computeNextReplaceableCreatedAt, decryptMuteListContent, encryptMuteListTags }
