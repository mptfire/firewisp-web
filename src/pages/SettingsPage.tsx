import { useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { parseNwcUri } from '../lib/nostr/nip57'

export function SettingsPage() {
  const settings = useSettingsStore()
  const relayStatuses = useNostrStore((s) => s.relayStatuses)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const userWriteRelays = useNostrStore((s) => s.userWriteRelays)
  const profiles = useNostrStore((s) => s.profiles)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const signer = useAuthStore((s) => s.signer)
  const hasVault = useAuthStore((s) => s.hasEncryptedVault)
  const exportNcryptsec = useAuthStore((s) => s.exportNcryptsec)
  const clearEncryptedVault = useAuthStore((s) => s.clearEncryptedVault)

  const [newRelay, setNewRelay] = useState('')
  const [newBlossom, setNewBlossom] = useState('')
  const [newMuteTag, setNewMuteTag] = useState('')
  const [mutedUsersOpen, setMutedUsersOpen] = useState(false)
  const [mutedTagsOpen, setMutedTagsOpen] = useState(false)
  const [nwcInput, setNwcInput] = useState(settings.nwcUri)
  const [nwcStatus, setNwcStatus] = useState<string | null>(null)

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

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="px-4 py-3.5">
        <h1 className="font-bold text-lg">Settings</h1>
        <p className="text-xs text-[#8c8a82]">
          All preferences stay strictly in your browser. Zero telemetry.
        </p>
      </div>

      {/* Optional Feed Tabs */}
      <section className="p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-[#f59f00]" />
          Feed Tabs
        </h2>
        <p className="text-xs text-[#8c8a82]">
          For You, Follows, and Trending are always shown. Enable extra tabs below if needed.
        </p>

        <label className="flex items-center justify-between text-xs p-3 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Show Live Now streaming bar</div>
            <div className="text-[#8c8a82]">
              Displays active NIP-53 Nostr live streams at the top of your feed.
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
            <div className="font-medium text-white">Show Live Zaps feed</div>
            <div className="text-[#8c8a82]">
              Displays the live NIP-57 zap scoreboard on the main feed page (swaps with stream Top Zappers on live streams).
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
              Plays streams and YouTube embeds right inside notes when clicked (OutsidePlayer opens the full player / new tab).
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
              Dedicated feed for wss://firewisp.relay.rtard.de (12-bit PoW community relay).
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
      </section>

      {/* Relays */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#f59f00]" />
            Nostr Relays
          </h2>
          <button
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
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#15161c] border border-[#232530] text-xs"
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
            if (settings.addRelay(newRelay)) setNewRelay('')
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

        {(userReadRelays.length > 0 || userWriteRelays.length > 0) && (
          <div className="pt-2 space-y-1.5">
            <div className="text-[11px] font-medium text-[#9a9890] flex items-center justify-between">
              <span>Synced from your Nostr NIP-65 list (kind 10002)</span>
              <span className="text-[10px] text-[#6f6d66]">
                {new Set([...userReadRelays, ...userWriteRelays]).size} relays
              </span>
            </div>
            {[...new Set([...userReadRelays, ...userWriteRelays])].map((url) => {
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
                  className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-[#12131a] border border-[#20222c] text-xs"
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
      </section>

      {/* Blossom media servers */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-[#f59f00]" />
            Blossom Media Servers
          </h2>
          <span className="text-[11px] text-[#8c8a82]">Auto-synced with NIP-63 / BUD-03</span>
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
              <button
                onClick={() => settings.removeBlossomServer(url)}
                className="p-1 text-[#7c7a72] hover:text-red-400 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
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
      </section>

      {/* NIP-13 Anti-Spam PoW */}
      <section className="p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#f59f00]" />
          NIP-13 Anti-Spam Proof-of-Work
        </h2>
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
      </section>

      {/* Lightning NWC */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#f59f00]" />
            Lightning Wallet (NWC — NIP-47)
          </h2>
          {settings.nwcUri && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-[10px] font-semibold text-emerald-300">
              Connected
            </span>
          )}
        </div>
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
                  ? 'NWC wallet saved on this device (wiped automatically on Sign Out)'
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
                setNwcStatus('Disconnected NWC wallet')
              }}
              className="px-3 py-2 rounded-xl bg-[#1a1c24] hover:bg-red-500/20 border border-[#2a2d3a] hover:border-red-500/40 text-xs text-red-300 cursor-pointer"
            >
              Disconnect
            </button>
          )}
        </div>
        <label className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#15161c] border border-[#232530] cursor-pointer">
          <div>
            <div className="font-medium text-white">Remember NWC wallet on this device</div>
            <div className="text-[#8c8a82]">
              {settings.nwcRememberDevice
                ? 'Stays connected across refreshes and browser restarts (cleared on Sign Out).'
                : 'Tab session only — survives page refreshes, clears when you close the tab.'}
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
      </section>

      {/* Muted Hashtags & Users */}
      <section className="p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <VolumeX className="w-4 h-4 text-[#f59f00]" />
          Muted Hashtags &amp; Users
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            settings.muteHashtag(newMuteTag)
            setNewMuteTag('')
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
            className="px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-semibold cursor-pointer"
          >
            Mute
          </button>
        </form>
        {settings.mutedHashtags.length > 0 && (
          <div className="rounded-xl bg-[#15161c] border border-[#232530] overflow-hidden">
            <button
              type="button"
              onClick={() => setMutedTagsOpen((o) => !o)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-medium text-[#d4d2cb] hover:bg-white/[0.03] cursor-pointer"
            >
              <span>Muted hashtags ({settings.mutedHashtags.length})</span>
              <ChevronDown
                className={`w-4 h-4 text-[#8c8a82] transition-transform ${mutedTagsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {mutedTagsOpen && (
              <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5 border-t border-[#20222c] max-h-48 overflow-y-auto">
                {settings.mutedHashtags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => settings.unmuteHashtag(tag)}
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
              <span>Blocked / Muted users ({settings.mutedPubkeys.length})</span>
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
                        onClick={() => settings.unmutePubkey(pk)}
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
                  onClick={() => settings.removeMutedWord(word)}
                  className="px-2.5 py-1 rounded-full bg-[#1a1c24] border border-[#2d3040] text-xs text-[#d4d2cb] hover:border-red-400 cursor-pointer"
                >
                  {word} ×
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#f59f00]" />
          Privacy &amp; Key Backup
        </h2>

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
      </section>
    </div>
  )
}
