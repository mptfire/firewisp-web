import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import {
  Radio,
  UploadCloud,
  Cpu,
  VolumeX,
  Wallet,
  Shield,
  LayoutGrid,
  ChevronDown,
  Plus,
  Trash2,
  RotateCcw,
  Copy,
  Check,
  ArrowUp,
  Download,
  Loader2,
  Send,
  Smartphone,
  ExternalLink,
  List,
} from 'lucide-react'
import { ANDROID_APP_URL, ZAPSTORE_URL } from '../lib/constants'
import { extractMuteItemsFromTags } from '../lib/nostr/lists'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { parseNwcUri } from '../lib/nostr/nip57'
import { sanitizePublicRelayUrl } from '../lib/sanitize'

function relayHealthRow(st: string | undefined): string {
  if (st === 'connected') return 'bg-emerald-500/10 border-emerald-500/35'
  if (st === 'connecting') return 'bg-amber-500/10 border-amber-500/35'
  return 'bg-red-500/10 border-red-500/30'
}

function SettingsSection({
  id,
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  badge?: ReactNode
  isOpen: boolean
  onToggle: (id: string) => void
  children: ReactNode
}) {
  return (
    <section className="px-4">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={`settings-panel-${id}`}
        onClick={() => onToggle(id)}
        className="w-full py-3.5 flex items-center justify-between gap-3 text-left group cursor-pointer"
      >
        <span className="font-semibold text-sm flex items-center gap-2 text-white group-hover:text-[#ffd43b] transition min-w-0">
          <Icon className="w-4 h-4 text-[#f59f00] shrink-0" />
          <span className="truncate">{title}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {badge}
          <ChevronDown
            className={`w-4 h-4 text-[#8c8a82] transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-[#f59f00]' : 'group-hover:text-white'
            }`}
          />
        </span>
      </button>
      {isOpen && (
        <div id={`settings-panel-${id}`} className="pb-4 space-y-3">
          {children}
        </div>
      )}
    </section>
  )
}

export function SettingsPage() {
  const settings = useSettingsStore()
  const relayStatuses = useNostrStore((s) => s.relayStatuses)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const userWriteRelays = useNostrStore((s) => s.userWriteRelays)
  const profiles = useNostrStore((s) => s.profiles)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const publishRelayList = useNostrStore((s) => s.publishRelayList)
  const publishBlossomList = useNostrStore((s) => s.publishBlossomList)
  const syncMuteList = useNostrStore((s) => s.syncMuteList)
  const unblockPubkey = useNostrStore((s) => s.unblockPubkey)
  const muteHashtagGlobal = useNostrStore((s) => s.muteHashtagGlobal)
  const unmuteHashtagGlobal = useNostrStore((s) => s.unmuteHashtagGlobal)
  const muteWordGlobal = useNostrStore((s) => s.muteWordGlobal)
  const unmuteWordGlobal = useNostrStore((s) => s.unmuteWordGlobal)
  const pushLocalMutesToNostr = useNostrStore((s) => s.pushLocalMutesToNostr)
  const rawMuteListEvent = useNostrStore((s) => s.rawMuteListEvent)
  const muteListSyncStatus = useNostrStore((s) => s.muteListSyncStatus)
  const muteListHasRemoteEncrypted = useNostrStore((s) => s.muteListHasRemoteEncrypted)
  const muteListPublishing = useNostrStore((s) => s.muteListPublishing)
  const signer = useAuthStore((s) => s.signer)
  const pubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const hasVault = useAuthStore((s) => s.hasEncryptedVault)
  const exportNcryptsec = useAuthStore((s) => s.exportNcryptsec)
  const clearEncryptedVault = useAuthStore((s) => s.clearEncryptedVault)

  const [newRelay, setNewRelay] = useState('')
  const [newBlossom, setNewBlossom] = useState('')
  const [newMuteTag, setNewMuteTag] = useState('')
  const [newMuteWord, setNewMuteWord] = useState('')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))
  const [mutedUsersOpen, setMutedUsersOpen] = useState(false)
  const [privateMutedUsersOpen, setPrivateMutedUsersOpen] = useState(false)
  const [mutedTagsOpen, setMutedTagsOpen] = useState(false)
  const [muteSyncMsg, setMuteSyncMsg] = useState<string | null>(null)
  const [nwcInput, setNwcInput] = useState(settings.nwcUri)
  const [nwcStatus, setNwcStatus] = useState<string | null>(null)
  const [publishingRelays, setPublishingRelays] = useState(false)
  const [relayPublishStatus, setRelayPublishStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmRelayDrop, setConfirmRelayDrop] = useState(false)
  const [publishingBlossom, setPublishingBlossom] = useState(false)
  const [blossomPublishStatus, setBlossomPublishStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const syncedNip65Relays = useMemo(
    () => [...new Set([...userReadRelays, ...userWriteRelays])],
    [userReadRelays, userWriteRelays],
  )
  const missingNip65Relays = useMemo(() => {
    const localSet = new Set(
      settings.relays
        .map((r) => sanitizePublicRelayUrl(r.url))
        .filter((u): u is string => Boolean(u)),
    )
    return syncedNip65Relays.filter((url) => {
      const clean = sanitizePublicRelayUrl(url)
      return clean ? !localSet.has(clean) : false
    })
  }, [settings.relays, syncedNip65Relays])

  const localUnsyncedMutesCount = useMemo(() => {
    const pubRemote = extractMuteItemsFromTags(rawMuteListEvent?.tags || [])
    const pubPks = new Set(pubRemote.pubkeys)
    const pubTags = new Set(pubRemote.hashtags)
    const pubWords = new Set(pubRemote.words)
    return (
      settings.mutedPubkeys.filter((p) => !pubPks.has(p)).length +
      settings.mutedHashtags.filter((t) => !pubTags.has(t)).length +
      settings.mutedWords.filter((w) => !pubWords.has(w)).length
    )
  }, [rawMuteListEvent, settings.mutedPubkeys, settings.mutedHashtags, settings.mutedWords])

  const totalPrivateMutesCount =
    settings.privateMutedPubkeys.length +
    settings.privateMutedHashtags.length +
    settings.privateMutedWords.length

  const enabledFeedOptionsCount = [
    settings.showLiveNowBar,
    settings.showBookmarksNav,
    settings.showLiveZaps,
    settings.showGlobalAudio,
    settings.showWisps,
    settings.mobileDataSaving,
    settings.hoverStreamPreview,
    settings.inlineMediaPlayback,
    settings.showFireWispTab,
    settings.showExtendedTab,
    settings.showExploreTab,
  ].filter(Boolean).length

  const totalMutedWords = settings.mutedWords.length + settings.privateMutedWords.length
  const totalMutedTags = settings.mutedHashtags.length + settings.privateMutedHashtags.length
  const totalMutedUsers = settings.mutedPubkeys.length + settings.privateMutedPubkeys.length
  const totalMutedAll = totalMutedWords + totalMutedTags + totalMutedUsers

  useEffect(() => {
    setNwcInput(settings.nwcUri)
  }, [settings.nwcUri])

  const [exportPass, setExportPass] = useState('')
  const [exported, setExported] = useState<string | null>(null)
  const [exportErr, setExportErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (mutedUsersOpen && settings.mutedPubkeys.length > 0) {
      void fetchProfiles(settings.mutedPubkeys)
    }
  }, [mutedUsersOpen, settings.mutedPubkeys, fetchProfiles])

  useEffect(() => {
    if (privateMutedUsersOpen && settings.privateMutedPubkeys.length > 0) {
      void fetchProfiles(settings.privateMutedPubkeys.slice(0, 80))
    }
  }, [privateMutedUsersOpen, settings.privateMutedPubkeys, fetchProfiles])

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="px-4 py-3.5 flex items-center justify-between gap-2">
        <div>
          <h1 className="font-bold text-lg">Settings</h1>
          <p className="text-xs text-[#8c8a82]">
            All preferences stay strictly in your browser. Zero telemetry.
          </p>
        </div>
        {pubkey && (
          <Link
            to="/lists"
            className="px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-xs font-semibold text-purple-200 flex items-center gap-1.5 shrink-0 transition"
          >
            <List className="w-3.5 h-3.5" />
            Lists
          </Link>
        )}
      </div>

      {/* Optional Feed Tabs */}
      <SettingsSection
        id="feed-tabs"
        title="Feed Tabs"
        icon={LayoutGrid}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            {enabledFeedOptionsCount} active
          </span>
        }
        isOpen={Boolean(openSections['feed-tabs'])}
        onToggle={toggleSection}
      >
        <p className="text-xs text-[#8c8a82]">
          For You, Follows, and your selected sidebar feed (Trending / Extended / Explore / Wisp Relay) are always shown. Enable extra tabs below to pin multiple at once.
        </p>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Live Now streaming bar</div>
            <div className="text-[#8c8a82]">
              Displays active NIP-53 Nostr live streams at the top of your feed. Use the arrow on the bar to switch between compact and full cards.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showLiveNowBar}
            onChange={(e) => settings.setShowLiveNowBar(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Bookmarks in menu</div>
            <div className="text-[#8c8a82]">
              Shows the Bookmarks page in the navigation menu (you can still bookmark notes anytime).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showBookmarksNav}
            onChange={(e) => settings.setShowBookmarksNav(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Live Zaps feed</div>
            <div className="text-[#8c8a82]">
              Displays the live NIP-57 zap scoreboard in the sidebar across feeds &amp; threads (swaps with stream Top Zappers on live streams).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showLiveZaps}
            onChange={(e) => settings.setShowLiveZaps(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Global Audio deck</div>
            <div className="text-[#8c8a82]">
              Displays the persistent Global Audio volume slider (0–200% boost) and live 16-band graphic equalizer in the sidebar.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showGlobalAudio}
            onChange={(e) => settings.setShowGlobalAudio(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show animated Fire Wisps</div>
            <div className="text-[#8c8a82]">
              Displays the roaming orange Fire Wisp sprite and unread notification/feed flame wisps.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showWisps}
            onChange={(e) => settings.setShowWisps(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Mobile Data Saving mode</div>
            <div className="text-[#8c8a82]">
              Caps multi-bitrate live streams to ≤ 480p (~1.5 Mbps), starts on lowest quality, trims stream pre-buffering, and pauses hover previews to cut bandwidth.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.mobileDataSaving}
            onChange={(e) => settings.setMobileDataSaving(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Hover to preview live streams</div>
            <div className="text-[#8c8a82]">
              Plays a muted live preview when hovering over stream cards (connects directly to the stream host on hover).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.hoverStreamPreview}
            onChange={(e) => settings.setHoverStreamPreview(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Play streams &amp; YouTube inline</div>
            <div className="text-[#8c8a82]">
              Plays streams and YouTube embeds right inside notes when clicked (Out opens the full player / new tab).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.inlineMediaPlayback}
            onChange={(e) => settings.setInlineMediaPlayback(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Fire Wisp relay tab</div>
            <div className="text-[#8c8a82]">
              Dedicated feed for wss://relay.firewisp.de (12-bit PoW community relay).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showFireWispTab}
            onChange={(e) => settings.setShowFireWispTab(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Extended (2-hop WoT) tab</div>
            <div className="text-[#8c8a82]">
              Posts from accounts endorsed by your follows (friends-of-friends).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showExtendedTab}
            onChange={(e) => settings.setShowExtendedTab(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Explore tab</div>
            <div className="text-[#8c8a82]">
              Curated global Nostr discovery feed with anti-spam filtering.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.showExploreTab}
            onChange={(e) => settings.setShowExploreTab(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>
      </SettingsSection>

      {/* Relays */}
      <SettingsSection
        id="relays"
        title="Nostr Relays"
        icon={Radio}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            {settings.relays.length} relays
          </span>
        }
        isOpen={Boolean(openSections['relays'])}
        onToggle={toggleSection}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={settings.resetRelays}
            className="text-xs text-[#9a9890] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reset defaults
          </button>
        </div>

        <div className="space-y-1.5">
          {settings.relays.map((r) => {
            const st = relayStatuses[r.url]
            const dot =
              st === 'connected'
                ? 'bg-emerald-400'
                : st === 'connecting'
                  ? 'bg-amber-400'
                  : 'bg-[#4b4d5a]'
            return (
              <div
                key={r.url}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${relayHealthRow(st)}`}
                title={st === 'connected' ? 'Connected' : st === 'connecting' ? 'Connecting…' : 'Offline / unreachable'}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                  <span className="font-mono truncate">{r.url}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => settings.toggleRelayMode(r.url, 'read')}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                      r.read ? 'bg-[#e8590c]/20 text-[#ff922b]' : 'bg-[#20222c] text-[#7c7a72]'
                    }`}
                  >
                    R
                  </button>
                  <button
                    onClick={() => settings.toggleRelayMode(r.url, 'write')}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                      r.write ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[#20222c] text-[#7c7a72]'
                    }`}
                  >
                    W
                  </button>
                  <button
                    onClick={() => settings.removeRelay(r.url)}
                    className="p-1 text-[#7c7a72] hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (settings.addRelay(newRelay)) {
              setNewRelay('')
              setConfirmRelayDrop(false)
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={newRelay}
            onChange={(e) => setNewRelay(e.target.value)}
            placeholder="wss://relay.example.com"
            className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs font-mono focus:outline-none focus:border-[#e8590c]"
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </form>

        {/* Publish NIP-65 Relay List (kind 10002) */}
        <div className="pt-1 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-[#8c8a82]">
              Broadcast your relay list to Nostr so all clients sync your Read/Write relays (NIP-65).
            </span>
            <button
              type="button"
              disabled={publishingRelays}
              onClick={async () => {
                if (!signer?.canSign) {
                  openAuthModal()
                  return
                }
                if (missingNip65Relays.length > 0 && !confirmRelayDrop) {
                  setConfirmRelayDrop(true)
                  return
                }
                setConfirmRelayDrop(false)
                setRelayPublishStatus(null)
                setPublishingRelays(true)
                try {
                  const res = await publishRelayList(settings.relays)
                  setRelayPublishStatus({
                    ok: true,
                    text: `Published ${res.publishedCount} relays (kind 10002) to ${res.okCount}/${res.totalRelays} relays.`,
                  })
                } catch (err) {
                  setRelayPublishStatus({
                    ok: false,
                    text: err instanceof Error ? err.message : 'Failed to publish relay list',
                  })
                } finally {
                  setPublishingRelays(false)
                }
              }}
              className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              {publishingRelays ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {publishingRelays
                ? 'Publishing…'
                : confirmRelayDrop
                  ? 'Confirm Replace NIP-65'
                  : 'Publish to Nostr (kind 10002)'}
            </button>
          </div>

          {confirmRelayDrop && missingNip65Relays.length > 0 && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/35 text-xs text-amber-200 flex items-center justify-between gap-2 flex-wrap">
              <span>
                Your current Nostr NIP-65 list has {missingNip65Relays.length} extra{' '}
                {missingNip65Relays.length === 1 ? 'relay' : 'relays'} not in the editor above. Load them first or click Confirm to replace.
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    settings.importRelays(
                      syncedNip65Relays.map((url) => ({
                        url,
                        read: userReadRelays.includes(url),
                        write: userWriteRelays.includes(url),
                      })),
                    )
                    setConfirmRelayDrop(false)
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 font-semibold cursor-pointer"
                >
                  Load NIP-65 first
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRelayDrop(false)}
                  className="px-2 py-1 rounded-lg bg-[#1d1f29] text-[#c2bfb7] hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {relayPublishStatus && (
            <p
              className={`text-xs ${
                relayPublishStatus.ok ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {relayPublishStatus.text}
            </p>
          )}
        </div>

        {syncedNip65Relays.length > 0 && (
          <div className="pt-2 space-y-1.5">
            <div className="text-[11px] font-medium text-[#9a9890] flex items-center justify-between gap-2 flex-wrap">
              <span>Synced from your Nostr NIP-65 list (kind 10002)</span>
              <div className="flex items-center gap-2">
                {missingNip65Relays.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      settings.importRelays(
                        syncedNip65Relays.map((url) => ({
                          url,
                          read: userReadRelays.includes(url),
                          write: userWriteRelays.includes(url),
                        })),
                      )
                      setConfirmRelayDrop(false)
                    }}
                    className="px-2 py-0.5 rounded-lg bg-[#1b1d27] hover:bg-[#252838] border border-[#2d3042] text-[10px] font-semibold text-[#ff922b] flex items-center gap-1 cursor-pointer"
                    title="Copy your published NIP-65 relays into the editable list above"
                  >
                    <Download className="w-3 h-3" />
                    Load into editor ({missingNip65Relays.length})
                  </button>
                )}
                <span className="text-[10px] text-[#6f6d66]">
                  {syncedNip65Relays.length} relays
                </span>
              </div>
            </div>
            {syncedNip65Relays.map((url) => {
              const st = relayStatuses[url]
              const dot =
                st === 'connected'
                  ? 'bg-emerald-400'
                  : st === 'connecting'
                    ? 'bg-amber-400'
                    : 'bg-[#4b4d5a]'
              const isR = userReadRelays.includes(url)
              const isW = userWriteRelays.includes(url)
              return (
                <div
                  key={url}
                  className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-xs ${relayHealthRow(st)}`}
                  title={st === 'connected' ? 'Connected' : st === 'connecting' ? 'Connecting…' : 'Offline / unreachable'}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <span className="font-mono truncate text-[#d4d2cb]">{url}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isR && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#e8590c]/15 text-[#ff922b]">
                        R
                      </span>
                    )}
                    {isW && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-300">
                        W
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingsSection>

      {/* Blossom media servers */}
      <SettingsSection
        id="blossom"
        title="Blossom Media Servers"
        icon={UploadCloud}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            {settings.blossomServers.length} servers
          </span>
        }
        isOpen={Boolean(openSections['blossom'])}
        onToggle={toggleSection}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8c8a82]">BUD-03 (kind 10063)</span>
        </div>
        <div className="space-y-1.5">
          {settings.blossomServers.map((url, idx) => (
            <div
              key={url}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#15161c] border border-[#232530] text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono truncate">{url}</span>
                {idx === 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-emerald-500/15 text-emerald-300 shrink-0">
                    Primary
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => settings.setPrimaryBlossomServer(url)}
                    title="Move to top as primary Blossom server"
                    className="px-2 py-1 rounded-lg bg-[#1d1f29] hover:bg-[#262936] text-[10px] font-medium text-[#d4d2cb] hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <ArrowUp className="w-3 h-3 text-[#f59f00]" />
                    Primary
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => settings.removeBlossomServer(url)}
                  title="Remove Blossom server"
                  aria-label={`Remove Blossom server ${url}`}
                  className="p-1 text-[#7c7a72] hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (settings.addBlossomServer(newBlossom)) setNewBlossom('')
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={newBlossom}
            onChange={(e) => setNewBlossom(e.target.value)}
            placeholder="https://blossom.example.com"
            className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs font-mono focus:outline-none focus:border-[#e8590c]"
          />
          <button
            type="submit"
            className="px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </form>

        {/* Publish BUD-03 Blossom Server List (kind 10063) */}
        <div className="pt-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-[#8c8a82]">
              Save this server order to Nostr so Fire Wisp Web, Android, and other clients use it automatically.
            </span>
            <button
              type="button"
              disabled={publishingBlossom || settings.blossomServers.length === 0}
              onClick={async () => {
                if (!signer?.canSign) {
                  openAuthModal()
                  return
                }
                setBlossomPublishStatus(null)
                setPublishingBlossom(true)
                try {
                  const res = await publishBlossomList(settings.blossomServers)
                  setBlossomPublishStatus({
                    ok: true,
                    text: `Published ${res.publishedCount} Blossom ${res.publishedCount === 1 ? 'server' : 'servers'} (kind 10063) to ${res.okCount}/${res.totalRelays} relays.`,
                  })
                } catch (err) {
                  setBlossomPublishStatus({
                    ok: false,
                    text: err instanceof Error ? err.message : 'Failed to publish Blossom list',
                  })
                } finally {
                  setPublishingBlossom(false)
                }
              }}
              className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
            >
              {publishingBlossom ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {publishingBlossom ? 'Publishing…' : 'Publish to Nostr (kind 10063)'}
            </button>
          </div>
          {blossomPublishStatus && (
            <p
              className={`text-xs ${
                blossomPublishStatus.ok ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {blossomPublishStatus.text}
            </p>
          )}
        </div>
      </SettingsSection>

      {/* NIP-13 Anti-Spam PoW */}
      <SettingsSection
        id="pow"
        title="NIP-13 Anti-Spam Proof-of-Work"
        icon={Cpu}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            {settings.notePowEnabled ? `${settings.notePowBits}b` : 'Off'} /{' '}
            {settings.reactionPowEnabled ? `${settings.reactionPowBits}b` : 'Off'}
          </span>
        }
        isOpen={Boolean(openSections['pow'])}
        onToggle={toggleSection}
      >
        <p className="text-xs text-[#8c8a82]">
          Fire Wisp Relay requires at least 12 bits of PoW on public posts and reactions. Mining
          runs in a background Web Worker.
        </p>

        <div className="space-y-3 p-3 rounded-xl bg-[#15161c] border border-[#232530]">
          <label className="flex items-center justify-between text-xs">
            <span>Note PoW ({settings.notePowBits} bits)</span>
            <input
              type="checkbox"
              checked={settings.notePowEnabled}
              onChange={(e) => settings.setNotePowEnabled(e.target.checked)}
              className="accent-[#e8590c]"
            />
          </label>
          {settings.notePowEnabled && (
            <input
              type="range"
              min={12}
              max={22}
              value={settings.notePowBits}
              onChange={(e) => settings.setNotePowBits(Number(e.target.value))}
              className="w-full accent-[#e8590c]"
            />
          )}

          <label className="flex items-center justify-between text-xs pt-2 border-t border-[#232530]">
            <span>Reaction PoW ({settings.reactionPowBits} bits)</span>
            <input
              type="checkbox"
              checked={settings.reactionPowEnabled}
              onChange={(e) => settings.setReactionPowEnabled(e.target.checked)}
              className="accent-[#e8590c]"
            />
          </label>
          {settings.reactionPowEnabled && (
            <input
              type="range"
              min={8}
              max={20}
              value={settings.reactionPowBits}
              onChange={(e) => settings.setReactionPowBits(Number(e.target.value))}
              className="w-full accent-[#e8590c]"
            />
          )}
        </div>
      </SettingsSection>

      {/* Lightning NWC */}
      <SettingsSection
        id="wallet"
        title="Lightning Wallet (NWC — NIP-47)"
        icon={Wallet}
        badge={
          settings.nwcUri ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300">
              Connected
            </span>
          ) : (
            <span className="text-[11px] text-[#8c8a82]">Not connected</span>
          )
        }
        isOpen={Boolean(openSections['wallet'])}
        onToggle={toggleSection}
      >
        <p className="text-xs text-[#8c8a82]">
          Connect Alby, Primal, CoinOS, or Zeus for one-click zaps (or use WebLN / QR invoices
          without connecting a wallet). Best practice: use a spending-capped zap budget URI.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={nwcInput}
            onChange={(e) => {
              setNwcInput(e.target.value)
              setNwcStatus(null)
            }}
            autoComplete="off"
            spellCheck={false}
            placeholder="nostr+walletconnect://…"
            className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs font-mono focus:outline-none focus:border-[#e8590c]"
          />
          <button
            type="button"
            onClick={() => {
              if (!nwcInput.trim()) {
                settings.setNwcUri('')
                setNwcStatus('Cleared NWC connection')
                return
              }
              if (!parseNwcUri(nwcInput)) {
                setNwcStatus('Invalid nostr+walletconnect:// URI')
                return
              }
              settings.setNwcUri(nwcInput, settings.nwcRememberDevice)
              setNwcStatus(
                settings.nwcRememberDevice
                  ? 'NWC wallet saved on this device until you remove it'
                  : 'NWC wallet saved for this browser tab session',
              )
            }}
            className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold cursor-pointer"
          >
            Save
          </button>
          {settings.nwcUri && (
            <button
              type="button"
              onClick={() => {
                settings.setNwcUri('')
                setNwcInput('')
                setNwcStatus('Removed NWC wallet')
              }}
              className="px-3 py-2 rounded-xl bg-[#1a1c24] hover:bg-red-500/20 border border-[#2a2d3a] hover:border-red-500/40 text-xs text-red-300 cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>
        <label className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Remember NWC wallet on this device</div>
            <div className="text-[#8c8a82]">
              {settings.nwcRememberDevice
                ? 'Stays saved across refreshes, restarts, and sign-outs until you click Remove.'
                : 'Tab session only — survives page refreshes and sign-outs, clears when you close the tab or click Remove.'}
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.nwcRememberDevice}
            onChange={(e) => settings.setNwcRememberDevice(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>
        {nwcStatus && <p className="text-xs text-[#f59f00]">{nwcStatus}</p>}
      </SettingsSection>

      {/* Muted Words, Hashtags & Users */}
      <SettingsSection
        id="mutes"
        title="Muted Words, Hashtags & Users"
        icon={VolumeX}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            {totalMutedAll > 0
              ? `${totalMutedWords} words · ${totalMutedTags} tags · ${totalMutedUsers} users`
              : 'None'}
          </span>
        }
        isOpen={Boolean(openSections['mutes'])}
        onToggle={toggleSection}
      >
        {pubkey && (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {signer?.canSign && localUnsyncedMutesCount > 0 && (
                <button
                  type="button"
                  disabled={muteListPublishing || muteListSyncStatus === 'syncing'}
                  onClick={async () => {
                    setMuteSyncMsg(null)
                    try {
                      const res = await pushLocalMutesToNostr()
                      if (res.pushedCount === 0) {
                        setMuteSyncMsg('All local mutes are already in your Nostr kind-10000 list.')
                      } else {
                        setMuteSyncMsg(
                          `Encrypted & synced ${res.pushedCount} local ${res.pushedCount === 1 ? 'entry' : 'entries'} to Nostr (${res.okCount}/${res.totalRelays} relays).`,
                        )
                      }
                    } catch (err) {
                      setMuteSyncMsg(
                        err instanceof Error ? err.message : 'Failed to sync local mutes to Nostr',
                      )
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {muteListPublishing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  Sync {localUnsyncedMutesCount} Local → Nostr
                </button>
              )}
              <button
                type="button"
                disabled={muteListSyncStatus === 'syncing' || muteListPublishing}
                onClick={async () => {
                  setMuteSyncMsg(null)
                  const res = await syncMuteList(pubkey)
                  if (res.status === 'locked') {
                    setMuteSyncMsg(
                      'Encrypted Nostr mute list found, but your signer did not decrypt it (approve NIP-44/NIP-04 in your extension or sign in with a signing key).',
                    )
                  } else if (res.status === 'empty') {
                    setMuteSyncMsg('No kind-10000 mute list found on your connected relays.')
                  } else {
                    setMuteSyncMsg(
                      `Synced from Nostr: ${res.privateCount} encrypted private + ${res.publicCount} public muted users.`,
                    )
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-[#1d1f29] hover:bg-[#262936] disabled:opacity-50 border border-[#2a2d3a] text-[11px] font-medium text-[#d4d2cb] hover:text-white flex items-center gap-1.5 cursor-pointer"
              >
                {muteListSyncStatus === 'syncing' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#f59f00]" />
                ) : (
                  <RotateCcw className="w-3 h-3 text-[#f59f00]" />
                )}
                {muteListSyncStatus === 'syncing' ? 'Syncing…' : 'Sync Nostr Mute List'}
              </button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-[#8c8a82]">
          {signer?.canSign
            ? 'Global Nostr sync enabled (NIP-51 kind 10000): blocking users, hashtags, and words/domains automatically encrypts (NIP-44) and syncs across your Nostr clients while preserving all existing entries.'
            : 'Sign in with a signing key to sync blocks, muted hashtags, and muted words globally via encrypted Nostr kind 10000.'}
        </p>
        {muteListSyncStatus === 'locked' && muteListHasRemoteEncrypted && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
            Your Nostr account has an encrypted private mute list (kind 10000) that hasn&apos;t been decrypted yet. Click <strong>Sync Nostr Mute List</strong> and approve decryption in your signer so new blocks merge safely without overwriting it.
          </p>
        )}
        {muteSyncMsg && <p className="text-xs text-[#f59f00]">{muteSyncMsg}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newMuteTag.trim()) {
              void muteHashtagGlobal(newMuteTag)
              setNewMuteTag('')
            }
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={newMuteTag}
            onChange={(e) => setNewMuteTag(e.target.value)}
            placeholder="Mute #hashtag…"
            className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
          />
          <button
            type="submit"
            disabled={muteListPublishing}
            className="px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] disabled:opacity-50 text-xs font-semibold cursor-pointer"
          >
            Mute
          </button>
        </form>
        <div className="space-y-1">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newMuteWord.trim().length >= 2) {
                void muteWordGlobal(newMuteWord)
                setNewMuteWord('')
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={newMuteWord}
              onChange={(e) => setNewMuteWord(e.target.value)}
              placeholder="Mute word or domain… (e.g. evmnest)"
              className="flex-1 px-3 py-2 rounded-xl bg-[#15161c] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
            />
            <button
              type="submit"
              disabled={muteListPublishing || newMuteWord.trim().length < 2}
              className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              Mute word
            </button>
          </form>
          <p className="text-[11px] text-[#8c8a82]">
            Hides matching posts, replies, quotes &amp; live chat across all relays (case-insensitive).
          </p>
        </div>
        {settings.mutedHashtags.length > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-[#232530] overflow-hidden">
            <button
              type="button"
              onClick={() => setMutedTagsOpen((o) => !o)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-medium text-[#d4d2cb] hover:bg-white/[0.03] cursor-pointer"
            >
              <span>Muted hashtags — Local &amp; Public ({settings.mutedHashtags.length})</span>
              <ChevronDown
                className={`w-4 h-4 text-[#8c8a82] transition-transform ${mutedTagsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {mutedTagsOpen && (
              <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5 border-t border-[#20222c] max-h-48 overflow-y-auto">
                {settings.mutedHashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => void unmuteHashtagGlobal(tag)}
                    className="px-2.5 py-1 rounded-full bg-[#1a1c24] border border-[#2d3040] text-xs text-[#d4d2cb] hover:border-red-400 cursor-pointer"
                  >
                    #{tag} ×
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {settings.mutedPubkeys.length > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-[#232530] overflow-hidden">
            <button
              type="button"
              onClick={() => setMutedUsersOpen((o) => !o)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-medium text-[#d4d2cb] hover:bg-white/[0.03] cursor-pointer"
            >
              <span>Blocked / Muted users — Local &amp; Public ({settings.mutedPubkeys.length})</span>
              <ChevronDown
                className={`w-4 h-4 text-[#8c8a82] transition-transform ${mutedUsersOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {mutedUsersOpen && (
              <div className="divide-y divide-[#20222c] border-t border-[#20222c] max-h-64 overflow-y-auto">
                {settings.mutedPubkeys.map((pk) => {
                  const p = profiles[pk]
                  let npub = pk
                  try {
                    npub = nip19.npubEncode(pk)
                  } catch {
                    // keep hex
                  }
                  const label = p?.display_name || p?.name
                  return (
                    <div
                      key={pk}
                      className="flex items-center justify-between gap-2 text-xs px-3 py-2"
                    >
                      <div className="min-w-0">
                        {label && <div className="text-[#f4f1ea] font-medium truncate">{label}</div>}
                        <div className="font-mono text-[11px] text-[#8c8a82] truncate">
                          {npub.slice(0, 26)}…
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void unblockPubkey(pk, label)}
                        className="text-red-400 hover:text-red-300 hover:underline shrink-0 cursor-pointer"
                      >
                        Unblock
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {totalPrivateMutesCount > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-emerald-500/25 overflow-hidden">
            <button
              type="button"
              onClick={() => setPrivateMutedUsersOpen((o) => !o)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-medium text-[#d4d2cb] hover:bg-white/[0.03] cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                Encrypted Private Mutes — Nostr kind-10000 ({totalPrivateMutesCount})
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[#8c8a82] transition-transform ${privateMutedUsersOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {privateMutedUsersOpen && (
              <div className="divide-y divide-[#20222c] border-t border-[#20222c] max-h-72 overflow-y-auto">
                <div className="px-3 py-1.5 text-[11px] text-[#8c8a82] bg-[#111218]">
                  Encrypted with NIP-44 on Nostr (kind 10000) · Decrypted in RAM only (never saved to localStorage). Unblocking syncs across all clients.
                </div>
                {settings.privateMutedHashtags.length > 0 && (
                  <div className="px-3 py-2 space-y-1.5">
                    <div className="text-[11px] text-[#9a9890] font-medium">
                      Private muted hashtags ({settings.privateMutedHashtags.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {settings.privateMutedHashtags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => void unmuteHashtagGlobal(tag)}
                          className="px-2 py-0.5 rounded-full bg-[#1a1c24] border border-emerald-500/25 text-[11px] text-[#d4d2cb] hover:border-red-400 cursor-pointer"
                        >
                          #{tag} ×
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {settings.privateMutedWords.length > 0 && (
                  <div className="px-3 py-2 space-y-1.5">
                    <div className="text-[11px] text-[#9a9890] font-medium">
                      Private muted words ({settings.privateMutedWords.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {settings.privateMutedWords.map((word) => (
                        <button
                          key={word}
                          type="button"
                          onClick={() => void unmuteWordGlobal(word)}
                          className="px-2 py-0.5 rounded-full bg-[#1a1c24] border border-emerald-500/25 text-[11px] text-[#d4d2cb] hover:border-red-400 cursor-pointer"
                        >
                          {word} ×
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {settings.privateMutedPubkeys.map((pk) => {
                  const p = profiles[pk]
                  let npub = pk
                  try {
                    npub = nip19.npubEncode(pk)
                  } catch {
                    // keep hex
                  }
                  const label = p?.display_name || p?.name
                  return (
                    <div
                      key={pk}
                      className="flex items-center justify-between gap-2 text-xs px-3 py-2"
                    >
                      <div className="min-w-0">
                        {label && <div className="text-[#f4f1ea] font-medium truncate">{label}</div>}
                        <div className="font-mono text-[11px] text-[#8c8a82] truncate">
                          {npub.slice(0, 26)}…
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void unblockPubkey(pk, label)}
                        className="text-red-400 hover:text-red-300 hover:underline shrink-0 cursor-pointer"
                      >
                        Unblock
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {settings.mutedWords.length > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-[#232530] p-3 space-y-2">
            <div className="text-xs font-medium text-[#d4d2cb]">
              Muted words ({settings.mutedWords.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {settings.mutedWords.map((word) => (
                <button
                  key={word}
                  type="button"
                  onClick={() => void unmuteWordGlobal(word)}
                  className="px-2.5 py-1 rounded-full bg-[#1a1c24] border border-[#2d3040] text-xs text-[#d4d2cb] hover:border-red-400 cursor-pointer"
                >
                  {word} ×
                </button>
              ))}
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="privacy"
        title="Privacy & Key Backup"
        icon={Shield}
        badge={
          <span className="text-[11px] text-[#8c8a82]">
            Spam filter {settings.spamFilterEnabled ? 'on' : 'off'}
          </span>
        }
        isOpen={Boolean(openSections['privacy'])}
        onToggle={toggleSection}
      >

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Anti-spam filter in Explore</div>
            <div className="text-[#8c8a82]">
              Filters bot floods, invisible-char spam, hashtag/mention stuffing, and scam links.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.spamFilterEnabled}
            onChange={(e) => settings.setSpamFilterEnabled(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Hide stray replies in Explore</div>
            <div className="text-[#8c8a82]">
              Show top-level notes in Explore instead of out-of-context reply spam.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.hideRepliesInExplore}
            onChange={(e) => settings.setHideRepliesInExplore(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Strict PoW-only Explore (12+ bits)</div>
            <div className="text-[#8c8a82]">
              Only show notes in Explore with verified NIP-13 Proof-of-Work (zero bot spam).
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.requirePowInExplore}
            onChange={(e) => settings.setRequirePowInExplore(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Include Fire Wisp client tag on posts</div>
            <div className="text-[#8c8a82]">
              Turn OFF to omit the NIP-89 client tag from your published notes.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.clientTagEnabled}
            onChange={(e) => settings.setClientTagEnabled(e.target.checked)}
            className="accent-[#e8590c]"
          />
        </label>

        {signer?.exportSecretKey && (
          <div className="p-3.5 rounded-xl bg-[#15161c] border border-[#232530] space-y-2.5">
            <div className="text-xs font-semibold">Export NIP-49 Encrypted Key (ncryptsec1)</div>
            <div className="flex gap-2">
              <input
                type="password"
                value={exportPass}
                onChange={(e) => setExportPass(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Passphrase (min 8 chars)"
                className="flex-1 px-3 py-2 rounded-lg bg-[#0e0e11] border border-[#2a2d3a] text-xs"
              />
              <button
                onClick={() => {
                  setExportErr(null)
                  try {
                    setExported(exportNcryptsec(exportPass))
                  } catch (e) {
                    setExportErr(e instanceof Error ? e.message : String(e))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-[#e8590c] text-xs font-semibold cursor-pointer"
              >
                Encrypt
              </button>
            </div>
            {exportErr && <p className="text-xs text-red-400">{exportErr}</p>}
            {exported && (
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-emerald-300 truncate bg-[#0e0e11] px-2 py-1 rounded">
                  {exported}
                </code>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(exported)
                      setCopied(true)
                      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
                      copyTimerRef.current = setTimeout(() => {
                        copyTimerRef.current = null
                        setCopied(false)
                      }, 1800)
                    } catch {
                      useNostrStore.getState().setToast('Clipboard permission unavailable')
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-[#1d1f29] text-xs flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        )}

        {hasVault && (
          <button
            onClick={clearEncryptedVault}
            className="text-xs text-red-300 hover:underline cursor-pointer"
          >
            Remove saved encrypted browser vault
          </button>
        )}
      </SettingsSection>

      {/* Fire Wisp for Android */}
      <SettingsSection
        id="android"
        title="Fire Wisp for Android"
        icon={Smartphone}
        badge={<span className="text-[11px] text-[#8c8a82]">APK · Zapstore</span>}
        isOpen={Boolean(openSections['android'])}
        onToggle={toggleSection}
      >
        <div className="p-3.5 rounded-2xl bg-[#15161c] border border-[#232530] space-y-3">
          <p className="text-xs text-[#9a9890] leading-relaxed">
            Built-in fail-closed Tor, Amber signer, NIP-49 backups, and a self-custodial Lightning
            wallet.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={ANDROID_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[160px] px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-center text-white flex items-center justify-center gap-1.5 transition"
            >
              <Smartphone className="w-3.5 h-3.5" />
              Download APK
            </a>
            <a
              href={ZAPSTORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-[160px] px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium text-center text-[#d4d2cb] flex items-center justify-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Also on Zapstore
            </a>
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
