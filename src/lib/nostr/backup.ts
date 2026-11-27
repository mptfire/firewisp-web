import { verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import { nostrPool } from './pool'
import type { FireWispSigner } from './signer'
import { isValidHex64, sanitizePublicHttpsUrl, sanitizeRelayUrl } from '../sanitize'

/**
 * Replaceable and addressable Nostr kinds prioritized during account backup
 * so profile, follows, mutes, relay list, Blossom servers, and curated lists
 * are always included even when full note pagination stops early.
 */
export const BACKUP_REPLACEABLE_KINDS: readonly number[] = [
  0,     // Profile metadata
  3,     // Follow list
  10000, // Mute list
  10001, // Pin list
  10002, // NIP-65 Relay list
  10003, // Bookmarks
  10004, // Communities
  10005, // Public chats
  10006, // Blocked relays
  10007, // Search relays
  10015, // Interests
  10063, // Blossom media server list
  30000, // Categorized people / follow sets
  30001, // Categorized bookmarks / generic lists
  30002, // Relay sets
  30003, // Bookmark sets
  30008, // Profile badges
  30009, // Badge definition
  30015, // Interest sets
  30023, // Long-form articles
  30078, // App-specific data
  30311, // Live events
]

export const BACKUP_HISTORY_KINDS: readonly number[] = [
  1,    // Short text notes & replies
  6,    // Reposts
  7,    // Reactions
  16,   // Generic reposts
  1111, // NIP-22 comments
  9802, // Highlights
]

export interface BackupProgress {
  phase: 'querying' | 'publishing' | 'done' | 'cancelled'
  fetched: number
  page?: number
  published: number
  failed: number
  total: number
  message?: string
}

export interface ParsedBackupSummary {
  events: Event[]
  totalLines: number
  validCount: number
  invalidSignatureCount: number
  foreignAuthorCount: number
  malformedLineCount: number
  duplicateCount: number
  kindCounts: Record<number, number>
  latestFollowsEvent: Event | null
  latestMuteEvent: Event | null
  latestProfileEvent: Event | null
  latestRelayListEvent: Event | null
  mediaUrls: string[]
}

const MEDIA_URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`)\]]+/gi
const MEDIA_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|mp4|mov|m4v|webm|m3u8|mp3|ogg|wav|flac|aac|m4a)(?:[?#].*)?$/i

function verifyEventStrict(ev: Event): boolean {
  return verifyEvent({
    id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    kind: ev.kind,
    tags: ev.tags,
    content: ev.content,
    sig: ev.sig,
  })
}

function normalizeMediaUrl(raw: string): string | null {
  const cleaned = raw.replace(/[.,;:!?)]+$/, '')
  return sanitizePublicHttpsUrl(cleaned)
}

/**
 * Extracts unique HTTPS media URLs from imeta tags, media tags, and note content.
 */
export function extractMediaUrlsFromEvents(events: readonly Event[]): string[] {
  const urls = new Set<string>()

  for (const ev of events) {
    if (Array.isArray(ev.tags)) {
      for (const tag of ev.tags) {
        if (!Array.isArray(tag) || tag.length < 2) continue
        if (tag[0] === 'imeta') {
          for (let i = 1; i < tag.length; i++) {
            const part = String(tag[i])
            if (part.startsWith('url ')) {
              const safe = normalizeMediaUrl(part.slice(4).trim())
              if (safe) urls.add(safe)
            }
          }
        } else if (tag[0] === 'image' || tag[0] === 'thumb' || tag[0] === 'url' || tag[0] === 'media') {
          const safe = normalizeMediaUrl(String(tag[1]))
          if (safe) urls.add(safe)
        } else if (tag[0] === 'r') {
          const safe = normalizeMediaUrl(String(tag[1]))
          if (safe && MEDIA_EXT_RE.test(safe)) urls.add(safe)
        }
      }
    }

    if (typeof ev.content === 'string' && ev.content.length > 0) {
      const matches = ev.content.match(MEDIA_URL_IN_TEXT_RE)
      if (matches) {
        for (const match of matches) {
          const safe = normalizeMediaUrl(match)
          if (safe && MEDIA_EXT_RE.test(safe)) {
            urls.add(safe)
          }
        }
      }
    }
  }

  return Array.from(urls)
}

/**
 * Serializes Nostr events into canonical deduplicated JSONL ordered newest-first.
 */
export function serializeEventsToJsonl(events: readonly Event[]): string {
  const deduped = new Map<string, Event>()
  for (const ev of events) {
    if (ev && isValidHex64(ev.id) && !deduped.has(ev.id)) {
      deduped.set(ev.id, ev)
    }
  }
  const sorted = Array.from(deduped.values()).sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
  )
  if (sorted.length === 0) return ''
  return `${sorted.map((ev) => JSON.stringify(ev)).join('\n')}\n`
}

function isValidUnsignedShape(raw: unknown): raw is Event {
  if (!raw || typeof raw !== 'object') return false
  const candidate = raw as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    isValidHex64(candidate.id) &&
    typeof candidate.pubkey === 'string' &&
    isValidHex64(candidate.pubkey) &&
    typeof candidate.created_at === 'number' &&
    Number.isFinite(candidate.created_at) &&
    typeof candidate.kind === 'number' &&
    Number.isInteger(candidate.kind) &&
    candidate.kind >= 0 &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((t) => Array.isArray(t) && t.every((item) => typeof item === 'string')) &&
    typeof candidate.content === 'string' &&
    typeof candidate.sig === 'string' &&
    candidate.sig.length === 128 &&
    /^[0-9a-f]{128}$/i.test(candidate.sig)
  )
}

function pickLatestByKind(current: Event | null, candidate: Event, targetKind: number): Event | null {
  if (candidate.kind !== targetKind) return current
  if (!current || candidate.created_at > current.created_at) return candidate
  return current
}

/**
 * Parses and cryptographically verifies a `.jsonl` Nostr backup fail-closed.
 * Invalid JSON, invalid signatures, duplicates, and optional non-matching authors
 * are counted and excluded from the verified output list.
 */
export function parseJsonlBackup(rawText: string, expectedPubkey?: string): ParsedBackupSummary {
  const expectedLower = expectedPubkey ? expectedPubkey.toLowerCase() : null
  const lines = rawText.split(/\r?\n/)
  const seenIds = new Set<string>()
  const validEvents: Event[] = []
  const kindCounts: Record<number, number> = {}

  let totalLines = 0
  let invalidSignatureCount = 0
  let foreignAuthorCount = 0
  let malformedLineCount = 0
  let duplicateCount = 0
  let latestFollowsEvent: Event | null = null
  let latestMuteEvent: Event | null = null
  let latestProfileEvent: Event | null = null
  let latestRelayListEvent: Event | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    totalLines++

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      malformedLineCount++
      continue
    }

    if (!isValidUnsignedShape(parsed)) {
      malformedLineCount++
      continue
    }

    const ev: Event = {
      ...parsed,
      id: parsed.id.toLowerCase(),
      pubkey: parsed.pubkey.toLowerCase(),
      sig: parsed.sig.toLowerCase(),
    }

    if (!verifyEventStrict(ev)) {
      invalidSignatureCount++
      continue
    }

    if (expectedLower && ev.pubkey !== expectedLower) {
      foreignAuthorCount++
      continue
    }

    if (seenIds.has(ev.id)) {
      duplicateCount++
      continue
    }

    seenIds.add(ev.id)
    validEvents.push(ev)
    kindCounts[ev.kind] = (kindCounts[ev.kind] ?? 0) + 1
    latestFollowsEvent = pickLatestByKind(latestFollowsEvent, ev, 3)
    latestMuteEvent = pickLatestByKind(latestMuteEvent, ev, 10000)
    latestProfileEvent = pickLatestByKind(latestProfileEvent, ev, 0)
    latestRelayListEvent = pickLatestByKind(latestRelayListEvent, ev, 10002)
  }

  validEvents.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))

  return {
    events: validEvents,
    totalLines,
    validCount: validEvents.length,
    invalidSignatureCount,
    foreignAuthorCount,
    malformedLineCount,
    duplicateCount,
    kindCounts,
    latestFollowsEvent,
    latestMuteEvent,
    latestProfileEvent,
    latestRelayListEvent,
    mediaUrls: extractMediaUrlsFromEvents(validEvents),
  }
}

/**
 * Re-signs a verified replaceable backup event (e.g., kind 3 follows or kind 10000 mute list)
 * with a fresh `created_at` timestamp so relays accept it over any newer accidental overwrite.
 */
export async function resignReplaceableEventForRecovery(
  backupEvent: Event,
  signer: FireWispSigner,
  nowSeconds?: number
): Promise<Event> {
  if (!verifyEventStrict(backupEvent)) {
    throw new Error('Backup event failed cryptographic signature verification')
  }

  const baseNow = Math.floor(nowSeconds ?? Date.now() / 1000)
  const freshCreatedAt = Math.max(baseNow, backupEvent.created_at + 1)

  const unsigned: UnsignedEvent = {
    kind: backupEvent.kind,
    created_at: freshCreatedAt,
    tags: backupEvent.tags.map((t) => [...t]),
    content: backupEvent.content,
    pubkey: backupEvent.pubkey,
  }

  const signed = await signer.signEvent(unsigned)
  if (!verifyEventStrict(signed)) {
    throw new Error('Recovered event signature could not be verified')
  }
  return signed
}

function sanitizeRelayList(relays: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const r of relays) {
    const safe = sanitizeRelayUrl(r)
    if (safe) unique.add(safe)
  }
  return Array.from(unique)
}

/**
 * Queries a user's replaceable state and paginated authored event history from the supplied relays.
 * Supports AbortSignal cancellation and emits live progress updates.
 */
export async function fetchUserBackupEvents(
  pubkey: string,
  relays: readonly string[],
  options?: {
    maxPages?: number
    pageLimit?: number
    signal?: AbortSignal
    onProgress?: (progress: BackupProgress) => void
  }
): Promise<Event[]> {
  if (!isValidHex64(pubkey)) {
    throw new Error('Invalid Nostr public key')
  }
  const normalizedPubkey = pubkey.toLowerCase()
  const cleanRelays = sanitizeRelayList(relays)
  if (cleanRelays.length === 0) {
    throw new Error('No valid relays configured to query')
  }

  const maxPages = Math.max(1, options?.maxPages ?? 20)
  const pageLimit = Math.max(50, Math.min(500, options?.pageLimit ?? 500))
  const byId = new Map<string, Event>()

  const recordVerified = (list: Event[]): number => {
    let added = 0
    for (const ev of list) {
      if (
        ev.pubkey.toLowerCase() === normalizedPubkey &&
        !byId.has(ev.id) &&
        verifyEventStrict(ev)
      ) {
        byId.set(ev.id, ev)
        added++
      }
    }
    return added
  }

  if (options?.signal?.aborted) {
    return []
  }

  options?.onProgress?.({
    phase: 'querying',
    fetched: 0,
    page: 0,
    published: 0,
    failed: 0,
    total: 0,
    message: 'Fetching profile, follows, mutes & lists…',
  })

  // Phase 1: Explicitly fetch latest replaceable/addressable config & lists
  const replaceables = await nostrPool.query(
    cleanRelays,
    {
      authors: [normalizedPubkey],
      kinds: [...BACKUP_REPLACEABLE_KINDS],
      limit: 200,
    },
    6500
  )
  recordVerified(replaceables)

  // Phase 2: Paginated history sweep backward in time
  let until: number | undefined
  for (let page = 1; page <= maxPages; page++) {
    if (options?.signal?.aborted) {
      options?.onProgress?.({
        phase: 'cancelled',
        fetched: byId.size,
        page,
        published: 0,
        failed: 0,
        total: byId.size,
        message: 'Backup scan cancelled',
      })
      break
    }

    options?.onProgress?.({
      phase: 'querying',
      fetched: byId.size,
      page,
      published: 0,
      failed: 0,
      total: 0,
      message: `Scanning history page ${page} (${byId.size} events found)…`,
    })

    const filter = {
      authors: [normalizedPubkey],
      limit: pageLimit,
      ...(until !== undefined ? { until } : {}),
    }

    const batch = await nostrPool.query(cleanRelays, filter, 6500)
    const added = recordVerified(batch)
    if (batch.length === 0 || added === 0) {
      break
    }

    let minCreatedAt = Number.POSITIVE_INFINITY
    for (const ev of batch) {
      if (ev.created_at < minCreatedAt) {
        minCreatedAt = ev.created_at
      }
    }
    if (!Number.isFinite(minCreatedAt) || (until !== undefined && minCreatedAt >= until)) {
      break
    }
    until = minCreatedAt - 1

    if (batch.length < Math.floor(pageLimit * 0.25)) {
      break
    }
  }

  const events = Array.from(byId.values()).sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id)
  )

  if (!options?.signal?.aborted) {
    options?.onProgress?.({
      phase: 'done',
      fetched: events.length,
      published: 0,
      failed: 0,
      total: events.length,
      message: `Collected ${events.length} verified events`,
    })
  }

  return events
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Broadcasts verified Nostr events in small paced batches to one or more target relays
 * (supporting both public wss:// relays and local ws://127.0.0.1 / ws://localhost relays).
 */
export async function broadcastBackupEvents(
  events: readonly Event[],
  targetRelays: readonly string[],
  options?: {
    batchSize?: number
    pauseMs?: number
    signal?: AbortSignal
    onProgress?: (progress: BackupProgress) => void
  }
): Promise<{ published: number; failed: number; cancelled: boolean; errors: string[] }> {
  const cleanRelays = sanitizeRelayList(targetRelays)
  if (cleanRelays.length === 0) {
    throw new Error('No valid target relay selected')
  }

  const verifiedEvents = events.filter((ev) => verifyEventStrict(ev))
  const batchSize = Math.max(1, Math.min(20, options?.batchSize ?? 5))
  const pauseMs = Math.max(0, options?.pauseMs ?? 120)
  const total = verifiedEvents.length

  let published = 0
  let failed = 0
  const errors = new Set<string>()

  for (let i = 0; i < total; i += batchSize) {
    if (options?.signal?.aborted) {
      options?.onProgress?.({
        phase: 'cancelled',
        fetched: total,
        published,
        failed,
        total,
        message: `Cancelled after publishing ${published}/${total} events`,
      })
      return { published, failed, cancelled: true, errors: Array.from(errors) }
    }

    const slice = verifiedEvents.slice(i, i + batchSize)
    const resultsList = await Promise.all(
      slice.map(async (ev) => {
        try {
          return await nostrPool.publish(cleanRelays, ev)
        } catch (err) {
          return [{
            relay: cleanRelays[0],
            ok: false,
            reason: err instanceof Error ? err.message : 'Publish error',
          }]
        }
      })
    )

    for (const results of resultsList) {
      if (results.some((r) => r.ok)) {
        published++
      } else {
        failed++
        for (const r of results) {
          if (r.reason && errors.size < 8) {
            errors.add(`${r.relay}: ${r.reason}`)
          }
        }
      }
    }

    options?.onProgress?.({
      phase: 'publishing',
      fetched: total,
      published,
      failed,
      total,
      message: `Syncing events to relay (${published + failed}/${total})…`,
    })

    if (pauseMs > 0 && i + batchSize < total) {
      await delayMs(pauseMs)
    }
  }

  options?.onProgress?.({
    phase: 'done',
    fetched: total,
    published,
    failed,
    total,
    message: `Synced ${published} event(s) to relay${failed > 0 ? ` (${failed} failed)` : ''}`,
  })

  return { published, failed, cancelled: false, errors: Array.from(errors) }
}
