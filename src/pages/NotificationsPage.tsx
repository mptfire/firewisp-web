import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Heart, Repeat2, MessageCircle, Zap, Loader2 } from 'lucide-react'
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
  const events = useNostrStore((s) => s.events)
  const profiles = useNostrStore((s) => s.profiles)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const subscribeNotifications = useNostrStore((s) => s.subscribeNotifications)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!pubkey) return
    setLoading(true)
    const unsub = subscribeNotifications(pubkey)
    const timer = setTimeout(() => setLoading(false), 2500)
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [pubkey, userReadRelays, subscribeNotifications])

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
      <div className="sticky top-[52px] md:top-0 z-20 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-3.5">
        <h1 className="font-bold text-base">Notifications</h1>
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

          return (
            <Link
              key={ev.id}
              to={linkTarget}
              className="flex items-start gap-3 px-4 py-3 border-b border-[#20222c] hover:bg-white/[0.02] transition"
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
          )
        })
      )}
    </div>
  )
}
