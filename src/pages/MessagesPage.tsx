import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as nip19 from 'nostr-tools/nip19'
import { ArrowLeft, Lock, Mail, Send, ShieldCheck, Eye, Plus } from 'lucide-react'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { sanitizePublicHttpsUrl } from '../lib/sanitize'
import { Avatar } from '../components/Avatar'

const URL_RE = /(https?:\/\/[^\s]+)/g
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i

export function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const signer = useAuthStore((s) => s.signer)
  const pubkey = useAuthStore((s) => s.pubkey)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const dms = useNostrStore((s) => s.dms)
  const profiles = useNostrStore((s) => s.profiles)
  const subscribeDms = useNostrStore((s) => s.subscribeDms)
  const sendDm = useNostrStore((s) => s.sendDm)
  const fetchProfiles = useNostrStore((s) => s.fetchProfiles)
  const dmAutoLoadMedia = useSettingsStore((s) => s.dmAutoLoadMedia)

  const [selectedPeer, setSelectedPeer] = useState<string>(searchParams.get('peer') || '')
  const [newPeerInput, setNewPeerInput] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedUrls, setRevealedUrls] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const paramPeer = searchParams.get('peer')
    if (paramPeer) {
      setSelectedPeer(paramPeer.toLowerCase())
      void fetchProfiles([paramPeer.toLowerCase()])
    }
  }, [searchParams, fetchProfiles])

  useEffect(() => {
    if (!signer?.canEncrypt) return
    return subscribeDms()
  }, [signer, subscribeDms])

  const threads = useMemo(() => {
    const map = new Map<string, { peer: string; lastMsg: string; lastAt: number }>()
    for (const dm of dms) {
      map.set(dm.peerPubkey, {
        peer: dm.peerPubkey,
        lastMsg: dm.content,
        lastAt: dm.createdAt,
      })
    }
    if (selectedPeer && !map.has(selectedPeer)) {
      map.set(selectedPeer, { peer: selectedPeer, lastMsg: 'New conversation', lastAt: 0 })
    }
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt)
  }, [dms, selectedPeer])

  const activeMessages = useMemo(
    () => dms.filter((m) => m.peerPubkey === selectedPeer),
    [dms, selectedPeer],
  )

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedPeer, activeMessages.length])

  const startConversation = () => {
    setError(null)
    const raw = newPeerInput.trim()
    let hex = ''
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      hex = raw.toLowerCase()
    } else if (raw.toLowerCase().startsWith('npub1')) {
      try {
        const d = nip19.decode(raw.toLowerCase())
        if (d.type === 'npub') hex = d.data
      } catch {
        // invalid
      }
    }
    if (!hex) {
      setError('Enter a valid npub1… or 64-character hex pubkey')
      return
    }
    setSelectedPeer(hex)
    setSearchParams({ peer: hex })
    setNewPeerInput('')
    void fetchProfiles([hex])
  }

  const handleSend = async () => {
    if (!selectedPeer || !draft.trim()) return
    setError(null)
    setSending(true)
    try {
      await sendDm(selectedPeer, draft)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  if (!signer?.canEncrypt) {
    return (
      <div className="p-10 text-center space-y-3">
        <Lock className="w-8 h-8 mx-auto text-[#f59f00]" />
        <h1 className="text-lg font-bold">NIP-17 Encrypted Messages</h1>
        <p className="text-sm text-[#9a9890] max-w-md mx-auto">
          Sign in with a NIP-44 capable browser extension, NIP-46 Bunker (Amber), or your key to
          read and send seal-verified encrypted DMs.
        </p>
        <button
          onClick={openAuthModal}
          className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold cursor-pointer"
        >
          Sign in
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-screen">
      <div className="px-4 py-3 border-b border-[#20222c] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#f59f00]" />
          <h1 className="font-bold text-base">Encrypted DMs (NIP-17)</h1>
        </div>
        <span
          className="text-[11px] text-emerald-400 flex items-center gap-1"
          title="All messages require verified kind-13 seal signature matching rumor author"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Seal-verified
        </span>
      </div>

      {/* Start new DM */}
      <div className="p-3 border-b border-[#20222c] flex gap-2 bg-[#121319]">
        <input
          type="text"
          value={newPeerInput}
          onChange={(e) => setNewPeerInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && startConversation()}
          placeholder="New DM: paste npub1… or hex pubkey"
          className="flex-1 px-3 py-1.5 rounded-xl bg-[#0e0e11] border border-[#262834] text-xs focus:outline-none focus:border-[#e8590c]"
        />
        <button
          onClick={startConversation}
          className="px-3 py-1.5 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-xs font-medium flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Chat
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">
          {error}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Conversation list (full-width on mobile when no chat selected, sidebar on sm+) */}
        <div
          className={`${
            selectedPeer ? 'hidden sm:block' : 'block w-full'
          } sm:w-56 border-r border-[#20222c] overflow-y-auto shrink-0`}
        >
          {threads.length === 0 ? (
            <p className="p-4 text-xs text-[#8c8a82]">No encrypted chats yet.</p>
          ) : (
            threads.map((t) => {
              const p = profiles[t.peer]
              const name = p?.display_name || p?.name || `${t.peer.slice(0, 10)}…`
              return (
                <button
                  key={t.peer}
                  onClick={() => setSelectedPeer(t.peer)}
                  className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left border-b border-[#1b1d26] hover:bg-white/[0.03] cursor-pointer ${
                    selectedPeer === t.peer ? 'bg-[#e8590c]/15' : ''
                  }`}
                >
                  <Avatar src={p?.picture} pubkey={t.peer} name={name} size="sm" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{name}</div>
                    <div className="text-[11px] text-[#8c8a82] truncate">{t.lastMsg}</div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Active chat pane */}
        <div className={`${selectedPeer ? 'flex' : 'hidden sm:flex'} flex-1 flex-col min-w-0`}>
          {!selectedPeer ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#8c8a82] p-6 text-center">
              Select a conversation or paste an npub above to start a NIP-17 encrypted DM.
            </div>
          ) : (
            <>
              <div className="sm:hidden px-3 py-2 border-b border-[#20222c] bg-[#121319] flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedPeer('')
                    setSearchParams({})
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/5 text-[#c2bfb7] cursor-pointer"
                  aria-label="Back to chats"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <Avatar
                  src={profiles[selectedPeer]?.picture}
                  pubkey={selectedPeer}
                  name={profiles[selectedPeer]?.display_name || profiles[selectedPeer]?.name}
                  size="sm"
                />
                <span className="text-xs font-semibold truncate">
                  {profiles[selectedPeer]?.display_name ||
                    profiles[selectedPeer]?.name ||
                    `${selectedPeer.slice(0, 12)}…`}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {activeMessages.map((m) => {
                  const mine = m.senderPubkey === pubkey?.toLowerCase()
                  const urls = (m.content.match(URL_RE) || [])
                    .map((u) => sanitizePublicHttpsUrl(u))
                    .filter((u): u is string => Boolean(u && IMG_RE.test(u)))
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[82%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                          mine
                            ? 'bg-[#e8590c] text-white rounded-br-sm'
                            : 'bg-[#1a1c24] border border-[#2a2d3a] text-[#f4f1ea] rounded-bl-sm'
                        }`}
                      >
                        {m.content}
                        {urls.map((imgUrl) => {
                          const show = dmAutoLoadMedia || revealedUrls[imgUrl]
                          return show ? (
                            <img
                              key={imgUrl}
                              src={imgUrl}
                              alt="DM media"
                              referrerPolicy="no-referrer"
                              className="mt-2 rounded-lg max-h-60 object-contain"
                            />
                          ) : (
                            <button
                              key={imgUrl}
                              onClick={() =>
                                setRevealedUrls((prev) => ({ ...prev, [imgUrl]: true }))
                              }
                              className="mt-2 px-2.5 py-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Load external image (hidden to protect your IP)
                            </button>
                          )
                        })}
                      </div>
                      <span className="text-[10px] text-[#6f6d66] mt-0.5 px-1">
                        {new Date(m.createdAt * 1000).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-[#20222c] flex gap-2 bg-[#121319]">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
                  placeholder="Write an encrypted message…"
                  className="flex-1 px-3 py-2 rounded-xl bg-[#0e0e11] border border-[#262834] text-sm focus:outline-none focus:border-[#e8590c]"
                />
                <button
                  disabled={sending || !draft.trim()}
                  onClick={() => void handleSend()}
                  className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] disabled:opacity-40 text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
