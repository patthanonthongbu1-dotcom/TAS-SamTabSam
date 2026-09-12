/* ─────────────────────────────────────────────────────────────
   TAS time on site — how long this actually takes you.

   One of the statistics the home page reports, and the only one
   nothing in the app was already recording. It lives here rather
   than in any one page because the answer has to mean "TAS", not
   "the calendar": a run that goes calendar → tools → formatter is
   one stretch of work, and three separate counters would tell you
   three smaller lies about it.

     import { startTimeTracking } from "./tas-time.js"
     startTimeTracking(db, uid)

   Storage is a corner of the settings doc the point target already
   uses — owner-only, merge-written, and so needing no change to
   firestore.rules:

     settings/{uid}.time = { "2026-09-12": { ms, opens }, … }

   Nothing prunes it. A day costs about forty bytes, so a student
   who uses TAS every day for five years adds seventy kilobytes to
   a document Firestore allows a megabyte for — and pruning would
   mean a read-then-write, which is exactly what the increments
   below exist to avoid.

   Two things about it are deliberate.

   **Only while you can see it.** The clock runs on visibility, not
   on the page being loaded. A tab left open overnight would
   otherwise claim eight hours of study, which would be the single
   least believable number on the page.

   **Firestore does the adding.** Every flush is an increment(),
   which is applied server-side, so two tabs open at once both count
   instead of the second overwriting the first. A read-then-write
   would have to guess which of the two was ahead.
   ───────────────────────────────────────────────────────────── */

import { doc, setDoc, increment }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"

/* Unsent time waits here. It has to survive a page navigation —
   moving from the calendar to Tools tears the module down mid-flush,
   and a buffer held only in memory would lose that stretch every
   time. Written under one key so a flush from any page drains what
   every other page left behind. */
const BUF_KEY = "tas_time_buf"

/* Long enough that walking between pages doesn't write four times,
   short enough that a browser killed outright loses a couple of
   minutes rather than an evening. `hidden` and `pagehide` flush
   regardless — this only caps how often a page that stays open and
   visible writes. */
const FLUSH_MS = 120000

/* A session that claims more than this between two ticks is not a
   session: it is a laptop lid, a sleeping phone, or a debugger
   paused on a breakpoint. The gap is dropped rather than banked. */
const MAX_TICK_MS = 5 * 60 * 1000

// Local date, not UTC — "today" has to mean the day the reader had.
export function dayKey(d = new Date()) {
  const p = n => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

function readBuf() {
  try {
    const raw = localStorage.getItem(BUF_KEY)
    const val = raw ? JSON.parse(raw) : null
    return val && typeof val === "object" && !Array.isArray(val) ? val : {}
  } catch (e) { return {} }
}

function writeBuf(buf) {
  try {
    if (Object.keys(buf).length) localStorage.setItem(BUF_KEY, JSON.stringify(buf))
    else localStorage.removeItem(BUF_KEY)
  } catch (e) {}
}

/* Adds to the buffer rather than replacing it: another tab may have
   banked its own stretch since this one last looked. */
function bank(ms, opens) {
  if (ms < 1000 && !opens) return          // sub-second visits aren't time
  const key = dayKey()
  const buf = readBuf()
  const day = buf[key] || { ms: 0, opens: 0 }
  day.ms += Math.max(0, Math.round(ms))
  day.opens += opens
  buf[key] = day
  writeBuf(buf)
}

let db = null
let uid = null
let visibleSince = 0        // 0 when the clock is not running
let lastFlush = 0
let timer = null
let started = false

function clockOn() {
  if (!visibleSince) visibleSince = Date.now()
}

/* Stops the clock and banks what it measured. Returns the elapsed ms
   so the caller can decide whether it is worth a write. */
function clockOff() {
  if (!visibleSince) return 0
  const ms = Date.now() - visibleSince
  visibleSince = 0
  // A gap this long is a machine that was asleep, not time at the desk.
  if (ms > MAX_TICK_MS) return 0
  bank(ms, 0)
  return ms
}

/**
 * Sends everything banked so far. Safe to call at any time and from
 * any page: it drains the shared buffer, and clears it only once
 * Firestore has taken it.
 *
 * @param {boolean} [leaving] true when the page is going away, which
 *        makes this fire-and-forget — there is no time left to await.
 */
export async function flushTime(leaving) {
  if (!db || !uid) return
  const buf = readBuf()
  const days = Object.keys(buf)
  if (!days.length) return

  /* Cleared before the write, not after. If the page is closing there
     is no "after", and double-counting an evening is a worse failure
     than losing two minutes of it. */
  writeBuf({})
  lastFlush = Date.now()

  const time = {}
  for (const d of days) time[d] = { ms: increment(buf[d].ms), opens: increment(buf[d].opens) }

  try {
    await setDoc(doc(db, "settings", uid), { time }, { merge: true })
  } catch (e) {
    console.warn("Could not save your time on site:", e)
    // Put it back for the next page to try — unless we are on the way
    // out, where there is nothing left to retry with.
    if (!leaving) {
      const now = readBuf()
      for (const d of days) {
        const day = now[d] || { ms: 0, opens: 0 }
        day.ms += buf[d].ms
        day.opens += buf[d].opens
        now[d] = day
      }
      writeBuf(now)
    }
  }
}

/**
 * What is banked but not yet sent, as { "YYYY-MM-DD": {ms, opens} }.
 *
 * The home page adds this to what Firestore returns. Without it the
 * minutes of the session you are *in* are missing from the total,
 * which is the one stretch of time the reader can see for themselves.
 */
export function pendingTime() {
  const buf = readBuf()
  // Time the clock has run since the last bank, which is up to 30s.
  if (visibleSince) {
    const ms = Date.now() - visibleSince
    if (ms > 0 && ms <= MAX_TICK_MS) {
      const k = dayKey()
      const day = buf[k] || { ms: 0, opens: 0 }
      buf[k] = { ms: day.ms + ms, opens: day.opens }
    }
  }
  return buf
}

/**
 * Starts counting. Idempotent — every page calls it once sign-in
 * resolves, and calling it again just re-points it at the same user.
 *
 * @param {import("firebase/firestore").Firestore} firestore
 * @param {string} userId
 */
export function startTimeTracking(firestore, userId) {
  db = firestore
  uid = userId
  if (started) return
  started = true

  bank(0, 1)            // one more visit, whatever it turns out to be worth
  lastFlush = Date.now()
  if (document.visibilityState !== "hidden") clockOn()

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { clockOff(); flushTime() }
    else clockOn()
  })

  /* pagehide rather than beforeunload: on iOS a tab is frozen and
     reused rather than unloaded, and beforeunload never comes. */
  window.addEventListener("pagehide", () => { clockOff(); flushTime(true) })

  /* The heartbeat exists for the tab nobody ever closes — it banks
     what has run so far without stopping the clock, so a reader who
     leaves TAS open for an hour still has that hour recorded if the
     browser is killed outright. */
  timer = setInterval(() => {
    if (!visibleSince) return
    const ms = Date.now() - visibleSince
    if (ms > MAX_TICK_MS) { visibleSince = Date.now(); return }
    visibleSince = Date.now()
    bank(ms, 0)
    if (Date.now() - lastFlush >= FLUSH_MS) flushTime()
  }, 30000)
}

/** Stops the clock and sends what is left. For sign-out. */
export async function stopTimeTracking() {
  if (timer) { clearInterval(timer); timer = null }
  started = false
  clockOff()
  await flushTime()
}
