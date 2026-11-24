import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Flame,
  Search,
  Bell,
  Bookmark,
  Settings,
  User,
  Smartphone,
  LogOut,
  LogIn,
  Cpu,
  ExternalLink,
  Radio,
  ChevronDown,
  ChevronUp,
  UploadCloud,
  Play,
} from 'lucide-react'
import {
  ANDROID_APP_URL,
  DEFAULT_BLOSSOM_PRIMARY,
  FIREWISP_RELAY,
  ZAPSTORE_URL,
} from '../lib/constants'
import { buildCandidateServers, formatBlossomHost } from '../lib/nostr/blossom'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { AuthModal } from './AuthModal'
import { FloatingStreamPlayer } from './FloatingStreamPlayer'
import { TrendingSidebar } from './TrendingSidebar'

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isTheaterMode = location.pathname.startsWith('/live/')
  const pubkey = useAuthStore((s) => s.pubkey)
  const method = useAuthStore((s) => s.method)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const logout = useAuthStore((s) => s.logout)
  const profile = useNostrStore((s) => (pubkey ? s.profiles[pubkey] : undefined))
  const relayStatuses = useNostrStore((s) => s.relayStatuses)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const blossomServers = useSettingsStore((s) => s.blossomServers)
  const setPrimaryBlossomServer = useSettingsStore((s) => s.setPrimaryBlossomServer)
  const inlineMediaPlayback = useSettingsStore((s) => s.inlineMediaPlayback)
  const setInlineMediaPlayback = useSettingsStore((s) => s.setInlineMediaPlayback)
  const powBusyMessage = useNostrStore((s) => s.powBusyMessage)
  const toastMessage = useNostrStore((s) => s.toastMessage)
  const setToast = useNostrStore((s) => s.setToast)
  const hasMiniPlayer = useLiveStore((s) => Boolean(s.miniPlayer))
  const [relaysExpanded, setRelaysExpanded] = useState(false)
  const [isDesktopLg, setIsDesktopLg] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => setIsDesktopLg(e.matches)
    setIsDesktopLg(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const connectedCount = Object.values(relayStatuses).filter((s) => s === 'connected').length
  const totalCount = Math.max(Object.keys(relayStatuses).length, 1)
  const firewispRelayUp = relayStatuses[FIREWISP_RELAY] === 'connected'
  const candidateBlossomServers = buildCandidateServers(blossomServers)
  const activeBlossomServer = blossomServers[0] || candidateBlossomServers[0] || DEFAULT_BLOSSOM_PRIMARY
  const sortedRelayEntries = Object.entries(relayStatuses).sort((a, b) => {
    if (a[1] === 'connected' && b[1] !== 'connected') return -1
    if (b[1] === 'connected' && a[1] !== 'connected') return 1
    return a[0].localeCompare(b[0])
  })

  const navItems = [
    { to: '/', label: 'Feed', icon: Flame, end: true },
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
    ...(pubkey ? [{ to: `/p/${pubkey}`, label: 'Profile', icon: User }] : []),
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-[#0e0e11] text-[#f4f1ea] flex justify-center">
      <div className={`w-full ${isTheaterMode ? 'max-w-[1680px]' : 'max-w-[1440px]'} flex min-h-screen`}>
        {/* Left Sidebar (desktop) */}
        <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-[#20222c] px-3 py-4 sticky top-0 h-screen overflow-y-auto gap-3.5">
          <div>
            <Link to="/" className="flex items-center gap-2.5 px-3 py-2 mb-4">
              <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-9 h-9 rounded-xl" />
              <div>
                <div className="font-bold text-lg leading-tight tracking-tight">Fire Wisp</div>
                <div className="text-[11px] text-[#9a9890]">Sovereign Nostr</div>
              </div>
            </Link>

            <nav className="space-y-1">
              {navItems.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                      isActive
                        ? 'bg-[#e8590c]/15 text-[#ff922b] border border-[#e8590c]/25'
                        : 'text-[#c2bfb7] hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="mt-4 p-3 rounded-2xl bg-[#15161c] border border-[#232530]">
              <button
                type="button"
                onClick={() => setRelaysExpanded((v) => !v)}
                className="w-full flex items-center justify-between mb-1.5 cursor-pointer group"
                title="Click to inspect all connected relays"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9a9890] group-hover:text-white flex items-center gap-1.5 transition">
                  <Radio className="w-3.5 h-3.5 text-[#f59f00]" />
                  Relay Network
                </span>
                <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-0.5">
                  {connectedCount}/{totalCount} live
                  {relaysExpanded ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </button>
              <div className="text-xs text-[#c2bfb7] space-y-1">
                {!relaysExpanded ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[10px]">
                      {userReadRelays.length > 0
                        ? `${userReadRelays.length} NIP-65 + Fire Wisp`
                        : 'firewisp.relay.rtard.de'}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        firewispRelayUp ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                    />
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-0.5 pt-0.5">
                    {sortedRelayEntries.map(([url, st]) => (
                      <div key={url} className="flex items-center justify-between gap-1.5">
                        <span className="truncate font-mono text-[10px] text-[#d4d2cb]">
                          {url.replace(/^wss?:\/\//, '')}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            st === 'connected'
                              ? 'bg-emerald-400'
                              : st === 'connecting'
                                ? 'bg-amber-400'
                                : 'bg-[#4b4d5a]'
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-1.5 mt-1.5 border-t border-[#222532] space-y-2">
                  <div className="space-y-1">
                    <label
                      htmlFor="sidebar-blossom-select"
                      className="text-[10px] text-[#8c8a82] flex items-center gap-1"
                    >
                      <UploadCloud className="w-3 h-3 text-[#f59f00] shrink-0" />
                      Blossom media server
                    </label>
                    <select
                      id="sidebar-blossom-select"
                      value={activeBlossomServer}
                      onChange={(e) => setPrimaryBlossomServer(e.target.value)}
                      className="w-full px-2 py-1 rounded-lg bg-[#0e0e11] border border-[#262938] hover:border-[#3b4057] text-[11px] font-mono text-[#e4e1d8] focus:outline-none focus:border-[#e8590c] truncate cursor-pointer"
                      title="Primary Blossom server for uploads (automatically falls back if unavailable)"
                    >
                      {candidateBlossomServers.map((srv) => (
                        <option key={srv} value={srv} className="bg-[#14151e] text-white">
                          {formatBlossomHost(srv)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setInlineMediaPlayback(!inlineMediaPlayback)}
                    className="w-full flex items-center justify-between gap-2 pt-0.5 text-[10px] text-[#c2bfb7] hover:text-white cursor-pointer"
                    title="Choose whether streams & YouTube videos play inline inside notes or jump straight to the full player"
                  >
                    <span className="flex items-center gap-1 truncate">
                      <Play className="w-3 h-3 text-[#f59f00] shrink-0" />
                      <span className="truncate">Play streams & YT</span>
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 border transition ${
                        inlineMediaPlayback
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                          : 'bg-[#1d1f29] border-[#2e3242] text-[#9a9890]'
                      }`}
                    >
                      {inlineMediaPlayback ? 'Inline' : 'Player'}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#20222c]">
              {pubkey ? (
                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#15161c] border border-[#232530]">
                  <Link to={`/p/${pubkey}`} className="flex items-center gap-2 min-w-0">
                    <Avatar
                      src={profile?.picture}
                      pubkey={pubkey}
                      name={profile?.display_name || profile?.name}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">
                        {profile?.display_name || profile?.name || `${pubkey.slice(0, 10)}…`}
                      </div>
                      <div className="text-[10px] text-[#9a9890] uppercase">{method}</div>
                    </div>
                  </Link>
                  <button
                    onClick={logout}
                    title="Sign out (wipes local key from memory)"
                    className="p-1.5 rounded-lg text-[#9a9890] hover:text-red-400 hover:bg-white/5 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={openAuthModal}
                  className="w-full py-2.5 rounded-xl ember-gradient hover:opacity-95 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </button>
              )}
            </div>
          </div>

          <div className="mt-auto shrink-0 p-3.5 rounded-2xl bg-[#15161c] border border-[#232530] space-y-2">
            <h3 className="font-semibold text-xs text-white flex items-center gap-1.5">
              <Smartphone className="w-3.5 h-3.5 text-[#f59f00] shrink-0" />
              Fire Wisp for Android
            </h3>
            <p className="text-[11px] text-[#9a9890] leading-relaxed">
              Built-in fail-closed Tor, Amber signer, NIP-49 backups, and a self-custodial
              Lightning wallet.
            </p>
            <div className="flex flex-col gap-1.5 pt-0.5">
              <a
                href={ANDROID_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-center text-white flex items-center justify-center gap-1.5"
              >
                <Smartphone className="w-3.5 h-3.5" />
                Download APK
              </a>
              <a
                href={ZAPSTORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-xl bg-[#1d1f29] hover:bg-[#262936] text-[11px] font-medium text-center text-[#d4d2cb] flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3" />
                Also on Zapstore
              </a>
            </div>
          </div>
        </aside>

        {/* Main Center Column */}
        <main className="flex-1 min-w-0 border-r border-[#20222c] pb-20 md:pb-6">
          {/* Mobile top bar */}
          <header className="md:hidden sticky top-0 z-30 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] px-4 py-2.5 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-7 h-7 rounded-lg" />
              <span className="font-bold text-base">Fire Wisp</span>
            </Link>
            <div className="flex items-center gap-2">
              <a
                href={ANDROID_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-lg bg-[#161820] border border-[#2a2d3a] text-xs text-[#f59f00] flex items-center gap-1"
              >
                <Smartphone className="w-3.5 h-3.5" />
                App
              </a>
              {pubkey ? (
                <Link to={`/p/${pubkey}`}>
                  <Avatar
                    src={profile?.picture}
                    pubkey={pubkey}
                    name={profile?.display_name || profile?.name}
                    size="sm"
                  />
                </Link>
              ) : (
                <button
                  onClick={openAuthModal}
                  className="px-3 py-1 rounded-lg bg-[#e8590c] text-xs font-semibold cursor-pointer"
                >
                  Sign In
                </button>
              )}
            </div>
          </header>

          {children}
        </main>

        {/* Right Info Sidebar (large desktop only — unmounted on mobile/tablet so zero hidden trending queries run) */}
        {!isTheaterMode && isDesktopLg && (
          <aside className="hidden lg:flex flex-col w-[340px] shrink-0 px-4 py-4 gap-3.5 sticky top-0 h-screen overflow-y-auto">
            <TrendingSidebar />

            <footer className="text-[11px] text-[#6f6d66] px-1 space-y-1">
              <div>Zero analytics · Zero trackers · Zero Google Sign-In</div>
              <div>
                Relay: <span className="font-mono">{FIREWISP_RELAY.replace('wss://', '')}</span>
              </div>
            </footer>
          </aside>
        )}
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0e0e11]/95 backdrop-blur-md border-t border-[#20222c] flex justify-around py-2">
        {[
          { to: '/', icon: Flame, label: 'Feed', end: true },
          { to: '/search', icon: Search, label: 'Search' },
          { to: '/notifications', icon: Bell, label: 'Notifications' },
          { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
          { to: '/settings', icon: Settings, label: 'Settings' },
        ].map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 text-[10px] px-1.5 py-0.5 min-w-0 ${
                isActive ? 'text-[#ff8a3d]' : 'text-[#8c8a82]'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="truncate max-w-[68px]">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* PoW Mining Status Pill */}
      {powBusyMessage && (
        <div className="fixed bottom-16 md:bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#1a1c24] border border-[#f59f00]/40 shadow-xl flex items-center gap-2 text-xs text-[#f59f00]">
          <Cpu className="w-4 h-4 animate-pulse" />
          {powBusyMessage}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && !powBusyMessage && (
        <button
          onClick={() => setToast(null)}
          className={`fixed z-50 px-4 py-2.5 rounded-xl bg-[#1a1c24] border border-[#2f3344] shadow-xl text-xs text-[#f4f1ea] hover:border-[#e8590c] cursor-pointer ${
            hasMiniPlayer
              ? 'bottom-16 md:bottom-5 left-1/2 -translate-x-1/2'
              : 'bottom-16 md:bottom-5 right-5'
          }`}
        >
          {toastMessage}
        </button>
      )}

      <FloatingStreamPlayer />
      <AuthModal />
    </div>
  )
}
