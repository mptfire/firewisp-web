import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SHOW_REPLIES_KEY = 'firewisp_show_replies_v1'

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    },
  }
}

describe('Replies display preference persistence', () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('defaults to false when unset and persists On/Off across module reloads', async () => {
    const storage = createMemoryStorage()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: storage,
    })

    let mod = await import('../store/useNostrStore')
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(false)

    mod.useNostrStore.getState().setShowRepliesInFollows(true)
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(true)
    expect(storage.getItem(SHOW_REPLIES_KEY)).toBe('1')

    // Simulate full page reload by resetting modules and re-importing store
    vi.resetModules()
    mod = await import('../store/useNostrStore')
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(true)

    mod.useNostrStore.getState().setShowRepliesInFollows(false)
    expect(storage.getItem(SHOW_REPLIES_KEY)).toBe('0')

    vi.resetModules()
    mod = await import('../store/useNostrStore')
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(false)
  })

  it('falls back safely to false on corrupt or inaccessible localStorage', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: createMemoryStorage({ [SHOW_REPLIES_KEY]: 'corrupt-value' }),
    })

    let mod = await import('../store/useNostrStore')
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(false)

    vi.resetModules()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem() {
          throw new Error('SecurityError')
        },
        setItem() {
          throw new Error('QuotaExceededError')
        },
      } as unknown as Storage,
    })

    mod = await import('../store/useNostrStore')
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(false)
    expect(() => mod.useNostrStore.getState().setShowRepliesInFollows(true)).not.toThrow()
    expect(mod.useNostrStore.getState().showRepliesInFollows).toBe(true)
  })
})
