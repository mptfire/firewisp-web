import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  CornerDownRight,
  Loader2,
  MessageCircle,
  Radio,
  Send,
  UserCheck,
  UserPlus,
  X,
  Zap,
} from 'lucide-react'
import { buildLiveATag, decodeLiveNaddr, encodeLiveNaddr } from '../lib/nostr/nip53'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore, type LiveChatMessage } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'
import { HlsVideoPlayer } from '../components/HlsVideoPlayer'
import { ZapModal } from '../components/ZapModal'

function formatChatTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ChatBubble({
  msg,
  replyParent,
  myPubkey,
  onReply,
  onBlock,
}: {
  msg: LiveChatMessage
  replyParent?: LiveChatMessage
  myPubkey: string | null
  onReply: (m: LiveChatMessage) => void
  onBlock: (pk: string, name: string) => void
}) {
  const profile = useNostrStore((s) => s.profiles[msg.senderPubkey])
  const parentProfile = useNostrStore((s) =>
    replyParent ? s.profiles[replyParent.senderPubkey] : undefined,
  )
  const name = profile?.display_name || profile?.name || `${msg.senderPubkey.slice(0, 8)}…`
  const isMe = Boolean(myPubkey && myPubkey.toLowerCase() === msg.senderPubkey)

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
                  className="p-1 rounded text-red-400 hover:bg-red-500/15 cursor-pointer"
                >
                  <Ban className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-[#ece9e1] whitespace-pre-wrap break-words leading-relaxed">
            {msg.content}
          </p>
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
  const sendChatMessage = useLiveStore((s) => s.sendChatMessage)

  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const mutePubkey = useSettingsStore((s) => s.mutePubkey)

  const hostPubkey =
    activeActivity?.streamerPubkey || activeActivity?.hostPubkey || decoded?.hostPubkey || ''
  const hostProfile = useNostrStore((s) => (hostPubkey ? s.profiles[hostPubkey] : undefined))
  const follows = useNostrStore((s) => s.follows)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [replyTarget, setReplyTarget] = useState<LiveChatMessage | null>(null)
  const [zapOpen, setZapOpen] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    if (!decoded) return
    return subscribeActiveStream(decoded.hostPubkey, decoded.dTag, decoded.relays)
  }, [decoded, subscribeActiveStream])

  const messages = useMemo(() => {
    return rawMessages.filter((m) => {
      if (mutedPubkeys.includes(m.senderPubkey)) return false
      if (mutedWords.length > 0 && m.content) {
        const lower = m.content.toLowerCase()
        if (mutedWords.some((w) => w.length >= 2 && lower.includes(w))) return false
      }
      return true
    })
  }, [rawMessages, mutedPubkeys, mutedWords])

  const messageById = useMemo(() => {
    const map = new Map<string, LiveChatMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

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

  const hostName =
    hostProfile?.display_name || hostProfile?.name || `${hostPubkey.slice(0, 10)}…`
  const isMe = Boolean(myPubkey && hostPubkey && myPubkey.toLowerCase() === hostPubkey.toLowerCase())
  const isFollowing = Boolean(hostPubkey && follows.includes(hostPubkey.toLowerCase()))
  const isLive = activeActivity?.status === 'live'
  const playableUrl = activeActivity?.streamingUrl || activeActivity?.recordingUrl
  const aTag = buildLiveATag(decoded.hostPubkey, decoded.dTag)

  const handleSend = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      await sendChatMessage(decoded.hostPubkey, decoded.dTag, draft, replyTarget?.id)
      setDraft('')
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
    <div className="flex flex-col h-[calc(100vh-52px)] md:h-screen">
      {/* Top Bar */}
      <div className="shrink-0 bg-[#0e0e11]/95 backdrop-blur-md border-b border-[#20222c] px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
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

        <button
          onClick={async () => {
            const addr = encodeLiveNaddr(
              decoded.hostPubkey,
              decoded.dTag,
              activeActivity?.relayHints || decoded.relays,
            )
            await navigator.clipboard.writeText(`https://firewisp.rtard.de/live/${addr}`)
            setCopiedLink(true)
            setTimeout(() => setCopiedLink(false), 1800)
          }}
          className="px-2.5 py-1.5 rounded-lg bg-[#181a22] hover:bg-[#222533] border border-[#2a2d3a] text-xs text-[#d4d2cb] flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          {copiedLink ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Share</span>
            </>
          )}
        </button>
      </div>

      {/* Theater Split Layout: Video + Info (left) | Live Chat (right on lg+, stacked below on mobile) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Video + Stream Info Pane */}
        <div className="lg:flex-1 lg:overflow-y-auto p-3 sm:p-4 space-y-3 shrink-0 lg:shrink">
          {loadingStream && !activeActivity ? (
            <div className="w-full aspect-video rounded-xl bg-[#15161c] border border-[#232530] flex items-center justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#e8590c]" />
            </div>
          ) : playableUrl ? (
            <HlsVideoPlayer
              streamUrl={playableUrl}
              posterUrl={activeActivity?.image}
              title={activeActivity?.title}
              isLive={isLive}
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
                    {activeActivity?.currentParticipants !== undefined && (
                      <span>{activeActivity.currentParticipants.toLocaleString()} watching</span>
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

              <div className="flex items-center gap-2">
                {hostProfile?.lud16 && (
                  <button
                    onClick={() => setZapOpen(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#f59f00]/15 hover:bg-[#f59f00]/25 border border-[#f59f00]/40 text-[#f59f00] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 fill-[#f59f00]/40" />
                    Zap Stream
                  </button>
                )}
                {!isMe && hostPubkey && (
                  <button
                    onClick={() => void toggleFollow(hostPubkey)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                      isFollowing
                        ? 'bg-[#1d1f29] border border-[#2e3242] text-white'
                        : 'bg-[#e8590c] hover:bg-[#d9480f] text-white'
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

            {activeActivity?.summary && (
              <p className="text-xs text-[#c2bfb7] leading-relaxed whitespace-pre-wrap">
                {activeActivity.summary}
              </p>
            )}
          </div>
        </div>

        {/* Live Chat Column */}
        <div className="flex-1 lg:flex-none lg:w-80 xl:w-96 border-t lg:border-t-0 lg:border-l border-[#20222c] flex flex-col min-h-0 bg-[#111218]">
          <div className="px-3.5 py-2.5 border-b border-[#20222c] flex items-center justify-between text-xs font-semibold text-[#d4d2cb] shrink-0">
            <span className="flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-[#f59f00]" />
              Live Chat
            </span>
            <span className="text-[11px] font-normal text-[#8c8a82]">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>

          <div
            ref={chatScrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
            }}
            className="flex-1 overflow-y-auto p-2.5 space-y-1.5 min-h-0"
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
                />
              ))
            )}
          </div>

          {/* Reply quote strip */}
          {replyTarget && (
            <div className="px-3 py-1.5 bg-[#181a22] border-t border-[#232530] flex items-center justify-between gap-2 text-[11px] text-[#c2bfb7]">
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
          <div className="p-2.5 border-t border-[#20222c] bg-[#13141c] shrink-0">
            {signer?.canSign ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void handleSend()
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Send a live chat message…"
                  maxLength={500}
                  className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#262834] text-xs text-white focus:outline-none focus:border-[#e8590c]"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="px-3 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-white cursor-pointer"
                  aria-label="Send message"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            ) : (
              <button
                onClick={openAuthModal}
                className="w-full py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium text-[#ff922b] cursor-pointer"
              >
                Sign in to join live chat
              </button>
            )}
          </div>
        </div>
      </div>

      {zapOpen && hostProfile?.lud16 && (
        <ZapModal
          recipientPubkey={hostPubkey}
          recipientName={hostName}
          lud16={hostProfile.lud16}
          eventId={activeActivity?.eventId}
          eventATag={aTag}
          onClose={() => setZapOpen(false)}
        />
      )}
    </div>
  )
}
