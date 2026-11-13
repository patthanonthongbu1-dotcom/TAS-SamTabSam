/* ─────────────────────────────────────────────────────────────
   Which calendar sections sit in the nav bar, and in what order.
   Everything not in the bar lives behind More. Pure, so node can test it;
   calendar.html does the moving of elements.
   ───────────────────────────────────────────────────────────── */
export const NAV_SECTIONS = ["calendar", "today", "todo", "tasks", "archive", "settings"]
export const NAV_DEFAULT = ["calendar", "today", "todo", "tasks"]
export const NAV_MAX = 4

/** A saved list made safe: known sections only, no repeats, 1–4 long */
export function normalizeNavBar(list) {
  const out = []
  for (const k of Array.isArray(list) ? list : []) {
    if (NAV_SECTIONS.includes(k) && !out.includes(k)) out.push(k)
    if (out.length === NAV_MAX) break
  }
  return out.length ? out : [...NAV_DEFAULT]
}

/** The sections More holds: everything not in the bar, in the usual order */
export const moreSections = bar => NAV_SECTIONS.filter(k => !bar.includes(k))

/** Turn a section on/off in the bar. Returns null when it can't (a 5th, or the last one). */
export function toggleInBar(bar, key) {
  if (bar.includes(key)) return bar.length > 1 ? bar.filter(k => k !== key) : null
  return bar.length < NAV_MAX && NAV_SECTIONS.includes(key) ? [...bar, key] : null
}

/** Move a section one step left (-1) or right (+1) in the bar */
export function moveInBar(bar, key, dir) {
  const i = bar.indexOf(key), j = i + dir
  if (i < 0 || j < 0 || j >= bar.length) return bar
  const next = [...bar];[next[i], next[j]] = [next[j], next[i]]
  return next
}
