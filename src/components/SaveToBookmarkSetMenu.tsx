import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Bookmark, Check, Loader2, Lock, Plus, X } from 'lucide-react'
import { KIND_BOOKMARK_SET } from '../lib/nostr/nip51Sets'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'

interface SaveToBookmarkSetMenuProps {
  noteId: string
  onClose: () => void
}

export function SaveToBookmarkSetMenu({ noteId, onClose }: SaveToBookmarkSetMenuProps) {
  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const bookmarkSets = useListsStore((s) => s.bookmarkSets)
  const createItemSet = useListsStore((s) => s.createItemSet)
  const addItemToSet = useListsStore((s) => s.addItemToSet)
  const removeItemFromSet = useListsStore((s) => s.removeItemFromSet)

  const [newName, setNewName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyDTag, setBusyDTag] = useState<string | null>(null)

  const cleanId = noteId.trim().toLowerCase()
  const sortedSets = useMemo(
    () =>
      Object.values(bookmarkSets).sort((a, b) =>
        b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.name.localeCompare(b.name),
      ),
    [bookmarkSets],
  )

  const handleToggle = async (dTag: string, alreadyIn: boolean) => {
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    setBusyDTag(dTag)
    try {
      if (alreadyIn) {
        await removeItemFromSet(KIND_BOOKMARK_SET, dTag, cleanId, 'note')
      } else {
        await addItemToSet(KIND_BOOKMARK_SET, dTag, cleanId, 'note')
      }
    } finally {
      setBusyDTag(null)
    }
  }

  const handleCreateAndSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || creating) return
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    setCreating(true)
    try {
      const created = await createItemSet(KIND_BOOKMARK_SET, clean, isPrivate)
      if (created) {
        setNewName('')
        setIsPrivate(false)
        await addItemToSet(KIND_BOOKMARK_SET, created.dTag, cleanId, 'note')
      }
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save note to bookmark list"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[#15161e] border border-[#2a2d3d] shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-[#232533] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Bookmark className="w-4 h-4 text-[#f59f00] shrink-0" />
            <h2 className="text-sm font-semibold text-white truncate">Save to bookmark list</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-60 overflow-y-auto divide-y divide-[#20222e]">
          {sortedSets.length === 0 ? (
            <div className="px-4 py-5 text-center text-xs text-[#8c8a82]">
              No bookmark lists yet. Create one below!
            </div>
          ) : (
            sortedSets.map((setObj) => {
              const checked = setObj.items.includes(cleanId)
              const busy = busyDTag === setObj.dTag
              return (
                <button
                  key={setObj.dTag}
                  type="button"
                  disabled={busy || setObj.isLocked}
                  onClick={() => void handleToggle(setObj.dTag, checked)}
                  className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.04] transition cursor-pointer disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-white truncate">{setObj.name}</span>
                      {setObj.isPrivate && (
                        <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-[#7c7a72]">
                      {setObj.items.length} {setObj.items.length === 1 ? 'note' : 'notes'}
                    </div>
                  </div>
                  <span
                    className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition ${
                      checked
                        ? 'bg-[#e8590c] border-[#e8590c] text-white'
                        : 'border-[#323548] bg-[#0e0f15] text-transparent'
                    }`}
                  >
                    {busy ? (
                      <Loader2 className="w-3 h-3 animate-spin text-white" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <form
          onSubmit={handleCreateAndSave}
          className="p-3 border-t border-[#232533] bg-[#111218] space-y-2"
        >
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New bookmark list…"
              maxLength={60}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#0e0e11] border border-[#2a2d3a] text-xs text-white focus:outline-none focus:border-[#f59f00]"
            />
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="px-3 py-1.5 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <label className="inline-flex items-center gap-1.5 text-[#9a9890] cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="accent-purple-500"
              />
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Private encrypted</span>
            </label>
            <Link
              to="/lists?tab=bookmarks"
              onClick={() => {
                useNostrStore.getState().setToast(null)
                onClose()
              }}
              className="text-[#ff8a3d] hover:underline"
            >
              Manage lists →
            </Link>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
