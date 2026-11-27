import { memo, useEffect, useMemo } from 'react'
import { ShieldCheck } from 'lucide-react'
import { evaluateWotStatus } from '../lib/nostr/wot'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { useWotStore } from '../lib/store/useWotStore'

interface WotBadgeProps {
  pubkey: string
  compact?: boolean
  showFollowing?: boolean
}

export const WotBadge = memo(function WotBadge({
  pubkey,
  compact = false,
  showFollowing = false,
}: WotBadgeProps) {
  const myPubkey = useAuthStore((s) => s.pubkey)
  const follows = useNostrStore((s) => s.follows)
  const profiles = useNostrStore((s) => s.profiles)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)

  const wotEntries = useWotStore((s) => s.entries)
  const nip85Scores = useWotStore((s) => s.nip85Scores)
  const fetchNip85Scores = useWotStore((s) => s.fetchNip85Scores)

  const wotMinVouches = useSettingsStore((s) => s.wotMinVouches)
  const nip85Enabled = useSettingsStore((s) => s.nip85Enabled)
  const nip85ProviderPubkey = useSettingsStore((s) => s.nip85ProviderPubkey)
  const nip85RelayUrl = useSettingsStore((s) => s.nip85RelayUrl)
  const nip85MinRank = useSettingsStore((s) => s.nip85MinRank)

  const cleanPk = pubkey.trim().toLowerCase()
  const followSet = useMemo(() => new Set(follows.map((p) => p.toLowerCase())), [follows])

  const status = useMemo(
    () =>
      evaluateWotStatus({
        targetPubkey: cleanPk,
        myPubkey,
        followsSet: followSet,
        entries: wotEntries,
        minVouches: wotMinVouches,
        nip85Scores: nip85Enabled ? nip85Scores : undefined,
        nip85MinRank,
      }),
    [cleanPk, myPubkey, followSet, wotEntries, wotMinVouches, nip85Enabled, nip85Scores, nip85MinRank],
  )

  // Lazy-fetch missing mutual voucher profiles and opt-in NIP-85 rank
  useEffect(() => {
    if (!myPubkey) return
    const missing = status.by.filter((pk) => !profiles[pk])
    if (missing.length > 0) void fetchProfiles(missing)
    if (nip85Enabled && nip85ProviderPubkey && nip85RelayUrl && status.nip85Rank === undefined) {
      fetchNip85Scores([cleanPk])
    }
  }, [
    myPubkey,
    cleanPk,
    status.by,
    status.nip85Rank,
    profiles,
    fetchProfiles,
    nip85Enabled,
    nip85ProviderPubkey,
    nip85RelayUrl,
    fetchNip85Scores,
  ])

  if (!myPubkey || status.hop === 0) return null

  if (status.hop === 1) {
    if (!showFollowing && status.nip85Rank === undefined) return null
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-500/12 border border-emerald-500/30 text-emerald-300 shrink-0">
        <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
        {showFollowing ? 'Following' : `WoT ${status.nip85Rank}`}
      </span>
    )
  }

  if (status.hop === 2 && status.vouches > 0) {
    const names = status.by
      .slice(0, compact ? 1 : 2)
      .map((pk) => profiles[pk]?.display_name || profiles[pk]?.name || `${pk.slice(0, 6)}…`)
    const rest = Math.max(0, status.vouches - names.length)
    const text =
      names.length > 0
        ? `Followed by ${names.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
        : `Followed by ${status.vouches} ${status.vouches === 1 ? 'follow' : 'follows'}`
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border shrink-0 max-w-full truncate ${
          compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
        } ${
          status.trusted
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300/90'
            : 'bg-[#1a1c26] border-[#2a2d3a] text-[#9a9890]'
        }`}
        title={
          status.nip85Rank !== undefined
            ? `${text} · NIP-85 rank ${status.nip85Rank}`
            : text
        }
      >
        <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
        <span className="truncate">{text}</span>
        {status.nip85Rank !== undefined && (
          <span className="text-[#f59f00] font-semibold">· {status.nip85Rank}</span>
        )}
      </span>
    )
  }

  if (status.nip85Rank !== undefined && nip85Enabled) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border shrink-0 ${
          compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
        } ${
          status.trusted
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
            : 'bg-[#1a1c26] border-[#2a2d3a] text-[#9a9890]'
        }`}
      >
        <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
        WoT {status.nip85Rank}
      </span>
    )
  }

  return null
})
