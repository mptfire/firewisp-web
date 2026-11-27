export interface RelayEntry {
  url: string
  read: boolean
  write: boolean
}

export const FIREWISP_RELAY = 'wss://relay.firewisp.de'
export const LEGACY_FIREWISP_RELAY = 'wss://firewisp.relay.rtard.de'
export const TRENDING_RELAY = 'wss://trending.relays.land'
export const CURATED_EXPLORE_RELAYS = [
  FIREWISP_RELAY,
  'wss://nostr.wine',
  'wss://relay.primal.net',
  TRENDING_RELAY,
]
export const DEFAULT_BLOSSOM_PRIMARY = 'https://blossom.nostr.build'
export const DEFAULT_BLOSSOM_FALLBACK = 'https://blossom.primal.net'

export const ANDROID_APP_URL = 'https://app.firewisp.de/'
export const ZAPSTORE_URL = 'https://zapstore.dev/apps/de.rtard.wisp'

export const DEFAULT_RELAYS: RelayEntry[] = [
  { url: FIREWISP_RELAY, read: true, write: true },
  { url: 'wss://relay.damus.io', read: true, write: true },
  { url: 'wss://relay.primal.net', read: true, write: true },
  { url: 'wss://nos.lol', read: true, write: true },
  { url: 'wss://purplepag.es', read: true, write: false },
]

export const DEFAULT_BLOSSOM_SERVERS: string[] = [
  DEFAULT_BLOSSOM_PRIMARY,
  DEFAULT_BLOSSOM_FALLBACK,
]

export const DEFAULT_NOTE_POW_BITS = 16
export const DEFAULT_REACTION_POW_BITS = 12

export const NIP49_MIN_LOG_N = 12
export const NIP49_MAX_LOG_N = 20

export const MAX_BLOSSOM_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
export const CLIENT_TAG_VALUE = 'Fire Wisp'
