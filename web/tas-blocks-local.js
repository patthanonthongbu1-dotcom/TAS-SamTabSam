/* ─────────────────────────────────────────────────────────────
   TAS Blocks — the on-device copy.

   Signed out, a day plan lives in localStorage instead of Firestore,
   the same trade calendar.html makes for ticks (tas_guest_state): per
   device, no sync, gone with a cleared browser. Signed in, the same
   shape holds the days whose write hasn't been confirmed yet, so a
   tab closed mid-debounce doesn't take the last edit with it.

   No Firestore import, so this loads under node: every function takes
   the storage object, and the test hands it an in-memory stand-in.
   ───────────────────────────────────────────────────────────── */

import { sanitizeBlocks } from "./tas-blocks-state.js"

export const GUEST_KEY = "tas_blocks_guest"
export const PENDING_KEY = "tas_blocks_pending"

/* { "YYYY-MM-DD": blocks } under `key`, or {} when absent or unreadable —
   a private window can throw on access, and that must read as "nothing". */
export function readMap(storage, key) {
  try {
    const raw = JSON.parse(storage.getItem(key) || "null")
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      const bl = sanitizeBlocks(v)
      if (bl.length) out[k] = bl
    }
    return out
  } catch (e) { return {} }
}

function writeMap(storage, key, map) {
  try {
    if (Object.keys(map).length) storage.setItem(key, JSON.stringify(map))
    else storage.removeItem(key)
    return true
  } catch (e) { return false }
}

/* Every day from fromKey to toKey inclusive. Keys are YYYY-MM-DD, which
   compare the same as the dates they name — the same trick the Firestore
   range query leans on. */
export function rangeOf(storage, key, fromKey, toKey) {
  const out = {}
  for (const [k, v] of Object.entries(readMap(storage, key)))
    if (k >= fromKey && k <= toKey) out[k] = v
  return out
}

/* An emptied day is removed rather than kept as [], matching saveDay's
   delete. True only if the write landed. */
export function putDay(storage, key, dayKey, blocks) {
  const map = readMap(storage, key)
  if (blocks.length) map[dayKey] = blocks
  else delete map[dayKey]
  return writeMap(storage, key, map)
}

export function clearKey(storage, key) {
  try { storage.removeItem(key) } catch (e) {}
}
