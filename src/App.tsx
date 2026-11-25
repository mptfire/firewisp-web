import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { parseSharedQueryParams } from './lib/shareTarget'
import { useAuthStore } from './lib/store/useAuthStore'
import { useLiveStore } from './lib/store/useLiveStore'
import { useNostrStore } from './lib/store/useNostrStore'
import { Layout } from './components/Layout'
import { FeedPage } from './pages/FeedPage'
import { ThreadPage } from './pages/ThreadPage'
import { ProfilePage } from './pages/ProfilePage'
import { NotificationsPage } from './pages/NotificationsPage'
import { SearchPage } from './pages/SearchPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { SettingsPage } from './pages/SettingsPage'
import { LiveDirectoryPage } from './pages/LiveDirectoryPage'
import { LiveStreamPage } from './pages/LiveStreamPage'

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
  const pubkey = useAuthStore((s) => s.pubkey)
  const initPoolListener = useNostrStore((s) => s.initPoolListener)
  const subscribeLiveDiscovery = useLiveStore((s) => s.subscribeLiveDiscovery)
  const loadUserGraph = useNostrStore((s) => s.loadUserGraph)
  const subscribeNotifications = useNostrStore((s) => s.subscribeNotifications)
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
    }
  }, [pubkey, loadUserGraph])

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
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/share" element={<ShareTargetRoute />} />
            <Route path="/e/:eventId" element={<ThreadPage />} />
            <Route path="/p/:pubkey" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/live" element={<LiveDirectoryPage />} />
            <Route path="/live/:naddr" element={<LiveStreamPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
