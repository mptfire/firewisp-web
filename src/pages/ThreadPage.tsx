import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Event } from 'nostr-tools/pure'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { extractReplyRefs } from '../lib/nostr/content'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'
import { Composer } from '../components/Composer'

export function ThreadPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const events = useNostrStore((s) => s.events)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () => relays.filter((r) => r.read).map((r) => r.url),
    [relays],
  )

  const [replies, setReplies] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  const focusEvent = eventId ? events[eventId] : undefined
  const parentRef = focusEvent ? extractReplyRefs(focusEvent) : {}
  const parentEvent = parentRef.replyId ? events[parentRef.replyId] : undefined

  useEffect(() => {
    if (!eventId) return
    let active = true
    setLoading(true)

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
        for (const ev of [...mainList, ...replyList]) authors.add(ev.pubkey)

        // Fetch parent if this note is itself a reply
        const main = mainList[0] || events[eventId]
        if (main) {
          const refs = extractReplyRefs(main)
          const ancestorIds = [refs.rootId, refs.replyId].filter(
            (x): x is string => Boolean(x && x !== eventId),
          )
          if (ancestorIds.length > 0) {
            const parents = await nostrPool.query(readRelays, { ids: ancestorIds }, 3000)
            for (const p of parents) {
              ingestEvent(p)
              authors.add(p.pubkey)
            }
          }
        }

        void fetchProfiles([...authors])
        setReplies(
          replyList
            .filter((r) => r.id !== eventId && !isEventMuted(r))
            .sort((a, b) => a.created_at - b.created_at),
        )
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [eventId])

  return (
    <div>
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-bold text-base">Thread</h1>
      </div>

      {parentEvent && (
        <div className="opacity-80 border-l-2 border-[#e8590c]/50 ml-4">
          <NoteCard event={parentEvent} />
        </div>
      )}

      {focusEvent ? (
        <>
          <div className="bg-[#14151c]">
            <NoteCard event={focusEvent} />
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

      <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#8c8a82] border-b border-[#20222c]">
        Replies ({replies.length})
      </div>

      {replies.map((r) => (
        <NoteCard key={r.id} event={r} />
      ))}
    </div>
  )
}
