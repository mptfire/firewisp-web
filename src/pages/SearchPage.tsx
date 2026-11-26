import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools/pure'
import {
  Ban,
  List,
  Loader2,
  Lock,
  Search,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { nostrPool } from '../lib/nostr/pool'
import {
  filterEventsForSearch,
  matchProfilesLocally,
  searchProfiles,
  type ProfileSearchHit,
} from '../lib/nostr/profileSearch'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { AddToListButton } from '../components/AddToListButton'
import { Avatar } from '../components/Avatar'
import { NoteCard } from '../components/NoteCard'

type SearchScope = 'all' | 'notes' | 'people'

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
  const myPubkey = useAuthStore((s) => s.pubkey)
  const follows = useNostrStore((s) => s.follows)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)
  const blockPubkey = useNostrStore((s) => s.blockPubkey)
  const unblockPubkey = useNostrStore((s) => s.unblockPubkey)
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
  const listsMap = useListsStore((s) => s.lists)
  const sortedLists = useMemo(
    () => Object.values(listsMap).sort((a, b) => a.name.localeCompare(b.name)),
    [listsMap],
  )
  const readRelays = useMemo(
    () =>
      [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(
        0,
        10,
      ),
    [relays, userReadRelays],
  )

  const initialQ = params.get('q') || ''
  const selectedListDTag = params.get('list') || ''
  const selectedList = selectedListDTag ? listsMap[selectedListDTag] : undefined
  const selectedListMembersKey = selectedList ? selectedList.members.join(',') : ''

  const [query, setQuery] = useState(initialQ)
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const [results, setResults] = useState<Event[]>([])
  const [peopleResults, setPeopleResults] = useState<ProfileSearchHit[]>([])
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({})
  const [searching, setSearching] = useState(false)
  const searchGenRef = useRef(0)

  const runSearch = useCallback(
    async (raw: string, replaceJump = false, listDTag = '') => {
      const q = raw.trim()
      if (!q) {
        setResults([])
        setPeopleResults([])
        return
      }

      const directTarget = resolveDirectJump(q)
      if (directTarget) {
        navigate(directTarget, { replace: replaceJump })
        return
      }

      const activeList = listDTag ? useListsStore.getState().lists[listDTag] : undefined
      if (listDTag && activeList && activeList.members.length === 0) {
        setResults([])
        setPeopleResults([])
        setSearching(false)
        return
      }

      const gen = ++searchGenRef.current
      setSearching(true)
      try {
        const cleanTag = q.startsWith('#') ? q.slice(1).toLowerCase() : null
        const allowedMembers = activeList
          ? [...new Set(activeList.members.map((p) => p.toLowerCase()))]
          : null
        const allowedSet = allowedMembers ? new Set(allowedMembers) : undefined

        if (allowedMembers && allowedMembers.length > 0) {
          void fetchProfiles(allowedMembers.slice(0, 100))
        }

        const queryNotes = async (): Promise<Event[]> => {
          if (allowedMembers && allowedSet) {
            const chunks: string[][] = []
            for (let i = 0; i < Math.min(allowedMembers.length, 2000); i += 250) {
              chunks.push(allowedMembers.slice(i, i + 250))
            }
            if (cleanTag) {
              const evs = (
                await Promise.all(
                  chunks.map((authors) =>
                    nostrPool.query(
                      readRelays,
                      { kinds: [1, 20], '#t': [cleanTag], authors, limit: 50 },
                      5000,
                    ),
                  ),
                )
              ).flat()
              const localEvents = Object.values(useNostrStore.getState().events)
              return filterEventsForSearch([...evs, ...localEvents], q, allowedSet)
            }
            const since30d = Math.floor(Date.now() / 1000) - 30 * 86400
            const queries: Promise<Event[]>[] = []
            for (const authors of chunks) {
              queries.push(
                nostrPool.query(
                  readRelays,
                  { kinds: [1], search: q, authors, limit: 50 },
                  4500,
                ),
              )
              queries.push(
                nostrPool.query(
                  readRelays,
                  { kinds: [1], authors, since: since30d, limit: 80 },
                  4500,
                ),
              )
            }
            const fetched = (await Promise.all(queries)).flat()
            const localEvents = Object.values(useNostrStore.getState().events)
            return filterEventsForSearch([...fetched, ...localEvents], q, allowedSet)
          }

          const filter = cleanTag
            ? { kinds: [1, 20], '#t': [cleanTag], limit: 50 }
            : { kinds: [1], search: q, limit: 40 }
          const evs = await nostrPool.query(readRelays, filter, 5000)
          return [...evs].sort((a, b) => b.created_at - a.created_at)
        }

        const queryPeople = async (): Promise<ProfileSearchHit[]> => {
          if (cleanTag) return []
          if (allowedSet) {
            const localHits = matchProfilesLocally(
              q,
              useNostrStore.getState().profiles,
              allowedSet,
            )
            const remoteHits = await searchProfiles(q, readRelays)
            const merged = new Map<string, ProfileSearchHit>()
            for (const h of localHits) merged.set(h.pubkey.toLowerCase(), h)
            for (const h of remoteHits) {
              const pk = h.pubkey.toLowerCase()
              if (allowedSet.has(pk)) merged.set(pk, h)
            }
            return [...merged.values()].slice(0, 25)
          }
          return searchProfiles(q, readRelays)
        }

        const [evs, people] = await Promise.all([queryNotes(), queryPeople()])
        if (searchGenRef.current !== gen) return
        for (const e of evs) ingestEvent(e)
        if (evs.length > 0) void fetchProfiles(evs.map((e) => e.pubkey))
        setResults(evs)
        setPeopleResults(people)
      } finally {
        if (searchGenRef.current === gen) setSearching(false)
      }
    },
    [navigate, readRelays, ingestEvent, fetchProfiles],
  )

  useEffect(() => {
    setQuery(initialQ)
  }, [initialQ])

  useEffect(() => {
    if (initialQ.trim()) {
      void runSearch(initialQ, true, selectedListDTag)
    } else {
      setResults([])
      setPeopleResults([])
    }
    return () => {
      searchGenRef.current++
    }
  }, [initialQ, selectedListDTag, selectedListMembersKey, runSearch])

  const followSet = useMemo(() => new Set(follows.map((p) => p.toLowerCase())), [follows])

  const mutedPubkeySet = useMemo(
    () =>
      new Set([
        ...mutedPubkeys.map((p) => p.toLowerCase()),
        ...privateMutedPubkeys.map((p) => p.toLowerCase()),
      ]),
    [mutedPubkeys, privateMutedPubkeys],
  )

  const selectedListAllowedSet = useMemo(
    () =>
      selectedList
        ? new Set(selectedList.members.map((p) => p.toLowerCase()))
        : null,
    [selectedList],
  )

  const visiblePeople = useMemo(
    () =>
      peopleResults.filter((hit) => {
        const pk = hit.pubkey.toLowerCase()
        if (mutedPubkeySet.has(pk)) return false
        if (selectedListAllowedSet && !selectedListAllowedSet.has(pk)) return false
        return true
      }),
    [peopleResults, mutedPubkeySet, selectedListAllowedSet],
  )

  const visibleResults = useMemo(
    () =>
      results.filter((e) => {
        if (isEventDeleted(e) || isEventMuted(e)) return false
        if (selectedListAllowedSet && !selectedListAllowedSet.has(e.pubkey.toLowerCase())) {
          return false
        }
        return true
      }),
    [
      results,
      isEventDeleted,
      isEventMuted,
      selectedListAllowedSet,
      deletedByAuthor,
      mutedPubkeys,
      mutedHashtags,
      mutedWords,
      privateMutedPubkeys,
      privateMutedHashtags,
      privateMutedWords,
    ],
  )

  const updateSearchParams = (nextQ: string, nextListDTag: string) => {
    const next = new URLSearchParams()
    if (nextQ.trim()) next.set('q', nextQ.trim())
    if (nextListDTag) next.set('list', nextListDTag)
    setParams(next)
  }

  const showPeopleSection = searchScope !== 'notes' && visiblePeople.length > 0
  const showNotesSection = searchScope !== 'people' && visibleResults.length > 0

  return (
    <div>
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] p-4 space-y-2.5">
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
              void runSearch(trimmed, false, selectedListDTag)
            } else {
              updateSearchParams(trimmed, selectedListDTag)
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
              placeholder="Search notes, #hashtags, people, npub1…, or note1…"
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Search result filter"
            className="inline-flex items-center rounded-lg bg-[#0b0c10] border border-[#242736] p-0.5 gap-0.5 text-[11px] font-medium"
          >
            {(
              [
                ['all', 'All'],
                ['notes', `Notes${visibleResults.length > 0 ? ` (${visibleResults.length})` : ''}`],
                ['people', `People${visiblePeople.length > 0 ? ` (${visiblePeople.length})` : ''}`],
              ] as Array<[SearchScope, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={searchScope === id}
                onClick={() => setSearchScope(id)}
                className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                  searchScope === id
                    ? 'bg-[#e8590c]/20 text-[#ff922b] border border-[#e8590c]/40'
                    : 'text-[#8c8a82] hover:text-white border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {myPubkey && (sortedLists.length > 0 || Boolean(selectedListDTag)) && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[#9a9890] max-w-full">
              <List className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="shrink-0">In list:</span>
              <select
                aria-label="Filter search by list"
                value={selectedListDTag}
                onChange={(e) => {
                  const nextList = e.target.value
                  updateSearchParams(query.trim() || initialQ, nextList)
                }}
                className="max-w-[180px] px-2 py-1 rounded-lg bg-[#15161c] border border-[#2a2d3a] hover:border-purple-400/50 text-xs font-medium text-[#e4e1d8] focus:outline-none focus:border-purple-400 cursor-pointer truncate"
              >
                <option value="" className="bg-[#14151e] text-white">
                  All people
                </option>
                {sortedLists.map((l) => (
                  <option key={l.dTag} value={l.dTag} className="bg-[#14151e] text-white">
                    {l.name} ({l.members.length})
                  </option>
                ))}
                {selectedListDTag && !selectedList && (
                  <option value={selectedListDTag} className="bg-[#14151e] text-white">
                    Saved list
                  </option>
                )}
              </select>
            </label>
          )}
        </div>

        <p className="text-[11px] text-[#7c7a72]">
          Search notes, #hashtags, or people (name, user@domain, npub1…) on your configured relays.
        </p>
      </div>

      {searching ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : selectedList && selectedList.members.length === 0 ? (
        <div className="p-10 text-center space-y-3">
          <p className="text-sm text-[#c2bfb7] font-medium flex items-center justify-center gap-1.5">
            {selectedList.isPrivate && <Lock className="w-3.5 h-3.5 text-emerald-400" />}
            No people in &ldquo;{selectedList.name}&rdquo; yet.
          </p>
          <Link
            to={`/lists/${encodeURIComponent(selectedList.dTag)}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white transition"
          >
            <List className="w-3.5 h-3.5" />
            Add people
          </Link>
        </div>
      ) : !showPeopleSection && !showNotesSection ? (
        <div className="p-10 text-center text-sm text-[#8c8a82]">
          {initialQ.trim() ? (
            <>
              No {searchScope === 'people' ? 'people' : searchScope === 'notes' ? 'notes' : 'results'}{' '}
              found for <span className="text-white font-medium">&ldquo;{initialQ.trim()}&rdquo;</span>
              {selectedList ? (
                <>
                  {' '}
                  in <span className="text-purple-300">{selectedList.name}</span>
                </>
              ) : null}
              .
            </>
          ) : selectedList ? (
            <>
              Searching inside <span className="text-purple-300 font-medium">{selectedList.name}</span>{' '}
              ({selectedList.members.length} {selectedList.members.length === 1 ? 'person' : 'people'}).
              Enter a keyword or <span className="text-[#f59f00]">#hashtag</span> above.
            </>
          ) : (
            <>
              Try searching a person name, <span className="text-[#f59f00]">#nostr</span> or{' '}
              <span className="text-[#f59f00]">#bitcoin</span>, or paste any <code>npub1</code> /{' '}
              <code>note1</code>.
            </>
          )}
        </div>
      ) : (
        <div>
          {showPeopleSection && (
            <div className="border-b border-[#20222c]">
              <div className="px-4 py-2 bg-[#121319] border-b border-[#20222c] flex items-center gap-1.5 text-xs font-semibold text-[#c2bfb7]">
                <Users className="w-3.5 h-3.5 text-[#f59f00]" />
                <span>People ({visiblePeople.length})</span>
              </div>
              <div className="divide-y divide-[#20222c]">
                {visiblePeople.map((hit) => {
                  const pk = hit.pubkey.toLowerCase()
                  const isMe = Boolean(myPubkey && myPubkey.toLowerCase() === pk)
                  const isFollowing = followSet.has(pk)
                  const isMuted = mutedPubkeySet.has(pk)
                  const busy = Boolean(followBusy[pk])
                  let shortNpub = `${pk.slice(0, 12)}…`
                  try {
                    const encoded = nip19.npubEncode(pk)
                    shortNpub = `${encoded.slice(0, 14)}…`
                  } catch {
                    // keep hex fallback
                  }
                  const name = hit.display_name || hit.name || shortNpub
                  return (
                    <div
                      key={pk}
                      className="px-4 py-3 flex items-center justify-between gap-2 hover:bg-white/[0.02] transition"
                    >
                      <Link to={`/p/${pk}`} className="flex items-center gap-3 min-w-0 flex-1">
                        <Avatar src={hit.picture} pubkey={pk} name={name} size="md" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate hover:underline">
                            {name}
                          </div>
                          <div className="text-xs text-[#8c8a82] truncate">
                            {hit.nip05 ? hit.nip05.replace(/^_@/, '') : shortNpub}
                          </div>
                        </div>
                      </Link>
                      {!isMe && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setFollowBusy((b) => ({ ...b, [pk]: true }))
                              try {
                                await toggleFollow(pk)
                              } finally {
                                setFollowBusy((b) => ({ ...b, [pk]: false }))
                              }
                            }}
                            title={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
                            aria-label={isFollowing ? `Unfollow ${name}` : `Follow ${name}`}
                            className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                              isFollowing
                                ? 'bg-[#1a1c26] hover:bg-amber-500/15 border-[#2d3042] hover:border-amber-500/45 text-[#c7c4bc] hover:text-amber-300'
                                : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 hover:border-emerald-400 text-emerald-300'
                            }`}
                          >
                            {isFollowing ? (
                              <>
                                <UserMinus className="w-3 h-3" />
                                <span>{busy ? '…' : 'Unf'}</span>
                              </>
                            ) : (
                              <>
                                <UserPlus className="w-3 h-3" />
                                <span>{busy ? '…' : 'Fol'}</span>
                              </>
                            )}
                          </button>
                          <AddToListButton pubkey={pk} displayName={name} variant="compact" />
                          <button
                            type="button"
                            onClick={() =>
                              void (isMuted ? unblockPubkey(pk, name) : blockPubkey(pk, name))
                            }
                            title={isMuted ? `Unblock ${name}` : `Block & mute ${name}`}
                            aria-label={isMuted ? `Unblock ${name}` : `Block ${name}`}
                            className={`p-1.5 rounded-lg border transition cursor-pointer ${
                              isMuted
                                ? 'bg-red-600/30 border-red-500/60 text-red-200 hover:bg-red-600/40'
                                : 'bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/25 hover:border-red-500/50 hover:text-red-300'
                            }`}
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {showNotesSection && (
            <div>
              {searchScope === 'all' && showPeopleSection && (
                <div className="px-4 py-2 bg-[#121319] border-b border-[#20222c] text-xs font-semibold text-[#c2bfb7]">
                  Notes ({visibleResults.length})
                </div>
              )}
              {visibleResults.map((ev) => (
                <NoteCard key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
