import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import { nostrPool } from '../nostr/pool'
import { isValidHex64 } from '../sanitize'
import { useNostrStore } from './useNostrStore'
import { useSettingsStore } from './useSettingsStore'

export interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface HoverProfileStats {
  followingCount: number
  followsMe: boolean
  fetchedAt: number
}

interface ProfileHoverState {
  pubkey: string | null
  anchorRect: AnchorRect | null
  statsCache: Record<string, HoverProfileStats>
  scheduleOpen: (pubkey: string, rect: AnchorRect) => void
  scheduleClose: () => void
  cancelClose: () => void
  closeImmediate: () => void
  fetchProfileFollowStats: (targetPubkey: string, myPubkey: string | null) => Promise<void>
}

const OPEN_DELAY_MS = 350
const CLOSE_DELAY_MS = 220
const STATS_TTL_MS = 5 * 60 * 1000
const MAX_STATS_CACHE = 100

let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
const inFlightStats = new Set<string>()

function clearOpenTimer() {
  if (openTimer) {
    clearTimeout(openTimer)
    openTimer = null
  }
}

function clearCloseTimer() {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

/**
 * Computes fixed viewport coordinates for the profile hover card so it opens below
 * the avatar by default, flips above near the bottom edge, and stays clamped inside
 * the viewport horizontally.
 */
export function computeHoverCardPosition(
  anchor: AnchorRect,
  viewport: { width: number; height: number },
  cardSize: { width: number; height: number } = { width: 312, height: 280 },
  margin = 12,
): { top: number; left: number; placement: 'bottom' | 'top' } {
  const gap = 8
  const belowTop = anchor.bottom + gap
  const aboveTop = anchor.top - gap - cardSize.height

  let placement: 'bottom' | 'top' = 'bottom'
  let top = belowTop

  if (belowTop + cardSize.height + margin > viewport.height && aboveTop >= margin) {
    placement = 'top'
    top = aboveTop
  } else {
    top = Math.min(belowTop, Math.max(margin, viewport.height - cardSize.height - margin))
  }

  const maxLeft = Math.max(margin, viewport.width - cardSize.width - margin)
  const left = Math.min(Math.max(margin, anchor.left), maxLeft)

  return { top, left, placement }
}

export const useProfileHoverStore = create<ProfileHoverState>((set, get) => ({
  pubkey: null,
  anchorRect: null,
  statsCache: {},

  scheduleOpen: (rawPubkey, rect) => {
    if (!useSettingsStore.getState().hoverProfilePreview) return
    const normalized = rawPubkey.trim().toLowerCase()
    if (!isValidHex64(normalized)) return

    clearCloseTimer()
    clearOpenTimer()

    if (get().pubkey === normalized) {
      set({ anchorRect: rect })
      return
    }

    openTimer = setTimeout(() => {
      openTimer = null
      set({ pubkey: normalized, anchorRect: rect })
    }, OPEN_DELAY_MS)
  },

  scheduleClose: () => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimer = setTimeout(() => {
      closeTimer = null
      set({ pubkey: null, anchorRect: null })
    }, CLOSE_DELAY_MS)
  },

  cancelClose: () => {
    clearCloseTimer()
  },

  closeImmediate: () => {
    clearOpenTimer()
    clearCloseTimer()
    set({ pubkey: null, anchorRect: null })
  },

  fetchProfileFollowStats: async (targetPubkey, myPubkey) => {
    const clean = targetPubkey.trim().toLowerCase()
    if (!isValidHex64(clean)) return

    const existing = get().statsCache[clean]
    if (existing && Date.now() - existing.fetchedAt < STATS_TTL_MS) {
      return
    }
    const flightKey = `${clean}:${myPubkey ?? ''}`
    if (inFlightStats.has(flightKey)) return
    inFlightStats.add(flightKey)

    try {
      const readRelays = [
        ...new Set([
          ...useSettingsStore.getState().getReadRelays(),
          ...useNostrStore.getState().userReadRelays,
        ]),
      ].slice(0, 6)
      if (readRelays.length === 0) return

      const events = await nostrPool.query(
        readRelays,
        { authors: [clean], kinds: [3], limit: 2 },
        3500,
      )
      const latest = events
        .filter((ev) => ev.pubkey.toLowerCase() === clean && ev.kind === 3 && verifyEvent(ev))
        .sort((a, b) => b.created_at - a.created_at)[0]

      if (!latest) return

      const following = new Set<string>()
      for (const tag of latest.tags) {
        if (tag[0] === 'p' && typeof tag[1] === 'string' && isValidHex64(tag[1])) {
          following.add(tag[1].toLowerCase())
        }
      }

      const myClean = myPubkey ? myPubkey.trim().toLowerCase() : null
      const entry: HoverProfileStats = {
        followingCount: following.size,
        followsMe: Boolean(myClean && myClean !== clean && following.has(myClean)),
        fetchedAt: Date.now(),
      }

      set((state) => {
        const nextCache = { ...state.statsCache, [clean]: entry }
        const keys = Object.keys(nextCache)
        if (keys.length > MAX_STATS_CACHE) {
          keys
            .sort((a, b) => nextCache[a].fetchedAt - nextCache[b].fetchedAt)
            .slice(0, keys.length - MAX_STATS_CACHE)
            .forEach((k) => {
              delete nextCache[k]
            })
        }
        return { statsCache: nextCache }
      })
    } finally {
      inFlightStats.delete(flightKey)
    }
  },
}))
