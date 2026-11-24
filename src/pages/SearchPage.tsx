import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import { Search, Loader2 } from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'

function resolveDirectJump(raw: string): string | null {
  const q = raw.trim()
  const lower = q.toLowerCase()
  if (lower.startsWith('npub1') || lower.startsWith('nprofile1')) {
    return `/p/${q}`
  }
  if (lower.startsWith('naddr1')) {
    try {
      const dec = nip19.decode(lower)
      if (dec.type === 'naddr' && dec.data.kind === 30311) {
        return `/live/${lower}`
      }
    } catch {
      // fall through
    }
  }
  if (lower.startsWith('note1') || lower.startsWith('nevent1')) {
    try {
      const dec = nip19.decode(lower)
      if (dec.type === 'note') return `/e/${dec.data}`
      if (dec.type === 'nevent') return `/e/${dec.data.id}`
    } catch {
      // fall through
    }
  }
  if (/^[0-9a-f]{64}$/i.test(lower)) {
    return `/p/${lower}`
  }
  return null
}

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () =>
      [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(
        0,
        10,
      ),
    [relays, userReadRelays],
  )

  const initialQ = params.get('q') || ''
  const [query, setQuery] = useState(initialQ)
  const [results, setResults] = useState<Event[]>([])
  const [searching, setSearching] = useState(false)
  const searchGenRef = useRef(0)

  const runSearch = useCallback(
    async (raw: string, replaceJump = false) => {
      const q = raw.trim()
      if (!q) return

      const directTarget = resolveDirectJump(q)
      if (directTarget) {
        navigate(directTarget, { replace: replaceJump })
        return
      }

      const gen = ++searchGenRef.current
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
        if (searchGenRef.current !== gen) return
        for (const e of evs) ingestEvent(e)
        void fetchProfiles(evs.map((e) => e.pubkey))
        setResults(evs)
      } finally {
        if (searchGenRef.current === gen) setSearching(false)
      }
    },
    [navigate, readRelays, ingestEvent, fetchProfiles],
  )

  useEffect(() => {
    setQuery(initialQ)
    if (initialQ) {
      void runSearch(initialQ, true)
    }
    return () => {
      searchGenRef.current++
    }
  }, [initialQ, runSearch])

  const visibleResults = useMemo(
    () => results.filter((e) => !isEventDeleted(e) && !isEventMuted(e)),
    [
      results,
      isEventDeleted,
      isEventMuted,
      deletedByAuthor,
      mutedPubkeys,
      mutedHashtags,
      mutedWords,
      privateMutedPubkeys,
      privateMutedHashtags,
      privateMutedWords,
    ],
  )

  return (
    <div>
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = query.trim()
            if (!trimmed) return
            const directTarget = resolveDirectJump(trimmed)
            if (directTarget) {
              navigate(directTarget)
              return
            }
            if (trimmed === initialQ) {
              void runSearch(trimmed, false)
            } else {
              setParams({ q: trimmed })
            }
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
      ) : visibleResults.length === 0 ? (
        <div className="p-10 text-center text-sm text-[#8c8a82]">
          Try searching a hashtag like <span className="text-[#f59f00]">#nostr</span> or{' '}
          <span className="text-[#f59f00]">#bitcoin</span>, or paste any <code>npub1</code> /{' '}
          <code>note1</code>.
        </div>
      ) : (
        visibleResults.map((ev) => <NoteCard key={ev.id} event={ev} />)
      )}
    </div>
  )
}
