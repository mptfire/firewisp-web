import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import {
  ArrowLeft,
  Zap,
  Mail,
  Ban,
  UserPlus,
  UserCheck,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { parseNoteContent } from '../lib/nostr/content'
import { isTopLevelNote } from '../lib/nostr/spamFilter'
import { sanitizeHttpUrl, sanitizeRelayUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'
import { NoteCard } from '../components/NoteCard'
import { ZapModal } from '../components/ZapModal'

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
  const follows = useNostrStore((s) => s.follows)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutePubkey = useSettingsStore((s) => s.mutePubkey)
  const unmutePubkey = useSettingsStore((s) => s.unmutePubkey)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () => relays.filter((r) => r.read).map((r) => r.url),
    [relays],
  )

  const [rawEvents, setRawEvents] = useState<Event[]>([])
  const [profileRelays, setProfileRelays] = useState<string[]>([])
  const [tab, setTab] = useState<ProfileTab>('notes')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [noMoreOlder, setNoMoreOlder] = useState(false)
  const [zapOpen, setZapOpen] = useState(false)
  const [copiedNpub, setCopiedNpub] = useState(false)

  const npub = useMemo(() => {
    if (!hexPubkey) return ''
    try {
      return nip19.npubEncode(hexPubkey)
    } catch {
      return hexPubkey
    }
  }, [hexPubkey])

  const isMe = Boolean(myPubkey && hexPubkey && myPubkey.toLowerCase() === hexPubkey)
  const isFollowing = Boolean(hexPubkey && follows.includes(hexPubkey))
  const isMuted = Boolean(hexPubkey && mutedPubkeys.includes(hexPubkey))
  const bannerUrl = sanitizeHttpUrl(profile?.banner)
  const displayName = profile?.display_name || profile?.name || `${npub.slice(0, 14)}…`

  useEffect(() => {
    if (!hexPubkey) return
    let active = true
    setLoading(true)
    setNoMoreOlder(false)
    setTab('notes')
    setRawEvents([])
    void fetchProfiles([hexPubkey])

    void (async () => {
      try {
        // Discover the user's NIP-65 write relays so notes & media hosted on personal relays always load
        const relayListEvents = await nostrPool.query(
          readRelays,
          { kinds: [10002], authors: [hexPubkey], limit: 2 },
          2500,
        )
        const userWriteRelays: string[] = []
        if (relayListEvents.length > 0) {
          for (const tag of relayListEvents[0].tags) {
            if (tag[0] !== 'r' || !tag[1]) continue
            if (tag[2] && tag[2] === 'read') continue
            const clean = sanitizeRelayUrl(tag[1])
            if (clean) userWriteRelays.push(clean)
          }
        }

        const queryRelays = [...new Set([...readRelays, ...userWriteRelays.slice(0, 6)])]
        if (active) setProfileRelays(queryRelays)
        const evs = await nostrPool.query(
          queryRelays,
          { kinds: [1, 6, 20, 21, 22], authors: [hexPubkey], limit: 100 },
          5000,
        )
        if (!active) return

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
        setRawEvents(evs)

        // Background fetch reaction/zap/reply counts for top notes
        const topIds = evs.slice(0, 40).map((e) => e.id)
        if (topIds.length > 0) {
          void nostrPool
            .query(queryRelays, { kinds: [1, 5, 6, 7, 1111, 9735], '#e': topIds, limit: 250 }, 3500)
            .then((meta) => {
              if (!active) return
              for (const m of meta) ingestEvent(m)
            })
        }
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [hexPubkey])

  const handleLoadOlder = async () => {
    if (loadingMore || rawEvents.length === 0 || !hexPubkey) return
    const oldest = rawEvents[rawEvents.length - 1]?.created_at
    if (!oldest) return
    setLoadingMore(true)
    try {
      const targetRelays = profileRelays.length > 0 ? profileRelays : readRelays
      const older = await nostrPool.query(
        targetRelays,
        { kinds: [1, 6, 20, 21, 22], authors: [hexPubkey], until: oldest - 1, limit: 60 },
        4500,
      )
      const existingIds = new Set(rawEvents.map((e) => e.id))
      const fresh = older.filter((e) => !existingIds.has(e.id))
      if (fresh.length === 0) {
        setNoMoreOlder(true)
        return
      }
      for (const e of fresh) ingestEvent(e)
      setRawEvents((prev) => [...prev, ...fresh].sort((a, b) => b.created_at - a.created_at))
    } finally {
      setLoadingMore(false)
    }
  }

  const displayItems = useMemo(() => {
    const out: Array<{ event: Event; repostedBy?: string }> = []
    const seen = new Set<string>()
    const eventsSnapshot = useNostrStore.getState().events

    for (const ev of rawEvents) {
      let target: Event = ev
      let repostedBy: string | undefined

      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? eventsSnapshot[targetId] : undefined
        if (!inner) continue
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
  }, [rawEvents, tab])

  if (!hexPubkey) {
    return (
      <div className="p-8 text-center text-sm text-[#8c8a82]">
        Invalid Nostr public key.
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="font-bold text-base truncate">{displayName}</h1>
          <p className="text-xs text-[#8c8a82]">{rawEvents.length} events loaded</p>
        </div>
      </div>

      {/* Banner */}
      <div className="h-36 bg-gradient-to-r from-[#24140d] via-[#1c1622] to-[#141720] relative overflow-hidden">
        {bannerUrl && (
          <img
            src={bannerUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Profile details */}
      <div className="px-4 pb-4 border-b border-[#20222c]">
        <div className="flex items-end justify-between -mt-10 mb-3 relative z-10">
          <div className="p-1 rounded-full bg-[#0e0e11]">
            <Avatar src={profile?.picture} pubkey={hexPubkey} name={displayName} size="xl" />
          </div>

          <div className="flex items-center gap-2 pt-12">
            {profile?.lud16 && (
              <button
                onClick={() => setZapOpen(true)}
                className="p-2 rounded-xl bg-[#181a22] border border-[#2a2d3a] hover:border-[#f59f00] text-[#f59f00] cursor-pointer"
                title={`Zap ${profile.lud16}`}
              >
                <Zap className="w-4 h-4" />
              </button>
            )}
            {!isMe && (
              <>
                <Link
                  to={`/messages?peer=${hexPubkey}`}
                  className="p-2 rounded-xl bg-[#181a22] border border-[#2a2d3a] hover:border-[#e8590c] text-[#d4d2cb]"
                  title="Send encrypted NIP-17 DM"
                >
                  <Mail className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => (isMuted ? unmutePubkey(hexPubkey) : mutePubkey(hexPubkey))}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                    isMuted
                      ? 'bg-red-600/25 border-red-500/60 text-red-200 hover:bg-red-600/35'
                      : 'bg-red-500/10 border-red-500/35 text-red-400 hover:bg-red-500/20 hover:text-red-300'
                  }`}
                  title={isMuted ? 'Unblock / Unmute user' : 'Block / Mute user'}
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>{isMuted ? 'Blocked' : 'Block / Mute'}</span>
                </button>
                <button
                  onClick={() => void toggleFollow(hexPubkey)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    isFollowing
                      ? 'bg-[#1d1f29] border border-[#2e3242] text-white hover:border-red-500/40'
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
              await navigator.clipboard.writeText(npub)
              setCopiedNpub(true)
              setTimeout(() => setCopiedNpub(false), 1600)
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

        {profile?.about && (
          <p className="mt-2.5 text-sm text-[#d4d2cb] whitespace-pre-wrap leading-relaxed">
            {profile.about}
          </p>
        )}
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

      {zapOpen && profile?.lud16 && (
        <ZapModal
          recipientPubkey={hexPubkey}
          recipientName={displayName}
          lud16={profile.lud16}
          onClose={() => setZapOpen(false)}
        />
      )}
    </div>
  )
}
