/* ─────────────────────────────────────────────────────────────
   TAS To Do — pure state.

   The merge layer between `todo/{uid}.items` and the live task
   lists the calendar already holds. Deliberately free of both
   Firestore and the DOM so it can be run under `node --test`
   (see tas-todo-state.test.mjs) — every function here takes a
   list in and hands a new list back, never mutating its input.

   The governing rule: a todo item is a *view* over a task, not a
   copy of one. Nothing here ever reads or stores a task's name or
   due date — those are resolved fresh against the live task on
   every render, so renaming or deleting a task in the calendar is
   reflected in the To Do list without a migration.
   ───────────────────────────────────────────────────────────── */

export const DECK_LIMIT = 3
export const SOURCES = ["shared", "personal", "note"]

// The only keys that may ever reach Firestore. sanitizeItems() strips
// everything else, which is what stops a well-meaning future edit from
// caching `name`/`end` into the todo doc and drifting out of sync.
const ITEM_KEYS = ["id", "ref", "source", "text", "notes", "order", "deck", "createdAt"]

const MAX_TEXT  = 200
const MAX_NOTES = 2000

/* nanoid would be another CDN dependency for one line of work.
   randomUUID is on every browser this app already requires (it needs
   crypto.subtle for the moderator hash) and on Node >= 19 for the tests. */
export function newItemId() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

const clampStr = (v, max) => String(v == null ? "" : v).slice(0, max)

/* Order lives in one space shared by both lanes — the deck is a flag,
   not a second list — so an item keeps its place when it comes back out
   of the deck. */
export function makeItem({ ref = null, source, text = "", notes = "", order = 0, deck = false } = {}) {
  if (!SOURCES.includes(source)) throw new Error("Unknown todo source: " + source)
  return {
    id: newItemId(),
    ref: source === "note" ? null : (ref || null),
    source,
    text: source === "note" ? clampStr(text, MAX_TEXT) : "",
    notes: clampStr(notes, MAX_NOTES),
    order: Number(order) || 0,
    deck: !!deck,
    createdAt: Date.now()
  }
}

/* Firestore hands back whatever was last written, which after a bad
   deploy or a hand-edit in the console may be anything at all. Treat the
   stored array as untrusted and drop what can't be repaired. */
export function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const id = typeof r.id === "string" ? r.id : ""
    if (!id || seen.has(id)) continue
    const source = SOURCES.includes(r.source) ? r.source : (r.ref ? "shared" : "note")
    const ref = source === "note" ? null : (typeof r.ref === "string" && r.ref ? r.ref : null)
    // A non-note that lost its ref can only ever render as an orphan, so
    // it is junk rather than data.
    if (source !== "note" && !ref) continue
    seen.add(id)
    out.push({
      id,
      ref,
      source,
      text: source === "note" ? clampStr(r.text, MAX_TEXT) : "",
      notes: clampStr(r.notes, MAX_NOTES),
      order: Number.isFinite(r.order) ? r.order : out.length,
      deck: !!r.deck,
      createdAt: Number.isFinite(r.createdAt) ? r.createdAt : 0
    })
  }
  return normalizeOrder(out)
}

// Strip to the storable keys — the last gate before a write.
export function toStored(items) {
  return items.map(it => {
    const o = {}
    for (const k of ITEM_KEYS) o[k] = it[k]
    return o
  })
}

/* Renumber 0..n-1 in display order. Called after every structural change
   so `order` never drifts into fractions or collides. */
export function normalizeOrder(items) {
  return [...items]
    .sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt))
    .map((it, i) => (it.order === i ? it : { ...it, order: i }))
}

export const orderedItems = items => normalizeOrder(items)
export const listItems    = items => normalizeOrder(items).filter(it => !it.deck)
export const deckItems    = items => normalizeOrder(items).filter(it => it.deck)
export const deckIsFull   = items => items.filter(it => it.deck).length >= DECK_LIMIT

/* ── Resolving refs against the live tasks ──────────────────── */

/* One lookup for both task lists. Personal tasks win a collision: they
   are this user's own and nobody else can edit them away. Ids come from
   Firestore document ids, so a real clash is not a case worth designing
   around beyond picking a side. */
export function buildTaskIndex(tasks = [], personalTasks = []) {
  const index = new Map()
  for (const t of tasks) if (t && t.id) index.set(t.id, t)
  for (const t of personalTasks) if (t && t.id) index.set(t.id, t)
  return index
}

/* The renderable shape. `task` is the live doc — never a stored copy —
   and `orphan` marks an item whose task has since been deleted, so the
   UI can draw a "task removed" row instead of throwing on t.name. */
export function resolveItem(item, index) {
  if (item.source === "note") {
    return { ...item, task: null, orphan: false, title: item.text || "Untitled note",
             subject: "", type: "note", end: null, personal: false }
  }
  const task = index.get(item.ref) || null
  if (!task) {
    return { ...item, task: null, orphan: true, title: "Task removed",
             subject: "", type: "orphan", end: null, personal: item.source === "personal" }
  }
  return {
    ...item,
    task,
    orphan: false,
    title: task.name || "Untitled task",
    subject: task.subject || "",
    type: task.type || "normal",
    // Markers carry `date` where everything else carries `end`.
    end: task.end || task.date || null,
    personal: !!task._personal
  }
}

export function resolveItems(items, index) {
  return normalizeOrder(items).map(it => resolveItem(it, index))
}

/* Which tasks are already on the list — the pool greys these out so the
   same task can't be added twice. */
export function refIds(items) {
  return new Set(items.filter(it => it.ref).map(it => it.ref))
}

/* ── Mutations — all return a fresh, renumbered list ─────────── */

export function addItem(items, item) {
  // New arrivals land at the end of the To Do lane.
  return normalizeOrder([...items, { ...item, order: items.length }])
}

export function removeItem(items, id) {
  return normalizeOrder(items.filter(it => it.id !== id))
}

export function updateItem(items, id, patch) {
  return items.map(it => {
    if (it.id !== id) return it
    const next = { ...it }
    if ("notes" in patch) next.notes = clampStr(patch.notes, MAX_NOTES)
    if ("text" in patch && it.source === "note") next.text = clampStr(patch.text, MAX_TEXT)
    return next
  })
}

/* Move `dragId` to sit before or after `targetId`. Both lanes share one
   order space, so this is a single splice on the ordered list. */
export function moveItem(items, dragId, targetId, before = true) {
  if (dragId === targetId) return normalizeOrder(items)
  const ordered = normalizeOrder(items)
  const from = ordered.findIndex(it => it.id === dragId)
  if (from === -1) return ordered
  const [moved] = ordered.splice(from, 1)
  const to = ordered.findIndex(it => it.id === targetId)
  // Target gone (or never given) — park it at the end rather than lose it.
  if (to === -1) ordered.push(moved)
  else ordered.splice(before ? to : to + 1, 0, moved)
  return ordered.map((it, i) => (it.order === i ? it : { ...it, order: i }))
}

/* The deck cap lives here rather than in the UI so the tests cover it.
   Returns the reason instead of throwing: a rejected drop is a normal
   thing for someone to do, not an error. */
export function setDeck(items, id, deck) {
  const item = items.find(it => it.id === id)
  if (!item) return { items: normalizeOrder(items), ok: false, error: "That item is no longer here." }
  if (item.deck === !!deck) return { items: normalizeOrder(items), ok: true, error: null }
  if (deck && deckIsFull(items)) {
    return {
      items: normalizeOrder(items),
      ok: false,
      error: "The Focus Deck holds " + DECK_LIMIT + " — take something out first."
    }
  }
  return {
    items: normalizeOrder(items.map(it => (it.id === id ? { ...it, deck: !!deck } : it))),
    ok: true,
    error: null
  }
}
