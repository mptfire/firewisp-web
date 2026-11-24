import { getEventHash, type UnsignedEvent } from 'nostr-tools/pure'

export function countLeadingZeroBits(hexId: string): number {
  let bits = 0
  for (let i = 0; i < hexId.length; i++) {
    const nibble = parseInt(hexId[i], 16)
    if (Number.isNaN(nibble)) return 0
    if (nibble === 0) {
      bits += 4
    } else {
      if (nibble < 2) bits += 3
      else if (nibble < 4) bits += 2
      else if (nibble < 8) bits += 1
      break
    }
  }
  return bits
}

export function getCommittedDifficulty(tags: string[][]): number {
  for (const tag of tags) {
    if (tag.length >= 3 && tag[0] === 'nonce') {
      const n = parseInt(tag[2], 10)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
  }
  return 0
}

export function verifyEventPow(id: string, tags: string[][]): number {
  const committed = getCommittedDifficulty(tags)
  if (committed <= 0) return 0
  const actual = countLeadingZeroBits(id)
  return actual >= committed ? actual : 0
}

/**
 * Synchronous NIP-13 miner (used by Web Worker and unit tests).
 */
export function minePowSync(
  event: UnsignedEvent,
  targetDifficulty: number,
  maxIterations = 5_000_000,
): { event: UnsignedEvent; id: string; difficulty: number; iterations: number } {
  if (targetDifficulty <= 0) {
    const id = getEventHash(event)
    return { event, id, difficulty: countLeadingZeroBits(id), iterations: 0 }
  }

  const baseTags = event.tags.filter((t) => t[0] !== 'nonce')
  const nonceTag = ['nonce', '0', String(targetDifficulty)]
  const candidate: UnsignedEvent = {
    ...event,
    tags: [...baseTags, nonceTag],
  }

  for (let i = 0; i < maxIterations; i++) {
    nonceTag[1] = String(i)
    const id = getEventHash(candidate)
    const bits = countLeadingZeroBits(id)
    if (bits >= targetDifficulty) {
      return {
        event: {
          ...candidate,
          tags: [...baseTags, ['nonce', String(i), String(targetDifficulty)]],
        },
        id,
        difficulty: bits,
        iterations: i + 1,
      }
    }
  }
  throw new Error(`PoW mining exceeded ${maxIterations} iterations`)
}

/**
 * Runs NIP-13 PoW mining in a dedicated Web Worker so the UI stays 60fps responsive.
 * Falls back cleanly to minePowSync in non-browser/test environments.
 */
export function minePowAsync(
  event: UnsignedEvent,
  targetDifficulty: number,
  signal?: AbortSignal,
): Promise<{ event: UnsignedEvent; id: string; difficulty: number }> {
  if (targetDifficulty <= 0) {
    const id = getEventHash(event)
    return Promise.resolve({ event, id, difficulty: countLeadingZeroBits(id) })
  }

  if (typeof Worker === 'undefined') {
    const res = minePowSync(event, targetDifficulty)
    return Promise.resolve({ event: res.event, id: res.id, difficulty: res.difficulty })
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), {
      type: 'module',
    })

    const onAbort = () => {
      worker.terminate()
      reject(new DOMException('PoW mining cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent) => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      if (e.data?.error) {
        reject(new Error(e.data.error))
      } else {
        resolve(e.data)
      }
    }
    worker.onerror = (err) => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      reject(new Error(err.message || 'PoW worker failed'))
    }
    worker.postMessage({ event, targetDifficulty })
  })
}
