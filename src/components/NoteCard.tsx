import { Suspense, lazy, memo, useEffect, useMemo, useRef, useState } from 'react'
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
  SmilePlus,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { formatRelativeTime } from '../lib/format'
import { extractReplyRefs, parseNoteContent, type MediaAttachment } from '../lib/nostr/content'
import {
  CUSTOM_REACTION_EMOTES,
  getBuiltinEmoteByKey,
  resolveReactionEmoteSrc,
} from '../lib/nostr/customEmotes'
import { buildLiveATag, encodeLiveNaddr, isLiveStreamFresh } from '../lib/nostr/nip53'
import { nostrPool } from '../lib/nostr/pool'
import { verifyEventPow } from '../lib/crypto/nip13'
import { formatAudioSourceLabel, isConnectionSaveData } from '../lib/mediaAudio'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { FireWispVideoPlayer } from './FireWispVideoPlayer'
import { HlsVideoPlayer } from './HlsVideoPlayer'
import { LiveHoverPreview, type HoverPreviewStatus } from './LiveHoverPreview'
import { MediaLightbox } from './MediaLightbox'
import { AddToListButton } from './AddToListButton'
import { ReactionEmote } from './ReactionEmote'
import { SongLinkCard } from './SongLinkCard'
import { YouTubeCard } from './YouTubeCard'

const ZapModal = lazy(() => import('./ZapModal').then((m) => ({ default: m.ZapModal })))
const MuteWordModal = lazy(() =>
  import('./MuteWordModal').then((m) => ({ default: m.MuteWordModal })),
)
const SaveToBookmarkSetMenu = lazy(() =>
  import('./SaveToBookmarkSetMenu').then((m) => ({ default: m.SaveToBookmarkSetMenu })),
)

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

const EMPTY_EMOJI_COUNTS: Record<string, number> = {}
const EMPTY_EMOJI_URLS: Record<string, string> = {}
const EMPTY_USER_REACTIONS: Record<string, true> = {}
const QUICK_BAR_EMOJIS = ['😂', '💯'] as const
const PICKER_EMOJIS: Array<{ emoji: string; label: string }> = [
  { emoji: '🚀', label: 'Rocket' },
  { emoji: '🤗', label: 'Hug' },
  { emoji: '👀', label: 'Eyes' },
  { emoji: '🤔', label: 'Thinking' },
  { emoji: '😱', label: 'Shocked' },
]

interface NoteCardProps {
  event: Event
  repostedByPubkey?: string
  hideParentPreview?: boolean
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
  const mobileDataSaving = useSettingsStore((s) => s.mobileDataSaving)
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
    if (
      !hoverStreamPreview ||
      mobileDataSaving ||
      isConnectionSaveData() ||
      !liveStreamUrl ||
      playingInline ||
      isInMiniPlayer
    ) {
      return
    }
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
          sourceLabel={formatAudioSourceLabel(hostName, title, effectivePlayUrl)}
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
          className="relative z-[6] aspect-video max-h-72 w-full bg-[#0e0e11] overflow-hidden"
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
              sourceLabel={formatAudioSourceLabel(hostName, title, liveStreamUrl)}
              rightOffset
              onStatusChange={setPreviewStatus}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/25 pointer-events-none" />
          {/* Center play controls: Big Yellow Full Play + smaller Red Mini Play (Mini-player) */}
          <div
            className={`absolute inset-0 z-20 flex items-center justify-center gap-2.5 transition pointer-events-none ${
              previewStatus === 'playing'
                ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                : 'opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={handleActivateStream}
              title={inlineMediaPlayback ? `Play ${title}` : `Open ${title} on Live screen`}
              aria-label={inlineMediaPlayback ? `Play ${title}` : `Open ${title} on Live screen`}
              className={`pointer-events-auto w-12 h-12 rounded-full text-black flex flex-col items-center justify-center gap-[1px] border border-yellow-200/70 shadow-xl transition hover:scale-105 cursor-pointer ${
                previewStatus === 'playing'
                  ? 'bg-yellow-400/85 hover:bg-yellow-400 backdrop-blur-xs'
                  : 'bg-yellow-400/95 hover:bg-yellow-300'
              }`}
            >
              <Play className="w-4 h-4 fill-black ml-0.5" />
              <span className="text-[9px] font-extrabold leading-none tracking-tight">Full</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
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
              title="Open in Mini-player"
              aria-label={`Play ${title} in mini-player`}
              className="pointer-events-auto w-9 h-9 rounded-full bg-red-600/90 hover:bg-red-500 border border-red-300/50 backdrop-blur-xs text-white flex flex-col items-center justify-center gap-[1px] shadow-xl transition hover:scale-105 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-white ml-0.5" />
              <span className="text-[8px] font-bold leading-none tracking-tight">Mini</span>
            </button>
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
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const authorProfile = useNostrStore((s) =>
    quoted ? s.profiles[quoted.pubkey] : undefined,
  )
  const parsedQuote = useMemo(() => (quoted ? parseNoteContent(quoted) : null), [quoted])
  const firstImage = parsedQuote?.media.find((m) => m.kind === 'image')
  const firstVideo = parsedQuote?.media.find((m) => m.kind === 'video')
  const firstYoutube = parsedQuote?.youtube[0]
  const firstSongLink = parsedQuote?.songLinks[0]

  const hiddenQuoted = useMemo(() => {
    if (!quoted) return false
    return isEventDeleted(quoted) || isEventMuted(quoted)
  }, [
    quoted,
    deletedByAuthor,
    isEventDeleted,
    isEventMuted,
    mutedPubkeys,
    privateMutedPubkeys,
    mutedHashtags,
    privateMutedHashtags,
    mutedWords,
    privateMutedWords,
  ])

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
              className="relative z-[6] mt-2 rounded-lg max-h-72 max-w-full w-auto h-auto object-contain bg-[#0b0b0e] border border-[#242734]"
            />
          )}
          {!firstImage && firstVideo && (
            <div className="relative z-[6] mt-2 rounded-lg overflow-hidden border border-[#242734]">
              <FireWispVideoPlayer
                src={firstVideo.url}
                poster={firstVideo.poster}
                sourceLabel={formatAudioSourceLabel(
                  authorProfile?.display_name || authorProfile?.name,
                  firstVideo.alt || 'Quoted video',
                  firstVideo.url,
                )}
                compact
                videoClassName="max-h-64 w-full object-contain bg-black"
              />
            </div>
          )}
          {!firstImage && !firstVideo && firstYoutube && (
            <div className="relative z-[6] mt-2">
              <YouTubeCard video={firstYoutube} compact />
            </div>
          )}
          {!firstImage && !firstVideo && !firstYoutube && firstSongLink && (
            <div className="relative z-[6] mt-2">
              <SongLinkCard song={firstSongLink} compact />
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
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
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
  }, [
    parentEvent,
    deletedByAuthor,
    isEventDeleted,
    isEventMuted,
    mutedPubkeys,
    privateMutedPubkeys,
    mutedHashtags,
    privateMutedHashtags,
    mutedWords,
    privateMutedWords,
  ])

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
  const parentSongLink = parsedParent?.songLinks[0]
  const hasParentMedia = Boolean(parentImage || parentVideo || parentYoutube || parentSongLink)

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
          className="relative z-[6] mt-2 rounded-lg max-h-72 max-w-full w-auto h-auto object-contain bg-[#0b0b0e] border border-[#242734] hover:border-[#e8590c]/60 transition cursor-zoom-in"
        />
      )}

      {!parentImage && parentVideo && (
        <div className="relative z-[6] mt-2 rounded-lg overflow-hidden border border-[#242734]">
          <FireWispVideoPlayer
            src={parentVideo.url}
            poster={parentVideo.poster}
            sourceLabel={formatAudioSourceLabel(
              label,
              parentVideo.alt || 'Reply video',
              parentVideo.url,
            )}
            compact
            videoClassName="max-h-64 w-full object-contain bg-black"
          />
        </div>
      )}

      {!parentImage && !parentVideo && parentYoutube && (
        <div className="relative z-[6] mt-2">
          <YouTubeCard video={parentYoutube} compact />
        </div>
      )}
      {!parentImage && !parentVideo && !parentYoutube && parentSongLink && (
        <div className="relative z-[6] mt-2">
          <SongLinkCard song={parentSongLink} compact />
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
  const emojiCounts = useNostrStore(
    (s) => s.reactionEmojiCounts[event.id] ?? EMPTY_EMOJI_COUNTS,
  )
  const emojiUrls = useNostrStore(
    (s) => s.reactionEmojiUrls[event.id] ?? EMPTY_EMOJI_URLS,
  )
  const liked = useNostrStore((s) => Boolean(s.userLiked[event.id]))
  const myReactions = useNostrStore(
    (s) => s.userReactions[event.id] ?? EMPTY_USER_REACTIONS,
  )
  const repostCount = useNostrStore((s) => s.repostCounts[event.id] || 0)
  const userReposted = useNostrStore((s) => (s.userRepostIds[event.id]?.length || 0) > 0)
  const zapSats = useNostrStore((s) => s.zapTotalsSats[event.id] || 0)
  const bookmarked = useNostrStore((s) => s.bookmarks.includes(event.id))
  const toggleLike = useNostrStore((s) => s.toggleLike)
  const toggleRepost = useNostrStore((s) => s.toggleRepost)
  const toggleBookmark = useNostrStore((s) => s.toggleBookmark)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)
  const blockPubkey = useNostrStore((s) => s.blockPubkey)
  const unblockPubkey = useNostrStore((s) => s.unblockPubkey)
  const muteHashtagGlobal = useNostrStore((s) => s.muteHashtagGlobal)
  const isFollowingAuthor = useNostrStore((s) =>
    s.follows.includes(event.pubkey.toLowerCase()),
  )
  const myPubkey = useAuthStore((s) => s.pubkey)
  const isAuthorMuted = useSettingsStore((s) => {
    const pk = event.pubkey.toLowerCase()
    return s.mutedPubkeys.includes(pk) || s.privateMutedPubkeys.includes(pk)
  })
  const isMyNote = Boolean(myPubkey && myPubkey.toLowerCase() === event.pubkey.toLowerCase())

  const [lightboxMedia, setLightboxMedia] = useState<MediaAttachment | null>(null)
  const [altPreview, setAltPreview] = useState<string | null>(null)
  const [zapOpen, setZapOpen] = useState(false)
  const [muteWordOpen, setMuteWordOpen] = useState(false)
  const [saveSetOpen, setSaveSetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reactPickerOpen, setReactPickerOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const reactPickerRef = useRef<HTMLDivElement>(null)

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

  const [mountSec] = useState(() => Math.floor(Date.now() / 1000))

  // Select only a primitive matching aTag string (null for 99.9% of notes -> zero spurious re-renders)
  const matchedAuthorLiveATag = useLiveStore((s) => {
    if (!isLiveAnnouncement) return null
    const authorPk = event.pubkey.toLowerCase()
    for (const entry of Object.values(s.liveStreams)) {
      if (!isLiveStreamFresh(entry, mountSec)) continue
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

  useEffect(() => {
    if (!reactPickerOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (reactPickerRef.current && !reactPickerRef.current.contains(e.target as Node)) {
        setReactPickerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReactPickerOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [reactPickerOpen])

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
    if (
      target?.closest(
        'a, button, img, video, audio, iframe, input, textarea, [role="dialog"], [role="menu"]',
      )
    ) {
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
              {!isMyNote && (
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
                  title={isFollowingAuthor ? `Unfollow ${displayName}` : `Follow ${displayName}`}
                  aria-label={isFollowingAuthor ? `Unfollow ${displayName}` : `Follow ${displayName}`}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                    isFollowingAuthor
                      ? 'bg-[#1a1c26] hover:bg-amber-500/15 border-[#2d3042] hover:border-amber-500/45 text-[#c7c4bc] hover:text-amber-300'
                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 hover:border-emerald-400 text-emerald-300'
                  }`}
                >
                  {isFollowingAuthor ? (
                    <>
                      <UserMinus className="w-3 h-3" />
                      <span>{followBusy ? '…' : 'Unf'}</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3 h-3" />
                      <span>{followBusy ? '…' : 'Fol'}</span>
                    </>
                  )}
                </button>
              )}

              {!isMyNote && (
                <AddToListButton pubkey={event.pubkey} displayName={displayName} variant="compact" />
              )}

              {!isMyNote && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isAuthorMuted) {
                      void unblockPubkey(event.pubkey, displayName)
                    } else {
                      void blockPubkey(event.pubkey, displayName)
                    }
                  }}
                  title={isAuthorMuted ? `Unblock ${displayName}` : `Block & mute ${displayName}`}
                  aria-label={isAuthorMuted ? `Unblock ${displayName}` : `Block ${displayName}`}
                  className={`p-1.5 rounded-lg border transition cursor-pointer ${
                    isAuthorMuted
                      ? 'bg-red-600/30 hover:bg-red-600/45 border-red-500/60 text-red-200'
                      : 'bg-red-500/10 hover:bg-red-500/25 border-red-500/25 hover:border-red-500/50 text-red-400 hover:text-red-300'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" />
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
                  <div
                    role="menu"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 mt-1 w-48 rounded-xl bg-[#1a1c24] border border-[#2c2f3e] shadow-xl py-1 z-20 text-xs"
                  >
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
                            void unblockPubkey(event.pubkey, displayName)
                          } else {
                            void blockPubkey(event.pubkey, displayName)
                          }
                          setMenuOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/10 hover:text-red-300 font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        {isAuthorMuted ? 'Unblock user' : 'Block / Mute user'}
                      </button>
                    )}
                    {!isMyNote && (
                      <button
                        onClick={() => {
                          setMuteWordOpen(true)
                          setMenuOpen(false)
                        }}
                        className="w-full px-3 py-2 text-left text-[#ff8a3d] hover:bg-[#e8590c]/15 hover:text-[#ffa94d] font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <VolumeX className="w-3.5 h-3.5" />
                        Mute word / domain…
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setSaveSetOpen(true)
                        setMenuOpen(false)
                      }}
                      className="w-full px-3 py-2 text-left text-[#f59f00] hover:bg-[#f59f00]/10 font-medium flex items-center gap-2 cursor-pointer"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      Save to bookmark list…
                    </button>
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
                          type="button"
                          onClick={() => void muteHashtagGlobal(seg.tag)}
                          title={`Mute #${seg.tag}`}
                          aria-label={`Mute hashtag ${seg.tag}`}
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
              className={`relative z-[6] mt-2.5 grid gap-2 ${
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
                    <FireWispVideoPlayer
                      src={m.url}
                      poster={m.poster}
                      sourceLabel={formatAudioSourceLabel(
                        displayName,
                        m.alt || 'Video note',
                        m.url,
                      )}
                      videoClassName="w-full max-h-[560px] object-contain bg-black"
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
                      aria-label="Show image alt text"
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

          {/* song.link / album.link / odesli cards (privacy-first iTunes preview + external link) */}
          {parsed.songLinks.length > 0 && (
            <div
              className={`mt-2.5 grid gap-2 ${
                parsed.songLinks.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
              }`}
            >
              {parsed.songLinks.map((song) => (
                <SongLinkCard key={song.url} song={song} authorName={displayName} />
              ))}
            </div>
          )}

          {altPreview && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-2 p-2.5 rounded-xl bg-[#181a22] border border-[#2c3040] text-xs text-[#d4d2cb]"
            >
              <span className="font-semibold text-[#f59f00] mr-1.5">ALT:</span>
              {altPreview}
            </div>
          )}

          {(() => {
            const extraChips = Object.entries(emojiCounts)
              .filter(([k, n]) => k !== '+' && k !== '😂' && k !== '💯' && n > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
            if (extraChips.length === 0) return null
            return (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {extraChips.map(([emoji, count]) => {
                  const mine = Boolean(myReactions[emoji])
                  const builtin = getBuiltinEmoteByKey(emoji)
                  const emoteSrc = resolveReactionEmoteSrc(emoji, undefined, emojiUrls[emoji])
                  const chipLabel = builtin?.label || emoji
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => void toggleLike(event, emoji, emojiUrls[emoji])}
                      title={`React with ${chipLabel}`}
                      className={`px-2 py-0.5 rounded-full border text-[11px] flex items-center gap-1 transition cursor-pointer ${
                        mine
                          ? 'bg-[#e8590c]/20 border-[#e8590c]/50 text-white'
                          : 'bg-[#171822] hover:bg-[#1e2030] border-[#262938] text-[#c7c4bc]'
                      }`}
                    >
                      {emoteSrc ? (
                        <ReactionEmote
                          src={emoteSrc}
                          alt={chipLabel}
                          fallback={emoji}
                          className="w-4 h-4 object-contain shrink-0"
                        />
                      ) : (
                        <span>{emoji}</span>
                      )}
                      <span>{count}</span>
                    </button>
                  )
                })}
              </div>
            )
          })()}

          {/* Action bar */}
          <div className="mt-3 flex items-center justify-between max-w-lg text-[#8c8a82]">
            <Link
              to={`/e/${event.id}`}
              className="flex items-center gap-1.5 text-xs hover:text-[#ff8a3d] transition p-1 -ml-1 rounded-lg"
              title="Reply / Open thread"
            >
              <MessageCircle className="w-4 h-4" />
              {replyCount > 0 && <span>{replyCount}</span>}
            </Link>

            <button
              type="button"
              onClick={() => void toggleRepost(event)}
              className={`flex items-center gap-1.5 text-xs transition p-1 rounded-lg cursor-pointer ${
                userReposted
                  ? 'text-emerald-400 hover:text-emerald-300'
                  : 'hover:text-emerald-400'
              }`}
              title={userReposted ? 'Undo repost (NIP-09)' : 'Repost'}
              aria-label={userReposted ? 'Undo repost' : 'Repost'}
            >
              <Repeat2 className="w-4 h-4" />
              {repostCount > 0 && <span>{repostCount}</span>}
            </button>

            <div className="relative flex items-center gap-1" ref={reactPickerRef}>
              {(() => {
                const heartCount =
                  emojiCounts['+'] ?? (Object.keys(emojiCounts).length === 0 ? reactionCount : 0)
                const heartActive = liked || Boolean(myReactions['+'])
                return (
                  <button
                    type="button"
                    onClick={() => void toggleLike(event, '+')}
                    className={`flex items-center gap-1 text-xs transition p-1 rounded-lg cursor-pointer ${
                      heartActive ? 'text-rose-500' : 'hover:text-rose-400'
                    }`}
                    title="Like (mines NIP-13 PoW if enabled)"
                    aria-label={heartActive ? 'Liked' : 'Like note'}
                  >
                    <Heart className={`w-4 h-4 ${heartActive ? 'fill-current' : ''}`} />
                    {heartCount > 0 && <span>{heartCount}</span>}
                  </button>
                )
              })()}

              {QUICK_BAR_EMOJIS.map((em) => {
                const cnt = emojiCounts[em] || 0
                const mine = Boolean(myReactions[em])
                return (
                  <button
                    key={em}
                    type="button"
                    onClick={() => void toggleLike(event, em)}
                    title={`React with ${em}`}
                    aria-label={`React with ${em}`}
                    className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-lg border transition cursor-pointer ${
                      mine
                        ? 'bg-[#f59f00]/15 border-[#f59f00]/45 text-white'
                        : 'border-transparent opacity-70 hover:opacity-100 hover:bg-white/5 text-[#c7c4bc]'
                    }`}
                  >
                    <span className="text-[13px] leading-none">{em}</span>
                    {cnt > 0 && <span className="text-[11px]">{cnt}</span>}
                  </button>
                )
              })}

              <button
                type="button"
                onClick={() => setReactPickerOpen((o) => !o)}
                title="More reactions"
                aria-label="More reactions"
                aria-expanded={reactPickerOpen}
                className={`p-1 rounded-lg transition cursor-pointer ${
                  reactPickerOpen
                    ? 'text-[#f59f00] bg-white/5'
                    : 'text-[#6f6d66] hover:text-[#d4d2cb] hover:bg-white/5'
                }`}
              >
                <SmilePlus className="w-4 h-4" />
              </button>

              {reactPickerOpen && (
                <div
                  role="menu"
                  aria-label="Quick emoji reactions"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-1.5 py-1.5 rounded-xl bg-[#1a1c26] border border-[#2c2f40] shadow-xl flex flex-col gap-1 z-30 w-max"
                >
                  <div className="flex items-center gap-1">
                    {PICKER_EMOJIS.map(({ emoji, label }) => {
                      const cnt = emojiCounts[emoji] || 0
                      const mine = Boolean(myReactions[emoji])
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => {
                            setReactPickerOpen(false)
                            void toggleLike(event, emoji)
                          }}
                          title={label}
                          aria-label={`React with ${label}`}
                          className={`px-1.5 py-1 rounded-lg text-sm flex items-center gap-0.5 transition cursor-pointer ${
                            mine
                              ? 'bg-[#e8590c]/25 ring-1 ring-[#e8590c]/60 text-white'
                              : 'hover:bg-white/10 text-[#ece9e1]'
                          }`}
                        >
                          <span className="leading-none">{emoji}</span>
                          {cnt > 0 && <span className="text-[10px] text-[#9a9890]">{cnt}</span>}
                        </button>
                      )
                    })}
                  </div>
                  <div className="border-t border-[#262938] pt-1 flex items-center justify-around gap-1">
                    {CUSTOM_REACTION_EMOTES.map((em) => {
                      const cnt = emojiCounts[em.key] || 0
                      const mine = Boolean(myReactions[em.key])
                      return (
                        <button
                          key={em.shortcode}
                          type="button"
                          onClick={() => {
                            setReactPickerOpen(false)
                            void toggleLike(event, em.key, em.publicUrl)
                          }}
                          title={em.label}
                          aria-label={`React with ${em.label}`}
                          className={`px-1.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer ${
                            mine
                              ? 'bg-[#e8590c]/25 ring-1 ring-[#e8590c]/60 text-white'
                              : 'hover:bg-white/10 text-[#ece9e1]'
                          }`}
                        >
                          <img
                            src={em.localSrc}
                            alt={em.label}
                            className="w-5 h-5 object-contain shrink-0"
                          />
                          {cnt > 0 && <span className="text-[10px] text-[#9a9890]">{cnt}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={!profile?.lud16}
              onClick={() => setZapOpen(true)}
              className={`flex items-center gap-1.5 text-xs transition p-1 rounded-lg ${
                profile?.lud16
                  ? 'hover:text-[#f59f00] cursor-pointer'
                  : 'opacity-30 cursor-not-allowed'
              }`}
              title={profile?.lud16 ? `Zap ${profile.lud16}` : 'Author has no Lightning Address'}
              aria-label={profile?.lud16 ? `Zap ${displayName}` : 'Zap unavailable'}
            >
              <Zap className={`w-4 h-4 ${zapSats > 0 ? 'text-[#f59f00]' : ''}`} />
              {zapSats > 0 && <span className="text-[#f59f00]">{zapSats.toLocaleString()}</span>}
            </button>

            <button
              type="button"
              onClick={() => void toggleBookmark(event.id)}
              className={`flex items-center gap-1 text-xs transition p-1 rounded-lg cursor-pointer ${
                bookmarked ? 'text-[#ff8a3d]' : 'hover:text-[#ff8a3d]'
              }`}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark note'}
            >
              <Bookmark className={`w-4 h-4 ${bookmarked ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />

      {zapOpen && profile?.lud16 && (
        <Suspense fallback={null}>
          <ZapModal
            recipientPubkey={event.pubkey}
            recipientName={displayName}
            lud16={profile.lud16}
            eventId={event.id}
            onClose={() => setZapOpen(false)}
          />
        </Suspense>
      )}
      {muteWordOpen && (
        <Suspense fallback={null}>
          <MuteWordModal noteContent={event.content} onClose={() => setMuteWordOpen(false)} />
        </Suspense>
      )}
      {saveSetOpen && (
        <Suspense fallback={null}>
          <SaveToBookmarkSetMenu noteId={event.id} onClose={() => setSaveSetOpen(false)} />
        </Suspense>
      )}
    </article>
  )
})
