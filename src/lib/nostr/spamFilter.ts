import type { Event } from 'nostr-tools/pure'
import { verifyEventPow } from '../crypto/nip13'
import { extractEventHashtags, extractReplyRefs } from './content'

// Same invisible/zero-width obfuscation characters targeted by Fire Wisp Android's NSpamPreprocessor
const INVISIBLE_CHAR_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g

// Math alphanumeric / fancy Unicode font blocks heavily abused by Nostr spam bots
const FANCY_UNICODE_RE = /[\u{1D400}-\u{1D7FF}]/gu

const SPAM_PHRASE_RE =
  /(?:\b(?:airdrop|giveaway|claim\s+your\s+(?:free|reward|tokens?|btc|eth|sats)|free\s+(?:btc|eth|bitcoin|usdt|crypto|money)|guaranteed\s+(?:profit|returns?)|100x\s+gem|pump\s+signal|dm\s+(?:me\s+)?for\s+promo|whatsapp\s*\+?\d|casino\s+bonus|slot\s+gacor|judi\s+online|togel|betting\s+tips|double\s+your\s+(?:btc|eth|bitcoin|sats)|send\s+\d+\s*(?:btc|eth|sats)\s+get|wallet\s+audit|ai\s+audit)\b|evmnest|https?:\/\/(?:t\.me|wa\.me|tinyurl\.com|bit\.ly)\/)/i

const URL_RE = /https?:\/\/[^\s]+/gi

// Machine/telemetry & scam t-tags abused on public kind-1 feeds
const MACHINE_T_TAG_RE = /^(?:relay-selftest|xvd-stat|zambo-receipt|sp_[0-9a-f]{6,}|heartbeat|nostr-test|bot-ping)$/i
const SCAM_T_TAG_RE = /^(?:airdrop|airdrops|giveaway|giveaways|freecrypto|freebtc|freeeth|cryptogiveaway|ethgiveaway|btcgiveaway)$/i

// Mixed-script homoglyph obfuscation inside a single word (e.g. "givᎬaway", "EᎢH", "livΕ", "ᎻurrΥ")
// Detects Latin letters mixed with Greek, Cyrillic, Cherokee, Armenian, or Math Alphanumeric inside the same token.
const LATIN_RE = /[A-Za-z]/
const CONFUSABLE_SCRIPT_RE = /[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u13A0-\u13FF\u{1D400}-\u{1D7FF}]/u

const CONFUSABLE_MAP: Record<string, string> = {
  // Cherokee
  'Ꭺ': 'a', 'Ᏼ': 'b', 'Ꮯ': 'c', 'Ꭰ': 'd', 'Ꭼ': 'e', 'Ꮐ': 'g', 'Ꮋ': 'h', 'Ꭵ': 'i',
  'Ꮷ': 'j', 'Ꮶ': 'k', 'Ꮮ': 'l', 'Ꮇ': 'm', 'Ꮎ': 'o', 'Ꮲ': 'p', 'Ꭱ': 'r', 'Ꮪ': 's',
  'Ꭲ': 't', 'Ꮩ': 'v', 'Ꮃ': 'w', 'Ꮍ': 'y', 'Ꮓ': 'z',
  // Greek
  'Α': 'a', 'α': 'a', 'Β': 'b', 'Ε': 'e', 'Ζ': 'z', 'Η': 'h', 'Ι': 'i', 'Κ': 'k',
  'Μ': 'm', 'Ν': 'n', 'Ο': 'o', 'ο': 'o', 'Ρ': 'p', 'Τ': 't', 'Υ': 'y', 'Χ': 'x',
  // Cyrillic
  'А': 'a', 'а': 'a', 'В': 'b', 'Е': 'e', 'е': 'e', 'К': 'k', 'к': 'k', 'М': 'm',
  'Н': 'h', 'О': 'o', 'о': 'o', 'Р': 'p', 'р': 'p', 'С': 'c', 'с': 'c', 'Т': 't',
  'У': 'y', 'у': 'y', 'Х': 'x', 'х': 'x', 'І': 'i', 'і': 'i', 'Ј': 'j', 'ј': 'j',
}

export function foldConfusables(text: string): string {
  let out = ''
  for (const ch of text) {
    out += CONFUSABLE_MAP[ch] ?? ch
  }
  return out
}

export function hasMixedScriptHomoglyph(text: string): boolean {
  const cleaned = text.replace(URL_RE, ' ')
  const tokens = cleaned.split(/[\s.,!?:;()[\]{}"'<>|\\/@#]+/)
  for (const tok of tokens) {
    if (tok.length >= 2 && LATIN_RE.test(tok) && CONFUSABLE_SCRIPT_RE.test(tok)) {
      return true
    }
  }
  return false
}

// Clock / ASCII divider bots (e.g. "--------20:30--------", "✄--- 20:30 ---✄")
const CLOCK_DIVIDER_RE = /^[\s\-_=~*✄✂─═•·:|—–]+\d{1,2}:\d{2}(?::\d{2})?[\s\-_=~*✄✂─═•·:|—–]*$/

// Pure hex, base64, or long machine-encoded blobs without URLs
const PURE_HEX_RE = /^[0-9a-f]{32,}$/i
const BASE64_BLOB_RE = /^[A-Za-z0-9+/=_-]{60,}$/
const LONG_ENCODED_TOKEN_RE = /[A-Za-z0-9+/=._-]{48,}/

export interface SpamCheckContext {
  myPubkey?: string | null
  follows?: Set<string> | string[]
  /** Optional shared content-hash tracker to catch cross-account copy-paste floods */
  seenContentAuthors?: Map<string, Set<string>>
  /** Optional per-author counter to cap automated RSS/bot bursts in Explore */
  authorCounts?: Map<string, number>
  maxPerAuthor?: number
  requirePowBits?: number
}

export interface SpamCheckResult {
  isSpam: boolean
  score: number
  reasons: string[]
}

export function normalizeForDuplicateCheck(content: string): string {
  return content
    .replace(INVISIBLE_CHAR_RE, '')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function isTopLevelNote(event: Pick<Event, 'tags'>): boolean {
  const refs = extractReplyRefs(event)
  return !refs.rootId && !refs.replyId
}

/**
 * Scores a public note for spam using signals ported from Fire Wisp Android's NSpam
 * feature extractor plus Nostr-specific bot heuristics.
 *
 * Never flags the signed-in user or accounts they follow.
 */
export function evaluateNoteSpam(
  event: Pick<Event, 'id' | 'pubkey' | 'kind' | 'content' | 'tags'>,
  ctx: SpamCheckContext = {},
): SpamCheckResult {
  const pk = event.pubkey.toLowerCase()
  if (ctx.myPubkey && pk === ctx.myPubkey.toLowerCase()) {
    return { isSpam: false, score: 0, reasons: [] }
  }
  if (ctx.follows) {
    const isFollowed =
      ctx.follows instanceof Set ? ctx.follows.has(pk) : ctx.follows.includes(pk)
    if (isFollowed) return { isSpam: false, score: 0, reasons: [] }
  }

  const powBits = verifyEventPow(event.id, event.tags)
  if (ctx.requirePowBits && ctx.requirePowBits > 0 && powBits < ctx.requirePowBits) {
    return {
      isSpam: true,
      score: 100,
      reasons: [`PoW < ${ctx.requirePowBits} bits`],
    }
  }

  let score = 0
  const reasons: string[] = []
  const content = event.content || ''

  // Verified NIP-13 PoW gives strong anti-spam credit (matches wss://relay.firewisp.de)
  if (powBits >= 16) score -= 45
  else if (powBits >= 12) score -= 25

  // 1. Zero-width / invisible character obfuscation
  const invisibleCount = (content.match(INVISIBLE_CHAR_RE) || []).length
  if (invisibleCount >= 4) {
    score += 65
    reasons.push('invisible-char obfuscation')
  }

  // 2. Mention-tag flooding (excessive p-tags on public notes)
  const pTagCount = event.tags.filter((t) => t[0] === 'p' && t[1]).length
  if (pTagCount >= 12) {
    score += 75
    reasons.push('excessive mentions')
  } else if (pTagCount >= 7) {
    score += 35
    reasons.push('many mentions')
  }

  // 3. Hashtag stuffing
  const hashtags = extractEventHashtags(event)
  if (hashtags.length >= 10) {
    score += 70
    reasons.push('hashtag stuffing')
  } else if (hashtags.length >= 6) {
    score += 35
    reasons.push('many hashtags')
  }

  // 4. Known crypto/gambling/scam/promo spam patterns (also checked after folding homoglyphs!)
  const foldedContent = foldConfusables(content)
  if (hasMixedScriptHomoglyph(content)) {
    score += 80
    reasons.push('mixed-script homoglyph obfuscation')
  }
  if (SPAM_PHRASE_RE.test(content) || SPAM_PHRASE_RE.test(foldedContent)) {
    score += 75
    reasons.push('spam phrase/link')
  }
  if (hashtags.some((t) => SCAM_T_TAG_RE.test(t))) {
    score += 70
    reasons.push('scam/giveaway hashtag')
  }

  // 5. Link flooding
  const urlCount = (content.match(URL_RE) || []).length
  if (urlCount >= 5) {
    score += 45
    reasons.push('link flood')
  }

  // 6. Fancy Unicode spam fonts
  const fancyCount = (content.match(FANCY_UNICODE_RE) || []).length
  if (fancyCount >= 12) {
    score += 45
    reasons.push('obfuscated unicode font')
  }

  // 7. Empty / whitespace-only kind-1 notes with no media or imeta
  const stripped = content.replace(INVISIBLE_CHAR_RE, '').trim()
  if (event.kind === 1 && stripped.length === 0 && !event.tags.some((t) => t[0] === 'imeta')) {
    score += 65
    reasons.push('empty note')
  }

  // 8. Machine telemetry / protocol junk posted as kind 1 (relay-selftest, xvd-stat, zambo-receipt, drift.gits.net, raw JSON, hex/base64 blobs, clock dividers)
  if (hashtags.some((t) => MACHINE_T_TAG_RE.test(t))) {
    score += 90
    reasons.push('machine/telemetry tag')
  }

  if (CLOCK_DIVIDER_RE.test(stripped)) {
    score += 80
    reasons.push('clock divider bot')
  }

  if (
    (stripped.startsWith('{') && stripped.endsWith('}')) ||
    (stripped.startsWith('[') && stripped.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(stripped)
      if (parsed && typeof parsed === 'object') {
        score += 85
        reasons.push('raw JSON machine payload')
      }
    } catch {
      // not valid JSON
    }
  }

  // Strip valid URLs and nostr: entities before checking for raw encoded blobs
  const textWithoutUrls = stripped
    .replace(URL_RE, ' ')
    .replace(/nostr:[0-9a-z]+/gi, ' ')
    .trim()

  if (textWithoutUrls.length > 0) {
    if (PURE_HEX_RE.test(textWithoutUrls) || BASE64_BLOB_RE.test(textWithoutUrls)) {
      score += 90
      reasons.push('encoded machine blob')
    } else if (!textWithoutUrls.includes(' ') && LONG_ENCODED_TOKEN_RE.test(textWithoutUrls)) {
      score += 80
      reasons.push('encoded machine token')
    }
  }

  // 9. Cross-account duplicate copy-paste spam flood
  if (ctx.seenContentAuthors && stripped.length >= 24) {
    const key = normalizeForDuplicateCheck(stripped).slice(0, 160)
    if (key.length >= 20) {
      let authors = ctx.seenContentAuthors.get(key)
      if (!authors) {
        if (ctx.seenContentAuthors.size > 1500) {
          ctx.seenContentAuthors.clear()
        }
        authors = new Set<string>()
        ctx.seenContentAuthors.set(key, authors)
      }
      authors.add(pk)
      if (authors.size >= 2) {
        score += 75
        reasons.push('duplicate copy-paste flood')
      }
    }
  }

  // 10. Per-author burst cap in Explore (stops RSS/job/news/bot firehoses flooding the screen)
  if (ctx.authorCounts && (ctx.maxPerAuthor ?? 2) > 0 && score < 60) {
    const prev = ctx.authorCounts.get(pk) || 0
    if (prev >= (ctx.maxPerAuthor ?? 2)) {
      score += 70
      reasons.push('author burst cap')
    } else {
      ctx.authorCounts.set(pk, prev + 1)
    }
  }

  return {
    isSpam: score >= 60,
    score,
    reasons,
  }
}
