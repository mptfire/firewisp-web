import { SimplePool, type SubCloser } from 'nostr-tools/pool'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { sanitizeRelayUrl } from '../sanitize'

export type RelayStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface PublishResult {
  relay: string
  ok: boolean
  reason?: string
}

const MAX_SUBSCRIBE_SEEN = 5000
const IDLE_RELAY_TTL_MS = 15 * 60_000

class FireWispPool {
  private pool = new SimplePool()
  private statuses = new Map<string, RelayStatus>()
  private statusListeners = new Set<(statuses: Record<string, RelayStatus>) => void>()
  private probeSockets = new Map<string, number>()
  private lastUsedAt = new Map<string, number>()

  constructor() {
    if (typeof window !== 'undefined') {
      const refreshStale = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        const now = Date.now()
        const activeUrls: string[] = []
        let pruned = false
        for (const url of [...this.statuses.keys()]) {
          const last = this.lastUsedAt.get(url) ?? 0
          if (last > 0 && now - last > IDLE_RELAY_TTL_MS) {
            this.statuses.delete(url)
            this.lastUsedAt.delete(url)
            this.probeSockets.delete(url)
            pruned = true
            continue
          }
          if (this.statuses.get(url) === 'connected') {
            this.statuses.set(url, 'disconnected')
          }
          activeUrls.push(url)
        }
        if (pruned) {
          const snap = this.getStatuses()
          for (const fn of this.statusListeners) fn(snap)
        }
        if (activeUrls.length > 0) {
          void this.ensureConnected(activeUrls)
        }
      }
      document.addEventListener('visibilitychange', refreshStale)
      window.addEventListener('online', refreshStale)
    }
  }

  getStatuses(): Record<string, RelayStatus> {
    const out: Record<string, RelayStatus> = {}
    for (const [k, v] of this.statuses) out[k] = v
    return out
  }

  onStatusChange(fn: (statuses: Record<string, RelayStatus>) => void): () => void {
    this.statusListeners.add(fn)
    fn(this.getStatuses())
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(url: string, status: RelayStatus) {
    if (this.statuses.get(url) === status) return
    this.statuses.set(url, status)
    const snap = this.getStatuses()
    for (const fn of this.statusListeners) fn(snap)
  }

  private normalizeRelays(relays: string[]): string[] {
    const set = new Set<string>()
    for (const r of relays) {
      const clean = sanitizeRelayUrl(r)
      if (clean) set.add(clean)
    }
    return [...set]
  }

  private touchRelays(urls: string[]) {
    const now = Date.now()
    for (const url of urls) {
      this.lastUsedAt.set(url, now)
    }
  }

  async ensureConnected(relays: string[]): Promise<void> {
    const urls = this.normalizeRelays(relays)
    this.touchRelays(urls)
    await Promise.allSettled(
      urls.map(async (url) => {
        if (this.statuses.get(url) === 'connected') return
        this.setStatus(url, 'connecting')
        try {
          const relay = await this.pool.ensureRelay(url, { connectionTimeout: 6000 })
          this.setStatus(url, relay.connected ? 'connected' : 'disconnected')
          if (!this.probeSockets.has(url)) {
            this.probeSockets.set(url, 1)
            const origOnClose = relay.onclose
            relay.onclose = () => {
              this.setStatus(url, 'disconnected')
              this.probeSockets.delete(url)
              origOnClose?.()
            }
          }
        } catch {
          this.setStatus(url, 'error')
        }
      }),
    )
  }

  subscribe(
    relays: string[],
    filter: Filter,
    handlers: {
      onevent: (event: Event) => void
      oneose?: () => void
    },
  ): SubCloser {
    const urls = this.normalizeRelays(relays)
    if (urls.length === 0) {
      handlers.oneose?.()
      return { close: () => {} }
    }
    this.touchRelays(urls)
    void this.ensureConnected(urls)
    const seen = new Set<string>()
    return this.pool.subscribeMany(urls, filter, {
      onevent: (ev) => {
        if (seen.has(ev.id)) return
        if (!verifyEvent(ev)) return
        if (seen.size >= MAX_SUBSCRIBE_SEEN) {
          const oldest = seen.values().next().value
          if (oldest !== undefined) seen.delete(oldest)
        }
        seen.add(ev.id)
        handlers.onevent(ev)
      },
      oneose: handlers.oneose,
    })
  }

  async query(relays: string[], filter: Filter, maxWaitMs = 4500): Promise<Event[]> {
    const urls = this.normalizeRelays(relays)
    if (urls.length === 0) return []
    this.touchRelays(urls)
    void this.ensureConnected(urls)
    const events = await this.pool.querySync(urls, filter, { maxWait: maxWaitMs })
    const dedup = new Map<string, Event>()
    for (const ev of events) {
      if (!dedup.has(ev.id) && verifyEvent(ev)) {
        dedup.set(ev.id, ev)
      }
    }
    return [...dedup.values()].sort((a, b) => b.created_at - a.created_at)
  }

  async publish(relays: string[], event: Event): Promise<PublishResult[]> {
    const urls = this.normalizeRelays(relays)
    this.touchRelays(urls)
    const promises = this.pool.publish(urls, event)
    const settled = await Promise.allSettled(promises)
    return settled.map((res, idx) => {
      const relay = urls[idx]
      if (res.status === 'fulfilled') {
        this.setStatus(relay, 'connected')
        return { relay, ok: true }
      }
      const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
      return { relay, ok: false, reason: msg }
    })
  }
}

export const nostrPool = new FireWispPool()
