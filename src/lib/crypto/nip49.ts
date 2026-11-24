import * as nip49 from 'nostr-tools/nip49'
import { bech32 } from '@scure/base'
import { NIP49_MAX_LOG_N, NIP49_MIN_LOG_N } from '../constants'

export function isNcryptsec(input: string): boolean {
  return input.trim().toLowerCase().startsWith('ncryptsec1')
}

/**
 * Inspects the NIP-49 header before calling scrypt so a malicious ncryptsec with a huge
 * log_n parameter cannot freeze or OOM the browser tab.
 */
export function inspectNcryptsecLogN(ncryptsec: string): number {
  const decoded = bech32.decodeToBytes(ncryptsec.trim().toLowerCase())
  if (decoded.prefix !== 'ncryptsec') {
    throw new Error('Invalid ncryptsec prefix')
  }
  const data = decoded.bytes
  if (data.length !== 91) {
    throw new Error('Invalid ncryptsec payload length')
  }
  const version = data[0]
  if (version !== 0x02) {
    throw new Error(`Unsupported NIP-49 version: ${version}`)
  }
  return data[1]
}

export function decryptNcryptsec(ncryptsec: string, password: string): Uint8Array {
  const trimmed = ncryptsec.trim()
  if (!isNcryptsec(trimmed)) {
    throw new Error('Not a valid ncryptsec1 string')
  }
  if (!password) {
    throw new Error('Passphrase is required')
  }
  const logN = inspectNcryptsecLogN(trimmed)
  if (logN < NIP49_MIN_LOG_N || logN > NIP49_MAX_LOG_N) {
    throw new Error(
      `Refusing scrypt log_n=${logN} (safe bounds: ${NIP49_MIN_LOG_N}..${NIP49_MAX_LOG_N})`,
    )
  }
  return nip49.decrypt(trimmed, password)
}

export function encryptNcryptsec(
  privkey: Uint8Array,
  password: string,
  logN = 16,
  keySecurityByte: 0x00 | 0x01 | 0x02 = 0x02,
): string {
  if (!password || password.length < 4) {
    throw new Error('Passphrase must be at least 4 characters')
  }
  if (logN < NIP49_MIN_LOG_N || logN > NIP49_MAX_LOG_N) {
    throw new Error(`log_n must be between ${NIP49_MIN_LOG_N} and ${NIP49_MAX_LOG_N}`)
  }
  return nip49.encrypt(privkey, password, logN, keySecurityByte)
}
