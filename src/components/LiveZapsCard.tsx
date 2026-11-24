import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Radio, Zap } from 'lucide-react'
import { LIVE_DISCOVERY_RELAYS } from '../lib/nostr/nip53'
import { nostrPool } from '../lib/nostr/pool'
import {
  computeLiveZapsStats,
  parseLiveZapReceipt,
  type LiveZapItem,
} from '../lib/nostr/zapsFeed'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

const MAX_LIVE_ZAPS = 80

function formatCompactSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (sats >= 10_000) return `${(sats / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return sats.toLocaleString()
}

function formatAgo(createdAt: number, nowSec: number): string {
  const diff = Math.max(0, nowSec - createdAt)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export function LiveZapsCard({ compact = false }: { compact?: boolean }) {
  const profiles = useNostrStore((s) => s.profiles)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)

  const [rawZaps, setRawZaps] = useState<LiveZapItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const relays = [
      ...new Set([
        ...LIVE_DISCOVERY_RELAYS,
        ...useSettingsStore.getState().getReadRelays(),
      ]),
    ].slice(0, 6)
    const startSec = Math.floor(Date.now() / 1000)
    const since = startSec - 3600
    const seenIds = new Set<string>()
    const profileQueue = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    let active = true

    const queueProfiles = (pks: string[]) => {
      const existing = useNostrStore.getState().profiles
      for (const pk of pks) {
        if (!existing[pk]) profileQueue.add(pk)
      }
      if (profileQueue.size > 0 && !profileTimer) {
        profileTimer = setTimeout(() => {
          profileTimer = null
          const batch = [...profileQueue]
          profileQueue.clear()
          if (batch.length > 0) void useNostrStore.getState().fetchProfiles(batch)
        }, 350)
      }
    }

    const fallbackDone = setTimeout(() => {
      if (active) setLoading(false)
    }, 3500)

    const sub = nostrPool.subscribe(
      relays,
      { kinds: [9735], since, limit: MAX_LIVE_ZAPS },
      {
        onevent: (ev) => {
          if (!active || seenIds.has(ev.id)) return
          seenIds.add(ev.id)
          const parsed = parseLiveZapReceipt(ev)
          if (!parsed) return
          queueProfiles([parsed.senderPubkey, parsed.recipientPubkey])
          setLoading(false)
          setRawZaps((prev) => {
            if (prev.some((z) => z.id === parsed.id)) return prev
            return [parsed, ...prev]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, MAX_LIVE_ZAPS)
          })
        },
        oneose: () => {
          if (active) setLoading(false)
        },
      },
    )

    return () => {
      active = false
      clearTimeout(fallbackDone)
      if (profileTimer) clearTimeout(profileTimer)
      sub.close()
    }
  }, [])

  const visibleZaps = useMemo(() => {
    const mutedSet = new Set([...mutedPubkeys, ...privateMutedPubkeys])
    if (mutedSet.size === 0) return rawZaps
    return rawZaps.filter(
      (z) => !mutedSet.has(z.senderPubkey) && !mutedSet.has(z.recipientPubkey),
    )
  }, [rawZaps, mutedPubkeys, privateMutedPubkeys])

  const stats = useMemo(
    () => computeLiveZapsStats(visibleZaps, nowSec),
    [visibleZaps, nowSec],
  )

  return (
    <div className="p-3 rounded-2xl bg-[#15161c] border border-[#f59f00]/25 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#f59f00] flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[#f59f00] fill-[#f59f00]/40 shrink-0" />
          Live Zaps
        </span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[9px] font-bold tracking-wider uppercase flex items-center gap-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </span>
      </div>

      {/* Compact Scoreboard Strip */}
      {stats.zapCount > 0 && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#0f1016] border border-[#222532] p-1.5 text-center">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#ffd43b] truncate">
              {formatCompactSats(stats.totalSats)}
            </div>
            <div className="text-[9px] text-[#7c7a72] leading-tight">sats</div>
          </div>
          <div className="min-w-0 border-x border-[#20222c]">
            <div className="text-[11px] font-bold text-[#ece9e1] truncate">
              {stats.zapCount}
            </div>
            <div className="text-[9px] text-[#7c7a72] leading-tight">zaps</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#ff922b] truncate">
              {stats.zapsPerMinute}
            </div>
            <div className="text-[9px] text-[#7c7a72] leading-tight">/min</div>
          </div>
        </div>
      )}

      {/* Live Zap Rows */}
      {loading && visibleZaps.length === 0 ? (
        <div className="space-y-1.5 py-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-xl bg-[#1b1d26] animate-pulse" />
          ))}
        </div>
      ) : visibleZaps.length === 0 ? (
        <p className="text-[11px] text-[#7e7c74] py-1">
          Listening for live NIP-57 zaps on relays…
        </p>
      ) : (
        <div
          className={`space-y-1.5 overflow-y-auto pr-0.5 ${
            compact ? 'max-h-56' : 'max-h-64'
          }`}
        >
          {visibleZaps.map((z) => {
            const senderProf = profiles[z.senderPubkey]
            const recipientProf = profiles[z.recipientPubkey]
            const senderName =
              senderProf?.display_name || senderProf?.name || `${z.senderPubkey.slice(0, 7)}…`
            const recipientName =
              recipientProf?.display_name ||
              recipientProf?.name ||
              `${z.recipientPubkey.slice(0, 7)}…`
            const isBigZap = z.sats >= 1000

            return (
              <div
                key={z.id}
                className={`px-2 py-1.5 rounded-xl border transition space-y-1 ${
                  isBigZap
                    ? 'bg-[#f59f00]/10 border-[#f59f00]/35'
                    : 'bg-[#111219] border-[#222532] hover:border-[#2e3245]'
                }`}
              >
                {/* Row 1: Sender + Sats + Time */}
                <div className="flex items-center justify-between gap-1.5">
                  <Link
                    to={`/p/${z.senderPubkey}`}
                    className="flex items-center gap-1.5 min-w-0 group"
                    title={senderName}
                  >
                    <Avatar
                      src={senderProf?.picture}
                      pubkey={z.senderPubkey}
                      name={senderName}
                      size="sm"
                    />
                    <span className="text-[11px] font-semibold text-[#ece9e1] group-hover:text-[#ff922b] truncate transition">
                      {senderName}
                    </span>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-0.5 ${
                        isBigZap
                          ? 'bg-[#f59f00]/25 text-[#ffd43b]'
                          : 'bg-[#f59f00]/15 text-[#f59f00]'
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5 fill-current" />
                      {formatCompactSats(z.sats)}
                    </span>
                    <span className="text-[9px] text-[#6f6d66]">
                      {formatAgo(z.createdAt, nowSec)}
                    </span>
                  </div>
                </div>

                {/* Row 2: -> Recipient + Target link (note / stream) */}
                <div className="flex items-center justify-between gap-1.5 pl-1">
                  <Link
                    to={`/p/${z.recipientPubkey}`}
                    className="flex items-center gap-1 min-w-0 text-[10px] text-[#9a9890] hover:text-white transition"
                    title={`Zapped ${recipientName}`}
                  >
                    <ArrowRight className="w-2.5 h-2.5 text-[#f59f00]/70 shrink-0" />
                    <span className="truncate">{recipientName}</span>
                  </Link>

                  {z.targetLiveNaddr ? (
                    <Link
                      to={`/live/${z.targetLiveNaddr}`}
                      className="px-1.5 py-0.5 rounded bg-red-600/20 hover:bg-red-600/35 border border-red-500/35 text-[9px] font-semibold text-red-300 flex items-center gap-0.5 shrink-0"
                    >
                      <Radio className="w-2.5 h-2.5" />
                      stream
                    </Link>
                  ) : z.targetEventId ? (
                    <Link
                      to={`/e/${z.targetEventId}`}
                      className="px-1.5 py-0.5 rounded bg-[#1d1f2a] hover:bg-[#2a2d3d] text-[9px] font-medium text-[#b8b5ad] hover:text-white shrink-0"
                    >
                      note
                    </Link>
                  ) : null}
                </div>

                {/* Row 3: Optional zap comment */}
                {z.comment && (
                  <p className="text-[10px] text-[#b8b5ad] leading-snug line-clamp-2 break-words pl-1">
                    {z.comment}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="text-[9px] text-[#6f6d66] flex items-center justify-between px-0.5">
        <span>Past hour · NIP-57 receipts</span>
        <span>Relay direct</span>
      </div>
    </div>
  )
}
