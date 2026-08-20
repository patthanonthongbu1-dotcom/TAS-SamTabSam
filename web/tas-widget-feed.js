// ── Home-screen widget feed ────────────────────────────────────────────
// A phone widget can't sign in, so it can't read userDone/{uid} or
// userTasks/{uid}/tasks — both are locked to the account. What it CAN read
// is the shared `tasks` collection (public by rule) and one opt-in doc we
// publish here: widgetFeed/{uid}.
//
// The feed deliberately carries as little as possible — the ids the student
// has ticked off, and their personal tasks stripped of notes — so the widget
// can subtract "already done" from the live public task list itself. That
// keeps newly posted class tasks appearing in the widget immediately,
// instead of only after the student next opens the app.
//
// Shared by calendar.html (which keeps it fresh) and tools-widget.html
// (which turns it on and off).

import { doc, getDoc, setDoc, deleteDoc }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"

// Markers and estimated dates aren't things you hand in, so the widget never
// shows them — same rule the due reminders use. "estimated" is the older name
// for "prediction" and is still on live docs, so both are listed here.
export const NOT_SUBMITTABLE = ["marker", "prediction", "estimated"]
const SUBMITTABLE = t => t.end && NOT_SUBMITTABLE.indexOf(t.type) === -1

// Ticked-off ids pile up forever; the widget only ever needs the ones that
// could still be showing, so keep the list from growing without bound.
const MAX_DONE = 400
const MAX_PERSONAL = 60

// Personal tasks go out WITHOUT their notes — the feed is publicly
// readable, and a note is the most likely place to find something private.
function slimPersonal(t) {
  return {
    id: t.id,
    name: String(t.name ?? "").slice(0, 120),
    subject: String(t.subject ?? "").slice(0, 60),
    type: t.type || "normal",
    end: t.end
  }
}

// Progress goes out as a bare percentage — the widget draws a bar, it never
// needs to know whether that came from "3 of 5" or a slider. Only tasks that
// have actually been started are worth the bytes.
function slimProgress(progress) {
  const out = {}
  for (const [id, p] of Object.entries(progress || {})) {
    if (!p || !p.total) continue
    const pct = Math.round(p.value / p.total * 100)
    if (pct > 0) out[id] = Math.min(100, Math.max(0, pct))
  }
  return out
}

export function buildFeed({ personalTasks = [], done = {}, progress = {}, zones, overdueMode } = {}) {
  const feed = {
    v: 1,
    updatedAt: Date.now(),
    done: Object.keys(done).filter(id => done[id]).slice(-MAX_DONE),
    personal: personalTasks.filter(SUBMITTABLE).map(slimPersonal).slice(0, MAX_PERSONAL),
    progress: slimProgress(progress)
  }
  // Ship the reader's own rush-zone thresholds so the widget colours a task
  // the same red the calendar does.
  if (zones) feed.zones = { red: zones.red, orange: zones.orange, yellow: zones.yellow }
  // How long overdue work should keep showing as "Missing" — the widget
  // follows whatever the calendar's Settings say.
  if (overdueMode) feed.overdueMode = overdueMode
  return feed
}

// Everything except updatedAt — used to skip writes that wouldn't change
// anything a widget can see.
function signature(feed) {
  return JSON.stringify([feed.done, feed.personal, feed.progress, feed.zones, feed.overdueMode])
}

let lastSignature = null

// Returns true if a write actually happened.
export async function publishWidgetFeed(db, uid, data) {
  if (!db || !uid) return false
  const feed = buildFeed(data)
  const sig = signature(feed)
  if (sig === lastSignature) return false
  try {
    await setDoc(doc(db, "widgetFeed", uid), feed)
    lastSignature = sig
    return true
  } catch (e) {
    console.warn("Could not publish the widget feed:", e)
    return false
  }
}

export async function widgetFeedExists(db, uid) {
  if (!db || !uid) return false
  try {
    return (await getDoc(doc(db, "widgetFeed", uid))).exists()
  } catch (e) {
    console.warn("Could not check the widget feed:", e)
    return false
  }
}

export async function clearWidgetFeed(db, uid) {
  if (!db || !uid) return false
  try {
    await deleteDoc(doc(db, "widgetFeed", uid))
    lastSignature = null
    return true
  } catch (e) {
    console.warn("Could not remove the widget feed:", e)
    return false
  }
}

// Called when the student turns the widget off and on again — otherwise the
// change-detector would skip the very first republish.
export function resetFeedCache() { lastSignature = null }
