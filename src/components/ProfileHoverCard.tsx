import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import { Check, Copy, ExternalLink, UserMinus, UserPlus, Zap } from 'lucide-react'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { computeHoverCardPosition, useProfileHoverStore } from '../lib/store/useProfileHoverStore'
import { Avatar } from './Avatar'
import { WotBadge } from './WotBadge'

export function ProfileHoverCard() {
  const location = useLocation()
  const pubkey = useProfileHoverStore((s) => s.pubkey)
  const anchorRect = useProfileHoverStore((s) => s.anchorRect)
  const statsCache = useProfileHoverStore((s) => s.statsCache)
  const cancelClose = useProfileHoverStore((s) => s.cancelClose)
  const scheduleClose = useProfileHoverStore((s) => s.scheduleClose)
  const closeImmediate = useProfileHoverStore((s) => s.closeImmediate)
  const fetchProfileFollowStats = useProfileHoverStore((s) => s.fetchProfileFollowStats)

  const myPubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const profile = useNostrStore((s) => (pubkey ? s.profiles[pubkey] : undefined))
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const follows = useNostrStore((s) => s.follows)
  const toggleFollow = useNostrStore((s) => s.toggleFollow)

  const [bannerFailed, setBannerFailed] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setBannerFailed(false)
    setCopied(false)
  }, [pubkey])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  // Dismiss cleanly when navigating to a new route
  useEffect(() => {
    closeImmediate()
  }, [location.pathname, closeImmediate])

  // Dismiss on Escape or scroll and fetch missing profile + follow stats lazily
  useEffect(() => {
    if (!pubkey) return

    if (!useNostrStore.getState().profiles[pubkey]) {
      void fetchProfiles([pubkey])
    }
    void fetchProfileFollowStats(pubkey, myPubkey)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeImmediate()
    }
    const onScroll = () => closeImmediate()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll)
    }
  }, [pubkey, myPubkey, fetchProfiles, fetchProfileFollowStats, closeImmediate])

  const npub = useMemo(() => {
    if (!pubkey) return ''
    try {
      return nip19.npubEncode(pubkey)
    } catch {
      return pubkey
    }
  }, [pubkey])

  if (!pubkey || !anchorRect || typeof document === 'undefined') {
    return null
  }

  const viewport = {
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }
  const pos = computeHoverCardPosition(anchorRect, viewport)

  const displayName =
    profile?.display_name || profile?.name || `${npub.slice(0, 12)}…`
  const bannerUrl = sanitizePublicHttpsUrl(profile?.banner)
  const websiteUrl = sanitizePublicHttpsUrl(profile?.website)
  const cleanNip05 = profile?.nip05 ? profile.nip05.replace(/^_@/, '') : null
  const isMe = Boolean(myPubkey && myPubkey.toLowerCase() === pubkey)
  const isFollowing = follows.some((p) => p.toLowerCase() === pubkey)
  const stats = statsCache[pubkey]

  const handleCopyNpub = async () => {
    try {
      await navigator.clipboard.writeText(npub)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1500)
    } catch {
      useNostrStore.getState().setToast('Clipboard permission unavailable')
    }
  }

  const handleToggleFollow = async () => {
    if (!myPubkey) {
      closeImmediate()
      openAuthModal()
      return
    }
    if (followBusy || isMe) return
    setFollowBusy(true)
    try {
      await toggleFollow(pubkey)
    } finally {
      setFollowBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-label={`${displayName} profile preview`}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
      style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
      className="fixed z-[80] w-[312px] rounded-2xl bg-[#14151e] border border-[#2c2f40] shadow-[0_18px_48px_rgba(0,0,0,0.68)] overflow-hidden text-[#f4f1ea]"
    >
      {/* Mini Banner */}
      <div className="h-16 w-full bg-gradient-to-r from-[#24140d] via-[#1c1622] to-[#141720] overflow-hidden">
        {bannerUrl && !bannerFailed && (
          <img
            src={bannerUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBannerFailed(true)}
            className="w-full h-full object-cover object-center"
          />
        )}
      </div>

      <div className="px-3.5 pb-3.5">
        {/* Avatar + Quick Action Row */}
        <div className="flex items-end justify-between -mt-7 mb-2">
          <Link
            to={`/p/${pubkey}`}
            onClick={closeImmediate}
            className="p-0.5 rounded-full bg-[#14151e] ring-1 ring-white/10"
          >
            <Avatar
              src={profile?.picture}
              pubkey={pubkey}
              name={displayName}
              size="lg"
              disableHoverPreview
            />
          </Link>

          <div className="flex items-center gap-1.5 pt-8">
            <button
              type="button"
              onClick={() => void handleCopyNpub()}
              title={copied ? 'Copied npub' : 'Copy npub'}
              aria-label={`Copy ${displayName} npub`}
              className="p-1.5 rounded-lg bg-[#1a1c26] hover:bg-[#232634] border border-[#2a2d3a] text-[#c7c4bc] hover:text-white cursor-pointer transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            {!isMe && (
              <button
                type="button"
                disabled={followBusy}
                onClick={() => void handleToggleFollow()}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 ${
                  isFollowing
                    ? 'bg-[#1a1c26] hover:bg-amber-500/15 border-[#2d3042] hover:border-amber-500/45 text-[#d4d2cb] hover:text-amber-300'
                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/35 hover:border-emerald-400 text-emerald-300'
                }`}
              >
                {isFollowing ? (
                  <>
                    <UserMinus className="w-3 h-3" />
                    <span>Following</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3 h-3" />
                    <span>Follow</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Name & Identifiers */}
        <Link
          to={`/p/${pubkey}`}
          onClick={closeImmediate}
          className="font-bold text-sm text-white hover:underline block truncate"
        >
          {displayName}
        </Link>

        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-[#9a9890]">
          {cleanNip05 && <span className="text-[#ff8a3d] truncate max-w-[180px]">{cleanNip05}</span>}
          {cleanNip05 && <span className="text-[#5d5b55]">·</span>}
          <span className="font-mono text-[10px] text-[#7c7a72]">{npub.slice(0, 14)}…</span>
          {profile?.lud16 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-[#f59f00] truncate max-w-[170px]"
              title={`Lightning: ${profile.lud16}`}
            >
              <Zap className="w-2.5 h-2.5 shrink-0" />
              {profile.lud16}
            </span>
          )}
        </div>

        {/* Web of Trust badge */}
        <div className="mt-2">
          <WotBadge pubkey={pubkey} showFollowing />
        </div>

        {/* Bio */}
        {profile?.about && (
          <p className="mt-2 text-xs text-[#d4d2cb] leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
            {profile.about}
          </p>
        )}

        {/* Website */}
        {websiteUrl && (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#38bdf8] hover:underline max-w-full truncate"
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            <span className="truncate">{websiteUrl.replace(/^https?:\/\//i, '')}</span>
          </a>
        )}

        {/* Footer Stats */}
        <div className="mt-2.5 pt-2 border-t border-[#222532] flex items-center justify-between gap-2 text-[11px] text-[#8c8a82]">
          <div className="flex items-center gap-2">
            {stats ? (
              <span>
                <strong className="text-[#ece9e1]">{stats.followingCount.toLocaleString()}</strong>{' '}
                following
              </span>
            ) : (
              <span>Loading stats…</span>
            )}
            {stats?.followsMe && (
              <span className="px-1.5 py-0.5 rounded bg-[#232634] text-[10px] text-[#c7c4bc]">
                Follows you
              </span>
            )}
          </div>
          <Link
            to={`/p/${pubkey}`}
            onClick={closeImmediate}
            className="text-[#ff8a3d] hover:underline font-medium shrink-0"
          >
            View profile →
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  )
}
