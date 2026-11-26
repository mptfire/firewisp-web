import { Suspense, lazy, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useListsStore } from '../lib/store/useListsStore'
import { useNostrStore } from '../lib/store/useNostrStore'

const AddToListMenu = lazy(() =>
  import('./AddToListMenu').then((m) => ({ default: m.AddToListMenu })),
)

export function AddToListButton({
  pubkey,
  displayName,
  variant = 'compact',
  className = '',
}: {
  pubkey: string
  displayName: string
  variant?: 'compact' | 'icon' | 'profile'
  className?: string
}) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const lists = useListsStore((s) => s.lists)

  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const cleanPk = pubkey.trim().toLowerCase()
  const isMe = Boolean(myPubkey && myPubkey.toLowerCase() === cleanPk)

  const inListsCount = useMemo(() => {
    let count = 0
    for (const l of Object.values(lists)) {
      if (l.members.includes(cleanPk)) count++
    }
    return count
  }, [lists, cleanPk])

  if (isMe || !cleanPk) return null

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!signer?.canSign) {
      if (myPubkey) {
        useNostrStore
          .getState()
          .setToast('Sign in with a signing key (extension, Bunker, or nsec) to manage lists')
      } else {
        openAuthModal()
      }
      return
    }
    if (anchorRect) {
      setAnchorRect(null)
    } else if (btnRef.current) {
      setAnchorRect(btnRef.current.getBoundingClientRect())
    }
  }

  const baseStyle =
    inListsCount > 0
      ? 'bg-purple-500/25 hover:bg-purple-500/35 border-purple-400/60 text-purple-200'
      : 'bg-purple-500/10 hover:bg-purple-500/25 border-purple-500/25 hover:border-purple-500/50 text-purple-400 hover:text-purple-300'

  const sizeClass =
    variant === 'profile'
      ? 'px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5'
      : variant === 'icon'
        ? 'p-1 rounded-md border flex items-center justify-center'
        : 'p-1.5 rounded-lg border flex items-center justify-center'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        title={
          inListsCount > 0
            ? `${displayName} is in ${inListsCount} ${inListsCount === 1 ? 'list' : 'lists'}`
            : `Add ${displayName} to list`
        }
        aria-label={`Add ${displayName} to list`}
        className={`${sizeClass} transition cursor-pointer shrink-0 ${baseStyle} ${className}`}
      >
        <Plus className={variant === 'icon' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {variant === 'profile' && <span>{inListsCount > 0 ? `Lists (${inListsCount})` : 'List'}</span>}
      </button>

      {anchorRect && (
        <Suspense fallback={null}>
          <AddToListMenu
            targetPubkey={cleanPk}
            displayName={displayName}
            anchorRect={anchorRect}
            onClose={() => setAnchorRect(null)}
          />
        </Suspense>
      )}
    </>
  )
}
