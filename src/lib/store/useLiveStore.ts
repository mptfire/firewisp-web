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
} from '../nostr/nip53'
import { sanitizeRelayUrl } from '../sanitize'
import { useAuthStore } from './useAuthStore'
import { parseZapReceiptInfo, useNostrStore } from './useNostrStore'
import { useSettingsStore } from './useSettingsStore'

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
  activeChatRelays: string[]
  currentChatMessages: LiveChatMessage[]
  streamZapTotal: number
  loadingStream: boolean
  miniPlayer: MiniPlayerStream | null
  miniChatMessages: LiveChatMessage[]
  miniChatRelays: string[]

  subscribeLiveDiscovery: () => () => void
  fetchStreamerFollowerCounts: (pubkeys: string[]) => Promise<void>
  markStreamOffline: (aTag: string) => void
  openMiniPlayer: (stream: MiniPlayerStream) => void
  closeMiniPlayer: () => void
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
const fetchedFollowerPubkeys = new Set<string>()
const NIP45_COUNT_RELAYS = ['wss://relay.primal.net', 'wss://nos.lol']

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
    let settled = false
    let ws: WebSocket | null = null

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        // ignore close errors
      }
      resolve(counts)
    }

    const timer = setTimeout(finish, timeoutMs)

    try {
      ws = new WebSocket(relayUrl)
      ws.onopen = () => {
        pubkeys.forEach((pk, idx) => {
          const subId = `fc_${idx}`
          subToPk.set(subId, pk)
          ws?.send(JSON.stringify(['COUNT', subId, { kinds: [3], '#p': [pk] }]))
        })
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as unknown[]
          if (msg[0] === 'COUNT' && typeof msg[1] === 'string') {
            const pk = subToPk.get(msg[1])
            const payload = msg[2] as { count?: unknown } | undefined
            if (pk && typeof payload?.count === 'number' && Number.isFinite(payload.count)) {
              counts[pk] = Math.max(0, Math.floor(payload.count))
              if (Object.keys(counts).length >= pubkeys.length) {
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
  activeChatRelays: [],
  currentChatMessages: [],
  streamZapTotal: 0,
  loadingStream: false,
  miniPlayer: null,
  miniChatMessages: [],
  miniChatRelays: [],

  openMiniPlayer: (stream) =>
    set((s) => ({
      miniPlayer: stream,
      miniChatMessages:
        s.activeATag === stream.aTag
          ? s.currentChatMessages.slice(-120)
          : s.miniPlayer?.aTag === stream.aTag
            ? s.miniChatMessages
            : [],
      miniChatRelays:
        s.activeATag === stream.aTag && s.activeChatRelays.length > 0
          ? s.activeChatRelays
          : s.miniPlayer?.aTag === stream.aTag
            ? s.miniChatRelays
            : [],
    })),
  closeMiniPlayer: () => set({ miniPlayer: null, miniChatMessages: [], miniChatRelays: [] }),

  fetchStreamerFollowerCounts: async (pubkeys) => {
    const pending = [
      ...new Set(
        pubkeys
          .map((p) => p.toLowerCase())
          .filter((p) => /^[0-9a-f]{64}$/.test(p) && !fetchedFollowerPubkeys.has(p)),
      ),
    ].slice(0, 25)
    if (pending.length === 0) return

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
    } else {
      // Allow retry later if both relays timed out
      for (const pk of pending) fetchedFollowerPubkeys.delete(pk)
    }
  },

  markStreamOffline: (aTag) => {
    const nowSec = Math.floor(Date.now() / 1000)
    const prevSeen = latestActivitySeen.get(aTag)
    latestActivitySeen.set(aTag, {
      createdAt: Math.max(prevSeen?.createdAt || 0, nowSec),
      status: 'ended',
    })
    set((s) => {
      const next = { ...s.liveStreams }
      delete next[aTag]
      return {
        liveStreams: next,
        activeActivity:
          s.activeATag === aTag && s.activeActivity
            ? { ...s.activeActivity, status: 'ended' }
            : s.activeActivity,
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
            if (activity.status !== 'live') {
              if (!existing) {
                return s.activeATag === aTag ? { activeActivity: activity } : s
              }
              const next = { ...s.liveStreams }
              delete next[aTag]
              return {
                liveStreams: next,
                activeActivity: s.activeATag === aTag ? activity : s.activeActivity,
              }
            }
            if (!isPlayableStreamUrl(activity.streamingUrl)) return s
            if (activity.ends && activity.ends > 0 && activity.ends <= Math.floor(Date.now() / 1000)) {
              return s
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
            ]
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
            if (!cur.chatters.includes(pk)) {
              set((s) => {
                const entry = s.liveStreams[aTag]
                if (!entry || entry.chatters.includes(pk)) return s
                return {
                  liveStreams: {
                    ...s.liveStreams,
                    [aTag]: {
                      ...entry,
                      chatters: [...entry.chatters, pk],
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

  subscribeActiveStream: (hostPubkey, dTag, naddrRelays = []) => {
    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const cached = get().liveStreams[aTag]?.activity || null

    set({
      activeATag: aTag,
      activeActivity: cached,
      currentChatMessages: [],
      streamZapTotal: 0,
      loadingStream: !cached,
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
        const baseRelays = [
          ...new Set([
            ...naddrRelays,
            ...(cached?.relayHints || []),
            ...LIVE_DISCOVERY_RELAYS,
            ...useSettingsStore.getState().getReadRelays(),
          ]),
        ].slice(0, 10)

        // Fetch activity (if missing or stale) + host's NIP-65 relay list in parallel
        const [activityEvs, relayListEvs] = await Promise.all([
          nostrPool.query(
            baseRelays,
            { kinds: [KIND_LIVE_ACTIVITY], authors: [cleanHost], '#d': [dTag], limit: 2 },
            4000,
          ),
          nostrPool.query(baseRelays, { kinds: [10002], authors: [cleanHost], limit: 1 }, 2500),
        ])
        if (!active) return

        let latestActivity = cached
        if (activityEvs.length > 0) {
          const parsed = parseLiveActivity(activityEvs[0])
          if (parsed && (!latestActivity || parsed.createdAt >= latestActivity.createdAt)) {
            latestActivity = parsed
            set({ activeActivity: parsed })
          }
        }
        set({ loadingStream: false })

        const hostPk = latestActivity?.streamerPubkey || cleanHost
        queueProfile(hostPk)
        if (cleanHost !== hostPk) queueProfile(cleanHost)

        const hostRelays: string[] = []
        if (relayListEvs.length > 0) {
          for (const t of relayListEvs[0].tags) {
            if (t[0] !== 'r' || !t[1]) continue
            const clean = sanitizeRelayUrl(t[1])
            if (clean) hostRelays.push(clean)
          }
        }

        const chatRelays = [
          ...new Set([
            ...naddrRelays,
            ...(latestActivity?.relayHints || []),
            ...hostRelays.slice(0, 4),
            ...LIVE_DISCOVERY_RELAYS,
          ]),
        ].slice(0, 8)
        set({ activeChatRelays: chatRelays })

        // Subscribe live to chat (kind 1311), stream zaps (kind 9735), and activity status updates (kind 30311)
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
                if (s.activeATag !== aTag) return s
                if (s.currentChatMessages.some((m) => m.id === msg.id)) return s
                const next = [...s.currentChatMessages, msg]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .slice(-300)
                return { currentChatMessages: next }
              })
            },
          },
        )

        const zapSub = nostrPool.subscribe(
          chatRelays,
          { kinds: [9735], '#a': [aTag], limit: 100 },
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
                tags: [],
                createdAt: ev.created_at,
                isZapAnnouncement: true,
                zapAmountSats: info.sats,
              }
              set((s) => {
                if (s.activeATag !== aTag) return s
                if (s.currentChatMessages.some((m) => m.id === msg.id)) return s
                const next = [...s.currentChatMessages, msg]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .slice(-300)
                return {
                  currentChatMessages: next,
                  streamZapTotal: s.streamZapTotal + info.sats,
                }
              })
            },
          },
        )

        const statusSub = nostrPool.subscribe(
          chatRelays,
          { kinds: [KIND_LIVE_ACTIVITY], authors: [cleanHost], '#d': [dTag], limit: 1 },
          {
            onevent: (ev: Event) => {
              if (!active) return
              const parsed = parseLiveActivity(ev)
              if (!parsed) return
              set((s) => {
                if (s.activeATag !== aTag) return s
                if (s.activeActivity && s.activeActivity.createdAt > parsed.createdAt) return s
                return { activeActivity: parsed }
              })
            },
          },
        )

        closers.push(chatSub, zapSub, statusSub)
      } finally {
        if (active) set({ loadingStream: false })
      }
    })()

    return () => {
      active = false
      if (profileTimer) clearTimeout(profileTimer)
      for (const c of closers) c.close()
      set({
        activeATag: null,
        activeActivity: null,
        currentChatMessages: [],
        streamZapTotal: 0,
      })
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

    const chatRelays = [
      ...new Set([
        ...naddrRelays,
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
            tags: [],
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
    const cleanText = content.trim()
    if (!cleanText) return

    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const state = get()
    const relays =
      state.activeATag === aTag && state.activeChatRelays.length > 0
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
      if (s.activeATag === aTag && !s.currentChatMessages.some((m) => m.id === signed.id)) {
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

    await nostrPool.publish(relays, signed)
  },
}))
