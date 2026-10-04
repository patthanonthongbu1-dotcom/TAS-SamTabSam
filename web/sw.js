// TAS Calendar service worker.
// Exists so notifications can be shown the way Android Chrome requires
// (registration.showNotification) and so the site is installable as a
// home-screen app.
//
// Network first, always: the site loads live whenever it can, and the
// cache is only what it falls back on with no connection — so the
// installed app opens to the last pages it saw instead of a browser error.
const CACHE = "tas-offline-v1"
self.addEventListener("fetch", e => {
  const req = e.request
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
      return res
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error()))
  )
})

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()))

// Cloud push (FCM Web Push) — fires even when no tab is open. The payload
// is built by the scheduled reminder (netlify/functions/reminder.js). A push event MUST show a
// notification (Chrome shows a generic one otherwise).
self.addEventListener("push", e => {
  let p = {}
  try { p = e.data ? e.data.json() : {} } catch (err) {}
  const n = p.notification || {}
  const d = p.data || {}
  e.waitUntil(self.registration.showNotification(n.title || d.title || "TAS Calendar", {
    body: n.body || d.body || "You have an update",
    icon: n.icon || "TASLogo.png",
    badge: "TASLogo.png",
    tag: n.tag || d.tag || undefined
  }))
})

// Tapping a notification focuses the open calendar tab (or opens one)
self.addEventListener("notificationclick", e => {
  e.notification.close()
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    const existing = tabs.find(c => c.url.includes("calendar"))
    if (existing) return existing.focus()
    return self.clients.openWindow("calendar.html")
  })())
})
