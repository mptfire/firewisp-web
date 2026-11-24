import { useEffect, useRef, useState } from 'react'
import { Loader2, Volume2, VolumeX } from 'lucide-react'

export type HoverPreviewStatus = 'connecting' | 'playing' | 'audio-only' | 'error'

interface LiveHoverPreviewProps {
  streamUrl: string
  onStatusChange?: (status: HoverPreviewStatus) => void
}

/**
 * Lightweight muted live-stream preview mounted only while hovering a stream card.
 * Uses lowest starting HLS bitrate capped to the preview box and tears down
 * immediately on mouse leave so zero background streams linger.
 */
export function LiveHoverPreview({ streamUrl, onStatusChange }: LiveHoverPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<HoverPreviewStatus>('connecting')
  const [muted, setMuted] = useState(true)

  const updateStatus = (next: HoverPreviewStatus) => {
    setStatus(next)
    onStatusChange?.(next)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl.startsWith('https://')) {
      updateStatus('error')
      return
    }

    let destroyed = false
    let hlsInstance: { destroy: () => void } | null = null
    updateStatus('connecting')

    const markPlaying = () => {
      if (destroyed) return
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        updateStatus('playing')
      } else {
        updateStatus('audio-only')
      }
    }

    const onResize = () => {
      if (!destroyed && video.videoWidth > 0 && video.videoHeight > 0) {
        updateStatus('playing')
      }
    }

    video.muted = true
    video.addEventListener('playing', markPlaying)
    video.addEventListener('loadeddata', onResize)
    video.addEventListener('resize', onResize)

    const timeout = setTimeout(() => {
      if (!destroyed && video.readyState < 2) {
        hlsInstance?.destroy()
        hlsInstance = null
        updateStatus('error')
      }
    }, 8000)

    const isHls = /\.m3u8(\?.*)?$/i.test(streamUrl) || streamUrl.includes('/hls/')

    void (async () => {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try {
          const { default: Hls } = await import('hls.js')
          if (destroyed || !Hls.isSupported()) {
            if (!destroyed) updateStatus('error')
            return
          }
          const hls = new Hls({
            enableWorker: false,
            lowLatencyMode: true,
            startLevel: 0,
            capLevelToPlayerSize: true,
            maxBufferLength: 6,
            maxMaxBufferLength: 10,
            backBufferLength: 0,
          })
          hlsInstance = hls
          hls.loadSource(streamUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            void video.play().catch(() => {
              if (!destroyed) updateStatus('error')
            })
          })
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (destroyed) return
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError()
              } else {
                hls.destroy()
                hlsInstance = null
                updateStatus('error')
              }
            }
          })
        } catch {
          if (!destroyed) updateStatus('error')
        }
      } else {
        video.src = streamUrl
        const onCanPlay = () => {
          if (destroyed) return
          void video.play().catch(() => {
            if (!destroyed) updateStatus('error')
          })
        }
        const onErr = () => {
          if (!destroyed) updateStatus('error')
        }
        video.addEventListener('canplay', onCanPlay, { once: true })
        video.addEventListener('error', onErr, { once: true })
      }
    })()

    return () => {
      destroyed = true
      clearTimeout(timeout)
      video.removeEventListener('playing', markPlaying)
      video.removeEventListener('loadeddata', onResize)
      video.removeEventListener('resize', onResize)
      if (hlsInstance) {
        hlsInstance.destroy()
        hlsInstance = null
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl])

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const video = videoRef.current
    if (!video) return
    const nextMuted = !muted
    video.muted = nextMuted
    setMuted(nextMuted)
    if (!nextMuted && video.paused) {
      void video.play().catch(() => {})
    }
  }

  return (
    <>
      <video
        ref={videoRef}
        muted={muted}
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-cover bg-black transition-opacity duration-200 pointer-events-none ${
          status === 'playing' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Top-right mute/unmute toggle while live preview is active */}
      {(status === 'playing' || status === 'audio-only') && (
        <button
          type="button"
          onClick={toggleMute}
          title={muted ? 'Unmute preview' : 'Mute preview'}
          aria-label={muted ? 'Unmute preview' : 'Mute preview'}
          className="absolute top-2 right-2 z-10 p-1 rounded-md bg-black/75 hover:bg-black/95 border border-white/15 text-white transition cursor-pointer"
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-[#ff922b]" />}
        </button>
      )}

      {/* Compact bottom-left preview status pill */}
      {status === 'connecting' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/75 backdrop-blur-sm text-[9px] font-medium text-[#ece9e1] flex items-center gap-1 pointer-events-none">
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[#ff922b]" />
          Preview…
        </span>
      )}
      {status === 'audio-only' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-medium text-[#ff922b] pointer-events-none">
          {muted ? 'Audio stream · Click 🔇' : 'Audio playing'}
        </span>
      )}
      {status === 'error' && (
        <span className="absolute bottom-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-[9px] font-medium text-[#b8b5ad] pointer-events-none">
          Preview offline
        </span>
      )}
    </>
  )
}
