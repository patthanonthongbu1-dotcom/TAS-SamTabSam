/* ─────────────────────────────────────────────────────────────
   TAS Blocks — the arithmetic.

   A day plan is one array of blocks; each knows which part of the
   day it belongs to, and its place in the array is its order within
   that part. Everything here takes an array and returns a new one,
   with no DOM and no Firestore, so it can be tested on its own —
   the same split as tas-todo-state.js.
   ───────────────────────────────────────────────────────────── */

export const PARTS = [
  { id: "morning",   label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening",   label: "Evening" }
]
export const CATS = [
  { id: "study",   label: "Study" },
  { id: "project", label: "Project" },
  { id: "rest",    label: "Rest" },
  { id: "other",   label: "Other" }
]
// Mirrors the 60-block cap in firestore.rules, so the page refuses before
// Firestore does and the error is one we can word ourselves.
export const MAX_BLOCKS = 60
export const MAX_TEXT = 200

const PART_IDS = PARTS.map(p => p.id)
const CAT_IDS = CATS.map(c => c.id)

/* A local calendar date as the doc id. Not toISOString(): that is UTC,
   and before 07:00 in Thailand it names yesterday. */
export function dayKey(d) {
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0")
}
export function keyToDate(k) { return new Date(k + "T00:00:00") }
export function addDays(k, n) {
  const d = keyToDate(k)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/* Text typed as "Morning: math, systems of equations" lands in the
   morning whatever section it was typed into — the way the idea was
   first described, and quicker than dragging it afterwards. */
export function parseEntry(raw, fallbackPart) {
  let text = String(raw ?? "").trim()
  let part = fallbackPart
  const m = text.match(/^(morning|afternoon|evening)\s*[:\-–]\s*(.+)$/i)
  if (m) { part = m[1].toLowerCase(); text = m[2].trim() }
  return { text: text.slice(0, MAX_TEXT), part }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export function makeBlock({ text, part, cat = "study", taskId = null }) {
  const b = { id: newId(), text: String(text).slice(0, MAX_TEXT), part, cat, done: false }
  if (taskId) b.taskId = taskId
  return b
}

/* Reads are cleaned on the way in: a hand-edited doc, or one written by a
   newer client, can never hand the renderer a part or category it has no
   column or colour for. */
export function sanitizeBlocks(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(b => b && typeof b.text === "string" && b.text.trim()).map(b => {
    const out = {
      id: typeof b.id === "string" && b.id ? b.id : newId(),
      text: b.text.slice(0, MAX_TEXT),
      part: PART_IDS.includes(b.part) ? b.part : "morning",
      cat: CAT_IDS.includes(b.cat) ? b.cat : "other",
      done: b.done === true
    }
    if (typeof b.taskId === "string" && b.taskId) out.taskId = b.taskId
    return out
  }).slice(0, MAX_BLOCKS)
}

export const inPart = (blocks, part) => blocks.filter(b => b.part === part)

/* Array order is display order within a part, so a new block goes after
   the last one already in its part rather than at the very end. */
export function addBlock(blocks, block) {
  if (blocks.length >= MAX_BLOCKS) return blocks
  let at = -1
  blocks.forEach((b, i) => { if (b.part === block.part) at = i })
  if (at === -1) return [...blocks, block]
  return [...blocks.slice(0, at + 1), block, ...blocks.slice(at + 1)]
}

export function updateBlock(blocks, id, patch) {
  return blocks.map(b => {
    if (b.id !== id) return b
    const next = { ...b, ...patch }
    if (!next.taskId) delete next.taskId
    return next
  })
}

export const removeBlock = (blocks, id) => blocks.filter(b => b.id !== id)

/* Moves `id` into `part`, before the block `beforeId` — or to the end of
   that part when beforeId is null. One function covers both reordering
   and moving between sections, since they are the same act. */
export function moveBlock(blocks, id, part, beforeId) {
  const moving = blocks.find(b => b.id === id)
  if (!moving || beforeId === id) return blocks
  const rest = blocks.filter(b => b.id !== id)
  const placed = { ...moving, part }
  if (beforeId) {
    const i = rest.findIndex(b => b.id === beforeId)
    if (i !== -1) return [...rest.slice(0, i), placed, ...rest.slice(i)]
  }
  return addBlock(rest, placed)
}

export function progress(blocks) {
  return { done: blocks.filter(b => b.done).length, total: blocks.length }
}

/* Copying a day adds to whatever is already planned for the target day
   rather than replacing it, and every copy starts unticked. Returns the
   target's new list and how many were actually copied (the cap can cut
   it short). */
export function copyInto(from, to) {
  let out = to
  let n = 0
  for (const b of from) {
    if (out.length >= MAX_BLOCKS) break
    out = addBlock(out, makeBlock({ text: b.text, part: b.part, cat: b.cat, taskId: b.taskId }))
    n++
  }
  return { blocks: out, copied: n }
}
