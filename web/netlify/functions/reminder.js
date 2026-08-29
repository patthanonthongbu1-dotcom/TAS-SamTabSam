/* ─────────────────────────────────────────────────────────────
   Daily "due today / tomorrow" reminder — a scheduled function.

   The calendar has always been able to raise this notification, but
   only from an open tab (sendDueReminders() runs on a setInterval), so
   the one evening you forget to open the app is the one evening it says
   nothing. Installing the site as an app doesn't change that: a PWA is
   still only running while it is open.

   This was written as a Firebase Cloud Function first, which turned out
   to need the Blaze plan. It lives here instead — Netlify already runs
   the short-link redirect, and scheduled functions come with the same
   free plan. Cron lives in netlify.toml, not in the code.

   Zero dependencies, like redirect.js next door: a service-account JWT
   signed with node's own crypto, exchanged for an access token, then
   plain REST against Firestore and FCM. That keeps this directory free
   of a package.json and an install step, and keeps a 50 MB SDK out of a
   function that runs every quarter hour.

   Needs one secret, FIREBASE_SERVICE_ACCOUNT — the JSON from Firebase
   console → Project settings → Service accounts → Generate new private
   key, pasted into Netlify → Site configuration → Environment variables
   (raw JSON or base64, either is accepted below). It is needed because
   fcmTokens is `read: if false` and the per-user docs are owner-only;
   there is no lighter credential since FCM's legacy server key was
   retired in 2024.
   ───────────────────────────────────────────────────────────── */

const crypto = require("crypto")

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "tas-samtabsam"
const DB = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const FCM = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`

// Must match the cron in netlify.toml: a reminder fires when its chosen
// time falls inside the window this run covers.
const TICK_MINUTES = 15
const DEFAULT_TZ = "Asia/Bangkok"

/* ── Auth ─────────────────────────────────────────────────────
   A service-account JWT exchanged for an access token. Two scopes:
   Firestore to read who wants what, messaging to actually send. */

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set")
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8")   // base64 is easier to paste
  const sa = JSON.parse(text)
  if (!sa.client_email || !sa.private_key) throw new Error("Service account JSON is missing client_email/private_key")
  return sa
}

const b64url = (b) => Buffer.from(b).toString("base64url")

async function accessToken() {
  const sa = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: [
      "https://www.googleapis.com/auth/datastore",
      "https://www.googleapis.com/auth/firebase.messaging",
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${claim}`).sign(sa.private_key)
  const jwt = `${header}.${claim}.${b64url(sig)}`

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error("Token exchange failed: " + JSON.stringify(body))
  return body.access_token
}

/* ── Firestore REST ───────────────────────────────────────────
   The REST API hands back typed values ({stringValue}, {mapValue}…);
   `plain` turns a document into the shape the rest of this file — and
   the calendar — actually thinks in. */

function plain(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) out[k] = value(v)
  return out
}

function value(v) {
  if (!v || typeof v !== "object") return null
  if ("stringValue" in v) return v.stringValue
  if ("booleanValue" in v) return v.booleanValue
  if ("integerValue" in v) return Number(v.integerValue)
  if ("doubleValue" in v) return v.doubleValue
  if ("timestampValue" in v) return v.timestampValue
  if ("nullValue" in v) return null
  if ("mapValue" in v) return plain(v.mapValue.fields)
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(value)
  return null
}

async function api(token, path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : DB + path, {
    ...init,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`${init.method || "GET"} ${path} → ${res.status} ${await res.text()}`)
  }
  return res.status === 404 ? null : res.json()
}

/** Every document in a collection, following pageToken. */
async function listAll(token, collection) {
  const out = []
  let pageToken = ""
  do {
    const url = `${DB}/${collection}?pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`
    const page = await api(token, url)
    if (!page) break
    for (const d of page.documents || [])
      out.push({ id: d.name.split("/").pop(), ...plain(d.fields) })
    pageToken = page.nextPageToken || ""
  } while (pageToken)
  return out
}

/** One equality filter, run against a top-level collection. */
async function queryEq(token, collection, field, value) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: "EQUAL",
          value: typeof value === "boolean" ? { booleanValue: value } : { stringValue: String(value) },
        },
      },
      limit: 500,
    },
  }
  const res = await api(token, `${DB}:runQuery`, { method: "POST", body: JSON.stringify(body) })
  return (res || [])
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split("/").pop(), ...plain(r.document.fields) }))
}

/* ── Dates, in the reader's own zone ──────────────────────────
   Identical to the versions in functions/index.js, and covered by the
   same assertions: getting a timezone wrong here is the sort of bug
   that only shows up at 1am. */

function minutesInZone(date, timeZone) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date)
  const get = (t) => Number(p.find(x => x.type === t).value)
  return get("hour") * 60 + get("minute")
}

function dateInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date)
}

/* Whole days from today to `iso`, in the user's zone. Both sides go
   through Date.UTC so the subtraction is calendar days and can't be
   knocked off by an hour of daylight saving. */
function daysUntil(iso, timeZone, now) {
  const [ty, tm, td] = dateInZone(now, timeZone).split("-").map(Number)
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return NaN
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000)
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]

/* ── Sending ──────────────────────────────────────────────────
   FCM's v1 REST API takes one token per request — the SDK's
   "multicast" is a loop like this one. A token the server reports as
   dead is deleted, the same pruning notifyNewTask does. */

async function pushTo(token, fcmToken, title, body, tag) {
  const res = await fetch(FCM, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        webpush: {
          notification: { title, body, icon: "TASLogo.png", tag },
          fcm_options: { link: "/calendar.html" },
        },
      },
    }),
  })
  if (res.ok) return true
  const err = await res.text()
  // 404 UNREGISTERED / 400 INVALID_ARGUMENT mean the token is finished
  if (res.status === 404 || res.status === 400) return "dead"
  console.warn("FCM send failed:", res.status, err)
  return false
}

/* ── The run ─────────────────────────────────────────────────── */

exports.handler = async () => {
  const now = new Date()
  let token
  try {
    token = await accessToken()
  } catch (e) {
    console.error("Auth failed:", e.message)
    return { statusCode: 500, body: "auth failed" }
  }

  let notified = 0, skipped = 0
  try {
    const prefs = await queryEq(token, "notifyPrefs", "on", true)
    if (!prefs.length) return { statusCode: 200, body: "nobody has reminders on" }

    // The shared board is the same for everyone — read it once.
    const shared = await listAll(token, "tasks")

    for (const pref of prefs) {
      const uid = pref.id
      const tz = pref.tz || DEFAULT_TZ

      const [hh, mm] = String(pref.time || "18:00").split(":").map(Number)
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue
      const want = hh * 60 + mm
      const nowMin = minutesInZone(now, tz)
      /* How far past the chosen minute this run is, counted the short way
         round the clock. The modulo is what makes a late-night time work:
         23:50 is caught by the 00:00 run, and a plain `now >= want`
         comparison would put that at -1430 and silently never fire —
         so anyone picking a time in the last quarter hour of the day
         would simply never have been reminded. */
      const past = (nowMin - want + 1440) % 1440
      if (past >= TICK_MINUTES) { skipped++; continue }

      const today = dateInZone(now, tz)
      if (pref.lastSent === today) { skipped++; continue }   // already told them today

      const [mine, doneDoc] = await Promise.all([
        listAll(token, `userTasks/${uid}/tasks`),
        api(token, `/userDone/${uid}`),
      ])
      const done = (doneDoc && plain(doneDoc.fields).done) || {}

      // Markers are events rather than work, and a prediction is a guess.
      const due = [...shared, ...mine].filter(t => {
        if (!t || !t.end || t.type === "marker" || t.type === "prediction") return false
        if (done[t.id]) return false
        const dl = daysUntil(t.end, tz, now)
        return dl >= 0 && dl <= 1
      })

      // Stamp the day either way: with nothing to say, the next run
      // would otherwise look at the same empty list all over again.
      const stamp = () => api(token,
        `/notifyPrefs/${uid}?updateMask.fieldPaths=lastSent`,
        { method: "PATCH", body: JSON.stringify({ fields: { lastSent: { stringValue: today } } }) })

      if (!due.length) { await stamp(); continue }

      const lines = due.slice(0, 4).map(t =>
        `${t.name} — ${daysUntil(t.end, tz, now) === 0 ? "due today" : "due tomorrow"}`)
      const title = `⏰ ${due.length} task${due.length === 1 ? "" : "s"} due soon`
      const body = lines.join("\n") + (due.length > 4 ? "\n…" : "")

      const tokens = (await queryEq(token, "fcmTokens", "uid", uid)).map(t => t.id)
      if (!tokens.length) { await stamp(); continue }

      // The same tag calendar.html uses, so a device that also raised the
      // local fallback shows one notification rather than two.
      const tag = "tas-due-" + today
      for (const fcmToken of tokens) {
        const r = await pushTo(token, fcmToken, title, body, tag)
        if (r === "dead") {
          await api(token, `/fcmTokens/${encodeURIComponent(fcmToken)}`, { method: "DELETE" })
            .catch(() => {})
        }
      }
      await stamp()
      notified++
    }
  } catch (e) {
    console.error("Reminder run failed:", e)
    return { statusCode: 500, body: String(e.message || e) }
  }

  const msg = `notified ${notified}, skipped ${skipped}`
  console.log("Daily reminder:", msg)
  return { statusCode: 200, body: msg }
}

// Exported for the offline test of the date/window helpers.
exports._internals = { minutesInZone, dateInZone, daysUntil, plain, value, THAI_MONTHS }
