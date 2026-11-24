import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Radio,
  X,
} from 'lucide-react'
import { useLiveStore } from '../lib/store/useLiveStore'
import { HlsVideoPlayer } from './HlsVideoPlayer'

/**
 * Persistent floating Picture-in-Picture mini-player mounted in Layout.tsx so
 * live streams keep playing seamlessly while browsing Feed, Notifications,
 * Search, Profile, or Threads. Also supports OS-level browser PiP.
 */
export function FloatingStreamPlayer() {
  const miniPlayer = useLiveStore((s) => s.miniPlayer)
  const closeMiniPlayer = useLiveStore((s) => s.closeMiniPlayer)
  const markStreamOffline = useLiveStore((s) => s.markStreamOffline)

  const [expanded, setExpanded] = useState(false)
  const [nativePipSupported, setNativePipSupported] = useState(false)
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    setNativePipSupported(
      typeof document !== 'undefined' &&
        'pictureInPictureEnabled' in document &&
        Boolean(document.pictureInPictureEnabled),
    )
  }, [])

  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])

  if (!miniPlayer) return null

  const toggleNativePip = async () => {
    const video = videoElRef.current
    if (!video || !nativePipSupported) return
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
      } else if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture()
      }
    } catch {
      // Browser may block PiP until metadata is ready; user can retry once playing
    }
  }

  return (
    <div
      className={`fixed bottom-16 md:bottom-4 right-3 sm:right-4 z-40 rounded-2xl overflow-hidden bg-[#12131a]/95 backdrop-blur-md border border-[#e8590c]/50 shadow-2xl shadow-black/75 transition-all ${
        expanded ? 'w-[calc(100vw-24px)] sm:w-[440px]' : 'w-[290px] sm:w-[340px]'
      }`}
    >
      {/* Compact control header */}
      <div className="px-2.5 py-1.5 bg-[#161822] border-b border-[#252836] flex items-center justify-between gap-2">
        <Link
          to={`/live/${miniPlayer.naddr}`}
          className="flex items-center gap-1.5 min-w-0 flex-1 group"
          title="Return to full stream & live chat"
        >
          {miniPlayer.isLive && (
            <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold uppercase flex items-center gap-1 shrink-0">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              LIVE
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-white group-hover:text-[#ff922b] truncate leading-tight transition">
              {miniPlayer.title}
            </div>
            <div className="text-[10px] text-[#8c8a82] truncate leading-tight">
              {miniPlayer.hostName}
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-0.5 shrink-0">
          {nativePipSupported && (
            <button
              type="button"
              onClick={() => void toggleNativePip()}
              title="Float in browser Picture-in-Picture window (works across browser tabs)"
              aria-label="Browser Picture-in-Picture"
              className="p-1 rounded-lg text-[#9a9890] hover:text-[#ff922b] hover:bg-white/5 cursor-pointer"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Smaller mini-player' : 'Larger mini-player'}
            aria-label={expanded ? 'Smaller mini-player' : 'Larger mini-player'}
            className="hidden sm:inline-flex p-1 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <Link
            to={`/live/${miniPlayer.naddr}`}
            title="Open full stream & chat"
            aria-label="Open full stream & chat"
            className="p-1 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => {
              if (
                typeof document !== 'undefined' &&
                document.pictureInPictureElement &&
                document.pictureInPictureElement === videoElRef.current
              ) {
                void document.exitPictureInPicture().catch(() => {})
              }
              closeMiniPlayer()
            }}
            title="Close mini-player"
            aria-label="Close mini-player"
            className="p-1 rounded-lg text-[#9a9890] hover:text-red-400 hover:bg-white/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Persistent HLS video player */}
      <HlsVideoPlayer
        streamUrl={miniPlayer.streamUrl}
        posterUrl={miniPlayer.posterUrl}
        title={miniPlayer.title}
        isLive={miniPlayer.isLive}
        autoStart
        compact
        onVideoElement={handleVideoElement}
        onStreamOffline={() => markStreamOffline(miniPlayer.aTag)}
      />
    </div>
  )
}
