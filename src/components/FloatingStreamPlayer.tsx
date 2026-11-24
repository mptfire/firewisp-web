import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  GripVertical,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Radio,
  X,
} from 'lucide-react'
import { useLiveStore } from '../lib/store/useLiveStore'
import { HlsVideoPlayer } from './HlsVideoPlayer'

interface DragPosition {
  x: number
  y: number
}

const EDGE_MARGIN = 8

function clampPosition(x: number, y: number, width: number, height: number): DragPosition {
  if (typeof window === 'undefined') return { x, y }
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)
  return {
    x: Math.min(Math.max(EDGE_MARGIN, x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, y), maxY),
  }
}

/**
 * Persistent draggable floating Picture-in-Picture mini-player mounted in Layout.tsx
 * so live streams keep playing seamlessly while browsing anywhere in Fire Wisp.
 * Also supports OS-level browser Picture-in-Picture across tabs/apps.
 */
export function FloatingStreamPlayer() {
  const miniPlayer = useLiveStore((s) => s.miniPlayer)
  const closeMiniPlayer = useLiveStore((s) => s.closeMiniPlayer)
  const markStreamOffline = useLiveStore((s) => s.markStreamOffline)

  const [expanded, setExpanded] = useState(false)
  const [nativePipSupported, setNativePipSupported] = useState(false)
  const [pos, setPos] = useState<DragPosition | null>(null)
  const [dragging, setDragging] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const dragStateRef = useRef<{
    startPointerX: number
    startPointerY: number
    startLeft: number
    startTop: number
    width: number
    height: number
    moved: boolean
  } | null>(null)
  const suppressNextLinkClickRef = useRef(false)

  useEffect(() => {
    setNativePipSupported(
      typeof document !== 'undefined' &&
        'pictureInPictureEnabled' in document &&
        Boolean(document.pictureInPictureEnabled),
    )
  }, [])

  // Keep dragged mini-player clamped inside the viewport on resize or expand/shrink
  useEffect(() => {
    if (!pos) return
    const reclamp = () => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos((prev) => (prev ? clampPosition(prev.x, prev.y, rect.width, rect.height) : null))
    }
    const raf = requestAnimationFrame(reclamp)
    window.addEventListener('resize', reclamp)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', reclamp)
    }
  }, [pos !== null, expanded])

  // Pointer drag listeners
  useEffect(() => {
    if (!dragging) return

    const onPointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current
      if (!st) return
      const dx = e.clientX - st.startPointerX
      const dy = e.clientY - st.startPointerY
      if (!st.moved && Math.hypot(dx, dy) < 4) return
      st.moved = true
      setPos(clampPosition(st.startLeft + dx, st.startTop + dy, st.width, st.height))
    }

    const onPointerUp = () => {
      if (dragStateRef.current?.moved) {
        suppressNextLinkClickRef.current = true
        setTimeout(() => {
          suppressNextLinkClickRef.current = false
        }, 120)
      }
      dragStateRef.current = null
      setDragging(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [dragging])

  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
  }, [])

  if (!miniPlayer) return null

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Don't start dragging when clicking header control buttons
    const target = e.target as HTMLElement | null
    if (target?.closest('button') || target?.closest('[data-no-drag]')) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragStateRef.current = {
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    }
    setDragging(true)
  }

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
      ref={containerRef}
      style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined}
      className={`fixed z-40 rounded-2xl overflow-hidden bg-[#12131a]/95 backdrop-blur-md border shadow-2xl shadow-black/75 ${
        pos ? '' : 'bottom-16 md:bottom-4 right-3 sm:right-4'
      } ${dragging ? 'border-[#ff922b] select-none' : 'border-[#e8590c]/50 transition-[width]'} ${
        expanded ? 'w-[calc(100vw-24px)] sm:w-[440px]' : 'w-[290px] sm:w-[340px]'
      }`}
    >
      {/* Draggable compact control header (double-click to reset to bottom-right) */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={() => setPos(null)}
        title="Drag to move · Double-click to snap back to corner"
        className={`px-2 py-1.5 bg-[#161822] border-b border-[#252836] flex items-center justify-between gap-1.5 touch-none select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <GripVertical className="w-3.5 h-3.5 text-[#6f6d66] shrink-0" />
          <Link
            to={`/live/${miniPlayer.naddr}`}
            draggable={false}
            onClick={(e) => {
              if (suppressNextLinkClickRef.current) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            className="flex items-center gap-1.5 min-w-0 flex-1 group"
            title="Click to return to full stream & live chat · Drag to move"
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
        </div>

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
            data-no-drag
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
