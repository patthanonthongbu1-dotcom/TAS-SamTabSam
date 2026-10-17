import { test } from "node:test"
import assert from "node:assert/strict"
import { readMap, rangeOf, putDay, clearKey, GUEST_KEY } from "./tas-blocks-local.js"

// localStorage's surface, in memory
function memStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _m: m
  }
}
const blk = text => ({ id: text, text, part: "morning", cat: "study", done: false })

test("a saved day reads back", () => {
  const s = memStorage()
  assert.equal(putDay(s, GUEST_KEY, "2026-10-17", [blk("math")]), true)
  assert.deepEqual(readMap(s, GUEST_KEY), { "2026-10-17": [blk("math")] })
})

test("range keeps only days inside it, inclusive", () => {
  const s = memStorage()
  for (const k of ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"]) putDay(s, GUEST_KEY, k, [blk(k)])
  assert.deepEqual(Object.keys(rangeOf(s, GUEST_KEY, "2026-10-01", "2026-10-31")).sort(),
    ["2026-10-01", "2026-10-31"])
})

test("an emptied day is removed, and the key goes with the last one", () => {
  const s = memStorage()
  putDay(s, GUEST_KEY, "2026-10-17", [blk("a")])
  putDay(s, GUEST_KEY, "2026-10-17", [])
  assert.deepEqual(readMap(s, GUEST_KEY), {})
  assert.equal(s._m.has(GUEST_KEY), false)
})

test("junk and a throwing storage both read as nothing", () => {
  const s = memStorage()
  s.setItem(GUEST_KEY, "{not json")
  assert.deepEqual(readMap(s, GUEST_KEY), {})
  s.setItem(GUEST_KEY, JSON.stringify(["array", "not map"]))
  assert.deepEqual(readMap(s, GUEST_KEY), {})
  const broken = { getItem() { throw new Error("blocked") }, setItem() { throw new Error("blocked") }, removeItem() { throw new Error("blocked") } }
  assert.deepEqual(readMap(broken, GUEST_KEY), {})
  assert.equal(putDay(broken, GUEST_KEY, "2026-10-17", [blk("a")]), false)
  clearKey(broken, GUEST_KEY)   // must not throw
})

test("reads are sanitized: a bad block is dropped, a bad part is fixed", () => {
  const s = memStorage()
  s.setItem(GUEST_KEY, JSON.stringify({ "2026-10-17": [{ text: "  " }, { id: "x", text: "ok", part: "midnight" }] }))
  const day = readMap(s, GUEST_KEY)["2026-10-17"]
  assert.equal(day.length, 1)
  assert.equal(day[0].part, "morning")
})
