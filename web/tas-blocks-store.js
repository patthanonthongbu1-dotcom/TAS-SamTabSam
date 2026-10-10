/* ─────────────────────────────────────────────────────────────
   TAS Blocks — Firestore layer.

   Owns `dayPlans/{uid}/days/{YYYY-MM-DD}` and nothing else. One
   document per day holding one `blocks` array: a drag rewrites the
   order of every block in the day, and as one document that is one
   write rather than one per block.

   Writes are debounced per day, like the To Do reorder: typing,
   ticking and dragging come in bursts and only the last state of
   the day needs to land. An emptied day is deleted rather than
   left behind as a doc with an empty array.
   ───────────────────────────────────────────────────────────── */

import { collection, doc, getDocs, setDoc, deleteDoc, query, where, documentId }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"
import { sanitizeBlocks } from "./tas-blocks-state.js"

export const SAVE_DEBOUNCE_MS = 500

let _db = null
export function initBlocksStore(db) { _db = db }

const days = uid => collection(_db, "dayPlans", uid, "days")

/* Every day from `fromKey` to `toKey` inclusive, as { key: blocks }.
   Doc ids are YYYY-MM-DD, which sort the same as the dates they name,
   so a month is one range query on the id. Returns null when the read
   failed, so the caller can tell "nothing planned" from "offline". */
export async function loadRange(uid, fromKey, toKey) {
  if (!_db || !uid) return null
  try {
    const snap = await getDocs(query(days(uid),
      where(documentId(), ">=", fromKey), where(documentId(), "<=", toKey)))
    const out = {}
    snap.forEach(d => { out[d.id] = sanitizeBlocks(d.data().blocks) })
    return out
  } catch (e) {
    console.warn("Could not load day plans:", e)
    return null
  }
}

/* Whole-document write, no merge: `blocks` is held in full, and a merge
   would keep deleted blocks alive. True only if Firestore accepted it. */
export async function saveDay(uid, key, blocks) {
  if (!_db || !uid) return false
  try {
    const ref = doc(_db, "dayPlans", uid, "days", key)
    if (!blocks.length) await deleteDoc(ref)
    else await setDoc(ref, { v: 1, updatedAt: Date.now(), blocks })
    return true
  } catch (e) {
    console.warn("Could not save the day plan:", e)
    return false
  }
}

/* ── Debounced writes, one timer per day ─────────────────── */
const pending = new Map()   // key → { uid, blocks, onResult, timer }

export function queueSave(uid, key, blocks, onResult) {
  const was = pending.get(key)
  if (was) clearTimeout(was.timer)
  const timer = setTimeout(() => flushDay(key), SAVE_DEBOUNCE_MS)
  pending.set(key, { uid, blocks, onResult, timer })
}

async function flushDay(key) {
  const p = pending.get(key)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(key)
  const ok = await saveDay(p.uid, key, p.blocks)
  if (p.onResult) p.onResult(ok, p.blocks)
}

/* Exposed so the page can push the writes out when the tab is hidden or
   closed — a debounce that never fires loses the last edit. */
export function flushAll() { return Promise.all([...pending.keys()].map(flushDay)) }
export const hasPendingSave = () => pending.size > 0
