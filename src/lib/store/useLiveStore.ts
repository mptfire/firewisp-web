import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { nostrPool } from '../nostr/pool'
import {
  buildLiveATag,
  getChatActivityRef,
  isPlayableStreamUrl,
  KIND_LIVE_ACTIVITY,
  KIND_LIVE_CHAT_MESSAGE,
  LIVE_DISCOVERY_RELAYS,
  parseLiveActivity,
  shouldAcceptLiveActivityUpdate,
  type LiveActivity,
  type StreamZapperSummary,
} from '../nostr/nip53'
import { sanitizePublicRelayUrl } from '../sanitize'
import { useAuthStore } from './useAuthStore'
import { parseZapReceiptInfo, useNostrStore } from './useNostrStore'
import { useSettingsStore } from './useSettingsStore'
import { stripTrackingParamsInText } from '../nostr/urlClean'

export interface LiveChatMessage {
  id: string
  senderPubkey: string
  content: string
  tags: string[][]
  createdAt: number
  replyToId?: string
  isZapAnnouncement?: boolean
  zapAmountSats?: number
}

export interface LiveStreamEntry {
  activity: LiveActivity
  aTagValue: string
  chatters: string[]
  lastChatAt: number
}

export interface MiniPlayerStream {
  aTag: string
  naddr: string
  streamUrl: string
  posterUrl?: string
  title: string
  hostName: string
  isLive: boolean
}

interface LiveState {
  liveStreams: Record<string, LiveStreamEntry>
  streamerFollowerCounts: Record<string, number>
  activeATag: string | null
  activeActivity: LiveActivity | null
  focusedChatATag: string | null
  focusedChatTitle: string | null
  activeChatRelays: string[]
  currentChatMessages: LiveChatMessage[]
  streamZapTotal: number
  streamZappers: Record<string, StreamZapperSummary>
  loadingStream: boolean
  miniPlayer: MiniPlayerStream | null
  miniChatMessages: LiveChatMessage[]
  miniChatRelays: string[]
  activeInlineStreamKey: string | null
  audioOwner: 'main' | 'mini'
  mainPlayerActive: boolean

  subscribeLiveDiscovery: () => () => void
  fetchStreamerFollowerCounts: (pubkeys: string[]) => Promise<void>
  fetchLiveActivityOnce: (
    hostPubkey: string,
    dTag: string,
    naddrRelays?: string[],
  ) => Promise<LiveActivity | null>
  markStreamOffline: (aTag: string) => void
  markStreamOnline: (aTag: string) => void
  openMiniPlayer: (stream: MiniPlayerStream) => void
  closeMiniPlayer: () => void
  setActiveInlineStream: (key: string | null) => void
  setAudioOwner: (owner: 'main' | 'mini') => void
  setMainPlayerActive: (active: boolean) => void
  subscribeMiniChat: (
    hostPubkey: string,
    dTag: string,
    naddrRelays?: string[],
  ) => () => void
  subscribeActiveStream: (
    hostPubkey: string,
    dTag: string,
    naddrRelays?: string[],
  ) => () => void
  subscribeFocusedChat: (
    hostPubkey: string,
    dTag: string,
    naddrRelays?: string[],
    streamTitle?: string,
  ) => () => void
  sendChatMessage: (
    hostPubkey: string,
    dTag: string,
    content: string,
    replyToId?: string,
    extraTags?: string[][],
  ) => Promise<void>
}

const pendingChatters = new Map<string, Set<string>>()
const pendingChatAt = new Map<string, number>()
const latestActivitySeen = new Map<string, { createdAt: number; status: string }>()
const offlineStreamBackup = new Map<string, LiveStreamEntry>()
const fetchedFollowerPubkeys = new Set<string>()
const NIP45_COUNT_RELAYS = ['wss://relay.primal.net', 'wss://nos.lol']

function isClientOnline(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  const statuses = Object.values(useNostrStore.getState().relayStatuses)
  // Once relays are initialized, require at least one connected relay so a local outage never wipes LIVE NOW
  if (statuses.length > 0 && !statuses.some((st) => st === 'connected')) return false
  return true
}

/**
 * Queries NIP-45 `COUNT` (`kind: 3`, `#p`) over a single multiplexed WebSocket
 * for a batch of streamer pubkeys, with automatic fallback relay.
 */
async function queryNip45FollowerBatch(
  relayUrl: string,
  pubkeys: string[],
  timeoutMs = 3500,
): Promise<Record<string, number>> {
  if (typeof WebSocket === 'undefined' || pubkeys.length === 0) return {}
  return new Promise((resolve) => {
    const counts: Record<string, number> = {}
    const subToPk = new Map<string, string>()
    const resolvedSubs = new Set<string>()
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
      resolve(counts)
    }

    const timer = setTimeout(finish, timeoutMs)

    try {
      ws = new WebSocket(relayUrl)
      ws.onopen = () => {
        if (settled || !ws || ws.readyState !== WebSocket.OPEN) return
        try {
          pubkeys.forEach((pk, idx) => {
            const subId = `fc_${idx}`
            subToPk.set(subId, pk)
            ws?.send(JSON.stringify(['COUNT', subId, { kinds: [3], '#p': [pk] }]))
          })
        } catch {
          finish()
        }
      }
      ws.onmessage = (ev) => {
        if (settled) return
        try {
          const msg = JSON.parse(String(ev.data)) as unknown[]
          if ((msg[0] === 'COUNT' || msg[0] === 'CLOSED') && typeof msg[1] === 'string') {
            const pk = subToPk.get(msg[1])
            if (pk) {
              resolvedSubs.add(msg[1])
              if (msg[0] === 'COUNT') {
                const payload = msg[2] as { count?: unknown } | undefined
                if (typeof payload?.count === 'number' && Number.isFinite(payload.count)) {
                  counts[pk] = Math.max(0, Math.floor(payload.count))
                }
              }
              if (resolvedSubs.size >= pubkeys.length) {
                finish()
              }
            }
          }
        } catch {
          // ignore malformed frames
        }
      }
      ws.onerror = finish
      ws.onclose = finish
    } catch {
      finish()
    }
  })
}

export const useLiveStore = create<LiveState>((set, get) => ({
  liveStreams: {},
  streamerFollowerCounts: {},
  activeATag: null,
  activeActivity: null,
  focusedChatATag: null,
  focusedChatTitle: null,
  activeChatRelays: [],
  currentChatMessages: [],
  streamZapTotal: 0,
  streamZappers: {},
  loadingStream: false,
  miniPlayer: null,
  miniChatMessages: [],
  miniChatRelays: [],
  activeInlineStreamKey: null,
  audioOwner: 'main',
  mainPlayerActive: false,

  openMiniPlayer: (stream) =>
    set((s) => ({
      activeInlineStreamKey: s.activeInlineStreamKey === stream.aTag ? null : s.activeInlineStreamKey,
      miniPlayer: stream,
      audioOwner: 'mini',
      miniChatMessages:
        s.focusedChatATag === stream.aTag
          ? s.currentChatMessages.slice(-120)
          : s.miniPlayer?.aTag === stream.aTag
            ? s.miniChatMessages
            : [],
      miniChatRelays:
        s.focusedChatATag === stream.aTag && s.activeChatRelays.length > 0
          ? s.activeChatRelays
          : s.miniPlayer?.aTag === stream.aTag
            ? s.miniChatRelays
            : [],
    })),
  closeMiniPlayer: () =>
    set({ miniPlayer: null, miniChatMessages: [], miniChatRelays: [], audioOwner: 'main' }),
  setActiveInlineStream: (key) =>
    set((s) => {
      if (!key) {
        return {
          activeInlineStreamKey: null,
          ...(s.miniPlayer && !s.mainPlayerActive ? { audioOwner: 'mini' as const } : {}),
        }
      }
      // If playing the same stream inline that is floating in mini-player, dock it; otherwise keep mini-player open & muted
      if (s.miniPlayer && s.miniPlayer.aTag === key) {
        return {
          activeInlineStreamKey: key,
          miniPlayer: null,
          miniChatMessages: [],
          miniChatRelays: [],
          audioOwner: 'main' as const,
        }
      }
      return {
        activeInlineStreamKey: key,
        audioOwner: 'main' as const,
      }
    }),
  setAudioOwner: (audioOwner) => set({ audioOwner }),
  setMainPlayerActive: (mainPlayerActive) =>
    set((s) => ({
      mainPlayerActive,
      ...(!mainPlayerActive && !s.activeInlineStreamKey && s.miniPlayer
        ? { audioOwner: 'mini' as const }
        : {}),
    })),

  fetchStreamerFollowerCounts: async (pubkeys) => {
    const allPending = [
      ...new Set(
        pubkeys
          .map((p) => p.toLowerCase())
          .filter((p) => /^[0-9a-f]{64}$/.test(p) && !fetchedFollowerPubkeys.has(p)),
      ),
    ]
    if (allPending.length === 0) return

    for (let i = 0; i < allPending.length; i += 25) {
      const pending = allPending.slice(i, i + 25)
      for (const pk of pending) fetchedFollowerPubkeys.add(pk)

      let counts: Record<string, number> = {}
      for (const relay of NIP45_COUNT_RELAYS) {
        counts = await queryNip45FollowerBatch(relay, pending, 3500)
        if (Object.keys(counts).length > 0) break
      }

      if (Object.keys(counts).length > 0) {
        set((s) => ({
          streamerFollowerCounts: { ...s.streamerFollowerCounts, ...counts },
        }))
      }
      // Allow retry later for any pubkeys missing from the response
      for (const pk of pending) {
        if (counts[pk] === undefined) fetchedFollowerPubkeys.delete(pk)
      }
    }
  },

  markStreamOffline: (aTag) => {
    if (!isClientOnline()) return
    const nowSec = Math.floor(Date.now() / 1000)
    const prevSeen = latestActivitySeen.get(aTag)
    latestActivitySeen.set(aTag, {
      createdAt: Math.max(prevSeen?.createdAt || 0, nowSec),
      status: 'ended',
    })
    set((s) => {
      const removed = s.liveStreams[aTag]
      if (removed) {
        offlineStreamBackup.set(aTag, removed)
        if (offlineStreamBackup.size > 60) {
          const oldestKey = offlineStreamBackup.keys().next().value
          if (oldestKey) offlineStreamBackup.delete(oldestKey)
        }
      }
      if (!removed) return s
      const next = { ...s.liveStreams }
      delete next[aTag]
      // Keep activeActivity & miniPlayer intact so the stream page keeps its Retry Stream button
      return { liveStreams: next }
    })
  },

  markStreamOnline: (aTag) => {
    set((s) => {
      const backup = offlineStreamBackup.get(aTag)
      offlineStreamBackup.delete(aTag)
      const activity =
        (s.activeATag === aTag ? s.activeActivity : null) || backup?.activity || null
      if (!activity || activity.status !== 'live' || !isPlayableStreamUrl(activity.streamingUrl)) {
        return s
      }
      const nowSec = Math.floor(Date.now() / 1000)
      if (activity.ends && activity.ends > 0 && activity.ends <= nowSec) return s
      latestActivitySeen.set(aTag, {
        createdAt: activity.createdAt,
        status: 'live',
      })
      if (s.liveStreams[aTag]) return s
      return {
        liveStreams: {
          ...s.liveStreams,
          [aTag]: backup
            ? { ...backup, activity }
            : {
                activity,
                aTagValue: aTag,
                chatters: [],
                lastChatAt: 0,
              },
        },
      }
    })
  },

  subscribeLiveDiscovery: () => {
    const readRelays = useSettingsStore.getState().getReadRelays()
    const relays = [...new Set([...LIVE_DISCOVERY_RELAYS, ...readRelays])].slice(0, 8)
    const nowSec = Math.floor(Date.now() / 1000)
    const since = nowSec - 3600
    const activitySince = nowSec - 12 * 3600

    const profileBatch = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    const queueProfile = (pk: string) => {
      profileBatch.add(pk.toLowerCase())
      if (!profileTimer) {
        profileTimer = setTimeout(() => {
          profileTimer = null
          const list = [...profileBatch]
          profileBatch.clear()
          if (list.length > 0) {
            void useNostrStore.getState().fetchProfiles(list)
            void get().fetchStreamerFollowerCounts(list)
          }
        }, 450)
      }
    }

    const subActivities = nostrPool.subscribe(
      relays,
      { kinds: [KIND_LIVE_ACTIVITY], since: activitySince, limit: 80 },
      {
        onevent: (ev: Event) => {
          const activity = parseLiveActivity(ev)
          if (!activity) return
          const aTag = buildLiveATag(activity.hostPubkey, activity.dTag)

          // Tombstone check: never let an older `live` event from a lagging relay override a newer `ended` event
          const prevSeen = latestActivitySeen.get(aTag)
          if (!shouldAcceptLiveActivityUpdate(prevSeen, activity)) {
            return
          }
          latestActivitySeen.set(aTag, {
            createdAt: activity.createdAt,
            status: activity.status || '',
          })

          set((s) => {
            const existing = s.liveStreams[aTag]
            const isExpired = Boolean(
              activity.ends && activity.ends > 0 && activity.ends <= Math.floor(Date.now() / 1000),
            )
            if (activity.status !== 'live' || !isPlayableStreamUrl(activity.streamingUrl) || isExpired) {
              const nextMini =
                s.miniPlayer && s.miniPlayer.aTag === aTag
                  ? { ...s.miniPlayer, isLive: false }
                  : s.miniPlayer
              if (!existing) {
                return {
                  activeActivity: s.activeATag === aTag ? activity : s.activeActivity,
                  miniPlayer: nextMini,
                }
              }
              const next = { ...s.liveStreams }
              delete next[aTag]
              return {
                liveStreams: next,
                activeActivity: s.activeATag === aTag ? activity : s.activeActivity,
                miniPlayer: nextMini,
              }
            }

            const pChatters = pendingChatters.get(aTag)
            const pAt = pendingChatAt.get(aTag) || 0
            pendingChatters.delete(aTag)
            pendingChatAt.delete(aTag)

            const mergedChatters = [
              ...new Set([
                ...(existing?.chatters || []),
                ...(pChatters ? [...pChatters] : []),
              ]),
            ].slice(-200)
            queueProfile(activity.streamerPubkey || activity.hostPubkey)

            return {
              liveStreams: {
                ...s.liveStreams,
                [aTag]: {
                  activity,
                  aTagValue: aTag,
                  chatters: mergedChatters,
                  lastChatAt: Math.max(existing?.lastChatAt || 0, pAt),
                },
              },
              activeActivity: s.activeATag === aTag ? activity : s.activeActivity,
            }
          })
        },
      },
    )

    const subChatDiscovery = nostrPool.subscribe(
      relays,
      { kinds: [KIND_LIVE_CHAT_MESSAGE], since, limit: 250 },
      {
        onevent: (ev: Event) => {
          const aTag = getChatActivityRef(ev)
          if (!aTag) return
          const pk = ev.pubkey.toLowerCase()
          const cur = get().liveStreams[aTag]
          if (cur) {
            if (!cur.chatters.includes(pk) || ev.created_at > cur.lastChatAt) {
              set((s) => {
                const entry = s.liveStreams[aTag]
                if (!entry) return s
                const hasChatter = entry.chatters.includes(pk)
                if (hasChatter && ev.created_at <= entry.lastChatAt) return s
                return {
                  liveStreams: {
                    ...s.liveStreams,
                    [aTag]: {
                      ...entry,
                      chatters: hasChatter ? entry.chatters : [...entry.chatters, pk].slice(-200),
                      lastChatAt: Math.max(entry.lastChatAt, ev.created_at),
                    },
                  },
                }
              })
            }
          } else {
            let setForTag = pendingChatters.get(aTag)
            if (!setForTag) {
              setForTag = new Set()
              pendingChatters.set(aTag, setForTag)
            }
            setForTag.add(pk)
            pendingChatAt.set(aTag, Math.max(pendingChatAt.get(aTag) || 0, ev.created_at))
          }
        },
      },
    )

    return () => {
      if (profileTimer) clearTimeout(profileTimer)
      subActivities.close()
      subChatDiscovery.close()
    }
  },

  fetchLiveActivityOnce: async (hostPubkey, dTag, naddrRelays = []) => {
    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const cached = get().liveStreams[aTag]?.activity
    if (cached) return cached

    const safeNaddrRelays = naddrRelays
      .map((r) => sanitizePublicRelayUrl(r))
      .filter((r): r is string => Boolean(r))
    const relays = [
      ...new Set([
        ...safeNaddrRelays,
        ...LIVE_DISCOVERY_RELAYS,
        ...useSettingsStore.getState().getReadRelays(),
        ...useNostrStore.getState().userReadRelays,
      ]),
    ].slice(0, 12)

    try {
      const evs = await nostrPool.query(
        relays,
        { kinds: [KIND_LIVE_ACTIVITY], authors: [cleanHost], '#d': [dTag], limit: 2 },
        5000,
      )
      const sorted = [...evs].sort((a, b) => b.created_at - a.created_at)
      for (const ev of sorted) {
        const parsed = parseLiveActivity(ev)
        if (parsed) {
          void useNostrStore
            .getState()
            .fetchProfiles([parsed.streamerPubkey || cleanHost, cleanHost])
          return parsed
        }
      }
    } catch {
      // ignore relay errors
    }
    return null
  },

  subscribeActiveStream: (hostPubkey, dTag, naddrRelays = []) => {
    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const cached = get().liveStreams[aTag]?.activity || null

    set({
      activeATag: aTag,
      activeActivity: cached,
      loadingStream: !cached,
    })

    let active = true
    const closers: Array<{ close: () => void }> = []

    void (async () => {
      try {
        const safeNaddrRelays = naddrRelays
          .map((r) => sanitizePublicRelayUrl(r))
          .filter((r): r is string => Boolean(r))
        const baseRelays = [
          ...new Set([
            ...safeNaddrRelays,
            ...(cached?.relayHints || []),
            ...LIVE_DISCOVERY_RELAYS,
            ...useSettingsStore.getState().getReadRelays(),
            ...useNostrStore.getState().userReadRelays,
          ]),
        ].slice(0, 12)

        const activityEvs = await nostrPool.query(
          baseRelays,
          { kinds: [KIND_LIVE_ACTIVITY], authors: [cleanHost], '#d': [dTag], limit: 2 },
          5000,
        )
        if (!active) return

        let latestActivity = get().activeActivity || cached
        if (activityEvs.length > 0) {
          const sorted = [...activityEvs].sort((a, b) => b.created_at - a.created_at)
          for (const rawEv of sorted) {
            const parsed = parseLiveActivity(rawEv)
            if (!parsed) continue
            const prevSeen = latestActivitySeen.get(aTag)
            if (!shouldAcceptLiveActivityUpdate(prevSeen, parsed)) continue
            latestActivitySeen.set(aTag, { createdAt: parsed.createdAt, status: parsed.status || '' })
            if (shouldAcceptLiveActivityUpdate(latestActivity || undefined, parsed)) {
              latestActivity = parsed
              set((s) => (s.activeATag === aTag ? { activeActivity: parsed } : s))
            }
            break
          }
        }
        set({ loadingStream: false })

        const hostPk = latestActivity?.streamerPubkey || cleanHost
        void useNostrStore
          .getState()
          .fetchProfiles(cleanHost !== hostPk ? [hostPk, cleanHost] : [hostPk])

        const statusRelays = [
          ...new Set([
            ...safeNaddrRelays,
            ...(latestActivity?.relayHints || []),
            ...LIVE_DISCOVERY_RELAYS,
          ]),
        ].slice(0, 8)

        const statusSub = nostrPool.subscribe(
          statusRelays,
          { kinds: [KIND_LIVE_ACTIVITY], authors: [cleanHost], '#d': [dTag], limit: 1 },
          {
            onevent: (ev: Event) => {
              if (!active) return
              const parsed = parseLiveActivity(ev)
              if (!parsed) return
              const prevSeen = latestActivitySeen.get(aTag)
              if (!shouldAcceptLiveActivityUpdate(prevSeen, parsed)) return
              latestActivitySeen.set(aTag, { createdAt: parsed.createdAt, status: parsed.status || '' })
              set((s) => {
                if (s.activeATag !== aTag) return s
                if (!shouldAcceptLiveActivityUpdate(s.activeActivity || undefined, parsed)) return s
                return { activeActivity: parsed }
              })
            },
          },
        )
        closers.push(statusSub)
      } catch {
        // Relay errors are handled gracefully by keeping cached activity state
      } finally {
        if (active) set({ loadingStream: false })
      }
    })()

    return () => {
      active = false
      for (const c of closers) c.close()
      set((s) =>
        s.activeATag === aTag
          ? {
              activeATag: null,
              activeActivity: null,
              loadingStream: false,
            }
          : s,
      )
    }
  },

  subscribeFocusedChat: (hostPubkey, dTag, naddrRelays = [], streamTitle) => {
    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const cached =
      (get().activeATag === aTag ? get().activeActivity : null) ||
      get().liveStreams[aTag]?.activity ||
      null

    set({
      focusedChatATag: aTag,
      focusedChatTitle: streamTitle || cached?.title || null,
      activeChatRelays: [],
      currentChatMessages: [],
      streamZapTotal: 0,
      streamZappers: {},
    })

    let active = true
    const seenIds = new Set<string>()
    const closers: Array<{ close: () => void }> = []

    const profileQueue = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    const queueProfile = (pk: string) => {
      profileQueue.add(pk.toLowerCase())
      if (!profileTimer) {
        profileTimer = setTimeout(() => {
          profileTimer = null
          const list = [...profileQueue]
          profileQueue.clear()
          if (list.length > 0) void useNostrStore.getState().fetchProfiles(list)
        }, 350)
      }
    }

    void (async () => {
      try {
        const safeNaddrRelays = naddrRelays
          .map((r) => sanitizePublicRelayUrl(r))
          .filter((r): r is string => Boolean(r))
        const baseRelays = [
          ...new Set([
            ...safeNaddrRelays,
            ...(cached?.relayHints || []),
            ...LIVE_DISCOVERY_RELAYS,
            ...useSettingsStore.getState().getReadRelays(),
          ]),
        ].slice(0, 10)

        const relayListEvs = await nostrPool.query(
          baseRelays,
          { kinds: [10002], authors: [cleanHost], limit: 1 },
          2500,
        )
        if (!active) return

        const hostRelays: string[] = []
        if (relayListEvs.length > 0) {
          for (const t of relayListEvs[0].tags) {
            if (t[0] !== 'r' || !t[1]) continue
            const clean = sanitizePublicRelayUrl(t[1])
            if (clean) hostRelays.push(clean)
          }
        }

        const latestCached =
          (get().activeATag === aTag ? get().activeActivity : null) ||
          get().liveStreams[aTag]?.activity ||
          cached

        const chatRelays = [
          ...new Set([
            ...safeNaddrRelays,
            ...(latestCached?.relayHints || []),
            ...hostRelays.slice(0, 4),
            ...LIVE_DISCOVERY_RELAYS,
          ]),
        ].slice(0, 8)
        set((s) => (s.focusedChatATag === aTag ? { activeChatRelays: chatRelays } : s))

        // Subscribe live to chat (kind 1311) & stream zaps (kind 9735) for the focused stream
        const chatSub = nostrPool.subscribe(
          chatRelays,
          { kinds: [KIND_LIVE_CHAT_MESSAGE], '#a': [aTag], limit: 150 },
          {
            onevent: (ev: Event) => {
              if (!active || seenIds.has(ev.id)) return
              seenIds.add(ev.id)
              const replyToId = ev.tags.find(
                (t) => t[0] === 'e' && t[1] && (!t[3] || t[3] === 'reply'),
              )?.[1]
              const msg: LiveChatMessage = {
                id: ev.id,
                senderPubkey: ev.pubkey.toLowerCase(),
                content: ev.content || '',
                tags: ev.tags || [],
                createdAt: ev.created_at,
                replyToId,
              }
              queueProfile(msg.senderPubkey)
              set((s) => {
                if (s.focusedChatATag !== aTag) return s
                if (s.currentChatMessages.some((m) => m.id === msg.id)) return s
                const next = [...s.currentChatMessages, msg]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .slice(-300)
                return { currentChatMessages: next }
              })
            },
          },
        )
        closers.push(chatSub)

        const zapSub = nostrPool.subscribe(
          chatRelays,
          { kinds: [9735], '#a': [aTag], limit: 250 },
          {
            onevent: (ev: Event) => {
              const zapKey = `zap-${ev.id}`
              if (!active || seenIds.has(zapKey)) return
              seenIds.add(zapKey)
              const info = parseZapReceiptInfo(ev)
              if (info.sats <= 0) return
              queueProfile(info.senderPubkey)
              const msg: LiveChatMessage = {
                id: zapKey,
                senderPubkey: info.senderPubkey,
                content: info.comment || '',
                tags: info.tags || [],
                createdAt: ev.created_at,
                isZapAnnouncement: true,
                zapAmountSats: info.sats,
              }
              set((s) => {
                if (s.focusedChatATag !== aTag) return s
                const prevZapper = s.streamZappers[info.senderPubkey]
                const updatedZappers = {
                  ...s.streamZappers,
                  [info.senderPubkey]: {
                    pubkey: info.senderPubkey,
                    totalSats: (prevZapper?.totalSats || 0) + info.sats,
                    zapCount: (prevZapper?.zapCount || 0) + 1,
                    lastZapAt: Math.max(prevZapper?.lastZapAt || 0, ev.created_at),
                  },
                }
                const nextMessages = s.currentChatMessages.some((m) => m.id === msg.id)
                  ? s.currentChatMessages
                  : [...s.currentChatMessages, msg]
                      .sort((a, b) => a.createdAt - b.createdAt)
                      .slice(-300)
                return {
                  currentChatMessages: nextMessages,
                  streamZapTotal: s.streamZapTotal + info.sats,
                  streamZappers: updatedZappers,
                }
              })
            },
          },
        )
        closers.push(zapSub)
      } catch {
        // Ignore transient relay lookup failures
      }
    })()

    return () => {
      active = false
      if (profileTimer) clearTimeout(profileTimer)
      for (const c of closers) c.close()
      set((s) =>
        s.focusedChatATag === aTag
          ? {
              focusedChatATag: null,
              focusedChatTitle: null,
              activeChatRelays: [],
              currentChatMessages: [],
              streamZapTotal: 0,
              streamZappers: {},
            }
          : s,
      )
    }
  },

  subscribeMiniChat: (hostPubkey, dTag, naddrRelays = []) => {
    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const cached = get().liveStreams[aTag]?.activity || null

    let active = true
    const seenIds = new Set<string>(get().miniChatMessages.map((m) => m.id))
    const closers: Array<{ close: () => void }> = []

    const profileQueue = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    const queueProfile = (pk: string) => {
      profileQueue.add(pk.toLowerCase())
      if (!profileTimer) {
        profileTimer = setTimeout(() => {
          profileTimer = null
          const list = [...profileQueue]
          profileQueue.clear()
          if (list.length > 0) void useNostrStore.getState().fetchProfiles(list)
        }, 350)
      }
    }

    const safeNaddrRelays = naddrRelays
      .map((r) => sanitizePublicRelayUrl(r))
      .filter((r): r is string => Boolean(r))
    const chatRelays = [
      ...new Set([
        ...safeNaddrRelays,
        ...(cached?.relayHints || []),
        ...get().miniChatRelays,
        ...LIVE_DISCOVERY_RELAYS,
        ...useSettingsStore.getState().getReadRelays(),
      ]),
    ].slice(0, 8)

    set({ miniChatRelays: chatRelays })

    const chatSub = nostrPool.subscribe(
      chatRelays,
      { kinds: [KIND_LIVE_CHAT_MESSAGE], '#a': [aTag], limit: 100 },
      {
        onevent: (ev: Event) => {
          if (!active || seenIds.has(ev.id)) return
          seenIds.add(ev.id)
          const replyToId = ev.tags.find(
            (t) => t[0] === 'e' && t[1] && (!t[3] || t[3] === 'reply'),
          )?.[1]
          const msg: LiveChatMessage = {
            id: ev.id,
            senderPubkey: ev.pubkey.toLowerCase(),
            content: ev.content || '',
            tags: ev.tags || [],
            createdAt: ev.created_at,
            replyToId,
          }
          queueProfile(msg.senderPubkey)
          set((s) => {
            if (s.miniPlayer?.aTag !== aTag) return s
            if (s.miniChatMessages.some((m) => m.id === msg.id)) return s
            return {
              miniChatMessages: [...s.miniChatMessages, msg]
                .sort((a, b) => a.createdAt - b.createdAt)
                .slice(-150),
            }
          })
        },
      },
    )

    const zapSub = nostrPool.subscribe(
      chatRelays,
      { kinds: [9735], '#a': [aTag], limit: 60 },
      {
        onevent: (ev: Event) => {
          const zapKey = `zap-${ev.id}`
          if (!active || seenIds.has(zapKey)) return
          seenIds.add(zapKey)
          const info = parseZapReceiptInfo(ev)
          if (info.sats <= 0) return
          queueProfile(info.senderPubkey)
          const msg: LiveChatMessage = {
            id: zapKey,
            senderPubkey: info.senderPubkey,
            content: info.comment || '',
            tags: info.tags || [],
            createdAt: ev.created_at,
            isZapAnnouncement: true,
            zapAmountSats: info.sats,
          }
          set((s) => {
            if (s.miniPlayer?.aTag !== aTag) return s
            if (s.miniChatMessages.some((m) => m.id === msg.id)) return s
            return {
              miniChatMessages: [...s.miniChatMessages, msg]
                .sort((a, b) => a.createdAt - b.createdAt)
                .slice(-150),
            }
          })
        },
      },
    )

    closers.push(chatSub, zapSub)

    return () => {
      active = false
      if (profileTimer) clearTimeout(profileTimer)
      for (const c of closers) c.close()
    }
  },

  sendChatMessage: async (hostPubkey, dTag, content, replyToId, extraTags = []) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      throw new Error('Sign in to send chat messages')
    }
    const cleanText = stripTrackingParamsInText(content.trim()).text
    if (!cleanText) return

    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const state = get()
    const relays =
      state.focusedChatATag === aTag && state.activeChatRelays.length > 0
        ? state.activeChatRelays
        : state.miniPlayer?.aTag === aTag && state.miniChatRelays.length > 0
          ? state.miniChatRelays
          : [...LIVE_DISCOVERY_RELAYS, ...useSettingsStore.getState().getWriteRelays()].slice(0, 6)

    const tags: string[][] = [
      ['a', aTag, relays[0] || ''],
      ['p', cleanHost],
      ...extraTags,
    ]
    if (replyToId) {
      tags.push(['e', replyToId, '', 'reply'])
    }

    const signed = await signer.signEvent({
      kind: KIND_LIVE_CHAT_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: cleanText,
    })

    // Optimistic insert (deduplicated for both full stream chat and mini-player chat)
    set((s) => {
      const msg: LiveChatMessage = {
        id: signed.id,
        senderPubkey: signed.pubkey.toLowerCase(),
        content: signed.content,
        tags: signed.tags,
        createdAt: signed.created_at,
        replyToId,
      }
      const next: Partial<LiveState> = {}
      if (s.focusedChatATag === aTag && !s.currentChatMessages.some((m) => m.id === signed.id)) {
        next.currentChatMessages = [...s.currentChatMessages, msg]
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-300)
      }
      if (s.miniPlayer?.aTag === aTag && !s.miniChatMessages.some((m) => m.id === signed.id)) {
        next.miniChatMessages = [...s.miniChatMessages, msg]
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-150)
      }
      return next
    })

    const results = await nostrPool.publish(relays, signed)
    if (!results.some((r) => r.ok)) {
      // Roll back optimistic message if every relay rejected or timed out
      set((s) => ({
        currentChatMessages: s.currentChatMessages.filter((m) => m.id !== signed.id),
        miniChatMessages: s.miniChatMessages.filter((m) => m.id !== signed.id),
      }))
      throw new Error('Could not deliver chat message to any relay')
    }
  },
}))
