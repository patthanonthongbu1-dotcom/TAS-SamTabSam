// TAS Calendar service worker.
// Exists so notifications can be shown the way Android Chrome requires
// (registration.showNotification) and so the site is installable as a
// home-screen app. No fetch caching — the site always loads live.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()))

// Cloud push (FCM Web Push) — fires even when no tab is open. The payload
// is built by the notifyNewTask Cloud Function. A push event MUST show a
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
