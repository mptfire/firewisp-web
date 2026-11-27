import { sanitizePublicHttpsUrl } from '../sanitize'
import type { YouTubeRef } from './youtube'

export interface SongLinkRef {
  url: string
  host: string
  itunesTrackId?: string
  youtubeRef?: YouTubeRef
}

export interface ItunesTrackMeta {
  trackName?: string
  artistName?: string
  collectionName?: string
  artworkUrl?: string
  previewUrl?: string
}

const ALLOWED_SONGLINK_HOSTS = new Set([
  'song.link',
  'www.song.link',
  'album.link',
  'www.album.link',
  'odesli.co',
  'www.odesli.co',
  'pods.link',
  'www.pods.link',
  'artist.link',
  'www.artist.link',
  'mylink.page',
])

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/
const ITUNES_ID_RE = /^\d{4,16}$/

/**
 * Parses and validates Odesli (`song.link`, `album.link`, `pods.link`, `odesli.co`) links.
 * - Rejects embedded credentials and spoofed hostnames.
 * - Routes `/y/<youtubeId>` directly to Fire Wisp's privacy-first `YouTubeRef` (no external iframe needed).
 * - Extracts `/i/<itunesTrackId>` for CORS-enabled iTunes artwork + 30s audio preview playback.
 */
export function extractSongLink(rawUrl: string): SongLinkRef | null {
  try {
    const u = new URL(rawUrl.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null

    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (!ALLOWED_SONGLINK_HOSTS.has(host)) return null

    const segments = u.pathname.split('/').filter(Boolean)
    // Exclude static marketing / info / API pages
    if (
      segments.length === 0 ||
      ['about', 'privacy', 'terms', 'faq', 'embed', 'oembed', 'api'].includes(
        segments[0].toLowerCase(),
      )
    ) {
      return null
    }

    // Detect /y/<ytId> or /<country>/y/<ytId>
    const yIdx = segments.findIndex((s) => s.toLowerCase() === 'y')
    if (yIdx !== -1 && segments[yIdx + 1] && YOUTUBE_ID_RE.test(segments[yIdx + 1])) {
      const videoId = segments[yIdx + 1]
      const canonical = `https://${host}${u.pathname}`
      return {
        url: canonical,
        host,
        youtubeRef: {
          videoId,
          url: `https://youtu.be/${videoId}`,
          thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        },
      }
    }

    // Detect /i/<itunesTrackId> or /<country>/i/<itunesTrackId>
    let itunesTrackId: string | undefined
    const iIdx = segments.findIndex((s) => s.toLowerCase() === 'i')
    if (iIdx !== -1 && segments[iIdx + 1] && ITUNES_ID_RE.test(segments[iIdx + 1])) {
      itunesTrackId = segments[iIdx + 1]
    }

    const canonicalUrl = `https://${host}${u.pathname}${u.search}`

    return {
      url: canonicalUrl,
      host,
      itunesTrackId,
    }
  } catch {
    return null
  }
}

const MAX_ITUNES_CACHE = 200
const itunesCache = new Map<string, ItunesTrackMeta | null>()
const itunesInflight = new Map<string, Promise<ItunesTrackMeta | null>>()

/**
 * Fetches track title, artist, album artwork, and 30s audio preview via iTunes public CORS API.
 * Caches both positive and negative results to prevent redundant requests.
 */
export function fetchItunesTrackMeta(trackId: string): Promise<ItunesTrackMeta | null> {
  if (!ITUNES_ID_RE.test(trackId)) return Promise.resolve(null)
  if (itunesCache.has(trackId)) return Promise.resolve(itunesCache.get(trackId) ?? null)
  const pending = itunesInflight.get(trackId)
  if (pending) return pending

  const req = fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(trackId)}`, {
    method: 'GET',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
    .then(async (res) => {
      if (!res.ok) return null
      const data = (await res.json()) as {
        results?: Array<{
          trackName?: unknown
          artistName?: unknown
          collectionName?: unknown
          artworkUrl100?: unknown
          previewUrl?: unknown
        }>
      }
      const first = data?.results?.[0]
      if (!first) return null
      const rawArt =
        typeof first.artworkUrl100 === 'string'
          ? first.artworkUrl100.replace('/100x100bb.', '/300x300bb.')
          : undefined
      const meta: ItunesTrackMeta = {
        trackName: typeof first.trackName === 'string' ? first.trackName.trim() : undefined,
        artistName: typeof first.artistName === 'string' ? first.artistName.trim() : undefined,
        collectionName:
          typeof first.collectionName === 'string' ? first.collectionName.trim() : undefined,
        artworkUrl: sanitizePublicHttpsUrl(rawArt) || undefined,
        previewUrl:
          typeof first.previewUrl === 'string'
            ? sanitizePublicHttpsUrl(first.previewUrl) || undefined
            : undefined,
      }
      if (!meta.trackName && !meta.artistName && !meta.previewUrl) return null
      return meta
    })
    .catch(() => null)
    .then((meta) => {
      if (itunesCache.size >= MAX_ITUNES_CACHE) {
        const oldest = itunesCache.keys().next().value
        if (oldest) itunesCache.delete(oldest)
      }
      itunesCache.set(trackId, meta)
      return meta
    })
    .finally(() => {
      itunesInflight.delete(trackId)
    })

  itunesInflight.set(trackId, req)
  return req
}
