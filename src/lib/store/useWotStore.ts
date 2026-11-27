import type { Event } from 'nostr-tools/pure'
import { create } from 'zustand'
import { nostrPool } from '../nostr/pool'
import {
  buildWotGraphFromContactLists,
  deleteWotSnapshotFromDb,
  getWotAuthorsForThreshold,
  KIND_NIP85_USER_ASSERTION,
  loadNip85CacheFromDb,
  loadWotSnapshotFromDb,
  parseNip85AssertionEvent,
  parseWotSnapshotJson,
  saveNip85CacheToDb,
  saveWotSnapshotToDb,
  serializeWotSnapshot,
  type Nip85TrustScore,
  type WotEntry,
  type WotGraphSnapshot,
} from '../nostr/wot'
import { isValidHex64 } from '../sanitize'
import { useAuthStore } from './useAuthStore'
import { useSettingsStore } from './useSettingsStore'

const MAX_FOLLOWS_CRAWLED = 800
const CHUNK_SIZE = 80
const WAVE_CONCURRENCY = 2
const WAVE_PAUSE_MS = 140

const attemptedNip85Keys = new Set<string>()
const inflightNip85Keys = new Set<string>()
let nip85BatchQueue = new Set<string>()
let nip85BatchTimer: ReturnType<typeof setTimeout> | null = null
let activeRefreshPromise: Promise<string[]> | null = null

export interface WotState {
  ownerPubkey: string | null
  entries: Record<string, WotEntry>
  updatedAt: number
  followsCrawled: number
  totalFollows: number
  hydrated: boolean
  crawling: boolean
  crawlProgress: number
  nip85Scores: Record<string, Nip85TrustScore>
  nip85CacheKey: string
  nip85Loading: boolean

  hydrateForUser: (ownerPubkey: string) => Promise<void>
  refreshWotGraph: (params: {
    ownerPubkey: string
    follows: readonly string[]
    relays: readonly string[]
    force?: boolean
  }) => Promise<string[]>
  importSnapshotJson: (
    ownerPubkey: string,
    rawJson: string,
  ) => Promise<{ ok: boolean; count: number; error?: string }>
  exportSnapshotJson: () => string | null
  clearLocalCache: (ownerPubkey: string) => Promise<void>
  fetchNip85Scores: (pubkeys: readonly string[]) => void
  resetSession: () => void
}

function getCurrentNip85Config() {
  const s = useSettingsStore.getState()
  if (!s.nip85Enabled || !isValidHex64(s.nip85ProviderPubkey) || !s.nip85RelayUrl) {
    return null
  }
  const providerPubkey = s.nip85ProviderPubkey.toLowerCase()
  return {
    providerPubkey,
    relayUrl: s.nip85RelayUrl,
    cacheKey: `${providerPubkey}@${s.nip85RelayUrl}`,
  }
}

export const useWotStore = create<WotState>((set, get) => ({
  ownerPubkey: null,
  entries: {},
  updatedAt: 0,
  followsCrawled: 0,
  totalFollows: 0,
  hydrated: false,
  crawling: false,
  crawlProgress: 0,
  nip85Scores: {},
  nip85CacheKey: '',
  nip85Loading: false,

  hydrateForUser: async (ownerPubkey) => {
    const cleanPk = ownerPubkey.trim().toLowerCase()
    if (!isValidHex64(cleanPk)) return
    const snap = await loadWotSnapshotFromDb(cleanPk)
    if (useAuthStore.getState().pubkey?.toLowerCase() !== cleanPk) return

    if (snap) {
      set({
        ownerPubkey: cleanPk,
        entries: snap.entries,
        updatedAt: snap.updatedAt,
        followsCrawled: snap.followsCrawled,
        totalFollows: snap.totalFollows,
        hydrated: true,
      })
    } else {
      set({
        ownerPubkey: cleanPk,
        entries: {},
        updatedAt: 0,
        followsCrawled: 0,
        totalFollows: 0,
        hydrated: true,
      })
    }

    const nip85Cfg = getCurrentNip85Config()
    if (nip85Cfg && get().nip85CacheKey !== nip85Cfg.cacheKey) {
      const scores = await loadNip85CacheFromDb(nip85Cfg.cacheKey)
      if (useAuthStore.getState().pubkey?.toLowerCase() !== cleanPk) return
      set({ nip85Scores: scores, nip85CacheKey: nip85Cfg.cacheKey })
    }
  },

  refreshWotGraph: async ({ ownerPubkey, follows, relays, force = false }) => {
    const cleanOwner = ownerPubkey.trim().toLowerCase()
    if (!isValidHex64(cleanOwner) || follows.length === 0) return []

    const settings = useSettingsStore.getState()
    const state = get()

    if (!force) {
      if (settings.mobileDataSaving) {
        return getWotAuthorsForThreshold(state.entries, settings.wotMinVouches, 250)
      }
      if (settings.wotAutoRefreshHours === 0) {
        return getWotAuthorsForThreshold(state.entries, settings.wotMinVouches, 250)
      }
      const maxAgeSec = settings.wotAutoRefreshHours * 3600
      const nowSec = Math.floor(Date.now() / 1000)
      if (
        state.ownerPubkey === cleanOwner &&
        state.updatedAt > 0 &&
        Object.keys(state.entries).length > 0 &&
        nowSec - state.updatedAt < maxAgeSec
      ) {
        return getWotAuthorsForThreshold(state.entries, settings.wotMinVouches, 250)
      }
    }

    if (activeRefreshPromise) return activeRefreshPromise

    const run = (async (): Promise<string[]> => {
      set({ crawling: true, crawlProgress: 0 })
      try {
        const targetFollows = [
          ...new Set(follows.map((p) => p.trim().toLowerCase()).filter((p) => isValidHex64(p))),
        ].slice(0, MAX_FOLLOWS_CRAWLED)

        if (targetFollows.length === 0) return []

        const chunks: string[][] = []
        for (let i = 0; i < targetFollows.length; i += CHUNK_SIZE) {
          chunks.push(targetFollows.slice(i, i + CHUNK_SIZE))
        }

        const relayList = [...new Set(relays)].slice(0, 10)
        const allContactEvents: Event[] = []

        for (let i = 0; i < chunks.length; i += WAVE_CONCURRENCY) {
          if (useAuthStore.getState().pubkey?.toLowerCase() !== cleanOwner) {
            return []
          }
          const wave = chunks.slice(i, i + WAVE_CONCURRENCY)
          const waveResults = await Promise.all(
            wave.map((chunk) =>
              nostrPool
                .query(relayList, { kinds: [3], authors: chunk, limit: chunk.length * 2 }, 4500)
                .catch(() => [] as Event[]),
            ),
          )
          for (const evs of waveResults) {
            allContactEvents.push(...evs)
          }
          const completed = Math.min(chunks.length, i + wave.length)
          set({ crawlProgress: Math.round((completed / chunks.length) * 100) })

          if (i + WAVE_CONCURRENCY < chunks.length) {
            await new Promise((r) => setTimeout(r, WAVE_PAUSE_MS))
          }
        }

        if (useAuthStore.getState().pubkey?.toLowerCase() !== cleanOwner) {
          return []
        }

        // Stale-while-revalidate: never wipe an existing cached graph if relays were offline
        const existingCount = Object.keys(get().entries).length
        if (allContactEvents.length === 0 && existingCount > 0) {
          return getWotAuthorsForThreshold(get().entries, useSettingsStore.getState().wotMinVouches, 250)
        }

        const snapshot = buildWotGraphFromContactLists({
          ownerPubkey: cleanOwner,
          follows,
          contactEvents: allContactEvents,
        })
        await saveWotSnapshotToDb(snapshot)

        if (useAuthStore.getState().pubkey?.toLowerCase() !== cleanOwner) {
          return []
        }

        set({
          ownerPubkey: cleanOwner,
          entries: snapshot.entries,
          updatedAt: snapshot.updatedAt,
          followsCrawled: snapshot.followsCrawled,
          totalFollows: snapshot.totalFollows,
          hydrated: true,
        })

        return getWotAuthorsForThreshold(
          snapshot.entries,
          useSettingsStore.getState().wotMinVouches,
          250,
        )
      } finally {
        activeRefreshPromise = null
        set({ crawling: false, crawlProgress: 0 })
      }
    })()

    activeRefreshPromise = run
    return run
  },

  importSnapshotJson: async (ownerPubkey, rawJson) => {
    const cleanOwner = ownerPubkey.trim().toLowerCase()
    const parsed = parseWotSnapshotJson(rawJson, cleanOwner)
    if (!parsed) {
      return {
        ok: false,
        count: 0,
        error: 'Invalid WoT backup file or pubkey does not match signed-in account.',
      }
    }
    await saveWotSnapshotToDb(parsed)
    set({
      ownerPubkey: cleanOwner,
      entries: parsed.entries,
      updatedAt: parsed.updatedAt,
      followsCrawled: parsed.followsCrawled,
      totalFollows: parsed.totalFollows,
      hydrated: true,
    })
    return { ok: true, count: Object.keys(parsed.entries).length }
  },

  exportSnapshotJson: () => {
    const s = get()
    if (!s.ownerPubkey) return null
    const snap: WotGraphSnapshot = {
      version: 1,
      ownerPubkey: s.ownerPubkey,
      updatedAt: s.updatedAt,
      followsCrawled: s.followsCrawled,
      totalFollows: s.totalFollows,
      entries: s.entries,
    }
    return serializeWotSnapshot(snap)
  },

  clearLocalCache: async (ownerPubkey) => {
    await deleteWotSnapshotFromDb(ownerPubkey)
    set({
      entries: {},
      updatedAt: 0,
      followsCrawled: 0,
      totalFollows: 0,
    })
  },

  fetchNip85Scores: (pubkeys) => {
    const cfg = getCurrentNip85Config()
    if (!cfg) return
    const existingScores = get().nip85CacheKey === cfg.cacheKey ? get().nip85Scores : {}

    for (const raw of pubkeys) {
      const pk = raw.trim().toLowerCase()
      if (!isValidHex64(pk)) continue
      const key = `${cfg.cacheKey}:${pk}`
      if (existingScores[pk] || attemptedNip85Keys.has(key) || inflightNip85Keys.has(key)) {
        continue
      }
      nip85BatchQueue.add(pk)
    }

    if (nip85BatchQueue.size === 0 || nip85BatchTimer) return

    nip85BatchTimer = setTimeout(() => {
      nip85BatchTimer = null
      const activeCfg = getCurrentNip85Config()
      if (!activeCfg || nip85BatchQueue.size === 0) {
        nip85BatchQueue.clear()
        return
      }
      const batch = [...nip85BatchQueue].slice(0, 40)
      nip85BatchQueue = new Set([...nip85BatchQueue].slice(40))
      for (const pk of batch) {
        const key = `${activeCfg.cacheKey}:${pk}`
        inflightNip85Keys.add(key)
        attemptedNip85Keys.add(key)
      }

      set({ nip85Loading: true })
      void nostrPool
        .query(
          [activeCfg.relayUrl],
          {
            kinds: [KIND_NIP85_USER_ASSERTION],
            authors: [activeCfg.providerPubkey],
            '#d': batch,
            limit: batch.length * 2,
          },
          4000,
        )
        .then((evs) => {
          const stillCfg = getCurrentNip85Config()
          if (!stillCfg || stillCfg.cacheKey !== activeCfg.cacheKey) return
          const updates: Record<string, Nip85TrustScore> = {}
          for (const ev of evs) {
            const parsed = parseNip85AssertionEvent(ev, activeCfg.providerPubkey)
            if (!parsed) continue
            const prev = updates[parsed.targetPubkey] ?? get().nip85Scores[parsed.targetPubkey]
            if (!prev || parsed.score.updatedAt >= prev.updatedAt) {
              updates[parsed.targetPubkey] = parsed.score
            }
          }
          if (Object.keys(updates).length > 0) {
            const nextScores = {
              ...(get().nip85CacheKey === activeCfg.cacheKey ? get().nip85Scores : {}),
              ...updates,
            }
            set({ nip85Scores: nextScores, nip85CacheKey: activeCfg.cacheKey })
            void saveNip85CacheToDb(activeCfg.cacheKey, nextScores)
          }
        })
        .catch(() => {})
        .finally(() => {
          for (const pk of batch) {
            inflightNip85Keys.delete(`${activeCfg.cacheKey}:${pk}`)
          }
          set({ nip85Loading: false })
        })
    }, 120)
  },

  resetSession: () => {
    attemptedNip85Keys.clear()
    inflightNip85Keys.clear()
    nip85BatchQueue.clear()
    if (nip85BatchTimer) {
      clearTimeout(nip85BatchTimer)
      nip85BatchTimer = null
    }
    set({
      ownerPubkey: null,
      entries: {},
      updatedAt: 0,
      followsCrawled: 0,
      totalFollows: 0,
      hydrated: false,
      crawling: false,
      crawlProgress: 0,
      nip85Scores: {},
      nip85CacheKey: '',
      nip85Loading: false,
    })
  },
}))
