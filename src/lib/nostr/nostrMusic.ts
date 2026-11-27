import type { Event } from 'nostr-tools/pure'
import { sanitizePublicHttpsUrl } from '../sanitize'

export const KIND_MUSIC_PLAYLIST = 34139
export const KIND_MUSIC_TRACK = 36787

export interface NostrMusicTrack {
  eventId: string
  pubkey: string
  dTag: string
  aTag: string
  title: string
  artist: string
  album?: string
  trackNumber?: number
  durationSec?: number
  imageUrl?: string
  released?: string
  audioUrls: string[]
  mime?: string
  lyrics?: string
  createdAt: number
}

export interface NostrMusicTrackRef {
  pubkey: string
  dTag: string
  aTag: string
}

export interface NostrMusicPlaylist {
  eventId: string
  pubkey: string
  dTag: string
  aTag: string
  title: string
  artist?: string
  type: string
  released?: string
  imageUrl?: string
  trackRefs: NostrMusicTrackRef[]
  createdAt: number
}

const HEX64_RE = /^[0-9a-f]{64}$/i
const MAX_PLAYLIST_TRACKS = 50

function getTagValue(tags: string[][], name: string): string {
  return tags.find((t) => t[0] === name && t[1])?.[1]?.trim() || ''
}

/**
 * Formats seconds cleanly into `m:ss` (or `h:mm:ss`) for track rows.
 */
export function formatTrackDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Parses a kind-36787 Nostr music track event with strict HTTPS/SSRF sanitization on audio & cover URLs.
 */
export function parseMusicTrackEvent(event: Event): NostrMusicTrack | null {
  if (event.kind !== KIND_MUSIC_TRACK) return null
  const dTag = getTagValue(event.tags, 'd')
  if (!dTag) return null

  const seenUrls = new Set<string>()
  const audioUrls: string[] = []
  const pushSafeAudio = (raw: string | undefined) => {
    const safe = sanitizePublicHttpsUrl(raw)
    if (safe && !seenUrls.has(safe)) {
      seenUrls.add(safe)
      audioUrls.push(safe)
    }
  }

  pushSafeAudio(getTagValue(event.tags, 'url'))
  for (const t of event.tags) {
    if (t[0] === 'fallback' && t[1]) pushSafeAudio(t[1])
  }
  if (audioUrls.length === 0) return null

  const pubkey = event.pubkey.toLowerCase()
  const title = getTagValue(event.tags, 'title') || 'Untitled Track'
  const artist = getTagValue(event.tags, 'artist') || 'Unknown Artist'
  const album = getTagValue(event.tags, 'album') || undefined
  const numRaw = Number(getTagValue(event.tags, 'track_number'))
  const durRaw = Number(getTagValue(event.tags, 'duration'))
  const imageUrl = sanitizePublicHttpsUrl(getTagValue(event.tags, 'image')) || undefined
  const released = getTagValue(event.tags, 'released') || undefined
  const mime = getTagValue(event.tags, 'm') || undefined
  const lyrics = event.content?.trim() || undefined

  return {
    eventId: event.id,
    pubkey,
    dTag,
    aTag: `${KIND_MUSIC_TRACK}:${pubkey}:${dTag}`,
    title,
    artist,
    album,
    trackNumber: Number.isFinite(numRaw) && numRaw > 0 ? numRaw : undefined,
    durationSec: Number.isFinite(durRaw) && durRaw > 0 ? durRaw : undefined,
    imageUrl,
    released,
    audioUrls,
    mime,
    lyrics,
    createdAt: event.created_at,
  }
}

/**
 * Parses a kind-34139 Nostr music album/playlist event and validates referenced kind-36787 track coordinates.
 */
export function parseMusicPlaylistEvent(event: Event): NostrMusicPlaylist | null {
  if (event.kind !== KIND_MUSIC_PLAYLIST) return null
  const dTag = getTagValue(event.tags, 'd')
  if (!dTag) return null

  const pubkey = event.pubkey.toLowerCase()
  const title = getTagValue(event.tags, 'title') || 'Untitled Release'
  const artist = getTagValue(event.tags, 'artist') || undefined
  const type = getTagValue(event.tags, 'type') || 'playlist'
  const released = getTagValue(event.tags, 'released') || undefined
  const imageUrl = sanitizePublicHttpsUrl(getTagValue(event.tags, 'image')) || undefined

  const seenATags = new Set<string>()
  const trackRefs: NostrMusicTrackRef[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'a' || !tag[1]) continue
    const firstColon = tag[1].indexOf(':')
    const secondColon = firstColon > 0 ? tag[1].indexOf(':', firstColon + 1) : -1
    if (firstColon <= 0 || secondColon <= firstColon) continue
    const refKind = Number(tag[1].slice(0, firstColon))
    const refPubkey = tag[1].slice(firstColon + 1, secondColon).toLowerCase()
    const refDTag = tag[1].slice(secondColon + 1)
    if (refKind !== KIND_MUSIC_TRACK || !HEX64_RE.test(refPubkey) || !refDTag) continue
    const normalized = `${KIND_MUSIC_TRACK}:${refPubkey}:${refDTag}`
    if (seenATags.has(normalized)) continue
    seenATags.add(normalized)
    trackRefs.push({ pubkey: refPubkey, dTag: refDTag, aTag: normalized })
    if (trackRefs.length >= MAX_PLAYLIST_TRACKS) break
  }

  return {
    eventId: event.id,
    pubkey,
    dTag,
    aTag: `${KIND_MUSIC_PLAYLIST}:${pubkey}:${dTag}`,
    title,
    artist,
    type,
    released,
    imageUrl,
    trackRefs,
    createdAt: event.created_at,
  }
}
