import { verifyEvent, type Event } from 'nostr-tools/pure'

const PRIMAL_CACHE_URL = 'wss://cache2.primal.net/v1'

export interface GlobalTrendingBundle {
  hotNotes: Event[]
  trending24hNotes: Event[]
  profiles: Event[]
  zaps: Event[]
}

function isRecordEvent(x: unknown): x is Event {
  if (!x || typeof x !== 'object') return false
  const e = x as Partial<Event>
  return (
    typeof e.id === 'string' &&
    typeof e.pubkey === 'string' &&
    typeof e.created_at === 'number' &&
    typeof e.kind === 'number' &&
    Array.isArray(e.tags) &&
    typeof e.content === 'string' &&
    typeof e.sig === 'string'
  )
}

/**
 * Queries global 4h most-zapped and 24h trending notes over a single multiplexed WebSocket.
 * Every returned kind-0 / kind-1 / kind-9735 Nostr event is cryptographically verified via `verifyEvent`
 * so no cache server can forge or tamper with notes, profiles, or zaps.
 */
export async function fetchGlobalTrendingEvents(
  timeoutMs = 4500,
): Promise<GlobalTrendingBundle> {
  const empty: GlobalTrendingBundle = {
    hotNotes: [],
    trending24hNotes: [],
    profiles: [],
    zaps: [],
  }
  if (typeof WebSocket === 'undefined') return empty

  return new Promise((resolve) => {
    const hotNotes: Event[] = []
    const trending24hNotes: Event[] = []
    const profiles: Event[] = []
    const zaps: Event[] = []
    const seenHot = new Set<string>()
    const seen24h = new Set<string>()
    const seenProfiles = new Set<string>()
    const seenZaps = new Set<string>()
    let eoseCount = 0
    let settled = false
    let ws: WebSocket | null = null

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        try {
          ws.close()
        } catch {
          // ignore close errors
        }
      }
      resolve({ hotNotes, trending24hNotes, profiles, zaps })
    }

    const timer = setTimeout(finish, timeoutMs)

    try {
      ws = new WebSocket(PRIMAL_CACHE_URL)
      ws.onopen = () => {
        if (settled || !ws || ws.readyState !== WebSocket.OPEN) return
        try {
          ws.send(JSON.stringify(['REQ', 'fw_z4', { cache: ['explore_global_mostzapped_4h'] }]))
          ws.send(JSON.stringify(['REQ', 'fw_t24', { cache: ['explore_global_trending_24h'] }]))
        } catch {
          finish()
        }
      }

      ws.onmessage = (msg) => {
        if (settled) return
        try {
          const frame = JSON.parse(String(msg.data)) as unknown[]
          if (frame[0] === 'EOSE') {
            eoseCount++
            if (eoseCount >= 2) finish()
            return
          }
          if (frame[0] !== 'EVENT' || !isRecordEvent(frame[2])) return
          const subId = frame[1]
          const ev = frame[2]

          if (ev.kind === 1) {
            if (subId === 'fw_z4' && !seenHot.has(ev.id)) {
              if (!verifyEvent(ev)) return
              seenHot.add(ev.id)
              hotNotes.push(ev)
            } else if (subId === 'fw_t24' && !seen24h.has(ev.id)) {
              if (!verifyEvent(ev)) return
              seen24h.add(ev.id)
              trending24hNotes.push(ev)
            }
          } else if (ev.kind === 0 && !seenProfiles.has(ev.id)) {
            if (!verifyEvent(ev)) return
            seenProfiles.add(ev.id)
            profiles.push(ev)
          } else if (ev.kind === 9735 && !seenZaps.has(ev.id)) {
            if (!verifyEvent(ev)) return
            seenZaps.add(ev.id)
            zaps.push(ev)
          }
        } catch {
          // Ignore malformed frames
        }
      }

      ws.onerror = finish
      ws.onclose = finish
    } catch {
      finish()
    }
  })
}

/**
 * Merges 4h hot zapped notes, 24h global trending notes, and recent trending-relay notes into a fresh,
 * deduplicated feed (drops multi-week-old stale relay leftovers and caps per-author dominance).
 */
export function mergeTrendingNotes(params: {
  hotNotes: readonly Event[]
  trending24hNotes: readonly Event[]
  relayTrendingNotes: readonly Event[]
  nowSec?: number
  maxAgeSec?: number
  maxPerAuthor?: number
  limit?: number
}): Event[] {
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000)
  const maxAgeSec = params.maxAgeSec ?? 48 * 3600
  const maxPerAuthor = params.maxPerAuthor ?? 2
  const limit = params.limit ?? 120

  const seenIds = new Set<string>()
  const authorCounts = new Map<string, number>()
  const out: Event[] = []

  const pushTier = (tier: readonly Event[]) => {
    const sorted = [...tier].sort((a, b) => b.created_at - a.created_at)
    for (const ev of sorted) {
      if (out.length >= limit) break
      if (ev.kind !== 1) continue
      if (ev.created_at > nowSec + 300) continue
      if (nowSec - ev.created_at > maxAgeSec) continue
      if (seenIds.has(ev.id)) continue
      const pk = ev.pubkey.toLowerCase()
      const count = authorCounts.get(pk) || 0
      if (count >= maxPerAuthor) continue
      seenIds.add(ev.id)
      authorCounts.set(pk, count + 1)
      out.push(ev)
    }
  }

  // Fresh 4h most-zapped first, then 24h global trending, then recent trending.relays.land posts
  pushTier(params.hotNotes)
  pushTier(params.trending24hNotes)
  pushTier(params.relayTrendingNotes)

  return out
}
