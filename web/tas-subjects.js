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
  return items.filter(it => keys(it).some(k => (k.length >= 3 && q.startsWith(k)) || k.startsWith(q)))
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
  ["ท23102", "ภาษาไทย", "ไทย", "#7c3aed", "✏️", [], "ครูศุภานกุล"],
  ["ค23102", "คณิตศาสตร์พื้นฐาน", "คณิตพื้นฐาน", "#2563eb", "📐", ["คณิตศาสตร์พื้นฐาน 5"], "ครูอรพรรณ"],
  ["ค23202", "คณิตศาสตร์เพิ่มเติม", "คณิตเพิ่ม", "#0369a1", "📐", [], "ครูช่อเอื้อง"],
  ["ว23102", "วิทยาศาสตร์", "วิทย์", "#16a34a", "🔬", ["EP Lab"], "T.Deon"],
  ["ว23104", "Computer (EP Com)", "Com", "#0891b2", "💻", ["ว23210"], "T.Jeff"],
  ["ว23206", "Robot", "Robot", "#0f766e", "💻", [], "ครูธัชกรณ์"],
  ["ว23208", "วิทยาการ Robot", "วิทยาการ", "#4d7c0f", "💻", [], ""],
  ["ส23102", "สังคมศึกษา", "สังคม", "#d97706", "📚", [], "ครูพริษฐ์"],
  ["ส23104", "ประวัติศาสตร์", "ประวัติ", "#b45309", "📚", [], "ครูพรรษา"],
  ["อ23102", "English Core", "Eng Core", "#dc2626", "📝", ["อังกฤษ Core"], "T.Allan"],
  ["อ23212", "English Reading & Writing", "Eng R&W", "#be123c", "📝", ["อังกฤษ R&W"], "T.Jerome"],
  ["อ23204", "English Communication", "Eng Comm", "#db2777", "📝", ["อังกฤษสื่อสาร"], "T.Miles"],
  ["ศ23102", "ศิลปะ", "ศิลปะ", "#a21caf", "🎨", [], "ครูปัทพงษ์"],
  ["พ23102", "สุขศึกษา", "สุขศึกษา", "#65a30d", "🏃", [], "T.Lad"],
  ["ง23102", "การงานอาชีพ", "การงาน", "#64748b", "📝", [], ""],
  ["ก23902", "แนะแนว", "แนะแนว", "#475569", "📝", [], "ครูเกศสุดา"],
  ["I23202", "IS", "IS", "#334155", "📚", [], "ครูธีรพัชร์"],
].map(([code, name, short, color, icon, aliases, teacher]) => ({ id: code, code, name, short, teacher, color, icon, aliases }))
