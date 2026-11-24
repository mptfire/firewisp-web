import type { UnsignedEvent } from 'nostr-tools/pure'
import { minePowSync } from './nip13'

self.onmessage = (e: MessageEvent<{ event: UnsignedEvent; targetDifficulty: number }>) => {
  try {
    const { event, targetDifficulty } = e.data
    const result = minePowSync(event, targetDifficulty)
    self.postMessage({
      event: result.event,
      id: result.id,
      difficulty: result.difficulty,
    })
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
