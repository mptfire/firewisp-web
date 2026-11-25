import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import {
  MessageCircle,
  Repeat2,
  Heart,
  Zap,
  Bookmark,
  MoreHorizontal,
  Ban,
  VolumeX,
  ExternalLink,
  Cpu,
  CornerDownRight,
  PictureInPicture2,
  Play,
  Radio,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { extractReplyRefs, parseNoteContent, type MediaAttachment } from '../lib/nostr/content'
import { buildLiveATag, encodeLiveNaddr, isLiveStreamFresh } from '../lib/nostr/nip53'
import { nostrPool } from '../lib/nostr/pool'
import { verifyEventPow } from '../lib/crypto/nip13'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { HlsVideoPlayer } from './HlsVideoPlayer'
import { LiveHoverPreview, type HoverPreviewStatus } from './LiveHoverPreview'
import { MediaLightbox } from './MediaLightbox'
import { YouTubeCard } from './YouTubeCard'
import { ZapModal } from './ZapModal'

const requestedQuotes = new Set<string>()
const requestedParents = new Set<string>()
const parentBatchQueue = new Set<string>()
let parentBatchTimer: ReturnType<typeof setTimeout> | null = null

function flushParentBatch() {
  parentBatchTimer = null
  const batch = [...parentBatchQueue].slice(0, 40)
  for (const id of batch) parentBatchQueue.delete(id)
  if (parentBatchQueue.size > 0) {
    parentBatchTimer = setTimeout(flushParentBatch, 150)
  }
  if (batch.length === 0) return
  const st = useNostrStore.getState()
  const relays = [
    ...new Set([...useSettingsStore.getState().getReadRelays(), ...st.userReadRelays]),
  ].slice(0, 8)
  void nostrPool.query(relays, { ids: batch }, 3500).then((evs) => {
    const store = useNostrStore.getState()
    for (const ev of evs) store.ingestEvent(ev)
    if (evs.length > 0) void store.fetchProfiles(evs.map((e) => e.pubkey))
  })
}

function queueParentEventFetch(eventId: string) {
  if (!eventId || requestedParents.has(eventId)) return
  if (useNostrStore.getState().events[eventId]) return
  requestedParents.add(eventId)
  parentBatchQueue.add(eventId)
  if (parentBatchTimer) return
  parentBatchTimer = setTimeout(flushParentBatch, 150)
}

const LONG_NOTE_CHAR_LIMIT = 900
const LONG_NOTE_LINE_LIMIT = 12

interface NoteCardProps {
  event: Event
  repostedByPubkey?: string
  hideParentPreview?: boolean
}

function formatRelativeTime(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(unixSec * 1000).toLocaleDateString()
}

/** Isolated mention chip so profile updates only re-render this chip, never the whole feed. */
const MentionChip = memo(function MentionChip({
  pubkey,
  bech32,
}: {
  pubkey: string
  bech32: string
}) {
  const profile = useNostrStore((s) => s.profiles[pubkey])
  const label = profile?.display_name || profile?.name || `${bech32.slice(0, 12)}…`
  return (
    <Link
      to={`/p/${pubkey}`}
      className="text-[#ff8a3d] hover:underline font-medium"
    >
      @{label}
    </Link>
  )
})

/** Rich inline livestream card inside a note: click Play to watch HLS right inside the note, or footer to open full stream & chat. */
const LiveStreamEmbedCard = memo(function LiveStreamEmbedCard({
  hostPubkey,
  dTag,
  bech32,
}: {
  hostPubkey: string
  dTag: string
  bech32: string
}) {
  const navigate = useNavigate()
  const aTag = buildLiveATag(hostPubkey, dTag)
  const entry = useLiveStore((s) => s.liveStreams[aTag])
  const markStreamOffline = useLiveStore((s) => s.markStreamOffline)
  const markStreamOnline = useLiveStore((s) => s.markStreamOnline)
  const openMiniPlayer = useLiveStore((s) => s.openMiniPlayer)
  const isInMiniPlayer = useLiveStore((s) => s.miniPlayer?.aTag === aTag)
  const hasMiniPlayer = useLiveStore((s) => Boolean(s.miniPlayer))
  const audioOwner = useLiveStore((s) => s.audioOwner)
  const setAudioOwner = useLiveStore((s) => s.setAudioOwner)
  const playingInline = useLiveStore((s) => s.activeInlineStreamKey === aTag)
  const setActiveInlineStream = useLiveStore((s) => s.setActiveInlineStream)
  const inlineMediaPlayback = useSettingsStore((s) => s.inlineMediaPlayback)
  const hoverStreamPreview = useSettingsStore((s) => s.hoverStreamPreview)
  const displayPk = entry?.activity.streamerPubkey || entry?.activity.hostPubkey || hostPubkey
  const profile = useNostrStore((s) => s.profiles[displayPk])
  const [thumbFailed, setThumbFailed] = useState(false)
  const [lockedStreamUrl, setLockedStreamUrl] = useState<string | null>(null)
  const [hoverActive, setHoverActive] = useState(false)
  const [previewStatus, setPreviewStatus] = useState<HoverPreviewStatus | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!inlineMediaPlayback && playingInline) {
      setActiveInlineStream(null)
    }
  }, [inlineMediaPlayback, playingInline, setActiveInlineStream])

  useEffect(() => {
    if (!playingInline) setLockedStreamUrl(null)
  }, [playingInline])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const hostName = profile?.display_name || profile?.name || `${displayPk.slice(0, 10)}…`
  const title = entry?.activity.title || `Live Stream (${dTag.slice(0, 24)})`
  const thumb = entry?.activity.image
  const liveStreamUrl = entry?.activity.streamingUrl || entry?.activity.recordingUrl
  const effectivePlayUrl = playingInline ? lockedStreamUrl || liveStreamUrl : liveStreamUrl
  const isLive = entry?.activity.status === 'live'
  const viewers = entry?.activity.currentParticipants

  const startHoverPreview = () => {
    if (!hoverStreamPreview || !liveStreamUrl || playingInline || isInMiniPlayer) return
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(hover: hover)').matches) {
      return
    }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      setHoverActive(true)
    }, 350)
  }

  const stopHoverPreview = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverActive(false)
    setPreviewStatus(null)
  }

  const handleActivateStream = () => {
    stopHoverPreview()
    if (inlineMediaPlayback && liveStreamUrl) {
      setLockedStreamUrl(liveStreamUrl)
      setActiveInlineStream(aTag)
    } else {
      navigate(`/live/${bech32}`)
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="group mt-2.5 rounded-xl overflow-hidden border border-[#e8590c]/40 hover:border-[#e8590c] bg-[#14151e] transition"
    >
      {playingInline && inlineMediaPlayback && effectivePlayUrl ? (
        <HlsVideoPlayer
          key={aTag}
          streamUrl={effectivePlayUrl}
          posterUrl={thumb}
          title={title}
          isLive={isLive}
          autoStart
          forceMuted={hasMiniPlayer ? audioOwner !== 'main' : undefined}
          onRequestFocus={hasMiniPlayer ? () => setAudioOwner('main') : undefined}
          onPopOut={() => {
            openMiniPlayer({
              aTag,
              naddr: bech32,
              streamUrl: effectivePlayUrl,
              posterUrl: thumb,
              title,
              hostName,
              isLive,
            })
          }}
          onPlaybackReady={() => markStreamOnline(aTag)}
          onStreamOffline={() => markStreamOffline(aTag)}
        />
      ) : liveStreamUrl ? (
        <div
          onMouseEnter={startHoverPreview}
          onMouseLeave={stopHoverPreview}
          className="relative aspect-video max-h-72 w-full bg-[#0e0e11] overflow-hidden"
        >
          <button
            type="button"
            onClick={handleActivateStream}
            className="block w-full h-full cursor-pointer text-left"
            aria-label={inlineMediaPlayback ? `Play ${title} inline` : `Open ${title} in player`}
          >
            {thumb && !thumbFailed ? (
              <img
                src={thumb}
                alt={title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-300"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] flex items-center justify-center">
                <Avatar src={profile?.picture} pubkey={displayPk} name={hostName} size="lg" />
              </div>
            )}
          </button>
          {hoverActive && !isInMiniPlayer && (
            <LiveHoverPreview
              streamUrl={liveStreamUrl}
              rightOffset
              onStatusChange={setPreviewStatus}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/25 flex items-center justify-center pointer-events-none">
            {previewStatus !== 'playing' && (
              <span className="w-12 h-12 rounded-full bg-[#e8590c]/95 group-hover:scale-105 transition shadow-xl flex items-center justify-center text-white">
                <Play className="w-5 h-5 fill-white ml-0.5" />
              </span>
            )}
          </div>
          <span className="absolute top-2.5 left-2.5 z-10 px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shadow pointer-events-none">
            <Radio className="w-2.5 h-2.5 animate-pulse" />
            {isLive ? 'LIVE' : 'STREAM'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              stopHoverPreview()
              openMiniPlayer({
                aTag,
                naddr: bech32,
                streamUrl: liveStreamUrl,
                posterUrl: thumb,
                title,
                hostName,
                isLive,
              })
            }}
            title="Pop out mini-player and keep browsing"
            aria-label={`Pop out ${title} in mini-player`}
            className="absolute top-2 right-2 z-20 p-1 rounded-md bg-black/75 hover:bg-[#e8590c] border border-white/15 text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition shadow cursor-pointer"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>
          {viewers !== undefined && viewers > 0 && (
            <span className="absolute bottom-2 right-2 z-10 px-2 py-0.5 rounded bg-black/80 text-[11px] font-medium text-[#ece9e1] pointer-events-none">
              {viewers.toLocaleString()} watching
            </span>
          )}
        </div>
      ) : null}

      <Link
        to={`/live/${bech32}`}
        className="p-3 flex items-center justify-between gap-2.5 hover:bg-white/[0.03] transition"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar src={profile?.picture} pubkey={displayPk} name={hostName} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {!liveStreamUrl && (
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold uppercase flex items-center gap-1 shrink-0">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  LIVE
                </span>
              )}
              <span className="text-xs sm:text-sm font-semibold text-white group-hover:text-[#ff922b] truncate transition">
                {title}
              </span>
            </div>
            <div className="text-[11px] text-[#8c8a82] truncate">
              {hostName}
              {liveStreamUrl && !playingInline
                ? inlineMediaPlayback
                  ? ' · Click video to play inline'
                  : ' · Click to open player'
                : ''}
            </div>
          </div>
        </div>
        <span className="text-xs font-semibold text-[#ff8a3d] shrink-0">Full chat →</span>
      </Link>
    </div>
  )
})

/** Isolated quoted-note preview card with inline image, video & YouTube preview support (no nested interactive links). */
const QuotedNoteCard = memo(function QuotedNoteCard({
  eventId,
  bech32,
}: {
  eventId: string
  bech32: string
}) {
  const navigate = useNavigate()
  const quoted = useNostrStore((s) => s.events[eventId])
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const authorProfile = useNostrStore((s) =>
    quoted ? s.profiles[quoted.pubkey] : undefined,
  )
  const parsedQuote = useMemo(() => (quoted ? parseNoteContent(quoted) : null), [quoted])
  const firstImage = parsedQuote?.media.find((m) => m.kind === 'image')
  const firstVideo = parsedQuote?.media.find((m) => m.kind === 'video')
  const firstYoutube = parsedQuote?.youtube[0]

  const hiddenQuoted = useMemo(() => {
    if (!quoted) return false
    return isEventDeleted(quoted) || isEventMuted(quoted)
  }, [quoted, isEventDeleted, isEventMuted, mutedPubkeys, privateMutedPubkeys])

  if (hiddenQuoted) {
    return (
      <div className="my-2 px-3 py-2 rounded-xl bg-[#14161e] border border-[#242734] text-xs text-[#6f6d66] italic">
        Quoted note hidden (muted or deleted)
      </div>
    )
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        const target = e.target as HTMLElement | null
        if (target?.closest('a, button, video, audio, iframe, input')) return
        navigate(`/e/${eventId}`)
      }}
      className="block my-2 p-3 rounded-xl bg-[#161820] border border-[#272a36] hover:border-[#3b3f52] transition text-sm cursor-pointer"
    >
      {quoted ? (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar
              src={authorProfile?.picture}
              pubkey={quoted.pubkey}
              name={authorProfile?.display_name || authorProfile?.name}
              size="sm"
            />
            <span className="text-xs font-medium text-[#c9c6be] truncate">
              {authorProfile?.display_name ||
                authorProfile?.name ||
                `${quoted.pubkey.slice(0, 12)}…`}
            </span>
            <span className="text-[11px] text-[#6f6d66]">
              · {formatRelativeTime(quoted.created_at)}
            </span>
          </div>
          {quoted.content && (
            <p className="text-[#dcd9d0] text-[13px] line-clamp-3 whitespace-pre-wrap break-words">
              {quoted.content
                .replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)(\?\S*)?/gi, '')
                .trim() || quoted.content}
            </p>
          )}
          {firstImage && (
            <img
              src={firstImage.url}
              alt={firstImage.alt || 'Quoted image'}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="mt-2 rounded-lg max-h-72 max-w-full w-auto h-auto object-contain bg-[#0b0b0e] border border-[#242734]"
            />
          )}
          {!firstImage && firstVideo && (
            <video
              src={firstVideo.poster ? firstVideo.url : `${firstVideo.url}#t=0.001`}
              poster={firstVideo.poster}
              controls
              playsInline
              preload="metadata"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 rounded-lg max-h-64 w-full bg-black border border-[#242734]"
            />
          )}
          {!firstImage && !firstVideo && firstYoutube && (
            <div className="mt-2">
              <YouTubeCard video={firstYoutube} compact />
            </div>
          )}
        </>
      ) : (
        <span className="text-xs text-[#ff8a3d]">
          Quoted note ({bech32.slice(0, 18)}…)
        </span>
      )}
    </div>
  )
})

const ReplyContextLine = memo(function ReplyContextLine({
  event,
  hideParentPreview = false,
  onOpenLightbox,
}: {
  event: Event
  hideParentPreview?: boolean
  onOpenLightbox?: (media: MediaAttachment) => void
}) {
  const navigate = useNavigate()
  const refs = useMemo(() => extractReplyRefs(event), [event])
  const replyTargetId = refs.replyId || refs.rootId
  const parentEvent = useNostrStore((s) =>
    replyTargetId ? s.events[replyTargetId] : undefined,
  )
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const fallbackPubkey = useMemo(() => {
    const pTag = event.tags.find((t) => t[0] === 'p' && t[1] && t[1] !== event.pubkey)?.[1]
    return pTag?.toLowerCase()
  }, [event])
  const parentPubkey = parentEvent?.pubkey?.toLowerCase() || fallbackPubkey
  const parentProfile = useNostrStore((s) =>
    parentPubkey ? s.profiles[parentPubkey] : undefined,
  )

  useEffect(() => {
    if (!hideParentPreview && replyTargetId && !parentEvent) {
      queueParentEventFetch(replyTargetId)
    }
  }, [hideParentPreview, replyTargetId, parentEvent])

  const hiddenParent = useMemo(() => {
    if (!parentEvent) return false
    return isEventDeleted(parentEvent) || isEventMuted(parentEvent)
  }, [parentEvent, isEventDeleted, isEventMuted, mutedPubkeys, privateMutedPubkeys])

  const parsedParent = useMemo(
    () => (!hideParentPreview && parentEvent && !hiddenParent ? parseNoteContent(parentEvent) : null),
    [hideParentPreview, parentEvent, hiddenParent],
  )

  if (!replyTargetId) return null

  const label =
    parentProfile?.display_name ||
    parentProfile?.name ||
    (parentPubkey ? `${parentPubkey.slice(0, 10)}…` : 'a note')

  if (hideParentPreview || !parentEvent || hiddenParent) {
    return (
      <div className="flex items-center gap-1 text-xs text-[#8a8880] mb-1">
        <CornerDownRight className="w-3 h-3 shrink-0" />
        <span>Replying to</span>
        <Link
          to={`/e/${replyTargetId}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[#ff8a3d]/90 hover:underline truncate max-w-[220px]"
        >
          @{label}
        </Link>
      </div>
    )
  }

  const parentSnippet = (parentEvent.content || '')
    .replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov|m4v)(\?\S*)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const parentImage = parsedParent?.media.find((m) => m.kind === 'image')
  const parentVideo = parsedParent?.media.find((m) => m.kind === 'video')
  const parentYoutube = parsedParent?.youtube[0]
  const hasParentMedia = Boolean(parentImage || parentVideo || parentYoutube)

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        const target = e.target as HTMLElement | null
        if (target?.closest('a, button, img, video, audio, iframe, input')) return
        navigate(`/e/${replyTargetId}`)
      }}
      className="block mt-1.5 mb-2 p-2.5 rounded-xl bg-[#14161e] border border-[#252836] border-l-2 border-l-[#ff8a3d]/70 hover:border-[#3b4057] hover:border-l-[#ff8a3d] transition group cursor-pointer"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-[#8a8880] mb-1">
        <CornerDownRight className="w-3 h-3 text-[#ff8a3d] shrink-0" />
        <Avatar
          src={parentProfile?.picture}
          pubkey={parentEvent.pubkey}
          name={label}
          size="sm"
        />
        <span className="font-semibold text-[#d4d2cb] group-hover:text-white truncate">
          {label}
        </span>
        <span className="text-[#6f6d66] shrink-0">
          · {formatRelativeTime(parentEvent.created_at)}
        </span>
      </div>

      {(parentSnippet || !hasParentMedia) && (
        <p className="text-xs text-[#c7c4bc] line-clamp-3 leading-relaxed break-words">
          {parentSnippet || 'View original note'}
        </p>
      )}

      {parentImage && (
        <img
          src={parentImage.url}
          alt={parentImage.alt || 'Original note image'}
          loading="lazy"
          referrerPolicy="no-referrer"
          onClick={(e) => {
            e.stopPropagation()
            if (onOpenLightbox) {
              onOpenLightbox(parentImage)
            } else {
              navigate(`/e/${replyTargetId}`)
            }
          }}
          className="mt-2 rounded-lg max-h-72 max-w-full w-auto h-auto object-contain bg-[#0b0b0e] border border-[#242734] hover:border-[#e8590c]/60 transition cursor-zoom-in"
        />
      )}

      {!parentImage && parentVideo && (
        <video
          src={parentVideo.poster ? parentVideo.url : `${parentVideo.url}#t=0.001`}
          poster={parentVideo.poster}
          controls
          playsInline
          preload="metadata"
          onClick={(e) => e.stopPropagation()}
          className="mt-2 rounded-lg max-h-64 w-full bg-black border border-[#242734]"
        />
      )}

      {!parentImage && !parentVideo && parentYoutube && (
        <div className="mt-2">
          <YouTubeCard video={parentYoutube} compact />
        </div>
      )}
    </div>
  )
})

export const NoteCard = memo(function NoteCard({
  event,
  repostedByPubkey,
  hideParentPreview = false,
}: NoteCardProps) {
  const navigate = useNavigate()
  const profile = useNostrStore((s) => s.profiles[event.pubkey])
  const reposterProfile = useNostrStore((s) =>
    repostedByPubkey ? s.profiles[repostedByPubkey] : undefined,
  )
  const replyCount = useNostrStore((s) => s.replyCounts[event.id] || 0)
  const reactionCount = useNostrStore((s) => s.reactionCounts[event.id] || 0)
  const liked = useNostrStore((s) => Boolean(s.userLiked[event.id]))
  const repostCount = useNostrStore((s) => s.repostCounts[event.id] || 0)
  const userReposted = useNostrStore((s) => (s.userRepostIds[event.id]?.length || 0) > 0)
  const zapSats = useNostrStore((s) => s.zapTotalsSats[event.id] || 0)
  const bookmarked = useNostrStore((s) => s.bookmarks.includes(event.id))
  const toggleLike = useNostrStore((s) => s.toggleLike)
  const toggleRepost = useNostrStore((s) => s.toggleRepost)
  const toggleBookmark = useNostrStore((s) => s.toggleBookmark)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)
  const isFollowingAuthor = useNostrStore((s) =>
    s.follows.includes(event.pubkey.toLowerCase()),
  )
  const myPubkey = useAuthStore((s) => s.pubkey)
  const mutePubkey = useSettingsStore((s) => s.mutePubkey)
  const unmutePubkey = useSettingsStore((s) => s.unmutePubkey)
  const isAuthorMuted = useSettingsStore((s) => {
    const pk = event.pubkey.toLowerCase()
    return s.mutedPubkeys.includes(pk) || s.privateMutedPubkeys.includes(pk)
  })
  const muteHashtag = useSettingsStore((s) => s.muteHashtag)
  const isMyNote = Boolean(myPubkey && myPubkey.toLowerCase() === event.pubkey.toLowerCase())

  const [lightboxMedia, setLightboxMedia] = useState<MediaAttachment | null>(null)
  const [altPreview, setAltPreview] = useState<string | null>(null)
  const [zapOpen, setZapOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Pre-check locally whether this note is a live announcement so non-announcement notes NEVER
  // re-render when global live chat/heartbeat updates arrive in useLiveStore!
  const isLiveAnnouncement = useMemo(() => {
    if (parsed.segments.some((seg) => seg.type === 'live')) return false
    const lowerContent = (event.content || '').toLowerCase()
    return (
      event.tags.some(
        (t) =>
          (t[0] === 't' && /^(livestream|letsfo_live|live)$/i.test(t[1] || '')) ||
          (t[0] === 'software' && /live/i.test(t[1] || '')),
      ) || /https?:\/\/[^\s]*\/live\b/i.test(lowerContent)
    )
  }, [event, parsed.segments])

  // Select only a primitive matching aTag string (null for 99.9% of notes -> zero spurious re-renders)
  const matchedAuthorLiveATag = useLiveStore((s) => {
    if (!isLiveAnnouncement) return null
    const authorPk = event.pubkey.toLowerCase()
    const nowSec = Math.floor(Date.now() / 1000)
    for (const entry of Object.values(s.liveStreams)) {
      if (!isLiveStreamFresh(entry, nowSec)) continue
      const matchAuthor =
        entry.activity.hostPubkey.toLowerCase() === authorPk ||
        entry.activity.streamerPubkey?.toLowerCase() === authorPk
      if (!matchAuthor) continue
      if (Math.abs(event.created_at - entry.activity.createdAt) <= 4 * 3600) {
        return entry.aTagValue
      }
    }
    return null
  })

  const matchedAuthorLive = useMemo(() => {
    if (!matchedAuthorLiveATag) return null
    const entry = useLiveStore.getState().liveStreams[matchedAuthorLiveATag]
    if (!entry) return null
    return {
      hostPubkey: entry.activity.hostPubkey,
      dTag: entry.activity.dTag,
      bech32: encodeLiveNaddr(
        entry.activity.hostPubkey,
        entry.activity.dTag,
        entry.activity.relayHints,
      ),
    }
  }, [matchedAuthorLiveATag])

  const hasVisibleBody = useMemo(
    () => parsed.segments.some((seg) => seg.type !== 'text' || seg.text.trim().length > 0),
    [parsed.segments],
  )

  const isLongNote = useMemo(() => {
    const textLen = (event.content || '').length
    if (textLen > LONG_NOTE_CHAR_LIMIT) return true
    const lines = (event.content || '').split('\n').length
    return lines > LONG_NOTE_LINE_LIMIT
  }, [event.content])

  // Close ••• menu on outside click or Escape (works reliably on mobile & desktop)
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Lazily fetch quoted events & mentioned author profiles
  useEffect(() => {
    const store = useNostrStore.getState()
    const mentionedPubkeys = parsed.segments
      .filter((seg): seg is { type: 'mention'; bech32: string; pubkey: string } => seg.type === 'mention')
      .map((seg) => seg.pubkey)
    if (mentionedPubkeys.length > 0) {
      void store.fetchProfiles(mentionedPubkeys)
    }

    const missing = parsed.quotes
      .filter((qid) => !store.events[qid] && !requestedQuotes.has(qid))
      .slice(0, 4)
    if (missing.length === 0) return
    for (const qid of missing) requestedQuotes.add(qid)
    const relays = [
      ...new Set([...useSettingsStore.getState().getReadRelays(), ...store.userReadRelays]),
    ].slice(0, 8)
    void nostrPool.query(relays, { ids: missing }, 3500).then((evs) => {
      const st = useNostrStore.getState()
      for (const q of evs) st.ingestEvent(q)
      if (evs.length > 0) void st.fetchProfiles(evs.map((q) => q.pubkey))
    })
  }, [parsed.quotes, parsed.segments])

  // Click anywhere on card body opens the thread (ignoring interactive controls and text selection)
  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented) return
    const sel = window.getSelection()?.toString()
    if (sel && sel.length > 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('a, button, img, video, audio, iframe, input, textarea, [role="dialog"]')) {
      return
    }
    navigate(`/e/${event.id}`)
  }

  return (
    <article
      onClick={handleCardClick}
      className="border-b border-[#20222c] px-4 py-3.5 hover:bg-white/[0.02] transition cursor-pointer"
    >
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

            <div className="flex items-center gap-1 shrink-0">
              {!isMyNote && isFollowingAuthor && (
                <button
                  type="button"
                  disabled={followBusy}
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (followBusy) return
                    setFollowBusy(true)
                    try {
                      await toggleFollow(event.pubkey)
                    } finally {
                      setFollowBusy(false)
                    }
                  }}
                  title={`Unfollow ${displayName}`}
                  aria-label={`Unfollow ${displayName}`}
                  className="px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50 bg-[#1a1c26] hover:bg-amber-500/15 border-[#2d3042] hover:border-amber-500/45 text-[#c7c4bc] hover:text-amber-300"
                >
                  <UserMinus className="w-3 h-3" />
                  <span className="hidden sm:inline">
                    {followBusy ? '…' : 'Unfollow'}
                  </span>
                </button>
              )}

              {!isMyNote && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isAuthorMuted) {
                      unmutePubkey(event.pubkey)
                      useNostrStore.getState().setToast(`Unblocked ${displayName}`)
                    } else {
                      mutePubkey(event.pubkey)
                      useNostrStore.getState().setToast(`Blocked ${displayName} (undo in Settings)`)
                    }
                  }}
                  title={isAuthorMuted ? `Unblock ${displayName}` : `Block & mute ${displayName}`}
                  aria-label={isAuthorMuted ? `Unblock ${displayName}` : `Block ${displayName}`}
                  className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                    isAuthorMuted
                      ? 'bg-red-600/30 hover:bg-red-600/45 border-red-500/60 text-red-200'
                      : 'bg-red-500/10 hover:bg-red-500/25 border-red-500/25 hover:border-red-500/50 text-red-400 hover:text-red-300'
                  }`}
                >
                  <Ban className="w-3 h-3" />
                  <span className="hidden sm:inline">
                    {isAuthorMuted ? 'Blocked' : 'Block User'}
                  </span>
                </button>
              )}

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="p-1 rounded-lg text-[#7c7a72] hover:text-white hover:bg-white/5 cursor-pointer"
                  aria-label="Note actions"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-1 w-44 rounded-xl bg-[#1a1c24] border border-[#2c2f3e] shadow-xl py-1 z-20 text-xs">
                    {!isMyNote && (
                      <button
                        type="button"
                        disabled={followBusy}
                        onClick={async () => {
                          if (followBusy) return
                          setFollowBusy(true)
                          setMenuOpen(false)
                          try {
                            await toggleFollow(event.pubkey)
                          } finally {
                            setFollowBusy(false)
                          }
                        }}
                        className="w-full px-3 py-2 text-left text-[#d4d2cb] hover:bg-white/5 hover:text-amber-300 font-medium flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {isFollowingAuthor ? (
                          <>
                            <UserMinus className="w-3.5 h-3.5 text-amber-400" />
                            Unfollow user
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5 text-[#ff8a3d]" />
                            Follow user
                          </>
                        )}
                      </button>
                    )}
                    {!isMyNote && (
                      <button
                        onClick={() => {
                          if (isAuthorMuted) {
                            unmutePubkey(event.pubkey)
                            useNostrStore.getState().setToast(`Unblocked ${displayName}`)
                          } else {
                            mutePubkey(event.pubkey)
                            useNostrStore.getState().setToast(`Blocked ${displayName} (undo in Settings)`)
                          }
                          setMenuOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300 font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        {isAuthorMuted ? 'Unblock user' : 'Block / Mute user'}
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(nip19.noteEncode(event.id))
                          useNostrStore.getState().setToast('Copied note ID')
                        } catch {
                          useNostrStore.getState().setToast('Clipboard permission unavailable')
                        }
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
          </div>

          <ReplyContextLine
            event={event}
            hideParentPreview={hideParentPreview}
            onOpenLightbox={setLightboxMedia}
          />

          {/* Body segments (collapses long walls of text cleanly like Jumble) */}
          {hasVisibleBody && (
            <div className="relative">
              <div
                className={`mt-1.5 text-[15px] leading-relaxed text-[#ece9e1] whitespace-pre-wrap break-words ${
                  isLongNote && !expanded ? 'max-h-72 overflow-hidden' : ''
                }`}
              >
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
                    return <MentionChip key={i} pubkey={seg.pubkey} bech32={seg.bech32} />
                  }
                  if (seg.type === 'quote' && seg.eventId) {
                    return <QuotedNoteCard key={i} eventId={seg.eventId} bech32={seg.bech32} />
                  }
                  if (seg.type === 'live') {
                    return (
                      <LiveStreamEmbedCard
                        key={i}
                        hostPubkey={seg.hostPubkey}
                        dTag={seg.dTag}
                        bech32={seg.bech32}
                      />
                    )
                  }
                  return null
                })}
              </div>
              {isLongNote && !expanded && (
                <div className="pt-4 -mt-10 relative bg-gradient-to-t from-[#0e0e11] via-[#0e0e11]/90 to-transparent">
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-xs font-semibold text-[#ff8a3d] hover:underline cursor-pointer"
                  >
                    Show more
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Author's active livestream preview card for #livestream / /live announcement notes */}
          {matchedAuthorLive && (
            <LiveStreamEmbedCard
              hostPubkey={matchedAuthorLive.hostPubkey}
              dTag={matchedAuthorLive.dTag}
              bech32={matchedAuthorLive.bech32}
            />
          )}

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
                  className="relative rounded-xl overflow-hidden border border-[#262834] bg-[#0b0b0e] flex items-center justify-center"
                >
                  {m.kind === 'image' && (
                    <img
                      src={m.url}
                      alt={m.alt || 'Note image'}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onClick={() => setLightboxMedia(m)}
                      className={`${
                        parsed.media.length === 1
                          ? 'max-h-[620px] max-w-full w-auto h-auto'
                          : 'max-h-80 w-full'
                      } object-contain cursor-zoom-in`}
                    />
                  )}
                  {m.kind === 'video' && (
                    <video
                      src={m.poster ? m.url : `${m.url}#t=0.001`}
                      poster={m.poster}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full max-h-[560px] bg-black"
                    />
                  )}
                  {m.kind === 'audio' && (
                    <audio src={m.url} controls preload="none" className="w-full p-2" />
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

          {/* YouTube preview cards (Option 1B — privacy-first thumbnail & title card, zero iframes) */}
          {parsed.youtube.length > 0 && (
            <div
              className={`mt-2.5 grid gap-2 ${
                parsed.youtube.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {parsed.youtube.map((yt) => (
                <YouTubeCard key={yt.videoId} video={yt} />
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
              {replyCount > 0 && <span>{replyCount}</span>}
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
})
