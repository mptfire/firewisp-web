import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import {
  MessageCircle,
  Repeat2,
  Heart,
  Zap,
  Bookmark,
  MoreHorizontal,
  VolumeX,
  ExternalLink,
  Cpu,
} from 'lucide-react'
import { parseNoteContent, type MediaAttachment } from '../lib/nostr/content'
import { verifyEventPow } from '../lib/crypto/nip13'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { MediaLightbox } from './MediaLightbox'
import { ZapModal } from './ZapModal'

interface NoteCardProps {
  event: Event
  repostedByPubkey?: string
}

function formatRelativeTime(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(unixSec * 1000).toLocaleDateString()
}

export function NoteCard({ event, repostedByPubkey }: NoteCardProps) {
  const profiles = useNostrStore((s) => s.profiles)
  const events = useNostrStore((s) => s.events)
  const reactionCount = useNostrStore((s) => s.reactionCounts[event.id] || 0)
  const liked = useNostrStore((s) => Boolean(s.userLiked[event.id]))
  const repostCount = useNostrStore((s) => s.repostCounts[event.id] || 0)
  const userReposted = useNostrStore((s) => (s.userRepostIds[event.id]?.length || 0) > 0)
  const zapSats = useNostrStore((s) => s.zapTotalsSats[event.id] || 0)
  const bookmarked = useNostrStore((s) => s.bookmarks.includes(event.id))
  const toggleLike = useNostrStore((s) => s.toggleLike)
  const toggleRepost = useNostrStore((s) => s.toggleRepost)
  const toggleBookmark = useNostrStore((s) => s.toggleBookmark)
  const mutePubkey = useSettingsStore((s) => s.mutePubkey)
  const muteHashtag = useSettingsStore((s) => s.muteHashtag)

  const [lightboxMedia, setLightboxMedia] = useState<MediaAttachment | null>(null)
  const [altPreview, setAltPreview] = useState<string | null>(null)
  const [zapOpen, setZapOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const profile = profiles[event.pubkey]
  const reposterProfile = repostedByPubkey ? profiles[repostedByPubkey] : undefined
  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(event.pubkey)
    } catch {
      return event.pubkey.slice(0, 12)
    }
  }, [event.pubkey])
  const displayName =
    profile?.display_name || profile?.name || `${npub.slice(0, 12)}…`
  const powBits = useMemo(() => verifyEventPow(event.id, event.tags), [event.id, event.tags])
  const parsed = useMemo(() => parseNoteContent(event), [event])

  return (
    <article className="border-b border-[#20222c] px-4 py-3.5 hover:bg-white/[0.015] transition">
      {repostedByPubkey && (
        <div className="flex items-center gap-1.5 text-xs text-[#9a9890] mb-2 pl-12">
          <Repeat2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            Reposted by{' '}
            <Link
              to={`/p/${repostedByPubkey}`}
              className="hover:underline text-[#c9c6be]"
            >
              {reposterProfile?.display_name ||
                reposterProfile?.name ||
                `${repostedByPubkey.slice(0, 10)}…`}
            </Link>
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <Link to={`/p/${event.pubkey}`} className="shrink-0">
          <Avatar src={profile?.picture} pubkey={event.pubkey} name={displayName} />
        </Link>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <Link
                to={`/p/${event.pubkey}`}
                className="font-semibold text-[15px] text-[#f4f1ea] hover:underline truncate"
              >
                {displayName}
              </Link>
              {profile?.nip05 && (
                <span className="text-xs text-[#9a9890] truncate max-w-[160px]">
                  {profile.nip05.replace(/^_@/, '')}
                </span>
              )}
              <span className="text-xs text-[#6f6d66]">·</span>
              <Link
                to={`/e/${event.id}`}
                className="text-xs text-[#8a8880] hover:underline"
                title={new Date(event.created_at * 1000).toLocaleString()}
              >
                {formatRelativeTime(event.created_at)}
              </Link>
              {powBits >= 12 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[#f59f00]/10 text-[#f59f00] border border-[#f59f00]/20"
                  title={`Verified NIP-13 Proof-of-Work (${powBits} leading zero bits)`}
                >
                  <Cpu className="w-2.5 h-2.5" />
                  {powBits}b
                </span>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="p-1 rounded-lg text-[#7c7a72] hover:text-white hover:bg-white/5 cursor-pointer"
                aria-label="Note actions"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-44 rounded-xl bg-[#1a1c24] border border-[#2c2f3e] shadow-xl py-1 z-20 text-xs"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button
                    onClick={() => {
                      mutePubkey(event.pubkey)
                      setMenuOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-red-300 hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    Mute author
                  </button>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(nip19.noteEncode(event.id))
                      setMenuOpen(false)
                    }}
                    className="w-full px-3 py-2 text-left text-[#d4d2cb] hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Copy note ID
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Body segments */}
          <div className="mt-1.5 text-[15px] leading-relaxed text-[#ece9e1] whitespace-pre-wrap break-words">
            {parsed.segments.map((seg, i) => {
              if (seg.type === 'text') return <span key={i}>{seg.text}</span>
              if (seg.type === 'link') {
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
                  <span key={i} className="inline-flex items-center group">
                    <Link
                      to={`/search?q=${encodeURIComponent('#' + seg.tag)}`}
                      className="text-[#f59f00] hover:underline"
                    >
                      #{seg.tag}
                    </Link>
                    <button
                      onClick={() => muteHashtag(seg.tag)}
                      title={`Mute #${seg.tag}`}
                      className="ml-0.5 opacity-0 group-hover:opacity-100 text-[#8a8880] hover:text-red-400 transition cursor-pointer"
                    >
                      <VolumeX className="w-3 h-3" />
                    </button>
                  </span>
                )
              }
              if (seg.type === 'mention') {
                const mp = profiles[seg.pubkey]
                const label = mp?.display_name || mp?.name || `${seg.bech32.slice(0, 12)}…`
                return (
                  <Link
                    key={i}
                    to={`/p/${seg.pubkey}`}
                    className="text-[#ff8a3d] hover:underline font-medium"
                  >
                    @{label}
                  </Link>
                )
              }
              if (seg.type === 'quote' && seg.eventId) {
                const quoted = events[seg.eventId]
                return (
                  <Link
                    key={i}
                    to={`/e/${seg.eventId}`}
                    className="block my-2 p-3 rounded-xl bg-[#161820] border border-[#272a36] hover:border-[#3b3f52] transition text-sm"
                  >
                    {quoted ? (
                      <>
                        <div className="text-xs text-[#9a9890] mb-1">
                          {profiles[quoted.pubkey]?.display_name ||
                            profiles[quoted.pubkey]?.name ||
                            quoted.pubkey.slice(0, 12)}
                        </div>
                        <p className="text-[#dcd9d0] line-clamp-3">{quoted.content}</p>
                      </>
                    ) : (
                      <span className="text-xs text-[#ff8a3d]">
                        Quoted note ({seg.bech32.slice(0, 18)}…)
                      </span>
                    )}
                  </Link>
                )
              }
              return null
            })}
          </div>

          {/* Media gallery with NIP-92 ALT badges */}
          {parsed.media.length > 0 && (
            <div
              className={`mt-2.5 grid gap-2 ${
                parsed.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
              }`}
            >
              {parsed.media.map((m) => (
                <div
                  key={m.url}
                  className="relative rounded-xl overflow-hidden border border-[#262834] bg-[#0b0b0e]"
                >
                  {m.kind === 'image' && (
                    <img
                      src={m.url}
                      alt={m.alt || 'Note image'}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onClick={() => setLightboxMedia(m)}
                      className="w-full max-h-[460px] object-cover cursor-zoom-in"
                    />
                  )}
                  {m.kind === 'video' && (
                    <video
                      src={m.url}
                      controls
                      preload="metadata"
                      className="w-full max-h-[460px] bg-black"
                    />
                  )}
                  {m.kind === 'audio' && (
                    <audio src={m.url} controls className="w-full p-2" />
                  )}
                  {m.alt && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setAltPreview(altPreview === m.alt ? null : m.alt || null)
                      }}
                      className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-bold tracking-wide text-[#f59f00] border border-white/15 hover:bg-black cursor-pointer"
                      title="Show image alt text"
                    >
                      ALT
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {altPreview && (
            <div className="mt-2 p-2.5 rounded-xl bg-[#181a22] border border-[#2c3040] text-xs text-[#d4d2cb]">
              <span className="font-semibold text-[#f59f00] mr-1.5">ALT:</span>
              {altPreview}
            </div>
          )}

          {/* Action bar */}
          <div className="mt-3 flex items-center justify-between max-w-md text-[#8c8a82]">
            <Link
              to={`/e/${event.id}`}
              className="flex items-center gap-1.5 text-xs hover:text-[#ff8a3d] transition p-1 -ml-1 rounded-lg"
              title="Reply / Open thread"
            >
              <MessageCircle className="w-4 h-4" />
            </Link>

            <button
              onClick={() => void toggleRepost(event)}
              className={`flex items-center gap-1.5 text-xs transition p-1 rounded-lg cursor-pointer ${
                userReposted
                  ? 'text-emerald-400 hover:text-emerald-300'
                  : 'hover:text-emerald-400'
              }`}
              title={userReposted ? 'Undo repost (NIP-09)' : 'Repost'}
            >
              <Repeat2 className="w-4 h-4" />
              {repostCount > 0 && <span>{repostCount}</span>}
            </button>

            <button
              onClick={() => void toggleLike(event)}
              className={`flex items-center gap-1.5 text-xs transition p-1 rounded-lg cursor-pointer ${
                liked ? 'text-rose-500' : 'hover:text-rose-400'
              }`}
              title="Like (mines NIP-13 PoW if enabled)"
            >
              <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
              {reactionCount > 0 && <span>{reactionCount}</span>}
            </button>

            <button
              disabled={!profile?.lud16}
              onClick={() => setZapOpen(true)}
              className={`flex items-center gap-1.5 text-xs transition p-1 rounded-lg ${
                profile?.lud16
                  ? 'hover:text-[#f59f00] cursor-pointer'
                  : 'opacity-30 cursor-not-allowed'
              }`}
              title={profile?.lud16 ? `Zap ${profile.lud16}` : 'Author has no Lightning Address'}
            >
              <Zap className={`w-4 h-4 ${zapSats > 0 ? 'text-[#f59f00]' : ''}`} />
              {zapSats > 0 && <span className="text-[#f59f00]">{zapSats.toLocaleString()}</span>}
            </button>

            <button
              onClick={() => void toggleBookmark(event.id)}
              className={`flex items-center gap-1 text-xs transition p-1 rounded-lg cursor-pointer ${
                bookmarked ? 'text-[#ff8a3d]' : 'hover:text-[#ff8a3d]'
              }`}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
            >
              <Bookmark className={`w-4 h-4 ${bookmarked ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />

      {zapOpen && profile?.lud16 && (
        <ZapModal
          recipientPubkey={event.pubkey}
          recipientName={displayName}
          lud16={profile.lud16}
          eventId={event.id}
          onClose={() => setZapOpen(false)}
        />
      )}
    </article>
  )
}
