import { useEffect, useMemo, useState } from 'react'
import { Columns2, Loader2, Radio, Search, X } from 'lucide-react'
import {
  buildLiveATag,
  decodeLiveNaddr,
  encodeLiveNaddr,
  getStreamPrimaryPubkey,
  isLiveStreamFresh,
  isStreamFollowed,
  sortLiveStreams,
  type LiveActivity,
} from '../lib/nostr/nip53'
import { useLiveStore, type LiveStreamEntry } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

export interface WatchWithSelection {
  hostPubkey: string
  dTag: string
  relays: string[]
  naddr: string
  activity?: LiveActivity | null
}

interface WatchWithModalProps {
  primaryATag: string
  currentCompanionATag?: string | null
  onSelect: (selection: WatchWithSelection) => void
  onClearCompanion?: () => void
  onClose: () => void
}

function extractNaddrFromInput(raw: string): string | null {
  const m = /(naddr1[0-9a-z]+)/i.exec(raw.trim())
  return m ? m[1] : null
}

export function WatchWithModal({
  primaryATag,
  currentCompanionATag,
  onSelect,
  onClearCompanion,
  onClose,
}: WatchWithModalProps) {
  const liveStreams = useLiveStore((s) => s.liveStreams)
  const followerCounts = useLiveStore((s) => s.streamerFollowerCounts)
  const fetchLiveActivityOnce = useLiveStore((s) => s.fetchLiveActivityOnce)
  const follows = useNostrStore((s) => s.follows)
  const profiles = useNostrStore((s) => s.profiles)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)

  const [query, setQuery] = useState('')
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const followSet = useMemo(() => new Set(follows.map((p) => p.toLowerCase())), [follows])

  const candidates = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    const cleanQ = query.trim().toLowerCase()
    const list = Object.values(liveStreams).filter((s) => {
      if (s.aTagValue === primaryATag) return false
      if (!isLiveStreamFresh(s, nowSec)) return false
      const pk = getStreamPrimaryPubkey(s.activity)
      if (mutedPubkeys.includes(pk) || mutedPubkeys.includes(s.activity.hostPubkey)) return false
      if (!cleanQ) return true
      const prof = profiles[pk]
      const hay = [
        s.activity.title,
        s.activity.summary,
        prof?.display_name,
        prof?.name,
        s.activity.dTag,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(cleanQ)
    })
    return sortLiveStreams(list, followSet, followerCounts)
  }, [liveStreams, primaryATag, mutedPubkeys, query, profiles, followSet, followerCounts])

  const pastedNaddr = useMemo(() => extractNaddrFromInput(query), [query])

  const handleSelectEntry = (entry: LiveStreamEntry) => {
    const addr = encodeLiveNaddr(
      entry.activity.hostPubkey,
      entry.activity.dTag,
      entry.activity.relayHints,
    )
    onSelect({
      hostPubkey: entry.activity.hostPubkey,
      dTag: entry.activity.dTag,
      relays: entry.activity.relayHints,
      naddr: addr,
      activity: entry.activity,
    })
    onClose()
  }

  const handleOpenPastedNaddr = async () => {
    if (!pastedNaddr || resolving) return
    const decoded = decodeLiveNaddr(pastedNaddr)
    if (!decoded) {
      setError('That link does not contain a valid NIP-53 live stream naddr.')
      return
    }
    const aTag = buildLiveATag(decoded.hostPubkey, decoded.dTag)
    if (aTag === primaryATag) {
      setError('Pick a different stream to watch side-by-side.')
      return
    }
    setError(null)
    setResolving(true)
    try {
      const activity = await fetchLiveActivityOnce(decoded.hostPubkey, decoded.dTag, decoded.relays)
      onSelect({
        hostPubkey: decoded.hostPubkey,
        dTag: decoded.dTag,
        relays: activity?.relayHints?.length ? activity.relayHints : decoded.relays,
        naddr: pastedNaddr,
        activity,
      })
      onClose()
    } finally {
      setResolving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Watch With — select second live stream"
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[#12131a] border border-[#2a2d3d] shadow-2xl shadow-black/70 overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#20222c] bg-[#15161f] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-lg ember-gradient flex items-center justify-center text-white shrink-0">
              <Columns2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white leading-tight truncate">
                Watch With — Split Stream
              </h2>
              <p className="text-[11px] text-[#8c8a82] truncate">
                Watch 2 streams side-by-side · 1 active audio at a time, switch chats freely
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Watch With picker"
            className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search / Paste naddr bar */}
        <div className="p-3 border-b border-[#20222c] space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-[#7c7a72] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pastedNaddr) {
                    e.preventDefault()
                    void handleOpenPastedNaddr()
                  }
                }}
                placeholder="Search live streams or paste a stream URL / naddr1…"
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#0e0e11] border border-[#262938] focus:border-[#e8590c] text-xs text-white placeholder-[#6c6a63] focus:outline-none"
                autoFocus
              />
            </div>
            {pastedNaddr && (
              <button
                type="button"
                disabled={resolving}
                onClick={() => void handleOpenPastedNaddr()}
                className="px-3 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Columns2 className="w-3.5 h-3.5" />}
                Add Stream
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Live Stream Candidates */}
        <div className="p-3 overflow-y-auto flex-1">
          {candidates.length === 0 ? (
            <div className="py-10 text-center space-y-1.5">
              <p className="text-xs font-medium text-[#b8b5ad]">
                {query.trim()
                  ? 'No matching live streams found.'
                  : 'No other live streams detected right now.'}
              </p>
              <p className="text-[11px] text-[#7c7a72]">
                You can also paste any Fire Wisp, zap.stream, or nostr:naddr1… stream link above.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {candidates.map((entry) => {
                const pk = getStreamPrimaryPubkey(entry.activity)
                const prof = profiles[pk]
                const hostName = prof?.display_name || prof?.name || `${pk.slice(0, 8)}…`
                const title = entry.activity.title || `${hostName}'s stream`
                const isSelected = currentCompanionATag === entry.aTagValue
                const isFollowed = isStreamFollowed(entry.activity, followSet)

                return (
                  <button
                    key={entry.aTagValue}
                    type="button"
                    onClick={() => handleSelectEntry(entry)}
                    className={`text-left rounded-xl overflow-hidden border transition cursor-pointer group flex flex-col bg-[#161820] hover:bg-[#1c1f2b] ${
                      isSelected
                        ? 'border-[#e8590c] ring-1 ring-[#e8590c]/50'
                        : isFollowed
                          ? 'border-emerald-500/40 hover:border-emerald-400'
                          : 'border-[#262938] hover:border-[#e8590c]/60'
                    }`}
                  >
                    <div className="relative aspect-video w-full bg-gradient-to-br from-[#2a150c] via-[#1a1826] to-[#11131a] overflow-hidden">
                      {entry.activity.image ? (
                        <img
                          src={entry.activity.image}
                          alt={title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-80">
                          <Avatar src={prof?.picture} pubkey={pk} name={hostName} size="md" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />
                      <div className="absolute top-2 left-2 flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-red-600/95 text-white text-[9px] font-bold uppercase flex items-center gap-1">
                          <Radio className="w-2.5 h-2.5 animate-pulse" />
                          LIVE
                        </span>
                        {isSelected && (
                          <span className="px-1.5 py-0.5 rounded bg-[#e8590c] text-white text-[9px] font-bold uppercase">
                            Active
                          </span>
                        )}
                      </div>
                      {entry.activity.currentParticipants !== undefined &&
                        entry.activity.currentParticipants > 0 && (
                          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] text-[#ece9e1]">
                            {entry.activity.currentParticipants.toLocaleString()} watching
                          </span>
                        )}
                    </div>
                    <div className="p-2 flex items-center gap-2 min-w-0">
                      <Avatar src={prof?.picture} pubkey={pk} name={hostName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white group-hover:text-[#ff922b] truncate leading-tight transition">
                          {title}
                        </div>
                        <div className="text-[11px] text-[#8c8a82] truncate leading-tight mt-0.5">
                          {hostName}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#20222c] bg-[#15161f] flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#8c8a82]">
            {candidates.length} {candidates.length === 1 ? 'stream' : 'streams'} available
          </span>
          <div className="flex items-center gap-2">
            {currentCompanionATag && onClearCompanion && (
              <button
                type="button"
                onClick={() => {
                  onClearCompanion()
                  onClose()
                }}
                className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/35 text-xs font-semibold text-red-300 cursor-pointer"
              >
                Exit Split View
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium text-[#d4d2cb] cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
