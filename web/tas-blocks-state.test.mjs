/* Tests for the pure Blocks state layer.
   Run from the repo root:  node --test web/ */

import test from "node:test"
import assert from "node:assert/strict"
import {
  dayKey, addDays, parseEntry, makeBlock, sanitizeBlocks, addBlock,
  moveBlock, removeBlock, updateBlock, progress, copyInto, inPart, MAX_BLOCKS
} from "./tas-blocks-state.js"

const b = (id, part, extra = {}) => ({ id, text: id, part, cat: "study", done: false, ...extra })
const ids = list => list.map(x => x.id).join(",")

test("dayKey is the local date, and addDays crosses month ends", () => {
  assert.equal(dayKey(new Date(2026, 9, 10, 2, 0)), "2026-10-10")
  assert.equal(addDays("2026-10-31", 1), "2026-11-01")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("parseEntry honours a typed part prefix", () => {
  assert.deepEqual(parseEntry("Morning: math, systems of equations", "evening"),
    { text: "math, systems of equations", part: "morning" })
  assert.deepEqual(parseEntry("  OC story sketches ", "afternoon"),
    { text: "OC story sketches", part: "afternoon" })
})

test("addBlock lands at the end of its own part", () => {
  const l = [b("m1", "morning"), b("a1", "afternoon"), b("m2", "morning")]
  const out = addBlock(l, b("m3", "morning"))
  assert.equal(ids(out), "m1,a1,m2,m3")
  assert.equal(ids(addBlock([b("a1", "afternoon"), b("e1", "evening")], b("a2", "afternoon"))), "a1,a2,e1")
})

test("moveBlock reorders within and across parts", () => {
  const l = [b("m1", "morning"), b("m2", "morning"), b("a1", "afternoon")]
  assert.equal(ids(inPart(moveBlock(l, "m2", "morning", "m1"), "morning")), "m2,m1")
  const across = moveBlock(l, "m1", "afternoon", null)
  assert.equal(ids(inPart(across, "afternoon")), "a1,m1")
  assert.equal(ids(inPart(across, "morning")), "m2")
  assert.equal(moveBlock(l, "m1", "morning", "m1"), l)
})

test("sanitizeBlocks drops junk and fixes unknown parts/categories", () => {
  const out = sanitizeBlocks([null, { text: "" }, { id: "x", text: "ok", part: "night", cat: "fun", done: "yes", taskId: 4 }])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { id: "x", text: "ok", part: "morning", cat: "other", done: false })
  assert.deepEqual(sanitizeBlocks("nope"), [])
})

test("update, remove, progress", () => {
  let l = [b("m1", "morning"), b("m2", "morning")]
  l = updateBlock(l, "m1", { done: true, taskId: null })
  assert.equal("taskId" in l[0], false)
  assert.deepEqual(progress(l), { done: 1, total: 2 })
  assert.equal(ids(removeBlock(l, "m1")), "m2")
})

test("copyInto appends unticked copies and respects the cap", () => {
  const from = [b("m1", "morning", { done: true, taskId: "t1" })]
  const { blocks, copied } = copyInto(from, [b("e1", "evening")])
  assert.equal(copied, 1)
  assert.equal(blocks.length, 2)
  const copy = inPart(blocks, "morning")[0]
  assert.equal(copy.done, false)
  assert.equal(copy.taskId, "t1")
  assert.notEqual(copy.id, "m1")
  const full = Array.from({ length: MAX_BLOCKS }, (_, i) => makeBlock({ text: "x" + i, part: "morning" }))
  assert.equal(copyInto(from, full).copied, 0)
})
