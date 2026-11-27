import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import {
  ArrowLeft,
  Zap,
  Ban,
  UserMinus,
  UserPlus,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Pencil,
  ExternalLink,
} from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { parseNoteContent, type MediaAttachment } from '../lib/nostr/content'
import { isTopLevelNote } from '../lib/nostr/spamFilter'
import { sanitizePublicHttpsUrl, sanitizePublicRelayUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { AddToListButton } from '../components/AddToListButton'
import { Avatar } from '../components/Avatar'
import { MediaLightbox } from '../components/MediaLightbox'
import { WotBadge } from '../components/WotBadge'
import { NoteCard } from '../components/NoteCard'

const ZapModal = lazy(() =>
  import('../components/ZapModal').then((m) => ({ default: m.ZapModal })),
)
const EditProfileModal = lazy(() =>
  import('../components/EditProfileModal').then((m) => ({ default: m.EditProfileModal })),
)

type ProfileTab = 'notes' | 'replies' | 'media'

export function ProfilePage() {
  const { pubkey: rawId } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)

  const hexPubkey = useMemo(() => {
    if (!rawId) return ''
    if (/^[0-9a-f]{64}$/i.test(rawId)) return rawId.toLowerCase()
    try {
      const dec = nip19.decode(rawId)
      if (dec.type === 'npub') return dec.data
      if (dec.type === 'nprofile') return dec.data.pubkey
    } catch {
      // invalid
    }
    return ''
  }, [rawId])

  const profile = useNostrStore((s) => (hexPubkey ? s.profiles[hexPubkey] : undefined))
  const eventsMap = useNostrStore((s) => s.events)
  const follows = useNostrStore((s) => s.follows)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)
  const blockPubkey = useNostrStore((s) => s.blockPubkey)
  const unblockPubkey = useNostrStore((s) => s.unblockPubkey)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () =>
      [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(
        0,
        12,
      ),
    [relays, userReadRelays],
  )

  const [rawEvents, setRawEvents] = useState<Event[]>([])
  const [profileRelays, setProfileRelays] = useState<string[]>([])
  const [tab, setTab] = useState<ProfileTab>('notes')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [noMoreOlder, setNoMoreOlder] = useState(false)
  const [zapOpen, setZapOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  const [lightboxMedia, setLightboxMedia] = useState<MediaAttachment | null>(null)
  const loadGenRef = useRef(0)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const npub = useMemo(() => {
    if (!hexPubkey) return ''
    try {
      return nip19.npubEncode(hexPubkey)
    } catch {
      return hexPubkey
    }
  }, [hexPubkey])

  const isMe = Boolean(myPubkey && hexPubkey && myPubkey.toLowerCase() === hexPubkey.toLowerCase())
  const isFollowing = Boolean(hexPubkey && follows.includes(hexPubkey.toLowerCase()))
  const isMuted = Boolean(
    hexPubkey &&
      (mutedPubkeys.includes(hexPubkey.toLowerCase()) ||
        privateMutedPubkeys.includes(hexPubkey.toLowerCase())),
  )
  const bannerUrl = sanitizePublicHttpsUrl(profile?.banner)
  const displayName = profile?.display_name || profile?.name || `${npub.slice(0, 14)}…`

  useEffect(() => {
    setBannerFailed(false)
  }, [bannerUrl])

  const loadProfileData = useCallback(
    async (isRefresh: boolean) => {
      if (!hexPubkey) return
      const gen = ++loadGenRef.current
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
        setLoadingMore(false)
        setRefreshing(false)
        setZapOpen(false)
        setNoMoreOlder(false)
        setTab('notes')
        setRawEvents([])
        void fetchProfiles([hexPubkey], { force: true })
      }

      try {
        // Discover the user's NIP-65 write relays so notes & media hosted on personal relays always load
        const relayListEvents = await nostrPool.query(
          readRelays,
          { kinds: [10002], authors: [hexPubkey], limit: 2 },
          2500,
        )
        if (loadGenRef.current !== gen) return

        const userWriteRelays: string[] = []
        if (relayListEvents.length > 0) {
          for (const tag of relayListEvents[0].tags) {
            if (tag[0] !== 'r' || !tag[1]) continue
            if (tag[2] && tag[2] === 'read') continue
            const clean = sanitizePublicRelayUrl(tag[1])
            if (clean) userWriteRelays.push(clean)
          }
        }

        const queryRelays = [...new Set([...readRelays, ...userWriteRelays.slice(0, 6)])]
        setProfileRelays(queryRelays)

        const [evs, metaProfileEvs] = await Promise.all([
          nostrPool.query(
            queryRelays,
            { kinds: [1, 6, 20, 21, 22], authors: [hexPubkey], limit: 100 },
            5000,
          ),
          nostrPool.query(queryRelays, { kinds: [0], authors: [hexPubkey], limit: 3 }, 3000),
        ])
        if (loadGenRef.current !== gen) return

        for (const pEv of metaProfileEvs) ingestEvent(pEv)

        const repostTargetAuthors = new Set<string>()
        for (const e of evs) {
          ingestEvent(e)
          if (e.kind === 6 && e.content?.startsWith('{')) {
            try {
              const inner = JSON.parse(e.content) as Event
              if (inner?.pubkey && verifyEvent(inner)) {
                repostTargetAuthors.add(inner.pubkey)
              }
            } catch {
              // ignore invalid JSON
            }
          }
        }
        if (repostTargetAuthors.size > 0) {
          void fetchProfiles([...repostTargetAuthors])
        }
        setRawEvents((prev) => {
          if (!isRefresh) return evs
          const map = new Map<string, Event>()
          for (const e of prev) map.set(e.id, e)
          for (const e of evs) map.set(e.id, e)
          return [...map.values()].sort((a, b) => b.created_at - a.created_at)
        })

        // Background fetch reaction/zap/reply counts for top notes
        const topIds = evs.slice(0, 40).map((e) => e.id)
        if (topIds.length > 0) {
          void nostrPool
            .query(queryRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': topIds, limit: 250 }, 3500)
            .then((meta) => {
              if (loadGenRef.current !== gen) return
              for (const m of meta) ingestEvent(m)
            })
        }
      } finally {
        if (loadGenRef.current === gen) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [hexPubkey, readRelays, ingestEvent, fetchProfiles],
  )

  useEffect(() => {
    void loadProfileData(false)
    return () => {
      loadGenRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hexPubkey])

  const handleLoadOlder = async () => {
    if (loadingMore || rawEvents.length === 0 || !hexPubkey) return
    const oldest = rawEvents[rawEvents.length - 1]?.created_at
    if (!oldest) return
    const gen = loadGenRef.current
    setLoadingMore(true)
    try {
      const targetRelays = profileRelays.length > 0 ? profileRelays : readRelays
      const older = await nostrPool.query(
        targetRelays,
        { kinds: [1, 6, 20, 21, 22], authors: [hexPubkey], until: oldest - 1, limit: 60 },
        4500,
      )
      if (loadGenRef.current !== gen) return
      const existingIds = new Set(rawEvents.map((e) => e.id))
      const fresh = older.filter((e) => !existingIds.has(e.id))
      if (fresh.length === 0) {
        setNoMoreOlder(true)
        return
      }
      const repostAuthors = new Set<string>()
      for (const e of fresh) {
        ingestEvent(e)
        if (e.kind === 6 && e.content?.startsWith('{')) {
          try {
            const inner = JSON.parse(e.content) as Event
            if (inner?.pubkey && verifyEvent(inner)) repostAuthors.add(inner.pubkey)
          } catch {
            // ignore invalid JSON
          }
        }
      }
      if (repostAuthors.size > 0) void fetchProfiles([...repostAuthors])
      setRawEvents((prev) => [...prev, ...fresh].sort((a, b) => b.created_at - a.created_at))
    } finally {
      if (loadGenRef.current === gen) setLoadingMore(false)
    }
  }

  const displayItems = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()

    for (const ev of rawEvents) {
      if (isEventDeleted(ev)) continue
      let target: Event = ev
      let repostedBy: string | undefined

      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? eventsMap[targetId] : undefined
        if (!inner || isEventDeleted(inner)) continue
        target = inner
        repostedBy = ev.pubkey
      }

      const key = `${target.id}-${repostedBy || 'orig'}`
      if (seen.has(key)) continue

      if (tab === 'notes') {
        // Top-level notes, media posts, and reposts
        if (!repostedBy && target.kind === 1 && !isTopLevelNote(target)) continue
      } else if (tab === 'replies') {
        if (repostedBy || target.kind !== 1 || isTopLevelNote(target)) continue
      } else if (tab === 'media') {
        const parsed = parseNoteContent(target)
        const isVideoKind = target.kind === 20 || target.kind === 21 || target.kind === 22
        if (parsed.media.length === 0 && !isVideoKind) continue
      }

      seen.add(key)
      out.push({ event: target, repostedBy })
    }
    return out
  }, [rawEvents, tab, eventsMap, deletedByAuthor, isEventDeleted])

  if (!hexPubkey) {
    return (
      <div className="p-8 text-center text-sm text-[#8c8a82]">
        Invalid Nostr public key.
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-bold text-base truncate">{displayName}</h1>
            <p className="text-xs text-[#8c8a82]">{rawEvents.length} events loaded</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadProfileData(true)}
          disabled={loading || refreshing}
          title="Refresh profile and latest notes"
          className="px-2.5 py-1.5 rounded-lg bg-[#161820] hover:bg-[#1e212d] border border-[#282b3a] text-xs text-[#c2bfb7] hover:text-white flex items-center gap-1.5 shrink-0 transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#e8590c]' : ''}`} />
          <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {/* Banner */}
      <div className="aspect-[3/1] min-h-[144px] max-h-[240px] w-full bg-gradient-to-r from-[#24140d] via-[#1c1622] to-[#141720] relative z-[6] overflow-hidden">
        {bannerUrl && !bannerFailed && (
          <button
            type="button"
            onClick={() =>
              setLightboxMedia({
                url: bannerUrl,
                kind: 'image',
                alt: `${displayName} banner`,
              })
            }
            className="absolute inset-0 w-full h-full cursor-pointer"
            title="View full banner"
            aria-label={`View ${displayName} banner`}
          >
            <img
              src={bannerUrl}
              alt={`${displayName} banner`}
              referrerPolicy="no-referrer"
              onError={() => setBannerFailed(true)}
              className="w-full h-full object-cover object-center"
            />
          </button>
        )}
      </div>

      {/* Profile details */}
      <div className="px-4 pb-4 border-b border-[#20222c]">
        <div className="flex items-end justify-between -mt-10 mb-3 relative z-10">
          <div className="p-1 rounded-full bg-[#0e0e11]">
            <Avatar src={profile?.picture} pubkey={hexPubkey} name={displayName} size="xl" disableHoverPreview />
          </div>

          <div className="flex items-center gap-1.5 pt-12">
            {profile?.lud16 && (
              <button
                onClick={() => setZapOpen(true)}
                className="p-1.5 rounded-lg bg-[#181a22] border border-[#2a2d3a] hover:border-[#f59f00] text-[#f59f00] cursor-pointer"
                title={`Zap ${profile.lud16}`}
                aria-label={`Zap ${displayName}`}
              >
                <Zap className="w-3.5 h-3.5" />
              </button>
            )}
            {isMe ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#181a22] hover:bg-[#222533] border border-[#2d3042] hover:border-[#e8590c] text-xs font-semibold text-[#f4f1ea] flex items-center gap-1.5 transition cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-[#f59f00]" />
                <span>Edit Profile</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void toggleFollow(hexPubkey)}
                  title={isFollowing ? `Unfollow ${displayName}` : `Follow ${displayName}`}
                  aria-label={isFollowing ? `Unfollow ${displayName}` : `Follow ${displayName}`}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                    isFollowing
                      ? 'bg-[#1a1c26] hover:bg-amber-500/15 border-[#2d3042] hover:border-amber-500/45 text-[#c7c4bc] hover:text-amber-300'
                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 hover:border-emerald-400 text-emerald-300'
                  }`}
                >
                  {isFollowing ? (
                    <>
                      <UserMinus className="w-3 h-3" />
                      <span>Unf</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-3 h-3" />
                      <span>Fol</span>
                    </>
                  )}
                </button>
                <AddToListButton pubkey={hexPubkey} displayName={displayName} variant="compact" />
                <button
                  type="button"
                  onClick={() =>
                    void (isMuted
                      ? unblockPubkey(hexPubkey, displayName)
                      : blockPubkey(hexPubkey, displayName))
                  }
                  className={`p-1.5 rounded-lg border transition cursor-pointer ${
                    isMuted
                      ? 'bg-red-600/30 border-red-500/60 text-red-200 hover:bg-red-600/40'
                      : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 hover:text-red-300'
                  }`}
                  title={isMuted ? `Unblock ${displayName}` : `Block & mute ${displayName}`}
                  aria-label={isMuted ? `Unblock ${displayName}` : `Block ${displayName}`}
                >
                  <Ban className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        <h2 className="text-xl font-bold">{displayName}</h2>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {profile?.nip05 && (
            <span className="text-xs text-[#f59f00]">{profile.nip05.replace(/^_@/, '')}</span>
          )}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(npub)
                setCopiedNpub(true)
                if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
                copyTimerRef.current = setTimeout(() => {
                  copyTimerRef.current = null
                  setCopiedNpub(false)
                }, 1600)
              } catch {
                useNostrStore.getState().setToast('Clipboard permission unavailable')
              }
            }}
            className="text-xs font-mono text-[#8c8a82] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {npub.slice(0, 18)}…
            {copiedNpub ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>

        <div className="mt-2">
          <WotBadge pubkey={hexPubkey} showFollowing />
        </div>

        {profile?.about && (
          <p className="mt-2.5 text-sm text-[#d4d2cb] whitespace-pre-wrap leading-relaxed">
            {profile.about}
          </p>
        )}
        {(() => {
          const safeWebsite = sanitizePublicHttpsUrl(profile?.website)
          if (!safeWebsite) return null
          return (
            <a
              href={safeWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#38bdf8] hover:underline break-all"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>{safeWebsite.replace(/^https?:\/\//i, '')}</span>
            </a>
          )
        })()}
      </div>

      {/* Profile Tabs: Notes / Replies / Media */}
      <div className="grid grid-cols-3 border-b border-[#20222c] text-sm font-medium bg-[#0e0e11]">
        {(
          [
            ['notes', 'Notes'],
            ['replies', 'Replies'],
            ['media', 'Media'],
          ] as [ProfileTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`py-3 border-b-2 transition cursor-pointer ${
              tab === id
                ? 'border-[#e8590c] text-white'
                : 'border-transparent text-[#8c8a82] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && displayItems.length === 0 ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : displayItems.length === 0 ? (
        <div className="py-12 text-center text-sm text-[#8c8a82]">
          {tab === 'media'
            ? 'No photos or videos found on this profile.'
            : tab === 'replies'
              ? 'No replies loaded.'
              : 'No public notes found.'}
        </div>
      ) : (
        <>
          {displayItems.map(({ event, repostedBy }) => (
            <NoteCard
              key={`${event.id}-${repostedBy || 'orig'}`}
              event={event}
              repostedByPubkey={repostedBy}
            />
          ))}
          <div className="py-6 flex justify-center">
            {noMoreOlder ? (
              <span className="text-xs text-[#6f6d66]">No older notes found on these relays</span>
            ) : (
              <button
                disabled={loadingMore}
                onClick={() => void handleLoadOlder()}
                className="px-5 py-2 rounded-xl bg-[#161820] hover:bg-[#1e212c] border border-[#2a2d3a] text-xs font-medium text-[#d4d2cb] disabled:opacity-50 flex items-center gap-2 transition cursor-pointer"
              >
                {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#e8590c]" />}
                {loadingMore ? 'Loading older notes…' : 'Load older notes'}
              </button>
            )}
          </div>
        </>
      )}

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />

      {zapOpen && profile?.lud16 && (
        <Suspense fallback={null}>
          <ZapModal
            recipientPubkey={hexPubkey}
            recipientName={displayName}
            lud16={profile.lud16}
            onClose={() => setZapOpen(false)}
          />
        </Suspense>
      )}
      {editOpen && isMe && hexPubkey && (
        <Suspense fallback={null}>
          <EditProfileModal
            pubkey={hexPubkey}
            onClose={() => setEditOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
