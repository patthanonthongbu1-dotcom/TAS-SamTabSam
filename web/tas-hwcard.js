// Homework card ("design A"): what goes on it, decided without any DOM so
// node can test it. tas-card.js paints the model; calendar.html builds it
// from real tasks (fromTasks) and announce.html from rows typed by hand.
//
// A row:     { subject, code, teacher, color, icon, lines:[string], due:"YYYY-MM-DD"|"",
//              dueAt:"คาบ 3"|"08:00"|"", send:key of SEND|"", photos? }
// A section: { icon, title, rows:[row] } — rows are numbered 1, 2… inside it

export const MAX_ROWS = 12          // past this the card says "+N รายการ"

// How the work is handed in. Tasks store the key; the card shows the label.
export const SEND = {
  classroom: "Google Classroom",
  paper:     "ส่งกระดาษ",
  check:     "ตรวจกับครู",
  online:    "ส่งออนไลน์",
}

const WEEKDAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]
const MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN }
const dayDiff = (a, b) => Math.round((ymd(a) - ymd(b)) / 864e5)
export const weekdayOf = s => WEEKDAYS[new Date(ymd(s)).getUTCDay()] || ""
export const shortThai = s => { const d = new Date(ymd(s)); return isNaN(d) ? "" : `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` }
export const localKey = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")

/** Due date (+ optional period/time) → the pill on the right of a row,
    or null for no pill. "ส่งพรุ่งนี้ · คาบ 3" */
export function duePill(due, today, at = ""){
  at = String(at || "").trim()
  if(!due || isNaN(ymd(due))) return at ? { label: "ส่ง " + at, tone: "grey" } : null
  const d = dayDiff(due, today)
  const p = d < 0 ? { label: "เลยกำหนด", tone: "red" }
    : d === 0 ? { label: "ส่งวันนี้", tone: "red" }
    : d === 1 ? { label: "ส่งพรุ่งนี้", tone: "orange" }
    : d < 7 ? { label: "ส่งวัน" + weekdayOf(due), tone: "grey" }
    : { label: "ส่ง " + shortThai(due), tone: "grey" }
  if(at && d >= 0) p.label += " · " + at
  return p
}

/** Everything the painter needs. Empty rows and sections drop out. */
export function cardModel({ date, name = "", sections = [] }, today = date){
  let left = MAX_ROWS, total = 0
  const out = []
  for(const sec of sections){
    const rows = (sec.rows || [])
      .filter(r => r && ((r.subject || "").trim() || (r.lines || []).some(l => (l || "").trim())))
      .map(r => ({ ...r, lines: (r.lines || []).map(l => (l || "").trim()).filter(Boolean) }))
    total += rows.length
    const shown = rows.slice(0, Math.max(0, left)).map((r, i) => ({ ...r, n: i + 1, pill: duePill(r.due, today, r.dueAt) }))
    left -= shown.length
    if(shown.length) out.push({ icon: sec.icon || "", title: (sec.title || "").trim(), rows: shown })
  }
  const shownCount = out.reduce((n, s) => n + s.rows.length, 0)
  return { date, weekday: weekdayOf(date), name: (name || "").trim(), sections: out, more: total - shownCount }
}

/**
 * Calendar adapter → one section of rows. Every task not done; same
 * subject + due share a row. Markers and dailies stay off.
 * subjectOf(name) → { name, code, teacher, color, icon } from the shared list (or fallback).
 */
export function fromTasks(tasks, doneMap, subjectOf){
  const rows = new Map()
  for(const t of tasks){
    if(!t || t.type === "marker" || t.daily || doneMap?.[t.id]) continue
    const s = subjectOf(t.subject || "")
    const due = t.end || ""
    const key = s.name + "\u0000" + due
    if(!rows.has(key)) rows.set(key, { subject: s.name, code: s.code || "", teacher: s.teacher || "", color: s.color, icon: s.icon || "", lines: [], due, dueAt: "", send: "" })
    const r = rows.get(key)
    r.lines.push(t.name || "")
    r.dueAt ||= t.dueAt || ""          // merged tasks: the first one that says wins
    r.send ||= SEND[t.send] ? t.send : ""
  }
  return [...rows.values()].sort((a, b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || a.subject.localeCompare(b.subject, "th"))
}
