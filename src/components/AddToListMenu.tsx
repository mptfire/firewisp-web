import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Lock, Plus, Loader2 } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'

interface AddToListMenuProps {
  targetPubkey: string
  displayName: string
  anchorRect: DOMRect
  onClose: () => void
}

const MENU_WIDTH = 256

export function AddToListMenu({
  targetPubkey,
  displayName,
  anchorRect,
  onClose,
}: AddToListMenuProps) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const listsMap = useListsStore((s) => s.lists)
  const syncStatus = useListsStore((s) => s.syncStatus)
  const fetchOwnLists = useListsStore((s) => s.fetchOwnLists)
  const createList = useListsStore((s) => s.createList)
  const addMember = useListsStore((s) => s.addMember)
  const removeMember = useListsStore((s) => s.removeMember)

  const [newName, setNewName] = useState('')
  const [newPrivate, setNewPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const cleanTarget = targetPubkey.trim().toLowerCase()

  const sortedLists = useMemo(
    () => Object.values(listsMap).sort((a, b) => a.name.localeCompare(b.name)),
    [listsMap],
  )
  const hasLocked = sortedLists.some((l) => l.isLocked)

  useEffect(() => {
    if (sortedLists.length === 0) setShowNewForm(true)
  }, [sortedLists.length])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  const estHeight = Math.min(340, 120 + sortedLists.length * 36 + (showNewForm ? 96 : 0))
  const left = Math.max(8, Math.min(vw - MENU_WIDTH - 8, anchorRect.right - MENU_WIDTH))
  const openAbove = anchorRect.bottom + estHeight + 12 > vh && anchorRect.top > estHeight
  const top = openAbove
    ? Math.max(8, anchorRect.top - estHeight - 6)
    : Math.min(vh - estHeight - 8, anchorRect.bottom + 6)

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = newName.trim()
    if (!clean || creating) return
    setCreating(true)
    try {
      const created = await createList(clean, newPrivate)
      if (created) {
        setNewName('')
        setNewPrivate(false)
        setShowNewForm(false)
        await addMember(created.dTag, cleanTarget, displayName)
      }
    } finally {
      setCreating(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{ top, left, width: MENU_WIDTH }}
      className="fixed z-50 rounded-xl bg-[#181922] border border-[#2d3042] shadow-2xl shadow-black/75 p-2.5 text-xs text-[#f4f1ea]"
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-1.5 border-b border-[#252836]">
        <span className="font-semibold text-purple-300 truncate">
          Lists for {displayName}
        </span>
        {hasLocked && myPubkey && (
          <button
            type="button"
            disabled={syncStatus === 'syncing'}
            onClick={() => void fetchOwnLists(myPubkey)}
            className="text-[10px] text-amber-300 hover:underline shrink-0 cursor-pointer"
          >
            {syncStatus === 'syncing' ? 'Syncing…' : 'Unlock'}
          </button>
        )}
      </div>

      {sortedLists.length > 0 && (
        <div className="max-h-44 overflow-y-auto space-y-1 pr-0.5">
          {sortedLists.map((list) => {
            const checked = list.members.includes(cleanTarget)
            return (
              <button
                key={list.dTag}
                type="button"
                disabled={list.isLocked}
                onClick={() => {
                  if (checked) {
                    void removeMember(list.dTag, cleanTarget, displayName)
                  } else {
                    void addMember(list.dTag, cleanTarget, displayName)
                  }
                }}
                className={`w-full px-2 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition cursor-pointer disabled:opacity-50 ${
                  checked
                    ? 'bg-purple-500/20 text-purple-200'
                    : 'hover:bg-white/[0.05] text-[#d4d2cb]'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      checked
                        ? 'bg-purple-500 border-purple-400 text-white'
                        : 'border-[#3a3e52] bg-[#101118]'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3" />}
                  </span>
                  <span className="truncate font-medium">{list.name}</span>
                  {list.isPrivate && <Lock className="w-3 h-3 text-emerald-400 shrink-0" />}
                </span>
                <span className="text-[10px] text-[#7c7a72] shrink-0">
                  {list.members.length}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-[#252836]">
        {!showNewForm ? (
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            className="w-full px-2 py-1.5 rounded-lg text-purple-300 hover:bg-purple-500/15 flex items-center gap-1.5 font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New list…
          </button>
        ) : (
          <form onSubmit={handleCreateAndAdd} className="space-y-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New list name…"
              maxLength={60}
              autoFocus
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#0e0e11] border border-[#2c2f40] text-xs focus:outline-none focus:border-purple-400"
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-[#9a9890] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPrivate}
                  onChange={(e) => setNewPrivate(e.target.checked)}
                  className="accent-purple-500"
                />
                Private
              </label>
              <button
                type="submit"
                disabled={!newName.trim() || creating}
                className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-45 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                {creating && <Loader2 className="w-3 h-3 animate-spin" />}
                Create &amp; Add
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
