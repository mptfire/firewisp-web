import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  GripVertical,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  PictureInPicture2,
  Radio,
  Send,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import { parseNoteContent } from '../lib/nostr/content'
import { decodeLiveNaddr } from '../lib/nostr/nip53'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore, type LiveChatMessage } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { HlsVideoPlayer } from './HlsVideoPlayer'
import { YouTubeCard } from './YouTubeCard'

const BLOSSOM_HEX_URL_RE = /^https:\/\/[^/]+(?:\/[^/?#]+)*\/[0-9a-f]{64}(?:[?#].*)?$/i

interface DragPosition {
  x: number
  y: number
}

interface MiniPlayerSize {
  width: number
  chatHeight: number
}

const EDGE_MARGIN = 8
const MINI_SIZE_STORAGE_KEY = 'firewisp_mini_player_size_v1'
const MIN_MINI_WIDTH = 260
const MAX_MINI_WIDTH = 760
const MIN_CHAT_HEIGHT = 96
const MAX_CHAT_HEIGHT = 480

const SIZE_PRESETS: Array<{ label: 'S' | 'M' | 'L'; width: number; chatHeight: number }> = [
  { label: 'S', width: 300, chatHeight: 160 },
  { label: 'M', width: 420, chatHeight: 224 },
  { label: 'L', width: 560, chatHeight: 280 },
]

function clampSize(width: number, chatHeight: number): MiniPlayerSize {
  const maxW =
    typeof window !== 'undefined'
      ? Math.max(MIN_MINI_WIDTH, Math.min(MAX_MINI_WIDTH, window.innerWidth - EDGE_MARGIN * 2))
      : MAX_MINI_WIDTH
  const maxH =
    typeof window !== 'undefined'
      ? Math.max(MIN_CHAT_HEIGHT, Math.min(MAX_CHAT_HEIGHT, window.innerHeight - 260))
      : MAX_CHAT_HEIGHT
  return {
    width: Math.round(Math.min(Math.max(MIN_MINI_WIDTH, width), maxW)),
    chatHeight: Math.round(Math.min(Math.max(MIN_CHAT_HEIGHT, chatHeight), maxH)),
  }
}

function loadSavedMiniSize(): MiniPlayerSize {
  const defaultWidth = typeof window !== 'undefined' && window.innerWidth < 640 ? 300 : 350
  const fallback = clampSize(defaultWidth, 176)
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(MINI_SIZE_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<MiniPlayerSize>
    if (
      typeof parsed.width === 'number' &&
      Number.isFinite(parsed.width) &&
      typeof parsed.chatHeight === 'number' &&
      Number.isFinite(parsed.chatHeight)
    ) {
      return clampSize(parsed.width, parsed.chatHeight)
    }
  } catch {
    // ignore storage errors
  }
  return fallback
}

function saveMiniSize(size: MiniPlayerSize) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MINI_SIZE_STORAGE_KEY, JSON.stringify(size))
  } catch {
    // ignore storage errors
  }
}

function clampPosition(x: number, y: number, width: number, height: number): DragPosition {
  if (typeof window === 'undefined') return { x, y }
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)
  return {
    x: Math.min(Math.max(EDGE_MARGIN, x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, y), maxY),
  }
}

function formatMiniTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function renderTextWithCustomEmojis(text: string, tags: string[][]) {
  if (!text.includes(':')) return text
  const map = new Map<string, string>()
  for (const t of tags) {
    if (t[0] !== 'emoji' || !t[1] || !t[2]) continue
    const safe = sanitizePublicHttpsUrl(t[2])
    if (safe) map.set(t[1], safe)
  }
  if (map.size === 0) return text
  const parts = text.split(/(:[a-zA-Z0-9_+-]+:)/g)
  return parts.map((part, idx) => {
    if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
      const url = map.get(part.slice(1, -1))
      if (url) {
        return (
          <img
            key={idx}
            src={url}
            alt={part}
            title={part}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="inline-block w-3.5 h-3.5 align-text-bottom mx-0.5 object-contain"
          />
        )
      }
    }
    return <span key={idx}>{part}</span>
  })
}

const MiniChatMention = memo(function MiniChatMention({
  pubkey,
  bech32,
}: {
  pubkey: string
  bech32: string
}) {
  const profile = useNostrStore((s) => s.profiles[pubkey])
  return (
    <Link to={`/p/${pubkey}`} className="text-[#ff922b] hover:underline font-medium">
      @{profile?.display_name || profile?.name || `${bech32.slice(0, 8)}…`}
    </Link>
  )
})

function MiniBlossomMedia({ url, display }: { url: string; display: string }) {
  const [mode, setMode] = useState<'img' | 'video' | 'link'>('img')
  if (mode === 'link') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#ff8a3d] hover:underline break-all"
      >
        {display}
      </a>
    )
  }
  if (mode === 'video') {
    return (
      <video
        src={`${url}#t=0.001`}
        controls
        playsInline
        preload="metadata"
        onError={() => setMode('link')}
        className="relative z-[6] mt-1 rounded-md max-h-24 max-w-full border border-[#2a2d3d] bg-black"
      />
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-[6] block mt-1"
    >
      <img
        src={url}
        alt="Chat media"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setMode('video')}
        className="rounded-md max-h-24 max-w-full object-contain border border-[#2a2d3d] bg-[#0b0b0e]"
      />
    </a>
  )
}

const MiniChatRow = memo(function MiniChatRow({ msg }: { msg: LiveChatMessage }) {
  const profile = useNostrStore((s) => s.profiles[msg.senderPubkey])
  const senderName =
    profile?.display_name || profile?.name || `${msg.senderPubkey.slice(0, 8)}…`
  const parsed = useMemo(
    () => parseNoteContent({ content: msg.content, tags: msg.tags }),
    [msg.content, msg.tags],
  )
  const parsedMediaUrls = useMemo(
    () => new Set(parsed.media.map((m) => m.url)),
    [parsed.media],
  )
  const hasVisibleSegments = useMemo(
    () =>
      parsed.segments.some((seg) => {
        if (seg.type === 'text') return seg.text.trim().length > 0
        if (seg.type === 'link') {
          const pub = sanitizePublicHttpsUrl(seg.url)
          if (pub && parsedMediaUrls.has(pub)) return false
        }
        return true
      }),
    [parsed.segments, parsedMediaUrls],
  )

  const richBody = (
    <>
      {hasVisibleSegments && (
        <span className="text-[#e4e1d8] whitespace-pre-wrap break-words">
          {parsed.segments.map((seg, i) => {
            if (seg.type === 'text') {
              return <span key={i}>{renderTextWithCustomEmojis(seg.text, msg.tags)}</span>
            }
            if (seg.type === 'link') {
              const publicHttps = sanitizePublicHttpsUrl(seg.url)
              if (publicHttps && parsedMediaUrls.has(publicHttps)) return null
              if (publicHttps && BLOSSOM_HEX_URL_RE.test(publicHttps)) {
                return <MiniBlossomMedia key={i} url={publicHttps} display={seg.display} />
              }
              return (
                <a
                  key={i}
                  href={seg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff8a3d] hover:underline break-all"
                >
                  {seg.display}
                </a>
              )
            }
            if (seg.type === 'hashtag') {
              return (
                <span key={i} className="text-[#f59f00]">
                  #{seg.tag}
                </span>
              )
            }
            if (seg.type === 'mention') {
              return <MiniChatMention key={i} pubkey={seg.pubkey} bech32={seg.bech32} />
            }
            if (seg.type === 'quote' && seg.eventId) {
              return (
                <Link
                  key={i}
                  to={`/e/${seg.eventId}`}
                  className="text-[#ff8a3d] hover:underline"
                >
                  nostr:{seg.bech32.slice(0, 14)}…
                </Link>
              )
            }
            if (seg.type === 'live') {
              return (
                <Link
                  key={i}
                  to={`/live/${seg.bech32}`}
                  className="text-[#ff8a3d] hover:underline"
                >
                  Watch stream
                </Link>
              )
            }
            return null
          })}
        </span>
      )}
      {parsed.media.length > 0 && (
        <div className="mt-1 space-y-1 relative z-[6]">
          {parsed.media.map((m) =>
            m.kind === 'image' ? (
              <a
                key={m.url}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={m.url}
                  alt={m.alt || 'Chat attachment'}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="rounded-md max-h-24 max-w-full object-contain border border-[#2a2d3d] bg-[#0b0b0e]"
                />
              </a>
            ) : m.kind === 'video' ? (
              <video
                key={m.url}
                src={`${m.url}#t=0.001`}
                poster={m.poster}
                controls
                playsInline
                preload="metadata"
                className="rounded-md max-h-24 max-w-full border border-[#2a2d3d] bg-black"
              />
            ) : (
              <audio key={m.url} src={m.url} controls preload="none" className="w-full h-7" />
            ),
          )}
        </div>
      )}
      {parsed.youtube.length > 0 && (
        <div className="mt-1 space-y-1">
          {parsed.youtube.map((yt) => (
            <YouTubeCard key={yt.videoId} video={yt} compact />
          ))}
        </div>
      )}
    </>
  )

  if (msg.isZapAnnouncement) {
    const hasRichContent = hasVisibleSegments || parsed.media.length > 0 || parsed.youtube.length > 0
    return (
      <div className="px-2 py-1 rounded-lg bg-[#f59f00]/12 border border-[#f59f00]/30 text-[11px] leading-snug">
        <div className="flex items-center justify-between gap-1.5">
          <span className="font-semibold text-[#f59f00] flex items-center gap-1 truncate">
            <Zap className="w-3 h-3 fill-[#f59f00] shrink-0" />
            {senderName} · {(msg.zapAmountSats || 0).toLocaleString()} sats
          </span>
          <span className="text-[9px] text-[#8c8a82] shrink-0">{formatMiniTime(msg.createdAt)}</span>
        </div>
        {hasRichContent && <div className="mt-0.5">{richBody}</div>}
      </div>
    )
  }

  return (
    <div className="text-[11px] leading-snug break-words">
      <span className="text-[9px] text-[#6f6d66] mr-1.5">{formatMiniTime(msg.createdAt)}</span>
      <Link
        to={`/p/${msg.senderPubkey}`}
        className="font-semibold text-[#ff922b] hover:underline mr-1.5"
      >
        {senderName}
      </Link>
      {richBody}
    </div>
  )
})

/**
 * Persistent draggable floating Picture-in-Picture mini-player with compact Live Chat,
 * mounted in Layout.tsx so streams & chat stay live while browsing anywhere in Fire Wisp.
 * Also supports OS-level browser Picture-in-Picture across tabs/apps.
 */
export function FloatingStreamPlayer() {
  const miniPlayer = useLiveStore((s) => s.miniPlayer)
  const audioOwner = useLiveStore((s) => s.audioOwner)
  const setAudioOwner = useLiveStore((s) => s.setAudioOwner)
  const mainPlayerActive = useLiveStore((s) => s.mainPlayerActive)
  const hasInlineStream = useLiveStore((s) => Boolean(s.activeInlineStreamKey))
  const rawMiniMessages = useLiveStore((s) => s.miniChatMessages)
  const closeMiniPlayer = useLiveStore((s) => s.closeMiniPlayer)
  const markStreamOffline = useLiveStore((s) => s.markStreamOffline)
  const markStreamOnline = useLiveStore((s) => s.markStreamOnline)
  const subscribeMiniChat = useLiveStore((s) => s.subscribeMiniChat)
  const sendChatMessage = useLiveStore((s) => s.sendChatMessage)

  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)

  const [size, setSize] = useState<MiniPlayerSize>(() => loadSavedMiniSize())
  const [chatOpen, setChatOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true,
  )
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [nativePipSupported, setNativePipSupported] = useState(false)
  const [pos, setPos] = useState<DragPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startPointerX: number
    startPointerY: number
    startLeft: number
    startTop: number
    width: number
    height: number
    moved: boolean
  } | null>(null)
  const resizeStateRef = useRef<{
    pointerId: number
    corner: 'tl' | 'br'
    startPointerX: number
    startPointerY: number
    startWidth: number
    startChatHeight: number
    startLeft: number
    startTop: number
    startRight: number
    startBottom: number
    wasPositioned: boolean
    chatWasOpen: boolean
  } | null>(null)
  const suppressNextLinkClickRef = useRef(false)

  const decoded = useMemo(
    () => (miniPlayer?.naddr ? decodeLiveNaddr(miniPlayer.naddr) : null),
    [miniPlayer?.naddr],
  )

  useEffect(() => {
    setNativePipSupported(
      typeof document !== 'undefined' &&
        'pictureInPictureEnabled' in document &&
        Boolean(document.pictureInPictureEnabled),
    )
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    }
  }, [])

  // Reset per-stream transient UI state & exit leaked native PiP on stream switch or close
  useEffect(() => {
    setDraft('')
    setDragging(false)
    dragStateRef.current = null
    stickToBottomRef.current = true
    if (!miniPlayer) {
      if (
        typeof document !== 'undefined' &&
        document.pictureInPictureElement &&
        document.pictureInPictureElement === videoElRef.current
      ) {
        void document.exitPictureInPicture().catch(() => {})
      }
    }
  }, [miniPlayer?.aTag])

  // Subscribe to live chat & zaps whenever a mini-player stream is active
  useEffect(() => {
    if (!miniPlayer || !decoded) return
    return subscribeMiniChat(decoded.hostPubkey, decoded.dTag, decoded.relays)
  }, [miniPlayer?.aTag, decoded, subscribeMiniChat])

  const messages = useMemo(() => {
    const allMutedPks =
      privateMutedPubkeys.length > 0 ? [...mutedPubkeys, ...privateMutedPubkeys] : mutedPubkeys
    const allMutedWords =
      privateMutedWords.length > 0 ? [...mutedWords, ...privateMutedWords] : mutedWords
    return rawMiniMessages.filter((m) => {
      if (allMutedPks.includes(m.senderPubkey)) return false
      if (allMutedWords.length > 0 && m.content) {
        const lower = m.content.toLowerCase()
        if (allMutedWords.some((w) => w.length >= 2 && lower.includes(w))) return false
      }
      return true
    })
  }, [rawMiniMessages, mutedPubkeys, mutedWords, privateMutedPubkeys, privateMutedWords])

  const lastMessageId = messages[messages.length - 1]?.id

  // Auto-scroll mini chat when pinned to bottom (tracks lastMessageId so it keeps working past the 150-msg cap)
  useEffect(() => {
    if (!chatOpen || !stickToBottomRef.current) return
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, lastMessageId, chatOpen])

  // Keep custom size clamped to viewport across window resizes
  useEffect(() => {
    const onResize = () => {
      setSize((prev) => {
        const clamped = clampSize(prev.width, prev.chatHeight)
        return clamped.width === prev.width && clamped.chatHeight === prev.chatHeight
          ? prev
          : clamped
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Continuously keep dragged mini-player clamped inside the viewport across resizes, reopen, size changes, or chat toggle
  useEffect(() => {
    if (!pos || !miniPlayer) return
    const el = containerRef.current
    if (!el) return
    const reclamp = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      setPos((prev) => {
        if (!prev) return null
        const clamped = clampPosition(prev.x, prev.y, rect.width, rect.height)
        return clamped.x === prev.x && clamped.y === prev.y ? prev : clamped
      })
    }
    reclamp()
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(reclamp)
      ro.observe(el)
    }
    window.addEventListener('resize', reclamp)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', reclamp)
    }
  }, [pos !== null, Boolean(miniPlayer), size.width, size.chatHeight, chatOpen])

  // Corner drag-to-resize listeners
  useEffect(() => {
    if (!resizing) return

    const onPointerMove = (e: PointerEvent) => {
      const st = resizeStateRef.current
      if (!st || e.pointerId !== st.pointerId) return
      const dx = e.clientX - st.startPointerX
      const dy = e.clientY - st.startPointerY

      const rawWidth = st.corner === 'br' ? st.startWidth + dx : st.startWidth - dx
      // Scale chat height smoothly when chat is open (dragging corner vertically adjusts chat height)
      const videoHeightDelta = ((rawWidth - st.startWidth) * 9) / 16
      const rawChatHeight = st.chatWasOpen
        ? st.corner === 'br'
          ? st.startChatHeight + dy - videoHeightDelta
          : st.startChatHeight - dy - videoHeightDelta
        : st.startChatHeight

      const next = clampSize(rawWidth, rawChatHeight)
      setSize(next)
      saveMiniSize(next)

      if (st.corner === 'tl' && st.wasPositioned) {
        const nextTotalHeight =
          st.startBottom - st.startTop + (next.width - st.startWidth) * (9 / 16) +
          (st.chatWasOpen ? next.chatHeight - st.startChatHeight : 0)
        setPos(
          clampPosition(
            st.startRight - next.width,
            st.startBottom - nextTotalHeight,
            next.width,
            nextTotalHeight,
          ),
        )
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const st = resizeStateRef.current
      if (st && e.pointerId !== st.pointerId) return
      resizeStateRef.current = null
      setResizing(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [resizing])

  // Pointer drag listeners (filtered by pointerId so multi-touch or iframes never corrupt drag)
  useEffect(() => {
    if (!dragging) return

    const onPointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current
      if (!st || e.pointerId !== st.pointerId) return
      const dx = e.clientX - st.startPointerX
      const dy = e.clientY - st.startPointerY
      if (!st.moved && Math.hypot(dx, dy) < 4) return
      st.moved = true
      setPos(clampPosition(st.startLeft + dx, st.startTop + dy, st.width, st.height))
    }

    const onPointerUp = (e: PointerEvent) => {
      const st = dragStateRef.current
      if (st && e.pointerId !== st.pointerId) return
      if (st?.moved) {
        suppressNextLinkClickRef.current = true
        if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
        suppressTimerRef.current = setTimeout(() => {
          suppressTimerRef.current = null
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
    const target = e.target as HTMLElement | null
    if (target?.closest('button') || target?.closest('[data-no-drag]')) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore if capture unsupported
    }
    dragStateRef.current = {
      pointerId: e.pointerId,
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

  const handleSendMiniChat = async () => {
    const clean = draft.trim()
    if (!clean || !decoded || sending) return
    setSending(true)
    try {
      await sendChatMessage(decoded.hostPubkey, decoded.dTag, clean)
      setDraft('')
      stickToBottomRef.current = true
    } catch (err) {
      useNostrStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Failed to send chat message')
    } finally {
      setSending(false)
    }
  }

  const handleResizePointerDown = (
    corner: 'tl' | 'br',
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore if capture unsupported
    }
    resizeStateRef.current = {
      pointerId: e.pointerId,
      corner,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startWidth: rect.width,
      startChatHeight: size.chatHeight,
      startLeft: rect.left,
      startTop: rect.top,
      startRight: rect.right,
      startBottom: rect.bottom,
      wasPositioned: pos !== null,
      chatWasOpen: chatOpen && Boolean(decoded),
    }
    setResizing(true)
  }

  const currentPresetIdx = size.width <= 355 ? 0 : size.width <= 485 ? 1 : 2
  const currentPresetLabel = SIZE_PRESETS[currentPresetIdx].label
  const handleCycleSizePreset = () => {
    const nextPreset = SIZE_PRESETS[(currentPresetIdx + 1) % SIZE_PRESETS.length]
    const clamped = clampSize(nextPreset.width, nextPreset.chatHeight)
    setSize(clamped)
    saveMiniSize(clamped)
  }

  const hasCompetingPlayer = mainPlayerActive || hasInlineStream
  const miniHasAudio = audioOwner === 'mini'

  return (
    <div
      ref={containerRef}
      style={{
        width: `${size.width}px`,
        ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : {}),
      }}
      className={`fixed z-40 rounded-2xl overflow-hidden bg-[#12131a]/95 backdrop-blur-md border shadow-2xl shadow-black/75 max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] flex flex-col ${
        pos ? '' : 'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-4 right-2 sm:right-4'
      } ${
        dragging || resizing
          ? 'border-[#ff922b] select-none'
          : miniHasAudio
            ? 'border-[#e8590c]/60 transition-[width]'
            : 'border-[#2f3344] transition-[width]'
      }`}
    >
      {/* Top-left corner drag-to-resize handle (ideal when docked at bottom-right) */}
      <div
        data-no-drag
        onPointerDown={(e) => handleResizePointerDown('tl', e)}
        title="Drag corner to resize mini-player"
        aria-label="Resize mini-player from top-left corner"
        className="absolute top-0 left-0 w-3.5 h-3.5 z-30 cursor-nwse-resize touch-none"
      />

      {/* Draggable compact control header (double-click to snap back to corner) */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onDoubleClick={() => setPos(null)}
        title="Drag to move · Double-click to snap back to corner"
        className={`px-2 py-1.5 bg-[#161822] border-b border-[#252836] flex items-center justify-between gap-1.5 touch-none select-none shrink-0 ${
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
          {(hasCompetingPlayer || !miniHasAudio) && (
            <button
              type="button"
              onClick={() => setAudioOwner(miniHasAudio ? 'main' : 'mini')}
              title={
                miniHasAudio
                  ? 'Mini-player audio is on — click to swap audio to main stream'
                  : 'Swap audio to mini-player (mutes main stream)'
              }
              aria-label={miniHasAudio ? 'Swap audio to main stream' : 'Swap audio to mini-player'}
              className={`px-1.5 py-1 rounded-lg flex items-center gap-1 text-[10px] font-semibold transition cursor-pointer ${
                miniHasAudio
                  ? 'bg-[#e8590c] hover:bg-[#d9480f] text-white'
                  : 'bg-[#1e202c] hover:bg-[#2a2d3d] text-[#c7c4bc] hover:text-white'
              }`}
            >
              {miniHasAudio ? (
                <>
                  <Volume2 className="w-3 h-3" />
                  <span>Audio</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3 h-3" />
                  <span>Swap</span>
                </>
              )}
            </button>
          )}
          {decoded && (
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              title={chatOpen ? 'Hide mini chat' : 'Show mini chat'}
              aria-label={chatOpen ? 'Hide mini chat' : 'Show mini chat'}
              className={`px-1.5 py-1 rounded-lg flex items-center gap-1 text-[10px] font-semibold transition cursor-pointer ${
                chatOpen
                  ? 'bg-[#e8590c]/20 text-[#ff922b]'
                  : 'text-[#9a9890] hover:text-white hover:bg-white/5'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {messages.length > 0 && <span>{messages.length}</span>}
            </button>
          )}
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
            onClick={handleCycleSizePreset}
            title={`Resize mini-player (Current: ${currentPresetLabel} · Click for S / M / L or drag corners)`}
            aria-label={`Resize mini-player (current size ${currentPresetLabel})`}
            className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-[10px] font-semibold text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            {currentPresetIdx === 2 ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
            <span>{currentPresetLabel}</span>
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
      <div className="shrink-0">
        <HlsVideoPlayer
          key={miniPlayer.aTag}
          streamUrl={miniPlayer.streamUrl}
          posterUrl={miniPlayer.posterUrl}
          title={miniPlayer.title}
          isLive={miniPlayer.isLive}
          autoStart
          compact
          forceMuted={!miniHasAudio}
          onRequestFocus={() => setAudioOwner('mini')}
          onVideoElement={handleVideoElement}
          onPlaybackReady={() => markStreamOnline(miniPlayer.aTag)}
          onStreamOffline={() => markStreamOffline(miniPlayer.aTag)}
        />
      </div>

      {/* Compact Collapsible Live Chat */}
      {chatOpen && decoded && (
        <div className="border-t border-[#222532] bg-[#101118] flex flex-col min-h-0 flex-1">
          <div
            ref={chatScrollRef}
            onScroll={() => {
              const el = chatScrollRef.current
              if (!el) return
              stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
            }}
            style={{ height: `${size.chatHeight}px` }}
            className="min-h-[96px] overflow-y-auto px-2.5 py-2 space-y-1.5"
          >
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[11px] text-[#6f6d66]">
                No live chat messages yet.
              </div>
            ) : (
              messages.map((m) => <MiniChatRow key={m.id} msg={m} />)
            )}
          </div>

          <div className="px-2 py-1.5 border-t border-[#20222c] bg-[#14151e] shrink-0">
            {signer?.canSign ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSendMiniChat()
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Chat in stream…"
                  className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-[#0e0e11] border border-[#262938] focus:border-[#e8590c] text-xs text-white placeholder-[#6f6d66] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  aria-label="Send chat message"
                  className="p-1.5 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-white shrink-0 transition cursor-pointer disabled:cursor-default"
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={openAuthModal}
                className="w-full py-1 rounded-lg bg-[#1d1f29] hover:bg-[#262936] text-[11px] font-medium text-[#ff922b] cursor-pointer"
              >
                Sign in to chat
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom-right corner drag-to-resize handle with subtle visual grip */}
      <div
        data-no-drag
        onPointerDown={(e) => handleResizePointerDown('br', e)}
        title="Drag corner to resize mini-player"
        aria-label="Resize mini-player from bottom-right corner"
        className="absolute bottom-0 right-0 w-4 h-4 z-30 cursor-nwse-resize touch-none flex items-end justify-end p-0.5 opacity-60 hover:opacity-100 transition"
      >
        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-[#9a9890] pointer-events-none">
          <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
