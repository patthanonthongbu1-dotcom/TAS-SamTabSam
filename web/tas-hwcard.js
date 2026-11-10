// Homework card ("design A"): what goes on it, decided without any DOM so
// node can test it. tas-card.js paints the model; calendar.html builds it
// from real tasks (fromTasks) and announce.html from rows typed by hand.
//
// A row: { subject, color, icon, lines:[string], due:"YYYY-MM-DD"|"", done, photos? }

export const MAX_ROWS = 12          // past this the card says "+N รายการ"
export const PROGRESS_MIN_SUBJECTS = 3

const WEEKDAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]
const MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN }
const dayDiff = (a, b) => Math.round((ymd(a) - ymd(b)) / 864e5)
export const weekdayOf = s => WEEKDAYS[new Date(ymd(s)).getUTCDay()] || ""
export const localKey = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")

/** Due date → the pill on the right of a row, or null for no pill. */
export function duePill(due, done, today){
  if(done) return { label: "ส่งแล้ว", tone: "green" }
  if(!due || isNaN(ymd(due))) return null
  const d = dayDiff(due, today)
  if(d < 0)  return { label: "เลยกำหนด", tone: "red" }
  if(d === 0) return { label: "ส่งวันนี้", tone: "red" }
  if(d === 1) return { label: "ส่งพรุ่งนี้", tone: "orange" }
  if(d < 7)  return { label: "ส่งวัน" + weekdayOf(due), tone: "grey" }
  const dt = new Date(ymd(due))
  return { label: `ส่ง ${dt.getUTCDate()} ${MONTHS_SHORT[dt.getUTCMonth()]}`, tone: "grey" }
}

/**
 * Everything the painter needs. opts: { progress, note, done } — each true
 * (force on), false (force off) or undefined (automatic).
 */
export function cardModel({ date, name = "", note = "", rows = [], opts = {} }, today = date){
  const clean = rows
    .filter(r => r && ((r.subject || "").trim() || (r.lines || []).some(l => (l || "").trim())))
    .map(r => ({ ...r, lines: (r.lines || []).map(l => (l || "").trim()).filter(Boolean) }))
  const open = clean.filter(r => !r.done)
  const done = opts.done === false ? [] : clean.filter(r => r.done)
  const all = [...open, ...done]
  const shown = all.slice(0, MAX_ROWS).map(r => ({ ...r, pill: duePill(r.due, r.done, today) }))
  const subjects = new Set(clean.map(r => (r.subject || "").trim()))
  const showProgress = opts.progress ?? subjects.size >= PROGRESS_MIN_SUBJECTS
  return {
    date, weekday: weekdayOf(date), name: (name || "").trim(),
    note: opts.note === false ? "" : (note || "").trim(),
    rows: shown,
    more: all.length - shown.length,
    progress: showProgress && clean.length ? { done: clean.filter(r => r.done).length, total: clean.length } : null,
  }
}

/**
 * Calendar adapter. Keeps every task not done, plus those finished today;
 * same subject + due + state share one row. Markers and dailies stay off.
 * subjectOf(name) → { name, color, icon } from the shared list (or fallback).
 */
export function fromTasks(tasks, doneMap, today, subjectOf){
  const rows = new Map()
  for(const t of tasks){
    if(!t || t.type === "marker" || t.daily) continue
    const at = doneMap?.[t.id]
    const done = !!at
    if(done && !(typeof at === "number" && localKey(new Date(at)) === today)) continue
    const s = subjectOf(t.subject || "")
    const due = t.end || ""
    const key = [s.name, due, done].join("\u0000")
    if(!rows.has(key)) rows.set(key, { subject: s.name, color: s.color, icon: s.icon || "", lines: [], due, done })
    rows.get(key).lines.push(t.name || "")
  }
  return [...rows.values()].sort((a, b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || a.subject.localeCompare(b.subject, "th"))
}
