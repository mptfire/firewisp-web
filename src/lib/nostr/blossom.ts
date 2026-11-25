import { bytesToHex } from 'nostr-tools/utils'
import type { FireWispSigner } from './signer'
import {
  DEFAULT_BLOSSOM_FALLBACK,
  DEFAULT_BLOSSOM_PRIMARY,
  MAX_BLOSSOM_UPLOAD_BYTES,
} from '../constants'
import { isValidHex64, sanitizeBlossomUrl, sanitizePublicHttpsUrl } from '../sanitize'

export const KIND_BLOSSOM_AUTH = 24242
export const KIND_BLOSSOM_SERVER_LIST = 10063

export interface BlossomUploadResult {
  url: string
  sha256: string
  size: number
  type: string
  server: string
}

export interface BlossomUploadProgress {
  server: string
  host: string
  endpoint: '/media' | '/upload'
}

export function formatBlossomHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname
  } catch {
    return serverUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  }
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

/**
 * Strips EXIF/GPS metadata client-side for JPEG/PNG/WebP images via offscreen canvas before upload,
 * so camera/location metadata never leaves the browser even if a Blossom server falls back to raw /upload.
 * Animated GIFs, videos, audio, and non-browser runtimes pass through cleanly untouched.
 */
export async function stripImageExifClientSide(
  file: File | Blob,
  mimeType: string,
): Promise<{ blob: Blob; mimeType: string }> {
  const cleanMime = mimeType.toLowerCase().split(';')[0].trim()
  if (
    cleanMime !== 'image/jpeg' &&
    cleanMime !== 'image/jpg' &&
    cleanMime !== 'image/png' &&
    cleanMime !== 'image/webp'
  ) {
    return { blob: file, mimeType }
  }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { blob: file, mimeType }
  }
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return { blob: file, mimeType }
      ctx.drawImage(bitmap, 0, 0)
      const outMime = cleanMime === 'image/jpg' ? 'image/jpeg' : cleanMime
      const qualities =
        outMime === 'image/jpeg' || outMime === 'image/webp' ? [0.92, 0.82, 0.68] : [undefined]
      for (const quality of qualities) {
        const stripped = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), outMime, quality),
        )
        if (stripped && stripped.size > 0 && stripped.size <= MAX_BLOSSOM_UPLOAD_BYTES) {
          return { blob: stripped, mimeType: outMime }
        }
      }
    } finally {
      bitmap.close()
    }
  } catch {
    // Fallback to original blob if canvas decode fails
  }
  return { blob: file, mimeType }
}

export async function uploadToBlossom(
  file: File | Blob,
  mimeType: string,
  signer: FireWispSigner,
  userServers: string[] = [],
  fetchImpl: typeof fetch = fetch,
  onProgress?: (info: BlossomUploadProgress) => void,
): Promise<BlossomUploadResult> {
  if (file.size === 0) throw new Error('File is empty')
  if (file.size > MAX_BLOSSOM_UPLOAD_BYTES) {
    throw new Error('File exceeds the 10 MB upload limit')
  }

  const sanitized = await stripImageExifClientSide(file, mimeType)
  const effectiveBlob = sanitized.blob
  const effectiveMime = sanitized.mimeType

  const buffer = await effectiveBlob.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const candidates = buildCandidateServers(userServers)
  const isMediaEndpointEligible = effectiveMime.startsWith('image/') || effectiveMime.startsWith('video/')

  let lastError: Error = new Error('No Blossom servers available')
  // Cache BUD-11 auth headers per action across fallback servers (avoids repeated NIP-07/Bunker prompts)
  const authHeaderCache = new Map<'media' | 'upload', string>()

  for (const server of candidates) {
    // Try BUD-05 /media first for images/videos, then fall back to BUD-02 /upload.
    const endpoints: Array<{ path: '/media' | '/upload'; action: 'media' | 'upload' }> =
      isMediaEndpointEligible
        ? [
            { path: '/media', action: 'media' },
            { path: '/upload', action: 'upload' },
          ]
        : [{ path: '/upload', action: 'upload' }]

    for (const ep of endpoints) {
      try {
        onProgress?.({
          server,
          host: formatBlossomHost(server),
          endpoint: ep.path,
        })
        let auth = authHeaderCache.get(ep.action)
        if (!auth) {
          auth = await buildBlossomAuthHeader(signer, ep.action, hash)
          authHeaderCache.set(ep.action, auth)
        }
        const resp = await fetchImpl(`${server}${ep.path}`, {
          method: 'PUT',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          headers: {
            Authorization: auth,
            'Content-Type': effectiveMime || 'application/octet-stream',
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
        const safeUrl = sanitizePublicHttpsUrl(data.url)
        if (!safeUrl) {
          lastError = new Error(`${server} returned an unsafe, cleartext, or private URL`)
          continue
        }

        // For raw /upload (untransformed), enforce strict SHA-256 descriptor match when returned (fail-closed).
        // For /media (server-side EXIF stripping / transcoding), validate 64-hex if returned.
        const returnedHash = (data.sha256 || '').trim().toLowerCase()
        if (returnedHash && !isValidHex64(returnedHash)) {
          lastError = new Error(`${server} returned invalid SHA-256 descriptor`)
          continue
        }
        if (ep.path === '/upload' && returnedHash && returnedHash !== hash) {
          lastError = new Error(`${server} returned mismatched SHA-256 descriptor`)
          continue
        }

        return {
          url: safeUrl,
          sha256: returnedHash || hash,
          size: typeof data.size === 'number' ? data.size : effectiveBlob.size,
          type: data.type || effectiveMime || 'application/octet-stream',
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
