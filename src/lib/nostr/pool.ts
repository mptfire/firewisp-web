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

class FireWispPool {
  private pool = new SimplePool()
  private statuses = new Map<string, RelayStatus>()
  private statusListeners = new Set<(statuses: Record<string, RelayStatus>) => void>()
  private probeSockets = new Map<string, number>()

  constructor() {
    if (typeof window !== 'undefined') {
      const refreshStale = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        const urls = [...this.statuses.keys()]
        for (const url of urls) {
          if (this.statuses.get(url) === 'connected') {
            this.statuses.set(url, 'disconnected')
          }
        }
        if (urls.length > 0) {
          void this.ensureConnected(urls)
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

  async ensureConnected(relays: string[]): Promise<void> {
    const urls = this.normalizeRelays(relays)
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
    void this.ensureConnected(urls)
    const seen = new Set<string>()
    return this.pool.subscribeMany(urls, filter, {
      onevent: (ev) => {
        if (seen.has(ev.id)) return
        if (!verifyEvent(ev)) return
        seen.add(ev.id)
        handlers.onevent(ev)
      },
      oneose: handlers.oneose,
    })
  }

  async query(relays: string[], filter: Filter, maxWaitMs = 4500): Promise<Event[]> {
    const urls = this.normalizeRelays(relays)
    if (urls.length === 0) return []
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
