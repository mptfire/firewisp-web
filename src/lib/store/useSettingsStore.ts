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
  mutedWords: string[]
  dmAutoLoadMedia: boolean
  clientTagEnabled: boolean
  spamFilterEnabled: boolean
  hideRepliesInExplore: boolean
  requirePowInExplore: boolean
  showFireWispTab: boolean
  showExtendedTab: boolean
  showExploreTab: boolean
  showLiveNowBar: boolean
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  nwcUri: string

  addRelay: (url: string) => boolean
  removeRelay: (url: string) => void
  toggleRelayMode: (url: string, field: 'read' | 'write') => void
  resetRelays: () => void

  addBlossomServer: (url: string) => boolean
  removeBlossomServer: (url: string) => void
  setPrimaryBlossomServer: (url: string) => void
  mergeRemoteBlossomServers: (servers: string[]) => void

  setNotePowEnabled: (enabled: boolean) => void
  setNotePowBits: (bits: number) => void
  setReactionPowEnabled: (enabled: boolean) => void
  setReactionPowBits: (bits: number) => void

  mutePubkey: (pubkey: string) => void
  unmutePubkey: (pubkey: string) => void
  muteHashtag: (tag: string) => void
  unmuteHashtag: (tag: string) => void
  mergeRemoteMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void

  setDmAutoLoadMedia: (enabled: boolean) => void
  setClientTagEnabled: (enabled: boolean) => void
  setSpamFilterEnabled: (enabled: boolean) => void
  setHideRepliesInExplore: (enabled: boolean) => void
  setRequirePowInExplore: (enabled: boolean) => void
  setShowFireWispTab: (enabled: boolean) => void
  setShowExtendedTab: (enabled: boolean) => void
  setShowExploreTab: (enabled: boolean) => void
  setShowLiveNowBar: (enabled: boolean) => void
  setHoverStreamPreview: (enabled: boolean) => void
  setInlineMediaPlayback: (enabled: boolean) => void
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
  mutedWords: string[]
  dmAutoLoadMedia: boolean
  clientTagEnabled: boolean
  spamFilterEnabled: boolean
  hideRepliesInExplore: boolean
  requirePowInExplore: boolean
  showFireWispTab: boolean
  showExtendedTab: boolean
  showExploreTab: boolean
  showLiveNowBar: boolean
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  // SECURITY: nwcUri is intentionally NEVER persisted to localStorage (session-only in memory).
}

function loadInitial(): PersistedSettings & { nwcUri: string } {
  const defaults: PersistedSettings & { nwcUri: string } = {
    relays: DEFAULT_RELAYS,
    blossomServers: DEFAULT_BLOSSOM_SERVERS,
    notePowEnabled: true,
    notePowBits: DEFAULT_NOTE_POW_BITS,
    reactionPowEnabled: true,
    reactionPowBits: DEFAULT_REACTION_POW_BITS,
    mutedPubkeys: [],
    mutedHashtags: [],
    mutedWords: [],
    dmAutoLoadMedia: false,
    clientTagEnabled: true,
    spamFilterEnabled: true,
    hideRepliesInExplore: true,
    requirePowInExplore: false,
    showFireWispTab: false,
    showExtendedTab: false,
    showExploreTab: false,
    showLiveNowBar: true,
    hoverStreamPreview: true,
    inlineMediaPlayback: true,
    nwcUri: '',
  }
  if (typeof localStorage === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<PersistedSettings & { nwcUri?: string }>
    // Scrub any legacy nwcUri that may have been stored before session-only hardening
    const hadLegacyNwc = Boolean(parsed.nwcUri)
    let blossomServers =
      Array.isArray(parsed.blossomServers) && parsed.blossomServers.length > 0
        ? parsed.blossomServers
        : DEFAULT_BLOSSOM_SERVERS

    // Migrate old untouched default pair away from private firewisp.blossom.rtard.de
    if (
      blossomServers.length === 2 &&
      blossomServers[0] === 'https://firewisp.blossom.rtard.de' &&
      blossomServers[1] === 'https://blossom.primal.net'
    ) {
      blossomServers = DEFAULT_BLOSSOM_SERVERS
    }

    const merged: PersistedSettings & { nwcUri: string } = {
      ...defaults,
      ...parsed,
      relays:
        Array.isArray(parsed.relays) && parsed.relays.length > 0
          ? parsed.relays
          : DEFAULT_RELAYS,
      blossomServers,
      nwcUri: '',
    }
    if (hadLegacyNwc) {
      const { nwcUri: _drop, ...cleanSnap } = merged
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanSnap))
    }
    return merged
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
    mutedWords: state.mutedWords,
    dmAutoLoadMedia: state.dmAutoLoadMedia,
    clientTagEnabled: state.clientTagEnabled,
    spamFilterEnabled: state.spamFilterEnabled,
    hideRepliesInExplore: state.hideRepliesInExplore,
    requirePowInExplore: state.requirePowInExplore,
    showFireWispTab: state.showFireWispTab,
    showExtendedTab: state.showExtendedTab,
    showExploreTab: state.showExploreTab,
    showLiveNowBar: state.showLiveNowBar,
    hoverStreamPreview: state.hoverStreamPreview,
    inlineMediaPlayback: state.inlineMediaPlayback,
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

  setPrimaryBlossomServer: (rawUrl) => {
    const url = sanitizeBlossomUrl(rawUrl)
    if (!url) return
    set((s) => ({
      blossomServers: [url, ...s.blossomServers.filter((u) => u !== url)],
    }))
    persist(get())
  },

  mergeRemoteBlossomServers: (servers) => {
    const cleaned = servers
      .map((u) => sanitizeBlossomUrl(u))
      .filter((u): u is string => Boolean(u))
    if (cleaned.length === 0) return
    set((s) => {
      // Prepend newly discovered remote servers without overriding an existing user-selected primary
      const unseen = cleaned.filter((u) => !s.blossomServers.includes(u))
      if (unseen.length === 0) return s
      return {
        blossomServers: [...unseen, ...s.blossomServers],
      }
    })
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
  mergeRemoteMutes: ({ pubkeys = [], hashtags = [], words = [] }) => {
    set((s) => ({
      mutedPubkeys: [
        ...new Set([...s.mutedPubkeys, ...pubkeys.map((p) => p.toLowerCase()).filter(Boolean)]),
      ],
      mutedHashtags: [
        ...new Set([
          ...s.mutedHashtags,
          ...hashtags.map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean),
        ]),
      ],
      mutedWords: [
        ...new Set([
          ...s.mutedWords,
          ...words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2),
        ]),
      ],
    }))
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
  setSpamFilterEnabled: (spamFilterEnabled) => {
    set({ spamFilterEnabled })
    persist(get())
  },
  setHideRepliesInExplore: (hideRepliesInExplore) => {
    set({ hideRepliesInExplore })
    persist(get())
  },
  setRequirePowInExplore: (requirePowInExplore) => {
    set({ requirePowInExplore })
    persist(get())
  },
  setShowFireWispTab: (showFireWispTab) => {
    set({ showFireWispTab })
    persist(get())
  },
  setShowExtendedTab: (showExtendedTab) => {
    set({ showExtendedTab })
    persist(get())
  },
  setShowExploreTab: (showExploreTab) => {
    set({ showExploreTab })
    persist(get())
  },
  setShowLiveNowBar: (showLiveNowBar) => {
    set({ showLiveNowBar })
    persist(get())
  },
  setHoverStreamPreview: (hoverStreamPreview) => {
    set({ hoverStreamPreview })
    persist(get())
  },
  setInlineMediaPlayback: (inlineMediaPlayback) => {
    set({ inlineMediaPlayback })
    persist(get())
  },
  setNwcUri: (nwcUri) => {
    // Session-only in memory — intentionally never written to localStorage.
    set({ nwcUri: nwcUri.trim() })
  },

  getReadRelays: () => get().relays.filter((r) => r.read).map((r) => r.url),
  getWriteRelays: () => get().relays.filter((r) => r.write).map((r) => r.url),
}))
