/* ─────────────────────────────────────────────────────────────
   Manage (a calendar section): tasks still in play, grouped by when
   they're due, so one posted wrong can be fixed without hunting for it.
   Pure — node tests it; calendar.html draws it and edits with its
   usual task form.
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
