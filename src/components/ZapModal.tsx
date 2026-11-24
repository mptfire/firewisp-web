import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Zap, X, Copy, Check, Wallet } from 'lucide-react'
import {
  payInvoiceWithNwc,
  payInvoiceWithWebln,
  requestZapInvoice,
} from '../lib/nostr/nip57'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'

interface ZapModalProps {
  recipientPubkey: string
  recipientName: string
  lud16: string
  eventId?: string
  eventATag?: string
  onClose: () => void
}

const PRESETS = [21, 100, 500, 1000, 5000]

export function ZapModal({
  recipientPubkey,
  recipientName,
  lud16,
  eventId,
  eventATag,
  onClose,
}: ZapModalProps) {
  const signer = useAuthStore((s) => s.signer)
  const nwcUri = useSettingsStore((s) => s.nwcUri)
  const relays = useSettingsStore((s) => s.relays)
  const readRelays = useMemo(
    () => relays.filter((r) => r.read).map((r) => r.url),
    [relays],
  )

  const [amount, setAmount] = useState(21)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [copied, setCopied] = useState(false)

  const hasWebln = typeof window !== 'undefined' && Boolean(window.webln)

  useEffect(() => {
    if (!invoice) {
      setQrDataUrl(null)
      return
    }
    void QRCode.toDataURL(`lightning:${invoice}`, {
      width: 220,
      margin: 1,
      color: { dark: '#0e0e11', light: '#ffffff' },
    }).then(setQrDataUrl)
  }, [invoice])

  const handleGenerateOrPay = async (mode: 'qr' | 'webln' | 'nwc') => {
    setError(null)
    setBusy(true)
    try {
      const pr =
        invoice ||
        (await requestZapInvoice({
          lud16,
          amountSats: amount,
          recipientPubkey,
          eventId,
          eventATag,
          comment,
          relays: readRelays,
          signer,
        }))
      setInvoice(pr)

      if (mode === 'webln') {
        await payInvoiceWithWebln(pr)
        setPaid(true)
      } else if (mode === 'nwc') {
        await payInvoiceWithNwc(nwcUri, pr)
        setPaid(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const copyInvoice = async () => {
    if (!invoice) return
    await navigator.clipboard.writeText(invoice)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#15161c] border border-[#2a2d3a] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#f59f00]" />
            <h2 className="font-semibold text-base">Zap {recipientName}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#9a9890] mb-3 truncate">{lud16}</p>

        {paid ? (
          <div className="py-8 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Check className="w-6 h-6" />
            </div>
            <p className="font-semibold text-white">Zap sent ({amount.toLocaleString()} sats)</p>
            <p className="text-xs text-[#9a9890] mt-1">
              Thank you for supporting {recipientName} on Nostr.
            </p>
            <button
              onClick={onClose}
              className="mt-5 px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-1.5 mb-3">
              {PRESETS.map((sats) => (
                <button
                  key={sats}
                  onClick={() => {
                    setAmount(sats)
                    setInvoice(null)
                  }}
                  className={`py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    amount === sats
                      ? 'bg-[#e8590c]/20 border-[#e8590c] text-[#ff922b]'
                      : 'bg-[#1c1e26] border-[#2a2d3a] text-[#d4d2cb] hover:border-[#3e4254]'
                  }`}
                >
                  {sats >= 1000 ? `${sats / 1000}k` : sats}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => {
                  setAmount(Math.max(1, Number(e.target.value) || 1))
                  setInvoice(null)
                }}
                className="w-28 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-sm focus:outline-none focus:border-[#e8590c]"
                placeholder="Sats"
              />
              <input
                type="text"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value)
                  setInvoice(null)
                }}
                maxLength={140}
                className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-sm focus:outline-none focus:border-[#e8590c]"
                placeholder="Optional note…"
              />
            </div>

            {error && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {error}
              </div>
            )}

            {qrDataUrl && invoice && (
              <div className="mb-4 p-3 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] flex flex-col items-center gap-2.5">
                <img src={qrDataUrl} alt="Lightning invoice QR" className="rounded-lg bg-white p-1" />
                <div className="flex items-center gap-2 w-full">
                  <code className="flex-1 text-[11px] text-[#9a9890] truncate">{invoice}</code>
                  <button
                    onClick={copyInvoice}
                    className="px-2.5 py-1 rounded-lg bg-[#1c1e26] hover:bg-[#262936] text-xs flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {nwcUri && (
                <button
                  disabled={busy}
                  onClick={() => handleGenerateOrPay('nwc')}
                  className="w-full py-2.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Wallet className="w-4 h-4" />
                  {busy ? 'Paying via NWC…' : `Pay ${amount.toLocaleString()} sats with NWC`}
                </button>
              )}
              {hasWebln && (
                <button
                  disabled={busy}
                  onClick={() => handleGenerateOrPay('webln')}
                  className="w-full py-2.5 rounded-xl bg-[#f59f00] hover:bg-[#e09100] text-black disabled:opacity-50 font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Zap className="w-4 h-4" />
                  {busy ? 'Opening WebLN…' : `Pay ${amount.toLocaleString()} sats with WebLN`}
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => handleGenerateOrPay('qr')}
                className="w-full py-2.5 rounded-xl bg-[#1c1e26] hover:bg-[#252834] border border-[#2a2d3a] disabled:opacity-50 font-medium text-sm cursor-pointer"
              >
                {busy ? 'Generating invoice…' : invoice ? 'Refresh Invoice QR' : 'Show Lightning Invoice QR'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
