import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, List } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'

export function BookmarksPage() {
  const bookmarks = useNostrStore((s) => s.bookmarks)
  const events = useNostrStore((s) => s.events)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () =>
      [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(
        0,
        10,
      ),
    [relays, userReadRelays],
  )
  const queriedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    const missing = bookmarks
      .filter((id) => !events[id] && !queriedIdsRef.current.has(id))
      .slice(0, 60)
    if (missing.length === 0) return
    for (const id of missing) queriedIdsRef.current.add(id)
    void nostrPool.query(readRelays, { ids: missing }, 4000).then((evs) => {
      if (!active) return
      for (const e of evs) ingestEvent(e)
      if (evs.length > 0) void fetchProfiles(evs.map((e) => e.pubkey))
    })
    return () => {
      active = false
    }
  }, [bookmarks, readRelays, events, ingestEvent, fetchProfiles])

  const visibleBookmarkEvents = useMemo(() => {
    return bookmarks
      .map((id) => events[id])
      .filter((ev): ev is NonNullable<typeof ev> => Boolean(ev && !isEventDeleted(ev)))
  }, [bookmarks, events, deletedByAuthor, isEventDeleted])

  return (
    <div>
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-[#f59f00]" />
          <h1 className="font-bold text-base">Bookmarks ({bookmarks.length})</h1>
        </div>
        <Link
          to="/lists?tab=bookmarks"
          className="px-2.5 py-1 rounded-lg bg-[#161820] hover:bg-[#1e212c] border border-[#2a2d3a] text-[11px] font-medium text-purple-300 hover:text-purple-200 flex items-center gap-1.5 transition"
        >
          <List className="w-3 h-3" />
          Bookmark Lists →
        </Link>
      </div>

      {bookmarks.length === 0 ? (
        <div className="p-12 text-center text-sm text-[#8c8a82]">
          Tap the bookmark icon on any note to save it here.
        </div>
      ) : (
        visibleBookmarkEvents.map((ev) => <NoteCard key={ev.id} event={ev} />)
      )}
    </div>
  )
}
