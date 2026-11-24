import type { RelayEntry } from '../constants'
import { sanitizeBlossomUrl, sanitizePublicRelayUrl } from '../sanitize'

export const KIND_RELAY_LIST = 10002
export const KIND_BLOSSOM_SERVER_LIST = 10063

/**
 * Builds canonical NIP-65 (`kind: 10002`) `r` tags from relay entries.
 * Never leaks private/LAN/loopback or cleartext `ws://` URLs to public relays.
 */
export function buildNip65RelayListTags(relays: readonly RelayEntry[]): {
  tags: string[][]
  readRelays: string[]
  writeRelays: string[]
} {
  const seen = new Set<string>()
  const tags: string[][] = []
  const readRelays: string[] = []
  const writeRelays: string[] = []

  for (const entry of relays) {
    if (!entry.read && !entry.write) continue
    const clean = sanitizePublicRelayUrl(entry.url)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)

    if (entry.read && entry.write) {
      tags.push(['r', clean])
      readRelays.push(clean)
      writeRelays.push(clean)
    } else if (entry.read) {
      tags.push(['r', clean, 'read'])
      readRelays.push(clean)
    } else {
      tags.push(['r', clean, 'write'])
      writeRelays.push(clean)
    }
  }

  return { tags, readRelays, writeRelays }
}

/**
 * Builds canonical BUD-03 (`kind: 10063`) `server` tags preserving exact priority order (index 0 = primary).
 * Rejects cleartext `http://` and private/LAN URLs.
 */
export function buildBud03BlossomListTags(servers: readonly string[]): {
  tags: string[][]
  servers: string[]
} {
  const seen = new Set<string>()
  const tags: string[][] = []
  const cleanServers: string[] = []

  for (const raw of servers) {
    const clean = sanitizeBlossomUrl(raw)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    cleanServers.push(clean)
    tags.push(['server', clean])
  }

  return { tags, servers: cleanServers }
}
