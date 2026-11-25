import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import { isValidHex64, sanitizePublicHttpsUrl, sanitizePublicRelayUrl } from '../sanitize'

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
  starts?: number
  ends?: number
  currentParticipants?: number
  participants: Array<{ pubkey: string; role?: string }>
  hashtags?: string[]
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

  const rawStarts = getTag('starts')
  const parsedStarts = rawStarts ? parseInt(rawStarts, 10) : NaN
  const starts = Number.isFinite(parsedStarts) && parsedStarts > 0 ? parsedStarts : undefined

  const rawEnds = getTag('ends')
  const parsedEnds = rawEnds ? parseInt(rawEnds, 10) : NaN
  const ends = Number.isFinite(parsedEnds) && parsedEnds > 0 ? parsedEnds : undefined

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
      const clean = sanitizePublicRelayUrl(raw)
      if (clean && !seenRelays.has(clean)) {
        seenRelays.add(clean)
        relayHints.push(clean)
      }
    }
  }

  const hashtags: string[] = []
  const seenTags = new Set<string>()
  for (const t of event.tags) {
    if (t[0] !== 't' || !t[1]) continue
    const clean = t[1].trim().replace(/^#+/, '').toLowerCase()
    if (clean && clean.length <= 32 && !seenTags.has(clean)) {
      seenTags.add(clean)
      hashtags.push(clean)
      if (hashtags.length >= 10) break
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
    starts,
    ends,
    currentParticipants,
    participants,
    hashtags,
    relayHints: relayHints.slice(0, 8),
    createdAt: event.created_at,
  }
}

export function getChatActivityRef(event: Pick<Event, 'kind' | 'tags'>): string | null {
  if (event.kind !== KIND_LIVE_CHAT_MESSAGE) return null
  const aTag = event.tags.find((t) => t[0] === 'a' && t[1])?.[1]?.trim()
  if (!aTag || !aTag.startsWith(`${KIND_LIVE_ACTIVITY}:`)) return null
  const firstSep = aTag.indexOf(':')
  const secondSep = aTag.indexOf(':', firstSep + 1)
  if (secondSep <= firstSep + 1) return null
  const pubkey = aTag.slice(firstSep + 1, secondSep)
  const dTag = aTag.slice(secondSep + 1)
  if (!isValidHex64(pubkey) || !dTag) return null
  return buildLiveATag(pubkey, dTag)
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
        .map((r) => sanitizePublicRelayUrl(r))
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

export interface FreshnessLiveStream {
  activity: Pick<LiveActivity, 'status' | 'streamingUrl' | 'ends' | 'createdAt'>
  chatters?: string[]
  lastChatAt?: number
}

const NON_STREAM_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'twitch.tv',
  'www.twitch.tv',
  'x.com',
  'twitter.com',
  'kick.com',
  'www.kick.com',
  'rumble.com',
  'njump.me',
  'nostr.com',
])

/**
 * Rejects obvious HTML webpage URLs placed in NIP-53 `streaming` tags that cannot play in HLS/video players.
 */
export function isPlayableStreamUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false
  const safe = sanitizePublicHttpsUrl(rawUrl)
  if (!safe) return false
  try {
    const u = new URL(safe)
    const host = u.hostname.toLowerCase()
    if (NON_STREAM_HOSTS.has(host)) return false
    if (/\.(html?|php|asp|aspx)$/i.test(u.pathname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Tombstone-aware comparison so an older `live` event from a lagging relay can never resurrect
 * a stream after a newer (or same-second) `ended` / `planned` event has already been observed.
 */
export function shouldAcceptLiveActivityUpdate(
  existing: { createdAt: number; status?: string } | undefined,
  incoming: { createdAt: number; status?: string },
): boolean {
  if (!existing) return true
  if (incoming.createdAt > existing.createdAt) return true
  if (incoming.createdAt < existing.createdAt) return false
  // Equal timestamp tie-breaker: non-live (ended/planned) beats live
  return existing.status === 'live' && incoming.status !== 'live'
}

export const LIVE_HEARTBEAT_MAX_AGE_SEC = 2 * 3600
export const LIVE_CHAT_GRACE_MAX_AGE_SEC = 3 * 3600
export const LIVE_RECENT_CHAT_WINDOW_SEC = 30 * 60

/**
 * Zero-privacy-leak liveness gate: checks NIP-53 status, playable HTTPS URL, `ends` expiry,
 * and heartbeat freshness (2h default, or 3h if chat was active within the last 30 min).
 */
export function isLiveStreamFresh(
  stream: FreshnessLiveStream,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  const { activity } = stream
  if (activity.status !== 'live') return false
  if (!isPlayableStreamUrl(activity.streamingUrl)) return false
  if (activity.ends && activity.ends > 0 && activity.ends <= nowSec) return false
  // Reject far-future created_at timestamps trying to stay "fresh" indefinitely
  if (activity.createdAt > nowSec + 300) return false

  const ageSec = nowSec - activity.createdAt
  if (ageSec <= LIVE_HEARTBEAT_MAX_AGE_SEC) return true
  if (
    ageSec <= LIVE_CHAT_GRACE_MAX_AGE_SEC &&
    stream.lastChatAt &&
    nowSec - stream.lastChatAt <= LIVE_RECENT_CHAT_WINDOW_SEC
  ) {
    return true
  }
  return false
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

/**
 * Builds the `kind: 1` note content and NIP-18/NIP-53 reference tags for sharing a live stream on Nostr.
 */
export function buildShareStreamNotePayload(params: {
  comment: string
  naddr: string
  hostPubkey: string
  streamerPubkey?: string
  dTag: string
  relayHint?: string
}): { content: string; extraTags: string[][] } {
  const cleanNaddr = params.naddr.trim().replace(/^nostr:/i, '')
  const nostrRef = `nostr:${cleanNaddr}`
  const cleanComment = params.comment.trim()
  const alreadyHasRef =
    cleanComment.toLowerCase().includes(cleanNaddr.toLowerCase())
  const content = !cleanComment
    ? nostrRef
    : alreadyHasRef
      ? cleanComment
      : `${cleanComment}\n\n${nostrRef}`

  const aTag = buildLiveATag(params.hostPubkey, params.dTag)
  const safeRelay = sanitizePublicRelayUrl(params.relayHint) || ''
  const extraTags: string[][] = [
    safeRelay ? ['q', aTag, safeRelay] : ['q', aTag],
    safeRelay ? ['a', aTag, safeRelay] : ['a', aTag],
  ]

  const pSeen = new Set<string>()
  for (const rawPk of [params.streamerPubkey, params.hostPubkey]) {
    if (!rawPk) continue
    const pk = rawPk.toLowerCase()
    if (isValidHex64(pk) && !pSeen.has(pk)) {
      pSeen.add(pk)
      extraTags.push(['p', pk])
    }
  }

  return { content, extraTags }
}

export interface StreamZapperSummary {
  pubkey: string
  totalSats: number
  zapCount: number
  lastZapAt: number
}

/**
 * Ranks stream zappers by total sats descending (ties broken by zap count, then most recent zap).
 */
export function rankTopZappers(
  zappers: Readonly<Record<string, StreamZapperSummary>>,
  limit = 10,
): StreamZapperSummary[] {
  return Object.values(zappers)
    .filter((z) => z.totalSats > 0)
    .sort(
      (a, b) =>
        b.totalSats - a.totalSats || b.zapCount - a.zapCount || b.lastZapAt - a.lastZapAt,
    )
    .slice(0, limit)
}
