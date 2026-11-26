import { useEffect } from 'react'
import { X, ExternalLink } from 'lucide-react'
import type { MediaAttachment } from '../lib/nostr/content'
import { formatAudioSourceLabel } from '../lib/mediaAudio'
import { FireWispVideoPlayer } from './FireWispVideoPlayer'

interface MediaLightboxProps {
  media: MediaAttachment | null
  onClose: () => void
}

export function MediaLightbox({ media, onClose }: MediaLightboxProps) {
  useEffect(() => {
    if (!media) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [media, onClose])

  if (!media) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <a
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          title="Open original"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="max-w-[92vw] max-h-[92vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {media.kind === 'video' ? (
          <FireWispVideoPlayer
            src={media.url}
            poster={media.poster}
            sourceLabel={formatAudioSourceLabel(media.alt, undefined, media.url)}
            autoPlay
            className="rounded-xl max-w-[90vw]"
            videoClassName="max-h-[85vh] max-w-full object-contain bg-black"
          />
        ) : (
          <img
            src={media.url}
            alt={media.alt || 'Attached image'}
            referrerPolicy="no-referrer"
            className="max-h-[88vh] max-w-full rounded-xl object-contain"
          />
        )}
        {media.alt && (
          <div className="bg-[#15161c] border border-[#2a2d3a] text-sm text-[#d4d2cb] px-4 py-2.5 rounded-xl max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#f59f00] mr-2">
              ALT
            </span>
            {media.alt}
          </div>
        )}
      </div>
    </div>
  )
}
