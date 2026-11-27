import { useEffect, useState, type MouseEvent } from 'react'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useProfileHoverStore } from '../lib/store/useProfileHoverStore'

interface AvatarProps {
  src?: string
  pubkey: string
  name?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  disableHoverPreview?: boolean
}

const SIZES = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 text-2xl',
}

function hueFromPubkey(pubkey: string): number {
  let acc = 0
  for (let i = 0; i < Math.min(8, pubkey.length); i++) {
    acc = (acc * 31 + pubkey.charCodeAt(i)) % 360
  }
  return acc
}

function canUseHoverPreview(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

export function Avatar({ src, pubkey, name, size = 'md', disableHoverPreview = false }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const safeSrc = sanitizePublicHttpsUrl(src)
  useEffect(() => {
    setFailed(false)
  }, [safeSrc])
  const label = (name || pubkey.slice(0, 2)).trim().slice(0, 2).toUpperCase()
  const hue = hueFromPubkey(pubkey)

  const handleMouseEnter = (e: MouseEvent<HTMLElement>) => {
    if (disableHoverPreview || !pubkey || !canUseHoverPreview()) return
    const rect = e.currentTarget.getBoundingClientRect()
    useProfileHoverStore.getState().scheduleOpen(pubkey, {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
  }

  const handleMouseLeave = () => {
    if (disableHoverPreview || !pubkey) return
    useProfileHoverStore.getState().scheduleClose()
  }

  if (safeSrc && !failed) {
    return (
      <img
        src={safeSrc}
        alt={name || 'Avatar'}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`${SIZES[size]} rounded-full object-cover bg-[#1d1e26] ring-1 ring-white/10 shrink-0`}
      />
    )
  }

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`${SIZES[size]} rounded-full flex items-center justify-center font-semibold text-white shrink-0 ring-1 ring-white/10`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 65%, 42%), hsl(${(hue + 35) % 360}, 70%, 30%))`,
      }}
      aria-hidden="true"
    >
      {label}
    </div>
  )
}
