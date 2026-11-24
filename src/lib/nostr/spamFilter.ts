import type { Event } from 'nostr-tools/pure'
import { verifyEventPow } from '../crypto/nip13'
import { extractEventHashtags, extractReplyRefs } from './content'

// Same invisible/zero-width obfuscation characters targeted by Fire Wisp Android's NSpamPreprocessor
const INVISIBLE_CHAR_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0]/g

// Math alphanumeric / fancy Unicode font blocks heavily abused by Nostr spam bots
const FANCY_UNICODE_RE = /[\u{1D400}-\u{1D7FF}]/gu

const SPAM_PHRASE_RE =
  /(?:\b(?:airdrop|claim\s+your\s+(?:free|reward|tokens?|btc|sats)|free\s+(?:btc|bitcoin|usdt|crypto|money)|guaranteed\s+(?:profit|returns?)|100x\s+gem|pump\s+signal|dm\s+(?:me\s+)?for\s+promo|whatsapp\s*\+?\d|casino\s+bonus|slot\s+gacor|judi\s+online|togel|betting\s+tips|double\s+your\s+(?:btc|bitcoin|sats)|send\s+\d+\s*(?:btc|sats)\s+get)\b|https?:\/\/(?:t\.me|wa\.me|tinyurl\.com|bit\.ly)\/)/i

const URL_RE = /https?:\/\/[^\s]+/gi

export interface SpamCheckContext {
  myPubkey?: string | null
  follows?: Set<string> | string[]
  /** Optional shared content-hash tracker to catch cross-account copy-paste floods */
  seenContentAuthors?: Map<string, Set<string>>
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

  // Verified NIP-13 PoW gives strong anti-spam credit (matches firewisp.relay.rtard.de)
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

  // 4. Known crypto/gambling/scam/promo spam patterns
  if (SPAM_PHRASE_RE.test(content)) {
    score += 75
    reasons.push('spam phrase/link')
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

  // 8. Cross-account duplicate copy-paste spam flood
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

  return {
    isSpam: score >= 60,
    score,
    reasons,
  }
}
