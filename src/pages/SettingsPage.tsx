import { useEffect, useState } from 'react'
import {
  Radio,
  UploadCloud,
  Cpu,
  VolumeX,
  Wallet,
  Shield,
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
  const signer = useAuthStore((s) => s.signer)
  const hasVault = useAuthStore((s) => s.hasEncryptedVault)
  const exportNcryptsec = useAuthStore((s) => s.exportNcryptsec)
  const clearEncryptedVault = useAuthStore((s) => s.clearEncryptedVault)

  const [newRelay, setNewRelay] = useState('')
  const [newBlossom, setNewBlossom] = useState('')
  const [newMuteTag, setNewMuteTag] = useState('')
  const [nwcInput, setNwcInput] = useState(settings.nwcUri)
  const [nwcStatus, setNwcStatus] = useState<string | null>(null)

  useEffect(() => {
    setNwcInput(settings.nwcUri)
  }, [settings.nwcUri])

  const [exportPass, setExportPass] = useState('')
  const [exported, setExported] = useState<string | null>(null)
  const [exportErr, setExportErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  return (
    <div className="divide-y divide-[#20222c]">
      <div className="px-4 py-3.5">
        <h1 className="font-bold text-lg">Settings</h1>
        <p className="text-xs text-[#8c8a82]">
          All preferences stay strictly in your browser. Zero telemetry.
        </p>
      </div>

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
      </section>

      {/* Blossom media servers */}
      <section className="p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <UploadCloud className="w-4 h-4 text-[#f59f00]" />
          Blossom Media Servers
        </h2>
        <div className="space-y-1.5">
          {settings.blossomServers.map((url) => (
            <div
              key={url}
              className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#15161c] border border-[#232530] text-xs"
            >
              <span className="font-mono truncate">{url}</span>
              <button
                onClick={() => settings.removeBlossomServer(url)}
                className="p-1 text-[#7c7a72] hover:text-red-400 cursor-pointer"
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
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Wallet className="w-4 h-4 text-[#f59f00]" />
          Lightning Wallet (NWC — NIP-47)
        </h2>
        <p className="text-xs text-[#8c8a82]">
          Connect Alby, Primal, CoinOS, or Zeus for one-click zaps (or use WebLN / QR invoices
          without connecting a wallet). Stored in memory for this session only — never written to
          browser storage.
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
              settings.setNwcUri(nwcInput)
              setNwcStatus('NWC wallet saved')
            }}
            className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold cursor-pointer"
          >
            Save
          </button>
        </div>
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
          <div className="flex flex-wrap gap-1.5">
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
        {settings.mutedPubkeys.length > 0 && (
          <div className="space-y-1">
            {settings.mutedPubkeys.map((pk) => (
              <div
                key={pk}
                className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-[#15161c]"
              >
                <span className="font-mono text-[#9a9890]">{pk.slice(0, 20)}…</span>
                <button
                  onClick={() => settings.unmutePubkey(pk)}
                  className="text-red-300 hover:underline cursor-pointer"
                >
                  Unmute
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Privacy & Key Backup */}
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
            <div className="font-medium text-white">Auto-load external images in DMs</div>
            <div className="text-[#8c8a82]">
              Keep OFF to prevent strangers from learning your IP address in DMs.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.dmAutoLoadMedia}
            onChange={(e) => settings.setDmAutoLoadMedia(e.target.checked)}
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
                    await navigator.clipboard.writeText(exported)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
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
