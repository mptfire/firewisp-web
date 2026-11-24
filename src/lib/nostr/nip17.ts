import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  verifyEvent,
  type Event,
  type UnsignedEvent,
} from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import type { FireWispSigner } from './signer'

export const KIND_DM_RUMOR = 14
export const KIND_SEAL = 13
export const KIND_GIFT_WRAP = 1059
export const KIND_DM_RELAYS = 10050

export interface DecryptedDm {
  id: string
  wrapId: string
  senderPubkey: string
  recipientPubkey: string
  peerPubkey: string
  content: string
  createdAt: number
  sealVerified: true
}

function randomPastTimestamp(): number {
  const now = Math.floor(Date.now() / 1000)
  // Cryptographically random jitter up to 2 days in the past per NIP-59 metadata protection
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const jitter = buf[0] % 172800
  return now - jitter
}

/**
 * Unwraps a NIP-59/NIP-17 gift wrap (kind 1059) with STRICT seal authentication:
 * 1. Verifies gift-wrap signature.
 * 2. Decrypts seal (kind 13) and verifies seal signature & kind === 13.
 * 3. Decrypts rumor (kind 14) and REQUIRES `rumor.pubkey === seal.pubkey` (prevents author spoofing,
 *    matching Fire Wisp Android #675).
 */
export async function unwrapGiftWrap(
  wrap: Event,
  signer: FireWispSigner,
): Promise<DecryptedDm | null> {
  if (wrap.kind !== KIND_GIFT_WRAP) return null
  if (!verifyEvent(wrap)) return null

  const sealJson = await signer.nip44Decrypt(wrap.pubkey, wrap.content)
  let seal: Event
  try {
    seal = JSON.parse(sealJson) as Event
  } catch {
    return null
  }

  if (seal.kind !== KIND_SEAL) return null
  if (!verifyEvent(seal)) return null

  const rumorJson = await signer.nip44Decrypt(seal.pubkey, seal.content)
  let rumor: UnsignedEvent & { id?: string }
  try {
    rumor = JSON.parse(rumorJson) as UnsignedEvent & { id?: string }
  } catch {
    return null
  }

  if (rumor.kind !== KIND_DM_RUMOR) return null

  // CRITICAL: Bind rumor author strictly to the authenticated seal signer.
  if (
    !rumor.pubkey ||
    rumor.pubkey.toLowerCase() !== seal.pubkey.toLowerCase()
  ) {
    return null
  }

  const pTag = rumor.tags?.find((t) => t[0] === 'p' && t[1])?.[1]?.toLowerCase()
  if (!pTag) return null

  const myPubkey = signer.pubkey.toLowerCase()
  const sender = seal.pubkey.toLowerCase()
  const peerPubkey = sender === myPubkey ? pTag : sender

  return {
    id: rumor.id || getEventHash(rumor),
    wrapId: wrap.id,
    senderPubkey: sender,
    recipientPubkey: pTag,
    peerPubkey,
    content: rumor.content || '',
    createdAt: rumor.created_at,
    sealVerified: true,
  }
}

/**
 * Wraps a NIP-17 DM rumor into two kind-1059 gift wraps:
 * one addressed to the recipient, and a self-copy addressed to the sender so sent DMs sync across devices.
 */
export async function createGiftWrappedDm(
  signer: FireWispSigner,
  recipientPubkey: string,
  plaintext: string,
): Promise<{ recipientWrap: Event; selfWrap: Event; dm: DecryptedDm }> {
  const now = Math.floor(Date.now() / 1000)
  const sender = signer.pubkey.toLowerCase()
  const recipient = recipientPubkey.toLowerCase()

  const rumor: UnsignedEvent = {
    kind: KIND_DM_RUMOR,
    pubkey: sender,
    created_at: now,
    tags: [['p', recipient]],
    content: plaintext,
  }
  const rumorId = getEventHash(rumor)
  const rumorWithId = { ...rumor, id: rumorId }
  const rumorStr = JSON.stringify(rumorWithId)

  const makeWrapFor = async (targetPubkey: string): Promise<Event> => {
    const encryptedRumor = await signer.nip44Encrypt(targetPubkey, rumorStr)
    const seal = await signer.signEvent({
      kind: KIND_SEAL,
      created_at: randomPastTimestamp(),
      tags: [],
      content: encryptedRumor,
    })

    const ephemeralSk = generateSecretKey()
    try {
      const convKey = nip44.v2.utils.getConversationKey(ephemeralSk, targetPubkey)
      const encryptedSeal = nip44.v2.encrypt(JSON.stringify(seal), convKey)
      return finalizeEvent(
        {
          kind: KIND_GIFT_WRAP,
          created_at: randomPastTimestamp(),
          tags: [['p', targetPubkey]],
          content: encryptedSeal,
        },
        ephemeralSk,
      )
    } finally {
      ephemeralSk.fill(0)
    }
  }

  const recipientWrap = await makeWrapFor(recipient)
  const selfWrap = await makeWrapFor(sender)

  return {
    recipientWrap,
    selfWrap,
    dm: {
      id: rumorId,
      wrapId: selfWrap.id,
      senderPubkey: sender,
      recipientPubkey: recipient,
      peerPubkey: recipient,
      content: plaintext,
      createdAt: now,
      sealVerified: true,
    },
  }
}
