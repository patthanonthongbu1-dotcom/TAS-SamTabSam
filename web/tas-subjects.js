// Shared subject list: one entry per subject, so a task's subject is picked
// rather than typed and "คณิตพื้นฐาน" can't drift into "คณิตศาสตร์พื้นฐาน 5".
// Pure — no Firebase — so node can test it. Stored at subjects/list.

export const MAX_SUBJECTS = 60

export const norm = s => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase()

const HEX = /^#[0-9a-f]{6}$/i
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
    out.push({
      id: str(it.id, 40) || norm(name),
      name,
      short: str(it.short, 20),
      color: HEX.test(it.color) ? it.color.toLowerCase() : "#64748b",
      icon: str(it.icon, 8),
      aliases: (Array.isArray(it.aliases) ? it.aliases : [])
        .map(a => str(a, 60)).filter(Boolean).slice(0, 20),
    })
    if(out.length >= MAX_SUBJECTS) break
  }
  return out
}

// Typed or legacy text → the list entry it means, or null. Exact name, short
// name, alias, then a prefix either way ("คณิต" ↔ "คณิตศาสตร์พื้นฐาน 5").
// A prefix that fits two subjects is ambiguous and returns null.
export function match(text, items){
  const q = norm(text)
  if(!q || !items?.length) return null
  const keys = it => [it.name, it.short, ...(it.aliases || [])].map(norm).filter(Boolean)
  const exact = items.find(it => keys(it).includes(q))
  if(exact) return exact
  const hits = items.filter(it => keys(it).some(k => q.startsWith(k) || k.startsWith(q)))
  return hits.length === 1 ? hits[0] : null
}

export const colorOf = (name, items) => match(name, items)?.color || null
