import * as nip19 from 'nostr-tools/nip19'
import { isValidHex64, sanitizePublicHttpsUrl } from '../sanitize'
import { useNostrStore } from '../store/useNostrStore'
import { nostrPool } from './pool'

export interface ProfileSearchHit {
  pubkey: string
  name?: string
  display_name?: string
  picture?: string
  nip05?: string
}

export function resolveDirectPubkey(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (isValidHex64(clean)) return clean.toLowerCase()
  const lower = clean.toLowerCase()
  if (lower.startsWith('npub1') || lower.startsWith('nprofile1')) {
    try {
      const dec = nip19.decode(clean)
      if (dec.type === 'npub' && isValidHex64(dec.data)) return dec.data.toLowerCase()
      if (dec.type === 'nprofile' && isValidHex64(dec.data.pubkey)) {
        return dec.data.pubkey.toLowerCase()
      }
    } catch {
      return null
    }
  }
  return null
}

export async function resolveNip05Pubkey(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const parts = handle.trim().split('@')
  if (parts.length !== 2) return null
  const [rawName, rawDomain] = parts
  const name = rawName || '_'
  if (!/^[a-z0-9._-]+$/i.test(name) || !rawDomain) return null
  const url = sanitizePublicHttpsUrl(
    `https://${rawDomain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`,
  )
  if (!url) return null

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null
  try {
    const resp = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl?.signal,
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { names?: Record<string, unknown> }
    const pk = data.names?.[name] ?? data.names?.[name.toLowerCase()]
    return typeof pk === 'string' && isValidHex64(pk) ? pk.toLowerCase() : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function searchProfiles(
  rawQuery: string,
  readRelays: string[],
): Promise<ProfileSearchHit[]> {
  const q = rawQuery.trim()
  if (!q) return []

  const nostr = useNostrStore.getState()
  const hits = new Map<string, ProfileSearchHit>()

  const addHit = (pk: string) => {
    const clean = pk.toLowerCase()
    const prof = useNostrStore.getState().profiles[clean]
    hits.set(clean, {
      pubkey: clean,
      name: prof?.name,
      display_name: prof?.display_name,
      picture: prof?.picture,
      nip05: prof?.nip05,
    })
  }

  const direct = resolveDirectPubkey(q)
  if (direct) {
    if (!nostr.profiles[direct]) await nostr.fetchProfiles([direct])
    addHit(direct)
    return [...hits.values()]
  }

  if (q.includes('@') && !q.includes(' ')) {
    const nip05Pk = await resolveNip05Pubkey(q)
    if (nip05Pk) {
      if (!nostr.profiles[nip05Pk]) await nostr.fetchProfiles([nip05Pk])
      addHit(nip05Pk)
    }
  }

  const lower = q.toLowerCase()
  for (const [pk, prof] of Object.entries(nostr.profiles)) {
    const haystack = `${prof.display_name || ''} ${prof.name || ''} ${prof.nip05 || ''}`.toLowerCase()
    if (haystack.includes(lower)) {
      addHit(pk)
      if (hits.size >= 15) break
    }
  }

  if (q.length >= 2 && readRelays.length > 0) {
    try {
      const evs = await nostrPool.query(readRelays, { kinds: [0], search: q, limit: 20 }, 3500)
      for (const ev of evs) {
        useNostrStore.getState().ingestEvent(ev)
      }
      for (const ev of evs) {
        addHit(ev.pubkey)
        if (hits.size >= 25) break
      }
    } catch {
      // ignore search relay timeouts
    }
  }

  return [...hits.values()].slice(0, 20)
}
