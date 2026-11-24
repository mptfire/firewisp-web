import { create } from 'zustand'
import * as nip19 from 'nostr-tools/nip19'
import { hexToBytes } from 'nostr-tools/utils'
import {
  LocalKeySigner,
  Nip07Signer,
  Nip46BunkerSigner,
  ReadOnlySigner,
  type AuthMethod,
  type FireWispSigner,
} from '../nostr/signer'
import { createNewMnemonic, derivePrivkeyFromMnemonic, isLikelyMnemonic } from '../crypto/nip06'
import { decryptNcryptsec, encryptNcryptsec, isNcryptsec } from '../crypto/nip49'
import { isValidHex64 } from '../sanitize'
import { useSettingsStore } from './useSettingsStore'
import { useNostrStore } from './useNostrStore'

const SESSION_META_KEY = 'firewisp_auth_meta_v1'
const ENCRYPTED_VAULT_KEY = 'firewisp_ncryptsec_vault_v1'

interface StoredAuthMeta {
  method: 'nip07' | 'readonly' | 'vault'
  pubkey?: string
}

export interface AuthState {
  signer: FireWispSigner | null
  pubkey: string | null
  method: AuthMethod | null
  hasEncryptedVault: boolean
  pendingMnemonicBackup: string | null
  authModalOpen: boolean

  openAuthModal: () => void
  closeAuthModal: () => void

  restoreSession: () => Promise<void>
  loginWithNip07: () => Promise<void>
  loginWithBunkerUri: (uri: string) => Promise<void>
  attachBunkerSigner: (signer: Nip46BunkerSigner) => void
  loginWithKeyInput: (input: string, passphrase?: string) => Promise<void>
  unlockEncryptedVault: (passphrase: string) => Promise<void>
  saveEncryptedVault: (passphrase: string) => string
  clearEncryptedVault: () => void
  createNewAccount: () => string
  confirmAccountBackup: () => void
  exportNcryptsec: (passphrase: string) => string
  logout: () => void
}

function readMeta(): StoredAuthMeta | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_META_KEY)
    return raw ? (JSON.parse(raw) as StoredAuthMeta) : null
  } catch {
    return null
  }
}

function writeMeta(meta: StoredAuthMeta | null) {
  if (typeof localStorage === 'undefined') return
  if (!meta) {
    localStorage.removeItem(SESSION_META_KEY)
  } else {
    localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta))
  }
}

function hasVault(): boolean {
  if (typeof localStorage === 'undefined') return false
  return Boolean(localStorage.getItem(ENCRYPTED_VAULT_KEY))
}

export const useAuthStore = create<AuthState>((set, get) => ({
  signer: null,
  pubkey: null,
  method: null,
  hasEncryptedVault: hasVault(),
  pendingMnemonicBackup: null,
  authModalOpen: false,

  openAuthModal: () => set({ authModalOpen: true }),
  closeAuthModal: () => set({ authModalOpen: false }),

  restoreSession: async () => {
    const meta = readMeta()
    if (!meta) return
    if (meta.method === 'readonly' && meta.pubkey && isValidHex64(meta.pubkey)) {
      const signer = new ReadOnlySigner(meta.pubkey)
      set({ signer, pubkey: signer.pubkey, method: 'readonly' })
      return
    }
    if (meta.method === 'nip07' && typeof window !== 'undefined' && window.nostr) {
      try {
        const signer = await Nip07Signer.connect()
        set({ signer, pubkey: signer.pubkey, method: 'nip07' })
      } catch {
        // Extension locked or unavailable; stay browse-only until user signs in.
      }
    }
  },

  loginWithNip07: async () => {
    const prev = get().signer
    const signer = await Nip07Signer.connect()
    prev?.destroy()
    writeMeta({ method: 'nip07', pubkey: signer.pubkey })
    set({
      signer,
      pubkey: signer.pubkey,
      method: 'nip07',
      pendingMnemonicBackup: null,
      authModalOpen: false,
    })
  },

  loginWithBunkerUri: async (uri: string) => {
    const prev = get().signer
    const { signer } = await Nip46BunkerSigner.connectWithUri(uri)
    prev?.destroy()
    writeMeta(null)
    set({
      signer,
      pubkey: signer.pubkey,
      method: 'bunker',
      pendingMnemonicBackup: null,
      authModalOpen: false,
    })
  },

  attachBunkerSigner: (signer: Nip46BunkerSigner) => {
    get().signer?.destroy()
    writeMeta(null)
    set({
      signer,
      pubkey: signer.pubkey,
      method: 'bunker',
      pendingMnemonicBackup: null,
      authModalOpen: false,
    })
  },

  loginWithKeyInput: async (rawInput: string, passphrase = '') => {
    const trimmed = rawInput.trim()
    if (!trimmed) throw new Error('Enter a key, recovery phrase, or npub')

    const lower = trimmed.toLowerCase()

    // 1. NIP-49 ncryptsec
    if (isNcryptsec(trimmed)) {
      const priv = decryptNcryptsec(trimmed, passphrase)
      try {
        const signer = new LocalKeySigner(priv)
        get().signer?.destroy()
        writeMeta(null)
        set({
          signer,
          pubkey: signer.pubkey,
          method: 'local',
          pendingMnemonicBackup: null,
          authModalOpen: false,
        })
      } finally {
        priv.fill(0)
      }
      return
    }

    // 2. NIP-06 12/24-word mnemonic
    if (isLikelyMnemonic(trimmed)) {
      const priv = derivePrivkeyFromMnemonic(trimmed, passphrase)
      try {
        const signer = new LocalKeySigner(priv)
        get().signer?.destroy()
        writeMeta(null)
        set({
          signer,
          pubkey: signer.pubkey,
          method: 'local',
          pendingMnemonicBackup: null,
          authModalOpen: false,
        })
      } finally {
        priv.fill(0)
      }
      return
    }

    // 3. nsec1...
    if (lower.startsWith('nsec1')) {
      const decoded = nip19.decode(lower)
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec key')
      const priv = new Uint8Array(decoded.data)
      try {
        const signer = new LocalKeySigner(priv)
        get().signer?.destroy()
        writeMeta(null)
        set({
          signer,
          pubkey: signer.pubkey,
          method: 'local',
          pendingMnemonicBackup: null,
          authModalOpen: false,
        })
      } finally {
        priv.fill(0)
      }
      return
    }

    // 4. npub1... watch-only
    if (lower.startsWith('npub1')) {
      const decoded = nip19.decode(lower)
      if (decoded.type !== 'npub') throw new Error('Invalid npub')
      const signer = new ReadOnlySigner(decoded.data)
      get().signer?.destroy()
      writeMeta({ method: 'readonly', pubkey: signer.pubkey })
      set({
        signer,
        pubkey: signer.pubkey,
        method: 'readonly',
        pendingMnemonicBackup: null,
        authModalOpen: false,
      })
      return
    }

    // 5. 64-char hex pubkey (watch-only)
    if (isValidHex64(lower)) {
      const signer = new ReadOnlySigner(lower)
      get().signer?.destroy()
      writeMeta({ method: 'readonly', pubkey: signer.pubkey })
      set({
        signer,
        pubkey: signer.pubkey,
        method: 'readonly',
        pendingMnemonicBackup: null,
        authModalOpen: false,
      })
      return
    }

    // 6. Optional hex secret only if explicitly prefixed with hexsec:
    if (lower.startsWith('hexsec:') && isValidHex64(lower.slice(7))) {
      const priv = hexToBytes(lower.slice(7))
      try {
        const signer = new LocalKeySigner(priv)
        get().signer?.destroy()
        writeMeta(null)
        set({
          signer,
          pubkey: signer.pubkey,
          method: 'local',
          pendingMnemonicBackup: null,
          authModalOpen: false,
        })
      } finally {
        priv.fill(0)
      }
      return
    }

    throw new Error(
      'Unrecognized input. Enter an ncryptsec1, 12/24-word recovery phrase, nsec1, npub1, or 64-character hex pubkey.',
    )
  },

  unlockEncryptedVault: async (passphrase: string) => {
    const encrypted = localStorage.getItem(ENCRYPTED_VAULT_KEY)
    if (!encrypted) throw new Error('No saved encrypted vault found in this browser')
    await get().loginWithKeyInput(encrypted, passphrase)
  },

  saveEncryptedVault: (passphrase: string) => {
    const ncryptsec = get().exportNcryptsec(passphrase)
    localStorage.setItem(ENCRYPTED_VAULT_KEY, ncryptsec)
    writeMeta({ method: 'vault', pubkey: get().pubkey || undefined })
    set({ hasEncryptedVault: true })
    return ncryptsec
  },

  clearEncryptedVault: () => {
    localStorage.removeItem(ENCRYPTED_VAULT_KEY)
    set({ hasEncryptedVault: false })
  },

  createNewAccount: () => {
    const mnemonic = createNewMnemonic(128)
    const priv = derivePrivkeyFromMnemonic(mnemonic)
    try {
      const signer = new LocalKeySigner(priv)
      get().signer?.destroy()
      writeMeta(null)
      set({
        signer,
        pubkey: signer.pubkey,
        method: 'local',
        pendingMnemonicBackup: mnemonic,
      })
      return mnemonic
    } finally {
      priv.fill(0)
    }
  },

  confirmAccountBackup: () => {
    set({ pendingMnemonicBackup: null, authModalOpen: false })
  },

  exportNcryptsec: (passphrase: string) => {
    const signer = get().signer
    if (!signer?.exportSecretKey) {
      throw new Error('Encrypted key export is only available for locally unlocked accounts')
    }
    const priv = signer.exportSecretKey()
    try {
      return encryptNcryptsec(priv, passphrase)
    } finally {
      priv.fill(0)
    }
  },

  logout: () => {
    get().signer?.destroy()
    useSettingsStore.getState().setNwcUri('')
    useNostrStore.getState().resetUserState()
    writeMeta(null)
    set({
      signer: null,
      pubkey: null,
      method: null,
      pendingMnemonicBackup: null,
    })
  },
}))
