import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, ExternalLink, Loader2, QrCode, Wallet, X, Zap } from 'lucide-react'
import {
  payInvoiceWithNwc,
  payInvoiceWithWebln,
  requestZapInvoice,
} from '../lib/nostr/nip57'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'

interface StreamZapBarProps {
  recipientPubkey: string
  recipientName: string
  lud16: string
  eventId?: string
  eventATag?: string
}

const STREAM_ZAP_PRESETS = [21, 100, 500, 1000]

export function StreamZapBar({
  recipientPubkey,
  recipientName,
  lud16,
  eventId,
  eventATag,
}: StreamZapBarProps) {
  const signer = useAuthStore((s) => s.signer)
  const nwcUri = useSettingsStore((s) => s.nwcUri)
  const relays = useSettingsStore((s) => s.relays)
  const activeChatRelays = useLiveStore((s) => s.activeChatRelays)

  const zapRelays = useMemo(
    () => [
      ...new Set([
        ...activeChatRelays,
        ...relays.filter((r) => r.read).map((r) => r.url),
      ]),
    ].slice(0, 8),
    [activeChatRelays, relays],
  )

  const [amountInput, setAmountInput] = useState('21')
  const [comment, setComment] = useState('')
  const [busyMode, setBusyMode] = useState<'nwc' | 'webln' | 'qr' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [lastPaidSats, setLastPaidSats] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const paidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasWebln = typeof window !== 'undefined' && Boolean(window.webln)

  const parsedAmount = parseInt(amountInput, 10)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount >= 1 ? parsedAmount : 0

  // Reset invoice & transient state whenever the target stream / Watch With tab changes
  useEffect(() => {
    setInvoice(null)
    setQrDataUrl(null)
    setError(null)
    setLastPaidSats(null)
    setBusyMode(null)
  }, [recipientPubkey, eventATag, lud16])

  useEffect(() => {
    return () => {
      if (paidTimerRef.current) clearTimeout(paidTimerRef.current)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!invoice) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(`lightning:${invoice}`, {
      width: 200,
      margin: 1,
      color: { dark: '#0e0e11', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [invoice])

  const handleZap = async (mode: 'nwc' | 'webln' | 'qr') => {
    if (busyMode || validAmount < 1) return
    setError(null)
    setBusyMode(mode)
    try {
      const pr =
        mode !== 'qr' && invoice
          ? invoice
          : await requestZapInvoice({
              lud16,
              amountSats: validAmount,
              recipientPubkey,
              eventId,
              eventATag,
              comment: comment.trim(),
              relays: zapRelays,
              signer,
            })

      if (mode === 'qr') {
        setInvoice(pr)
        return
      }

      if (mode === 'webln') {
        await payInvoiceWithWebln(pr)
      } else {
        await payInvoiceWithNwc(nwcUri, pr)
      }

      setInvoice(null)
      setQrDataUrl(null)
      setComment('')
      setLastPaidSats(validAmount)
      useNostrStore
        .getState()
        .setToast(`Zapped ${validAmount.toLocaleString()} sats to ${recipientName} ⚡`)
      if (paidTimerRef.current) clearTimeout(paidTimerRef.current)
      paidTimerRef.current = setTimeout(() => {
        paidTimerRef.current = null
        setLastPaidSats(null)
      }, 3500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyMode(null)
    }
  }

  const copyInvoice = async () => {
    if (!invoice) return
    try {
      await navigator.clipboard.writeText(invoice)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1800)
    } catch {
      useNostrStore.getState().setToast('Clipboard permission unavailable')
    }
  }

  const preferredMode: 'nwc' | 'webln' | 'qr' = nwcUri ? 'nwc' : hasWebln ? 'webln' : 'qr'

  return (
    <>
      {/* Sits directly inside the main bar under the video — 4 presets, larger typed amount (no arrows), note, Pay & QR */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleZap(preferredMode)
        }}
        className="flex-1 min-w-[260px] flex items-center gap-1.5 flex-wrap xl:flex-nowrap"
      >
        {/* 4 default preset buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {STREAM_ZAP_PRESETS.map((sats) => (
            <button
              key={sats}
              type="button"
              disabled={Boolean(busyMode)}
              onClick={() => {
                setAmountInput(String(sats))
                setInvoice(null)
                setError(null)
              }}
              className={`px-2 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer disabled:opacity-50 ${
                validAmount === sats
                  ? 'bg-[#f59f00]/20 border-[#f59f00] text-[#ffd43b] shadow-sm shadow-[#f59f00]/15'
                  : 'bg-[#1b1d27] border-[#292c3b] text-[#d4d2cb] hover:border-[#f59f00]/50 hover:text-white'
              }`}
            >
              ⚡{sats >= 1000 ? `${sats / 1000}k` : sats}
            </button>
          ))}
        </div>

        {/* Larger typed sats input — text/numeric mode so browsers never render up/down spinner arrows */}
        <div className="relative flex items-center shrink-0">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amountInput}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 9)
              setAmountInput(digits)
              setInvoice(null)
              setError(null)
            }}
            placeholder="Sats"
            aria-label="Custom zap amount in sats"
            title={`Zap ${recipientName} (${lud16})`}
            className="w-28 sm:w-32 pl-3 pr-10 py-1.5 rounded-xl bg-[#0e0e11] border border-[#292c3b] focus:border-[#f59f00] text-base font-bold text-white placeholder-[#6c6a63] focus:outline-none"
          />
          <span className="absolute right-2.5 text-[11px] font-medium text-[#7c7a72] pointer-events-none">
            sats
          </span>
        </div>

        {/* Optional zap note */}
        <input
          type="text"
          value={comment}
          onChange={(e) => {
            setComment(e.target.value)
            setInvoice(null)
          }}
          maxLength={140}
          placeholder="Zap note…"
          className="flex-1 min-w-[100px] px-2.5 py-2 rounded-xl bg-[#0e0e11] border border-[#292c3b] focus:border-[#f59f00] text-xs text-white placeholder-[#6c6a63] focus:outline-none"
        />

        {/* Direct Pay + QR buttons on the same main bar */}
        <div className="flex items-center gap-1.5 shrink-0">
          {nwcUri && (
            <button
              type="button"
              disabled={Boolean(busyMode) || validAmount < 1}
              onClick={() => void handleZap('nwc')}
              title={`Pay ${validAmount.toLocaleString()} sats via NWC to ${lud16}`}
              className="px-3 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              {busyMode === 'nwc' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wallet className="w-3.5 h-3.5" />
              )}
              {busyMode === 'nwc'
                ? 'Paying…'
                : `Zap ${validAmount > 0 ? validAmount.toLocaleString() : ''}`}
            </button>
          )}

          {hasWebln && (
            <button
              type="button"
              disabled={Boolean(busyMode) || validAmount < 1}
              onClick={() => void handleZap('webln')}
              title={`Pay ${validAmount.toLocaleString()} sats via WebLN`}
              className="px-2.5 py-2 rounded-xl bg-[#f59f00] hover:bg-[#e09100] disabled:opacity-45 text-black text-xs font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
            >
              {busyMode === 'webln' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 fill-black/25" />
              )}
              {busyMode === 'webln'
                ? 'Opening…'
                : nwcUri
                  ? 'WebLN'
                  : `Zap ${validAmount > 0 ? validAmount.toLocaleString() : ''}`}
            </button>
          )}

          <button
            type="button"
            disabled={Boolean(busyMode) || validAmount < 1}
            onClick={() => void handleZap('qr')}
            className="px-2.5 py-2 rounded-xl bg-[#1c1e2a] hover:bg-[#252838] border border-[#2d3042] disabled:opacity-45 text-xs font-medium text-[#ece9e1] flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
            title={invoice ? 'Refresh Lightning invoice QR' : `Show Lightning invoice QR (${lud16})`}
          >
            {busyMode === 'qr' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#f59f00]" />
            ) : (
              <QrCode className="w-3.5 h-3.5 text-[#f59f00]" />
            )}
            <span>QR</span>
          </button>

          {lastPaidSats !== null && (
            <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap">
              <Check className="w-3 h-3" />
              {lastPaidSats.toLocaleString()}
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="order-last basis-full p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300 hover:text-white shrink-0 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Inline Lightning Invoice QR panel (only shown when QR is clicked) */}
      {qrDataUrl && invoice && (
        <div className="order-last basis-full p-3 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] flex flex-col sm:flex-row items-center gap-3">
          <img
            src={qrDataUrl}
            alt="Lightning invoice QR"
            className="w-36 h-36 rounded-lg bg-white p-1 shrink-0"
          />
          <div className="flex-1 min-w-0 w-full space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                Lightning Invoice · {validAmount.toLocaleString()} sats · {lud16}
              </span>
              <button
                type="button"
                onClick={() => {
                  setInvoice(null)
                  setQrDataUrl(null)
                }}
                className="p-1 rounded-lg text-[#8c8a82] hover:text-white hover:bg-white/5 cursor-pointer"
                aria-label="Close invoice QR"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <code className="block text-[11px] font-mono text-[#9a9890] truncate bg-[#15161c] px-2.5 py-1.5 rounded-lg border border-[#232530]">
              {invoice}
            </code>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void copyInvoice()}
                className="px-3 py-1.5 rounded-lg bg-[#1c1e26] hover:bg-[#262936] border border-[#2d3042] text-xs font-medium text-[#ece9e1] flex items-center gap-1.5 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Invoice</span>
                  </>
                )}
              </button>
              <a
                href={`lightning:${invoice}`}
                className="px-3 py-1.5 rounded-lg bg-[#f59f00]/15 hover:bg-[#f59f00]/25 border border-[#f59f00]/40 text-xs font-semibold text-[#f59f00] flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Wallet
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
