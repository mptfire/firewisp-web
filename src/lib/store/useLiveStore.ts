import { create } from 'zustand'
import type { Event } from 'nostr-tools/pure'
import { nostrPool } from '../nostr/pool'
import {
  buildLiveATag,
  getChatActivityRef,
  KIND_LIVE_ACTIVITY,
  KIND_LIVE_CHAT_MESSAGE,
  LIVE_DISCOVERY_RELAYS,
  parseLiveActivity,
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

interface LiveState {
  liveStreams: Record<string, LiveStreamEntry>
  activeATag: string | null
  activeActivity: LiveActivity | null
  activeChatRelays: string[]
  currentChatMessages: LiveChatMessage[]
  streamZapTotal: number
  loadingStream: boolean

  subscribeLiveDiscovery: () => () => void
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
  ) => Promise<void>
}

const pendingChatters = new Map<string, Set<string>>()
const pendingChatAt = new Map<string, number>()

export const useLiveStore = create<LiveState>((set, get) => ({
  liveStreams: {},
  activeATag: null,
  activeActivity: null,
  activeChatRelays: [],
  currentChatMessages: [],
  streamZapTotal: 0,
  loadingStream: false,

  subscribeLiveDiscovery: () => {
    const readRelays = useSettingsStore.getState().getReadRelays()
    const relays = [...new Set([...LIVE_DISCOVERY_RELAYS, ...readRelays])].slice(0, 8)
    const since = Math.floor(Date.now() / 1000) - 3600

    const profileBatch = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    const queueProfile = (pk: string) => {
      profileBatch.add(pk.toLowerCase())
      if (!profileTimer) {
        profileTimer = setTimeout(() => {
          profileTimer = null
          const list = [...profileBatch]
          profileBatch.clear()
          if (list.length > 0) void useNostrStore.getState().fetchProfiles(list)
        }, 450)
      }
    }

    const subActivities = nostrPool.subscribe(
      relays,
      { kinds: [KIND_LIVE_ACTIVITY], limit: 60 },
      {
        onevent: (ev: Event) => {
          const activity = parseLiveActivity(ev)
          if (!activity) return
          const aTag = buildLiveATag(activity.hostPubkey, activity.dTag)

          set((s) => {
            const existing = s.liveStreams[aTag]
            if (existing && existing.activity.createdAt > activity.createdAt) {
              return s
            }
            if (activity.status !== 'live') {
              if (!existing) return s
              const next = { ...s.liveStreams }
              delete next[aTag]
              return {
                liveStreams: next,
                activeActivity: s.activeATag === aTag ? activity : s.activeActivity,
              }
            }
            if (!activity.streamingUrl) return s

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
                createdAt: ev.created_at,
                replyToId,
              }
              queueProfile(msg.senderPubkey)
              set((s) => {
                if (s.activeATag !== aTag) return s
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
                createdAt: ev.created_at,
                isZapAnnouncement: true,
                zapAmountSats: info.sats,
              }
              set((s) => {
                if (s.activeATag !== aTag) return s
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

  sendChatMessage: async (hostPubkey, dTag, content, replyToId) => {
    const signer = useAuthStore.getState().signer
    if (!signer?.canSign) {
      useAuthStore.getState().openAuthModal()
      throw new Error('Sign in to send chat messages')
    }
    const cleanText = content.trim()
    if (!cleanText) return

    const cleanHost = hostPubkey.toLowerCase()
    const aTag = buildLiveATag(cleanHost, dTag)
    const relays =
      get().activeChatRelays.length > 0
        ? get().activeChatRelays
        : [...LIVE_DISCOVERY_RELAYS, ...useSettingsStore.getState().getWriteRelays()].slice(0, 6)

    const tags: string[][] = [
      ['a', aTag, relays[0] || ''],
      ['p', cleanHost],
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

    // Optimistic insert
    set((s) => {
      if (s.activeATag !== aTag) return s
      if (s.currentChatMessages.some((m) => m.id === signed.id)) return s
      const msg: LiveChatMessage = {
        id: signed.id,
        senderPubkey: signed.pubkey.toLowerCase(),
        content: signed.content,
        createdAt: signed.created_at,
        replyToId,
      }
      return {
        currentChatMessages: [...s.currentChatMessages, msg]
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-300),
      }
    })

    await nostrPool.publish(relays, signed)
  },
}))
