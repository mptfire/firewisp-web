import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import { sanitizeHttpUrl, sanitizePublicHttpsUrl } from '../sanitize'
import { cleanTrackingUrl } from './urlClean'
import { extractYouTubeVideo, type YouTubeRef } from './youtube'

export interface MediaAttachment {
  url: string
  kind: 'image' | 'video' | 'audio'
  alt?: string
  mime?: string
  poster?: string
}

export type ContentSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; url: string; display: string }
  | { type: 'hashtag'; tag: string }
  | { type: 'mention'; bech32: string; pubkey: string }
  | { type: 'quote'; bech32: string; eventId?: string }
  | { type: 'live'; bech32: string; hostPubkey: string; dTag: string }

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i
const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a|flac)(\?.*)?$/i

const TOKEN_RE =
  /(https?:\/\/[^\s<>"{}|\\^`[\]]+|nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[0-9a-z]+|#[a-zA-Z0-9_]{1,64})/g

/**
 * Parses NIP-92 `imeta` tags into a map keyed by URL so alt text & MIME metadata attach to rendered media.
 */
export function extractImetaMap(
  tags: string[][],
): Map<string, { alt?: string; mime?: string; poster?: string }> {
  const map = new Map<string, { alt?: string; mime?: string; poster?: string }>()
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue
    let url = ''
    let alt: string | undefined
    let mime: string | undefined
    let poster: string | undefined
    for (let i = 1; i < tag.length; i++) {
      const part = tag[i]
      const sp = part.indexOf(' ')
      if (sp <= 0) continue
      const key = part.slice(0, sp)
      const val = part.slice(sp + 1).trim()
      if (key === 'url') url = val
      else if (key === 'alt') alt = val
      else if (key === 'm') mime = val
      else if (key === 'image' || key === 'thumb') {
        const safePoster = sanitizePublicHttpsUrl(val)
        if (safePoster) poster = safePoster
      }
    }
    const safe = sanitizePublicHttpsUrl(url)
    if (safe) map.set(safe, { alt, mime, poster })
  }
  return map
}

export function classifyMediaUrl(
  url: string,
  mime?: string,
): 'image' | 'video' | 'audio' | null {
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (IMAGE_EXT_RE.test(url)) return 'image'
  if (VIDEO_EXT_RE.test(url)) return 'video'
  if (AUDIO_EXT_RE.test(url)) return 'audio'
  return null
}

export function parseNoteContent(event: Pick<Event, 'content' | 'tags'>): {
  segments: ContentSegment[]
  media: MediaAttachment[]
  youtube: YouTubeRef[]
  quotes: string[]
} {
  const imeta = extractImetaMap(event.tags)
  const media: MediaAttachment[] = []
  const mediaSeen = new Set<string>()
  const youtube: YouTubeRef[] = []
  const ytSeen = new Set<string>()
  const quotes: string[] = []
  const segments: ContentSegment[] = []

  const content = event.content || ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    const token = match[0]
    lastIndex = match.index + token.length

    if (token.startsWith('http://') || token.startsWith('https://')) {
      const trimmed = token.replace(/[),.;!?]+$/, '')
      const trailing = token.slice(trimmed.length)
      const safe = sanitizeHttpUrl(trimmed)
      if (safe) {
        const safePublicMedia = sanitizePublicHttpsUrl(trimmed)
        const meta = safePublicMedia ? imeta.get(safePublicMedia) : undefined
        const mediaKind = safePublicMedia
          ? classifyMediaUrl(safePublicMedia, meta?.mime)
          : null
        const ytRef = extractYouTubeVideo(trimmed)
        // Also detect web stream URLs carrying a NIP-53 naddr1... (e.g. https://zap.stream/naddr1...)
        const embeddedLiveMatch = !ytRef
          ? /\/(naddr1[0-9a-z]+)/i.exec(trimmed)
          : null
        let embeddedLive: { bech32: string; hostPubkey: string; dTag: string } | null = null
        if (embeddedLiveMatch) {
          try {
            const dec = nip19.decode(embeddedLiveMatch[1])
            if (dec.type === 'naddr' && dec.data.kind === 30311) {
              embeddedLive = {
                bech32: embeddedLiveMatch[1],
                hostPubkey: dec.data.pubkey.toLowerCase(),
                dTag: dec.data.identifier,
              }
            }
          } catch {
            // not a valid naddr
          }
        }

        if (embeddedLive) {
          segments.push({
            type: 'live',
            bech32: embeddedLive.bech32,
            hostPubkey: embeddedLive.hostPubkey,
            dTag: embeddedLive.dTag,
          })
        } else if (ytRef) {
          if (!ytSeen.has(ytRef.videoId)) {
            if (youtube.length < 4) {
              ytSeen.add(ytRef.videoId)
              youtube.push(ytRef)
            } else {
              const cleanedUrl = cleanTrackingUrl(safe).url
              segments.push({
                type: 'link',
                url: cleanedUrl,
                display: cleanedUrl.replace(/^https?:\/\//, '').slice(0, 60),
              })
            }
          }
        } else if (mediaKind && safePublicMedia) {
          if (!mediaSeen.has(safePublicMedia)) {
            mediaSeen.add(safePublicMedia)
            media.push({
              url: safePublicMedia,
              kind: mediaKind,
              alt: meta?.alt,
              mime: meta?.mime,
              poster: meta?.poster,
            })
          }
        } else {
          const cleanedUrl = cleanTrackingUrl(safe).url
          segments.push({
            type: 'link',
            url: cleanedUrl,
            display: cleanedUrl.replace(/^https?:\/\//, '').slice(0, 60),
          })
        }
      } else {
        segments.push({ type: 'text', text: trimmed })
      }
      if (trailing) segments.push({ type: 'text', text: trailing })
    } else if (token.startsWith('nostr:')) {
      const bech32 = token.slice(6)
      try {
        const decoded = nip19.decode(bech32)
        if (decoded.type === 'npub') {
          segments.push({ type: 'mention', bech32, pubkey: decoded.data })
        } else if (decoded.type === 'nprofile') {
          segments.push({ type: 'mention', bech32, pubkey: decoded.data.pubkey })
        } else if (decoded.type === 'note') {
          quotes.push(decoded.data)
          segments.push({ type: 'quote', bech32, eventId: decoded.data })
        } else if (decoded.type === 'nevent') {
          quotes.push(decoded.data.id)
          segments.push({ type: 'quote', bech32, eventId: decoded.data.id })
        } else if (decoded.type === 'naddr' && decoded.data.kind === 30311) {
          segments.push({
            type: 'live',
            bech32,
            hostPubkey: decoded.data.pubkey.toLowerCase(),
            dTag: decoded.data.identifier,
          })
        } else {
          segments.push({ type: 'text', text: token })
        }
      } catch {
        segments.push({ type: 'text', text: token })
      }
    } else if (token.startsWith('#')) {
      segments.push({ type: 'hashtag', tag: token.slice(1).toLowerCase() })
    }
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) })
  }

  // Also include imeta attachments for kind-20 gallery & kind-21/22 video posts whose URLs aren't inline in content.
  for (const [url, meta] of imeta.entries()) {
    if (!url.startsWith('https://')) continue
    if (!mediaSeen.has(url)) {
      const kind = classifyMediaUrl(url, meta.mime) || 'image'
      mediaSeen.add(url)
      media.push({ url, kind, alt: meta.alt, mime: meta.mime, poster: meta.poster })
    }
  }

  // Support legacy NIP-71 `url` tag if no imeta/inline video matched
  for (const tag of event.tags) {
    if (tag[0] !== 'url' || !tag[1]) continue
    const safe = sanitizePublicHttpsUrl(tag[1])
    if (!safe || mediaSeen.has(safe)) continue
    const kind = classifyMediaUrl(safe)
    if (kind) {
      mediaSeen.add(safe)
      media.push({ url: safe, kind })
    }
  }

  return { segments, media, youtube, quotes }
}

/**
 * Extracts NIP-10 root & direct reply event IDs from a note's `e` tags.
 */
export function extractReplyRefs(event: Pick<Event, 'tags'>): {
  rootId?: string
  replyId?: string
} {
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1])
  if (eTags.length === 0) return {}

  const markedRoot = eTags.find((t) => t[3] === 'root')?.[1]
  const markedReply = eTags.find((t) => t[3] === 'reply')?.[1]
  if (markedRoot || markedReply) {
    return { rootId: markedRoot || markedReply, replyId: markedReply || markedRoot }
  }

  // Legacy positional NIP-10 fallback — exclude explicit mention/quote markers
  const positional = eTags.filter((t) => !t[3] || (t[3] !== 'mention' && t[3] !== 'quote'))
  if (positional.length === 0) return {}
  if (positional.length === 1) return { rootId: positional[0][1], replyId: positional[0][1] }
  return { rootId: positional[0][1], replyId: positional[positional.length - 1][1] }
}

/**
 * Extracts lowercase hashtags from both `t` tags and inline `#hashtag` tokens (matches Android #61).
 */
export function extractEventHashtags(event: Pick<Event, 'content' | 'tags'>): string[] {
  const set = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] === 't' && tag[1]) {
      set.add(tag[1].trim().toLowerCase().replace(/^#/, ''))
    }
  }
  // Strip URLs before scanning for inline #hashtags so URL #fragments aren't treated as tags
  const textWithoutUrls = (event.content || '').replace(/https?:\/\/\S+/gi, ' ')
  const inline = textWithoutUrls.match(/#[a-zA-Z0-9_]{1,64}/g) || []
  for (const h of inline) {
    set.add(h.slice(1).toLowerCase())
  }
  return [...set]
}
