import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bookmark,
  ChevronRight,
  Eye,
  EyeOff,
  Hash,
  List,
  Loader2,
  Lock,
  Pin,
  Plus,
  RotateCcw,
  Rss,
  Server,
  Trash2,
} from 'lucide-react'
import { makeListFeedKey } from '../lib/nostr/followSets'
import {
  KIND_BOOKMARK_SET,
  KIND_INTEREST_SET,
  KIND_RELAY_SET,
  makeInterestFeedKey,
  makeRelaySetFeedKey,
  SET_TYPE_TO_KIND,
  type Nip51ItemSet,
  type Nip51SetType,
} from '../lib/nostr/nip51Sets'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { isListShownInFeedDropdown, useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'

type ListsTab = 'people' | Nip51SetType

function parseTabParam(raw: string | null): ListsTab {
  if (raw === 'bookmarks' || raw === 'interests' || raw === 'relays') return raw
  return 'people'
}

export function ListsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const pubkey = useAuthStore((s) => s.pubkey)
  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const profiles = useNostrStore((s) => s.profiles)
  const setActiveFeedTab = useNostrStore((s) => s.setActiveFeedTab)
  const pinnedListTabs = useSettingsStore((s) => s.pinnedListTabs)
  const togglePinnedListTab = useSettingsStore((s) => s.togglePinnedListTab)
  const feedDropdownListOverrides = useSettingsStore((s) => s.feedDropdownListOverrides)
  const toggleFeedDropdownListVisible = useSettingsStore(
    (s) => s.toggleFeedDropdownListVisible,
  )

  const listsMap = useListsStore((s) => s.lists)
  const bookmarkSets = useListsStore((s) => s.bookmarkSets)
  const interestSets = useListsStore((s) => s.interestSets)
  const relaySets = useListsStore((s) => s.relaySets)
  const loading = useListsStore((s) => s.loading)
  const syncStatus = useListsStore((s) => s.syncStatus)
  const fetchOwnLists = useListsStore((s) => s.fetchOwnLists)
  const createList = useListsStore((s) => s.createList)
  const deleteList = useListsStore((s) => s.deleteList)
  const createItemSet = useListsStore((s) => s.createItemSet)
  const deleteItemSet = useListsStore((s) => s.deleteItemSet)

  const activeTab = parseTabParam(params.get('tab'))
  const [newName, setNewName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const sortedPeopleLists = useMemo(
    () =>
      Object.values(listsMap).sort((a, b) =>
        b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.name.localeCompare(b.name),
      ),
    [listsMap],
  )

  const sortSets = (map: Record<string, Nip51ItemSet>) =>
    Object.values(map).sort((a, b) =>
      b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.name.localeCompare(b.name),
    )

  const sortedBookmarks = useMemo(() => sortSets(bookmarkSets), [bookmarkSets])
  const sortedInterests = useMemo(() => sortSets(interestSets), [interestSets])
  const sortedRelays = useMemo(() => sortSets(relaySets), [relaySets])

  if (!pubkey) {
    return (
      <div className="p-10 text-center space-y-3">
        <List className="w-8 h-8 mx-auto text-purple-400" />
        <h1 className="text-lg font-bold">Lists</h1>
        <p className="text-sm text-[#9a9890] max-w-sm mx-auto">
          Group people, bookmarks, hashtags, and relays into named NIP-51 lists that sync across
          Nostr clients.
        </p>
        <button
          type="button"
          onClick={openAuthModal}
          className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold cursor-pointer"
        >
          Sign in
        </button>
      </div>
    )
  }

  const handleSelectTab = (tab: ListsTab) => {
    setConfirmDelete(null)
    if (tab === 'people') {
      setParams({})
    } else {
      setParams({ tab })
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || creating) return
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    setCreating(true)
    try {
      const created =
        activeTab === 'people'
          ? await createList(clean, isPrivate)
          : await createItemSet(SET_TYPE_TO_KIND[activeTab], clean, isPrivate)
      if (created) {
        setNewName('')
        setIsPrivate(false)
      }
    } finally {
      setCreating(false)
    }
  }

  const activeSetItems: Nip51ItemSet[] =
    activeTab === 'bookmarks'
      ? sortedBookmarks
      : activeTab === 'interests'
        ? sortedInterests
        : activeTab === 'relays'
          ? sortedRelays
          : []

  const tabMeta: Array<{
    id: ListsTab
    label: string
    count: number
    Icon: typeof List
    kindLabel: string
  }> = [
    { id: 'people', label: 'People', count: sortedPeopleLists.length, Icon: List, kindLabel: 'kind 30000' },
    { id: 'bookmarks', label: 'Bookmarks', count: sortedBookmarks.length, Icon: Bookmark, kindLabel: 'kind 30003' },
    { id: 'interests', label: 'Interests', count: sortedInterests.length, Icon: Hash, kindLabel: 'kind 30015' },
    { id: 'relays', label: 'Relays', count: sortedRelays.length, Icon: Server, kindLabel: 'kind 30002' },
  ]

  const currentMeta = tabMeta.find((t) => t.id === activeTab)!

  const createPlaceholder =
    activeTab === 'people'
      ? 'New people list name…'
      : activeTab === 'bookmarks'
        ? 'New bookmark list name…'
        : activeTab === 'interests'
          ? 'New hashtag interest set…'
          : 'New relay set name…'

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md">
        <div className="px-4 py-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <List className="w-4 h-4 text-purple-400" />
            <h1 className="font-bold text-base">Lists</h1>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchOwnLists(pubkey)}
            className="px-2.5 py-1 rounded-lg bg-[#161820] hover:bg-[#1e212c] border border-[#2a2d3a] text-[11px] font-medium text-[#d4d2cb] hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
            ) : (
              <RotateCcw className="w-3 h-3 text-purple-400" />
            )}
            Sync Lists
          </button>
        </div>

        <div className="flex overflow-x-auto border-t border-[#20222c] text-xs font-medium">
          {tabMeta.map(({ id, label, count, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectTab(id)}
              className={`flex-1 min-w-[82px] py-2.5 px-2 flex items-center justify-center gap-1.5 border-b-2 transition whitespace-nowrap cursor-pointer ${
                activeTab === id
                  ? 'border-purple-400 text-white'
                  : 'border-transparent text-[#8c8a82] hover:text-white'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${activeTab === id ? 'text-purple-400' : ''}`} />
              <span>{label}</span>
              <span className="text-[10px] text-[#7c7a72]">({count})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-xs text-[#9a9890] leading-relaxed">
          {activeTab === 'people' && (
            <>
              Group people into named lists. Use the purple{' '}
              <span className="text-purple-400 font-semibold">+</span> button on notes,
              notifications, profiles, or live chat to add anyone to a list in one click.
            </>
          )}
          {activeTab === 'bookmarks' &&
            'Organize saved notes into themed collections. Use the ••• menu on any note and choose "Save to bookmark list…".'}
          {activeTab === 'interests' &&
            'Bundle #hashtags into topic feeds you can pin to your Feed tabs or switch into your right sidebar.'}
          {activeTab === 'relays' &&
            'Group curated wss:// relays into themed feeds or import them into your Relays settings.'}
        </p>

        {syncStatus === 'locked' && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-2">
            <span>
              Some private encrypted lists could not be decrypted yet. Approve decryption in your
              signer and click <strong>Sync Lists</strong>.
            </span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-2 p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={createPlaceholder}
              maxLength={60}
              className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-xs focus:outline-none focus:border-purple-400"
            />
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Create
            </button>
          </div>
          <div className="space-y-1">
            <label className="inline-flex items-center gap-2 text-xs text-[#b8b5ad] cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="accent-purple-500"
              />
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Private (NIP-44 encrypted items &amp; title, stays in RAM only)</span>
            </label>
            {(activeTab === 'interests' || activeTab === 'relays') && (
              <p className="text-[11px] text-[#6f6d66]">
                Note: Fire Wisp Android currently syncs Interest &amp; Relay sets as public-only.
              </p>
            )}
          </div>
        </form>

        {activeTab === 'people' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#c2bfb7] px-0.5">
              <span>Your People Lists ({sortedPeopleLists.length})</span>
            </div>

            {loading && sortedPeopleLists.length === 0 ? (
              <div className="py-10 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
              </div>
            ) : sortedPeopleLists.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#13141a] border border-[#20222c] text-center text-xs text-[#8c8a82]">
                No lists yet. Create one above or click the purple{' '}
                <strong className="text-purple-400">+</strong> on any post or notification.
              </div>
            ) : (
              <div className="space-y-2">
                {sortedPeopleLists.map((list) => {
                  const count = list.members.length
                  const previewMembers = list.members.slice(0, 5)
                  const confirming = confirmDelete === list.dTag
                  return (
                    <div
                      key={list.dTag}
                      className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530] hover:border-purple-500/40 transition flex items-center justify-between gap-3"
                    >
                      <Link
                        to={`/lists/${encodeURIComponent(list.dTag)}`}
                        className="min-w-0 flex-1 space-y-1.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm text-white truncate">
                            {list.name}
                          </span>
                          {list.isPrivate && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300 flex items-center gap-1 shrink-0">
                              <Lock className="w-2.5 h-2.5" />
                              Private
                            </span>
                          )}
                          {list.isLocked && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[10px] font-semibold text-amber-300 shrink-0">
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-[#9a9890]">
                            {count} {count === 1 ? 'person' : 'people'}
                          </span>
                          {previewMembers.length > 0 && (
                            <div className="flex items-center -space-x-1.5">
                              {previewMembers.map((pk) => {
                                const prof = profiles[pk]
                                return (
                                  <div key={pk} className="ring-2 ring-[#15161c] rounded-full">
                                    <Avatar
                                      src={prof?.picture}
                                      pubkey={pk}
                                      name={prof?.display_name || prof?.name}
                                      size="sm"
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </Link>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {confirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDelete(null)
                                void deleteList(list.dTag)
                              }}
                              className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 rounded-lg bg-[#20222c] text-[#c2bfb7] text-[11px] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveFeedTab(makeListFeedKey(list.dTag))
                                navigate('/')
                                window.scrollTo({ top: 0, behavior: 'smooth' })
                              }}
                              title={`Open ${list.name} as Feed`}
                              className="px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-[11px] font-semibold text-purple-200 flex items-center gap-1 transition cursor-pointer"
                            >
                              <Rss className="w-3 h-3" />
                              <span className="hidden sm:inline">Feed</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const key = makeListFeedKey(list.dTag)
                                toggleFeedDropdownListVisible(key, list.dTag, list.name)
                              }}
                              aria-pressed={isListShownInFeedDropdown(
                                makeListFeedKey(list.dTag),
                                list.dTag,
                                list.name,
                                feedDropdownListOverrides,
                              )}
                              title={
                                isListShownInFeedDropdown(
                                  makeListFeedKey(list.dTag),
                                  list.dTag,
                                  list.name,
                                  feedDropdownListOverrides,
                                )
                                  ? 'Included in feed dropdown — click to hide'
                                  : 'Hidden from feed dropdown — click to include'
                              }
                              className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                                isListShownInFeedDropdown(
                                  makeListFeedKey(list.dTag),
                                  list.dTag,
                                  list.name,
                                  feedDropdownListOverrides,
                                )
                                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                  : 'bg-[#111218] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                              }`}
                            >
                              {isListShownInFeedDropdown(
                                makeListFeedKey(list.dTag),
                                list.dTag,
                                list.name,
                                feedDropdownListOverrides,
                              ) ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline">Dropdown</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => togglePinnedListTab(list.dTag)}
                              title={
                                pinnedListTabs.includes(list.dTag)
                                  ? 'Unpin from Feed tabs'
                                  : 'Pin to Feed tabs'
                              }
                              aria-label={
                                pinnedListTabs.includes(list.dTag)
                                  ? `Unpin ${list.name} from Feed tabs`
                                  : `Pin ${list.name} to Feed tabs`
                              }
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                pinnedListTabs.includes(list.dTag)
                                  ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                                  : 'border-transparent text-[#7c7a72] hover:text-white hover:bg-white/5'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(list.dTag)}
                              title={`Delete ${list.name}`}
                              aria-label={`Delete ${list.name}`}
                              className="p-1.5 rounded-lg text-[#7c7a72] hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <Link
                              to={`/lists/${encodeURIComponent(list.dTag)}`}
                              className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 transition"
                              aria-label={`Open ${list.name}`}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#c2bfb7] px-0.5">
              <span>
                Your {currentMeta.label} Lists ({activeSetItems.length})
              </span>
            </div>

            {loading && activeSetItems.length === 0 ? (
              <div className="py-10 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
              </div>
            ) : activeSetItems.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#13141a] border border-[#20222c] text-center text-xs text-[#8c8a82]">
                No {currentMeta.label.toLowerCase()} sets yet. Create one above!
              </div>
            ) : (
              <div className="space-y-2">
                {activeSetItems.map((setObj) => {
                  const feedKey =
                    setObj.kind === KIND_INTEREST_SET
                      ? makeInterestFeedKey(setObj.dTag)
                      : setObj.kind === KIND_RELAY_SET
                        ? makeRelaySetFeedKey(setObj.dTag)
                        : null
                  const isPinned = feedKey ? pinnedListTabs.includes(feedKey) : false
                  const confirming = confirmDelete === `${setObj.kind}:${setObj.dTag}`
                  const detailPath = `/lists/${setObj.type}/${encodeURIComponent(setObj.dTag)}`
                  const countUnit =
                    setObj.kind === KIND_BOOKMARK_SET
                      ? setObj.items.length === 1
                        ? 'note'
                        : 'notes'
                      : setObj.kind === KIND_INTEREST_SET
                        ? setObj.items.length === 1
                          ? 'hashtag'
                          : 'hashtags'
                        : setObj.items.length === 1
                          ? 'relay'
                          : 'relays'

                  return (
                    <div
                      key={`${setObj.kind}:${setObj.dTag}`}
                      className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530] hover:border-purple-500/40 transition flex items-center justify-between gap-3"
                    >
                      <Link to={detailPath} className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm text-white truncate">
                            {setObj.name}
                          </span>
                          {setObj.isPrivate && (
                            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300 flex items-center gap-1 shrink-0">
                              <Lock className="w-2.5 h-2.5" />
                              Private
                            </span>
                          )}
                          {setObj.isLocked && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[10px] font-semibold text-amber-300 shrink-0">
                              Locked
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#9a9890]">
                          <span>
                            {setObj.items.length} {countUnit}
                          </span>
                          {setObj.kind === KIND_INTEREST_SET &&
                            setObj.items.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-[10px] text-[#f59f00]"
                              >
                                #{tag}
                              </span>
                            ))}
                          {setObj.kind === KIND_RELAY_SET &&
                            setObj.items.slice(0, 3).map((url) => (
                              <span
                                key={url}
                                className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 text-[10px] font-mono text-cyan-300"
                              >
                                {url.replace(/^wss:\/\//i, '')}
                              </span>
                            ))}
                        </div>
                      </Link>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {confirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDelete(null)
                                void deleteItemSet(setObj.kind, setObj.dTag)
                              }}
                              className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 rounded-lg bg-[#20222c] text-[#c2bfb7] text-[11px] cursor-pointer"
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
                                  title={`Open ${setObj.name} as Feed`}
                                  className="px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-[11px] font-semibold text-purple-200 flex items-center gap-1 transition cursor-pointer"
                                >
                                  <Rss className="w-3 h-3" />
                                  <span className="hidden sm:inline">Feed</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleFeedDropdownListVisible(feedKey, setObj.dTag, setObj.name)
                                  }
                                  aria-pressed={isListShownInFeedDropdown(
                                    feedKey,
                                    setObj.dTag,
                                    setObj.name,
                                    feedDropdownListOverrides,
                                  )}
                                  title={
                                    isListShownInFeedDropdown(
                                      feedKey,
                                      setObj.dTag,
                                      setObj.name,
                                      feedDropdownListOverrides,
                                    )
                                      ? 'Included in feed dropdown — click to hide'
                                      : 'Hidden from feed dropdown — click to include'
                                  }
                                  className={`px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer ${
                                    isListShownInFeedDropdown(
                                      feedKey,
                                      setObj.dTag,
                                      setObj.name,
                                      feedDropdownListOverrides,
                                    )
                                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                      : 'bg-[#111218] border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb]'
                                  }`}
                                >
                                  {isListShownInFeedDropdown(
                                    feedKey,
                                    setObj.dTag,
                                    setObj.name,
                                    feedDropdownListOverrides,
                                  ) ? (
                                    <Eye className="w-3 h-3" />
                                  ) : (
                                    <EyeOff className="w-3 h-3" />
                                  )}
                                  <span className="hidden sm:inline">Dropdown</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => togglePinnedListTab(feedKey)}
                                  title={
                                    isPinned ? 'Unpin from Feed tabs' : 'Pin to Feed tabs'
                                  }
                                  className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                    isPinned
                                      ? 'bg-purple-500/20 border-purple-400/50 text-purple-200'
                                      : 'border-transparent text-[#7c7a72] hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  <Pin className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(`${setObj.kind}:${setObj.dTag}`)}
                              title={`Delete ${setObj.name}`}
                              aria-label={`Delete ${setObj.name}`}
                              className="p-1.5 rounded-lg text-[#7c7a72] hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <Link
                              to={detailPath}
                              className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 transition"
                              aria-label={`Open ${setObj.name}`}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-[#6f6d66] pt-2">
          {currentMeta.label} lists are stored on Nostr (NIP-51 {currentMeta.kindLabel}) and sync
          across clients.
        </p>
      </div>
    </div>
  )
}
