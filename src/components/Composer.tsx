import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { ImagePlus, Send, Cpu, X, FileText, Loader2, Eye, Pencil, Radio } from 'lucide-react'
import {
  buildImetaTag,
  formatBlossomHost,
  uploadToBlossom,
  type BlossomUploadResult,
} from '../lib/nostr/blossom'
import { parseNoteContent } from '../lib/nostr/content'
import { buildLiveATag } from '../lib/nostr/nip53'
import { nostrPool } from '../lib/nostr/pool'
import { extractYouTubeRefsFromText } from '../lib/nostr/youtube'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { YouTubeCard } from './YouTubeCard'

interface UploadedDraft {
  upload: BlossomUploadResult
  alt: string
}

interface ComposerProps {
  replyTo?: Event
  placeholder?: string
  onPublished?: (ev: Event) => void
  compact?: boolean
}

/**
 * Mounted ONLY while Preview mode is active so typing in Composer never subscribes to
 * global `profiles` / `events` / `liveStreams` maps.
 */
const ComposerPreview = memo(function ComposerPreview({
  text,
  attachments,
  pubkey,
  displayName,
  nip05,
}: {
  text: string
  attachments: UploadedDraft[]
  pubkey: string | null
  displayName: string
  nip05?: string
}) {
  const profiles = useNostrStore((s) => s.profiles)
  const events = useNostrStore((s) => s.events)
  const liveStreams = useLiveStore((s) => s.liveStreams)

  const parsedPreview = useMemo(() => {
    const mediaUrls = attachments.map((a) => a.upload.url).join('\n')
    const fullContent = [text.trim(), mediaUrls].filter(Boolean).join('\n\n')
    const imetaTags = attachments.map((a) => buildImetaTag(a.upload, a.alt))
    return parseNoteContent({ content: fullContent, tags: imetaTags })
  }, [text, attachments])

  // Lazily fetch uncached mentioned profiles & quoted notes when previewing
  useEffect(() => {
    const st = useNostrStore.getState()
    const missingProfiles = parsedPreview.segments
      .filter(
        (seg): seg is { type: 'mention'; bech32: string; pubkey: string } =>
          seg.type === 'mention' && !st.profiles[seg.pubkey],
      )
      .map((seg) => seg.pubkey)
    if (missingProfiles.length > 0) {
      void st.fetchProfiles(missingProfiles)
    }

    const missingQuotes = parsedPreview.quotes
      .filter((qid) => !st.events[qid])
      .slice(0, 4)
    if (missingQuotes.length > 0) {
      const relays = [
        ...new Set([...useSettingsStore.getState().getReadRelays(), ...st.userReadRelays]),
      ].slice(0, 8)
      void nostrPool.query(relays, { ids: missingQuotes }, 3000).then((evs) => {
        const store = useNostrStore.getState()
        for (const ev of evs) store.ingestEvent(ev)
        if (evs.length > 0) void store.fetchProfiles(evs.map((e) => e.pubkey))
      })
    }
  }, [parsedPreview])

  return (
    <div className="rounded-xl bg-[#0e0f15] border border-[#2a2d3d] p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#1f2230]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-white truncate">
            {displayName || (pubkey ? `${pubkey.slice(0, 10)}…` : 'You')}
          </span>
          {nip05 && (
            <span className="text-[11px] text-[#7c7a72] truncate">
              {nip05.replace(/^_@/, '')}
            </span>
          )}
          <span className="text-[11px] text-[#6f6d66] shrink-0">· now</span>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-[#e8590c]/15 border border-[#e8590c]/30 text-[10px] font-semibold text-[#ff922b] shrink-0">
          Preview
        </span>
      </div>

      {parsedPreview.segments.some((s) => s.type !== 'text' || s.text.trim().length > 0) && (
        <div className="text-[15px] leading-relaxed text-[#ece9e1] whitespace-pre-wrap break-words">
          {parsedPreview.segments.map((seg, i) => {
            if (seg.type === 'text') return <span key={i}>{seg.text}</span>
            if (seg.type === 'link') {
              return (
                <a
                  key={i}
                  href={seg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#ff8a3d] hover:underline break-all"
                >
                  {seg.display}
                </a>
              )
            }
            if (seg.type === 'hashtag') {
              return (
                <span key={i} className="text-[#f59f00]">
                  #{seg.tag}
                </span>
              )
            }
            if (seg.type === 'mention') {
              const mp = profiles[seg.pubkey]
              const label = mp?.display_name || mp?.name || `${seg.bech32.slice(0, 12)}…`
              return (
                <span key={i} className="text-[#ff8a3d] font-medium">
                  @{label}
                </span>
              )
            }
            if (seg.type === 'quote') {
              const quotedEv = seg.eventId ? events[seg.eventId] : undefined
              const qp = quotedEv ? profiles[quotedEv.pubkey] : undefined
              return (
                <div
                  key={i}
                  className="my-2 p-2.5 rounded-xl bg-[#161820] border border-[#272a36] text-xs"
                >
                  {quotedEv ? (
                    <>
                      <div className="font-semibold text-[#c9c6be] mb-1">
                        {qp?.display_name || qp?.name || `${quotedEv.pubkey.slice(0, 12)}…`}
                      </div>
                      <p className="text-[#dcd9d0] line-clamp-3 whitespace-pre-wrap break-words">
                        {quotedEv.content}
                      </p>
                    </>
                  ) : (
                    <span className="text-[#ff8a3d]">
                      Quoted note ({seg.bech32.slice(0, 18)}…)
                    </span>
                  )}
                </div>
              )
            }
            if (seg.type === 'live') {
              const entry = liveStreams[buildLiveATag(seg.hostPubkey, seg.dTag)]
              return (
                <div
                  key={i}
                  className="my-2 p-2.5 rounded-xl bg-[#161820] border border-[#e8590c]/40 flex items-center gap-2 text-xs"
                >
                  <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold uppercase flex items-center gap-1 shrink-0">
                    <Radio className="w-2.5 h-2.5" />
                    LIVE
                  </span>
                  <span className="text-white font-medium truncate">
                    {entry?.activity.title || `Live Stream (${seg.dTag.slice(0, 24)})`}
                  </span>
                </div>
              )
            }
            return null
          })}
        </div>
      )}

      {parsedPreview.media.length > 0 && (
        <div
          className={`grid gap-2 ${
            parsedPreview.media.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
          }`}
        >
          {parsedPreview.media.map((m) =>
            m.kind === 'image' ? (
              <div
                key={m.url}
                className="relative rounded-xl overflow-hidden border border-[#242734] bg-[#0b0b0e] flex items-center justify-center"
              >
                <img
                  src={m.url}
                  alt={m.alt || 'Note image preview'}
                  referrerPolicy="no-referrer"
                  className={
                    parsedPreview.media.length === 1
                      ? 'max-h-[480px] max-w-full w-auto h-auto object-contain'
                      : 'max-h-64 max-w-full w-auto h-auto object-contain'
                  }
                />
                {m.alt && (
                  <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-semibold text-emerald-300">
                    ALT
                  </span>
                )}
              </div>
            ) : m.kind === 'video' ? (
              <video
                key={m.url}
                src={m.poster ? m.url : `${m.url}#t=0.001`}
                poster={m.poster}
                controls
                playsInline
                preload="metadata"
                className="rounded-xl max-h-80 w-full bg-black border border-[#242734]"
              />
            ) : (
              <audio key={m.url} src={m.url} controls preload="none" className="w-full" />
            ),
          )}
        </div>
      )}

      {parsedPreview.youtube.length > 0 && (
        <div className="space-y-2">
          {parsedPreview.youtube.map((yt) => (
            <YouTubeCard key={yt.videoId} video={yt} previewOnly />
          ))}
        </div>
      )}
    </div>
  )
})

export function Composer({
  replyTo,
  placeholder = 'What is burning on your mind?',
  onPublished,
  compact = false,
}: ComposerProps) {
  const signer = useAuthStore((s) => s.signer)
  const pubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const profile = useNostrStore((s) => (pubkey ? s.profiles[pubkey] : undefined))
  const publishNote = useNostrStore((s) => s.publishNote)
  const pendingShareText = useNostrStore((s) => s.pendingShareText)
  const setPendingShareText = useNostrStore((s) => s.setPendingShareText)
  const notePowEnabled = useSettingsStore((s) => s.notePowEnabled)
  const notePowBits = useSettingsStore((s) => s.notePowBits)
  const blossomServers = useSettingsStore((s) => s.blossomServers)

  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<UploadedDraft[]>([])
  const [editingAltUrl, setEditingAltUrl] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingHost, setUploadingHost] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const youtubePreviews = useMemo(() => extractYouTubeRefsFromText(text, 2), [text])
  const hasDraft = Boolean(text.trim() || attachments.length > 0)

  const editingAttachment = useMemo(
    () => (editingAltUrl ? attachments.find((a) => a.upload.url === editingAltUrl) ?? null : null),
    [editingAltUrl, attachments],
  )

  useEffect(() => {
    if (!hasDraft && previewMode) setPreviewMode(false)
  }, [hasDraft, previewMode])

  useEffect(() => {
    if (editingAltUrl && !editingAttachment) setEditingAltUrl(null)
  }, [editingAltUrl, editingAttachment])

  // Consume incoming Android / OS Web Share Target content once signed in (only top-level composer)
  useEffect(() => {
    if (replyTo || !pendingShareText || !signer?.canSign) return
    setText((prev) => {
      if (!prev.trim()) return pendingShareText
      const sep = prev.endsWith('\n') ? '' : '\n'
      return `${prev}${sep}${pendingShareText}`
    })
    setPendingShareText(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [replyTo, pendingShareText, signer?.canSign, setPendingShareText])

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const res = await uploadToBlossom(
          file,
          file.type || 'application/octet-stream',
          signer,
          blossomServers,
          fetch,
          ({ host }) => setUploadingHost(host),
        )
        setAttachments((prev) =>
          prev.some((a) => a.upload.url === res.url || a.upload.sha256 === res.sha256)
            ? prev
            : [...prev, { upload: res, alt: '' }],
        )
        useNostrStore.getState().setToast(`Uploaded to ${formatBlossomHost(res.server)}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      setUploadingHost(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handlePublish = async () => {
    if (!signer?.canSign) {
      openAuthModal()
      return
    }
    const cleanText = text.trim()
    if (!cleanText && attachments.length === 0) return

    setError(null)
    setPublishing(true)
    try {
      const mediaUrls = attachments.map((a) => a.upload.url).join('\n')
      const fullContent = [cleanText, mediaUrls].filter(Boolean).join('\n\n')
      const imetaTags = attachments.map((a) => buildImetaTag(a.upload, a.alt))

      const published = await publishNote({
        content: fullContent,
        extraTags: imetaTags,
        replyTo,
      })
      setText('')
      setAttachments([])
      setEditingAltUrl(null)
      setPreviewMode(false)
      onPublished?.(published)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPublishing(false)
    }
  }

  if (!signer?.canSign) {
    return (
      <div className="border-b border-[#22242e] p-4 flex items-center justify-between gap-3 bg-[#121319]">
        <p className="text-sm text-[#9a9890]">
          {pendingShareText && !replyTo
            ? 'Shared link ready — sign in to post it to Fire Wisp.'
            : signer
              ? 'Watch-only mode active. Sign in with NIP-07, Bunker, or your key to post.'
              : 'Browsing Fire Wisp read-only. Sign in to post, like, or upload media.'}
        </p>
        <button
          onClick={openAuthModal}
          className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold shrink-0 cursor-pointer"
        >
          Sign in
        </button>
      </div>
    )
  }

  return (
    <div
      className={
        compact
          ? 'border-b border-[#22242e] p-3 bg-[#101118]'
          : 'border-b border-[#22242e] px-3 py-3 bg-[#0e0e11]'
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          void handleFiles(e.dataTransfer.files)
          return
        }
        const droppedUrl =
          e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
        const cleanUrl = droppedUrl
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith('#'))
        if (cleanUrl) {
          setText((prev) => {
            if (!prev.trim()) return cleanUrl
            const sep = prev.endsWith(' ') || prev.endsWith('\n') ? '' : '\n'
            return `${prev}${sep}${cleanUrl}`
          })
        }
      }}
    >
      <div
        className={`flex gap-3 ${
          compact
            ? ''
            : 'rounded-2xl bg-[#13141c] border-2 border-[#040407] shadow-[0_0_0_1px_#26293b,inset_0_1px_0_rgba(255,255,255,0.03)] p-3.5'
        }`}
      >
        <Avatar
          src={profile?.picture}
          pubkey={pubkey || ''}
          name={profile?.display_name || profile?.name}
          size={compact ? 'sm' : 'md'}
        />
        <div className="flex-1 min-w-0">
          {previewMode ? (
            <ComposerPreview
              text={text}
              attachments={attachments}
              pubkey={pubkey}
              displayName={profile?.display_name || profile?.name || ''}
              nip05={profile?.nip05}
            />
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  const dt = e.clipboardData
                  if (!dt) return
                  const files: File[] = []
                  if (dt.files && dt.files.length > 0) {
                    files.push(...Array.from(dt.files))
                  } else if (dt.items) {
                    for (const item of Array.from(dt.items)) {
                      if (item.kind === 'file') {
                        const f = item.getAsFile()
                        if (f) files.push(f)
                      }
                    }
                  }
                  if (files.length > 0) {
                    e.preventDefault()
                    void handleFiles(files)
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !publishing && !uploading) {
                    e.preventDefault()
                    void handlePublish()
                  }
                }}
                rows={compact ? 2 : 3}
                placeholder={`${placeholder} (Ctrl+Enter to post)`}
                className="w-full rounded-xl bg-[#08090d] border-2 border-[#040407] ring-1 ring-[#2c3044] focus:ring-[#e8590c]/85 focus:border-[#e8590c]/45 shadow-[inset_0_2px_8px_rgba(0,0,0,0.75)] px-3.5 py-2.5 resize-none text-[15px] leading-relaxed text-[#f4f1ea] placeholder-[#78756d] focus:outline-none transition"
              />

              {youtubePreviews.length > 0 && (
                <div className="mt-2.5 grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {youtubePreviews.map((yt) => (
                    <YouTubeCard key={yt.videoId} video={yt} compact previewOnly />
                  ))}
                </div>
              )}

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {attachments.map((att) => (
                    <div
                      key={att.upload.url}
                      title={`Hosted on ${formatBlossomHost(att.upload.server)}`}
                      className="relative group rounded-xl overflow-hidden border border-[#2a2d3a] bg-[#0e0e11]"
                    >
                      {att.upload.type.startsWith('image/') ? (
                        <img
                          src={att.upload.url}
                          alt={att.alt || 'Upload preview'}
                          referrerPolicy="no-referrer"
                          className="w-24 h-24 object-cover"
                        />
                      ) : (
                        <div className="w-24 h-24 flex items-center justify-center text-xs text-[#9a9890] p-2 text-center">
                          {att.upload.type}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setAttachments((p) => p.filter((a) => a.upload.url !== att.upload.url))
                          if (editingAltUrl === att.upload.url) setEditingAltUrl(null)
                        }}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/75 text-white hover:bg-red-600 cursor-pointer"
                        aria-label="Remove attachment"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingAltUrl(att.upload.url)}
                        className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer ${
                          att.alt
                            ? 'bg-emerald-600/90 text-white'
                            : 'bg-black/75 text-[#d4d2cb] hover:bg-[#e8590c]'
                        }`}
                      >
                        <FileText className="w-2.5 h-2.5" />
                        {att.alt ? 'ALT ✓' : '+ ALT'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {editingAttachment && (
                <div className="mt-2 p-2.5 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] flex items-center gap-2">
                  <input
                    type="text"
                    value={editingAttachment.alt}
                    onChange={(e) => {
                      const val = e.target.value
                      setAttachments((prev) =>
                        prev.map((a) =>
                          a.upload.url === editingAttachment.upload.url ? { ...a, alt: val } : a,
                        ),
                      )
                    }}
                    placeholder="Describe this image for accessibility (NIP-92 alt text)…"
                    className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setEditingAltUrl(null)}
                    className="px-2.5 py-1 rounded-lg bg-[#e8590c] text-xs font-medium cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-[#1f212b] flex-wrap">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="p-2 rounded-lg text-[#9a9890] hover:text-[#ff922b] hover:bg-white/5 transition flex items-center gap-1.5 text-xs cursor-pointer shrink-0"
                title="Upload media via Blossom (EXIF stripped client-side)"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#e8590c]" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {uploading
                    ? uploadingHost
                      ? `Uploading to ${uploadingHost}…`
                      : 'Uploading…'
                    : 'Media'}
                </span>
              </button>

              {uploading && uploadingHost && (
                <span className="sm:hidden text-[11px] font-mono text-[#ff922b] truncate max-w-[180px]">
                  → {uploadingHost}
                </span>
              )}

              <button
                type="button"
                disabled={!hasDraft}
                onClick={() => setPreviewMode((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-35 disabled:cursor-default shrink-0 border ${
                  previewMode
                    ? 'bg-[#e8590c]/15 border-[#e8590c]/40 text-[#ff922b]'
                    : 'bg-transparent border-transparent text-[#9a9890] hover:text-white hover:bg-white/5'
                }`}
                title={previewMode ? 'Return to editing note' : 'Preview how your note will look before posting'}
              >
                {previewMode ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{previewMode ? 'Edit' : 'Preview'}</span>
              </button>

              {notePowEnabled && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] text-[#f59f00]/90 bg-[#f59f00]/10 border border-[#f59f00]/20 px-2 py-0.5 rounded-full"
                  title="NIP-13 anti-spam proof-of-work mined automatically in a background Web Worker"
                >
                  <Cpu className="w-3 h-3" />
                  PoW {notePowBits}b
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={publishing || uploading || (!text.trim() && attachments.length === 0)}
              onClick={() => void handlePublish()}
              className="px-4 py-1.5 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-sm font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {publishing ? 'Publishing…' : replyTo ? 'Reply' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
