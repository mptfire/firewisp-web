import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  ChevronDown,
  ChevronUp,
  Columns2,
  CornerDownRight,
  ImagePlus,
  Loader2,
  MessageCircle,
  PictureInPicture2,
  Radio,
  Send,
  Share2,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react'
import {
  buildCandidateServers,
  buildImetaTag,
  formatBlossomHost,
  uploadToBlossom,
  type BlossomUploadResult,
} from '../lib/nostr/blossom'
import { parseNoteContent, type MediaAttachment } from '../lib/nostr/content'
import { buildLiveATag, decodeLiveNaddr, encodeLiveNaddr, isPlayableStreamUrl } from '../lib/nostr/nip53'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore, type LiveChatMessage } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'
import { HlsVideoPlayer } from '../components/HlsVideoPlayer'
import { LiveNowRow } from '../components/LiveNowRow'
import { MediaLightbox } from '../components/MediaLightbox'
import { ShareStreamModal } from '../components/ShareStreamModal'
import { StreamTopZappersCard } from '../components/StreamTopZappersCard'
import { StreamZapBar } from '../components/StreamZapBar'
import { WatchWithModal, type WatchWithSelection } from '../components/WatchWithModal'
import { YouTubeCard } from '../components/YouTubeCard'

// Matches extensionless Blossom SHA-256 blob URLs (e.g. https://blossom.primal.net/<64-hex> or https://host/prefix/<64-hex>)
const BLOSSOM_HEX_URL_RE = /^https:\/\/[^/]+(?:\/[^/?#]+)*\/[0-9a-f]{64}(?:\?.*)?$/i

function formatChatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractCustomEmojis(tags: string[][]): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of tags) {
    if (t[0] !== 'emoji' || !t[1] || !t[2]) continue
    const safe = sanitizePublicHttpsUrl(t[2])
    if (safe) map.set(t[1], safe)
  }
  return map
}

function renderTextWithCustomEmojis(text: string, emojiMap: Map<string, string>) {
  if (emojiMap.size === 0 || !text.includes(':')) return text
  const parts = text.split(/(:[a-zA-Z0-9_+-]+:)/g)
  return parts.map((part, idx) => {
    if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
      const code = part.slice(1, -1)
      const url = emojiMap.get(code)
      if (url) {
        return (
          <img
            key={idx}
            src={url}
            alt={part}
            title={part}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="inline-block w-4 h-4 align-text-bottom mx-0.5 object-contain"
          />
        )
      }
    }
    return <span key={idx}>{part}</span>
  })
}

/** Renders an extensionless Blossom SHA-256 URL as image -> video -> clickable link fallback */
function BlossomBlobMedia({
  url,
  display,
  onOpenLightbox,
}: {
  url: string
  display: string
  onOpenLightbox: (m: MediaAttachment) => void
}) {
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
        className="block mt-1.5 max-h-44 max-w-full rounded-lg border border-[#2a2d3d] bg-black"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpenLightbox({ url, kind: 'image' })}
      className="block mt-1.5 rounded-lg overflow-hidden border border-[#2a2d3d] bg-[#0e0e11] hover:border-[#e8590c]/60 transition cursor-pointer"
    >
      <img
        src={url}
        alt="Chat media"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setMode('video')}
        className="max-h-44 max-w-full object-contain"
      />
    </button>
  )
}

function ChatMention({ pubkey, bech32 }: { pubkey: string; bech32: string }) {
  const profile = useNostrStore((s) => s.profiles[pubkey])
  const label = profile?.display_name || profile?.name || `${bech32.slice(0, 10)}…`
  return (
    <Link to={`/p/${pubkey}`} className="text-[#ff922b] hover:underline font-medium">
      @{label}
    </Link>
  )
}

function ChatBubble({
  msg,
  replyParent,
  myPubkey,
  onReply,
  onBlock,
  onOpenLightbox,
}: {
  msg: LiveChatMessage
  replyParent?: LiveChatMessage
  myPubkey: string | null
  onReply: (m: LiveChatMessage) => void
  onBlock: (pk: string, name: string) => void
  onOpenLightbox: (m: MediaAttachment) => void
}) {
  const profile = useNostrStore((s) => s.profiles[msg.senderPubkey])
  const parentProfile = useNostrStore((s) =>
    replyParent ? s.profiles[replyParent.senderPubkey] : undefined,
  )
  const name = profile?.display_name || profile?.name || `${msg.senderPubkey.slice(0, 8)}…`
  const isMe = Boolean(myPubkey && myPubkey.toLowerCase() === msg.senderPubkey)

  const parsed = useMemo(
    () => parseNoteContent({ content: msg.content, tags: msg.tags || [] }),
    [msg.content, msg.tags],
  )
  const emojiMap = useMemo(() => extractCustomEmojis(msg.tags || []), [msg.tags])
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

  if (msg.isZapAnnouncement) {
    return (
      <div className="px-3 py-2 rounded-xl bg-[#f59f00]/12 border border-[#f59f00]/35 text-xs">
        <div className="flex items-center gap-1.5 text-[#f59f00] font-semibold">
          <Zap className="w-3.5 h-3.5 fill-[#f59f00]" />
          <Link to={`/p/${msg.senderPubkey}`} className="hover:underline truncate">
            {name}
          </Link>
          <span>zapped {(msg.zapAmountSats || 0).toLocaleString()} sats</span>
        </div>
        {msg.content && <p className="mt-1 text-[#ece9e1] break-words">{msg.content}</p>}
      </div>
    )
  }

  return (
    <div className="group px-2.5 py-1.5 rounded-xl hover:bg-white/[0.03] transition">
      {replyParent && (
        <div className="flex items-center gap-1 text-[10px] text-[#8c8a82] mb-0.5 truncate">
          <CornerDownRight className="w-2.5 h-2.5 shrink-0" />
          <span className="font-medium">
            {parentProfile?.display_name ||
              parentProfile?.name ||
              `${replyParent.senderPubkey.slice(0, 8)}…`}
            :
          </span>
          <span className="truncate">{replyParent.content}</span>
        </div>
      )}
      <div className="flex items-start gap-2">
        <Link to={`/p/${msg.senderPubkey}`} className="shrink-0 mt-0.5">
          <Avatar src={profile?.picture} pubkey={msg.senderPubkey} name={name} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <Link
                to={`/p/${msg.senderPubkey}`}
                className="text-xs font-semibold text-[#ff922b] hover:underline truncate"
              >
                {name}
              </Link>
              <span className="text-[10px] text-[#6f6d66] shrink-0">
                {formatChatTime(msg.createdAt)}
              </span>
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition shrink-0">
              <button
                type="button"
                onClick={() => onReply(msg)}
                title="Reply"
                className="p-1 rounded text-[#8c8a82] hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <MessageCircle className="w-3 h-3" />
              </button>
              {!isMe && (
                <button
                  type="button"
                  onClick={() => onBlock(msg.senderPubkey, name)}
                  title={`Block ${name}`}
                  className="fw-edge-btn fw-edge-sm fw-edge-block p-1 text-red-300 hover:text-red-200 cursor-pointer"
                >
                  <Ban className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Rich chat text + inline extensionless Blossom media */}
          {hasVisibleSegments && (
            <div className="text-xs text-[#ece9e1] whitespace-pre-wrap break-words leading-relaxed">
              {parsed.segments.map((seg, idx) => {
                if (seg.type === 'text') {
                  return <span key={idx}>{renderTextWithCustomEmojis(seg.text, emojiMap)}</span>
                }
                if (seg.type === 'link') {
                  const publicHttps = sanitizePublicHttpsUrl(seg.url)
                  if (publicHttps && parsedMediaUrls.has(publicHttps)) return null
                  if (publicHttps && BLOSSOM_HEX_URL_RE.test(publicHttps)) {
                    return (
                      <BlossomBlobMedia
                        key={idx}
                        url={publicHttps}
                        display={seg.display}
                        onOpenLightbox={onOpenLightbox}
                      />
                    )
                  }
                  return (
                    <a
                      key={idx}
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
                    <Link
                      key={idx}
                      to={`/search?q=${encodeURIComponent('#' + seg.tag)}`}
                      className="text-[#f59f00] hover:underline"
                    >
                      #{seg.tag}
                    </Link>
                  )
                }
                if (seg.type === 'mention') {
                  return <ChatMention key={idx} pubkey={seg.pubkey} bech32={seg.bech32} />
                }
                if (seg.type === 'quote' && seg.eventId) {
                  return (
                    <Link
                      key={idx}
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
                      key={idx}
                      to={`/live/${seg.bech32}`}
                      className="text-[#ff8a3d] hover:underline"
                    >
                      Watch stream
                    </Link>
                  )
                }
                return null
              })}
            </div>
          )}

          {/* Standard & imeta media attachments (images, gifs, videos, audio) */}
          {parsed.media.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {parsed.media.map((m) =>
                m.kind === 'image' ? (
                  <button
                    key={m.url}
                    type="button"
                    onClick={() => onOpenLightbox(m)}
                    className="block rounded-lg overflow-hidden border border-[#2a2d3d] bg-[#0e0e11] hover:border-[#e8590c]/60 transition cursor-pointer"
                  >
                    <img
                      src={m.url}
                      alt={m.alt || 'Chat media'}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="max-h-44 max-w-full object-contain"
                    />
                  </button>
                ) : m.kind === 'video' ? (
                  <video
                    key={m.url}
                    src={`${m.url}#t=0.001`}
                    poster={m.poster}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-44 max-w-full rounded-lg border border-[#2a2d3d] bg-black"
                  />
                ) : (
                  <audio key={m.url} src={m.url} controls preload="none" className="w-full h-8" />
                ),
              )}
            </div>
          )}

          {/* YouTube link preview cards in Live Chat */}
          {parsed.youtube.length > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {parsed.youtube.map((yt) => (
                <YouTubeCard key={yt.videoId} video={yt} compact />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function LiveStreamPage() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const signer = useAuthStore((s) => s.signer)
  const myPubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)

  const decoded = useMemo(() => (naddr ? decodeLiveNaddr(naddr) : null), [naddr])

  const activeActivity = useLiveStore((s) => s.activeActivity)
  const rawMessages = useLiveStore((s) => s.currentChatMessages)
  const streamZapTotal = useLiveStore((s) => s.streamZapTotal)
  const loadingStream = useLiveStore((s) => s.loadingStream)
  const subscribeActiveStream = useLiveStore((s) => s.subscribeActiveStream)
  const subscribeFocusedChat = useLiveStore((s) => s.subscribeFocusedChat)
  const sendChatMessage = useLiveStore((s) => s.sendChatMessage)
  const markStreamOffline = useLiveStore((s) => s.markStreamOffline)
  const markStreamOnline = useLiveStore((s) => s.markStreamOnline)
  const openMiniPlayer = useLiveStore((s) => s.openMiniPlayer)
  const closeMiniPlayer = useLiveStore((s) => s.closeMiniPlayer)
  const [resumedFromMini, setResumedFromMini] = useState(() => {
    if (!decoded) return false
    const aTagInit = buildLiveATag(decoded.hostPubkey, decoded.dTag)
    return useLiveStore.getState().miniPlayer?.aTag === aTagInit
  })

  const [companion, setCompanion] = useState<WatchWithSelection | null>(null)
  const [audioSlot, setAudioSlot] = useState<'primary' | 'companion'>('primary')
  const [chatSlot, setChatSlot] = useState<'primary' | 'companion'>('primary')
  const [watchWithOpen, setWatchWithOpen] = useState(false)
  const pendingSwapRef = useRef<WatchWithSelection | null>(null)

  const companionATag = companion ? buildLiveATag(companion.hostPubkey, companion.dTag) : ''
  const liveCompanionActivity = useLiveStore((s) =>
    companionATag ? s.liveStreams[companionATag]?.activity : undefined,
  )
  const companionActivity = liveCompanionActivity || companion?.activity || null

  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const mutePubkey = useSettingsStore((s) => s.mutePubkey)
  const blossomServers = useSettingsStore((s) => s.blossomServers)

  const primaryHostPubkey =
    activeActivity?.streamerPubkey || activeActivity?.hostPubkey || decoded?.hostPubkey || ''
  const primaryHostProfile = useNostrStore((s) =>
    primaryHostPubkey ? s.profiles[primaryHostPubkey] : undefined,
  )
  const companionHostPubkey =
    companionActivity?.streamerPubkey || companionActivity?.hostPubkey || companion?.hostPubkey || ''
  const companionHostProfile = useNostrStore((s) =>
    companionHostPubkey ? s.profiles[companionHostPubkey] : undefined,
  )
  const follows = useNostrStore((s) => s.follows)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<BlossomUploadResult[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadingHost, setUploadingHost] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const primaryBlossomHost = useMemo(() => {
    const first = buildCandidateServers(blossomServers)[0]
    return first ? formatBlossomHost(first) : 'Blossom'
  }, [blossomServers])
  const [sending, setSending] = useState(false)
  const [replyTarget, setReplyTarget] = useState<LiveChatMessage | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [showOtherStreams, setShowOtherStreams] = useState(false)
  const [lightboxMedia, setLightboxMedia] = useState<MediaAttachment | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const currentATagStr = decoded ? buildLiveATag(decoded.hostPubkey, decoded.dTag) : ''
  const prevATagRef = useRef(currentATagStr)

  const isSplitView = Boolean(companion && companionATag && companionATag !== currentATagStr)
  const activeAudioSlot: 'primary' | 'companion' = isSplitView ? audioSlot : 'primary'
  const activeChatSlot: 'primary' | 'companion' = isSplitView ? chatSlot : 'primary'
  const focusedChatHost =
    activeChatSlot === 'companion' && companion ? companion.hostPubkey : decoded?.hostPubkey || ''
  const focusedChatDTag =
    activeChatSlot === 'companion' && companion ? companion.dTag : decoded?.dTag || ''
  const focusedChatATag =
    focusedChatHost && focusedChatDTag ? buildLiveATag(focusedChatHost, focusedChatDTag) : ''
  const focusedChatRelays =
    activeChatSlot === 'companion' && companion
      ? companionActivity?.relayHints?.length
        ? companionActivity.relayHints
        : companion.relays
      : activeActivity?.relayHints?.length
        ? activeActivity.relayHints
        : decoded?.relays || []
  const focusedChatTitleRaw =
    activeChatSlot === 'companion'
      ? companionActivity?.title ||
        companionHostProfile?.display_name ||
        companionHostProfile?.name ||
        'Second Stream'
      : activeActivity?.title ||
        primaryHostProfile?.display_name ||
        primaryHostProfile?.name ||
        'Live Stream'
  const focusedChatRelaysRef = useRef(focusedChatRelays)
  const focusedChatTitleRef = useRef(focusedChatTitleRaw)
  focusedChatRelaysRef.current = focusedChatRelays
  focusedChatTitleRef.current = focusedChatTitleRaw

  useEffect(() => {
    if (!decoded) return
    return subscribeActiveStream(decoded.hostPubkey, decoded.dTag, decoded.relays)
  }, [decoded, subscribeActiveStream])

  // Subscribe chat & Top Zappers strictly to whichever stream currently has audio/chat focus
  useEffect(() => {
    if (!focusedChatHost || !focusedChatDTag) return
    setReplyTarget(null)
    stickToBottomRef.current = true
    return subscribeFocusedChat(
      focusedChatHost,
      focusedChatDTag,
      focusedChatRelaysRef.current,
      focusedChatTitleRef.current,
    )
  }, [focusedChatHost, focusedChatDTag, subscribeFocusedChat])

  // Keep Top Zappers card subtitle synced as stream metadata finishes loading without reconnecting chat
  useEffect(() => {
    if (!focusedChatATag) return
    useLiveStore.setState((s) =>
      s.focusedChatATag === focusedChatATag && s.focusedChatTitle !== focusedChatTitleRaw
        ? { focusedChatTitle: focusedChatTitleRaw }
        : s,
    )
  }, [focusedChatATag, focusedChatTitleRaw])

  // Reset per-stream composer/modal state on /live/:naddr navigation and dock mini-player cleanly (StrictMode-safe)
  useEffect(() => {
    const streamChanged = prevATagRef.current !== currentATagStr
    prevATagRef.current = currentATagStr
    if (streamChanged) {
      setDraft('')
      setAttachments([])
      setReplyTarget(null)
      setShareOpen(false)
      setWatchWithOpen(false)
      setLightboxMedia(null)
      stickToBottomRef.current = true
      if (pendingSwapRef.current) {
        setCompanion(pendingSwapRef.current)
        pendingSwapRef.current = null
        setAudioSlot('primary')
        setChatSlot('primary')
      } else {
        setCompanion(null)
        setAudioSlot('primary')
        setChatSlot('primary')
      }
    }
    if (!currentATagStr) {
      setResumedFromMini(false)
      return
    }
    const activeMini = useLiveStore.getState().miniPlayer
    if (activeMini && activeMini.aTag === currentATagStr) {
      setResumedFromMini(true)
      closeMiniPlayer()
    } else if (streamChanged) {
      setResumedFromMini(false)
    }
  }, [currentATagStr, closeMiniPlayer])

  const messages = useMemo(() => {
    const allMutedPks =
      privateMutedPubkeys.length > 0 ? [...mutedPubkeys, ...privateMutedPubkeys] : mutedPubkeys
    const allMutedWords =
      privateMutedWords.length > 0 ? [...mutedWords, ...privateMutedWords] : mutedWords
    return rawMessages.filter((m) => {
      if (allMutedPks.includes(m.senderPubkey)) return false
      if (allMutedWords.length > 0 && m.content) {
        const lower = m.content.toLowerCase()
        if (allMutedWords.some((w) => w.length >= 2 && lower.includes(w))) return false
      }
      return true
    })
  }, [rawMessages, mutedPubkeys, mutedWords, privateMutedPubkeys, privateMutedWords])

  const messageById = useMemo(() => {
    const map = new Map<string, LiveChatMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  const lastMessageId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, lastMessageId])

  if (!decoded) {
    return (
      <div className="p-10 text-center space-y-3">
        <p className="text-sm text-[#9a9890]">Invalid live stream link.</p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-xl bg-[#e8590c] text-xs font-semibold cursor-pointer"
        >
          Back to Feed
        </button>
      </div>
    )
  }

  const primaryHostName =
    primaryHostProfile?.display_name ||
    primaryHostProfile?.name ||
    `${primaryHostPubkey.slice(0, 10)}…`
  const companionHostName =
    companionHostProfile?.display_name ||
    companionHostProfile?.name ||
    `${companionHostPubkey.slice(0, 10)}…`
  const nowSec = Math.floor(Date.now() / 1000)
  const isExpired = Boolean(
    activeActivity?.ends && activeActivity.ends > 0 && activeActivity.ends <= nowSec,
  )
  const isLive = activeActivity?.status === 'live' && !isExpired
  const rawCandidateUrl =
    activeActivity?.status === 'ended' || isExpired
      ? activeActivity?.recordingUrl
      : activeActivity?.streamingUrl || activeActivity?.recordingUrl
  const playableUrl = isPlayableStreamUrl(rawCandidateUrl) ? rawCandidateUrl : undefined
  const aTag = currentATagStr
  const primaryTitle = activeActivity?.title || `${primaryHostName}'s stream`

  const companionExpired = Boolean(
    companionActivity?.ends && companionActivity.ends > 0 && companionActivity.ends <= nowSec,
  )
  const companionIsLive = companionActivity?.status === 'live' && !companionExpired
  const companionRawUrl =
    companionActivity?.status === 'ended' || companionExpired
      ? companionActivity?.recordingUrl
      : companionActivity?.streamingUrl || companionActivity?.recordingUrl
  const companionPlayableUrl = isPlayableStreamUrl(companionRawUrl) ? companionRawUrl : undefined
  const companionTitle = companionActivity?.title || `${companionHostName}'s stream`

  // Active chat tab drives Stream Info, Zap, Follow, Share, Live Chat & Top Zappers (independent of Audio!)
  const focusedActivity = activeChatSlot === 'companion' ? companionActivity : activeActivity
  const hostPubkey = activeChatSlot === 'companion' ? companionHostPubkey : primaryHostPubkey
  const hostProfile = activeChatSlot === 'companion' ? companionHostProfile : primaryHostProfile
  const hostName = activeChatSlot === 'companion' ? companionHostName : primaryHostName
  const focusedIsLive = activeChatSlot === 'companion' ? companionIsLive : isLive
  const focusedTitle = activeChatSlot === 'companion' ? companionTitle : primaryTitle
  const focusedATag = activeChatSlot === 'companion' && companionATag ? companionATag : aTag
  const focusedPublisherPubkey =
    activeChatSlot === 'companion' && companion ? companion.hostPubkey : decoded.hostPubkey
  const focusedDTag = activeChatSlot === 'companion' && companion ? companion.dTag : decoded.dTag
  const focusedRelays =
    activeChatSlot === 'companion' && companion
      ? companionActivity?.relayHints?.length
        ? companionActivity.relayHints
        : companion.relays
      : activeActivity?.relayHints?.length
        ? activeActivity.relayHints
        : decoded.relays
  const isMe = Boolean(myPubkey && hostPubkey && myPubkey.toLowerCase() === hostPubkey.toLowerCase())
  const isFollowing = Boolean(hostPubkey && follows.includes(hostPubkey.toLowerCase()))

  const handlePopOutMiniPlayer = () => {
    const useCompanion = activeAudioSlot === 'companion' && Boolean(companionPlayableUrl && companion)
    const targetUrl = useCompanion ? companionPlayableUrl : playableUrl
    if (!targetUrl) return
    const targetPub = useCompanion && companion ? companion.hostPubkey : decoded.hostPubkey
    const targetDTag = useCompanion && companion ? companion.dTag : decoded.dTag
    const targetRelays =
      useCompanion && companion
        ? companionActivity?.relayHints?.length
          ? companionActivity.relayHints
          : companion.relays
        : activeActivity?.relayHints?.length
          ? activeActivity.relayHints
          : decoded.relays
    const addr = encodeLiveNaddr(targetPub, targetDTag, targetRelays)
    openMiniPlayer({
      aTag: useCompanion ? companionATag : aTag,
      naddr: addr,
      streamUrl: targetUrl,
      posterUrl: (useCompanion ? companionActivity : activeActivity)?.image,
      title: useCompanion ? companionTitle : primaryTitle,
      hostName: useCompanion ? companionHostName : primaryHostName,
      isLive: useCompanion ? companionIsLive : isLive,
    })
    navigate('/')
  }

  const handleSwapStreams = () => {
    if (!companion) return
    const prevPrimaryAddr = encodeLiveNaddr(
      decoded.hostPubkey,
      decoded.dTag,
      activeActivity?.relayHints || decoded.relays,
    )
    pendingSwapRef.current = {
      hostPubkey: decoded.hostPubkey,
      dTag: decoded.dTag,
      relays: activeActivity?.relayHints || decoded.relays,
      naddr: prevPrimaryAddr,
      activity: activeActivity,
    }
    navigate(`/live/${companion.naddr}`)
  }

  const handleUploadFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    const list = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    )
    if (list.length === 0) {
      useNostrStore.getState().setToast('Drop an image or video to upload via Blossom')
      return
    }
    setUploading(true)
    setUploadingHost(primaryBlossomHost)
    try {
      for (const file of list.slice(0, 3)) {
        const res = await uploadToBlossom(
          file,
          file.type || 'application/octet-stream',
          signer,
          blossomServers,
          fetch,
          ({ host }) => setUploadingHost(host),
        )
        setAttachments((prev) => [...prev, res])
        useNostrStore.getState().setToast(`Uploaded to ${formatBlossomHost(res.server)}`)
      }
    } catch (err) {
      useNostrStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Blossom upload failed')
    } finally {
      setUploading(false)
      setUploadingHost(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSend = async () => {
    const cleanText = draft.trim()
    if ((!cleanText && attachments.length === 0) || sending || uploading) return
    setSending(true)
    try {
      const mediaUrls = attachments.map((a) => a.url).join('\n')
      const fullContent = [cleanText, mediaUrls].filter(Boolean).join('\n')
      const imetaTags = attachments.map((a) => buildImetaTag(a))
      await sendChatMessage(
        focusedPublisherPubkey,
        focusedDTag,
        fullContent,
        replyTarget?.id,
        imetaTags,
      )
      setDraft('')
      setAttachments([])
      setReplyTarget(null)
    } catch (err) {
      useNostrStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-52px)] md:min-h-screen">
      {/* Top Bar */}
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/95 backdrop-blur-md border-b border-[#20222c] px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-3 py-2 rounded-xl bg-[#1a1c26] hover:bg-[#e8590c] border border-[#32364a] hover:border-[#e8590c] text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition shadow-sm shrink-0 cursor-pointer"
            aria-label="Back to Feed"
            title="Return to main feed"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            <span className="hidden sm:inline">Back to Feed</span>
          </button>
          <div className="min-w-0 flex items-center gap-2">
            {isLive ? (
              <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shrink-0">
                <Radio className="w-2.5 h-2.5 animate-pulse" />
                LIVE
              </span>
            ) : activeActivity?.status === 'ended' ? (
              <span className="px-2 py-0.5 rounded bg-[#252836] text-[#9a9890] text-[10px] font-bold uppercase shrink-0">
                ENDED
              </span>
            ) : null}
            <h1 className="font-bold text-sm sm:text-base truncate">
              {activeActivity?.title || 'Live Stream'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setWatchWithOpen(true)}
            title={
              isSplitView
                ? 'Change second stream or exit split view'
                : 'Watch With — add a second stream side-by-side (1 audio at a time, switch chats freely)'
            }
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              isSplitView
                ? 'bg-[#e8590c] hover:bg-[#d9480f] border-[#ff922b]/50 text-white'
                : 'bg-[#181a22] hover:bg-[#222533] border-[#2a2d3a] text-[#d4d2cb] hover:text-white'
            }`}
          >
            <Columns2 className={`w-3.5 h-3.5 ${isSplitView ? 'text-white' : 'text-[#ff922b]'}`} />
            <span className="hidden sm:inline">{isSplitView ? 'Watching 2' : 'Watch With'}</span>
          </button>
          {(activeAudioSlot === 'companion' ? companionPlayableUrl : playableUrl) && (
            <button
              type="button"
              onClick={handlePopOutMiniPlayer}
              title="Pop out mini-player and keep watching while browsing Fire Wisp"
              className="px-2.5 py-1.5 rounded-lg bg-[#e8590c]/15 hover:bg-[#e8590c] border border-[#e8590c]/40 text-xs font-medium text-[#ff922b] hover:text-white flex items-center gap-1.5 transition cursor-pointer"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Mini-player</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            title="Share stream on Nostr or copy link"
            className="px-2.5 py-1.5 rounded-lg bg-[#181a22] hover:bg-[#222533] border border-[#2a2d3a] text-xs font-medium text-[#d4d2cb] hover:text-white flex items-center gap-1.5 shrink-0 transition cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5 text-[#ff922b]" />
            <span className="hidden sm:inline">Share</span>
          </button>
        </div>
      </div>

      {/* Main Stage: Single or Dual Watch With Video(s) + 1 Active Live Chat */}
      <div className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-stretch gap-3">
          {/* Video Stage (1 stream normally, 2 streams side-by-side in Watch With mode) */}
          <div
            className={`flex-1 min-w-0 ${
              isSplitView ? 'grid grid-cols-1 xl:grid-cols-2 gap-3 items-start' : ''
            }`}
          >
            {/* Primary Stream Pane */}
            <div
              className={
                isSplitView
                  ? `rounded-xl overflow-hidden border transition bg-[#12131a] ${
                      activeAudioSlot === 'primary'
                        ? 'border-[#e8590c] ring-1 ring-[#e8590c]/45'
                        : 'border-[#232530]'
                    }`
                  : ''
              }
            >
              {isSplitView && (
                <div className="px-2.5 py-1.5 bg-[#15161f] border-b border-[#222532] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isLive && (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-white truncate">{primaryTitle}</span>
                    <span className="text-[11px] text-[#8c8a82] truncate hidden sm:inline">
                      · {primaryHostName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAudioSlot((prev) => (prev === 'primary' ? 'companion' : 'primary'))
                    }
                    title={
                      activeAudioSlot === 'primary'
                        ? 'Audio playing here — click to swap audio to the other stream'
                        : 'Swap audio to this stream (mutes the other)'
                    }
                    className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer ${
                      activeAudioSlot === 'primary'
                        ? 'bg-[#e8590c] hover:bg-[#d9480f] text-white'
                        : 'bg-[#1e202c] hover:bg-[#2a2d3d] text-[#b8b5ad] hover:text-white'
                    }`}
                  >
                    {activeAudioSlot === 'primary' ? (
                      <>
                        <Volume2 className="w-3 h-3" />
                        Audio On
                      </>
                    ) : (
                      <>
                        <VolumeX className="w-3 h-3" />
                        Audio Swap
                      </>
                    )}
                  </button>
                </div>
              )}

              {loadingStream && !activeActivity ? (
                <div className="w-full aspect-video rounded-xl bg-[#15161c] border border-[#232530] flex items-center justify-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#e8590c]" />
                </div>
              ) : playableUrl ? (
                <HlsVideoPlayer
                  key={aTag}
                  streamUrl={playableUrl}
                  posterUrl={activeActivity?.image}
                  title={activeActivity?.title}
                  isLive={isLive}
                  autoStart={resumedFromMini}
                  compact={isSplitView}
                  forceMuted={isSplitView ? activeAudioSlot !== 'primary' : undefined}
                  onRequestFocus={isSplitView ? () => setAudioSlot('primary') : undefined}
                  onPlaybackStart={() => {
                    // Stop any other stream running in mini-player or inline feed to prevent duplicate audio
                    if (useLiveStore.getState().miniPlayer) closeMiniPlayer()
                    useLiveStore.getState().setActiveInlineStream(null)
                  }}
                  onPopOut={isSplitView ? undefined : handlePopOutMiniPlayer}
                  onPlaybackReady={() => markStreamOnline(aTag)}
                  onStreamOffline={() => markStreamOffline(aTag)}
                />
              ) : (
                <div className="w-full aspect-video rounded-xl bg-[#15161c] border border-[#232530] flex flex-col items-center justify-center p-6 text-center gap-2">
                  {activeActivity?.image && (
                    <img
                      src={activeActivity.image}
                      alt={activeActivity.title || 'Stream'}
                      referrerPolicy="no-referrer"
                      className="max-h-40 rounded-lg object-contain mb-2"
                    />
                  )}
                  <p className="text-sm font-medium text-[#d4d2cb]">
                    {activeActivity?.status === 'ended'
                      ? 'This live stream has ended.'
                      : 'No playable HTTPS stream URL was published for this event.'}
                  </p>
                </div>
              )}
            </div>

            {/* Companion Stream Pane (Watch With mode) */}
            {isSplitView && companion && (
              <div
                className={`rounded-xl overflow-hidden border transition bg-[#12131a] ${
                  activeAudioSlot === 'companion'
                    ? 'border-[#e8590c] ring-1 ring-[#e8590c]/45'
                    : 'border-[#232530]'
                }`}
              >
                <div className="px-2.5 py-1.5 bg-[#15161f] border-b border-[#222532] flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {companionIsLive && (
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-white truncate">
                      {companionTitle}
                    </span>
                    <span className="text-[11px] text-[#8c8a82] truncate hidden sm:inline">
                      · {companionHostName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setAudioSlot((prev) => (prev === 'companion' ? 'primary' : 'companion'))
                      }
                      title={
                        activeAudioSlot === 'companion'
                          ? 'Audio playing here — click to swap audio to the other stream'
                          : 'Swap audio to this stream (mutes the other)'
                      }
                      className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                        activeAudioSlot === 'companion'
                          ? 'bg-[#e8590c] hover:bg-[#d9480f] text-white'
                          : 'bg-[#1e202c] hover:bg-[#2a2d3d] text-[#b8b5ad] hover:text-white'
                      }`}
                    >
                      {activeAudioSlot === 'companion' ? (
                        <>
                          <Volume2 className="w-3 h-3" />
                          Audio On
                        </>
                      ) : (
                        <>
                          <VolumeX className="w-3 h-3" />
                          Audio Swap
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleSwapStreams}
                      title="Swap streams (make this the main stream)"
                      aria-label="Swap streams"
                      className="p-1 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/10 cursor-pointer"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setWatchWithOpen(true)}
                      title="Pick a different second stream"
                      aria-label="Change second stream"
                      className="p-1 rounded-lg text-[#9a9890] hover:text-[#ff922b] hover:bg-white/10 cursor-pointer"
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCompanion(null)
                        setAudioSlot('primary')
                        setChatSlot('primary')
                      }}
                      title="Close second stream"
                      aria-label="Close second stream"
                      className="p-1 rounded-lg text-[#9a9890] hover:text-red-400 hover:bg-white/10 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {companionPlayableUrl ? (
                  <HlsVideoPlayer
                    key={companionATag}
                    streamUrl={companionPlayableUrl}
                    posterUrl={companionActivity?.image}
                    title={companionTitle}
                    isLive={companionIsLive}
                    autoStart
                    compact
                    forceMuted={activeAudioSlot !== 'companion'}
                    onRequestFocus={() => setAudioSlot('companion')}
                    onPlaybackStart={() => {
                      if (useLiveStore.getState().miniPlayer) closeMiniPlayer()
                      useLiveStore.getState().setActiveInlineStream(null)
                    }}
                    onPlaybackReady={() => markStreamOnline(companionATag)}
                    onStreamOffline={() => markStreamOffline(companionATag)}
                  />
                ) : (
                  <div className="w-full aspect-video bg-[#15161c] flex flex-col items-center justify-center p-6 text-center gap-2">
                    <p className="text-xs font-medium text-[#d4d2cb]">
                      No playable stream URL available for this companion stream.
                    </p>
                    <button
                      type="button"
                      onClick={() => setWatchWithOpen(true)}
                      className="px-3 py-1.5 rounded-lg bg-[#e8590c] text-xs font-semibold text-white cursor-pointer"
                    >
                      Pick another stream
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live Chat Box — matches video height on desktop; follows whichever stream has active Audio/Chat focus */}
          <div
            className="relative lg:w-72 xl:w-80 2xl:w-96 shrink-0 h-[360px] lg:h-auto lg:min-h-[360px]"
            onDragOver={(e) => {
              e.preventDefault()
              if (!dragOver) setDragOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragOver(false)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void handleUploadFiles(e.dataTransfer.files)
                return
              }
              const droppedUrl =
                e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
              const cleanUrl = droppedUrl
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l && !l.startsWith('#'))
              if (cleanUrl) {
                setDraft((prev) => (prev.trim() ? `${prev.trim()} ${cleanUrl}` : cleanUrl))
              }
            }}
          >
            <div
              className={`h-full lg:absolute lg:inset-0 rounded-xl border flex flex-col overflow-hidden bg-[#12131a] transition ${
                dragOver ? 'border-[#e8590c] ring-2 ring-[#e8590c]/40' : 'border-[#232530]'
              }`}
            >
              <div className="border-b border-[#20222c] shrink-0">
                <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#d4d2cb]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <MessageCircle className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
                    <span className="truncate">Live Chat</span>
                  </span>
                  <span className="text-[11px] font-normal text-[#8c8a82] shrink-0">
                    {messages.length}
                  </span>
                </div>

                {/* Independent Chat Tabs in Watch With mode — switch chats freely without changing audio */}
                {isSplitView && (
                  <div
                    role="tablist"
                    aria-label="Switch live stream chat"
                    className="grid grid-cols-2 border-t border-[#20222c] bg-[#0f1016]"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeChatSlot === 'primary'}
                      onClick={() => setChatSlot('primary')}
                      title={`View chat for ${primaryTitle}`}
                      className={`px-2.5 py-2 text-[11px] font-semibold flex items-center justify-center gap-1.5 min-w-0 border-b-2 transition cursor-pointer ${
                        activeChatSlot === 'primary'
                          ? 'border-[#e8590c] bg-[#161822] text-white'
                          : 'border-transparent text-[#8c8a82] hover:text-white hover:bg-white/[0.03]'
                      }`}
                    >
                      {activeAudioSlot === 'primary' && (
                        <Volume2 className="w-3 h-3 text-[#ff922b] shrink-0" />
                      )}
                      <span className="truncate">{primaryTitle}</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeChatSlot === 'companion'}
                      onClick={() => setChatSlot('companion')}
                      title={`View chat for ${companionTitle}`}
                      className={`px-2.5 py-2 text-[11px] font-semibold flex items-center justify-center gap-1.5 min-w-0 border-b-2 border-l border-l-[#20222c] transition cursor-pointer ${
                        activeChatSlot === 'companion'
                          ? 'border-[#e8590c] bg-[#161822] text-white'
                          : 'border-transparent text-[#8c8a82] hover:text-white hover:bg-white/[0.03]'
                      }`}
                    >
                      {activeAudioSlot === 'companion' && (
                        <Volume2 className="w-3 h-3 text-[#ff922b] shrink-0" />
                      )}
                      <span className="truncate">{companionTitle}</span>
                    </button>
                  </div>
                )}
              </div>

              {dragOver && (
                <div className="absolute inset-0 z-20 bg-[#0e0e11]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-2 p-4 text-center pointer-events-none">
                  <ImagePlus className="w-8 h-8 text-[#ff8a3d]" />
                  <p className="text-xs font-semibold text-white">
                    Drop image to upload → {primaryBlossomHost}
                  </p>
                  <p className="text-[11px] text-[#9a9890]">EXIF metadata stripped client-side</p>
                </div>
              )}

              <div
                ref={chatScrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
                }}
                className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0"
              >
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-[#6f6d66] text-center px-4">
                    No live chat messages yet. Say hello!
                  </div>
                ) : (
                  messages.map((m) => (
                    <ChatBubble
                      key={m.id}
                      msg={m}
                      replyParent={m.replyToId ? messageById.get(m.replyToId) : undefined}
                      myPubkey={myPubkey}
                      onReply={setReplyTarget}
                      onBlock={(pk, name) => {
                        mutePubkey(pk)
                        useNostrStore.getState().setToast(`Blocked ${name} (undo in Settings)`)
                      }}
                      onOpenLightbox={setLightboxMedia}
                    />
                  ))
                )}
              </div>

              {uploading && uploadingHost && (
                <div className="px-2.5 py-1 bg-[#161822] border-t border-[#232530] flex items-center gap-1.5 text-[11px] text-[#ff922b] shrink-0">
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  <span className="truncate font-mono">Uploading to {uploadingHost}…</span>
                </div>
              )}

              {/* Uploaded Blossom attachment previews */}
              {attachments.length > 0 && (
                <div className="px-2 py-1.5 bg-[#161822] border-t border-[#232530] flex flex-wrap gap-1.5 shrink-0">
                  {attachments.map((att, idx) => (
                    <div
                      key={att.url}
                      title={`Hosted on ${formatBlossomHost(att.server)}`}
                      className="relative w-12 h-12 rounded-lg overflow-hidden border border-[#2d3042] bg-[#0e0e11]"
                    >
                      {att.type.startsWith('image/') ? (
                        <img
                          src={att.url}
                          alt="Uploaded preview"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-[#9a9890] p-1 text-center">
                          video
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setAttachments((p) => p.filter((_, i) => i !== idx))}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/80 text-white hover:bg-red-600 cursor-pointer"
                        aria-label="Remove attachment"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply quote strip */}
              {replyTarget && (
                <div className="px-2.5 py-1 bg-[#181a22] border-t border-[#232530] flex items-center justify-between gap-2 text-[11px] text-[#c2bfb7] shrink-0">
                  <span className="truncate">
                    Replying to: <span className="text-[#8c8a82]">{replyTarget.content}</span>
                  </span>
                  <button
                    onClick={() => setReplyTarget(null)}
                    className="p-0.5 text-[#8c8a82] hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Chat Composer */}
              <div className="p-2 border-t border-[#20222c] bg-[#14151e] shrink-0">
                {signer?.canSign ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void handleSend()
                    }}
                    className="flex gap-1.5 items-center"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleUploadFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      title="Upload image via Blossom (or drag & drop / paste)"
                      aria-label="Upload image via Blossom"
                      className="p-1.5 rounded-lg text-[#9a9890] hover:text-[#ff922b] hover:bg-white/5 disabled:opacity-40 cursor-pointer shrink-0"
                    >
                      {uploading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#e8590c]" />
                      ) : (
                        <ImagePlus className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onPaste={(e) => {
                        const dt = e.clipboardData
                        if (!dt) return
                        const files: File[] = []
                        if (dt.files && dt.files.length > 0) {
                          files.push(...Array.from(dt.files))
                        } else if (dt.items) {
                          for (const item of Array.from(dt.items)) {
                            if (item.kind === 'file') {
                              const f = item.getAsFile()
                              if (f) files.push(f)
                            }
                          }
                        }
                        if (files.length > 0) {
                          e.preventDefault()
                          void handleUploadFiles(files)
                        }
                      }}
                      placeholder={
                        uploading
                          ? uploadingHost
                            ? `Uploading to ${uploadingHost}…`
                            : 'Uploading to Blossom…'
                          : 'Send or drop image…'
                      }
                      maxLength={500}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#0e0e11] border border-[#262834] text-xs text-white focus:outline-none focus:border-[#e8590c]"
                    />
                    <button
                      type="submit"
                      disabled={sending || uploading || (!draft.trim() && attachments.length === 0)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-white cursor-pointer shrink-0"
                      aria-label="Send message"
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
                    onClick={openAuthModal}
                    className="w-full py-1.5 rounded-lg bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium text-[#ff922b] cursor-pointer"
                  >
                    Sign in to join live chat
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stream Info & Actions */}
        <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530] space-y-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Link to={`/p/${hostPubkey}`} className="flex items-center gap-2.5 min-w-0 group">
              <Avatar src={hostProfile?.picture} pubkey={hostPubkey} name={hostName} size="md" />
              <div className="min-w-0">
                <div className="font-semibold text-sm text-white group-hover:text-[#ff922b] truncate">
                  {hostName}
                </div>
                <div className="text-xs text-[#8c8a82] flex items-center gap-2">
                  {focusedActivity?.currentParticipants !== undefined && (
                    <span>{focusedActivity.currentParticipants.toLocaleString()} watching</span>
                  )}
                  {streamZapTotal > 0 && (
                    <span className="text-[#f59f00] font-medium flex items-center gap-0.5">
                      <Zap className="w-3 h-3 fill-[#f59f00]" />
                      {streamZapTotal.toLocaleString()} sats
                    </span>
                  )}
                </div>
              </div>
            </Link>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#1c1e2a] hover:bg-[#252838] border border-[#2d3042] hover:border-[#e8590c]/50 text-[#ece9e1] text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-[#ff922b]" />
                Share Stream
              </button>
              {!isMe && hostPubkey && (
                <button
                  onClick={() => void toggleFollow(hostPubkey)}
                  className={`fw-edge-btn px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer text-white ${
                    isFollowing ? 'fw-edge-following' : 'fw-edge-follow'
                  }`}
                >
                  {isFollowing ? (
                    <>
                      <UserCheck className="w-3.5 h-3.5" /> Following
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" /> Follow
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {focusedActivity?.summary && (
            <p className="text-xs text-[#c2bfb7] leading-relaxed whitespace-pre-wrap">
              {focusedActivity.summary}
            </p>
          )}

          {hostProfile?.lud16 && (
            <StreamZapBar
              recipientPubkey={hostPubkey}
              recipientName={hostName}
              lud16={hostProfile.lud16}
              eventId={focusedActivity?.eventId}
              eventATag={focusedATag}
            />
          )}
        </div>

        {/* Mobile Top Zappers (desktop shows Top Zappers in the left sidebar column) */}
        <div className="md:hidden">
          <StreamTopZappersCard compact />
        </div>

        {/* Reveal other live streams (hidden by default, same carousel as the main page) */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowOtherStreams((v) => !v)}
            aria-expanded={showOtherStreams}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#15161c] hover:bg-[#1b1d26] border border-[#232530] text-xs font-semibold text-[#d4d2cb] flex items-center justify-between gap-2 transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-red-500" />
              {showOtherStreams ? 'Hide other live streams' : 'Show other live streams'}
            </span>
            {showOtherStreams ? (
              <ChevronUp className="w-4 h-4 text-[#8c8a82]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#8c8a82]" />
            )}
          </button>
          {showOtherStreams && (
            <div className="rounded-2xl overflow-hidden border border-[#232530]">
              <LiveNowRow
                forceShow
                excludeATag={aTag}
                onWatchWith={(entry) => {
                  const addr = encodeLiveNaddr(
                    entry.activity.hostPubkey,
                    entry.activity.dTag,
                    entry.activity.relayHints,
                  )
                  setCompanion({
                    hostPubkey: entry.activity.hostPubkey,
                    dTag: entry.activity.dTag,
                    relays: entry.activity.relayHints,
                    naddr: addr,
                    activity: entry.activity,
                  })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            </div>
          )}
        </div>
      </div>

      {watchWithOpen && (
        <WatchWithModal
          primaryATag={aTag}
          currentCompanionATag={companionATag || null}
          onSelect={(sel) => {
            setCompanion(sel)
          }}
          onClearCompanion={() => {
            setCompanion(null)
            setAudioSlot('primary')
            setChatSlot('primary')
          }}
          onClose={() => setWatchWithOpen(false)}
        />
      )}

      {shareOpen && (
        <ShareStreamModal
          naddr={encodeLiveNaddr(focusedPublisherPubkey, focusedDTag, focusedRelays)}
          hostPubkey={focusedPublisherPubkey}
          displayPubkey={hostPubkey}
          dTag={focusedDTag}
          hostName={hostName}
          hostPicture={hostProfile?.picture}
          title={focusedTitle}
          summary={focusedActivity?.summary}
          image={focusedActivity?.image}
          isLive={focusedIsLive}
          viewers={focusedActivity?.currentParticipants}
          relayHint={focusedRelays[0]}
          onClose={() => setShareOpen(false)}
        />
      )}

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
    </div>
  )
}
