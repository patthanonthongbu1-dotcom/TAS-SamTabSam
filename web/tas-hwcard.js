// Homework card ("design A"): what goes on it, decided without any DOM so
// node can test it. tas-card.js paints the model; calendar.html builds it
// from real tasks (fromTasks) and announce.html from rows typed by hand.
//
// A row:     { subject, code, teacher, color, icon, lines:[string | {text, style, size}], due:"YYYY-MM-DD"|"",
//              dueAt:"คาบ 3"|"08:00"|"", send:key of SEND|free text|"", kind:key of DUE_KINDS,
//              photos? }  — each line picks its own style/size (default pills, m)
// A section: { icon, title, rows:[row] } — rows are numbered 1, 2… inside it

export const MAX_ROWS = 12          // past this the card says "+N รายการ"
export const MAX_REMINDERS = 4      // the footer's "due tomorrow" box, then "+N"

// How the work is handed in. Tasks store the key; the card shows the label.
export const SEND = {
  classroom: "Google Classroom",
  paper:     "ส่งกระดาษ",
  check:     "ตรวจกับครู",
  online:    "ส่งออนไลน์",
}

export const sendLabel = v => SEND[v] || String(v || "").trim()

// What the due date is for. Keys past "homework" are the calendar's
// marker types, so a quiz typed here lands on the calendar as a quiz.
export const DUE_KINDS = {
  homework: { label: "Homework", verb: "ส่ง" },
  quiz:     { label: "Quiz",     verb: "ควิซ" },
  exam:     { label: "Exam",     verb: "สอบ" },
  event:    { label: "Event",    verb: "กิจกรรม" },
  date:     { label: "Important", verb: "สำคัญ" },
}

// How a row's lines are drawn, and how big
export const LINE_STYLES = { pills: "Pills", big: "Large pills", bullets: "Bullets", plain: "Plain text" }
export const LINE_SIZES = { s: 14, m: 16, l: 19 }

const WEEKDAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]
const MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) : NaN }
const dayDiff = (a, b) => Math.round((ymd(a) - ymd(b)) / 864e5)
export const weekdayOf = s => WEEKDAYS[new Date(ymd(s)).getUTCDay()] || ""
export const shortThai = s => { const d = new Date(ymd(s)); return isNaN(d) ? "" : `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` }
export const localKey = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")

/** Due date (+ optional period/time) → the pill on the right of a row,
    or null for no pill. "ส่งพรุ่งนี้ · คาบ 3", "ควิซวันศุกร์" */
export function duePill(due, today, at = "", kind = "homework"){
  at = String(at || "").trim()
  const hw = !DUE_KINDS[kind] || kind === "homework"
  const v = hw ? "ส่ง" : DUE_KINDS[kind].verb
  const calm = hw ? "grey" : "violet"     // a test stands out even when it's far off
  if(!due || isNaN(ymd(due))) return at ? { label: v + " " + at, tone: calm } : null
  const d = dayDiff(due, today)
  const p = d < 0 ? { label: hw ? "เลยกำหนด" : "ผ่านไปแล้ว", tone: hw ? "red" : "grey" }
    : d === 0 ? { label: v + "วันนี้", tone: "red" }
    : d === 1 ? { label: v + "พรุ่งนี้", tone: "orange" }
    : d < 7 ? { label: v + "วัน" + weekdayOf(due), tone: calm }
    : { label: v + " " + shortThai(due), tone: calm }
  if(at && d >= 0) p.label += " · " + at
  return p
}

// A line as the painter wants it: text plus a known style and size
export const lineOf = l => {
  const o = typeof l === "string" ? { text: l } : (l || {})
  return { text: String(o.text || "").trim(),
           style: LINE_STYLES[o.style] ? o.style : "pills",
           size: LINE_SIZES[o.size] ? o.size : "m" }
}

/** Everything the painter needs. Empty rows and sections drop out. */
export function cardModel({ date, name = "", sections = [], footer = null }, today = date){
  let left = MAX_ROWS, total = 0
  const out = []
  for(const sec of sections){
    const rows = (sec.rows || [])
      .filter(r => r && ((r.subject || "").trim() || (r.lines || []).some(l => lineOf(l).text)))
      .map(r => ({ ...r, lines: (r.lines || []).map(lineOf).filter(l => l.text) }))
    total += rows.length
    const shown = rows.slice(0, Math.max(0, left)).map((r, i) => ({ ...r, n: i + 1, pill: duePill(r.due, today, r.dueAt, r.kind) }))
    left -= shown.length
    if(shown.length) out.push({ icon: sec.icon || "", title: (sec.title || "").trim(), rows: shown })
  }
  const shownCount = out.reduce((n, s) => n + s.rows.length, 0)
  return { date, weekday: weekdayOf(date), name: (name || "").trim(), sections: out, more: total - shownCount,
           footer: footerModel(footer) }
}

/** The footer: a "due tomorrow" reminder box and the TAS QR. Either half
    may be missing; with neither there is no footer. */
export function footerModel(f){
  if(!f) return null
  const str = (v, n = 80) => String(v ?? "").trim().slice(0, n)
  const all = (f.reminders || [])
    .map(r => {
      const kind = DUE_KINDS[r?.kind] ? r.kind : "homework"
      const name = str(r?.name), dueAt = str(r?.dueAt, 16)
      return { subject: str(r?.subject), code: str(r?.code, 12), teacher: str(r?.teacher, 40),
               color: r?.color || "", icon: r?.icon || "", send: str(r?.send, 40), dueAt, kind, name,
               lines: name ? [lineOf(name)] : [],
               pill: { label: (kind === "homework" ? "Due" : DUE_KINDS[kind].label) + " tomorrow" + (dueAt ? " · " + dueAt : ""),
                       tone: kind === "homework" ? "orange" : "violet" } }
    })
    .filter(r => r.subject || r.name)
  const reminders = all.slice(0, MAX_REMINDERS).map((r, i) => ({ ...r, n: i + 1 }))
  const qr = f.qr && f.qr.svg ? { svg: f.qr.svg, url: String(f.qr.url || "") } : null
  if(!reminders.length && !qr) return null
  return { reminders, moreReminders: all.length - reminders.length, qr }
}

/** YYYY-MM-DD plus n days (calendar dates, no time zone involved). */
export const addDays = (s, n) => {
  const t = ymd(s)
  if(isNaN(t)) return ""
  const d = new Date(t + n * 864e5)
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0")
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
    r.send ||= String(t.send || "").trim().slice(0, 40)
  }
  return [...rows.values()].sort((a, b) =>
    (a.due || "9999").localeCompare(b.due || "9999") || a.subject.localeCompare(b.subject, "th"))
}
