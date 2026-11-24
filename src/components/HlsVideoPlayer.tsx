import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Play, Radio, Shield } from 'lucide-react'

interface HlsVideoPlayerProps {
  streamUrl: string
  posterUrl?: string
  title?: string
  isLive?: boolean
}

export function HlsVideoPlayer({
  streamUrl,
  posterUrl,
  title,
  isLive = true,
}: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [started, setStarted] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamHost = useMemo(() => {
    try {
      return new URL(streamUrl).hostname
    } catch {
      return 'external stream'
    }
  }, [streamUrl])

  useEffect(() => {
    setStarted(false)
    setError(null)
    setBuffering(false)
  }, [streamUrl])

  useEffect(() => {
    if (!started) return
    const video = videoRef.current
    if (!video) return

    let destroyed = false
    let hlsInstance: { destroy: () => void } | null = null
    setError(null)
    setBuffering(true)

    const isHls = /\.m3u8(\?.*)?$/i.test(streamUrl) || streamUrl.includes('/hls/')

    void (async () => {
      if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        try {
          // Lazy-load hls.js in its own async chunk with enableWorker: false so strict CSP worker-src 'self' stays intact
          const { default: Hls } = await import('hls.js')
          if (destroyed) return
          if (!Hls.isSupported()) {
            setError('Your browser does not support HLS live playback.')
            setBuffering(false)
            return
          }
          const hls = new Hls({
            enableWorker: false,
            lowLatencyMode: true,
            backBufferLength: 30,
          })
          hlsInstance = hls
          hls.loadSource(streamUrl)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (destroyed) return
            setBuffering(false)
            void video.play().catch(() => {})
          })
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (destroyed) return
            if (data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                setError('Stream unreachable or offline. Click Retry to reconnect.')
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError()
                return
              } else {
                setError('Unable to play this live stream.')
              }
              setBuffering(false)
            }
          })
        } catch (err) {
          if (!destroyed) {
            setError(err instanceof Error ? err.message : 'Failed to initialize HLS player')
            setBuffering(false)
          }
        }
      } else {
        // Safari native HLS or direct MP4/WebM recording
        video.src = streamUrl
        const onCanPlay = () => {
          if (!destroyed) {
            setBuffering(false)
            void video.play().catch(() => {})
          }
        }
        const onErr = () => {
          if (!destroyed) {
            setError('Stream could not be loaded. It may be offline.')
            setBuffering(false)
          }
        }
        video.addEventListener('canplay', onCanPlay, { once: true })
        video.addEventListener('error', onErr, { once: true })
      }
    })()

    return () => {
      destroyed = true
      if (hlsInstance) {
        hlsInstance.destroy()
      }
      video.removeAttribute('src')
      video.load()
    }
  }, [started, streamUrl])

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-[#232530]">
      {!started ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
          {posterUrl && (
            <img
              src={posterUrl}
              alt={title || 'Live stream preview'}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover opacity-45"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/30" />

          <div className="relative z-10 flex flex-col items-center gap-3 max-w-md">
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="w-16 h-16 rounded-full bg-[#e8590c] hover:bg-[#d9480f] text-white shadow-2xl shadow-black/60 flex items-center justify-center transition hover:scale-105 cursor-pointer"
              aria-label="Play live stream"
            >
              <Play className="w-7 h-7 fill-white ml-0.5" />
            </button>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white flex items-center justify-center gap-1.5">
                {isLive && <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />}
                <span>Click to play {isLive ? 'live stream' : 'recording'}</span>
              </div>
              <div className="text-[11px] text-[#c2bfb7] flex items-center justify-center gap-1">
                <Shield className="w-3 h-3 text-[#f59f00]" />
                <span>
                  Connects directly to <span className="font-mono text-white">{streamHost}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            controls
            playsInline
            poster={posterUrl}
            className="w-full h-full object-contain bg-black"
          />
          {buffering && !error && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-[#e8590c]" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="w-7 h-7 text-[#f59f00]" />
              <p className="text-sm text-[#e0ded7] max-w-sm">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStarted(false)
                  setTimeout(() => setStarted(true), 20)
                }}
                className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-white cursor-pointer"
              >
                Retry Stream
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
