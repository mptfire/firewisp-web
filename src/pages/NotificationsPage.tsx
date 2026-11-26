import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Bell, CheckCheck, Heart, Repeat2, MessageCircle, Zap, Loader2 } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { parseZapReceiptInfo, useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from '../components/Avatar'

function formatRelative(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function NotificationsPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const notificationIds = useNostrStore((s) => s.notificationIds)
  const notificationsLastSeenAt = useNostrStore((s) => s.notificationsLastSeenAt)
  const readNotificationIds = useNostrStore((s) => s.readNotificationIds)
  const markNotificationRead = useNostrStore((s) => s.markNotificationRead)
  const markNotificationsRead = useNostrStore((s) => s.markNotificationsRead)
  const events = useNostrStore((s) => s.events)
  const profiles = useNostrStore((s) => s.profiles)
  const blockPubkey = useNostrStore((s) => s.blockPubkey)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const [loading, setLoading] = useState(() => notificationIds.length === 0)

  useEffect(() => {
    if (!pubkey) return
    const timer = setTimeout(() => setLoading(false), 1800)
    return () => clearTimeout(timer)
  }, [pubkey])

  const visibleNotificationIds = useMemo(() => {
    const allMutedPks =
      privateMutedPubkeys.length > 0 ? [...mutedPubkeys, ...privateMutedPubkeys] : mutedPubkeys
    return notificationIds.filter((id) => {
      const ev = events[id]
      if (!ev || isEventDeleted(ev) || isEventMuted(ev)) return false
      if (ev.kind === 9735) {
        const actorPk = parseZapReceiptInfo(ev).senderPubkey.toLowerCase()
        if (allMutedPks.includes(actorPk)) return false
      }
      return true
    })
  }, [
    notificationIds,
    events,
    isEventDeleted,
    isEventMuted,
    deletedByAuthor,
    mutedPubkeys,
    mutedHashtags,
    mutedWords,
    privateMutedPubkeys,
    privateMutedHashtags,
    privateMutedWords,
  ])

  useEffect(() => {
    if (visibleNotificationIds.length > 0) setLoading(false)
  }, [visibleNotificationIds.length])

  const latestNotifCreatedAt = visibleNotificationIds[0]
    ? events[visibleNotificationIds[0]]?.created_at || 0
    : 0

  const unreadCount = useMemo(() => {
    if (notificationsLastSeenAt <= 0) return 0
    let count = 0
    for (const id of visibleNotificationIds) {
      const ev = events[id]
      if (!ev) continue
      if (ev.created_at <= notificationsLastSeenAt) break
      if (readNotificationIds[id]) continue
      count++
    }
    return count
  }, [visibleNotificationIds, events, notificationsLastSeenAt, readNotificationIds])

  if (!pubkey) {
    return (
      <div className="p-10 text-center space-y-3">
        <Bell className="w-8 h-8 mx-auto text-[#f59f00]" />
        <h1 className="text-lg font-bold">Notifications</h1>
        <p className="text-sm text-[#9a9890]">Sign in to see replies, likes, reposts, and zaps.</p>
        <button
          onClick={openAuthModal}
          className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold cursor-pointer"
        >
          Sign in
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-[calc(52px+env(safe-area-inset-top,0px))] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-base">Notifications</h1>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-md border bg-emerald-500/20 border-emerald-500/45 text-emerald-300 text-[10px] font-bold tabular-nums leading-none">
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markNotificationsRead(pubkey, latestNotifCreatedAt)}
            className="px-2.5 py-1 rounded-lg bg-[#161820] hover:bg-[#1e212c] border border-[#2a2d3a] text-[11px] font-medium text-[#d4d2cb] hover:text-white flex items-center gap-1.5 transition cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
            Mark all read
          </button>
        )}
      </div>

      {loading && visibleNotificationIds.length === 0 ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#e8590c]" />
        </div>
      ) : visibleNotificationIds.length === 0 ? (
        <div className="p-12 text-center text-sm text-[#8c8a82]">No notifications yet.</div>
      ) : (
        visibleNotificationIds.map((id) => {
          const ev = events[id]
          if (!ev) return null
          const zapInfo = ev.kind === 9735 ? parseZapReceiptInfo(ev) : null
          const actorPubkey = zapInfo ? zapInfo.senderPubkey : ev.pubkey
          const p = profiles[actorPubkey]
          const name = p?.display_name || p?.name || `${actorPubkey.slice(0, 10)}…`
          const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
          const linkTarget =
            ev.kind === 1 || ev.kind === 1111
              ? `/e/${ev.id}`
              : targetId
                ? `/e/${targetId}`
                : `/p/${actorPubkey}`

          const Icon =
            ev.kind === 7
              ? Heart
              : ev.kind === 6
                ? Repeat2
                : ev.kind === 9735
                  ? Zap
                  : MessageCircle
          const iconColor =
            ev.kind === 7
              ? 'text-rose-400'
              : ev.kind === 6
                ? 'text-emerald-400'
                : ev.kind === 9735
                  ? 'text-[#f59f00]'
                  : 'text-[#ff8a3d]'

          const actionText =
            ev.kind === 7
              ? `reacted ${ev.content || '+'}`
              : ev.kind === 6
                ? 'reposted your note'
                : ev.kind === 9735
                  ? zapInfo && zapInfo.sats > 0
                    ? `zapped ${zapInfo.sats.toLocaleString()} sats`
                    : 'zapped your note'
                  : 'replied or mentioned you'

          const previewText =
            ev.kind === 9735 ? zapInfo?.comment : ev.kind === 1 || ev.kind === 1111 ? ev.content : undefined

          const isUnread =
            notificationsLastSeenAt > 0 &&
            ev.created_at > notificationsLastSeenAt &&
            !readNotificationIds[ev.id]
          const isMe = actorPubkey.toLowerCase() === pubkey.toLowerCase()

          return (
            <div
              key={ev.id}
              className={`flex items-start gap-2.5 px-4 py-3 border-b border-[#20222c] hover:bg-white/[0.03] transition ${
                isUnread ? 'bg-emerald-500/[0.06] border-l-2 border-l-emerald-400' : ''
              }`}
            >
              <Link
                to={linkTarget}
                onClick={() => {
                  if (isUnread) markNotificationRead(pubkey, ev.id)
                }}
                onAuxClick={() => {
                  if (isUnread) markNotificationRead(pubkey, ev.id)
                }}
                className="flex items-start gap-3 min-w-0 flex-1"
              >
                <Icon className={`w-4 h-4 mt-1.5 shrink-0 ${iconColor}`} />
                <Avatar src={p?.picture} pubkey={actorPubkey} name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm truncate">
                      <span className="font-semibold text-white">{name}</span>{' '}
                      <span className="text-[#9a9890]">{actionText}</span>
                    </p>
                    <span className="text-[11px] text-[#6f6d66] shrink-0">
                      {formatRelative(ev.created_at)}
                    </span>
                  </div>
                  {previewText && (
                    <p className="text-xs text-[#b5b3ab] truncate mt-0.5">{previewText}</p>
                  )}
                </div>
              </Link>
              {!isMe && (
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) markNotificationRead(pubkey, ev.id)
                    void blockPubkey(actorPubkey, name)
                  }}
                  title={`Block & mute ${name}`}
                  aria-label={`Block ${name}`}
                  className="mt-0.5 shrink-0 px-2 py-0.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition cursor-pointer bg-red-500/10 hover:bg-red-500/25 border-red-500/25 hover:border-red-500/50 text-red-400 hover:text-red-300"
                >
                  <Ban className="w-3 h-3" />
                  <span className="hidden sm:inline">Block User</span>
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
