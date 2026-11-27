import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Zap } from 'lucide-react'
import { formatCompactCount } from '../lib/format'
import { rankTopZappers } from '../lib/nostr/nip53'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { Avatar } from './Avatar'

export function StreamTopZappersCard({ compact = false }: { compact?: boolean }) {
  const streamZappers = useLiveStore((s) => s.streamZappers)
  const streamZapTotal = useLiveStore((s) => s.streamZapTotal)
  const focusedChatTitle = useLiveStore((s) => s.focusedChatTitle)
  const profiles = useNostrStore((s) => s.profiles)

  const topZappers = useMemo(
    () => rankTopZappers(streamZappers, compact ? 6 : 10),
    [streamZappers, compact],
  )

  return (
    <div className="p-3 rounded-2xl bg-[#15161c] border border-[#f59f00]/25 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#f59f00] flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
          Top Zappers
        </span>
        {streamZapTotal > 0 && (
          <span className="px-1.5 py-0.5 rounded-md bg-[#f59f00]/15 text-[#f59f00] text-[10px] font-bold flex items-center gap-0.5 shrink-0">
            <Zap className="w-2.5 h-2.5 fill-[#f59f00]" />
            {formatCompactCount(streamZapTotal, { kThreshold: 10_000, formatPlain: true })}
          </span>
        )}
      </div>

      {focusedChatTitle && (
        <div className="text-[10px] text-[#8c8a82] truncate -mt-1" title={focusedChatTitle}>
          {focusedChatTitle}
        </div>
      )}

      {topZappers.length === 0 ? (
        <p className="text-[11px] text-[#7e7c74] py-1">
          No zaps yet for this stream.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
          {topZappers.map((z, idx) => {
            const prof = profiles[z.pubkey]
            const name = prof?.display_name || prof?.name || `${z.pubkey.slice(0, 8)}…`
            const rankBadge =
              idx === 0
                ? 'bg-[#f59f00]/25 text-[#ffd43b] border-[#f59f00]/45'
                : idx === 1
                  ? 'bg-slate-400/20 text-slate-200 border-slate-400/35'
                  : idx === 2
                    ? 'bg-[#e8590c]/25 text-[#ff922b] border-[#e8590c]/40'
                    : 'bg-[#1d1f29] text-[#8c8a82] border-[#292c3b]'

            return (
              <Link
                key={z.pubkey}
                to={`/p/${z.pubkey}`}
                className="flex items-center justify-between gap-2 px-1.5 py-1 rounded-xl hover:bg-white/[0.04] transition group"
                title={`${name} · ${z.totalSats.toLocaleString()} sats (${z.zapCount} ${z.zapCount === 1 ? 'zap' : 'zaps'})`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-5 h-5 rounded-md border text-[10px] font-bold flex items-center justify-center shrink-0 ${rankBadge}`}
                  >
                    {idx + 1}
                  </span>
                  <Avatar src={prof?.picture} pubkey={z.pubkey} name={name} size="sm" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#ece9e1] group-hover:text-[#ff922b] truncate leading-tight transition">
                      {name}
                    </div>
                    {z.zapCount > 1 && (
                      <div className="text-[9px] text-[#7c7a72] leading-tight">
                        {z.zapCount} zaps
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-[11px] font-bold text-[#f59f00] flex items-center gap-0.5 shrink-0">
                  <Zap className="w-2.5 h-2.5 fill-[#f59f00]" />
                  {formatCompactCount(z.totalSats, { kThreshold: 10_000, formatPlain: true })}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
