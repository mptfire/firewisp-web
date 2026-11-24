export interface YouTubeRef {
  videoId: string
  url: string
  thumbnailUrl: string
  isShort?: boolean
  startSeconds?: number
}

export interface YouTubeMeta {
  title?: string
  authorName?: string
}

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/
const ALLOWED_YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

const URL_TOKEN_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

function parseStartSeconds(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().toLowerCase()
  if (/^\d+s?$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10)
    return n > 0 && n <= 86400 ? n : undefined
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(trimmed)
  if (!match) return undefined
  const h = match[1] ? Number.parseInt(match[1], 10) : 0
  const m = match[2] ? Number.parseInt(match[2], 10) : 0
  const s = match[3] ? Number.parseInt(match[3], 10) : 0
  const total = h * 3600 + m * 60 + s
  return total > 0 && total <= 86400 ? total : undefined
}

export function formatYouTubeTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Extracts a validated YouTube video reference from a public YouTube URL.
 * Rejects spoofed hostnames, embedded credentials, and malformed IDs.
 */
export function extractYouTubeVideo(rawUrl: string): YouTubeRef | null {
  try {
    const u = new URL(rawUrl.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null

    const host = u.hostname.toLowerCase()
    if (!ALLOWED_YT_HOSTS.has(host)) return null

    let videoId = ''
    let isShort = false
    const segments = u.pathname.split('/').filter(Boolean)

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = segments[0] || ''
    } else if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v') || ''
    } else if (segments[0] === 'shorts' && segments[1]) {
      videoId = segments[1]
      isShort = true
    } else if ((segments[0] === 'embed' || segments[0] === 'live') && segments[1]) {
      videoId = segments[1]
    }

    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return null

    const startSeconds = parseStartSeconds(
      u.searchParams.get('t') || u.searchParams.get('start'),
    )
    const canonicalUrl = startSeconds
      ? `https://youtu.be/${videoId}?t=${startSeconds}`
      : isShort
        ? `https://www.youtube.com/shorts/${videoId}`
        : `https://youtu.be/${videoId}`

    return {
      videoId,
      url: canonicalUrl,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      isShort: isShort || undefined,
      startSeconds,
    }
  } catch {
    return null
  }
}

export function extractYouTubeRefsFromText(text: string, maxCount = 4): YouTubeRef[] {
  const out: YouTubeRef[] = []
  const seen = new Set<string>()
  URL_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_TOKEN_RE.exec(text)) !== null) {
    const trimmed = match[0].replace(/[),.;!?]+$/, '')
    const ref = extractYouTubeVideo(trimmed)
    if (ref && !seen.has(ref.videoId)) {
      seen.add(ref.videoId)
      out.push(ref)
      if (out.length >= maxCount) break
    }
  }
  return out
}

const metaCache = new Map<string, YouTubeMeta | null>()
const inflight = new Map<string, Promise<YouTubeMeta | null>>()
const MAX_CACHE_ENTRIES = 250

/**
 * Fetches YouTube video title & channel via YouTube's public oEmbed endpoint.
 * Non-blocking, cached, no credentials/referrer sent; returns null cleanly on timeout or block.
 */
export async function fetchYouTubeMeta(videoId: string): Promise<YouTubeMeta | null> {
  if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return null
  if (metaCache.has(videoId)) return metaCache.get(videoId) ?? null
  const existing = inflight.get(videoId)
  if (existing) return existing

  const promise = (async (): Promise<YouTubeMeta | null> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    try {
      const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
      const resp = await fetch(
        `https://www.youtube.com/oembed?url=${target}&format=json`,
        {
          signal: ctrl.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      )
      if (!resp.ok) return null
      const json = (await resp.json()) as { title?: unknown; author_name?: unknown }
      const title =
        typeof json.title === 'string' && json.title.trim()
          ? json.title.trim().slice(0, 200)
          : undefined
      const authorName =
        typeof json.author_name === 'string' && json.author_name.trim()
          ? json.author_name.trim().slice(0, 100)
          : undefined
      if (!title && !authorName) return null
      return { title, authorName }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()

  inflight.set(videoId, promise)
  const result = await promise
  inflight.delete(videoId)

  if (metaCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = metaCache.keys().next().value
    if (oldestKey) metaCache.delete(oldestKey)
  }
  metaCache.set(videoId, result)
  return result
}
