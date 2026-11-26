import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
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
  Radio,
  ChevronDown,
  ChevronUp,
  UploadCloud,
  Play,
  Share,
  X,
} from 'lucide-react'
import {
  ANDROID_APP_URL,
  DEFAULT_BLOSSOM_PRIMARY,
  FIREWISP_RELAY,
} from '../lib/constants'
import { isIosDevice } from '../lib/mediaAudio'
import { buildCandidateServers, formatBlossomHost } from '../lib/nostr/blossom'
import { getStreamPrimaryPubkey, isLiveStreamFresh } from '../lib/nostr/nip53'
import { isTopLevelNote } from '../lib/nostr/spamFilter'
import { useAuthStore } from '../lib/store/useAuthStore'
import { useLiveStore } from '../lib/store/useLiveStore'
import { parseZapReceiptInfo, useNostrStore } from '../lib/store/useNostrStore'
import { useSettingsStore } from '../lib/store/useSettingsStore'
import { Avatar } from './Avatar'
import { FireWispFlameSprite } from './FireWispFlameSprite'
import { LiveZapsCard } from './LiveZapsCard'
import { RoamingFireWisp } from './RoamingFireWisp'
import { SidebarAudioDeck } from './SidebarAudioDeck'
import { StreamTopZappersCard } from './StreamTopZappersCard'
import { TrendingSidebar } from './TrendingSidebar'

const AuthModal = lazy(() => import('./AuthModal').then((m) => ({ default: m.AuthModal })))
const FloatingStreamPlayer = lazy(() =>
  import('./FloatingStreamPlayer').then((m) => ({ default: m.FloatingStreamPlayer })),
)

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isTheaterMode = location.pathname.startsWith('/live/')
  const pubkey = useAuthStore((s) => s.pubkey)
  const method = useAuthStore((s) => s.method)
  const authModalOpen = useAuthStore((s) => s.authModalOpen)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const logout = useAuthStore((s) => s.logout)
  const profile = useNostrStore((s) => (pubkey ? s.profiles[pubkey] : undefined))
  const relayStatuses = useNostrStore((s) => s.relayStatuses)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const blossomServers = useSettingsStore((s) => s.blossomServers)
  const setPrimaryBlossomServer = useSettingsStore((s) => s.setPrimaryBlossomServer)
  const inlineMediaPlayback = useSettingsStore((s) => s.inlineMediaPlayback)
  const setInlineMediaPlayback = useSettingsStore((s) => s.setInlineMediaPlayback)
  const showLiveZaps = useSettingsStore((s) => s.showLiveZaps)
  const showWisps = useSettingsStore((s) => s.showWisps)
  const showGlobalAudio = useSettingsStore((s) => s.showGlobalAudio)
  const showBookmarksNav = useSettingsStore((s) => s.showBookmarksNav)
  const hideRepliesInExplore = useSettingsStore((s) => s.hideRepliesInExplore)
  const mutedPubkeys = useSettingsStore((s) => s.mutedPubkeys)
  const mutedHashtags = useSettingsStore((s) => s.mutedHashtags)
  const mutedWords = useSettingsStore((s) => s.mutedWords)
  const privateMutedPubkeys = useSettingsStore((s) => s.privateMutedPubkeys)
  const privateMutedHashtags = useSettingsStore((s) => s.privateMutedHashtags)
  const privateMutedWords = useSettingsStore((s) => s.privateMutedWords)
  const activeFeedTab = useNostrStore((s) => s.activeFeedTab)
  const showRepliesInFollows = useNostrStore((s) => s.showRepliesInFollows)
  const pendingFeedIds = useNostrStore((s) => s.pendingFeedIds[s.activeFeedTab])
  const flushPendingFeed = useNostrStore((s) => s.flushPendingFeed)
  const notificationIds = useNostrStore((s) => s.notificationIds)
  const notificationsLastSeenAt = useNostrStore((s) => s.notificationsLastSeenAt)
  const readNotificationIds = useNostrStore((s) => s.readNotificationIds)
  const events = useNostrStore((s) => s.events)
  const deletedByAuthor = useNostrStore((s) => s.deletedByAuthor)
  const isEventMuted = useNostrStore((s) => s.isEventMuted)
  const isEventDeleted = useNostrStore((s) => s.isEventDeleted)

  const pendingFeedCount = useMemo(() => {
    if (!pendingFeedIds || pendingFeedIds.length === 0) return 0
    const seen = new Set<string>()
    let count = 0
    for (const id of pendingFeedIds) {
      const ev = events[id]
      if (!ev || isEventDeleted(ev) || isEventMuted(ev)) continue
      let targetEv = ev
      if (ev.kind === 6) {
        const targetId = ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
        const inner = targetId ? events[targetId] : undefined
        if (!inner || isEventDeleted(inner) || isEventMuted(inner)) continue
        targetEv = inner
      }
      if (seen.has(targetEv.id)) continue
      if (
        (activeFeedTab === 'following' ||
          activeFeedTab === 'foryou' ||
          activeFeedTab === 'extended' ||
          activeFeedTab === 'firewisp') &&
        !showRepliesInFollows &&
        targetEv.kind === 1 &&
        !isTopLevelNote(targetEv)
      ) {
        continue
      }
      if (
        (activeFeedTab === 'global' || activeFeedTab === 'trending') &&
        hideRepliesInExplore &&
        targetEv.kind === 1 &&
        !isTopLevelNote(targetEv)
      ) {
        continue
      }
      seen.add(targetEv.id)
      count++
    }
    return count
  }, [
    pendingFeedIds,
    activeFeedTab,
    showRepliesInFollows,
    hideRepliesInExplore,
    events,
    deletedByAuthor,
    isEventDeleted,
    isEventMuted,
    mutedPubkeys,
    mutedHashtags,
    mutedWords,
    privateMutedPubkeys,
    privateMutedHashtags,
    privateMutedWords,
  ])

  // Clicking Feed flushes any queued new posts; clicking the nav item (or logo) for the page you're already on scrolls to top
  const scrollTopIfCurrent = (e: MouseEvent, to: string) => {
    if (to === '/' && pendingFeedCount > 0) {
      flushPendingFeed(activeFeedTab)
    }
    if (location.pathname === to && !location.search && !location.hash) {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const powBusyMessage = useNostrStore((s) => s.powBusyMessage)
  const toastMessage = useNostrStore((s) => s.toastMessage)
  const setToast = useNostrStore((s) => s.setToast)
  const hasMiniPlayer = useLiveStore((s) => Boolean(s.miniPlayer))
  const liveStreams = useLiveStore((s) => s.liveStreams)
  const liveCount = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000)
    const mutedSet = new Set(
      [...mutedPubkeys, ...privateMutedPubkeys].map((p) => p.toLowerCase()),
    )
    let count = 0
    for (const entry of Object.values(liveStreams)) {
      if (!isLiveStreamFresh(entry, nowSec)) continue
      const primaryPk = getStreamPrimaryPubkey(entry.activity).toLowerCase()
      if (mutedSet.has(primaryPk) || mutedSet.has(entry.activity.hostPubkey.toLowerCase())) {
        continue
      }
      count++
    }
    return count
  }, [liveStreams, mutedPubkeys, privateMutedPubkeys])

  const unreadNotificationCount = useMemo(() => {
    if (!pubkey || notificationsLastSeenAt <= 0) return 0
    const allMutedPks =
      privateMutedPubkeys.length > 0 ? [...mutedPubkeys, ...privateMutedPubkeys] : mutedPubkeys
    let count = 0
    for (const id of notificationIds) {
      const ev = events[id]
      if (!ev) continue
      if (ev.created_at <= notificationsLastSeenAt) break
      if (readNotificationIds[id]) continue
      if (isEventDeleted(ev) || isEventMuted(ev)) continue
      if (ev.kind === 9735) {
        const actorPk = parseZapReceiptInfo(ev).senderPubkey.toLowerCase()
        if (allMutedPks.includes(actorPk)) continue
      }
      count++
    }
    return count
  }, [
    pubkey,
    notificationIds,
    notificationsLastSeenAt,
    readNotificationIds,
    events,
    deletedByAuthor,
    isEventDeleted,
    isEventMuted,
    mutedPubkeys,
    mutedHashtags,
    mutedWords,
    privateMutedPubkeys,
    privateMutedHashtags,
    privateMutedWords,
  ])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title =
      unreadNotificationCount > 0
        ? `(${unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}) Fire Wisp`
        : 'Fire Wisp — Privacy-Focused Nostr Web Client'
  }, [unreadNotificationCount])
  const [relaysExpanded, setRelaysExpanded] = useState(false)
  const [iosInstallOpen, setIosInstallOpen] = useState(false)
  const isIos = useMemo(() => isIosDevice(), [])
  const isStandalonePwa = useMemo(() => {
    if (typeof window === 'undefined') return false
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    )
  }, [])
  const [screenGoldSats, setScreenGoldSats] = useState(0)
  const screenGoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pulse the gold perimeter frame around the main Fire Wisp screen when a live zap > 100 sats arrives
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBigZap = (ev: Event) => {
      const detail = (ev as CustomEvent<{ sats?: number }>).detail
      const sats = typeof detail?.sats === 'number' ? detail.sats : 0
      if (sats <= 100) return
      setScreenGoldSats(sats)
      if (screenGoldTimerRef.current) clearTimeout(screenGoldTimerRef.current)
      screenGoldTimerRef.current = setTimeout(() => {
        screenGoldTimerRef.current = null
        setScreenGoldSats(0)
      }, 3200)
    }
    window.addEventListener('fw-big-zap', onBigZap)
    return () => {
      window.removeEventListener('fw-big-zap', onBigZap)
      if (screenGoldTimerRef.current) clearTimeout(screenGoldTimerRef.current)
    }
  }, [])
  const [isDesktopMd, setIsDesktopMd] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 768px)').matches
      : true,
  )
  const [isDesktopLg, setIsDesktopLg] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mqMd = window.matchMedia('(min-width: 768px)')
    const mqLg = window.matchMedia('(min-width: 1024px)')
    const onChangeMd = (e: MediaQueryListEvent) => setIsDesktopMd(e.matches)
    const onChangeLg = (e: MediaQueryListEvent) => setIsDesktopLg(e.matches)
    setIsDesktopMd(mqMd.matches)
    setIsDesktopLg(mqLg.matches)
    mqMd.addEventListener('change', onChangeMd)
    mqLg.addEventListener('change', onChangeLg)
    return () => {
      mqMd.removeEventListener('change', onChangeMd)
      mqLg.removeEventListener('change', onChangeLg)
    }
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

  const navItems: Array<{
    to: string
    label: string
    icon: typeof Flame
    end?: boolean
    badge?: string | number
    badgeTone?: 'red' | 'green' | 'orange'
  }> = [
    {
      to: '/',
      label: 'Feed',
      icon: Flame,
      end: true,
      badge:
        pendingFeedCount > 0
          ? pendingFeedCount > 99
            ? '99+'
            : pendingFeedCount
          : undefined,
      badgeTone: 'orange',
    },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: Bell,
      badge:
        unreadNotificationCount > 0
          ? unreadNotificationCount > 99
            ? '99+'
            : unreadNotificationCount
          : undefined,
      badgeTone: 'green',
    },
    { to: '/search', label: 'Search', icon: Search },
    {
      to: '/live',
      label: 'Live',
      icon: Radio,
      badge: liveCount > 0 ? liveCount : undefined,
      badgeTone: 'red',
    },
    ...(showBookmarksNav ? [{ to: '/bookmarks', label: 'Bookmarks', icon: Bookmark }] : []),
    ...(pubkey ? [{ to: `/p/${pubkey}`, label: 'Profile', icon: User }] : []),
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <div className="min-h-dvh bg-[#0e0e11] text-[#f4f1ea] flex justify-center">
      {showWisps && <RoamingFireWisp />}
      <div
        data-fw-shell=""
        className={`w-full ${isTheaterMode ? 'max-w-[1680px]' : 'max-w-[1440px]'} flex min-h-dvh`}
      >
        {/* Left Sidebar (desktop) */}
        <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-[#20222c] px-3 py-4 sticky top-0 h-dvh overflow-y-auto gap-3.5">
          <div>
            <Link
              to="/"
              onClick={(e) => scrollTopIfCurrent(e, '/')}
              className="fw-flame-box mb-4 group"
            >
              <div className="fw-flame-box-inner flex items-center gap-2.5 px-3 py-2.5">
                <img src="/firewisp-logo.png" alt="Fire Wisp" className="relative z-[6] w-9 h-9 rounded-xl shrink-0" />
                <div className="min-w-0">
                  <div className="font-bold text-lg leading-tight tracking-tight text-white group-hover:text-[#ffd43b] transition">
                    Fire Wisp
                  </div>
                  <div className="text-[11px] text-[#9a9890]">Sovereign Nostr</div>
                </div>
              </div>
            </Link>

            <nav className="space-y-1">
              {navItems.map(({ to, label, icon: Icon, end, badge, badgeTone }) => {
                const hasNotifFlame = showWisps && to === '/notifications' && badge !== undefined
                const hasFeedNew = showWisps && to === '/' && badge !== undefined
                const hasUnreadNotif = to === '/notifications' && badge !== undefined
                const hasPendingFeed = to === '/' && badge !== undefined
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={(e) => scrollTopIfCurrent(e, to)}
                    className={({ isActive }) =>
                      `flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium border transition-[background-color,border-color,color] duration-500 ease-out ${
                        hasFeedNew
                          ? 'fw-notif-flame bg-transparent border-transparent text-[#ff922b] font-semibold hover:bg-white/5'
                          : hasNotifFlame
                            ? 'fw-notif-flame bg-transparent border-transparent text-white hover:bg-white/5'
                            : isActive
                              ? 'bg-[#e8590c]/15 text-[#ff922b] border-[#e8590c]/25'
                              : hasPendingFeed
                                ? 'bg-transparent border-transparent text-[#ff922b] font-semibold hover:bg-white/5'
                                : hasUnreadNotif
                                  ? 'bg-transparent border-transparent text-white hover:bg-white/5'
                                  : 'bg-transparent border-transparent text-[#c2bfb7] hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    {hasNotifFlame && (
                      <>
                        <span className="fw-notif-seg fw-green-tail-3" aria-hidden="true" />
                        <span className="fw-notif-seg fw-green-tail-2" aria-hidden="true" />
                        <span className="fw-notif-seg fw-green-tail-1" aria-hidden="true" />
                        <span className="fw-notif-seg fw-notif-wisp fw-green-wisp" aria-hidden="true">
                          <FireWispFlameSprite idPrefix="fw-notif" variant="green" />
                        </span>
                      </>
                    )}
                    {hasFeedNew && (
                      <>
                        <span className="fw-notif-seg fw-white-tail-3" aria-hidden="true" />
                        <span className="fw-notif-seg fw-white-tail-2" aria-hidden="true" />
                        <span className="fw-notif-seg fw-white-tail-1" aria-hidden="true" />
                        <span className="fw-notif-seg fw-notif-wisp fw-white-wisp" aria-hidden="true">
                          <FireWispFlameSprite idPrefix="fw-feed" variant="white" />
                        </span>
                      </>
                    )}
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          badge && badgeTone === 'red'
                            ? 'text-red-500'
                            : badge && badgeTone === 'green'
                              ? 'text-emerald-400'
                              : hasFeedNew
                                ? 'text-[#ff922b]'
                                : ''
                        }`}
                      />
                      <span className={`truncate ${hasFeedNew ? 'text-[#ff922b]' : ''}`}>
                        {label}
                      </span>
                    </span>
                    {badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold tabular-nums leading-none ${
                          badgeTone === 'green'
                            ? 'bg-emerald-500/20 border-emerald-500/45 text-emerald-300'
                            : badgeTone === 'orange'
                              ? 'bg-[#e8590c]/20 border-[#e8590c]/50 text-[#ff922b]'
                              : 'bg-red-600/20 border-red-500/40 text-red-400'
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </NavLink>
                )
              })}
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
                        : 'relay.firewisp.de'}
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
                      <div
                        key={url}
                        className={`flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded-md ${
                          st === 'connected'
                            ? 'bg-emerald-500/10'
                            : st === 'connecting'
                              ? 'bg-amber-500/10'
                              : 'bg-red-500/10'
                        }`}
                      >
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

                  <div
                    className="w-full flex items-center justify-between gap-1.5 pt-0.5 text-[10px] text-[#c2bfb7]"
                    title="Choose whether streams & YouTube videos play inline inside notes or open in the full player"
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      <Play className="w-3 h-3 text-[#f59f00] shrink-0" />
                      <span className="truncate">Play streams &amp; YT</span>
                    </span>
                    <div
                      role="group"
                      aria-label="Stream and YouTube playback mode"
                      className="inline-flex items-center rounded-lg bg-[#0e0e11] border border-[#262938] p-0.5 gap-0.5 shrink-0"
                    >
                      <button
                        type="button"
                        aria-pressed={inlineMediaPlayback}
                        onClick={() => setInlineMediaPlayback(true)}
                        title="Play streams & YouTube inline inside notes"
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                          inlineMediaPlayback
                            ? 'bg-emerald-600/25 border-emerald-500/50 text-emerald-300'
                            : 'border-transparent text-[#7c7a72] hover:text-[#d4d2cb]'
                        }`}
                      >
                        Inline
                      </button>
                      <button
                        type="button"
                        aria-pressed={!inlineMediaPlayback}
                        onClick={() => setInlineMediaPlayback(false)}
                        title="Open streams & YouTube in full player / new tab"
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold border transition cursor-pointer ${
                          !inlineMediaPlayback
                            ? 'bg-red-600/25 border-red-500/50 text-red-300'
                            : 'border-transparent text-[#7c7a72] hover:text-[#d4d2cb]'
                        }`}
                      >
                        Out
                      </button>
                    </div>
                  </div>
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

            {isDesktopMd && showGlobalAudio && (
              <div className="mt-3">
                <SidebarAudioDeck />
              </div>
            )}

            {isDesktopMd && isTheaterMode ? (
              <div className="mt-3">
                <StreamTopZappersCard />
              </div>
            ) : isDesktopMd && showLiveZaps ? (
              <div className="mt-3">
                <LiveZapsCard />
              </div>
            ) : null}
          </div>
        </aside>

        {/* Main Center Column */}
        <main className="flex-1 min-w-0 border-r border-[#20222c] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-6">
          {/* Mobile top bar */}
          <header className="md:hidden sticky top-0 z-30 bg-[#0e0e11]/90 backdrop-blur-md border-b border-[#20222c] fw-safe-top">
            <div className="px-4 h-[52px] flex items-center justify-between">
              <Link
                to="/"
                onClick={(e) => scrollTopIfCurrent(e, '/')}
                className="flex items-center gap-2"
              >
                <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-7 h-7 rounded-lg" />
                <span className="font-bold text-base">Fire Wisp</span>
              </Link>
              <div className="flex items-center gap-2">
                {isIos ? (
                  !isStandalonePwa && (
                    <button
                      type="button"
                      onClick={() => setIosInstallOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-[#161820] border border-[#2a2d3a] text-xs text-[#f59f00] flex items-center gap-1 cursor-pointer"
                    >
                      <Share className="w-3.5 h-3.5" />
                      Install
                    </button>
                  )
                ) : (
                  <a
                    href={ANDROID_APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-[#161820] border border-[#2a2d3a] text-xs text-[#f59f00] flex items-center gap-1"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    App
                  </a>
                )}
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
            </div>
          </header>

          {children}
        </main>

        {/* Right Info Sidebar (large desktop only — unmounted on mobile/tablet so zero hidden trending queries run) */}
        {!isTheaterMode && isDesktopLg && (
          <aside className="hidden lg:flex flex-col w-[340px] shrink-0 px-4 py-4 gap-3.5 sticky top-0 h-dvh overflow-y-auto">
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0e0e11]/95 backdrop-blur-md border-t border-[#20222c] flex justify-around pt-2 fw-safe-bottom">
        {[
          {
            to: '/',
            icon: Flame,
            label: 'Feed',
            end: true,
            badge:
              pendingFeedCount > 0
                ? pendingFeedCount > 99
                  ? '99+'
                  : pendingFeedCount
                : (undefined as string | number | undefined),
            tone: 'orange' as 'red' | 'green' | 'orange' | undefined,
          },
          { to: '/search', icon: Search, label: 'Search' },
          { to: '/live', icon: Radio, label: 'Live', badge: liveCount > 0 ? liveCount : undefined, tone: 'red' as const },
          {
            to: '/notifications',
            icon: Bell,
            label: 'Notifications',
            badge:
              unreadNotificationCount > 0
                ? unreadNotificationCount > 99
                  ? '99+'
                  : unreadNotificationCount
                : undefined,
            tone: 'green' as const,
          },
          ...(showBookmarksNav ? [{ to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' }] : []),
          { to: '/settings', icon: Settings, label: 'Settings' },
        ].map(({ to, icon: Icon, label, end, badge, tone }) => {
          const hasFeedNew = to === '/' && badge !== undefined
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => scrollTopIfCurrent(e, to)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 text-[10px] px-1.5 py-0.5 min-w-0 ${
                  hasFeedNew
                    ? 'text-[#ff922b] font-semibold'
                    : isActive
                      ? 'text-[#ff8a3d]'
                      : 'text-[#8c8a82]'
                }`
              }
            >
              <span className="relative inline-flex">
                <Icon
                  className={`w-5 h-5 ${
                    hasFeedNew ? 'text-[#ff922b] fill-[#ff922b]/35' : ''
                  }`}
                />
                {badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 px-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums leading-none ${
                      tone === 'green'
                        ? 'bg-emerald-500 text-black'
                        : tone === 'orange'
                          ? 'bg-[#e8590c] text-white'
                          : 'bg-red-600 text-white'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </span>
              <span className={`truncate max-w-[68px] ${hasFeedNew ? 'text-[#ff922b]' : ''}`}>
                {label}
              </span>
            </NavLink>
          )
        })}
      </nav>

      {/* PoW Mining Status Pill */}
      {powBusyMessage && (
        <div className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#1a1c24] border border-[#f59f00]/40 shadow-xl flex items-center gap-2 text-xs text-[#f59f00]">
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
              ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-5 left-1/2 -translate-x-1/2'
              : 'bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-5 right-5'
          }`}
        >
          {toastMessage}
        </button>
      )}

      {hasMiniPlayer && (
        <Suspense fallback={null}>
          <FloatingStreamPlayer />
        </Suspense>
      )}
      {authModalOpen && (
        <Suspense fallback={null}>
          <AuthModal />
        </Suspense>
      )}

      {/* iOS Safari Home-Screen PWA Install Guide (only ever opened on iOS Safari) */}
      {iosInstallOpen && (
        <div
          onClick={() => setIosInstallOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Install Fire Wisp on iOS"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-[#15161c] border border-[#2a2d3d] p-4 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-7 h-7 rounded-lg" />
                <h2 className="font-bold text-sm text-white">Install Fire Wisp on iOS</h2>
              </div>
              <button
                type="button"
                onClick={() => setIosInstallOpen(false)}
                aria-label="Close install instructions"
                className="p-1 rounded-lg text-[#9a9890] hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#c2bfb7] leading-relaxed">
              Add Fire Wisp to your iPhone or iPad Home Screen to run it full-screen like a native app (no App Store required):
            </p>
            <ol className="text-xs text-[#ece9e1] space-y-2 pl-4 list-decimal">
              <li>
                Tap Safari&apos;s <span className="font-semibold text-[#ff922b]">Share</span> button{' '}
                <Share className="w-3.5 h-3.5 inline-block text-[#ff922b] -mt-0.5" /> at the bottom of the screen.
              </li>
              <li>
                Scroll down and tap <span className="font-semibold text-white">Add to Home Screen</span>, then tap <span className="font-semibold text-white">Add</span>.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setIosInstallOpen(false)}
              className="w-full py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-xs font-semibold text-white cursor-pointer"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Full-screen gold circuit aura on live zaps > 100 sats */}
      <div
        aria-hidden="true"
        className={`fw-screen-gold-glow ${
          screenGoldSats > 100 ? 'fw-screen-gold-active' : ''
        } ${screenGoldSats >= 1000 ? 'fw-screen-gold-mega' : ''}`}
      />
      <div
        aria-hidden="true"
        className={`fw-screen-gold-frame ${
          screenGoldSats > 100 ? 'fw-screen-gold-active' : ''
        } ${screenGoldSats >= 1000 ? 'fw-screen-gold-mega' : ''}`}
      />
    </div>
  )
}
