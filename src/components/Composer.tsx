import { useEffect, useMemo, useRef, useState } from 'react'
import type { Event } from 'nostr-tools/pure'
import { ImagePlus, Send, Cpu, X, FileText, Loader2 } from 'lucide-react'
import { buildImetaTag, uploadToBlossom, type BlossomUploadResult } from '../lib/nostr/blossom'
import { extractYouTubeRefsFromText } from '../lib/nostr/youtube'
import { useAuthStore } from '../lib/store/useAuthStore'
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
  const [editingAltIdx, setEditingAltIdx] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const youtubePreviews = useMemo(() => extractYouTubeRefsFromText(text, 2), [text])

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
        )
        setAttachments((prev) => [...prev, { upload: res, alt: '' }])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
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
      className={`border-b border-[#22242e] ${compact ? 'p-3' : 'p-4'} bg-[#121319]/60`}
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
      <div className="flex gap-3">
        <Avatar
          src={profile?.picture}
          pubkey={pubkey || ''}
          name={profile?.display_name || profile?.name}
          size={compact ? 'sm' : 'md'}
        />
        <div className="flex-1 min-w-0">
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
            className="w-full bg-transparent resize-none text-[15px] leading-relaxed text-[#f4f1ea] placeholder-[#6c6a63] focus:outline-none"
          />

          {youtubePreviews.length > 0 && (
            <div className="mt-2.5 grid gap-2 grid-cols-1 sm:grid-cols-2">
              {youtubePreviews.map((yt) => (
                <YouTubeCard key={yt.videoId} video={yt} compact />
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {attachments.map((att, idx) => (
                <div
                  key={att.upload.url}
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
                    onClick={() => setAttachments((p) => p.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/75 text-white hover:bg-red-600 cursor-pointer"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setEditingAltIdx(idx)}
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

          {editingAltIdx !== null && attachments[editingAltIdx] && (
            <div className="mt-2 p-2.5 rounded-xl bg-[#0e0e11] border border-[#2a2d3a] flex items-center gap-2">
              <input
                type="text"
                value={attachments[editingAltIdx].alt}
                onChange={(e) => {
                  const val = e.target.value
                  setAttachments((prev) =>
                    prev.map((a, i) => (i === editingAltIdx ? { ...a, alt: val } : a)),
                  )
                }}
                placeholder="Describe this image for accessibility (NIP-92 alt text)…"
                className="flex-1 bg-transparent text-xs text-white focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => setEditingAltIdx(null)}
                className="px-2.5 py-1 rounded-lg bg-[#e8590c] text-xs font-medium cursor-pointer"
              >
                Save
              </button>
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[#1f212b]">
            <div className="flex items-center gap-2">
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
                className="p-2 rounded-lg text-[#9a9890] hover:text-[#ff922b] hover:bg-white/5 transition flex items-center gap-1.5 text-xs cursor-pointer"
                title="Upload media via Blossom (EXIF stripped client-side)"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#e8590c]" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">{uploading ? 'Uploading…' : 'Media'}</span>
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
