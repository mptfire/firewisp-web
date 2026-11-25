import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  Copy,
  Cpu,
  ExternalLink,
  Link2,
  Loader2,
  Radio,
  Send,
  Share2,
  X,
} from 'lucide-react'
import { buildShareStreamNotePayload } from '../lib/nostr/nip53'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

interface ShareStreamModalProps {
  naddr: string
  hostPubkey: string
  displayPubkey: string
  dTag: string
  hostName: string
  hostPicture?: string
  title: string
  summary?: string
  image?: string
  isLive: boolean
  viewers?: number
  relayHint?: string
  onClose: () => void
}

export function ShareStreamModal({
  naddr,
  hostPubkey,
  displayPubkey,
  dTag,
  hostName,
  hostPicture,
  title,
  summary,
  image,
  isLive,
  viewers,
  relayHint,
  onClose,
}: ShareStreamModalProps) {
  const navigate = useNavigate()
  const signer = useAuthStore((s) => s.signer)
  const myPubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const myProfile = useNostrStore((s) => (myPubkey ? s.profiles[myPubkey] : undefined))
  const publishNote = useNostrStore((s) => s.publishNote)
  const notePowEnabled = useSettingsStore((s) => s.notePowEnabled)
  const notePowBits = useSettingsStore((s) => s.notePowBits)

  const [comment, setComment] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [publishedId, setPublishedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const [copiedMode, setCopiedMode] = useState<'link' | 'naddr' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shareOrigin =
    typeof window !== 'undefined' && window.location.origin.startsWith('https://')
      ? window.location.origin
      : 'https://firewisp.de'
  const webShareUrl = `${shareOrigin}/live/${naddr}`
  const nostrAddress = `nostr:${naddr}`
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    setImgFailed(false)
  }, [image])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [onClose])

  useEffect(() => {
    if (signer?.canSign && !publishedId) {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [signer?.canSign, publishedId])

  const copyValue = async (value: string, mode: 'link' | 'naddr') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedMode(mode)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null
        setCopiedMode(null)
      }, 1800)
    } catch {
      useNostrStore.getState().setToast('Clipboard permission unavailable')
    }
  }

  const handleNativeShare = async () => {
    if (!canNativeShare) return
    try {
      await navigator.share({
        title: `${title} — Fire Wisp`,
        text: isLive ? `Watch ${hostName} live on Fire Wisp` : `${title} by ${hostName}`,
        url: webShareUrl,
      })
    } catch {
      // User canceled native share sheet
    }
  }

  const handlePublish = async () => {
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    if (publishing) return
    setError(null)
    setPublishing(true)
    try {
      const { content, extraTags } = buildShareStreamNotePayload({
        comment,
        naddr,
        hostPubkey,
        streamerPubkey: displayPubkey,
        dTag,
        relayHint,
      })
      const published = await publishNote({
        content,
        extraTags,
      })
      setPublishedId(published.id)
      useNostrStore.getState().setToast('Shared stream to your Nostr feed!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish note')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share stream on Nostr"
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[#12131a] border border-[#2a2d3d] shadow-2xl shadow-black/70 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#20222c] bg-[#15161f] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg ember-gradient flex items-center justify-center text-white shrink-0">
              <Share2 className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white leading-tight truncate">
                Share Stream on Nostr
              </h2>
              <p className="text-[11px] text-[#8c8a82] truncate">
                Post a note with this stream embedded or copy a link
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5 overflow-y-auto">
          {publishedId ? (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center mx-auto">
                <Check className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-white">Stream shared on Nostr!</div>
                <p className="text-xs text-[#b8b5ad]">
                  Your note is live with the interactive stream card attached.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    navigate(`/e/${publishedId}`)
                  }}
                  className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Note
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] border border-[#2d3042] text-xs font-medium text-[#e4e1d8] cursor-pointer"
                >
                  Back to Stream
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Note Composer Input */}
              {signer?.canSign ? (
                <div className="flex gap-3">
                  <Avatar
                    src={myProfile?.picture}
                    pubkey={myPubkey || ''}
                    name={myProfile?.display_name || myProfile?.name}
                    size="md"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#ece9e1] truncate">
                        {myProfile?.display_name ||
                          myProfile?.name ||
                          (myPubkey ? `${myPubkey.slice(0, 10)}…` : 'You')}
                      </span>
                      {notePowEnabled && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-[#f59f00]/90 bg-[#f59f00]/10 border border-[#f59f00]/20 px-2 py-0.5 rounded-full shrink-0"
                          title="NIP-13 anti-spam proof-of-work mined automatically in a background Web Worker"
                        >
                          <Cpu className="w-3 h-3" />
                          PoW {notePowBits}b
                        </span>
                      )}
                    </div>
                    <textarea
                      ref={textareaRef}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !publishing) {
                          e.preventDefault()
                          void handlePublish()
                        }
                      }}
                      rows={3}
                      placeholder={`Say something about ${hostName}'s stream… (optional · Ctrl+Enter to post)`}
                      className="w-full rounded-xl bg-[#0e0e11] border border-[#262938] focus:border-[#e8590c] px-3 py-2.5 text-sm leading-relaxed text-[#f4f1ea] placeholder-[#6c6a63] resize-none focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-[#161822] border border-[#262938] p-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-[#b8b5ad]">
                    Sign in to post this stream directly as a Nostr note, or copy the link below.
                  </p>
                  <button
                    type="button"
                    onClick={openAuthModal}
                    className="px-3.5 py-1.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-white shrink-0 cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
              )}

              {/* Embedded Live Stream Card Preview (matches Fire Wisp feed appearance) */}
              <div className="rounded-xl overflow-hidden border border-[#e8590c]/45 bg-[#15161f]">
                <div className="relative aspect-video max-h-52 w-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] overflow-hidden">
                  {image && !imgFailed ? (
                    <img
                      src={image}
                      alt={title}
                      referrerPolicy="no-referrer"
                      onError={() => setImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center opacity-85">
                      <Avatar src={hostPicture} pubkey={displayPubkey} name={hostName} size="lg" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />
                  <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shadow">
                    <Radio className="w-2.5 h-2.5 animate-pulse" />
                    {isLive ? 'LIVE' : 'STREAM'}
                  </span>
                  {viewers !== undefined && viewers > 0 && (
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-[11px] font-medium text-[#ece9e1]">
                      {viewers.toLocaleString()} watching
                    </span>
                  )}
                </div>

                <div className="p-3 flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={hostPicture} pubkey={displayPubkey} name={hostName} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold text-white truncate">
                        {title}
                      </div>
                      <div className="text-[11px] text-[#8c8a82] truncate">
                        {hostName}
                        {summary ? ` · ${summary}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-[#e8590c]/15 border border-[#e8590c]/30 text-[10px] font-mono text-[#ff922b] shrink-0">
                    NIP-53
                  </span>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer: Quick Copy / Native Share + Post Button */}
        <div className="px-4 py-3 border-t border-[#20222c] bg-[#15161f] flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => void copyValue(webShareUrl, 'link')}
              className="px-2.5 py-1.5 rounded-lg bg-[#1c1e2a] hover:bg-[#252838] border border-[#2d3042] text-xs text-[#d4d2cb] flex items-center gap-1.5 transition cursor-pointer"
              title="Copy Fire Wisp stream URL"
            >
              {copiedMode === 'link' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Link copied</span>
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5 text-[#ff922b]" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void copyValue(nostrAddress, 'naddr')}
              className="px-2.5 py-1.5 rounded-lg bg-[#1c1e2a] hover:bg-[#252838] border border-[#2d3042] text-xs text-[#d4d2cb] flex items-center gap-1.5 transition cursor-pointer"
              title="Copy universal nostr:naddr1… stream address"
            >
              {copiedMode === 'naddr' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">naddr copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy naddr</span>
                </>
              )}
            </button>

            {canNativeShare && (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                className="px-2.5 py-1.5 rounded-lg bg-[#1c1e2a] hover:bg-[#252838] border border-[#2d3042] text-xs text-[#d4d2cb] flex items-center gap-1.5 transition cursor-pointer"
                title="Share via device share sheet"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Device</span>
              </button>
            )}
          </div>

          {!publishedId && signer?.canSign && (
            <button
              type="button"
              disabled={publishing}
              onClick={() => void handlePublish()}
              className="px-4 py-1.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-45 text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5 transition cursor-pointer"
            >
              {publishing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {publishing ? 'Publishing…' : 'Post Note'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
