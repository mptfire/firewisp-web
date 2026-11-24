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
 * Validates that a relay URL uses wss: (or ws: for localhost testing only — user-configured settings).
 */
export function sanitizeRelayUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!SAFE_RELAY_PROTOCOLS.has(parsed.protocol)) return null
    if (parsed.username || parsed.password) return null
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
 * Strict validator for untrusted remote relay hints (NIP-53, NIP-65, NIP-17 inbox, naddr):
 * requires `wss://` AND a public hostname (blocks localhost, RFC1918 LAN, link-local, metadata IPs).
 */
export function sanitizePublicRelayUrl(raw: string | undefined | null): string | null {
  const clean = sanitizeRelayUrl(raw)
  if (!clean) return null
  try {
    const parsed = new URL(clean)
    if (parsed.protocol !== 'wss:') return null
    if (!isPublicHostname(parsed.hostname)) return null
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
    if (parsed.username || parsed.password) return null
    if (!isPublicHostname(parsed.hostname)) return null
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * Blocks SSRF-like local/private/LAN hostnames (IPv4, CGNAT, IPv6 non-global, *.localhost,
 * trailing-dot variants, single-label intranet hosts) when resolving external URLs in the browser.
 */
export function isPublicHostname(hostname: string): boolean {
  const raw = hostname.toLowerCase().trim()
  const h = (raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw).replace(/\.+$/, '')
  if (
    !h ||
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return false
  }
  // IPv6 literals: require global unicast range (2000::/3 — starts with 2 or 3)
  if (h.includes(':')) {
    return /^[23][0-9a-f]{0,3}:/i.test(h)
  }
  // Reject single-label intranet hostnames without a dot (e.g. "router", "metadata")
  if (!h.includes('.')) return false
  // IPv4 unspecified (0.0.0.0/8), loopback, RFC1918, link-local, CGNAT (100.64.0.0/10)
  if (
    /^0\./.test(h) ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
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
    if (u.username || u.password) return null
    if (!isPublicHostname(u.hostname)) return null
    return u.toString()
  } catch {
    return null
  }
}

export function isValidHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value.trim())
}
