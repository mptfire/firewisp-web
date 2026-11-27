import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Event } from 'nostr-tools/pure'
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { extractReplyRefs } from '../lib/nostr/content'
import { evaluateNoteSpam } from '../lib/nostr/spamFilter'
import { evaluateWotStatus } from '../lib/nostr/wot'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { useWotStore } from '../lib/store/useWotStore'
import { NoteCard } from '../components/NoteCard'
import { Composer } from '../components/Composer'

export function ThreadPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const focusEvent = useNostrStore((s) => (eventId ? s.events[eventId] : undefined))
  const parentRef = useMemo(() => (focusEvent ? extractReplyRefs(focusEvent) : {}), [focusEvent])
  const rootEvent = useNostrStore((s) =>
    parentRef.rootId && parentRef.rootId !== parentRef.replyId && parentRef.rootId !== eventId
      ? s.events[parentRef.rootId]
      : undefined,
  )
  const parentEvent = useNostrStore((s) =>
    parentRef.replyId && parentRef.replyId !== eventId ? s.events[parentRef.replyId] : undefined,
  )
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const relays = useSettingsStore((s) => s.relays)
  const spamFilterEnabled = useSettingsStore((s) => s.spamFilterEnabled)
  const wotPrioritizeReplies = useSettingsStore((s) => s.wotPrioritizeReplies)
  const setWotPrioritizeReplies = useSettingsStore((s) => s.setWotPrioritizeReplies)
  const wotMinVouches = useSettingsStore((s) => s.wotMinVouches)
  const nip85Enabled = useSettingsStore((s) => s.nip85Enabled)
  const nip85MinRank = useSettingsStore((s) => s.nip85MinRank)
  const wotEntries = useWotStore((s) => s.entries)
  const nip85Scores = useWotStore((s) => s.nip85Scores)
  const myPubkey = useAuthStore((s) => s.pubkey)
  const follows = useNostrStore((s) => s.follows)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const readRelays = useMemo(
    () => [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(0, 10),
    [relays, userReadRelays],
  )

  const [replies, setReplies] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventId) return
    let active = true
    setLoading(true)
    setReplies([])

    void (async () => {
      try {
        const [mainList, replyList] = await Promise.all([
          nostrPool.query(readRelays, { ids: [eventId], limit: 1 }, 4000),
          nostrPool.query(readRelays, { kinds: [1, 1111], '#e': [eventId], limit: 80 }, 4500),
        ])
        if (!active) return
        for (const ev of mainList) ingestEvent(ev)
        for (const ev of replyList) ingestEvent(ev)

        const authors = new Set<string>()
        const allIds = new Set<string>([eventId])
        for (const ev of [...mainList, ...replyList]) {
          authors.add(ev.pubkey)
          allIds.add(ev.id)
        }

        // Fetch root + parent if this note is itself a reply
        const main = mainList[0] || useNostrStore.getState().events[eventId]
        if (main) {
          const refs = extractReplyRefs(main)
          const ancestorIds = [...new Set([refs.rootId, refs.replyId].filter(
            (x): x is string => Boolean(x && x !== eventId),
          ))]
          if (ancestorIds.length > 0) {
            const parents = await nostrPool.query(readRelays, { ids: ancestorIds }, 3000)
            if (!active) return
            for (const p of parents) {
              ingestEvent(p)
              authors.add(p.pubkey)
              allIds.add(p.id)
            }
          }
        }

        void fetchProfiles([...authors])
        setReplies(
          replyList
            .filter((r) => r.id !== eventId)
            .sort((a, b) => a.created_at - b.created_at),
        )

        // Load reactions, reposts & zaps for the thread so counters populate
        void nostrPool
          .query(
            readRelays,
            { kinds: [5, 6, 7, 9735], '#e': [...allIds].slice(0, 40), limit: 250 },
            3500,
          )
          .then((meta) => {
            if (!active) return
            for (const m of meta) ingestEvent(m)
          })
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [eventId, readRelays])

  const followSet = useMemo(() => new Set(follows.map((f) => f.toLowerCase())), [follows])

  const visibleReplies = useMemo(() => {
    const filtered = replies.filter((r) => {
      if (isEventDeleted(r) || isEventMuted(r)) return false
      if (spamFilterEnabled && evaluateNoteSpam(r, { myPubkey, follows: followSet }).isSpam) {
        return false
      }
      return true
    })
    if (!wotPrioritizeReplies || !myPubkey) return filtered
    const tierOf = (pk: string) => {
      const st = evaluateWotStatus({
        targetPubkey: pk,
        myPubkey,
        followsSet: followSet,
        entries: wotEntries,
        minVouches: wotMinVouches,
        nip85Scores: nip85Enabled ? nip85Scores : undefined,
        nip85MinRank,
      })
      if (st.hop === 0 || st.hop === 1) return 2
      if (st.trusted) return 1
      return 0
    }
    return [...filtered].sort((a, b) => tierOf(b.pubkey) - tierOf(a.pubkey) || a.created_at - b.created_at)
  }, [
    replies,
    isEventDeleted,
    isEventMuted,
    deletedByAuthor,
    mutedPubkeys,
    mutedHashtags,
    mutedWords,
    privateMutedPubkeys,
    privateMutedHashtags,
    privateMutedWords,
    spamFilterEnabled,
    wotPrioritizeReplies,
    wotEntries,
    wotMinVouches,
    nip85Enabled,
    nip85Scores,
    nip85MinRank,
    myPubkey,
    followSet,
  ])

  return (
    <div>
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-bold text-base">Thread</h1>
      </div>

      {rootEvent && (
        <div className="opacity-75 border-l-2 border-[#e8590c]/40 ml-4">
          <NoteCard event={rootEvent} />
        </div>
      )}

      {parentEvent && (
        <div className="opacity-85 border-l-2 border-[#e8590c]/60 ml-4">
          <NoteCard event={parentEvent} />
        </div>
      )}

      {focusEvent ? (
        <>
          <div className="bg-[#14151c]">
            <NoteCard event={focusEvent} hideParentPreview={Boolean(parentEvent || rootEvent)} />
          </div>
          <Composer
            replyTo={focusEvent}
            placeholder="Write a reply…"
            compact
            onPublished={(ev) => setReplies((prev) => [...prev, ev])}
          />
        </>
      ) : loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : (
        <div className="py-16 text-center text-sm text-[#8c8a82]">
          Note not found on your configured relays.
        </div>
      )}

      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#8c8a82] border-b border-[#20222c] flex items-center justify-between gap-2">
        <span>Replies ({visibleReplies.length})</span>
        {myPubkey && (
          <button
            type="button"
            aria-pressed={wotPrioritizeReplies}
            onClick={() => setWotPrioritizeReplies(!wotPrioritizeReplies)}
            title="Show Web of Trust replies before unknown accounts"
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold normal-case tracking-normal border inline-flex items-center gap-1 transition cursor-pointer ${
              wotPrioritizeReplies
                ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-300'
                : 'bg-[#0e0e11] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
            }`}
          >
            <ShieldCheck className="w-3 h-3" />
            WoT first
          </button>
        )}
      </div>

      {visibleReplies.map((r) => (
        <NoteCard key={r.id} event={r} hideParentPreview showWotBadge />
      ))}
    </div>
  )
}
