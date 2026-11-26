import { sanitizePublicHttpsUrl } from '../sanitize'

export interface CustomReactionEmote {
  shortcode: string
  key: string
  label: string
  localSrc: string
  publicUrl: string
}

export const FIREWISP_EMOTE_BASE_URL = 'https://firewisp.de/emotes'

export const CUSTOM_REACTION_EMOTES: readonly CustomReactionEmote[] = [
  {
    shortcode: 'gg',
    key: ':gg:',
    label: 'GG',
    localSrc: '/emotes/gg.png',
    publicUrl: `${FIREWISP_EMOTE_BASE_URL}/gg.png`,
  },
  {
    shortcode: 'wisp_orange',
    key: ':wisp_orange:',
    label: 'Fire Wisp Orange',
    localSrc: '/emotes/wisp_orange.png',
    publicUrl: `${FIREWISP_EMOTE_BASE_URL}/wisp_orange.png`,
  },
  {
    shortcode: 'wisp_green',
    key: ':wisp_green:',
    label: 'Fire Wisp Green',
    localSrc: '/emotes/wisp_green.png',
    publicUrl: `${FIREWISP_EMOTE_BASE_URL}/wisp_green.png`,
  },
  {
    shortcode: 'wisp_white',
    key: ':wisp_white:',
    label: 'Fire Wisp White',
    localSrc: '/emotes/wisp_white.png',
    publicUrl: `${FIREWISP_EMOTE_BASE_URL}/wisp_white.png`,
  },
] as const

const BUILTIN_BY_KEY = new Map<string, CustomReactionEmote>(
  CUSTOM_REACTION_EMOTES.map((emote) => [emote.key, emote]),
)

export const SHORTCODE_RE = /^:([a-z0-9_.+-]{1,48}):$/i

/**
 * Extracts and lowercases a NIP-30 `:shortcode:` reaction token, or returns null.
 */
export function extractShortcode(key: string): string | null {
  const match = (key || '').trim().match(SHORTCODE_RE)
  return match ? match[1].toLowerCase() : null
}

/**
 * Looks up a built-in Fire Wisp custom reaction emote by normalized `:shortcode:` key.
 */
export function getBuiltinEmoteByKey(key: string): CustomReactionEmote | undefined {
  return BUILTIN_BY_KEY.get((key || '').trim().toLowerCase())
}

/**
 * Extracts and validates the NIP-30 `["emoji", shortcode, url]` image URL from event tags.
 */
export function extractNip30EmojiUrl(tags: string[][], emojiKey: string): string | null {
  const shortcode = extractShortcode(emojiKey)
  if (!shortcode || !Array.isArray(tags)) return null
  const emojiTags = tags.filter((t) => t[0] === 'emoji' && t[2])
  for (const tag of emojiTags) {
    const tagCode = (tag[1] || '').trim().replace(/^:+|:+$/g, '').toLowerCase()
    if (tagCode === shortcode) {
      const safe = sanitizePublicHttpsUrl(tag[2])
      if (safe) return safe
    }
  }
  if (emojiTags.length === 1) {
    const safe = sanitizePublicHttpsUrl(emojiTags[0][2])
    if (safe) return safe
  }
  return null
}

/**
 * Resolves the safe `<img>` src for a reaction key (local bundle for built-ins, sanitized HTTPS for remote NIP-30).
 */
export function resolveReactionEmoteSrc(
  emojiKey: string,
  tags?: string[][],
  storedUrl?: string,
): string | null {
  const builtin = getBuiltinEmoteByKey(emojiKey)
  if (builtin) return builtin.localSrc
  if (storedUrl) {
    const safeStored = sanitizePublicHttpsUrl(storedUrl)
    if (safeStored) return safeStored
  }
  if (tags) {
    return extractNip30EmojiUrl(tags, emojiKey)
  }
  return null
}
