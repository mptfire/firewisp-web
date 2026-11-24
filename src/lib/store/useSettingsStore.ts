import { create } from 'zustand'
import {
  DEFAULT_BLOSSOM_SERVERS,
  DEFAULT_NOTE_POW_BITS,
  DEFAULT_REACTION_POW_BITS,
  DEFAULT_RELAYS,
  type RelayEntry,
} from '../constants'
import { sanitizeBlossomUrl, sanitizeRelayUrl } from '../sanitize'

const STORAGE_KEY = 'firewisp_settings_v1'

export interface SettingsState {
  relays: RelayEntry[]
  blossomServers: string[]
  notePowEnabled: boolean
  notePowBits: number
  reactionPowEnabled: boolean
  reactionPowBits: number
  mutedPubkeys: string[]
  mutedHashtags: string[]
  dmAutoLoadMedia: boolean
  clientTagEnabled: boolean
  nwcUri: string

  addRelay: (url: string) => boolean
  removeRelay: (url: string) => void
  toggleRelayMode: (url: string, field: 'read' | 'write') => void
  resetRelays: () => void

  addBlossomServer: (url: string) => boolean
  removeBlossomServer: (url: string) => void

  setNotePowEnabled: (enabled: boolean) => void
  setNotePowBits: (bits: number) => void
  setReactionPowEnabled: (enabled: boolean) => void
  setReactionPowBits: (bits: number) => void

  mutePubkey: (pubkey: string) => void
  unmutePubkey: (pubkey: string) => void
  muteHashtag: (tag: string) => void
  unmuteHashtag: (tag: string) => void

  setDmAutoLoadMedia: (enabled: boolean) => void
  setClientTagEnabled: (enabled: boolean) => void
  setNwcUri: (uri: string) => void

  getReadRelays: () => string[]
  getWriteRelays: () => string[]
}

interface PersistedSettings {
  relays: RelayEntry[]
  blossomServers: string[]
  notePowEnabled: boolean
  notePowBits: number
  reactionPowEnabled: boolean
  reactionPowBits: number
  mutedPubkeys: string[]
  mutedHashtags: string[]
  dmAutoLoadMedia: boolean
  clientTagEnabled: boolean
  nwcUri: string
}

function loadInitial(): PersistedSettings {
  const defaults: PersistedSettings = {
    relays: DEFAULT_RELAYS,
    blossomServers: DEFAULT_BLOSSOM_SERVERS,
    notePowEnabled: true,
    notePowBits: DEFAULT_NOTE_POW_BITS,
    reactionPowEnabled: true,
    reactionPowBits: DEFAULT_REACTION_POW_BITS,
    mutedPubkeys: [],
    mutedHashtags: [],
    dmAutoLoadMedia: false,
    clientTagEnabled: true,
    nwcUri: '',
  }
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    return {
      ...defaults,
      ...parsed,
      relays:
        Array.isArray(parsed.relays) && parsed.relays.length > 0
          ? parsed.relays
          : DEFAULT_RELAYS,
      blossomServers:
        Array.isArray(parsed.blossomServers) && parsed.blossomServers.length > 0
          ? parsed.blossomServers
          : DEFAULT_BLOSSOM_SERVERS,
    }
  } catch {
    return defaults
  }
}

function persist(state: SettingsState) {
  if (typeof localStorage === 'undefined') return
  const snap: PersistedSettings = {
    relays: state.relays,
    blossomServers: state.blossomServers,
    notePowEnabled: state.notePowEnabled,
    notePowBits: state.notePowBits,
    reactionPowEnabled: state.reactionPowEnabled,
    reactionPowBits: state.reactionPowBits,
    mutedPubkeys: state.mutedPubkeys,
    mutedHashtags: state.mutedHashtags,
    dmAutoLoadMedia: state.dmAutoLoadMedia,
    clientTagEnabled: state.clientTagEnabled,
    nwcUri: state.nwcUri,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap))
  } catch {
    // ignore quota errors
  }
}

const initial = loadInitial()

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,

  addRelay: (rawUrl) => {
    const url = sanitizeRelayUrl(rawUrl)
    if (!url) return false
    const existing = get().relays
    if (existing.some((r) => r.url === url)) return false
    set({ relays: [...existing, { url, read: true, write: true }] })
    persist(get())
    return true
  },

  removeRelay: (url) => {
    set((s) => ({ relays: s.relays.filter((r) => r.url !== url) }))
    persist(get())
  },

  toggleRelayMode: (url, field) => {
    set((s) => ({
      relays: s.relays.map((r) => (r.url === url ? { ...r, [field]: !r[field] } : r)),
    }))
    persist(get())
  },

  resetRelays: () => {
    set({ relays: DEFAULT_RELAYS })
    persist(get())
  },

  addBlossomServer: (rawUrl) => {
    const url = sanitizeBlossomUrl(rawUrl)
    if (!url) return false
    const existing = get().blossomServers
    if (existing.includes(url)) return false
    set({ blossomServers: [url, ...existing] })
    persist(get())
    return true
  },

  removeBlossomServer: (url) => {
    set((s) => ({ blossomServers: s.blossomServers.filter((u) => u !== url) }))
    persist(get())
  },

  setNotePowEnabled: (notePowEnabled) => {
    set({ notePowEnabled })
    persist(get())
  },
  setNotePowBits: (bits) => {
    set({ notePowBits: Math.min(24, Math.max(8, Math.round(bits))) })
    persist(get())
  },
  setReactionPowEnabled: (reactionPowEnabled) => {
    set({ reactionPowEnabled })
    persist(get())
  },
  setReactionPowBits: (bits) => {
    set({ reactionPowBits: Math.min(24, Math.max(8, Math.round(bits))) })
    persist(get())
  },

  mutePubkey: (pubkey) => {
    const clean = pubkey.toLowerCase()
    set((s) => ({
      mutedPubkeys: s.mutedPubkeys.includes(clean)
        ? s.mutedPubkeys
        : [...s.mutedPubkeys, clean],
    }))
    persist(get())
  },
  unmutePubkey: (pubkey) => {
    const clean = pubkey.toLowerCase()
    set((s) => ({ mutedPubkeys: s.mutedPubkeys.filter((p) => p !== clean) }))
    persist(get())
  },

  muteHashtag: (tag) => {
    const clean = tag.trim().toLowerCase().replace(/^#/, '')
    if (!clean) return
    set((s) => ({
      mutedHashtags: s.mutedHashtags.includes(clean)
        ? s.mutedHashtags
        : [...s.mutedHashtags, clean],
    }))
    persist(get())
  },
  unmuteHashtag: (tag) => {
    const clean = tag.trim().toLowerCase().replace(/^#/, '')
    set((s) => ({ mutedHashtags: s.mutedHashtags.filter((t) => t !== clean) }))
    persist(get())
  },

  setDmAutoLoadMedia: (dmAutoLoadMedia) => {
    set({ dmAutoLoadMedia })
    persist(get())
  },
  setClientTagEnabled: (clientTagEnabled) => {
    set({ clientTagEnabled })
    persist(get())
  },
  setNwcUri: (nwcUri) => {
    set({ nwcUri: nwcUri.trim() })
    persist(get())
  },

  getReadRelays: () => get().relays.filter((r) => r.read).map((r) => r.url),
  getWriteRelays: () => get().relays.filter((r) => r.write).map((r) => r.url),
}))
