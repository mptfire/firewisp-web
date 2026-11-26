import { useEffect, useMemo, useState } from 'react'
import { Shield, VolumeX, X } from 'lucide-react'
import { extractMuteCandidates } from '../lib/nostr/lists'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'

interface MuteWordModalProps {
  noteContent: string
  onClose: () => void
}

/**
 * 1-tap modal launched from a note's actions menu to block a bare domain, link, or spam phrase
 * across all relays via NIP-51 (`kind: 10000`, encrypted when signed in).
 */
export function MuteWordModal({ noteContent, onClose }: MuteWordModalProps) {
  const signer = useAuthStore((s) => s.signer)
  const muteWordGlobal = useNostrStore((s) => s.muteWordGlobal)

  const candidates = useMemo(() => extractMuteCandidates(noteContent), [noteContent])
  const [word, setWord] = useState(() => candidates[0] || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = word.trim().toLowerCase()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (trimmed.length < 2 || busy) return
    setBusy(true)
    try {
      await muteWordGlobal(trimmed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Mute word or domain"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#15161c] border border-[#2a2d3d] p-4 space-y-3 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <VolumeX className="w-4 h-4 text-[#ff8a3d]" />
            <h2 className="font-bold text-sm text-[#f4f1ea]">Mute word or domain</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mute word dialog"
            className="p-1 rounded-lg text-[#9a9890] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#9a9890] leading-relaxed">
          Hides all posts &amp; replies containing this term from any account across every relay.
          {signer?.canSign ? ' Encrypted via NIP-51 kind 10000.' : ''}
        </p>

        {candidates.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-[#9a9890]">
              Detected in this note (1-tap):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((cand) => {
                const selected = trimmed === cand
                return (
                  <button
                    key={cand}
                    type="button"
                    onClick={() => setWord(cand)}
                    className={`px-2.5 py-1 rounded-full border text-xs transition cursor-pointer ${
                      selected
                        ? 'bg-[#e8590c] border-[#e8590c] text-white font-semibold'
                        : 'bg-[#1a1c24] border-[#2d3040] text-[#d4d2cb] hover:border-[#e8590c]/60'
                    }`}
                  >
                    {cand}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Word, phrase, or domain (e.g. evmnest)…"
            autoFocus
            className="w-full px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] text-sm text-[#f4f1ea] placeholder-[#6f6d66] focus:outline-none focus:border-[#e8590c]"
          />

          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/90">
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span>
              {signer?.canSign
                ? 'Syncs privately (NIP-44) to Fire Wisp Web & Android'
                : 'Saved locally on this device (sign in to sync via NIP-51 kind 10000)'}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium text-[#d4d2cb] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || trimmed.length < 2}
              className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
            >
              {busy ? 'Muting…' : trimmed.length >= 2 ? `Mute "${trimmed}"` : 'Mute word'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
