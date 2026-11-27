import type { Event } from 'nostr-tools/pure'
import { isValidHex64 } from '../sanitize'

export const KIND_NIP85_USER_ASSERTION = 30382

export interface WotEntry {
  vouches: number
  by: string[]
}

export interface WotGraphSnapshot {
  version: 1
  ownerPubkey: string
  updatedAt: number
  followsCrawled: number
  totalFollows: number
  entries: Record<string, WotEntry>
}

export interface Nip85TrustScore {
  rank: number
  updatedAt: number
  providerPubkey: string
}

export interface WotEvaluation {
  trusted: boolean
  hop: 0 | 1 | 2 | null
  vouches: number
  by: string[]
  nip85Rank?: number
}

const MAX_SNAPSHOT_ENTRIES = 3000
const MAX_SAMPLE_VOUCHERS = 3
const MAX_NIP85_CACHE_ENTRIES = 5000

const DB_NAME = 'firewisp_wot_v1'
const DB_VERSION = 1
const GRAPH_STORE = 'graphs'
const NIP85_STORE = 'nip85'

function openWotDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(GRAPH_STORE)) {
          db.createObjectStore(GRAPH_STORE, { keyPath: 'ownerPubkey' })
        }
        if (!db.objectStoreNames.contains(NIP85_STORE)) {
          db.createObjectStore(NIP85_STORE, { keyPath: 'cacheKey' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export function buildWotGraphFromContactLists(params: {
  ownerPubkey: string
  follows: readonly string[]
  contactEvents: readonly Event[]
  maxEntries?: number
}): WotGraphSnapshot {
  const ownerPk = params.ownerPubkey.toLowerCase()
  const maxEntries = Math.max(100, Math.min(10000, params.maxEntries ?? MAX_SNAPSHOT_ENTRIES))

  const followSet = new Set<string>()
  for (const f of params.follows) {
    const clean = f.trim().toLowerCase()
    if (isValidHex64(clean) && clean !== ownerPk) followSet.add(clean)
  }

  const latestByAuthor = new Map<string, Event>()
  for (const ev of params.contactEvents) {
    if (!ev || ev.kind !== 3) continue
    const authorPk = ev.pubkey.toLowerCase()
    if (!followSet.has(authorPk)) continue
    const prev = latestByAuthor.get(authorPk)
    if (!prev || ev.created_at > prev.created_at) {
      latestByAuthor.set(authorPk, ev)
    }
  }

  const counts = new Map<string, WotEntry>()
  for (const [endorserPk, ev] of latestByAuthor) {
    const seenInList = new Set<string>()
    for (const t of ev.tags) {
      if (t[0] !== 'p' || !t[1]) continue
      const targetPk = t[1].trim().toLowerCase()
      if (
        seenInList.has(targetPk) ||
        targetPk === ownerPk ||
        followSet.has(targetPk) ||
        !isValidHex64(targetPk)
      ) {
        continue
      }
      seenInList.add(targetPk)
      const cur = counts.get(targetPk)
      if (cur) {
        cur.vouches += 1
        if (cur.by.length < MAX_SAMPLE_VOUCHERS) {
          cur.by.push(endorserPk)
        }
      } else {
        counts.set(targetPk, {
          vouches: 1,
          by: [endorserPk],
        })
      }
    }
  }

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1].vouches - a[1].vouches)
    .slice(0, maxEntries)

  const entries: Record<string, WotEntry> = {}
  for (const [pk, entry] of sorted) {
    entries[pk] = entry
  }

  return {
    version: 1,
    ownerPubkey: ownerPk,
    updatedAt: Math.floor(Date.now() / 1000),
    followsCrawled: latestByAuthor.size,
    totalFollows: followSet.size,
    entries,
  }
}

export function getWotAuthorsForThreshold(
  entries: Record<string, WotEntry>,
  minVouches: number,
  limit = 200,
): string[] {
  const threshold = Math.max(1, Math.floor(minVouches))
  const list: Array<[string, number]> = []
  for (const [pk, entry] of Object.entries(entries)) {
    if (entry && entry.vouches >= threshold) {
      list.push([pk, entry.vouches])
    }
  }
  list.sort((a, b) => b[1] - a[1])
  return list.slice(0, limit).map(([pk]) => pk)
}

export function evaluateWotStatus(params: {
  targetPubkey: string
  myPubkey: string | null
  followsSet: ReadonlySet<string>
  entries: Record<string, WotEntry>
  minVouches: number
  nip85Scores?: Record<string, Nip85TrustScore>
  nip85MinRank?: number
}): WotEvaluation {
  const cleanTarget = params.targetPubkey.trim().toLowerCase()
  const cleanMe = params.myPubkey?.trim().toLowerCase() || ''
  const nip85Score = params.nip85Scores?.[cleanTarget]
  const nip85Rank = nip85Score?.rank
  const minRank = Math.max(1, Math.min(100, params.nip85MinRank ?? 20))
  const nip85Trusted = nip85Rank !== undefined && nip85Rank >= minRank

  if (cleanMe && cleanTarget === cleanMe) {
    return { trusted: true, hop: 0, vouches: 0, by: [], nip85Rank }
  }
  if (params.followsSet.has(cleanTarget)) {
    return { trusted: true, hop: 1, vouches: 0, by: [], nip85Rank }
  }

  const entry = params.entries[cleanTarget]
  if (entry) {
    const trusted = entry.vouches >= Math.max(1, Math.floor(params.minVouches)) || nip85Trusted
    return {
      trusted,
      hop: 2,
      vouches: entry.vouches,
      by: entry.by,
      nip85Rank,
    }
  }

  return {
    trusted: nip85Trusted,
    hop: null,
    vouches: 0,
    by: [],
    nip85Rank,
  }
}

export function serializeWotSnapshot(snapshot: WotGraphSnapshot): string {
  return JSON.stringify(snapshot)
}

export function parseWotSnapshotJson(
  raw: string,
  expectedOwnerPubkey: string,
): WotGraphSnapshot | null {
  const expectedPk = expectedOwnerPubkey.trim().toLowerCase()
  if (!isValidHex64(expectedPk)) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WotGraphSnapshot> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.version !== 1) return null
    if (typeof parsed.ownerPubkey !== 'string') return null
    if (parsed.ownerPubkey.trim().toLowerCase() !== expectedPk) return null

    const updatedAt =
      typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) && parsed.updatedAt >= 0
        ? Math.floor(parsed.updatedAt)
        : 0
    const followsCrawled =
      typeof parsed.followsCrawled === 'number' &&
      Number.isFinite(parsed.followsCrawled) &&
      parsed.followsCrawled >= 0
        ? Math.floor(parsed.followsCrawled)
        : 0
    const totalFollows =
      typeof parsed.totalFollows === 'number' &&
      Number.isFinite(parsed.totalFollows) &&
      parsed.totalFollows >= 0
        ? Math.floor(parsed.totalFollows)
        : 0

    if (!parsed.entries || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      return null
    }

    const validatedList: Array<[string, WotEntry]> = []
    for (const [rawPk, rawEntry] of Object.entries(parsed.entries)) {
      const pk = rawPk.trim().toLowerCase()
      if (!isValidHex64(pk) || pk === expectedPk) continue
      if (!rawEntry || typeof rawEntry !== 'object') continue
      const candidate = rawEntry as { vouches?: unknown; by?: unknown }
      const vouches =
        typeof candidate.vouches === 'number' &&
        Number.isFinite(candidate.vouches) &&
        candidate.vouches >= 1
          ? Math.floor(candidate.vouches)
          : 0
      if (vouches < 1) continue

      const by: string[] = []
      if (Array.isArray(candidate.by)) {
        for (const rawVoucher of candidate.by) {
          if (typeof rawVoucher !== 'string') continue
          const vPk = rawVoucher.trim().toLowerCase()
          if (isValidHex64(vPk) && !by.includes(vPk)) {
            by.push(vPk)
            if (by.length >= MAX_SAMPLE_VOUCHERS) break
          }
        }
      }
      validatedList.push([pk, { vouches, by }])
    }

    validatedList.sort((a, b) => b[1].vouches - a[1].vouches)
    const entries: Record<string, WotEntry> = {}
    for (const [pk, entry] of validatedList.slice(0, MAX_SNAPSHOT_ENTRIES)) {
      entries[pk] = entry
    }

    return {
      version: 1,
      ownerPubkey: expectedPk,
      updatedAt,
      followsCrawled,
      totalFollows,
      entries,
    }
  } catch {
    return null
  }
}

export function parseNip85AssertionEvent(
  ev: Pick<Event, 'kind' | 'pubkey' | 'tags' | 'created_at'>,
  expectedProviderPubkey: string,
): { targetPubkey: string; score: Nip85TrustScore } | null {
  if (!ev || ev.kind !== KIND_NIP85_USER_ASSERTION) return null
  const expectedProvider = expectedProviderPubkey.trim().toLowerCase()
  const actualProvider = ev.pubkey?.trim().toLowerCase() || ''
  if (!isValidHex64(expectedProvider) || actualProvider !== expectedProvider) return null

  const dTag = ev.tags.find((t) => t[0] === 'd' && t[1])?.[1]?.trim().toLowerCase()
  if (!dTag || !isValidHex64(dTag)) return null

  const rawRank = ev.tags.find((t) => t[0] === 'rank' && t[1])?.[1]
  if (rawRank === undefined) return null
  const numericRank = Number(rawRank)
  if (!Number.isFinite(numericRank)) return null

  const rank = Math.min(100, Math.max(0, Math.round(numericRank)))
  return {
    targetPubkey: dTag,
    score: {
      rank,
      updatedAt: ev.created_at,
      providerPubkey: expectedProvider,
    },
  }
}

export async function loadWotSnapshotFromDb(
  ownerPubkey: string,
): Promise<WotGraphSnapshot | null> {
  const cleanPk = ownerPubkey.trim().toLowerCase()
  if (!isValidHex64(cleanPk)) return null
  const db = await openWotDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(GRAPH_STORE, 'readonly')
      const req = tx.objectStore(GRAPH_STORE).get(cleanPk)
      req.onsuccess = () => {
        const res = req.result as WotGraphSnapshot | undefined
        if (!res || res.version !== 1 || res.ownerPubkey !== cleanPk || !res.entries) {
          resolve(null)
          return
        }
        resolve(res)
      }
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    } catch {
      db.close()
      resolve(null)
    }
  })
}

export async function saveWotSnapshotToDb(snapshot: WotGraphSnapshot): Promise<void> {
  if (!isValidHex64(snapshot.ownerPubkey)) return
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => {})
  }
  const db = await openWotDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(GRAPH_STORE, 'readwrite')
      tx.objectStore(GRAPH_STORE).put(snapshot)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
      tx.onabort = () => {
        db.close()
        resolve()
      }
    } catch {
      db.close()
      resolve()
    }
  })
}

export async function deleteWotSnapshotFromDb(ownerPubkey: string): Promise<void> {
  const cleanPk = ownerPubkey.trim().toLowerCase()
  if (!isValidHex64(cleanPk)) return
  const db = await openWotDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(GRAPH_STORE, 'readwrite')
      tx.objectStore(GRAPH_STORE).delete(cleanPk)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    } catch {
      db.close()
      resolve()
    }
  })
}

export async function loadNip85CacheFromDb(
  cacheKey: string,
): Promise<Record<string, Nip85TrustScore>> {
  if (!cacheKey) return {}
  const db = await openWotDb()
  if (!db) return {}
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(NIP85_STORE, 'readonly')
      const req = tx.objectStore(NIP85_STORE).get(cacheKey)
      req.onsuccess = () => {
        const res = req.result as { cacheKey?: string; scores?: Record<string, Nip85TrustScore> } | undefined
        resolve(res?.scores && typeof res.scores === 'object' ? res.scores : {})
      }
      req.onerror = () => resolve({})
      tx.oncomplete = () => db.close()
    } catch {
      db.close()
      resolve({})
    }
  })
}

export async function saveNip85CacheToDb(
  cacheKey: string,
  scores: Record<string, Nip85TrustScore>,
): Promise<void> {
  if (!cacheKey) return
  const db = await openWotDb()
  if (!db) return
  const entries = Object.entries(scores)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_NIP85_CACHE_ENTRIES)
  const trimmed: Record<string, Nip85TrustScore> = {}
  for (const [k, v] of entries) trimmed[k] = v

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(NIP85_STORE, 'readwrite')
      tx.objectStore(NIP85_STORE).put({ cacheKey, scores: trimmed })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        resolve()
      }
    } catch {
      db.close()
      resolve()
    }
  })
}
