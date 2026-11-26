import { Component, Suspense, lazy, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { parseSharedQueryParams } from './lib/shareTarget'
import { getListFeedDTag } from './lib/nostr/followSets'
import { getInterestFeedDTag, getRelaySetFeedDTag } from './lib/nostr/nip51Sets'
import { useAuthStore } from './lib/store/useAuthStore'
import { useListsStore } from './lib/store/useListsStore'
import { useLiveStore } from './lib/store/useLiveStore'
import { useNostrStore } from './lib/store/useNostrStore'
import { Layout } from './components/Layout'
import { FeedPage } from './pages/FeedPage'

const ThreadPage = lazy(() =>
  import('./pages/ThreadPage').then((m) => ({ default: m.ThreadPage })),
)
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
)
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
)
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((m) => ({ default: m.SearchPage })),
)
const BookmarksPage = lazy(() =>
  import('./pages/BookmarksPage').then((m) => ({ default: m.BookmarksPage })),
)
const ListsPage = lazy(() =>
  import('./pages/ListsPage').then((m) => ({ default: m.ListsPage })),
)
const ListDetailPage = lazy(() =>
  import('./pages/ListDetailPage').then((m) => ({ default: m.ListDetailPage })),
)
const SetDetailPage = lazy(() =>
  import('./pages/SetDetailPage').then((m) => ({ default: m.SetDetailPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const LiveDirectoryPage = lazy(() =>
  import('./pages/LiveDirectoryPage').then((m) => ({ default: m.LiveDirectoryPage })),
)
const LiveStreamPage = lazy(() =>
  import('./pages/LiveStreamPage').then((m) => ({ default: m.LiveStreamPage })),
)

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error captured by boundary; keep console clean of sensitive state.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0e0e11] text-[#f4f1ea] flex flex-col items-center justify-center p-6 text-center gap-3">
          <img src="/firewisp-logo.png" alt="Fire Wisp" className="w-12 h-12 rounded-xl" />
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="text-sm text-[#9a9890] max-w-sm">
            Fire Wisp hit an unexpected rendering error. Reloading will recover cleanly.
          </p>
          <button
            onClick={() => window.location.assign('/')}
            className="px-4 py-2 rounded-xl bg-[#e8590c] hover:bg-[#d9480f] text-sm font-semibold cursor-pointer"
          >
            Back to Feed
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function ShareTargetRoute() {
  const location = useLocation()
  const setPendingShareText = useNostrStore((s) => s.setPendingShareText)

  useEffect(() => {
    const shared = parseSharedQueryParams(location.search)
    if (shared) {
      setPendingShareText(shared)
    }
  }, [location.search, setPendingShareText])

  return <Navigate to="/" replace />
}

export function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const sessionRestored = useAuthStore((s) => s.sessionRestored)
  const pubkey = useAuthStore((s) => s.pubkey)
  const initPoolListener = useNostrStore((s) => s.initPoolListener)
  const subscribeLiveDiscovery = useLiveStore((s) => s.subscribeLiveDiscovery)
  const loadUserGraph = useNostrStore((s) => s.loadUserGraph)
  const subscribeNotifications = useNostrStore((s) => s.subscribeNotifications)
  const subscribeFeed = useNostrStore((s) => s.subscribeFeed)
  const activeFeedTab = useNostrStore((s) => s.activeFeedTab)
  const activeListDTag = getListFeedDTag(activeFeedTab)
  const activeInterestDTag = getInterestFeedDTag(activeFeedTab)
  const activeRelaySetDTag = getRelaySetFeedDTag(activeFeedTab)
  const activeListSyncKey = useListsStore((s) => {
    if (activeListDTag) {
      const list = s.lists[activeListDTag]
      if (!list) return s.loading ? 'loading' : 'missing'
      return `${list.dTag}:${list.members.join(',')}`
    }
    if (activeInterestDTag) {
      const setObj = s.interestSets[activeInterestDTag]
      if (!setObj) return s.loading ? 'loading' : 'missing'
      return `interest:${setObj.dTag}:${setObj.items.join(',')}`
    }
    if (activeRelaySetDTag) {
      const setObj = s.relaySets[activeRelaySetDTag]
      if (!setObj) return s.loading ? 'loading' : 'missing'
      return `relayset:${setObj.dTag}:${setObj.items.join(',')}`
    }
    return ''
  })
  const followsLoaded = useNostrStore((s) => s.followsLoaded)
  const follows = useNostrStore((s) => s.follows)
  const followedHashtags = useNostrStore((s) => s.followedHashtags)
  const extendedAuthors = useNostrStore((s) => s.extendedAuthors)
  const feedRefreshTick = useNostrStore((s) => s.feedRefreshTick)
  const userReadRelays = useNostrStore((s) => s.userReadRelays)
  const toastMessage = useNostrStore((s) => s.toastMessage)
  const setToast = useNostrStore((s) => s.setToast)

  useEffect(() => {
    void restoreSession()
    const unsubPool = initPoolListener()
    const unsubLive = subscribeLiveDiscovery()
    return () => {
      unsubPool()
      unsubLive()
    }
  }, [restoreSession, initPoolListener, subscribeLiveDiscovery])

  useEffect(() => {
    if (pubkey) {
      void loadUserGraph(pubkey)
      void useListsStore.getState().fetchOwnLists(pubkey)
    } else {
      useListsStore.getState().resetLists()
    }
  }, [pubkey, loadUserGraph])

  // Keep active feed subscribed globally so new-note counts update live while browsing Live/Notifications/Settings
  useEffect(() => {
    if (!sessionRestored) return
    return subscribeFeed(activeFeedTab)
  }, [
    sessionRestored,
    activeFeedTab,
    pubkey,
    followsLoaded,
    follows,
    followedHashtags,
    userReadRelays,
    extendedAuthors,
    activeListSyncKey,
    feedRefreshTick,
    subscribeFeed,
  ])

  // Keep notifications subscribed globally while signed in so unread badge updates live on every page
  useEffect(() => {
    if (!pubkey) return
    return subscribeNotifications(pubkey)
  }, [pubkey, userReadRelays, subscribeNotifications])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toastMessage, setToast])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Layout>
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16 text-sm text-[#9a9890]">
                Loading…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/share" element={<ShareTargetRoute />} />
              <Route path="/e/:eventId" element={<ThreadPage />} />
              <Route path="/p/:pubkey" element={<ProfilePage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/lists" element={<ListsPage />} />
              <Route path="/lists/:setType/:dTag" element={<SetDetailPage />} />
              <Route path="/lists/:dTag" element={<ListDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/live" element={<LiveDirectoryPage />} />
              <Route path="/live/:naddr" element={<LiveStreamPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
