// Homework card ("design A"): what goes on it, decided without any DOM so
// node can test it. tas-card.js paints the model; calendar.html builds it
// from real tasks (fromTasks) and announce.html from rows typed by hand.
//
// A row:     { subject, code, color, icon, lines:[string], due:"YYYY-MM-DD"|"", photos? }
// A section: { icon, title, rows:[row] } — rows are numbered 1, 2… inside it

export const MAX_ROWS = 12          // past this the card says "+N รายการ"

const WEEKDAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]
const MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN }
const dayDiff = (a, b) => Math.round((ymd(a) - ymd(b)) / 864e5)
export const weekdayOf = s => WEEKDAYS[new Date(ymd(s)).getUTCDay()] || ""
export const shortThai = s => { const d = new Date(ymd(s)); return isNaN(d) ? "" : `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` }
export const localKey = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")

/** Due date → the pill on the right of a row, or null for no pill. */
export function duePill(due, today){
  if(!due || isNaN(ymd(due))) return null
  const d = dayDiff(due, today)
  if(d < 0)  return { label: "เลยกำหนด", tone: "red" }
  if(d === 0) return { label: "ส่งวันนี้", tone: "red" }
  if(d === 1) return { label: "ส่งพรุ่งนี้", tone: "orange" }
  if(d < 7)  return { label: "ส่งวัน" + weekdayOf(due), tone: "grey" }
  return { label: "ส่ง " + shortThai(due), tone: "grey" }
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
    const shown = rows.slice(0, Math.max(0, left)).map((r, i) => ({ ...r, n: i + 1, pill: duePill(r.due, today) }))
    left -= shown.length
    if(shown.length) out.push({ icon: sec.icon || "", title: (sec.title || "").trim(), rows: shown })
  }
  const shownCount = out.reduce((n, s) => n + s.rows.length, 0)
  return { date, weekday: weekdayOf(date), name: (name || "").trim(), sections: out, more: total - shownCount }
}

/**
 * Calendar adapter → one section of rows. Every task not done; same
 * subject + due share a row. Markers and dailies stay off.
 * subjectOf(name) → { name, code, color, icon } from the shared list (or fallback).
 */
export function fromTasks(tasks, doneMap, subjectOf){
  const rows = new Map()
  for(const t of tasks){
    if(!t || t.type === "marker" || t.daily || doneMap?.[t.id]) continue
    const s = subjectOf(t.subject || "")
    const due = t.end || ""
    const key = s.name + "\u0000" + due
    if(!rows.has(key)) rows.set(key, { subject: s.name, code: s.code || "", color: s.color, icon: s.icon || "", lines: [], due })
    rows.get(key).lines.push(t.name || "")
  }
  return [...rows.values()].sort((a, b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || a.subject.localeCompare(b.subject, "th"))
}
