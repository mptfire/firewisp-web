import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import {
  X,
  ShieldCheck,
  KeyRound,
  Smartphone,
  Sparkles,
  Lock,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { Nip46BunkerSigner } from '../lib/nostr/signer'
import { isNcryptsec } from '../lib/crypto/nip49'
import { isLikelyMnemonic } from '../lib/crypto/nip06'
import { useAuthStore } from '../lib/store/useAuthStore'

type Tab = 'extension' | 'bunker' | 'key' | 'create'

export function AuthModal() {
  const open = useAuthStore((s) => s.authModalOpen)
  const close = useAuthStore((s) => s.closeAuthModal)
  const hasVault = useAuthStore((s) => s.hasEncryptedVault)
  const pendingMnemonic = useAuthStore((s) => s.pendingMnemonicBackup)
  const loginWithNip07 = useAuthStore((s) => s.loginWithNip07)
  const loginWithBunkerUri = useAuthStore((s) => s.loginWithBunkerUri)
  const attachBunkerSigner = useAuthStore((s) => s.attachBunkerSigner)
  const loginWithKeyInput = useAuthStore((s) => s.loginWithKeyInput)
  const unlockEncryptedVault = useAuthStore((s) => s.unlockEncryptedVault)
  const saveEncryptedVault = useAuthStore((s) => s.saveEncryptedVault)
  const createNewAccount = useAuthStore((s) => s.createNewAccount)
  const confirmAccountBackup = useAuthStore((s) => s.confirmAccountBackup)
  const exportNcryptsec = useAuthStore((s) => s.exportNcryptsec)

  const [tab, setTab] = useState<Tab>('extension')
  const [bunkerUri, setBunkerUri] = useState('')
  const [qrUri, setQrUri] = useState<string | null>(null)
  const [qrImg, setQrImg] = useState<string | null>(null)
  const qrAbortRef = useRef<AbortController | null>(null)

  const [keyInput, setKeyInput] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [vaultPass, setVaultPass] = useState('')
  const [saveToVault, setSaveToVault] = useState(false)

  // New account backup step
  const [backupPassword, setBackupPassword] = useState('')
  const [exportedNcryptsec, setExportedNcryptsec] = useState<string | null>(null)
  const [backupChecked, setBackupChecked] = useState(false)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      qrAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!open && !pendingMnemonic) {
      qrAbortRef.current?.abort()
      setQrUri(null)
      setQrImg(null)
      setKeyInput('')
      setPassphrase('')
      setVaultPass('')
      setBackupPassword('')
      setExportedNcryptsec(null)
      setError(null)
    }
  }, [open, pendingMnemonic])

  if (!open && !pendingMnemonic) return null

  const needsPassphrase = isNcryptsec(keyInput)
  const showOptionalPassphrase = isLikelyMnemonic(keyInput)

  const copyToClipboard = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedText(label)
    setTimeout(() => setCopiedText(null), 1800)
  }

  const startBunkerQr = async () => {
    setError(null)
    qrAbortRef.current?.abort()
    const ctrl = new AbortController()
    qrAbortRef.current = ctrl
    const session = Nip46BunkerSigner.createQrSession()
    setQrUri(session.uri)
    const img = await QRCode.toDataURL(session.uri, {
      width: 220,
      margin: 1,
      color: { dark: '#0e0e11', light: '#ffffff' },
    })
    setQrImg(img)

    try {
      const signer = await session.waitForConnection(ctrl.signal)
      attachBunkerSigner(signer)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  // Mandatory new-account backup screen (mirrors Fire Wisp Android OnboardingBackupKeyScreen)
  if (pendingMnemonic) {
    const words = pendingMnemonic.split(' ')
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-2xl bg-[#15161c] border border-[#2a2d3a] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center gap-2.5 mb-2">
            <ShieldCheck className="w-6 h-6 text-[#f59f00]" />
            <h2 className="text-lg font-bold">Back up your Fire Wisp key</h2>
          </div>
          <p className="text-sm text-[#a6a49c] mb-4">
            There is no password reset on Nostr. Save your 12-word recovery phrase or export a
            password-protected <code className="text-[#ff922b]">ncryptsec1</code> backup before
            continuing.
          </p>

          <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[#0e0e11] border border-[#262834] mb-3">
            {words.map((w, idx) => (
              <div
                key={idx}
                className="px-2.5 py-1.5 rounded-lg bg-[#171921] text-xs font-mono flex items-center gap-1.5"
              >
                <span className="text-[#6f6d66] w-4">{idx + 1}.</span>
                <span className="text-[#f4f1ea]">{w}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => void copyToClipboard(pendingMnemonic, 'mnemonic')}
            className="w-full py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium flex items-center justify-center gap-1.5 mb-4 cursor-pointer"
          >
            {copiedText === 'mnemonic' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied 12-word phrase
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy 12-word recovery phrase
              </>
            )}
          </button>

          <div className="p-3.5 rounded-xl bg-[#0e0e11] border border-[#262834] mb-4">
            <p className="text-xs font-semibold text-[#f4f1ea] mb-2">
              Optional: Export encrypted NIP-49 backup (ncryptsec1)
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Choose a strong passphrase (min 8 chars)…"
                className="flex-1 px-3 py-2 rounded-lg bg-[#15161c] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
              />
              <button
                onClick={() => {
                  setError(null)
                  try {
                    const enc = exportNcryptsec(backupPassword)
                    setExportedNcryptsec(enc)
                    if (saveToVault) saveEncryptedVault(backupPassword)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold cursor-pointer"
              >
                Encrypt
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-[#a6a49c] cursor-pointer">
              <input
                type="checkbox"
                checked={saveToVault}
                onChange={(e) => setSaveToVault(e.target.checked)}
                className="accent-[#e8590c]"
              />
              Also save encrypted vault in this browser
            </label>
            {exportedNcryptsec && (
              <div className="mt-2.5 flex items-center gap-2">
                <code className="flex-1 text-[11px] text-emerald-300 truncate bg-[#15161c] px-2 py-1 rounded">
                  {exportedNcryptsec}
                </code>
                <button
                  onClick={() => void copyToClipboard(exportedNcryptsec, 'ncryptsec')}
                  className="px-2.5 py-1 rounded bg-[#1d1f29] text-xs cursor-pointer"
                >
                  {copiedText === 'ncryptsec' ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

          <label className="flex items-start gap-2.5 text-xs text-[#d4d2cb] mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={backupChecked}
              onChange={(e) => setBackupChecked(e.target.checked)}
              className="mt-0.5 accent-[#e8590c]"
            />
            <span>
              I have safely stored my recovery phrase or encrypted backup and understand Fire Wisp
              cannot recover my key.
            </span>
          </label>

          <button
            disabled={!backupChecked}
            onClick={() => confirmAccountBackup()}
            className="w-full py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 font-semibold text-sm cursor-pointer"
          >
            Continue to Fire Wisp
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#15161c] border border-[#2a2d3a] p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-7 h-7 rounded-lg" />
            <h2 className="font-bold text-base">Sign in to Fire Wisp</h2>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Saved encrypted browser vault quick unlock */}
        {hasVault && (
          <div className="mb-4 p-3 rounded-xl bg-[#e8590c]/10 border border-[#e8590c]/30">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#ff922b] mb-2">
              <Lock className="w-3.5 h-3.5" />
              Unlock saved encrypted key
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={vaultPass}
                onChange={(e) => setVaultPass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && vaultPass) {
                    setBusy(true)
                    setError(null)
                    void unlockEncryptedVault(vaultPass)
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false))
                  }
                }}
                placeholder="Vault passphrase"
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#0e0e11] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
              />
              <button
                disabled={busy || !vaultPass}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await unlockEncryptedVault(vaultPass)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold cursor-pointer"
              >
                Unlock
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#0e0e11] border border-[#232530] mb-4 text-xs">
          {(
            [
              ['extension', 'Extension'],
              ['bunker', 'Bunker'],
              ['key', 'Key / npub'],
              ['create', 'New'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setTab(id)
                setError(null)
              }}
              className={`py-2 rounded-lg font-medium transition cursor-pointer ${
                tab === id
                  ? 'bg-[#e8590c] text-white'
                  : 'text-[#9a9890] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {tab === 'extension' && (
          <div className="space-y-3">
            <p className="text-xs text-[#a6a49c] leading-relaxed">
              Recommended for web: sign in using a NIP-07 Nostr browser extension (Alby, nos2x,
              Flamingo). Your private key never touches this page.
            </p>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await loginWithNip07()
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                } finally {
                  setBusy(false)
                }
              }}
              className="w-full py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Connect Browser Extension (NIP-07)
            </button>
          </div>
        )}

        {tab === 'bunker' && (
          <div className="space-y-3">
            <p className="text-xs text-[#a6a49c] leading-relaxed">
              Keep your private key safely on your phone (Amber) or nsec.app using NIP-46 Nostr
              Connect.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={bunkerUri}
                onChange={(e) => setBunkerUri(e.target.value)}
                placeholder="bunker://… or user@nsec.app"
                className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
              />
              <button
                disabled={busy || !bunkerUri.trim()}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await loginWithBunkerUri(bunkerUri)
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
                className="px-3.5 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-xs font-semibold cursor-pointer"
              >
                {busy ? '…' : 'Connect'}
              </button>
            </div>

            <div className="pt-2 border-t border-[#22242e]">
              {!qrImg ? (
                <button
                  onClick={() => void startBunkerQr()}
                  className="w-full py-2.5 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 text-[#f59f00]" />
                  Scan QR with Amber / Mobile Signer
                </button>
              ) : (
                <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-[#0e0e11] border border-[#262834]">
                  <img src={qrImg} alt="NIP-46 Nostr Connect QR" className="rounded-lg bg-white p-1" />
                  <p className="text-[11px] text-[#9a9890] flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin text-[#e8590c]" />
                    Waiting for approval in Amber…
                  </p>
                  {qrUri && (
                    <button
                      onClick={() => void copyToClipboard(qrUri, 'qr')}
                      className="text-[11px] text-[#ff8a3d] hover:underline cursor-pointer"
                    >
                      {copiedText === 'qr' ? 'Copied nostrconnect URI' : 'Copy nostrconnect:// URI'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'key' && (
          <div className="space-y-3">
            <p className="text-xs text-[#a6a49c] leading-relaxed">
              Enter an encrypted <code className="text-[#ff922b]">ncryptsec1…</code>, a 12/24-word
              recovery phrase (NIP-06), an <code className="text-[#ff922b]">nsec1…</code>, or an{' '}
              <code className="text-[#ff922b]">npub1…</code> for watch-only mode. Keys stay in
              memory only and are never saved in plaintext.
            </p>
            <textarea
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              rows={3}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="ncryptsec1… / 12-word phrase / nsec1… / npub1…"
              className="w-full px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-xs font-mono focus:outline-none focus:border-[#e8590c]"
            />

            {(needsPassphrase || showOptionalPassphrase) && (
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  needsPassphrase
                    ? 'Enter ncryptsec passphrase (required)'
                    : 'Optional BIP-39 passphrase'
                }
                className="w-full px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
              />
            )}

            <label className="flex items-center gap-2 text-xs text-[#a6a49c] cursor-pointer">
              <input
                type="checkbox"
                checked={saveToVault}
                onChange={(e) => setSaveToVault(e.target.checked)}
                className="accent-[#e8590c]"
              />
              Remember as encrypted NIP-49 vault in this browser (requires passphrase)
            </label>
            {saveToVault && !needsPassphrase && (
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Choose a vault passphrase (min 8 chars)"
                className="w-full px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-xs focus:outline-none focus:border-[#e8590c]"
              />
            )}

            <button
              disabled={busy || !keyInput.trim() || (needsPassphrase && !passphrase)}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await loginWithKeyInput(keyInput, passphrase)
                  if (saveToVault && passphrase.length >= 8 && useAuthStore.getState().signer?.exportSecretKey) {
                    saveEncryptedVault(passphrase)
                  }
                  setKeyInput('')
                  setPassphrase('')
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                } finally {
                  setBusy(false)
                }
              }}
              className="w-full py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Sign In
            </button>
          </div>
        )}

        {tab === 'create' && (
          <div className="space-y-3">
            <p className="text-xs text-[#a6a49c] leading-relaxed">
              Generate a brand-new sovereign Nostr identity using a 12-word BIP-39 recovery phrase
              (compatible with Fire Wisp Android and Amber). No email, phone number, or Google
              account required.
            </p>
            <button
              onClick={() => {
                setError(null)
                setBackupChecked(false)
                setExportedNcryptsec(null)
                createNewAccount()
              }}
              className="w-full py-2.5 rounded-xl ember-gradient hover:opacity-95 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              Generate New Identity
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
