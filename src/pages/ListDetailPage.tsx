import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import { ArrowLeft, Check, Loader2, Lock, Pencil, Plus, Search, Trash2, UserMinus } from 'lucide-react'
import { searchProfiles, type ProfileSearchHit } from '../lib/nostr/profileSearch'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'

export function ListDetailPage() {
  const { dTag: rawDTag = '' } = useParams<{ dTag: string }>()
  const dTag = useMemo(() => {
    try {
      return decodeURIComponent(rawDTag)
    } catch {
      return rawDTag
    }
  }, [rawDTag])

  const navigate = useNavigate()
  const pubkey = useAuthStore((s) => s.pubkey)
  const list = useListsStore((s) => s.lists[dTag])
  const renameList = useListsStore((s) => s.renameList)
  const deleteList = useListsStore((s) => s.deleteList)
  const addMember = useListsStore((s) => s.addMember)
  const removeMember = useListsStore((s) => s.removeMember)
  const profiles = useNostrStore((s) => s.profiles)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const relays = useSettingsStore((s) => s.relays)

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
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchHits, setSearchHits] = useState<ProfileSearchHit[]>([])
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    if (list) setTitleInput(list.name)
  }, [list?.name])

  useEffect(() => {
    if (list && list.members.length > 0) {
      void fetchProfiles(list.members.slice(0, 100))
    }
  }, [list?.members.join(','), fetchProfiles])

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!list || !titleInput.trim() || savingTitle) return
    setSavingTitle(true)
    try {
      const ok = await renameList(list.dTag, titleInput)
      if (ok) setEditingTitle(false)
    } finally {
      setSavingTitle(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q || searching) return
    setSearching(true)
    try {
      const hits = await searchProfiles(q, readRelays)
      setSearchHits(hits)
    } finally {
      setSearching(false)
    }
  }

  const handleDelete = async () => {
    if (!list) return
    const ok = await deleteList(list.dTag)
    if (ok) navigate('/lists', { replace: true })
  }

  if (!pubkey) {
    return (
      <div className="p-8 text-center text-sm text-[#9a9890]">
        Sign in to view and manage your lists.
      </div>
    )
  }

  if (!list) {
    return (
      <div className="p-6 space-y-4">
        <Link
          to="/lists"
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

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to="/lists"
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
                  setTitleInput(list.name)
                }}
                className="px-2 py-1 rounded-lg bg-[#20222c] text-xs text-[#c2bfb7] cursor-pointer"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-bold text-base truncate">{list.name}</h1>
              {list.isPrivate && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300 flex items-center gap-1 shrink-0">
                  <Lock className="w-2.5 h-2.5" />
                  Private
                </span>
              )}
              {!list.isLocked && (
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
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="p-1.5 rounded-lg text-[#8c8a82] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
              title="Delete list"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Add person box */}
      <div className="p-4 space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#8c8a82] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Add person by name, user@domain, or npub1…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs focus:outline-none focus:border-purple-400"
            />
          </div>
          <button
            type="submit"
            disabled={!searchQuery.trim() || searching}
            className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Find
          </button>
        </form>

        {searchHits.length > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-[#232530] divide-y divide-[#20222c] max-h-60 overflow-y-auto">
            {searchHits.map((hit) => {
              const label = hit.display_name || hit.name || `${hit.pubkey.slice(0, 12)}…`
              const already = list.members.includes(hit.pubkey)
              return (
                <div key={hit.pubkey} className="px-3 py-2 flex items-center justify-between gap-2">
                  <Link to={`/p/${hit.pubkey}`} className="flex items-center gap-2 min-w-0">
                    <Avatar src={hit.picture} pubkey={hit.pubkey} name={label} size="sm" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{label}</div>
                      {hit.nip05 && (
                        <div className="text-[11px] text-[#f59f00] truncate">
                          {hit.nip05.replace(/^_@/, '')}
                        </div>
                      )}
                    </div>
                  </Link>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => void addMember(list.dTag, hit.pubkey, label)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer ${
                      already
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 cursor-default'
                        : 'bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200'
                    }`}
                  >
                    {already ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {already ? 'In list' : 'Add'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Member list */}
      <div>
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#8c8a82] border-b border-[#20222c]">
          Members ({list.members.length})
        </div>
        {list.members.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#8c8a82]">
            No people in this list yet. Use the search box above or click the purple <strong className="text-purple-400">+</strong> on any note or notification.
          </div>
        ) : (
          list.members.map((pk) => {
            const prof = profiles[pk]
            let npub = pk
            try {
              npub = nip19.npubEncode(pk)
            } catch {
              // keep hex
            }
            const label = prof?.display_name || prof?.name || `${npub.slice(0, 14)}…`
            return (
              <div
                key={pk}
                className="px-4 py-2.5 border-b border-[#20222c] flex items-center justify-between gap-2 hover:bg-white/[0.02]"
              >
                <Link to={`/p/${pk}`} className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={prof?.picture} pubkey={pk} name={label} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{label}</div>
                    <div className="text-[11px] text-[#8c8a82] truncate">
                      {prof?.nip05 ? prof.nip05.replace(/^_@/, '') : `${npub.slice(0, 22)}…`}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void removeMember(list.dTag, pk, label)}
                  className="px-2.5 py-1 rounded-lg bg-[#1a1c26] hover:bg-red-500/20 border border-[#2d3042] hover:border-red-500/45 text-[11px] text-[#c7c4bc] hover:text-red-300 flex items-center gap-1 shrink-0 transition cursor-pointer"
                >
                  <UserMinus className="w-3 h-3" />
                  Remove
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
