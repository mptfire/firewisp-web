// Minimal pass-through Service Worker enabling Android WebAPK + Web Share Target
// without caching stale bundles OR intercepting cross-origin HLS streams/media.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // CRITICAL: Never intercept cross-origin requests (HLS live streams, Blossom media, LNURL).
  // Intercepting cross-origin media via SW breaks Safari/iOS AVPlayer HLS & causes CORS/Range errors.
  try {
    const url = new URL(event.request.url)
    if (url.origin !== self.location.origin) return
  } catch {
    return
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request))
  }
})
