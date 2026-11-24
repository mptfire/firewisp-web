import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import { Search, Loader2 } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () => relays.filter((r) => r.read).map((r) => r.url),
    [relays],
  )

  const initialQ = params.get('q') || ''
  const [query, setQuery] = useState(initialQ)
  const [results, setResults] = useState<Event[]>([])
  const [searching, setSearching] = useState(false)

  const runSearch = async (raw: string) => {
    const q = raw.trim()
    if (!q) return

    // Direct jump for npub / note / nevent / 64-hex pubkey
    const lower = q.toLowerCase()
    if (lower.startsWith('npub1') || lower.startsWith('nprofile1')) {
      navigate(`/p/${q}`)
      return
    }
    if (lower.startsWith('naddr1')) {
      try {
        const dec = nip19.decode(lower)
        if (dec.type === 'naddr' && dec.data.kind === 30311) {
          navigate(`/live/${lower}`)
          return
        }
      } catch {
        // fall through
      }
    }
    if (lower.startsWith('note1') || lower.startsWith('nevent1')) {
      try {
        const dec = nip19.decode(lower)
        if (dec.type === 'note') {
          navigate(`/e/${dec.data}`)
          return
        }
        if (dec.type === 'nevent') {
          navigate(`/e/${dec.data.id}`)
          return
        }
      } catch {
        // fall through to text search
      }
    }
    if (/^[0-9a-f]{64}$/i.test(lower)) {
      navigate(`/p/${lower}`)
      return
    }

    setSearching(true)
    try {
      const cleanTag = q.startsWith('#') ? q.slice(1).toLowerCase() : null
      const filter = cleanTag
        ? { kinds: [1, 20], '#t': [cleanTag], limit: 50 }
        : { kinds: [1], search: q, limit: 40 }

      const searchRelays = cleanTag
        ? readRelays
        : [...new Set([...readRelays, 'wss://relay.nostr.band'])]

      const evs = await nostrPool.query(searchRelays, filter, 5000)
      const filtered = evs.filter((e) => !isEventMuted(e))
      for (const e of filtered) ingestEvent(e)
      void fetchProfiles(filtered.map((e) => e.pubkey))
      setResults(filtered)
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (initialQ) {
      setQuery(initialQ)
      void runSearch(initialQ)
    }
  }, [initialQ])

  return (
    <div>
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setParams(query.trim() ? { q: query.trim() } : {})
            void runSearch(query)
          }}
          className="flex gap-2"
        >
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-[#8c8a82] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search #hashtag, text, npub1…, or note1…"
              className="w-full pl-10 pr-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-sm focus:outline-none focus:border-[#e8590c]"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold cursor-pointer"
          >
            Go
          </button>
        </form>
        <p className="mt-2 text-[11px] text-[#7c7a72]">
          #hashtags, npub1, and note1 stay on your configured relays. Free-text NIP-50 search also
          queries <span className="font-mono">relay.nostr.band</span>.
        </p>
      </div>

      {searching ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : results.length === 0 ? (
        <div className="p-10 text-center text-sm text-[#8c8a82]">
          Try searching a hashtag like <span className="text-[#f59f00]">#nostr</span> or{' '}
          <span className="text-[#f59f00]">#bitcoin</span>, or paste any <code>npub1</code> /{' '}
          <code>note1</code>.
        </div>
      ) : (
        results.map((ev) => <NoteCard key={ev.id} event={ev} />)
      )}
    </div>
  )
}
