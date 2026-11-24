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
 * Validates a Blossom server base URL (public HTTPS required, no trailing slash).
 */
export function sanitizeBlossomUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return null
    if (!isPublicHostname(parsed.hostname)) return null
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Blocks SSRF-like local/private/LAN hostnames (IPv4, CGNAT, IPv6 ULA/link-local/mapped)
 * when resolving LNURL, Blossom, NIP-05, or embedded media endpoints in the browser.
 */
export function isPublicHostname(hostname: string): boolean {
  const raw = hostname.toLowerCase().trim()
  const h = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  // IPv4 loopback, RFC1918, link-local, CGNAT (100.64.0.0/10), unspecified
  if (
    h === '0.0.0.0' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  ) {
    return false
  }
  // IPv6 loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10), IPv4-mapped (::ffff:)
  if (
    h === '::1' ||
    h === '::' ||
    /^f[cd][0-9a-f]{2}:/.test(h) ||
    /^fe[89ab][0-9a-f]:/.test(h) ||
    h.startsWith('::ffff:')
  ) {
    return false
  }
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
