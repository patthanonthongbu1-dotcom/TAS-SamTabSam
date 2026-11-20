/* ─────────────────────────────────────────────────────────────
   Manage (manage.html): the moderators' list of class tasks still in
   play, so one posted wrong can be fixed without hunting for it on
   the calendar. Pure — node tests it; manage.html does the DOM.
   ───────────────────────────────────────────────────────────── */
import { reminderWindow, addDays } from "./tas-hwcard.js"

export const OVERDUE_DAYS = 7     // older than this drops off the page

// The same rule as dayTasks: dated class work, plus quizzes and exams
const counts = t => t && !t.daily && t.end && (t.type !== "marker" || ["quiz", "exam"].includes(t.markerType))
const bySoonest = (a, b) => a.end.localeCompare(b.end) || String(a.subject || "").localeCompare(String(b.subject || ""), "th")
  || String(a.name || "").localeCompare(String(b.name || ""), "th")

/**
 * Active tasks for `today`, in the groups the page shows:
 *   next    — what the card's footer calls "Due tomorrow" (Fridays: the week ahead)
 *   today   — due today
 *   overdue — past, within OVERDUE_DAYS
 *   later   — everything after `next`
 * `query` filters by name, subject or note (case-insensitive).
 */
export function activeGroups(tasks, today, query = ""){
  const win = reminderWindow(today)
  const oldest = addDays(today, -OVERDUE_DAYS)
  const q = String(query || "").trim().toLowerCase()
  const hit = t => !q || [t.name, t.subject, t.note].some(v => String(v || "").toLowerCase().includes(q))
  const list = (tasks || []).filter(t => counts(t) && hit(t)).sort(bySoonest)
  return {
    week: win.week,
    next: list.filter(t => t.end >= win.from && t.end <= win.to),
    today: list.filter(t => t.end === today),
    overdue: list.filter(t => t.end < today && t.end >= oldest),
    later: list.filter(t => t.end > win.to),
  }
}

/** The kind a task is edited as: "homework", or the marker's quiz/exam */
export const kindOf = t => t?.type === "marker" ? (t.markerType === "exam" ? "exam" : "quiz") : "homework"

const FIELDS = { name: "name", subject: "subject", end: "due", dueAt: "ส่งตอน", send: "send", note: "note", kind: "type" }

/**
 * What the edit sheet changed → the Firestore update and a line for the
 * history log. `form` = { name, subject, end, dueAt, send, note, kind }.
 * Returns null when nothing changed.
 */
export function editPatch(task, form){
  const before = { name: task.name || "", subject: task.subject || "", end: task.end || "", dueAt: task.dueAt || "",
                   send: task.send || "", note: task.note || "", kind: kindOf(task) }
  const after = {}
  for (const k of Object.keys(FIELDS)) after[k] = String(form[k] ?? "").trim()
  const changed = Object.keys(FIELDS).filter(k => before[k] !== after[k])
  if (!changed.length) return null

  const fields = {}
  for (const k of changed) if (k !== "kind") fields[k] = after[k]
  if (after.kind === "homework") {
    if (before.kind !== "homework") { fields.type = "normal"; fields.markerType = null; fields.date = null }
    // A task's start can't sit after its due date
    if (changed.includes("end") && task.start && task.start > after.end) fields.start = after.end
  } else {
    // Markers keep date/start/end together, the way the calendar saves them
    Object.assign(fields, { type: "marker", markerType: after.kind, date: after.end, start: after.end, end: after.end })
  }
  const detail = changed.map(k => k === "note" ? "note changed"
    : `${FIELDS[k]} ${before[k] || "—"} → ${after[k] || "—"}`).join(", ")
  return { fields, detail }
}
