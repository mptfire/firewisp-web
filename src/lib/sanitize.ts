const SAFE_WEB_PROTOCOLS = new Set(['https:', 'http:'])
const SAFE_RELAY_PROTOCOLS = new Set(['wss:', 'ws:'])

/**
 * Validates that a URL uses http: or https: and cannot execute javascript:/data:/vbscript:.
 */
export function sanitizeHttpUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!SAFE_WEB_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Validates that a relay URL uses wss: (or ws: for localhost testing only).
 */
export function sanitizeRelayUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!SAFE_RELAY_PROTOCOLS.has(parsed.protocol)) return null
    if (
      parsed.protocol === 'ws:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      return null
    }
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Validates a Blossom server base URL (HTTPS required, no trailing slash).
 */
export function sanitizeBlossomUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Blocks SSRF-like local/private hostnames when resolving LNURL / NIP-05 endpoints in browser.
 */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return false
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return false
  return true
}

export function sanitizePublicHttpsUrl(raw: string | undefined | null): string | null {
  const clean = sanitizeHttpUrl(raw)
  if (!clean) return null
  try {
    const u = new URL(clean)
    if (u.protocol !== 'https:') return null
    if (!isPublicHostname(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

export function isValidHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim())
}
