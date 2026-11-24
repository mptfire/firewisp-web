import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import {
  ArrowLeft,
  Zap,
  Mail,
  VolumeX,
  UserPlus,
  UserCheck,
  Copy,
  Check,
  Loader2,
} from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { sanitizeHttpUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'
import { NoteCard } from '../components/NoteCard'
import { ZapModal } from '../components/ZapModal'

export function ProfilePage() {
  const { pubkey: rawId } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const myPubkey = useAuthStore((s) => s.pubkey)
  const profiles = useNostrStore((s) => s.profiles)
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

  const [notes, setNotes] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [zapOpen, setZapOpen] = useState(false)
  const [copiedNpub, setCopiedNpub] = useState(false)

  const profile = hexPubkey ? profiles[hexPubkey] : undefined
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
    void fetchProfiles([hexPubkey])

    void nostrPool
      .query(readRelays, { kinds: [1, 20], authors: [hexPubkey], limit: 50 }, 4500)
      .then((evs) => {
        if (!active) return
        for (const e of evs) ingestEvent(e)
        setNotes(evs)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [hexPubkey])

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
          <p className="text-xs text-[#8c8a82]">{notes.length} notes loaded</p>
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
                  className={`p-2 rounded-xl border cursor-pointer ${
                    isMuted
                      ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : 'bg-[#181a22] border-[#2a2d3a] text-[#9a9890] hover:text-red-300'
                  }`}
                  title={isMuted ? 'Unmute user' : 'Mute user'}
                >
                  <VolumeX className="w-4 h-4" />
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

      {loading && notes.length === 0 ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : notes.length === 0 ? (
        <div className="py-12 text-center text-sm text-[#8c8a82]">No public notes found.</div>
      ) : (
        notes.map((ev) => <NoteCard key={ev.id} event={ev} />)
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
