import type { Event } from 'nostr-tools/pure'
import type { RelayEntry } from '../constants'
import { sanitizeBlossomUrl, sanitizePublicRelayUrl } from '../sanitize'
import type { FireWispSigner } from './signer'

export const KIND_MUTE_LIST = 10000
export const KIND_RELAY_LIST = 10002
export const KIND_BLOSSOM_SERVER_LIST = 10063
export const MAX_NIP44_PLAINTEXT_BYTES = 65535

export type MuteItemType = 'p' | 't' | 'word'

export interface MuteListMutation {
  op: 'add' | 'remove'
  type: MuteItemType
  value: string
}

export interface ParsedMuteTags {
  pubkeys: string[]
  hashtags: string[]
  words: string[]
}

export function normalizeMuteValue(type: MuteItemType, raw: string): string | null {
  if (type === 'p') {
    const clean = raw.trim().toLowerCase()
    return /^[0-9a-f]{64}$/.test(clean) ? clean : null
  }
  if (type === 't') {
    const clean = raw.trim().toLowerCase().replace(/^#+/, '')
    return clean.length > 0 ? clean : null
  }
  const clean = raw.trim().toLowerCase()
  return clean.length >= 2 ? clean : null
}

/**
 * Extracts normalized `p`, `t`, and `word` entries from a NIP-51 `kind: 10000` tag array
 * (either public `event.tags` or parsed decrypted private tags).
 */
export function extractMuteItemsFromTags(tags: readonly unknown[]): ParsedMuteTags {
  const pubkeys = new Set<string>()
  const hashtags = new Set<string>()
  const words = new Set<string>()
  for (const item of tags) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') {
      continue
    }
    if (item[0] === 'p') {
      const clean = normalizeMuteValue('p', item[1])
      if (clean) pubkeys.add(clean)
    } else if (item[0] === 't') {
      const clean = normalizeMuteValue('t', item[1])
      if (clean) hashtags.add(clean)
    } else if (item[0] === 'word') {
      const clean = normalizeMuteValue('word', item[1])
      if (clean) words.add(clean)
    }
  }
  return {
    pubkeys: [...pubkeys],
    hashtags: [...hashtags],
    words: [...words],
  }
}

/**
 * Parses decrypted NIP-51 private mute-list JSON strictly as an array of `string[]` tags.
 * Returns `null` if the payload is not a valid JSON array (fail-closed so callers never overwrite corrupt/unknown content).
 * Preserves ALL tag types (`p`, `t`, `word`, `e`, and any client-specific tags) and extra positional fields.
 */
export function parsePrivateMuteTagsJson(plaintext: string): string[][] | null {
  try {
    const parsed = JSON.parse(plaintext) as unknown
    if (!Array.isArray(parsed)) return null
    const tags: string[][] = []
    for (const item of parsed) {
      if (Array.isArray(item) && item.length > 0 && item.every((x) => typeof x === 'string')) {
        tags.push([...(item as string[])])
      }
    }
    return tags
  } catch {
    return null
  }
}

function tagMatchesMute(tag: readonly string[], type: MuteItemType, cleanVal: string): boolean {
  if (tag[0] !== type || typeof tag[1] !== 'string') return false
  const normalized = normalizeMuteValue(type, tag[1])
  return normalized === cleanVal
}

/**
 * Safely applies `add` / `remove` mutations to a NIP-51 `kind: 10000` mute list without losing any
 * existing public or private tags (including `e` thread mutes, relay hints, or unknown tags).
 * - `add` appends to `privateTags` (encrypted) unless already muted publicly or privately.
 * - `remove` removes matching tags from BOTH `publicTags` and `privateTags`.
 */
export function applyMuteListMutations(params: {
  publicTags: readonly string[][]
  privateTags: readonly string[][]
  mutations: readonly MuteListMutation[]
}): {
  publicTags: string[][]
  privateTags: string[][]
  changed: boolean
} {
  let publicTags = params.publicTags.map((t) => [...t])
  let privateTags = params.privateTags.map((t) => [...t])
  let changed = false

  for (const m of params.mutations) {
    const cleanVal = normalizeMuteValue(m.type, m.value)
    if (!cleanVal) continue

    if (m.op === 'add') {
      const existsPublic = publicTags.some((t) => tagMatchesMute(t, m.type, cleanVal))
      const existsPrivate = privateTags.some((t) => tagMatchesMute(t, m.type, cleanVal))
      if (!existsPublic && !existsPrivate) {
        privateTags.push([m.type, cleanVal])
        changed = true
      }
    } else {
      const nextPub = publicTags.filter((t) => !tagMatchesMute(t, m.type, cleanVal))
      const nextPriv = privateTags.filter((t) => !tagMatchesMute(t, m.type, cleanVal))
      if (nextPub.length !== publicTags.length || nextPriv.length !== privateTags.length) {
        publicTags = nextPub
        privateTags = nextPriv
        changed = true
      }
    }
  }

  return { publicTags, privateTags, changed }
}

/**
 * Ensures replaceable Nostr events (`kind: 10000`) always get a strictly newer `created_at`
 * than the event they replace, even on rapid back-to-back updates or slightly skewed device clocks.
 */
export function computeNextReplaceableCreatedAt(
  baseEvent: Pick<Event, 'created_at'> | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const prev = baseEvent?.created_at ?? 0
  return Math.max(nowSec, prev + 1)
}

/**
 * Decrypts NIP-51 `kind: 10000` private content (supporting both NIP-44 and legacy NIP-04 `?iv=`).
 * Returns `null` if content is non-empty and decryption fails or does not parse as a tag array (fail-closed!).
 */
export async function decryptMuteListContent(
  signer: Pick<FireWispSigner, 'canEncrypt' | 'nip44Decrypt' | 'nip04Decrypt'> | null | undefined,
  pubkey: string,
  content: string,
): Promise<{ tags: string[][]; scheme: 'nip44' | 'nip04' } | null> {
  if (!content || !content.trim()) {
    return { tags: [], scheme: 'nip44' }
  }
  if (!signer) return null

  const cleanPk = pubkey.toLowerCase()
  const looksNip04 = content.includes('?iv=')
  let decrypted: string | null = null
  let scheme: 'nip44' | 'nip04' = looksNip04 ? 'nip04' : 'nip44'

  if (looksNip04 && signer.nip04Decrypt) {
    try {
      decrypted = await signer.nip04Decrypt(cleanPk, content)
      scheme = 'nip04'
    } catch {
      // fallback to NIP-44 below
    }
  }
  if (!decrypted && signer.canEncrypt) {
    try {
      decrypted = await signer.nip44Decrypt(cleanPk, content)
      scheme = 'nip44'
    } catch {
      // fallback to NIP-04 below
    }
  }
  if (!decrypted && !looksNip04 && signer.nip04Decrypt) {
    try {
      decrypted = await signer.nip04Decrypt(cleanPk, content)
      scheme = 'nip04'
    } catch {
      // signer declined or incompatible ciphertext
    }
  }
  if (!decrypted) return null

  const tags = parsePrivateMuteTagsJson(decrypted)
  if (!tags) return null
  return { tags, scheme }
}

/**
 * Encrypts NIP-51 `kind: 10000` private tags using NIP-44 (preferred) with NIP-04 fallback.
 * Returns `''` when `privateTags` is empty.
 */
export async function encryptMuteListTags(
  signer: Pick<FireWispSigner, 'canEncrypt' | 'nip44Encrypt' | 'nip04Encrypt'>,
  pubkey: string,
  privateTags: readonly string[][],
): Promise<string> {
  if (privateTags.length === 0) return ''
  const cleanPk = pubkey.toLowerCase()
  const plaintext = JSON.stringify(privateTags)
  const byteLen = new TextEncoder().encode(plaintext).length

  if (signer.canEncrypt) {
    if (byteLen > MAX_NIP44_PLAINTEXT_BYTES) {
      throw new Error(
        `Encrypted mute list exceeds NIP-44 maximum size (${byteLen}/${MAX_NIP44_PLAINTEXT_BYTES} bytes)`,
      )
    }
    return signer.nip44Encrypt(cleanPk, plaintext)
  }
  if (signer.nip04Encrypt) {
    return signer.nip04Encrypt(cleanPk, plaintext)
  }
  throw new Error('Your signer does not support NIP-44 or NIP-04 encryption for mute list sync')
}

/**
 * Builds canonical NIP-65 (`kind: 10002`) `r` tags from relay entries.
 * Never leaks private/LAN/loopback or cleartext `ws://` URLs to public relays.
 */
export function buildNip65RelayListTags(relays: readonly RelayEntry[]): {
  tags: string[][]
  readRelays: string[]
  writeRelays: string[]
} {
  const seen = new Set<string>()
  const tags: string[][] = []
  const readRelays: string[] = []
  const writeRelays: string[] = []

  for (const entry of relays) {
    if (!entry.read && !entry.write) continue
    const clean = sanitizePublicRelayUrl(entry.url)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)

    if (entry.read && entry.write) {
      tags.push(['r', clean])
      readRelays.push(clean)
      writeRelays.push(clean)
    } else if (entry.read) {
      tags.push(['r', clean, 'read'])
      readRelays.push(clean)
    } else {
      tags.push(['r', clean, 'write'])
      writeRelays.push(clean)
    }
  }

  return { tags, readRelays, writeRelays }
}

/**
 * Builds canonical BUD-03 (`kind: 10063`) `server` tags preserving exact priority order (index 0 = primary).
 * Rejects cleartext `http://` and private/LAN URLs.
 */
export function buildBud03BlossomListTags(servers: readonly string[]): {
  tags: string[][]
  servers: string[]
} {
  const seen = new Set<string>()
  const tags: string[][] = []
  const cleanServers: string[] = []

  for (const raw of servers) {
    const clean = sanitizeBlossomUrl(raw)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    cleanServers.push(clean)
    tags.push(['server', clean])
  }

  return { tags, servers: cleanServers }
}

const INVISIBLE_MUTE_CHARS_RE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g

const CANDIDATE_HOST_RE =
  /(?:^|[\s(<"'\u201c\u2018=])(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?=[/?#\s.,!?;:)\]"'\u201d\u2019]|$)/gi

const FAKE_FILE_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'mp4', 'webm', 'mov',
  'm4v', 'mp3', 'wav', 'm3u8', 'pdf', 'txt', 'json', 'js', 'ts', 'css', 'html',
  'apk', 'zip',
])

const GENERIC_HOST_LABELS = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'www', 'app', 'web'])

const SCAM_PHRASE_CANDIDATES = [
  'wallet audit',
  'ai audit',
  'eth airdrop',
  'free eth',
  'claim yours',
  'free btc',
  'airdrop',
]

/**
 * Extracts likely spam words and domains (both https:// and bare domains like ai.evmnest.cc)
 * from note content for 1-tap NIP-51 word muting.
 */
export function extractMuteCandidates(content: string): string[] {
  const cleaned = (content || '').replace(INVISIBLE_MUTE_CHARS_RE, '')
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const val = normalizeMuteValue('word', raw)
    if (!val || seen.has(val)) return
    seen.add(val)
    out.push(val)
  }

  CANDIDATE_HOST_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CANDIDATE_HOST_RE.exec(cleaned)) !== null) {
    const host = (match[1] || '').toLowerCase()
    const labels = host.split('.')
    if (labels.length < 2) continue
    const tld = labels[labels.length - 1]
    if (!/^[a-z]{2,12}$/.test(tld) || FAKE_FILE_TLDS.has(tld)) continue
    // Second-level label first (e.g. "evmnest" from "ai.evmnest.cc") so 1 tap blocks all subdomains
    const brandLabel = labels.length >= 2 ? labels[labels.length - 2] : ''
    if (brandLabel.length >= 3 && !GENERIC_HOST_LABELS.has(brandLabel)) {
      push(brandLabel)
    }
    push(host)
  }

  const lower = cleaned.toLowerCase()
  for (const phrase of SCAM_PHRASE_CANDIDATES) {
    if (lower.includes(phrase)) {
      push(phrase)
    }
  }

  return out.slice(0, 6)
}
