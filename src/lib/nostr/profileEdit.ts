import { verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure'
import { nostrPool } from './pool'
import { isValidHex64, sanitizePublicHttpsUrl, sanitizePublicRelayUrl } from '../sanitize'

export interface ProfileEditDraft {
  display_name: string
  name: string
  about: string
  picture: string
  banner: string
  nip05: string
  lud16: string
  website: string
}

const STANDARD_EDITED_KEYS = new Set([
  'display_name',
  'displayName',
  'name',
  'about',
  'picture',
  'banner',
  'nip05',
  'lud16',
  'website',
])

const NIP05_RE = /^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const LUD16_RE = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

function parseJsonObjectSafe(raw: string | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) }
    }
  } catch {
    // ignore malformed content
  }
  return {}
}

/**
 * Validates profile metadata draft fields fail-closed before signing kind 0.
 * Returns null if valid or a human-readable error message.
 */
export function validateProfileEditDraft(draft: ProfileEditDraft): string | null {
  const picture = draft.picture.trim()
  if (picture && !sanitizePublicHttpsUrl(picture)) {
    return 'Avatar URL must be a valid public https:// URL.'
  }

  const banner = draft.banner.trim()
  if (banner && !sanitizePublicHttpsUrl(banner)) {
    return 'Banner URL must be a valid public https:// URL.'
  }

  const website = draft.website.trim()
  if (website && !sanitizePublicHttpsUrl(website)) {
    return 'Website must be a valid public https:// URL.'
  }

  const nip05 = draft.nip05.trim()
  if (nip05 && !NIP05_RE.test(nip05)) {
    return 'NIP-05 identifier must look like user@domain.com.'
  }

  const lud16 = draft.lud16.trim()
  if (lud16 && !LUD16_RE.test(lud16)) {
    return 'Lightning address (lud16) must look like name@wallet.com.'
  }

  return null
}

/**
 * Counts third-party or custom fields in existing kind-0 JSON that will be
 * preserved across edits (e.g. xmr, monero_address, pronouns, lud06).
 */
export function countPreservedCustomFields(existingRawContent: string | null | undefined): number {
  const obj = parseJsonObjectSafe(existingRawContent)
  let count = 0
  for (const key of Object.keys(obj)) {
    if (!STANDARD_EDITED_KEYS.has(key)) {
      count++
    }
  }
  return count
}

/**
 * Merges edited profile fields onto the parsed existing kind-0 JSON object so
 * custom third-party fields are never accidentally wiped when saving.
 */
export function mergeProfileMetadataJson(
  existingRawContent: string | null | undefined,
  draft: ProfileEditDraft,
): Record<string, unknown> {
  const base = parseJsonObjectSafe(existingRawContent)

  const setTextOrDelete = (key: string, val: string) => {
    const trimmed = val.trim()
    if (trimmed) {
      base[key] = trimmed
    } else {
      delete base[key]
    }
  }

  const setHttpsOrDelete = (key: string, val: string) => {
    const trimmed = val.trim()
    if (!trimmed) {
      delete base[key]
      return
    }
    const safe = sanitizePublicHttpsUrl(trimmed)
    if (safe) {
      base[key] = safe
    } else {
      delete base[key]
    }
  }

  setTextOrDelete('display_name', draft.display_name)
  if ('displayName' in base) {
    setTextOrDelete('displayName', draft.display_name)
  }
  setTextOrDelete('name', draft.name)
  setTextOrDelete('about', draft.about)
  setHttpsOrDelete('picture', draft.picture)
  setHttpsOrDelete('banner', draft.banner)
  setTextOrDelete('nip05', draft.nip05)
  setTextOrDelete('lud16', draft.lud16)
  setHttpsOrDelete('website', draft.website)

  return base
}

/**
 * Builds an unsigned kind-0 profile update event preserving custom metadata fields,
 * existing tags, and enforcing monotonic created_at timestamps.
 */
export function buildProfileUpdateEvent(
  existingLatestEvent: Event | null,
  draft: ProfileEditDraft,
  pubkey: string,
  nowSeconds?: number,
): UnsignedEvent {
  if (!isValidHex64(pubkey)) {
    throw new Error('Invalid public key for profile update')
  }

  const err = validateProfileEditDraft(draft)
  if (err) {
    throw new Error(err)
  }

  const baseNow = Math.floor(nowSeconds ?? Date.now() / 1000)
  const createdAt = Math.max(
    baseNow,
    existingLatestEvent ? existingLatestEvent.created_at + 1 : 0,
  )
  const merged = mergeProfileMetadataJson(existingLatestEvent?.content, draft)

  return {
    kind: 0,
    pubkey: pubkey.toLowerCase(),
    created_at: createdAt,
    tags: existingLatestEvent ? existingLatestEvent.tags.map((t) => [...t]) : [],
    content: JSON.stringify(merged),
  }
}

/**
 * Queries relays for the user's latest cryptographically verified kind-0 event so
 * custom metadata keys and timestamps can be preserved prior to publishing updates.
 */
export async function fetchLatestOwnProfileEvent(
  pubkey: string,
  relays: readonly string[],
): Promise<Event | null> {
  if (!isValidHex64(pubkey)) return null
  const normalized = pubkey.toLowerCase()
  const cleanRelays = [
    ...new Set(
      relays
        .map((r) => sanitizePublicRelayUrl(r))
        .filter((r): r is string => Boolean(r)),
    ),
  ].slice(0, 10)
  if (cleanRelays.length === 0) return null

  const events = await nostrPool
    .query(cleanRelays, { authors: [normalized], kinds: [0], limit: 5 }, 4500)
    .catch(() => [] as Event[])

  const verified = events
    .filter((ev) => ev.kind === 0 && ev.pubkey.toLowerCase() === normalized && verifyEvent(ev))
    .sort((a, b) => b.created_at - a.created_at)

  return verified[0] ?? null
}
