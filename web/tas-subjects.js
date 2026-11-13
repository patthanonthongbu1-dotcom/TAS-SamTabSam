// Shared subject list: one entry per subject, so a task's subject is picked
// rather than typed and "คณิตพื้นฐาน" can't drift into "คณิตศาสตร์พื้นฐาน 5".
// Each subject carries its course code (อ23102…) — the one spelling that
// never varies, and the only way to tell three Englishes apart.
// Pure — no Firebase — so node can test it. Stored at subjects/list.

export const MAX_SUBJECTS = 60

// Case, spacing and punctuation don't make a different subject:
// "English Core", "english-core" and "Eng.Core" all compare alike.
export const norm = s => String(s ?? "").normalize("NFC").toLowerCase().replace(/[\s.\-&_/]+/g, "")

const HEX = /^#[0-9a-f]{6}$/i
const CODE = /^[\p{L}\p{N}]{1,10}$/u
const str = (v, n) => String(v ?? "").trim().slice(0, n)

// Whatever came back from Firestore or the settings form, made safe to use
export function sanitize(items){
  if(!Array.isArray(items)) return []
  const seen = new Set()
  const out = []
  for(const it of items){
    if(!it || typeof it !== "object") continue
    const name = str(it.name, 60)
    if(!name || seen.has(norm(name))) continue
    seen.add(norm(name))
    const code = str(it.code, 10)
    out.push({
      id: str(it.id, 40) || code || norm(name),
      code: CODE.test(code) ? code : "",
      name,
      short: str(it.short, 20),
      teacher: str(it.teacher, 40),
      color: HEX.test(it.color) ? it.color.toLowerCase() : "#64748b",
      icon: str(it.icon, 8),
      aliases: (Array.isArray(it.aliases) ? it.aliases : [])
        .map(a => str(a, 60)).filter(Boolean).slice(0, 20),
    })
    if(out.length >= MAX_SUBJECTS) break
  }
  return out
}

/* Every list entry the text could mean. A course code at the start settles
   it outright ("อ23102", "อ23102 อังกฤษ"); then an exact name / short /
   alias; then a prefix either way ("คณิต" ↔ "คณิตศาสตร์พื้นฐาน 5"). The
   "text starts with key" direction needs a key of 3+ characters, so a
   short name like "IS" can't swallow every word that begins with it. */
export function candidates(text, items){
  const q = norm(text)
  if(!q || !items?.length) return []
  const byCode = items.find(it => it.code && q.startsWith(norm(it.code)))
  if(byCode) return [byCode]
  const keys = it => [it.name, it.short, it.teacher, ...(it.aliases || [])].map(norm).filter(Boolean)
  const exact = items.filter(it => keys(it).includes(q))
  if(exact.length) return exact
  // The longest key that fits wins, so "Communications" is English
  // Communication ("communication"), not Computer ("com")
  const fit = it => Math.max(0, ...keys(it).map(k => k.length >= 3 && q.startsWith(k) ? k.length : k.startsWith(q) ? q.length : 0))
  const best = Math.max(0, ...items.map(fit))
  return best ? items.filter(it => fit(it) === best) : []
}

// At most one edit (insert, delete, swap a letter) apart
function oneEdit(a, b){
  if(Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while(i < a.length && j < b.length){
    if(a[i] === b[j]){ i++; j++; continue }
    if(++edits > 1) return false
    if(a.length > b.length) i++
    else if(a.length < b.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/* Search-as-you-type for the subject box, best first. Every word typed
   has to fit the subject somewhere — code, name, short, teacher, alias —
   so "eng core", "english > core" and "คณิต core" each narrow to one.
   Only when nothing fits as typed is a word of 4+ letters (no digits, so
   codes stay exact) let one typo off ("Englsh"). */
export function search(query, items, typos = false){
  if(!items?.length) return []
  const words = String(query ?? "").split(/[\s>]+/).map(norm).filter(Boolean)
  if(!words.length) return [...items]
  const keysOf = it => [it.code, it.name, it.short, it.teacher, ...(it.aliases || [])]
    .flatMap(k => [k, ...String(k || "").split(/[\s()]+/)]).map(norm).filter(Boolean)
  const scored = []
  for(const it of items){
    const ks = keysOf(it)
    let total = 0
    for(const w of words){
      let s = 0
      for(const k of ks){
        s = Math.max(s, k === w ? 4 : k.startsWith(w) ? 3 : k.includes(w) ? 2
          : typos && w.length >= 4 && !/\d/.test(w) && [-1, 0, 1].some(d => oneEdit(w, k.slice(0, w.length + d))) ? 1 : 0)
      }
      if(!s){ total = 0; break }
      total += s
    }
    if(total) scored.push([total, it])
  }
  if(!scored.length && !typos) return search(query, items, true)
  return scored.sort((a, b) => b[0] - a[0]).map(x => x[1])
}

// The one entry the text means, or null — none, or more than one
export function match(text, items){
  const c = candidates(text, items)
  return c.length === 1 ? c[0] : null
}

export const colorOf = (name, items) => match(name, items)?.color || null

// "อ23102 · English Core" — how a subject is offered in a dropdown
export const label = s => (s.code ? s.code + " · " : "") + s.name

/* ม.3/3, semester 2/2569, from the class timetable. A starting point for
   Settings → Subjects; every row stays editable. The teacher shows on the
   card and also matches, so "T.Allan" finds English Core. Icons are picker emoji, which the card
   draws as SVG. Homeroom, clubs, Career Based, EAC and PE are left out —
   they don't set homework. */
export const TIMETABLE = [
  ["ท23102", "ภาษาไทย", "ไทย", "#7c3aed", "✏️", ["Thai"], "ครูศุภานกุล"],
  ["ค23102", "คณิตศาสตร์พื้นฐาน", "คณิตพื้นฐาน", "#2563eb", "📐", ["คณิตศาสตร์พื้นฐาน 5", "Math Core"], "ครูอรพรรณ"],
  ["ค23202", "คณิตศาสตร์เพิ่มเติม", "คณิตเพิ่ม", "#0369a1", "📐", ["Math Sup", "Math Supplement", "Supplement"], "ครูช่อเอื้อง"],
  ["ว23102", "วิทยาศาสตร์", "วิทย์", "#16a34a", "🔬", ["EP Lab", "Science"], "T.Deon"],
  ["ว23104", "Computer (EP Com)", "Com", "#0891b2", "💻", ["ว23210", "Coding"], "T.Jeff"],
  ["ว23206", "Robot", "Robot", "#0f766e", "💻", ["หุ่นยนต์"], "ครูธัชกรณ์"],
  ["ว23208", "วิทยาการ Robot", "วิทยาการ", "#4d7c0f", "💻", [], ""],
  ["ส23102", "สังคมศึกษา", "สังคม", "#d97706", "📚", ["Social"], "ครูพริษฐ์"],
  ["ส23104", "ประวัติศาสตร์", "ประวัติ", "#b45309", "📚", ["History"], "ครูพรรษา"],
  ["อ23102", "English Core", "Eng Core", "#dc2626", "📝", ["อังกฤษ Core"], "T.Allan"],
  ["อ23212", "English Reading & Writing", "Eng R&W", "#be123c", "📝", ["อังกฤษ R&W", "R&W", "Reading & Writing", "Reading"], "T.Jerome"],
  ["อ23204", "English Communication", "Eng Comm", "#db2777", "📝", ["อังกฤษสื่อสาร", "Comm", "Communication"], "T.Miles"],
  ["ศ23102", "ศิลปะ", "ศิลปะ", "#a21caf", "🎨", ["Art", "นาฏศิลป์", "นาฎศิลป์", "Thai Dance"], "ครูปัทพงษ์"],
  ["พ23102", "สุขศึกษา", "สุขศึกษา", "#65a30d", "🏃", ["Health"], "T.Lad"],
  ["ง23102", "การงานอาชีพ", "การงาน", "#64748b", "📝", ["Career"], ""],
  ["ก23902", "แนะแนว", "แนะแนว", "#475569", "📝", ["Guidance"], "ครูเกศสุดา"],
  ["I23202", "IS", "IS", "#334155", "📚", [], "ครูธีรพัชร์"],
].map(([code, name, short, color, icon, aliases, teacher]) => ({ id: code, code, name, short, teacher, color, icon, aliases }))

// The saved list, or the timetable while nobody has saved one — so codes
// and colours show from day one instead of waiting on Settings → Subjects.
export const listOrTimetable = items => { const l = sanitize(items); return l.length ? l : sanitize(TIMETABLE) }

/* ── The class timetable: when each subject meets ─────────────
   ภาคเรียนที่ 2/2569, ม.3/3 ห้อง 168. Periods and their times, then each
   weekday's periods → subject code (a code may span two periods; both are
   listed, and the first of a block is "when it starts"). Non-subject slots
   (lunch, homeroom, clubs, assemblies) are left out. Used to suggest
   ส่งตอน: "the subject's own period on the day it's due". */
export const PERIODS = [
  null,
  { start: "08:20", end: "09:10" }, { start: "09:10", end: "10:00" }, { start: "10:00", end: "10:50" },
  { start: "10:50", end: "11:40" }, { start: "11:40", end: "12:30" }, { start: "12:30", end: "13:20" },
  { start: "13:20", end: "14:10" }, { start: "14:10", end: "15:00" }, { start: "15:00", end: "15:50" },
  { start: "15:50", end: "16:40" },
]
// weekday (1 = Monday … 5 = Friday) → { period: [codes] }
export const WEEK = {
  1: { 1: ["ว23104", "ว23210"], 2: ["ว23104", "ว23210"], 3: ["อ23212"], 4: ["ศ23102"], 5: ["ศ23102"], 7: ["อ23102"], 8: ["ท23102"], 9: ["พ23102"] },
  2: { 1: ["ส23102"], 2: ["I23202"], 3: ["ค23102"], 4: ["ค23102"], 6: ["ค23202"], 7: ["ค23202"], 8: ["ว23206"], 9: ["ว23206"] },
  3: { 1: ["ว23102"], 2: ["ว23102"], 4: ["อ23204"], 5: ["ส23102"], 7: ["อ23102"], 8: ["ท23102"] },
  4: { 1: ["ท23102"], 2: ["ส23104"], 3: ["ก23902"], 5: ["ส23102"], 6: ["อ23204"], 9: ["ว23208"], 10: ["ว23208"] },
  5: { 2: ["อ23102"], 3: ["ค23102"], 4: ["ง23102"], 6: ["ว23102"], 7: ["อ23212"] },
}
// "คาบ 3 · 10:00" — the label a card shows
export const periodLabel = n => PERIODS[n] ? `คาบ ${n} · ${PERIODS[n].start}` : ""
const weekdayOfYmd = ymd => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "")
  return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3])).getUTCDay() : -1
}
/** The periods `code` starts in on date `ymd` — one per block; [] when it doesn't meet */
export function classPeriods(code, ymd){
  const day = WEEK[weekdayOfYmd(ymd)]
  if (!day || !code) return []
  const c = norm(code), hit = p => (day[p] || []).some(x => norm(x) === c)
  const out = []
  for (let p = 1; p < PERIODS.length; p++) if (hit(p) && !hit(p - 1)) out.push(p)
  return out
}
