import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import { isValidHex64, sanitizePublicHttpsUrl, sanitizeRelayUrl } from '../sanitize'

export const KIND_LIVE_ACTIVITY = 30311
export const KIND_LIVE_CHAT_MESSAGE = 1311

export const LIVE_DISCOVERY_RELAYS = [
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
]

export interface LiveActivity {
  eventId: string
  dTag: string
  hostPubkey: string
  streamerPubkey?: string
  title?: string
  summary?: string
  image?: string
  status?: 'live' | 'planned' | 'ended' | string
  streamingUrl?: string
  recordingUrl?: string
  currentParticipants?: number
  participants: Array<{ pubkey: string; role?: string }>
  relayHints: string[]
  createdAt: number
}

function clip(val: string | undefined, max: number): string | undefined {
  if (!val) return undefined
  const t = val.trim()
  return t ? t.slice(0, max) : undefined
}

export function buildLiveATag(hostPubkey: string, dTag: string): string {
  return `${KIND_LIVE_ACTIVITY}:${hostPubkey.toLowerCase()}:${dTag}`
}

export function parseLiveActivity(event: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags' | 'created_at'>): LiveActivity | null {
  if (event.kind !== KIND_LIVE_ACTIVITY) return null
  const dTag = event.tags.find((t) => t[0] === 'd' && t[1])?.[1]?.trim()
  if (!dTag) return null

  const getTag = (name: string) => event.tags.find((t) => t[0] === name && t[1])?.[1]

  const title = clip(getTag('title'), 140)
  const summary = clip(getTag('summary'), 600)
  const image = sanitizePublicHttpsUrl(getTag('image')) || undefined
  const status = getTag('status')?.trim().toLowerCase()
  const streamingUrl = sanitizePublicHttpsUrl(getTag('streaming')) || undefined
  const recordingUrl = sanitizePublicHttpsUrl(getTag('recording')) || undefined

  const rawCount = getTag('current_participants')
  const parsedCount = rawCount ? parseInt(rawCount, 10) : NaN
  const currentParticipants = Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : undefined

  const participants: Array<{ pubkey: string; role?: string }> = []
  let streamerPubkey: string | undefined
  for (const t of event.tags) {
    if (t[0] !== 'p' || !t[1] || !isValidHex64(t[1])) continue
    const pk = t[1].toLowerCase()
    const role = t[3]?.trim()
    participants.push({ pubkey: pk, role })
    if (!streamerPubkey && role && role.toLowerCase() === 'host') {
      streamerPubkey = pk
    }
  }

  const relayHints: string[] = []
  const seenRelays = new Set<string>()
  for (const t of event.tags) {
    if (t[0] !== 'relays' && t[0] !== 'relay' && t[0] !== 'r') continue
    const vals = t[0] === 'relays' ? t.slice(1) : [t[1]]
    for (const raw of vals) {
      const clean = sanitizeRelayUrl(raw)
      if (clean && !seenRelays.has(clean)) {
        seenRelays.add(clean)
        relayHints.push(clean)
      }
    }
  }

  return {
    eventId: event.id,
    dTag,
    hostPubkey: event.pubkey.toLowerCase(),
    streamerPubkey,
    title,
    summary,
    image,
    status,
    streamingUrl,
    recordingUrl,
    currentParticipants,
    participants,
    relayHints: relayHints.slice(0, 8),
    createdAt: event.created_at,
  }
}

export function getChatActivityRef(event: Pick<Event, 'kind' | 'tags'>): string | null {
  if (event.kind !== KIND_LIVE_CHAT_MESSAGE) return null
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1])?.[1]
  if (!aTag || !aTag.startsWith(`${KIND_LIVE_ACTIVITY}:`)) return null
  return aTag
}

export function encodeLiveNaddr(hostPubkey: string, dTag: string, relays: string[] = []): string {
  return nip19.naddrEncode({
    kind: KIND_LIVE_ACTIVITY,
    pubkey: hostPubkey.toLowerCase(),
    identifier: dTag,
    relays: relays.slice(0, 4),
  })
}

export function decodeLiveNaddr(raw: string): {
  hostPubkey: string
  dTag: string
  relays: string[]
} | null {
  const clean = raw.trim().replace(/^nostr:/i, '')
  if (!clean) return null
  try {
    const dec = nip19.decode(clean)
    if (dec.type === 'naddr' && dec.data.kind === KIND_LIVE_ACTIVITY && isValidHex64(dec.data.pubkey)) {
      const relays = (dec.data.relays || [])
        .map((r) => sanitizeRelayUrl(r))
        .filter((r): r is string => Boolean(r))
      return {
        hostPubkey: dec.data.pubkey.toLowerCase(),
        dTag: dec.data.identifier,
        relays,
      }
    }
  } catch {
    // not naddr
  }
  return null
}

export interface RankableLiveStream {
  activity: Pick<LiveActivity, 'hostPubkey' | 'streamerPubkey' | 'currentParticipants' | 'createdAt'>
  chatters: string[]
}

export function isStreamFollowed(
  activity: Pick<LiveActivity, 'hostPubkey' | 'streamerPubkey'>,
  followSet: ReadonlySet<string>,
): boolean {
  if (followSet.size === 0) return false
  const hostPk = activity.hostPubkey.toLowerCase()
  if (followSet.has(hostPk)) return true
  const streamerPk = activity.streamerPubkey?.toLowerCase()
  return Boolean(streamerPk && followSet.has(streamerPk))
}

export function getStreamPrimaryPubkey(
  activity: Pick<LiveActivity, 'hostPubkey' | 'streamerPubkey'>,
): string {
  return (activity.streamerPubkey || activity.hostPubkey).toLowerCase()
}

/**
 * Ranks live streams in preferred order:
 * 1. Streamers in the user's follow list first
 * 2. Highest Nostr follower count (NIP-45 kind-3 COUNT)
 * 3. Most active viewers / chatters
 * 4. Most recently started
 */
export function sortLiveStreams<T extends RankableLiveStream>(
  streams: T[],
  followSet: ReadonlySet<string>,
  followerCounts: Readonly<Record<string, number>>,
): T[] {
  return [...streams].sort((a, b) => {
    const followedA = isStreamFollowed(a.activity, followSet) ? 1 : 0
    const followedB = isStreamFollowed(b.activity, followSet) ? 1 : 0
    if (followedB !== followedA) return followedB - followedA

    const pkA = getStreamPrimaryPubkey(a.activity)
    const pkB = getStreamPrimaryPubkey(b.activity)
    const followersA = followerCounts[pkA] ?? followerCounts[a.activity.hostPubkey.toLowerCase()] ?? 0
    const followersB = followerCounts[pkB] ?? followerCounts[b.activity.hostPubkey.toLowerCase()] ?? 0
    if (followersB !== followersA) return followersB - followersA

    const activityA = (a.activity.currentParticipants || 0) + a.chatters.length
    const activityB = (b.activity.currentParticipants || 0) + b.chatters.length
    if (activityB !== activityA) return activityB - activityA

    return b.activity.createdAt - a.activity.createdAt
  })
}
