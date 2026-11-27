import { create } from 'zustand'
import {
  DEFAULT_BLOSSOM_SERVERS,
  DEFAULT_NOTE_POW_BITS,
  DEFAULT_REACTION_POW_BITS,
  DEFAULT_RELAYS,
  FIREWISP_RELAY,
  LEGACY_FIREWISP_RELAY,
  type RelayEntry,
} from '../constants'
import { sanitizeBlossomUrl, sanitizeRelayUrl } from '../sanitize'
import { isAppStateDTag, isListFeedKey, type ListFeedKey } from '../nostr/followSets'
import {
  isInterestFeedKey,
  isRelaySetFeedKey,
  type InterestFeedKey,
  type RelaySetFeedKey,
} from '../nostr/nip51Sets'

const STORAGE_KEY = 'firewisp_settings_v1'
const NWC_STORAGE_KEY = 'firewisp_nwc_v1'

export type BuiltinSidebarFeedMode = 'trending' | 'zapped' | 'extended' | 'global' | 'firewisp'
export type SidebarFeedMode =
  | BuiltinSidebarFeedMode
  | ListFeedKey
  | InterestFeedKey
  | RelaySetFeedKey
const VALID_SIDEBAR_FEED_MODES: readonly BuiltinSidebarFeedMode[] = [
  'trending',
  'zapped',
  'extended',
  'global',
  'firewisp',
]

function isValidSidebarFeedMode(mode: unknown): mode is SidebarFeedMode {
  return (
    (typeof mode === 'string' &&
      (VALID_SIDEBAR_FEED_MODES as readonly string[]).includes(mode)) ||
    isListFeedKey(mode) ||
    isInterestFeedKey(mode) ||
    isRelaySetFeedKey(mode)
  )
}

function isValidPinnedTabKey(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const clean = raw.trim()
  if (!clean) return false
  if (isInterestFeedKey(clean) || isRelaySetFeedKey(clean)) return true
  return !clean.includes(':') && !isAppStateDTag(clean)
}

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
  showZappedTab: boolean
  forYouIncludeTopics: boolean
  forYouIncludeWotZapped: boolean
  forYouIncludeTrending: boolean
  showLiveNowBar: boolean
  liveBarExpanded: boolean
  showLiveZaps: boolean
  showWisps: boolean
  showGlobalAudio: boolean
  showBookmarksNav: boolean
  sidebarFeedMode: SidebarFeedMode
  pinnedListTabs: string[]
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  mobileDataSaving: boolean
  mediaVolume: number
  mediaMuted: boolean
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
  addMutedWord: (word: string) => void
  removeMutedWord: (word: string) => void
  mergeRemoteMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void
  mergePrivateMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void
  setPrivateMutes: (mutes: { pubkeys: string[]; hashtags: string[]; words: string[] }) => void
  addPrivateMute: (type: 'p' | 't' | 'word', value: string) => void
  removeLocalMutes: (mutes: { pubkeys?: string[]; hashtags?: string[]; words?: string[] }) => void
  clearPrivateSessionMutes: () => void

  setDmAutoLoadMedia: (enabled: boolean) => void
  setClientTagEnabled: (enabled: boolean) => void
  setSpamFilterEnabled: (enabled: boolean) => void
  setHideRepliesInExplore: (enabled: boolean) => void
  setRequirePowInExplore: (enabled: boolean) => void
  setShowFireWispTab: (enabled: boolean) => void
  setShowExtendedTab: (enabled: boolean) => void
  setShowExploreTab: (enabled: boolean) => void
  setShowZappedTab: (enabled: boolean) => void
  setForYouIncludeTopics: (enabled: boolean) => void
  setForYouIncludeWotZapped: (enabled: boolean) => void
  setForYouIncludeTrending: (enabled: boolean) => void
  setShowLiveNowBar: (enabled: boolean) => void
  setLiveBarExpanded: (expanded: boolean) => void
  setShowLiveZaps: (enabled: boolean) => void
  setShowWisps: (enabled: boolean) => void
  setShowGlobalAudio: (enabled: boolean) => void
  setShowBookmarksNav: (enabled: boolean) => void
  setSidebarFeedMode: (mode: SidebarFeedMode) => void
  togglePinnedListTab: (dTag: string) => void
  unpinListTab: (dTag: string) => void
  setHoverStreamPreview: (enabled: boolean) => void
  setInlineMediaPlayback: (enabled: boolean) => void
  setMobileDataSaving: (enabled: boolean) => void
  setMediaVolume: (volume: number) => void
  setMediaMuted: (muted: boolean) => void
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
  showZappedTab: boolean
  forYouIncludeTopics: boolean
  forYouIncludeWotZapped: boolean
  forYouIncludeTrending: boolean
  showLiveNowBar: boolean
  liveBarExpanded: boolean
  showLiveZaps: boolean
  showWisps: boolean
  showGlobalAudio: boolean
  showBookmarksNav: boolean
  sidebarFeedMode: SidebarFeedMode
  pinnedListTabs: string[]
  hoverStreamPreview: boolean
  inlineMediaPlayback: boolean
  mobileDataSaving: boolean
  mediaVolume: number
  mediaMuted: boolean
  // SECURITY: privateMuted* stays strictly in RAM; nwcUri is session-only unless user opts into "Remember on this device".
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
    showZappedTab: false,
    forYouIncludeTopics: false,
    forYouIncludeWotZapped: true,
    forYouIncludeTrending: true,
    showLiveNowBar: true,
    liveBarExpanded: true,
    showLiveZaps: false,
    showWisps: true,
    showGlobalAudio: true,
    showBookmarksNav: false,
    sidebarFeedMode: 'trending',
    pinnedListTabs: [],
    hoverStreamPreview: true,
    inlineMediaPlayback: true,
    mobileDataSaving: false,
    mediaVolume: 0.85,
    mediaMuted: false,
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

    const sanitizedRelays = (() => {
      if (!Array.isArray(parsed.relays) || parsed.relays.length === 0) return DEFAULT_RELAYS
      const map = new Map<string, RelayEntry>()
      for (const r of parsed.relays) {
        const rawUrl = sanitizeRelayUrl(r?.url)
        if (!rawUrl) continue
        // Migrate legacy firewisp.relay.rtard.de to canonical wss://relay.firewisp.de without duplicating
        const url = rawUrl === LEGACY_FIREWISP_RELAY ? FIREWISP_RELAY : rawUrl
        const existing = map.get(url)
        if (existing) {
          existing.read = existing.read || Boolean(r.read)
          existing.write = existing.write || Boolean(r.write)
        } else {
          map.set(url, { url, read: Boolean(r.read), write: Boolean(r.write) })
        }
      }
      return map.size > 0 ? [...map.values()] : DEFAULT_RELAYS
    })()

    const sidebarFeedMode: SidebarFeedMode = isValidSidebarFeedMode(parsed.sidebarFeedMode)
      ? parsed.sidebarFeedMode
      : 'trending'

    const pinnedListTabs: string[] = Array.isArray(parsed.pinnedListTabs)
      ? [
          ...new Set(
            parsed.pinnedListTabs
              .filter((d): d is string => isValidPinnedTabKey(d))
              .map((d) => d.trim()),
          ),
        ].slice(0, 12)
      : []

    const mediaVolume =
      typeof parsed.mediaVolume === 'number' && Number.isFinite(parsed.mediaVolume)
        ? Math.min(2, Math.max(0, parsed.mediaVolume))
        : defaults.mediaVolume
    const mediaMuted =
      typeof parsed.mediaMuted === 'boolean' ? parsed.mediaMuted : defaults.mediaMuted

    const merged = {
      ...defaults,
      ...parsed,
      relays: sanitizedRelays.length > 0 ? sanitizedRelays : DEFAULT_RELAYS,
      blossomServers,
      sidebarFeedMode,
      pinnedListTabs,
      mediaVolume,
      mediaMuted,
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
    showZappedTab: state.showZappedTab,
    forYouIncludeTopics: state.forYouIncludeTopics,
    forYouIncludeWotZapped: state.forYouIncludeWotZapped,
    forYouIncludeTrending: state.forYouIncludeTrending,
    showLiveNowBar: state.showLiveNowBar,
    liveBarExpanded: state.liveBarExpanded,
    showLiveZaps: state.showLiveZaps,
    showWisps: state.showWisps,
    showGlobalAudio: state.showGlobalAudio,
    showBookmarksNav: state.showBookmarksNav,
    sidebarFeedMode: state.sidebarFeedMode,
    pinnedListTabs: state.pinnedListTabs,
    hoverStreamPreview: state.hoverStreamPreview,
    inlineMediaPlayback: state.inlineMediaPlayback,
    mobileDataSaving: state.mobileDataSaving,
    mediaVolume: state.mediaVolume,
    mediaMuted: state.mediaMuted,
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
  addMutedWord: (word) => {
    const clean = word.trim().toLowerCase()
    if (clean.length < 2) return
    set((s) => ({
      mutedWords: s.mutedWords.includes(clean)
        ? s.mutedWords
        : [...s.mutedWords, clean],
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
  setPrivateMutes: ({ pubkeys, hashtags, words }) => {
    // SECURITY: Replaces RAM-only snapshot from authoritative decrypted Nostr kind-10000.
    set({
      privateMutedPubkeys: [...new Set(pubkeys.map((p) => p.toLowerCase()).filter(Boolean))],
      privateMutedHashtags: [
        ...new Set(hashtags.map((t) => t.trim().toLowerCase().replace(/^#+/, '')).filter(Boolean)),
      ],
      privateMutedWords: [
        ...new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2)),
      ],
    })
  },
  addPrivateMute: (type, value) => {
    // Optimistically hide in RAM while Nostr kind-10000 publish completes (never written to localStorage).
    if (type === 'p') {
      const clean = value.trim().toLowerCase()
      if (!clean) return
      set((s) => ({
        privateMutedPubkeys: s.privateMutedPubkeys.includes(clean)
          ? s.privateMutedPubkeys
          : [...s.privateMutedPubkeys, clean],
      }))
    } else if (type === 't') {
      const clean = value.trim().toLowerCase().replace(/^#+/, '')
      if (!clean) return
      set((s) => ({
        privateMutedHashtags: s.privateMutedHashtags.includes(clean)
          ? s.privateMutedHashtags
          : [...s.privateMutedHashtags, clean],
      }))
    } else {
      const clean = value.trim().toLowerCase()
      if (clean.length < 2) return
      set((s) => ({
        privateMutedWords: s.privateMutedWords.includes(clean)
          ? s.privateMutedWords
          : [...s.privateMutedWords, clean],
      }))
    }
  },
  removeLocalMutes: ({ pubkeys = [], hashtags = [], words = [] }) => {
    const pkSet = new Set(pubkeys.map((p) => p.toLowerCase()))
    const tagSet = new Set(hashtags.map((t) => t.trim().toLowerCase().replace(/^#+/, '')))
    const wordSet = new Set(words.map((w) => w.trim().toLowerCase()))
    set((s) => ({
      mutedPubkeys: pkSet.size > 0 ? s.mutedPubkeys.filter((p) => !pkSet.has(p)) : s.mutedPubkeys,
      mutedHashtags:
        tagSet.size > 0 ? s.mutedHashtags.filter((t) => !tagSet.has(t)) : s.mutedHashtags,
      mutedWords: wordSet.size > 0 ? s.mutedWords.filter((w) => !wordSet.has(w)) : s.mutedWords,
    }))
    persist(get())
  },
  clearPrivateSessionMutes: () => {
    set({
      privateMutedPubkeys: [],
      privateMutedHashtags: [],
      privateMutedWords: [],
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
  setShowZappedTab: (showZappedTab) => {
    set({ showZappedTab })
    persist(get())
  },
  setForYouIncludeTopics: (forYouIncludeTopics) => {
    set({ forYouIncludeTopics })
    persist(get())
  },
  setForYouIncludeWotZapped: (forYouIncludeWotZapped) => {
    set({ forYouIncludeWotZapped })
    persist(get())
  },
  setForYouIncludeTrending: (forYouIncludeTrending) => {
    set({ forYouIncludeTrending })
    persist(get())
  },
  setShowLiveNowBar: (showLiveNowBar) => {
    set({ showLiveNowBar })
    persist(get())
  },
  setLiveBarExpanded: (liveBarExpanded) => {
    set({ liveBarExpanded })
    persist(get())
  },
  setShowLiveZaps: (showLiveZaps) => {
    set({ showLiveZaps })
    persist(get())
  },
  setShowWisps: (showWisps) => {
    set({ showWisps })
    persist(get())
  },
  setShowGlobalAudio: (showGlobalAudio) => {
    set({ showGlobalAudio })
    persist(get())
  },
  setShowBookmarksNav: (showBookmarksNav) => {
    set({ showBookmarksNav })
    persist(get())
  },
  setSidebarFeedMode: (sidebarFeedMode) => {
    if (!isValidSidebarFeedMode(sidebarFeedMode)) return
    set({ sidebarFeedMode })
    persist(get())
  },
  togglePinnedListTab: (rawDTag) => {
    const clean = rawDTag.trim()
    if (!isValidPinnedTabKey(clean)) return
    const cur = get().pinnedListTabs
    const next = cur.includes(clean)
      ? cur.filter((d) => d !== clean)
      : [...cur, clean].slice(0, 12)
    set({ pinnedListTabs: next })
    persist(get())
  },
  unpinListTab: (rawDTag) => {
    const clean = rawDTag.trim()
    if (!clean) return
    const cur = get().pinnedListTabs
    if (!cur.includes(clean)) return
    set({ pinnedListTabs: cur.filter((d) => d !== clean) })
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
  setMobileDataSaving: (mobileDataSaving) => {
    set({ mobileDataSaving })
    persist(get())
  },
  setMediaVolume: (rawVolume) => {
    const mediaVolume = Number.isFinite(rawVolume)
      ? Math.round(Math.min(2, Math.max(0, rawVolume)) * 100) / 100
      : 0.85
    set({ mediaVolume })
    persist(get())
  },
  setMediaMuted: (mediaMuted) => {
    set({ mediaMuted })
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
