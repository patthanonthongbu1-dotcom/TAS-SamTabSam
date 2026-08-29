/* ─────────────────────────────────────────────────────────────
   TAS To Do — Firestore layer.

   Owns `todo/{uid}` and nothing else. No DOM, no rendering, no
   knowledge of drag-and-drop: callers hand it a finished items
   array and it persists it.

   Why one document instead of a subcollection: the list is short,
   always read whole, and reordering touches every row's `order`.
   A subcollection would turn one drag into N writes.

   The write timing is the reason the three mutators exist rather
   than a bare saveTodo — add/remove are single deliberate acts and
   go out immediately, while reorder fires on every drop and is
   coalesced into one write ~500ms after the last one.
   ───────────────────────────────────────────────────────────── */

import { doc, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"
import { toStored, sanitizeItems } from "./tas-todo-state.js"

export const SAVE_DEBOUNCE_MS = 500

let _db = null

/* The calendar already has a Firestore handle; taking it here keeps this
   module from initialising a second app. */
export function initTodoStore(db) { _db = db }

const ref = uid => doc(_db, "todo", uid)

/* Reads are sanitised on the way in, so a hand-edited or half-migrated
   document can never reach the renderer. Returns null (not []) when the
   read itself failed, so the caller can tell "no list yet" apart from
   "couldn't reach Firestore" and refuse to overwrite real data. */
export async function loadTodo(uid) {
  if (!_db || !uid) return null
  try {
    const snap = await getDoc(ref(uid))
    if (!snap.exists()) return []
    return sanitizeItems(snap.data().items)
  } catch (e) {
    console.warn("Could not load the To Do list:", e)
    return null
  }
}

/* Whole-document write, no merge — same reasoning as userDone/{uid} in
   calendar.html: `items` is an array we hold in full, and a merge would
   leave deleted entries behind.

   Returns true only if Firestore accepted it; every caller rolls the
   optimistic UI back on false. */
export async function saveTodo(uid, items) {
  if (!_db || !uid) return false
  try {
    await setDoc(ref(uid), { v: 1, updatedAt: Date.now(), items: toStored(items) })
    return true
  } catch (e) {
    console.warn("Could not save the To Do list:", e)
    return false
  }
}

/* ── Debounced writes ────────────────────────────────────────
   One timer for the whole module: a flurry of drops is a flurry of calls,
   and only the final list needs to be written. */
let timer = null
let pending = null

function queueSave(uid, items, onResult) {
  pending = { uid, items, onResult }
  clearTimeout(timer)
  timer = setTimeout(flushTodo, SAVE_DEBOUNCE_MS)
}

/* A queued save holds the array as it was when the timer started. An
   immediate write that lands inside that window is always built from a
   newer array that already contains the queued change, so letting the
   timer fire afterwards would undo it — drop it instead. */
function dropPending() {
  clearTimeout(timer)
  timer = null
  pending = null
}

/* Exposed so the page can force the write out on unload — a debounce that
   never fires because the tab closed would lose the reorder. */
export async function flushTodo() {
  clearTimeout(timer)
  timer = null
  if (!pending) return true
  const { uid, items, onResult } = pending
  pending = null
  const ok = await saveTodo(uid, items)
  if (onResult) onResult(ok, items)
  return ok
}

export const hasPendingSave = () => pending !== null

/* ── The three mutators ──────────────────────────────────────
   Each takes the already-computed next list (the array maths lives in
   tas-todo-state.js) and differs only in when it writes. */

export const addItem    = (uid, items) => { dropPending(); return saveTodo(uid, items) }
export const removeItem = (uid, items) => { dropPending(); return saveTodo(uid, items) }

export function reorder(uid, items, onResult) { queueSave(uid, items, onResult) }
