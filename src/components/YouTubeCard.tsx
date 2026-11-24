import { memo, useEffect, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'
import {
  fetchYouTubeMeta,
  formatYouTubeTimestamp,
  type YouTubeMeta,
  type YouTubeRef,
} from '../lib/nostr/youtube'
import { useSettingsStore } from '../lib/store/useSettingsStore'

interface YouTubeCardProps {
  video: YouTubeRef
  compact?: boolean
  previewOnly?: boolean
}

/**
 * Click-to-play privacy YouTube card:
 * Respects the sidebar `inlineMediaPlayback` toggle:
 * - Inline: clicking Play embeds `youtube-nocookie.com` directly inside the note.
 * - Player: clicking jumps straight to YouTube in a new tab (zero Google iframe).
 */
export const YouTubeCard = memo(function YouTubeCard({
  video,
  compact = false,
  previewOnly = false,
}: YouTubeCardProps) {
  const inlineMediaPlayback = useSettingsStore((s) => s.inlineMediaPlayback)
  const [meta, setMeta] = useState<YouTubeMeta | null>(null)
  const [thumbSrc, setThumbSrc] = useState(video.thumbnailUrl)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setThumbSrc(video.thumbnailUrl)
    setThumbFailed(false)
    setPlaying(false)
    let active = true
    void fetchYouTubeMeta(video.videoId).then((res) => {
      if (active && res) setMeta(res)
    })
    return () => {
      active = false
    }
  }, [video.videoId, video.thumbnailUrl])

  useEffect(() => {
    if (!inlineMediaPlayback) setPlaying(false)
  }, [inlineMediaPlayback])

  const canPlayInline = inlineMediaPlayback && !previewOnly

  const embedUrl = video.startSeconds
    ? `https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0&start=${video.startSeconds}`
    : `https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0`

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="group rounded-xl overflow-hidden border border-[#262834] hover:border-red-500/60 bg-[#12131a] transition"
    >
      {playing && canPlayInline ? (
        <div
          className={`relative w-full aspect-video bg-black ${
            compact ? 'max-h-52' : 'max-h-[420px]'
          }`}
        >
          <iframe
            src={embedUrl}
            title={meta?.title || 'YouTube video player'}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="w-full h-full border-0"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (!canPlayInline) {
              window.open(video.url, '_blank', 'noopener,noreferrer')
            } else {
              setPlaying(true)
            }
          }}
          className={`relative block w-full aspect-video bg-[#0b0b0e] overflow-hidden cursor-pointer text-left ${
            compact ? 'max-h-36' : 'max-h-[340px]'
          }`}
          aria-label={
            canPlayInline
              ? `Play ${meta?.title || 'YouTube video'} inline`
              : `Open ${meta?.title || 'YouTube video'} on YouTube`
          }
        >
          {!thumbFailed ? (
            <img
              src={thumbSrc}
              alt={meta?.title || 'YouTube video preview'}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => {
                if (thumbSrc.includes('hqdefault.jpg')) {
                  setThumbSrc(`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`)
                } else {
                  setThumbFailed(true)
                }
              }}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#231214] via-[#15161e] to-[#0e0e11]" />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/25 flex items-center justify-center">
            <span
              className={`${
                compact ? 'w-10 h-10' : 'w-14 h-14'
              } rounded-full bg-red-600/95 group-hover:bg-red-500 group-hover:scale-105 transition shadow-xl flex items-center justify-center text-white`}
            >
              <Play
                className={`${compact ? 'w-4 h-4' : 'w-6 h-6'} fill-white ml-0.5`}
              />
            </span>
          </div>

          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-black/80 text-[10px] font-bold tracking-wide text-red-400 border border-white/10">
              {video.isShort ? 'YouTube Shorts' : 'YouTube'}
            </span>
            {video.startSeconds && (
              <span className="px-1.5 py-0.5 rounded-md bg-black/80 text-[10px] font-medium text-[#e4e1d8] border border-white/10">
                @{formatYouTubeTimestamp(video.startSeconds)}
              </span>
            )}
          </div>
        </button>
      )}

      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
        } flex items-center justify-between gap-2 bg-[#141620] hover:bg-[#191c28] transition`}
      >
        <div className="min-w-0 flex-1">
          <p
            className={`${
              compact ? 'text-xs' : 'text-sm'
            } font-semibold text-[#f4f1ea] group-hover:text-white truncate`}
          >
            {meta?.title || 'Watch on YouTube'}
          </p>
          <p className="text-[11px] text-[#8c8a82] truncate">
            {meta?.authorName
              ? `${meta.authorName} · youtu.be/${video.videoId}`
              : `youtu.be/${video.videoId}`}
          </p>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-[#8c8a82] group-hover:text-[#ff8a3d] shrink-0 transition" />
      </a>
    </div>
  )
})
