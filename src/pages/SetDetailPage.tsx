import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import {
  ArrowLeft,
  Bookmark,
  Download,
  Hash,
  Loader2,
  Lock,
  Pencil,
  Pin,
  Plus,
  Rss,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import {
  capActiveRelaySetUrls,
  KIND_BOOKMARK_SET,
  KIND_INTEREST_SET,
  KIND_RELAY_SET,
  makeInterestFeedKey,
  makeRelaySetFeedKey,
  MAX_RELAY_SET_ACTIVE_RELAYS,
  type Nip51SetType,
} from '../lib/nostr/nip51Sets'
import { nostrPool } from '../lib/nostr/pool'
import { sanitizePublicRelayUrl, isValidHex64 } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { NoteCard } from '../components/NoteCard'

function parseSetTypeParam(raw?: string): Nip51SetType | null {
  if (raw === 'bookmarks' || raw === 'interests' || raw === 'relays') return raw
  return null
}

function decodeNoteIdInput(raw: string): string | null {
  const clean = raw.trim()
  if (!clean) return null
  if (isValidHex64(clean)) return clean.toLowerCase()
  const lower = clean.toLowerCase()
  if (lower.startsWith('note1') || lower.startsWith('nevent1')) {
    try {
      const dec = nip19.decode(clean)
      if (dec.type === 'note' && isValidHex64(dec.data)) return dec.data.toLowerCase()
      if (dec.type === 'nevent' && isValidHex64(dec.data.id)) return dec.data.id.toLowerCase()
    } catch {
      return null
    }
  }
  return null
}

export function SetDetailPage() {
  const { setType: rawType, dTag: rawDTag = '' } = useParams<{
    setType: string
    dTag: string
  }>()
  const setType = parseSetTypeParam(rawType)
  const dTag = useMemo(() => {
    try {
      return decodeURIComponent(rawDTag)
    } catch {
      return rawDTag
    }
  }, [rawDTag])

  const navigate = useNavigate()
  const pubkey = useAuthStore((s) => s.pubkey)
  const bookmarkSets = useListsStore((s) => s.bookmarkSets)
  const interestSets = useListsStore((s) => s.interestSets)
  const relaySets = useListsStore((s) => s.relaySets)
  const renameItemSet = useListsStore((s) => s.renameItemSet)
  const deleteItemSet = useListsStore((s) => s.deleteItemSet)
  const addItemToSet = useListsStore((s) => s.addItemToSet)
  const removeItemFromSet = useListsStore((s) => s.removeItemFromSet)

  const events = useNostrStore((s) => s.events)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const ingestEvent = useNostrStore((s) => s.ingestEvent)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const setActiveFeedTab = useNostrStore((s) => s.setActiveFeedTab)
  const relayStatuses = useNostrStore((s) => s.relayStatuses)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const relays = useSettingsStore((s) => s.relays)
  const pinnedListTabs = useSettingsStore((s) => s.pinnedListTabs)
  const togglePinnedListTab = useSettingsStore((s) => s.togglePinnedListTab)
  const importRelays = useSettingsStore((s) => s.importRelays)

  const setObj =
    setType === 'bookmarks'
      ? bookmarkSets[dTag]
      : setType === 'interests'
        ? interestSets[dTag]
        : setType === 'relays'
          ? relaySets[dTag]
          : undefined

  const readRelays = useMemo(
    () =>
      [...new Set([...relays.filter((r) => r.read).map((r) => r.url), ...userReadRelays])].slice(
        0,
        10,
      ),
    [relays, userReadRelays],
  )

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [itemInput, setItemInput] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const queriedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (setObj) setTitleInput(setObj.name)
  }, [setObj?.name])

  // Fetch missing saved notes when viewing a Bookmark Set
  useEffect(() => {
    if (setType !== 'bookmarks' || !setObj || setObj.items.length === 0) return
    let active = true
    const currentEvents = useNostrStore.getState().events
    const missing = setObj.items
      .filter((id) => !currentEvents[id] && !queriedIdsRef.current.has(id))
      .slice(0, 60)
    if (missing.length === 0) return
    for (const id of missing) queriedIdsRef.current.add(id)
    void nostrPool
      .query(readRelays, { ids: missing }, 4000)
      .then((evs) => {
        if (!active) {
          for (const id of missing) queriedIdsRef.current.delete(id)
          return
        }
        for (const ev of evs) ingestEvent(ev)
        if (evs.length > 0) void fetchProfiles(evs.map((e) => e.pubkey))
      })
      .catch(() => {
        if (!active) {
          for (const id of missing) queriedIdsRef.current.delete(id)
        }
      })
    return () => {
      active = false
    }
  }, [setType, setObj, readRelays, ingestEvent, fetchProfiles])

  const visibleBookmarkEvents = useMemo(() => {
    if (setType !== 'bookmarks' || !setObj) return []
    return setObj.items
      .map((id) => events[id])
      .filter((ev): ev is NonNullable<typeof ev> => Boolean(ev && !isEventDeleted(ev)))
  }, [setType, setObj, events, deletedByAuthor, isEventDeleted])

  if (!setType) {
    return (
      <div className="p-8 text-center text-sm text-[#8c8a82]">
        Unknown list type.{' '}
        <Link to="/lists" className="text-purple-400 hover:underline">
          Back to Lists
        </Link>
      </div>
    )
  }

  if (!pubkey) {
    return (
      <div className="p-8 text-center text-sm text-[#9a9890]">
        Sign in to view and manage your lists.
      </div>
    )
  }

  const backHref = `/lists?tab=${setType}`

  if (!setObj) {
    return (
      <div className="p-6 space-y-4">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 text-xs text-[#9a9890] hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Lists
        </Link>
        <div className="p-8 rounded-2xl bg-[#15161c] border border-[#232530] text-center text-sm text-[#8c8a82]">
          List not found or still syncing from relays.
        </div>
      </div>
    )
  }

  const feedKey =
    setObj.kind === KIND_INTEREST_SET
      ? makeInterestFeedKey(setObj.dTag)
      : setObj.kind === KIND_RELAY_SET
        ? makeRelaySetFeedKey(setObj.dTag)
        : null
  const isPinned = feedKey ? pinnedListTabs.includes(feedKey) : false

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!titleInput.trim() || savingTitle) return
    setSavingTitle(true)
    try {
      const ok = await renameItemSet(setObj.kind, setObj.dTag, titleInput)
      if (ok) setEditingTitle(false)
    } finally {
      setSavingTitle(false)
    }
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    const raw = itemInput.trim()
    if (!raw || addingItem) return

    let normalizedRaw = raw
    if (setObj.kind === KIND_BOOKMARK_SET) {
      const decoded = decodeNoteIdInput(raw)
      if (!decoded) {
        useNostrStore.getState().setToast('Enter a valid note1…, nevent1…, or 64-hex event ID')
        return
      }
      normalizedRaw = decoded
    } else if (setObj.kind === KIND_RELAY_SET) {
      const safe = sanitizePublicRelayUrl(raw)
      if (!safe) {
        useNostrStore.getState().setToast('Enter a valid public wss:// relay URL')
        return
      }
      normalizedRaw = safe
    }

    setAddingItem(true)
    try {
      const ok = await addItemToSet(setObj.kind, setObj.dTag, normalizedRaw)
      if (ok) {
        setItemInput('')
      } else if (setObj.kind === KIND_INTEREST_SET) {
        useNostrStore.getState().setToast('Enter a valid #hashtag (letters, numbers, _, -)')
      }
    } finally {
      setAddingItem(false)
    }
  }

  const handleDelete = async () => {
    const ok = await deleteItemSet(setObj.kind, setObj.dTag)
    if (ok) navigate(backHref, { replace: true })
  }

  const HeaderIcon =
    setObj.kind === KIND_BOOKMARK_SET
      ? Bookmark
      : setObj.kind === KIND_INTEREST_SET
        ? Hash
        : Server

  const activeRelayUrls =
    setObj.kind === KIND_RELAY_SET ? capActiveRelaySetUrls(setObj.items) : []

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to={backHref}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7]"
            aria-label="Back to Lists"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          {editingTitle ? (
            <form onSubmit={handleRename} className="flex items-center gap-1.5 min-w-0">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                maxLength={60}
                autoFocus
                className="px-2.5 py-1 rounded-lg bg-[#15161c] border border-purple-400 text-sm font-semibold focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingTitle}
                className="px-2 py-1 rounded-lg bg-purple-600 text-white text-xs font-semibold cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingTitle(false)
                  setTitleInput(setObj.name)
                }}
                className="px-2 py-1 rounded-lg bg-[#20222c] text-xs text-[#c2bfb7] cursor-pointer"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <HeaderIcon className="w-4 h-4 text-purple-400 shrink-0" />
              <h1 className="font-bold text-base truncate">{setObj.name}</h1>
              {setObj.isPrivate && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300 flex items-center gap-1 shrink-0">
                  <Lock className="w-2.5 h-2.5" />
                  Private
                </span>
              )}
              {!setObj.isLocked && (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Rename list"
                  className="p-1 rounded-md text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {confirmDel ? (
            <>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="px-2 py-1 rounded-lg bg-[#20222c] text-xs text-[#c2bfb7] cursor-pointer"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {feedKey && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFeedTab(feedKey)
                      navigate('/')
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    title="Open this set as a Feed"
                    className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-xs font-semibold text-purple-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Rss className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Use as feed</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePinnedListTab(feedKey)}
                    title={isPinned ? 'Unpin from Feed tabs' : 'Pin to Feed tabs'}
                    className={`px-2 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                      isPinned
                        ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                        : 'bg-[#15161c] border-[#2a2d3a] text-[#9a9890] hover:text-white'
                    }`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{isPinned ? 'Pinned' : 'Pin'}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                className="p-1.5 rounded-lg text-[#8c8a82] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                title="Delete list"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add item form */}
      <div className="p-4 space-y-3">
        <form onSubmit={handleAddItem} className="flex gap-2">
          <input
            type="text"
            value={itemInput}
            onChange={(e) => setItemInput(e.target.value)}
            placeholder={
              setObj.kind === KIND_BOOKMARK_SET
                ? 'Paste note1…, nevent1…, or 64-hex event ID…'
                : setObj.kind === KIND_INTEREST_SET
                  ? 'Add hashtag (e.g. #nostr, bitcoin)…'
                  : 'Add public relay URL (e.g. wss://nos.lol)…'
            }
            className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs focus:outline-none focus:border-purple-400"
          />
          <button
            type="submit"
            disabled={!itemInput.trim() || addingItem}
            className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            {addingItem ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </form>

        {setObj.kind === KIND_RELAY_SET && setObj.items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#9a9890]">
            <span>
              Feed queries cap at {MAX_RELAY_SET_ACTIVE_RELAYS} public <code className="text-cyan-300">wss://</code> relays ({activeRelayUrls.length} active).
            </span>
            <button
              type="button"
              onClick={() => {
                const count = importRelays(
                  activeRelayUrls.map((url) => ({ url, read: true, write: true })),
                )
                useNostrStore
                  .getState()
                  .setToast(
                    count > 0
                      ? `Loaded ${count} new relay${count === 1 ? '' : 's'} into Relays settings`
                      : 'All valid relays from this set are already in Relays settings',
                  )
              }}
              className="px-2.5 py-1 rounded-lg bg-[#181a24] hover:bg-[#222536] border border-[#2d3042] text-xs font-semibold text-[#ff922b] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Load into Relays settings
            </button>
          </div>
        )}
      </div>

      {/* Items body */}
      {setObj.kind === KIND_BOOKMARK_SET ? (
        <div>
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#8c8a82] border-b border-[#20222c]">
            Saved Notes ({setObj.items.length})
          </div>
          {setObj.items.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#8c8a82]">
              No notes saved in this bookmark list yet. Open the <strong>•••</strong> menu on any
              note and choose <strong>Save to bookmark list…</strong>.
            </div>
          ) : (
            setObj.items.map((noteId) => {
              const ev = events[noteId]
              if (ev && isEventDeleted(ev)) return null
              const queried = queriedIdsRef.current.has(noteId)
              return (
                <div key={noteId} className="relative border-b border-[#20222c]">
                  {ev ? (
                    <NoteCard event={ev} />
                  ) : (
                    <div className="px-4 py-4 text-xs text-[#8c8a82] font-mono truncate pr-24">
                      {queried
                        ? `Note unavailable on connected relays (${noteId.slice(0, 16)}…)`
                        : `Loading note ${noteId.slice(0, 16)}…`}
                    </div>
                  )}
                  <div className="px-4 pb-2.5 flex justify-end bg-[#0e0e11]">
                    <button
                      type="button"
                      onClick={() => void removeItemFromSet(setObj.kind, setObj.dTag, noteId, 'note')}
                      className="px-2.5 py-1 rounded-lg bg-[#1a1c26] hover:bg-red-500/20 border border-[#2d3042] hover:border-red-500/45 text-[11px] text-[#c7c4bc] hover:text-red-300 flex items-center gap-1 transition cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      Remove from list
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : setObj.kind === KIND_INTEREST_SET ? (
        <div className="p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#8c8a82]">
            Hashtags ({setObj.items.length})
          </div>
          {setObj.items.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#15161c] border border-[#232530] text-center text-xs text-[#8c8a82]">
              No hashtags in this interest set yet. Add one above!
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {setObj.items.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs font-medium text-[#f59f00]"
                >
                  <Link to={`/search?q=${encodeURIComponent('#' + tag)}`} className="hover:underline">
                    #{tag}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void removeItemFromSet(setObj.kind, setObj.dTag, tag, `#${tag}`)}
                    title={`Remove #${tag}`}
                    aria-label={`Remove #${tag}`}
                    className="p-0.5 rounded text-[#8c8a82] hover:text-red-300 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#8c8a82]">
            Relays ({setObj.items.length})
          </div>
          {setObj.items.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#15161c] border border-[#232530] text-center text-xs text-[#8c8a82]">
              No relays in this set yet. Add any public <code className="text-cyan-300">wss://</code>{' '}
              relay URL above.
            </div>
          ) : (
            <div className="space-y-1.5">
              {setObj.items.map((url, idx) => {
                const st = relayStatuses[url]
                const dot =
                  st === 'connected'
                    ? 'bg-emerald-400'
                    : st === 'connecting'
                      ? 'bg-amber-400'
                      : 'bg-[#4b4d5a]'
                const rowTone =
                  st === 'connected'
                    ? 'bg-emerald-500/10 border-emerald-500/35'
                    : st === 'connecting'
                      ? 'bg-amber-500/10 border-amber-500/35'
                      : 'bg-red-500/10 border-red-500/30'
                const cappedOut = idx >= MAX_RELAY_SET_ACTIVE_RELAYS
                return (
                  <div
                    key={url}
                    className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${rowTone}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                      <span className="font-mono text-[#ece9e1] truncate">{url}</span>
                      {cappedOut && (
                        <span className="text-[10px] text-amber-300 shrink-0">(over 8 cap)</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeItemFromSet(setObj.kind, setObj.dTag, url, url)}
                      className="px-2 py-1 rounded-lg bg-[#14151c] hover:bg-red-500/25 border border-[#2d3042] hover:border-red-500/50 text-[11px] text-[#c7c4bc] hover:text-red-300 cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
