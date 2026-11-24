import { useEffect } from 'react'
import { Bookmark } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'

export function BookmarksPage() {
  const bookmarks = useNostrStore((s) => s.bookmarks)
  const events = useNostrStore((s) => s.events)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const readRelays = useSettingsStore((s) => s.getReadRelays())

  useEffect(() => {
    const missing = bookmarks.filter((id) => !events[id])
    if (missing.length === 0) return
    void nostrPool.query(readRelays, { ids: missing.slice(0, 60) }, 4000).then((evs) => {
      for (const e of evs) ingestEvent(e)
      void fetchProfiles(evs.map((e) => e.pubkey))
    })
  }, [bookmarks])

  return (
    <div>
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3.5 flex items-center gap-2">
        <Bookmark className="w-4 h-4 text-[#f59f00]" />
        <h1 className="font-bold text-base">Bookmarks ({bookmarks.length})</h1>
      </div>

      {bookmarks.length === 0 ? (
        <div className="p-12 text-center text-sm text-[#8c8a82]">
          Tap the bookmark icon on any note to save it here.
        </div>
      ) : (
        bookmarks.map((id) => {
          const ev = events[id]
          return ev ? <NoteCard key={id} event={ev} /> : null
        })
      )}
    </div>
  )
}
