import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, List, Lock, Plus, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { Avatar } from '../components/Avatar'

export function ListsPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const profiles = useNostrStore((s) => s.profiles)
  const listsMap = useListsStore((s) => s.lists)
  const loading = useListsStore((s) => s.loading)
  const syncStatus = useListsStore((s) => s.syncStatus)
  const fetchOwnLists = useListsStore((s) => s.fetchOwnLists)
  const createList = useListsStore((s) => s.createList)
  const deleteList = useListsStore((s) => s.deleteList)

  const [newName, setNewName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const sortedLists = useMemo(
    () =>
      Object.values(listsMap).sort((a, b) =>
        b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.name.localeCompare(b.name),
      ),
    [listsMap],
  )

  if (!pubkey) {
    return (
      <div className="p-10 text-center space-y-3">
        <List className="w-8 h-8 mx-auto text-purple-400" />
        <h1 className="text-lg font-bold">Lists</h1>
        <p className="text-sm text-[#9a9890] max-w-sm mx-auto">
          Group people into named NIP-51 lists that sync across Nostr clients.
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
      const created = await createList(clean, isPrivate)
      if (created) {
        setNewName('')
        setIsPrivate(false)
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md px-4 py-3.5 flex items-center justify-between gap-2">
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

      <div className="p-4 space-y-4">
        <p className="text-xs text-[#9a9890] leading-relaxed">
          Group people into named lists. Use the purple <span className="text-purple-400 font-semibold">+</span> button on notes, notifications, profiles, or live chat to add anyone to a list in one click.
        </p>

        {syncStatus === 'locked' && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-2">
            <span>
              Some private encrypted lists could not be decrypted yet. Approve decryption in your signer and click <strong>Sync Lists</strong>.
            </span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-2 p-3.5 rounded-2xl bg-[#15161c] border border-[#232530]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New list name…"
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
          <label className="inline-flex items-center gap-2 text-xs text-[#b8b5ad] cursor-pointer">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="accent-purple-500"
            />
            <Lock className="w-3 h-3 text-emerald-400" />
            <span>Private (NIP-44 encrypted members &amp; title, stays in RAM only)</span>
          </label>
        </form>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-[#c2bfb7] px-0.5">
            <span>Your Lists ({sortedLists.length})</span>
          </div>

          {loading && sortedLists.length === 0 ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            </div>
          ) : sortedLists.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#13141a] border border-[#20222c] text-center text-xs text-[#8c8a82]">
              No lists yet. Create one above or click the purple <strong className="text-purple-400">+</strong> on any post or notification.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedLists.map((list) => {
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

        <p className="text-[11px] text-[#6f6d66] pt-2">
          Lists are stored on Nostr (NIP-51 kind 30000) and sync across clients.
        </p>
      </div>
    </div>
  )
}
