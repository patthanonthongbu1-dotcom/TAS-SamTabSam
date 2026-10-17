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

import { collection, doc, getDocs, setDoc, deleteDoc, query, where, documentId, limit }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"
import { sanitizeBlocks } from "./tas-blocks-state.js"
import * as Local from "./tas-blocks-local.js"

// Signed out (uid null) every read and write goes to the device instead.
const store = () => globalThis.localStorage

export const SAVE_DEBOUNCE_MS = 500

let _db = null
export function initBlocksStore(db) { _db = db }

const days = uid => collection(_db, "dayPlans", uid, "days")

/* Every day from `fromKey` to `toKey` inclusive, as { key: blocks }.
   Doc ids are YYYY-MM-DD, which sort the same as the dates they name,
   so a month is one range query on the id. Returns null when the read
   failed, so the caller can tell "nothing planned" from "offline". */
export async function loadRange(uid, fromKey, toKey) {
  if (!uid) return Local.rangeOf(store(), Local.GUEST_KEY, fromKey, toKey)
  if (!_db) return null
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
  if (!uid) return Local.putDay(store(), Local.GUEST_KEY, key, blocks)
  if (!_db) return false
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
  // Lands synchronously, so it survives a tab closed before the debounce
  // fires; replayPending sends it next visit. Guests write locally anyway.
  if (uid) Local.putDay(store(), Local.PENDING_KEY, key, blocks.length ? blocks : [PENDING_EMPTY])
}

/* An emptied day still has to reach Firestore as a delete, but putDay
   drops empty days — so it is held as one marker block instead. */
const PENDING_EMPTY = { id: "__empty__", text: "__empty__", part: "morning", cat: "other", done: false }
const isEmptyMarker = bl => bl.length === 1 && bl[0].id === PENDING_EMPTY.id

async function flushDay(key) {
  const p = pending.get(key)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(key)
  const ok = await saveDay(p.uid, key, p.blocks)
  // Only a confirmed write, and only if no newer edit was queued meanwhile.
  if (ok && p.uid && !pending.has(key)) Local.putDay(store(), Local.PENDING_KEY, key, [])
  if (p.onResult) p.onResult(ok, p.blocks)
}

/* Days whose write never got confirmed last visit, sent now. Each is
   removed from the pending copy only once Firestore takes it. */
export async function replayPending(uid) {
  if (!uid || !_db) return 0
  let n = 0
  for (const [key, bl] of Object.entries(Local.readMap(store(), Local.PENDING_KEY))) {
    if (await saveDay(uid, key, isEmptyMarker(bl) ? [] : bl)) {
      Local.putDay(store(), Local.PENDING_KEY, key, []); n++
    }
  }
  return n
}

/* Planned some days before signing in? Keep them — but only into an
   account with no plans of its own, the rule calendar.html uses for
   ticks: merging into a used account could resurrect someone else's
   plans from this browser. Cleared only after every write lands. */
export async function adoptGuest(uid) {
  if (!uid || !_db) return 0
  const guest = Local.readMap(store(), Local.GUEST_KEY)
  const keys = Object.keys(guest)
  if (!keys.length) return 0
  let accountEmpty
  try { accountEmpty = (await getDocs(query(days(uid), limit(1)))).empty }
  catch (e) { return 0 }   // offline: leave the local copy for next time
  if (!accountEmpty) { Local.clearKey(store(), Local.GUEST_KEY); return 0 }
  // A day that fails goes to the pending copy, which replayPending retries
  // whatever the account holds — left here, the next sign-in would see a
  // no-longer-empty account and throw it away.
  let n = 0
  for (const k of keys) {
    if (await saveDay(uid, k, guest[k])) n++
    else Local.putDay(store(), Local.PENDING_KEY, k, guest[k])
  }
  Local.clearKey(store(), Local.GUEST_KEY)
  return n
}

/* Exposed so the page can push the writes out when the tab is hidden or
   closed — a debounce that never fires loses the last edit. */
export function flushAll() { return Promise.all([...pending.keys()].map(flushDay)) }
export const hasPendingSave = () => pending.size > 0
