import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { encodeLiveNaddr } from '../lib/nostr/nip53'
import { useLiveStore, type LiveStreamEntry } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

function LiveNowPill({ stream }: { stream: LiveStreamEntry }) {
  const displayPubkey = stream.activity.streamerPubkey || stream.activity.hostPubkey
  const profile = useNostrStore((s) => s.profiles[displayPubkey])
  const hostName = profile?.display_name || profile?.name || `${displayPubkey.slice(0, 8)}…`
  const title = stream.activity.title || `${hostName}'s stream`
  const naddr = useMemo(
    () =>
      encodeLiveNaddr(
        stream.activity.hostPubkey,
        stream.activity.dTag,
        stream.activity.relayHints,
      ),
    [stream.activity.hostPubkey, stream.activity.dTag, stream.activity.relayHints],
  )
  const count = stream.chatters.length

  return (
    <Link
      to={`/live/${naddr}`}
      className="flex items-center gap-2.5 pl-1.5 pr-3.5 py-1.5 rounded-full bg-[#e8590c]/12 hover:bg-[#e8590c]/22 border border-[#e8590c]/30 hover:border-[#e8590c]/60 transition shrink-0 group"
    >
      <div className="relative shrink-0">
        <Avatar src={profile?.picture} pubkey={displayPubkey} name={hostName} size="sm" />
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#0e0e11]" />
      </div>
      <span className="text-xs font-medium text-[#f4f1ea] group-hover:text-white max-w-[160px] truncate">
        {title}
      </span>
      {count > 0 && (
        <span className="text-[11px] text-[#9a9890] shrink-0">{count} chatting</span>
      )}
    </Link>
  )
}

export function LiveNowRow() {
  const showLiveNowBar = useSettingsStore((s) => s.showLiveNowBar)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const liveStreams = useLiveStore((s) => s.liveStreams)

  const activeStreams = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600
    return Object.values(liveStreams)
      .filter((s) => {
        if (s.activity.status !== 'live' || !s.activity.streamingUrl) return false
        const hostPk = (s.activity.streamerPubkey || s.activity.hostPubkey).toLowerCase()
        if (mutedPubkeys.includes(hostPk) || mutedPubkeys.includes(s.activity.hostPubkey)) {
          return false
        }
        // Match Wisp Android: surface streams with active chatters or freshly started within 6h
        return s.chatters.length > 0 || s.activity.createdAt >= cutoff
      })
      .sort((a, b) => {
        if (b.chatters.length !== a.chatters.length) return b.chatters.length - a.chatters.length
        return b.activity.createdAt - a.activity.createdAt
      })
      .slice(0, 15)
  }, [liveStreams, mutedPubkeys])

  if (!showLiveNowBar || activeStreams.length === 0) return null

  return (
    <div className="border-b border-[#20222c] bg-[#111218]/90 px-3 py-2.5 flex items-center gap-2 overflow-x-auto">
      <div className="px-2 py-1 rounded-md bg-red-600 text-white text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 shrink-0">
        <Radio className="w-3 h-3 animate-pulse" />
        LIVE
      </div>
      {activeStreams.map((stream) => (
        <LiveNowPill key={stream.aTagValue} stream={stream} />
      ))}
    </div>
  )
}
