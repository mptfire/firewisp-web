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
const NWC_STORAGE_KEY = 'firewisp_nwc_v1'

export type SidebarFeedMode = 'trending' | 'extended' | 'global' | 'firewisp'
const VALID_SIDEBAR_FEED_MODES: readonly SidebarFeedMode[] = [
  'trending',
  'extended',
  'global',
  'firewisp',
]

function loadStoredNwc(): { nwcUri: string; remember: boolean } {
  try {
    if (typeof localStorage !== 'undefined') {
      const persisted = localStorage.getItem(NWC_STORAGE_KEY)?.trim()
      if (persisted) return { nwcUri: persisted, remember: true }
    }
    if (typeof sessionStorage !== 'undefined') {
      const session = sessionStorage.getItem(NWC_STORAGE_KEY)?.trim()
      if (session) return { nwcUri: session, remember: false }
    }
  } catch {
    // ignore storage access errors
  }
  return { nwcUri: '', remember: true }
}

function saveStoredNwc(uri: string, remember: boolean) {
  const clean = uri.trim()
  try {
    if (!clean) {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(NWC_STORAGE_KEY)
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(NWC_STORAGE_KEY)
      return
    }
    if (remember) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(NWC_STORAGE_KEY, clean)
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(NWC_STORAGE_KEY)
    } else {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(NWC_STORAGE_KEY, clean)
      if (typeof localStorage !== 'undefined') localStorage.removeItem(NWC_STORAGE_KEY)
    }
  } catch {
    // ignore quota/private-mode errors
  }
}

export interface SettingsState {
  relays: RelayEntry[]
  blossomServers: string[]
  blossomCustomized: boolean
  notePowEnabled: boolean
  notePowBits: number
  reactionPowEnabled: boolean
  reactionPowBits: number
  mutedPubkeys: string[]
  mutedHashtags: string[]
  mutedWords: string[]
  // In-memory only (decrypted NIP-44 kind-10000 tags — NEVER persisted to localStorage)
  privateMutedPubkeys: string[]
  privateMutedHashtags: string[]
  privateMutedWords: string[]
  dmAutoLoadMedia: boolean
  clientTagEnabled: boolean
  spamFilterEnabled: boolean
  hideRepliesInExplore: boolean
  requirePowInExplore: boolean
  showFireWispTab: boolean
  showExtendedTab: boolean
  showExploreTab: boolean
  showLiveNowBar: boolean
  showLiveZaps: boolean
  sidebarFeedMode: SidebarFeedMode
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  nwcUri: string
  nwcRememberDevice: boolean

  addRelay: (url: string) => boolean
  removeRelay: (url: string) => void
  toggleRelayMode: (url: string, field: 'read' | 'write') => void
  importRelays: (entries: RelayEntry[]) => number
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
  removeMutedWord: (word: string) => void
  mergeRemoteMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void
  mergePrivateMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void
  clearPrivateSessionMutes: () => void

  setDmAutoLoadMedia: (enabled: boolean) => void
  setClientTagEnabled: (enabled: boolean) => void
  setSpamFilterEnabled: (enabled: boolean) => void
  setHideRepliesInExplore: (enabled: boolean) => void
  setRequirePowInExplore: (enabled: boolean) => void
  setShowFireWispTab: (enabled: boolean) => void
  setShowExtendedTab: (enabled: boolean) => void
  setShowExploreTab: (enabled: boolean) => void
  setShowLiveNowBar: (enabled: boolean) => void
  setShowLiveZaps: (enabled: boolean) => void
  setSidebarFeedMode: (mode: SidebarFeedMode) => void
  setHoverStreamPreview: (enabled: boolean) => void
  setInlineMediaPlayback: (enabled: boolean) => void
  setNwcUri: (uri: string, remember?: boolean) => void
  setNwcRememberDevice: (remember: boolean) => void

  getReadRelays: () => string[]
  getWriteRelays: () => string[]
}

interface PersistedSettings {
  relays: RelayEntry[]
  blossomServers: string[]
  blossomCustomized: boolean
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
  showLiveZaps: boolean
  sidebarFeedMode: SidebarFeedMode
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  // SECURITY: nwcUri and privateMuted* are intentionally NEVER persisted to localStorage (session-only in memory).
}

function loadInitial(): PersistedSettings & {
  nwcUri: string
  nwcRememberDevice: boolean
  privateMutedPubkeys: string[]
  privateMutedHashtags: string[]
  privateMutedWords: string[]
} {
  const storedNwc = loadStoredNwc()
  const defaults: PersistedSettings & {
    nwcUri: string
    nwcRememberDevice: boolean
    privateMutedPubkeys: string[]
    privateMutedHashtags: string[]
    privateMutedWords: string[]
  } = {
    relays: DEFAULT_RELAYS,
    blossomServers: DEFAULT_BLOSSOM_SERVERS,
    blossomCustomized: false,
    notePowEnabled: true,
    notePowBits: DEFAULT_NOTE_POW_BITS,
    reactionPowEnabled: true,
    reactionPowBits: DEFAULT_REACTION_POW_BITS,
    mutedPubkeys: [],
    mutedHashtags: [],
    mutedWords: [],
    privateMutedPubkeys: [],
    privateMutedHashtags: [],
    privateMutedWords: [],
    dmAutoLoadMedia: false,
    clientTagEnabled: true,
    spamFilterEnabled: true,
    hideRepliesInExplore: true,
    requirePowInExplore: false,
    showFireWispTab: false,
    showExtendedTab: false,
    showExploreTab: false,
    showLiveNowBar: true,
    showLiveZaps: true,
    sidebarFeedMode: 'trending',
    hoverStreamPreview: true,
    inlineMediaPlayback: true,
    nwcUri: storedNwc.nwcUri,
    nwcRememberDevice: storedNwc.remember,
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
        ? [
            ...new Set(
              parsed.blossomServers
                .map((u) => sanitizeBlossomUrl(typeof u === 'string' ? u : ''))
                .filter((u): u is string => Boolean(u)),
            ),
          ]
        : DEFAULT_BLOSSOM_SERVERS

    if (blossomServers.length === 0) blossomServers = DEFAULT_BLOSSOM_SERVERS

    // Migrate old untouched default pair away from private firewisp.blossom.rtard.de
    if (
      blossomServers.length === 2 &&
      blossomServers[0] === 'https://firewisp.blossom.rtard.de' &&
      blossomServers[1] === 'https://blossom.primal.net'
    ) {
      blossomServers = DEFAULT_BLOSSOM_SERVERS
    }

    const sanitizedRelays =
      Array.isArray(parsed.relays) && parsed.relays.length > 0
        ? parsed.relays
            .map((r) => {
              const url = sanitizeRelayUrl(r?.url)
              return url ? { url, read: Boolean(r.read), write: Boolean(r.write) } : null
            })
            .filter((r): r is RelayEntry => Boolean(r))
        : DEFAULT_RELAYS

    const sidebarFeedMode: SidebarFeedMode =
      parsed.sidebarFeedMode && VALID_SIDEBAR_FEED_MODES.includes(parsed.sidebarFeedMode)
        ? parsed.sidebarFeedMode
        : 'trending'

    const merged = {
      ...defaults,
      ...parsed,
      relays: sanitizedRelays.length > 0 ? sanitizedRelays : DEFAULT_RELAYS,
      blossomServers,
      sidebarFeedMode,
      privateMutedPubkeys: [],
      privateMutedHashtags: [],
      privateMutedWords: [],
      nwcUri: storedNwc.nwcUri,
      nwcRememberDevice: storedNwc.remember,
    }
    if (hadLegacyNwc) {
      const {
        nwcUri: _drop,
        nwcRememberDevice: _dropRem,
        privateMutedPubkeys: _p1,
        privateMutedHashtags: _p2,
        privateMutedWords: _p3,
        ...cleanSnap
      } = merged
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
    blossomCustomized: state.blossomCustomized,
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
    showLiveZaps: state.showLiveZaps,
    sidebarFeedMode: state.sidebarFeedMode,
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

  importRelays: (entries) => {
    const current = get().relays
    const map = new Map<string, RelayEntry>()
    for (const r of current) map.set(r.url, { ...r })
    let added = 0
    for (const raw of entries) {
      const url = sanitizeRelayUrl(raw.url)
      if (!url) continue
      const existing = map.get(url)
      if (existing) {
        existing.read = existing.read || raw.read
        existing.write = existing.write || raw.write
      } else {
        map.set(url, { url, read: raw.read, write: raw.write })
        added++
      }
    }
    set({ relays: [...map.values()] })
    persist(get())
    return added
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
    set({ blossomServers: [url, ...existing], blossomCustomized: true })
    persist(get())
    return true
  },

  removeBlossomServer: (url) => {
    set((s) => ({
      blossomServers: s.blossomServers.filter((u) => u !== url),
      blossomCustomized: true,
    }))
    persist(get())
  },

  setPrimaryBlossomServer: (rawUrl) => {
    const url = sanitizeBlossomUrl(rawUrl)
    if (!url) return
    set((s) => ({
      blossomServers: [url, ...s.blossomServers.filter((u) => u !== url)],
      blossomCustomized: true,
    }))
    persist(get())
  },

  mergeRemoteBlossomServers: (servers) => {
    const cleaned = [
      ...new Set(
        servers
          .map((u) => sanitizeBlossomUrl(u))
          .filter((u): u is string => Boolean(u)),
      ),
    ]
    if (cleaned.length === 0) return
    set((s) => {
      if (!s.blossomCustomized) {
        // Adopt the user's published BUD-03 server priority order before local fallbacks
        const rest = s.blossomServers.filter((u) => !cleaned.includes(u))
        return { blossomServers: [...cleaned, ...rest] }
      }
      // User locally customized primary server — append any unseen remote servers without overriding primary
      const unseen = cleaned.filter((u) => !s.blossomServers.includes(u))
      if (unseen.length === 0) return s
      return {
        blossomServers: [...s.blossomServers, ...unseen],
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
    set((s) => ({
      mutedPubkeys: s.mutedPubkeys.filter((p) => p !== clean),
      privateMutedPubkeys: s.privateMutedPubkeys.filter((p) => p !== clean),
    }))
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
    set((s) => ({
      mutedHashtags: s.mutedHashtags.filter((t) => t !== clean),
      privateMutedHashtags: s.privateMutedHashtags.filter((t) => t !== clean),
    }))
    persist(get())
  },
  removeMutedWord: (word) => {
    const clean = word.trim().toLowerCase()
    set((s) => ({
      mutedWords: s.mutedWords.filter((w) => w !== clean),
      privateMutedWords: s.privateMutedWords.filter((w) => w !== clean),
    }))
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
  mergePrivateMutes: ({ pubkeys = [], hashtags = [], words = [] }) => {
    // SECURITY: Decrypted NIP-44 private mutes stay strictly in RAM — never persisted to localStorage.
    set((s) => ({
      privateMutedPubkeys: [
        ...new Set([
          ...s.privateMutedPubkeys,
          ...pubkeys.map((p) => p.toLowerCase()).filter(Boolean),
        ]),
      ],
      privateMutedHashtags: [
        ...new Set([
          ...s.privateMutedHashtags,
          ...hashtags.map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean),
        ]),
      ],
      privateMutedWords: [
        ...new Set([
          ...s.privateMutedWords,
          ...words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2),
        ]),
      ],
    }))
  },
  clearPrivateSessionMutes: () => {
    saveStoredNwc('', false)
    set({
      privateMutedPubkeys: [],
      privateMutedHashtags: [],
      privateMutedWords: [],
      nwcUri: '',
    })
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
  setShowLiveZaps: (showLiveZaps) => {
    set({ showLiveZaps })
    persist(get())
  },
  setSidebarFeedMode: (sidebarFeedMode) => {
    if (!VALID_SIDEBAR_FEED_MODES.includes(sidebarFeedMode)) return
    set({ sidebarFeedMode })
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
  setNwcUri: (nwcUri, remember) => {
    const clean = nwcUri.trim()
    const shouldRemember = remember !== undefined ? remember : get().nwcRememberDevice
    saveStoredNwc(clean, shouldRemember)
    set({ nwcUri: clean, nwcRememberDevice: shouldRemember })
  },
  setNwcRememberDevice: (remember) => {
    const currentUri = get().nwcUri
    if (currentUri) {
      saveStoredNwc(currentUri, remember)
    }
    set({ nwcRememberDevice: remember })
  },

  getReadRelays: () => get().relays.filter((r) => r.read).map((r) => r.url),
  getWriteRelays: () => get().relays.filter((r) => r.write).map((r) => r.url),
}))
