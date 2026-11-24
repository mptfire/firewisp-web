import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Heart, Repeat2, MessageCircle, Zap } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { Avatar } from '../components/Avatar'

export function NotificationsPage() {
  const pubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const notificationIds = useNostrStore((s) => s.notificationIds)
  const events = useNostrStore((s) => s.events)
  const profiles = useNostrStore((s) => s.profiles)
  const subscribeNotifications = useNostrStore((s) => s.subscribeNotifications)

  useEffect(() => {
    if (!pubkey) return
    return subscribeNotifications(pubkey)
  }, [pubkey, subscribeNotifications])

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

      {notificationIds.length === 0 ? (
        <div className="p-12 text-center text-sm text-[#8c8a82]">No notifications yet.</div>
      ) : (
        notificationIds.map((id) => {
          const ev = events[id]
          if (!ev) return null
          const p = profiles[ev.pubkey]
          const name = p?.display_name || p?.name || `${ev.pubkey.slice(0, 10)}…`
          const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
          const linkTarget = ev.kind === 1 || ev.kind === 1111 ? `/e/${ev.id}` : targetId ? `/e/${targetId}` : `/p/${ev.pubkey}`

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
                  ? 'zapped your note'
                  : 'replied or mentioned you'

          return (
            <Link
              key={ev.id}
              to={linkTarget}
              className="flex items-start gap-3 px-4 py-3 border-b border-[#20222c] hover:bg-white/[0.02] transition"
            >
              <Icon className={`w-4 h-4 mt-1.5 shrink-0 ${iconColor}`} />
              <Avatar src={p?.picture} pubkey={ev.pubkey} name={name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold text-white">{name}</span>{' '}
                  <span className="text-[#9a9890]">{actionText}</span>
                </p>
                {/* Compact one-line preview (matches Dark Wisp #105) */}
                {(ev.kind === 1 || ev.kind === 1111) && ev.content && (
                  <p className="text-xs text-[#b5b3ab] truncate mt-0.5">{ev.content}</p>
                )}
              </div>
            </Link>
          )
        })
      )}
    </div>
  )
}
