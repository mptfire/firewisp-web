import { memo, useEffect, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'
import {
  fetchYouTubeMeta,
  formatYouTubeTimestamp,
  type YouTubeMeta,
  type YouTubeRef,
} from '../lib/nostr/youtube'

interface YouTubeCardProps {
  video: YouTubeRef
  compact?: boolean
}

/**
 * Privacy-preserving YouTube preview card (Option 1B):
 * Zero Google iframes or scripts — displays the thumbnail + title/channel card
 * and opens YouTube in a new tab/app when clicked.
 */
export const YouTubeCard = memo(function YouTubeCard({
  video,
  compact = false,
}: YouTubeCardProps) {
  const [meta, setMeta] = useState<YouTubeMeta | null>(null)
  const [thumbSrc, setThumbSrc] = useState(video.thumbnailUrl)
  const [thumbFailed, setThumbFailed] = useState(false)

  useEffect(() => {
    setThumbSrc(video.thumbnailUrl)
    setThumbFailed(false)
    let active = true
    void fetchYouTubeMeta(video.videoId).then((res) => {
      if (active && res) setMeta(res)
    })
    return () => {
      active = false
    }
  }, [video.videoId, video.thumbnailUrl])

  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="group block rounded-xl overflow-hidden border border-[#262834] hover:border-red-500/60 bg-[#12131a] transition"
    >
      <div
        className={`relative w-full aspect-video bg-[#0b0b0e] overflow-hidden ${
          compact ? 'max-h-36' : 'max-h-[340px]'
        }`}
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
      </div>

      <div
        className={`${
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
        } flex items-center justify-between gap-2 bg-[#141620]`}
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
      </div>
    </a>
  )
})
