import { useEffect, useMemo, useRef, useState } from 'react'
import { verifyEvent, type Event } from 'nostr-tools/pure'
import { ImagePlus, Loader2, ShieldCheck, X } from 'lucide-react'
import { FIREWISP_RELAY } from '../lib/constants'
import { uploadToBlossom } from '../lib/nostr/blossom'
import { nostrPool } from '../lib/nostr/pool'
import {
  buildProfileUpdateEvent,
  countPreservedCustomFields,
  fetchLatestOwnProfileEvent,
  validateProfileEditDraft,
  type ProfileEditDraft,
} from '../lib/nostr/profileEdit'
import { sanitizePublicHttpsUrl, sanitizePublicRelayUrl } from '../lib/sanitize'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'

interface EditProfileModalProps {
  pubkey: string
  onClose: () => void
}

function emptyDraft(): ProfileEditDraft {
  return {
    display_name: '',
    name: '',
    about: '',
    picture: '',
    banner: '',
    nip05: '',
    lud16: '',
    website: '',
  }
}

export function EditProfileModal({ pubkey, onClose }: EditProfileModalProps) {
  const signer = useAuthStore((s) => s.signer)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const cachedProfile = useNostrStore((s) => s.profiles[pubkey])
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const userWriteRelays = useNostrStore((s) => s.userWriteRelays)
  const blossomServers = useSettingsStore((s) => s.blossomServers)
  const relays = useSettingsStore((s) => s.relays)

  const [draft, setDraft] = useState<ProfileEditDraft>(() => ({
    display_name: cachedProfile?.display_name ?? '',
    name: cachedProfile?.name ?? '',
    about: cachedProfile?.about ?? '',
    picture: cachedProfile?.picture ?? '',
    banner: cachedProfile?.banner ?? '',
    nip05: cachedProfile?.nip05 ?? '',
    lud16: cachedProfile?.lud16 ?? '',
    website: cachedProfile?.website ?? '',
  }))
  const [latestRawEvent, setLatestRawEvent] = useState<Event | null>(null)
  const [loadingRaw, setLoadingRaw] = useState(true)
  const [uploadingField, setUploadingField] = useState<'picture' | 'banner' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirtyRef = useRef(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const bannerInputRef = useRef<HTMLInputElement | null>(null)

  const readRelays = useMemo(
    () =>
      [
        ...new Set([
          ...relays.filter((r) => r.read).map((r) => r.url),
          ...userReadRelays,
          FIREWISP_RELAY,
          'wss://purplepag.es',
        ]),
      ].slice(0, 10),
    [relays, userReadRelays],
  )

  const writeRelays = useMemo(() => {
    const candidates = [
      ...relays.filter((r) => r.write).map((r) => r.url),
      ...userWriteRelays,
      FIREWISP_RELAY,
      'wss://purplepag.es',
    ]
    return [
      ...new Set(
        candidates
          .map((r) => sanitizePublicRelayUrl(r))
          .filter((r): r is string => Boolean(r)),
      ),
    ]
  }, [relays, userWriteRelays])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  useEffect(() => {
    let active = true
    setLoadingRaw(true)
    void fetchLatestOwnProfileEvent(pubkey, readRelays)
      .then((ev) => {
        if (!active || !ev) return
        setLatestRawEvent(ev)
        if (!dirtyRef.current) {
          try {
            const raw = JSON.parse(ev.content) as Record<string, unknown>
            const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '')
            setDraft({
              display_name: str('display_name') || str('displayName'),
              name: str('name'),
              about: str('about'),
              picture: str('picture'),
              banner: str('banner'),
              nip05: str('nip05'),
              lud16: str('lud16'),
              website: str('website'),
            })
          } catch {
            // keep cached profile draft
          }
        }
      })
      .finally(() => {
        if (active) setLoadingRaw(false)
      })
    return () => {
      active = false
    }
  }, [pubkey, readRelays])

  const preservedCount = useMemo(
    () => (latestRawEvent ? countPreservedCustomFields(latestRawEvent.content) : 0),
    [latestRawEvent],
  )

  const updateField = <K extends keyof ProfileEditDraft>(key: K, value: string) => {
    dirtyRef.current = true
    setError(null)
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleImageUpload = async (field: 'picture' | 'banner', file: File) => {
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    setError(null)
    setUploadingField(field)
    try {
      const res = await uploadToBlossom(
        file,
        file.type || 'image/jpeg',
        signer,
        blossomServers,
      )
      updateField(field, res.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setUploadingField(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signer?.canSign) {
      openAuthModal()
      return
    }

    const validationErr = validateProfileEditDraft(draft)
    if (validationErr) {
      setError(validationErr)
      return
    }

    if (writeRelays.length === 0) {
      setError('No write relays configured.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const unsigned = buildProfileUpdateEvent(latestRawEvent, draft, pubkey)
      const signed = await signer.signEvent(unsigned)
      if (!verifyEvent(signed)) {
        throw new Error('Signed profile event failed verification')
      }

      const results = await nostrPool.publish(writeRelays, signed)
      const okCount = results.filter((r) => r.ok).length
      if (okCount === 0) {
        throw new Error('Relays did not accept the profile update.')
      }

      const store = useNostrStore.getState()
      store.ingestEvent(signed)
      store.setToast(`Profile updated (${okCount}/${writeRelays.length} relays)`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const previewBanner = sanitizePublicHttpsUrl(draft.banner)
  const previewName = draft.display_name.trim() || draft.name.trim() || 'Preview'

  return (
    <div
      onClick={() => {
        if (!saving) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Edit Nostr Profile"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[#14151e] border border-[#2c2f40] shadow-2xl"
      >
        <div className="sticky top-0 z-10 px-4 py-3 bg-[#14151e]/95 backdrop-blur-md border-b border-[#232530] flex items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-base text-white">Edit Profile (kind 0)</h2>
            <p className="text-[11px] text-[#8c8a82]">
              {loadingRaw
                ? 'Syncing latest kind-0 fields from relays…'
                : preservedCount > 0
                  ? `Preserving ${preservedCount} existing custom profile field${preservedCount === 1 ? '' : 's'}`
                  : 'Signed cleanly via your active Nostr signer'}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close edit profile modal"
            className="p-1.5 rounded-lg text-[#9a9890] hover:text-white hover:bg-white/5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Visual Preview */}
        <div className="relative">
          <div className="h-24 w-full bg-gradient-to-r from-[#24140d] via-[#1c1622] to-[#141720] overflow-hidden">
            {previewBanner && (
              <img
                src={previewBanner}
                alt="Banner preview"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover object-center"
              />
            )}
          </div>
          <div className="px-4 -mt-8 flex items-end justify-between">
            <div className="p-1 rounded-full bg-[#14151e] ring-1 ring-white/10">
              <Avatar
                src={draft.picture}
                pubkey={pubkey}
                name={previewName}
                size="lg"
                disableHoverPreview
              />
            </div>

            <div className="flex items-center gap-1.5 pb-1">
              <button
                type="button"
                disabled={uploadingField !== null || saving}
                onClick={() => avatarInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-[#1a1c26] hover:bg-[#232634] border border-[#2a2d3a] text-[11px] text-[#d4d2cb] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {uploadingField === 'picture' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#e8590c]" />
                ) : (
                  <ImagePlus className="w-3 h-3 text-[#f59f00]" />
                )}
                Upload Avatar
              </button>
              <button
                type="button"
                disabled={uploadingField !== null || saving}
                onClick={() => bannerInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-[#1a1c26] hover:bg-[#232634] border border-[#2a2d3a] text-[11px] text-[#d4d2cb] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {uploadingField === 'banner' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-[#e8590c]" />
                ) : (
                  <ImagePlus className="w-3 h-3 text-[#38bdf8]" />
                )}
                Upload Banner
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void handleImageUpload('picture', file)
                }}
              />
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void handleImageUpload('banner', file)
                }}
              />
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">Display Name</span>
              <input
                type="text"
                value={draft.display_name}
                onChange={(e) => updateField('display_name', e.target.value)}
                placeholder="Steve"
                maxLength={80}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">Username (@name)</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="steve"
                maxLength={60}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c]"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-[#9a9890]">Bio / About</span>
            <textarea
              rows={3}
              value={draft.about}
              onChange={(e) => updateField('about', e.target.value)}
              placeholder="Tell Nostr about yourself…"
              maxLength={1000}
              className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c] resize-y"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">NIP-05 Handle</span>
              <input
                type="text"
                value={draft.nip05}
                onChange={(e) => updateField('nip05', e.target.value)}
                placeholder="steve@firewisp.de"
                spellCheck={false}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">Lightning Address (lud16)</span>
              <input
                type="text"
                value={draft.lud16}
                onChange={(e) => updateField('lud16', e.target.value)}
                placeholder="you@wallet.com"
                spellCheck={false}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c]"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-[#9a9890]">Website</span>
            <input
              type="url"
              value={draft.website}
              onChange={(e) => updateField('website', e.target.value)}
              placeholder="https://firewisp.de"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white focus:outline-none focus:border-[#e8590c]"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">Avatar URL (https://)</span>
              <input
                type="url"
                value={draft.picture}
                onChange={(e) => updateField('picture', e.target.value)}
                placeholder="https://..."
                spellCheck={false}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] text-[#9a9890]">Banner URL (https://)</span>
              <input
                type="url"
                value={draft.banner}
                onChange={(e) => updateField('banner', e.target.value)}
                placeholder="https://..."
                spellCheck={false}
                className="w-full px-3 py-2 rounded-xl bg-[#0e0f14] border border-[#2a2d3a] text-white font-mono text-[11px] focus:outline-none focus:border-[#e8590c]"
              />
            </label>
          </div>

          {preservedCount > 0 && (
            <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>
                {preservedCount} extra field{preservedCount === 1 ? '' : 's'} from your profile JSON will stay intact.
              </span>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                dirtyRef.current = false
                setDraft(emptyDraft())
                onClose()
              }}
              className="px-3.5 py-2 rounded-xl bg-[#1b1d27] hover:bg-[#242736] text-[#c7c4bc] font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingField !== null}
              className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-50 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Publishing…' : 'Save & Publish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
