import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './lib/store/useAuthStore'
import { useNostrStore } from './lib/store/useNostrStore'
import { Layout } from './components/Layout'
import { FeedPage } from './pages/FeedPage'
import { ThreadPage } from './pages/ThreadPage'
import { ProfilePage } from './pages/ProfilePage'
import { NotificationsPage } from './pages/NotificationsPage'
import { MessagesPage } from './pages/MessagesPage'
import { SearchPage } from './pages/SearchPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const pubkey = useAuthStore((s) => s.pubkey)
  const initPoolListener = useNostrStore((s) => s.initPoolListener)
  const loadUserGraph = useNostrStore((s) => s.loadUserGraph)
  const toastMessage = useNostrStore((s) => s.toastMessage)
  const setToast = useNostrStore((s) => s.setToast)

  useEffect(() => {
    void restoreSession()
    return initPoolListener()
  }, [restoreSession, initPoolListener])

  useEffect(() => {
    if (pubkey) {
      void loadUserGraph(pubkey)
    }
  }, [pubkey, loadUserGraph])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toastMessage, setToast])

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<FeedPage />} />
          <Route path="/e/:eventId" element={<ThreadPage />} />
          <Route path="/p/:pubkey" element={<ProfilePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/bookmarks" element={<BookmarksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
