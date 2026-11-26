import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Radio, Zap } from 'lucide-react'
import { parseNoteContent } from '../lib/nostr/content'
import { LIVE_DISCOVERY_RELAYS } from '../lib/nostr/nip53'
import { nostrPool } from '../lib/nostr/pool'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import {
  computeLiveZapsStats,
  parseLiveZapReceipt,
  type LiveZapItem,
} from '../lib/nostr/zapsFeed'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { AddToListButton } from './AddToListButton'
import { Avatar } from './Avatar'

const MAX_LIVE_ZAPS = 600
const MAX_VISIBLE_ROWS = 60
const PERIOD_OPTIONS = [1, 8, 24] as const
type PeriodHours = (typeof PERIOD_OPTIONS)[number]
const PERIOD_QUERY_LIMIT: Record<PeriodHours, number> = { 1: 150, 8: 400, 24: 600 }

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

const BLOSSOM_HEX_URL_RE = /^https:\/\/[^/]+(?:\/[^/?#]+)*\/[0-9a-f]{64}(?:[?#].*)?$/i

function ZapCommentThumb({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#ff8a3d] hover:underline break-all"
      >
        {url.replace(/^https?:\/\//, '').slice(0, 48)}
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-[6] block mt-1"
    >
      <img
        src={url}
        alt="Zap media"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="rounded-md max-h-20 max-w-full object-contain border border-[#222532] bg-[#0b0b0e]"
      />
    </a>
  )
}

function ZapCommentBody({ comment }: { comment: string }) {
  const parsed = useMemo(() => parseNoteContent({ content: comment, tags: [] }), [comment])
  const mediaUrls = useMemo(() => new Set(parsed.media.map((m) => m.url)), [parsed.media])
  const firstImg = parsed.media.find((m) => m.kind === 'image')?.url

  return (
    <div className="text-[10px] text-[#b8b5ad] leading-snug break-words pl-1 space-y-1">
      <div className="line-clamp-2">
        {parsed.segments.map((seg, idx) => {
          if (seg.type === 'text') return <span key={idx}>{seg.text}</span>
          if (seg.type === 'link') {
            const pub = sanitizePublicHttpsUrl(seg.url)
            if (pub && mediaUrls.has(pub)) return null
            if (pub && BLOSSOM_HEX_URL_RE.test(pub)) {
              return <ZapCommentThumb key={idx} url={pub} />
            }
            return (
              <a
                key={idx}
                href={seg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#ff8a3d] hover:underline break-all"
              >
                {seg.display}
              </a>
            )
          }
          if (seg.type === 'hashtag') return <span key={idx} className="text-[#f59f00]">#{seg.tag}</span>
          return null
        })}
      </div>
      {firstImg && <ZapCommentThumb url={firstImg} />}
      {parsed.youtube.map((yt) => (
        <a
          key={yt.videoId}
          href={yt.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/35 text-[9px] font-medium text-red-300 hover:bg-red-500/25"
        >
          YouTube · {yt.videoId}
        </a>
      ))}
    </div>
  )
}

export function LiveZapsCard({ compact = false }: { compact?: boolean }) {
  const profiles = useNostrStore((s) => s.profiles)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)

  const [rawZaps, setRawZaps] = useState<LiveZapItem[]>([])
  const [loading, setLoading] = useState(true)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [periodHours, setPeriodHours] = useState<PeriodHours>(1)
  const [circuitActive, setCircuitActive] = useState(false)
  const [latestPulsedId, setLatestPulsedId] = useState<string | null>(null)
  const circuitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setRawZaps([])
    setLoading(true)
    const relays = [
      ...new Set([
        ...LIVE_DISCOVERY_RELAYS,
        ...useSettingsStore.getState().getReadRelays(),
      ]),
    ].slice(0, 6)
    const startSec = Math.floor(Date.now() / 1000)
    const since = startSec - periodHours * 3600
    const seenIds = new Set<string>()
    const profileQueue = new Set<string>()
    let profileTimer: ReturnType<typeof setTimeout> | null = null
    let eoseReached = false
    let active = true

    const triggerYellowCircuit = (zapId: string) => {
      if (!active) return
      setCircuitActive(true)
      setLatestPulsedId(zapId)
      if (circuitTimerRef.current) clearTimeout(circuitTimerRef.current)
      circuitTimerRef.current = setTimeout(() => {
        circuitTimerRef.current = null
        setCircuitActive(false)
        setLatestPulsedId(null)
      }, 2800)
    }

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
      if (active) {
        eoseReached = true
        setLoading(false)
      }
    }, 3500)

    const sub = nostrPool.subscribe(
      relays,
      { kinds: [9735], since, limit: PERIOD_QUERY_LIMIT[periodHours] },
      {
        onevent: (ev) => {
          if (!active || seenIds.has(ev.id)) return
          seenIds.add(ev.id)
          const parsed = parseLiveZapReceipt(ev)
          if (!parsed) return
          queueProfiles([parsed.senderPubkey, parsed.recipientPubkey])
          setLoading(false)
          if (eoseReached || parsed.createdAt >= startSec - 5) {
            const st = useSettingsStore.getState()
            const isMutedZap =
              st.mutedPubkeys.includes(parsed.senderPubkey) ||
              st.privateMutedPubkeys.includes(parsed.senderPubkey) ||
              st.mutedPubkeys.includes(parsed.recipientPubkey) ||
              st.privateMutedPubkeys.includes(parsed.recipientPubkey)
            if (!isMutedZap) {
              triggerYellowCircuit(parsed.id)
              if (parsed.sats > 100 && typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('fw-big-zap', {
                    detail: { id: parsed.id, sats: parsed.sats },
                  }),
                )
              }
            }
          }
          setRawZaps((prev) => {
            if (prev.some((z) => z.id === parsed.id)) return prev
            return [parsed, ...prev]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, MAX_LIVE_ZAPS)
          })
        },
        oneose: () => {
          if (active) {
            eoseReached = true
            setLoading(false)
          }
        },
      },
    )

    return () => {
      active = false
      clearTimeout(fallbackDone)
      if (profileTimer) clearTimeout(profileTimer)
      if (circuitTimerRef.current) clearTimeout(circuitTimerRef.current)
      sub.close()
    }
  }, [periodHours])

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
    <div className={`fw-zap-circuit ${circuitActive ? 'fw-zap-circuit-active' : ''}`}>
      <div className="fw-zap-circuit-inner p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white flex items-center gap-1.5">
            <Zap
              className={`w-3.5 h-3.5 shrink-0 transition ${
                circuitActive
                  ? 'text-[#ffe066] fill-[#ffe066] scale-110'
                  : 'text-[#f59f00] fill-[#f59f00]/40'
              }`}
            />
            Live Zaps
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wider uppercase flex items-center gap-0.5 transition-all duration-200 ${
                circuitActive
                  ? 'bg-[#ffd43b]/25 border-[#ffe066]/80 text-[#ffe066] shadow-[0_0_10px_rgba(255,212,59,0.55)]'
                  : 'bg-[#1b1d26] border-[#2b2e3d] text-[#6f6d66]'
              }`}
            >
              <Zap
                className={`w-2.5 h-2.5 transition ${
                  circuitActive ? 'text-[#ffe066] fill-[#ffe066]' : 'text-[#6f6d66]'
                }`}
              />
              ZAP
            </span>
          </div>
        </div>

      {/* Total-zaps period selector (active = green) */}
      <div
        role="group"
        aria-label="Live zaps period"
        className="flex items-center gap-1"
      >
        {PERIOD_OPTIONS.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={periodHours === h}
            onClick={() => setPeriodHours(h)}
            className={`flex-1 py-0.5 rounded-md border text-[10px] font-semibold tabular-nums transition cursor-pointer ${
              periodHours === h
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-transparent border-[#262938] text-[#7c7a72] hover:text-[#d4d2cb] hover:border-[#3b4057]'
            }`}
          >
            {h}hr
          </button>
        ))}
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
          {visibleZaps.slice(0, MAX_VISIBLE_ROWS).map((z) => {
            const senderProf = profiles[z.senderPubkey]
            const recipientProf = profiles[z.recipientPubkey]
            const senderName =
              senderProf?.display_name || senderProf?.name || `${z.senderPubkey.slice(0, 7)}…`
            const recipientName =
              recipientProf?.display_name ||
              recipientProf?.name ||
              `${z.recipientPubkey.slice(0, 7)}…`
            const isBigZap = z.sats >= 1000
            const isFreshHit = latestPulsedId === z.id

            return (
              <div
                key={z.id}
                className={`group/zap px-2 py-1.5 rounded-xl border transition space-y-1 ${
                  isFreshHit
                    ? 'bg-[#ffe066]/15 border-[#ffe066]/65'
                    : isBigZap
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
                    <AddToListButton
                      pubkey={z.senderPubkey}
                      displayName={senderName}
                      variant="icon"
                      className="opacity-0 group-hover/zap:opacity-100 focus-within:opacity-100"
                    />
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
                {z.comment && <ZapCommentBody comment={z.comment} />}
              </div>
            )
          })}
        </div>
      )}

        <div className="text-[9px] text-[#6f6d66] flex items-center justify-between px-0.5">
          <span>Past {periodHours === 1 ? 'hour' : `${periodHours} hours`} · NIP-57 receipts</span>
          <span>Relay direct</span>
        </div>
      </div>
    </div>
  )
}
