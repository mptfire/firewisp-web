import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
  type EventTemplate,
} from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from 'nostr-tools/nip46'
import { SimplePool } from 'nostr-tools/pool'
import { bytesToHex } from 'nostr-tools/utils'
import { FIREWISP_RELAY } from '../constants'

export type AuthMethod = 'nip07' | 'bunker' | 'local' | 'readonly'

export interface FireWispSigner {
  readonly method: AuthMethod
  readonly pubkey: string
  readonly canSign: boolean
  readonly canEncrypt: boolean
  signEvent(template: EventTemplate): Promise<Event>
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string>
  /** Only implemented by local signer for explicit user-initiated backup export */
  exportSecretKey?: () => Uint8Array
  destroy(): void
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: EventTemplate): Promise<Event>
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>
        decrypt(pubkey: string, ciphertext: string): Promise<string>
      }
      nip04?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>
        decrypt(pubkey: string, ciphertext: string): Promise<string>
      }
    }
    webln?: {
      enable(): Promise<void>
      sendPayment(paymentRequest: string): Promise<{ preimage: string }>
    }
  }
}

export class LocalKeySigner implements FireWispSigner {
  readonly method: AuthMethod = 'local'
  readonly pubkey: string
  readonly canSign = true
  readonly canEncrypt = true
  private privkey: Uint8Array
  private destroyed = false

  constructor(privkey: Uint8Array) {
    // Copy defensively so caller wiping its buffer doesn't corrupt signer state.
    this.privkey = new Uint8Array(privkey)
    this.pubkey = getPublicKey(this.privkey)
  }

  private assertAlive() {
    if (this.destroyed) throw new Error('Signer has been logged out and wiped')
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    this.assertAlive()
    return finalizeEvent(template, this.privkey)
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    this.assertAlive()
    const key = nip44.v2.utils.getConversationKey(this.privkey, peerPubkey)
    return nip44.v2.encrypt(plaintext, key)
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    this.assertAlive()
    const key = nip44.v2.utils.getConversationKey(this.privkey, peerPubkey)
    return nip44.v2.decrypt(ciphertext, key)
  }

  exportSecretKey(): Uint8Array {
    this.assertAlive()
    return new Uint8Array(this.privkey)
  }

  destroy(): void {
    this.privkey.fill(0)
    this.destroyed = true
  }
}

export class Nip07Signer implements FireWispSigner {
  readonly method: AuthMethod = 'nip07'
  readonly pubkey: string
  readonly canSign = true
  readonly canEncrypt: boolean

  constructor(pubkey: string) {
    this.pubkey = pubkey
    this.canEncrypt = Boolean(window.nostr?.nip44)
  }

  static async connect(): Promise<Nip07Signer> {
    if (!window.nostr) {
      throw new Error('No Nostr browser extension (NIP-07) detected. Install Alby, nos2x, or Flamingo.')
    }
    const pubkey = await window.nostr.getPublicKey()
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) {
      throw new Error('Extension returned an invalid public key')
    }
    return new Nip07Signer(pubkey.toLowerCase())
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    if (!window.nostr) throw new Error('NIP-07 extension unavailable')
    return window.nostr.signEvent(template)
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    if (!window.nostr?.nip44) {
      throw new Error('Your browser extension does not support NIP-44 encryption')
    }
    return window.nostr.nip44.encrypt(peerPubkey, plaintext)
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    if (!window.nostr?.nip44) {
      throw new Error('Your browser extension does not support NIP-44 decryption')
    }
    return window.nostr.nip44.decrypt(peerPubkey, ciphertext)
  }

  destroy(): void {
    // Nothing local to wipe.
  }
}

export class ReadOnlySigner implements FireWispSigner {
  readonly method: AuthMethod = 'readonly'
  readonly pubkey: string
  readonly canSign = false
  readonly canEncrypt = false

  constructor(pubkey: string) {
    this.pubkey = pubkey.toLowerCase()
  }

  async signEvent(): Promise<Event> {
    throw new Error('Watch-only mode cannot sign events. Sign in with NIP-07, Bunker, or your key.')
  }

  async nip44Encrypt(): Promise<string> {
    throw new Error('Watch-only mode cannot encrypt DMs.')
  }

  async nip44Decrypt(): Promise<string> {
    throw new Error('Watch-only mode cannot decrypt DMs.')
  }

  destroy(): void {}
}

export class Nip46BunkerSigner implements FireWispSigner {
  readonly method: AuthMethod = 'bunker'
  readonly pubkey: string
  readonly canSign = true
  readonly canEncrypt = true
  private bunker: BunkerSigner
  private clientSk: Uint8Array
  private pool: SimplePool

  private constructor(
    pubkey: string,
    bunker: BunkerSigner,
    clientSk: Uint8Array,
    pool: SimplePool,
  ) {
    this.pubkey = pubkey.toLowerCase()
    this.bunker = bunker
    this.clientSk = clientSk
    this.pool = pool
  }

  static async connectWithUri(bunkerUri: string): Promise<{
    signer: Nip46BunkerSigner
    bunkerUri: string
  }> {
    const bp = await parseBunkerInput(bunkerUri.trim())
    if (!bp) {
      throw new Error('Invalid bunker:// URI or NIP-05 bunker address')
    }
    const clientSk = generateSecretKey()
    const pool = new SimplePool()
    const bunker = BunkerSigner.fromBunker(clientSk, bp, { pool })
    await bunker.connect()
    const pubkey = await bunker.getPublicKey()
    return {
      signer: new Nip46BunkerSigner(pubkey, bunker, clientSk, pool),
      bunkerUri: bunkerUri.trim(),
    }
  }

  static createQrSession(): {
    uri: string
    waitForConnection: (signal?: AbortSignal) => Promise<Nip46BunkerSigner>
    cancel: () => void
  } {
    const clientSk = generateSecretKey()
    const clientPubkey = getPublicKey(clientSk)
    const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
    const relays = [FIREWISP_RELAY, 'wss://relay.nsec.app', 'wss://relay.damus.io']
    const uri = createNostrConnectURI({
      clientPubkey,
      relays,
      secret,
      name: 'Fire Wisp Web',
      url: 'https://firewisp.rtard.de',
      image: 'https://firewisp.rtard.de/firewisp-logo.png',
    })
    const pool = new SimplePool()
    let cancelled = false

    const cancel = () => {
      cancelled = true
      clientSk.fill(0)
      pool.close(relays)
    }

    const waitForConnection = async (signal?: AbortSignal): Promise<Nip46BunkerSigner> => {
      if (signal) {
        signal.addEventListener('abort', cancel, { once: true })
      }
      const bunker = await BunkerSigner.fromURI(clientSk, uri, { pool })
      if (cancelled) {
        await bunker.close().catch(() => {})
        throw new DOMException('Cancelled', 'AbortError')
      }
      const pubkey = await bunker.getPublicKey()
      return new Nip46BunkerSigner(pubkey, bunker, clientSk, pool)
    }

    return { uri, waitForConnection, cancel }
  }

  async signEvent(template: EventTemplate): Promise<Event> {
    return this.bunker.signEvent(template)
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return this.bunker.nip44Encrypt(peerPubkey, plaintext)
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return this.bunker.nip44Decrypt(peerPubkey, ciphertext)
  }

  destroy(): void {
    this.bunker.close().catch(() => {})
    this.clientSk.fill(0)
    try {
      this.pool.destroy()
    } catch {
      // ignore
    }
  }
}
