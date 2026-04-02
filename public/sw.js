const CACHE_VERSION = 'stavium-v1'
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`
const ASSET_CACHE = `assets-${CACHE_VERSION}`

const APP_SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/vite.svg']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => !key.includes(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET') {
    return
  }

  // Navigation requests: try network first, then fallback to cached app shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || Response.error()
        })
    )
    return
  }

  const isStaticAsset =
    url.origin === self.location.origin &&
    ['script', 'style', 'font', 'image'].includes(request.destination)

  const isGoogleFont =
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'

  if (isStaticAsset || isGoogleFont) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }
        return fetch(request).then((networkResponse) => {
          const responseCopy = networkResponse.clone()
          caches
            .open(ASSET_CACHE)
            .then((cache) => cache.put(request, responseCopy))
            .catch(() => {})
          return networkResponse
        })
      })
    )
  }
})
