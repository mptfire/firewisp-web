import type { Event } from 'nostr-tools/pure'
import { isValidHex64 } from '../sanitize'
import { encodeLiveNaddr, KIND_LIVE_ACTIVITY } from './nip53'
import { parseBolt11AmountSats } from './nip57'

export interface LiveZapItem {
  id: string
  senderPubkey: string
  recipientPubkey: string
  sats: number
  comment?: string
  targetEventId?: string
  targetLiveNaddr?: string
  createdAt: number
}

export interface LiveZapsStats {
  totalSats: number
  zapCount: number
  zapsPerMinute: number
}

function parseLiveATagToNaddr(rawATag?: string): string | undefined {
  if (!rawATag || !rawATag.startsWith(`${KIND_LIVE_ACTIVITY}:`)) return undefined
  const first = rawATag.indexOf(':')
  const second = rawATag.indexOf(':', first + 1)
  if (second <= first + 1) return undefined
  const hostPk = rawATag.slice(first + 1, second).toLowerCase()
  const dTag = rawATag.slice(second + 1).trim()
  if (!isValidHex64(hostPk) || !dTag) return undefined
  return encodeLiveNaddr(hostPk, dTag)
}

/**
 * Strictly parses a NIP-57 kind-9735 zap receipt for the live zap feed.
 * Rejects non-mainnet/zero-amount invoices, spoofed amount mismatches, and far-future timestamps.
 */
export function parseLiveZapReceipt(
  ev: Pick<Event, 'id' | 'kind' | 'pubkey' | 'tags' | 'created_at'>,
  nowSec = Math.floor(Date.now() / 1000),
): LiveZapItem | null {
  if (ev.kind !== 9735) return null
  if (ev.created_at > nowSec + 300) return null

  const bolt11 = ev.tags.find((t) => t[0] === 'bolt11' && t[1])?.[1]
  if (!bolt11) return null
  const sats = parseBolt11AmountSats(bolt11)
  if (!sats || sats < 1) return null

  const rawRecipient = ev.tags.find((t) => t[0] === 'p' && t[1])?.[1]?.toLowerCase()
  if (!rawRecipient || !isValidHex64(rawRecipient)) return null

  let senderPubkey: string | null = null
  let comment: string | undefined
  let targetEventId = ev.tags.find((t) => t[0] === 'e' && t[1] && isValidHex64(t[1]))?.[1]?.toLowerCase()
  let targetATag = ev.tags.find((t) => t[0] === 'a' && t[1])?.[1]?.trim()

  const desc = ev.tags.find((t) => t[0] === 'description' && t[1])?.[1]
  if (!desc) return null
  try {
    const parsed = JSON.parse(desc) as {
      pubkey?: unknown
      content?: unknown
      tags?: unknown
    }
    if (typeof parsed.pubkey === 'string' && isValidHex64(parsed.pubkey)) {
      senderPubkey = parsed.pubkey.toLowerCase()
    }
    if (typeof parsed.content === 'string') {
      const clean = parsed.content.trim()
      if (clean) comment = clean.slice(0, 280)
    }
    if (Array.isArray(parsed.tags)) {
      for (const t of parsed.tags) {
        if (!Array.isArray(t) || typeof t[0] !== 'string' || typeof t[1] !== 'string') continue
        if (t[0] === 'amount') {
          const msats = Number(t[1])
          if (Number.isFinite(msats) && msats > 0) {
            const reqSats = Math.floor(msats / 1000)
            if (Math.abs(reqSats - sats) > 1) return null
          }
        } else if (t[0] === 'e' && !targetEventId && isValidHex64(t[1])) {
          targetEventId = t[1].toLowerCase()
        } else if (t[0] === 'a' && !targetATag && t[1].trim()) {
          targetATag = t[1].trim()
        }
      }
    }
  } catch {
    // Malformed description JSON; reject receipt fail-closed
    return null
  }

  if (!senderPubkey) {
    return null
  }

  const targetLiveNaddr = parseLiveATagToNaddr(targetATag)

  return {
    id: ev.id,
    senderPubkey,
    recipientPubkey: rawRecipient,
    sats,
    comment,
    targetEventId: targetLiveNaddr ? undefined : targetEventId,
    targetLiveNaddr,
    createdAt: ev.created_at,
  }
}

export function computeLiveZapsStats(
  items: readonly LiveZapItem[],
  nowSec = Math.floor(Date.now() / 1000),
): LiveZapsStats {
  if (items.length === 0) {
    return { totalSats: 0, zapCount: 0, zapsPerMinute: 0 }
  }
  let totalSats = 0
  let oldest = items[0].createdAt
  for (const item of items) {
    totalSats += item.sats
    if (item.createdAt < oldest) oldest = item.createdAt
  }
  const spanMinutes = Math.max(1, (nowSec - oldest) / 60)
  const zapsPerMinute = Math.round((items.length / spanMinutes) * 10) / 10
  return {
    totalSats,
    zapCount: items.length,
    zapsPerMinute,
  }
}
