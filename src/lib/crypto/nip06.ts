import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { privateKeyFromSeedWords } from 'nostr-tools/nip06'

/**
 * Normalizes Unicode whitespace (NBSP, ideographic spaces, newlines, tabs) and lowercases.
 * Matches Fire Wisp Android's fail-closed BIP-39 hardening (#690).
 */
export function normalizeMnemonic(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\s]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function isLikelyMnemonic(raw: string): boolean {
  const words = normalizeMnemonic(raw).split(' ').filter(Boolean)
  return words.length === 12 || words.length === 24
}

export function validateBip39Mnemonic(raw: string): boolean {
  const normalized = normalizeMnemonic(raw)
  const words = normalized.split(' ').filter(Boolean)
  if (words.length !== 12 && words.length !== 24) return false
  if (wordlist.length !== 2048) return false
  return validateMnemonic(normalized, wordlist)
}

export function derivePrivkeyFromMnemonic(raw: string, passphrase = ''): Uint8Array {
  const normalized = normalizeMnemonic(raw)
  if (!validateBip39Mnemonic(normalized)) {
    throw new Error('Invalid 12- or 24-word BIP-39 recovery phrase (check spelling and checksum)')
  }
  return privateKeyFromSeedWords(normalized, passphrase)
}

export function createNewMnemonic(strength: 128 | 256 = 128): string {
  return generateMnemonic(wordlist, strength)
}
