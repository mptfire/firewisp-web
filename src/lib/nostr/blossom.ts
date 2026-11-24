import { bytesToHex } from 'nostr-tools/utils'
import type { FireWispSigner } from './signer'
import {
  DEFAULT_BLOSSOM_FALLBACK,
  DEFAULT_BLOSSOM_PRIMARY,
  MAX_BLOSSOM_UPLOAD_BYTES,
} from '../constants'
import { sanitizeBlossomUrl, sanitizeHttpUrl } from '../sanitize'

export const KIND_BLOSSOM_AUTH = 24242
export const KIND_BLOSSOM_SERVER_LIST = 10063

export interface BlossomUploadResult {
  url: string
  sha256: string
  size: number
  type: string
  server: string
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  // Pass an ArrayBuffer copy so WebCrypto accepts it across strict TS DOM/Node types.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Builds a BUD-11 authorization header (`Nostr <base64-json>`).
 * Uses `t=media` for `/media` (BUD-05) and `t=upload` for `/upload` (BUD-02),
 * matching Fire Wisp Android #104.
 */
export async function buildBlossomAuthHeader(
  signer: FireWispSigner,
  action: 'upload' | 'media' | 'delete',
  fileSha256: string,
  description = 'Fire Wisp media upload',
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const signed = await signer.signEvent({
    kind: KIND_BLOSSOM_AUTH,
    created_at: now,
    content: description,
    tags: [
      ['t', action],
      ['x', fileSha256],
      ['expiration', String(now + 300)],
    ],
  })
  const json = JSON.stringify(signed)
  const encoded = btoa(unescape(encodeURIComponent(json)))
  return `Nostr ${encoded}`
}

export function buildCandidateServers(userServers: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...userServers, DEFAULT_BLOSSOM_PRIMARY, DEFAULT_BLOSSOM_FALLBACK]) {
    const clean = sanitizeBlossomUrl(raw)
    if (clean && !seen.has(clean)) {
      seen.add(clean)
      out.push(clean)
    }
  }
  return out
}

export async function uploadToBlossom(
  file: File | Blob,
  mimeType: string,
  signer: FireWispSigner,
  userServers: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<BlossomUploadResult> {
  if (file.size === 0) throw new Error('File is empty')
  if (file.size > MAX_BLOSSOM_UPLOAD_BYTES) {
    throw new Error('File exceeds the 10 MB upload limit')
  }

  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const candidates = buildCandidateServers(userServers)
  const isMediaEndpointEligible = mimeType.startsWith('image/') || mimeType.startsWith('video/')

  let lastError: Error = new Error('No Blossom servers available')

  for (const server of candidates) {
    // Try BUD-05 /media first for images/videos (strips EXIF on firewisp.blossom.rtard.de),
    // then fall back to BUD-02 /upload.
    const endpoints: Array<{ path: '/media' | '/upload'; action: 'media' | 'upload' }> =
      isMediaEndpointEligible
        ? [
            { path: '/media', action: 'media' },
            { path: '/upload', action: 'upload' },
          ]
        : [{ path: '/upload', action: 'upload' }]

    for (const ep of endpoints) {
      try {
        const auth = await buildBlossomAuthHeader(signer, ep.action, hash)
        const resp = await fetchImpl(`${server}${ep.path}`, {
          method: 'PUT',
          headers: {
            Authorization: auth,
            'Content-Type': mimeType || 'application/octet-stream',
          },
          body: buffer,
        })
        if (!resp.ok) {
          const reason = resp.headers.get('X-Reason') || resp.statusText || `HTTP ${resp.status}`
          lastError = new Error(`${server}${ep.path}: ${reason}`)
          continue
        }

        const data = (await resp.json()) as {
          url?: string
          sha256?: string
          size?: number
          type?: string
        }
        const safeUrl = sanitizeHttpUrl(data.url)
        if (!safeUrl) {
          lastError = new Error(`${server} returned an unsafe or missing URL`)
          continue
        }

        // For raw /upload (untransformed), enforce SHA-256 descriptor match (fail-closed).
        // For /media (server-side EXIF stripping / transcoding), the returned hash may differ.
        const returnedHash = (data.sha256 || '').toLowerCase()
        if (ep.path === '/upload' && returnedHash && returnedHash !== hash) {
          lastError = new Error(`${server} returned mismatched SHA-256 descriptor`)
          continue
        }

        return {
          url: safeUrl,
          sha256: returnedHash || hash,
          size: typeof data.size === 'number' ? data.size : file.size,
          type: data.type || mimeType || 'application/octet-stream',
          server,
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
  }

  throw lastError
}

/**
 * Builds a NIP-92 `imeta` tag carrying URL, MIME type, SHA-256 hash, size, and optional alt text.
 */
export function buildImetaTag(upload: BlossomUploadResult, altText?: string): string[] {
  const tag = [
    'imeta',
    `url ${upload.url}`,
    `m ${upload.type}`,
    `x ${upload.sha256}`,
    `size ${upload.size}`,
  ]
  const cleanAlt = altText?.trim()
  if (cleanAlt) {
    tag.push(`alt ${cleanAlt}`)
  }
  return tag
}
