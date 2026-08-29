/* Tests for the pure To Do state layer.
   Run from the repo root:  node --test web/
   No test framework — node's built-in runner, no new dependencies. */

import test from "node:test"
import assert from "node:assert/strict"
import {
  makeItem, sanitizeItems, toStored, normalizeOrder, orderedItems,
  buildTaskIndex, resolveItem, resolveItems,
  refIds, addItem, removeItem, updateItem, moveItem
} from "./tas-todo-state.js"

// Build a list with predictable ids so assertions can name them.
function list(...specs) {
  return specs.map((s, i) => ({
    id: s.id || "i" + i,
    ref: s.ref === undefined ? null : s.ref,
    source: s.source || (s.ref ? "shared" : "note"),
    text: s.text || "",
    notes: s.notes || "",
    order: s.order === undefined ? i : s.order,
    createdAt: s.createdAt === undefined ? 1000 + i : s.createdAt
  }))
}

const ids = arr => arr.map(it => it.id)

test("makeItem rejects an unknown source", () => {
  assert.throws(() => makeItem({ source: "nope" }), /Unknown todo source/)
})

test("makeItem never keeps a ref on a note, nor text on a task ref", () => {
  const note = makeItem({ source: "note", text: "buy folder", ref: "t1" })
  assert.equal(note.ref, null)
  assert.equal(note.text, "buy folder")

  const shared = makeItem({ source: "shared", ref: "t1", text: "ignored" })
  assert.equal(shared.ref, "t1")
  assert.equal(shared.text, "")
})

test("stored shape carries no task name or due date", () => {
  const index = buildTaskIndex([{ id: "t1", name: "Essay", end: "2026-09-01" }], [])
  const items = [makeItem({ source: "shared", ref: "t1" })]
  // Resolving adds title/end for rendering...
  assert.equal(resolveItems(items, index)[0].title, "Essay")
  // ...but none of it may reach Firestore.
  const stored = toStored(items)[0]
  assert.deepEqual(Object.keys(stored).sort(),
    ["createdAt", "id", "notes", "order", "ref", "source", "text"])
  assert.equal("title" in stored, false)
  assert.equal("end" in stored, false)
})

test("the retired Focus Deck flag never reaches Firestore again", () => {
  const stored = toStored(sanitizeItems([{ id: "a", ref: "t1", source: "shared", deck: true }]))[0]
  assert.equal("deck" in stored, false)
})

test("sanitizeItems drops junk, dedupes ids and repairs order", () => {
  const raw = [
    null,
    "nonsense",
    { id: "a", ref: "t1", source: "shared", order: 5 },
    { id: "a", ref: "t2", source: "shared", order: 6 },   // duplicate id
    { id: "b", source: "shared" },                        // non-note with no ref
    { id: "c", source: "note", text: "hi", order: 1 },
    { id: "d", ref: "t3", source: "weird", order: 0 }     // unknown source -> shared
  ]
  const out = sanitizeItems(raw)
  assert.deepEqual(ids(out), ["d", "c", "a"])
  assert.deepEqual(out.map(i => i.order), [0, 1, 2])
  assert.equal(out.find(i => i.id === "d").source, "shared")
})

test("sanitizeItems tolerates a missing or non-array field", () => {
  assert.deepEqual(sanitizeItems(undefined), [])
  assert.deepEqual(sanitizeItems({ items: [] }), [])
})

test("normalizeOrder breaks ties on createdAt and does not mutate", () => {
  const src = list({ id: "x", order: 0, createdAt: 20 }, { id: "y", order: 0, createdAt: 10 })
  const out = normalizeOrder(src)
  assert.deepEqual(ids(out), ["y", "x"])
  assert.deepEqual(src.map(i => i.order), [0, 0], "input untouched")
})

/* ── The merge: refs resolve against live tasks ─────────────── */

test("a ref resolves against the live task, not a stored copy", () => {
  const items = list({ id: "a", ref: "t1", source: "shared" })
  const before = buildTaskIndex([{ id: "t1", name: "Old name", end: "2026-09-01" }], [])
  const after  = buildTaskIndex([{ id: "t1", name: "New name", end: "2026-10-01" }], [])
  assert.equal(resolveItem(items[0], before).title, "Old name")
  assert.equal(resolveItem(items[0], after).title,  "New name")
  assert.equal(resolveItem(items[0], after).end,    "2026-10-01")
})

test("a deleted task renders as an orphan instead of throwing", () => {
  const items = list({ id: "a", ref: "gone", source: "shared" })
  const r = resolveItem(items[0], buildTaskIndex([], []))
  assert.equal(r.orphan, true)
  assert.equal(r.title, "Task removed")
  assert.equal(r.task, null)
  assert.equal(r.end, null)
})

test("personal tasks resolve from the personal list and are flagged", () => {
  const index = buildTaskIndex([], [{ id: "p1", name: "Revise", end: "2026-09-05", _personal: true }])
  const r = resolveItem(list({ id: "a", ref: "p1", source: "personal" })[0], index)
  assert.equal(r.title, "Revise")
  assert.equal(r.personal, true)
  assert.equal(r.orphan, false)
})

test("a marker resolves its date from `date` rather than `end`", () => {
  const index = buildTaskIndex([{ id: "m1", name: "Sports day", type: "marker", date: "2026-09-09" }], [])
  assert.equal(resolveItem(list({ id: "a", ref: "m1", source: "shared" })[0], index).end, "2026-09-09")
})

test("notes render their own text and never touch the index", () => {
  const r = resolveItem(list({ id: "a", source: "note", text: "print the form" })[0], buildTaskIndex([], []))
  assert.equal(r.title, "print the form")
  assert.equal(r.orphan, false)
})

test("an empty note still renders a title", () => {
  assert.equal(resolveItem(list({ id: "a", source: "note" })[0], buildTaskIndex([], [])).title, "Untitled note")
})

test("refIds reports which tasks are already on the list", () => {
  const items = list({ id: "a", ref: "t1" }, { id: "b", source: "note", text: "x" }, { id: "c", ref: "t2" })
  assert.deepEqual([...refIds(items)].sort(), ["t1", "t2"])
})

/* ── Folding away the retired Focus Deck ────────────────────── */

const raw = (...specs) => specs.map((s, i) => ({
  id: s.id, ref: s.ref || "t" + i, source: "shared",
  order: s.order === undefined ? i : s.order, deck: !!s.deck
}))

test("what was in the deck is lifted to the top of the one list", () => {
  const out = sanitizeItems(raw(
    { id: "a" }, { id: "b", deck: true }, { id: "c" }, { id: "d", deck: true }
  ))
  assert.deepEqual(ids(out), ["b", "d", "a", "c"])
  assert.deepEqual(out.map(i => i.order), [0, 1, 2, 3])
})

test("the lift keeps each group in its own stored order", () => {
  const out = sanitizeItems(raw(
    { id: "a", order: 3 }, { id: "b", deck: true, order: 2 },
    { id: "c", order: 1 }, { id: "d", deck: true, order: 0 }
  ))
  assert.deepEqual(ids(out), ["d", "b", "c", "a"])
})

test("a list that never had a deck is left in the order it was stored", () => {
  assert.deepEqual(ids(sanitizeItems(raw({ id: "a" }, { id: "b" }, { id: "c" }))), ["a", "b", "c"])
})

test("orderedItems renumbers without dropping anything", () => {
  const out = orderedItems(list({ id: "a", order: 7 }, { id: "b", order: 2 }))
  assert.deepEqual(ids(out), ["b", "a"])
  assert.deepEqual(out.map(i => i.order), [0, 1])
})

/* ── Reordering ─────────────────────────────────────────────── */

test("moveItem places before and after the target", () => {
  const items = list({ id: "a" }, { id: "b" }, { id: "c" })
  assert.deepEqual(ids(moveItem(items, "c", "a", true)),  ["c", "a", "b"])
  assert.deepEqual(ids(moveItem(items, "c", "a", false)), ["a", "c", "b"])
  assert.deepEqual(ids(moveItem(items, "a", "c", false)), ["b", "c", "a"])
})

test("moveItem renumbers contiguously from zero", () => {
  const out = moveItem(list({ id: "a" }, { id: "b" }, { id: "c" }), "c", "a", true)
  assert.deepEqual(out.map(i => i.order), [0, 1, 2])
})

test("moveItem is inert on self, and forgiving of a missing id", () => {
  const items = list({ id: "a" }, { id: "b" })
  assert.deepEqual(ids(moveItem(items, "a", "a")), ["a", "b"])
  assert.deepEqual(ids(moveItem(items, "ghost", "a")), ["a", "b"])
  assert.deepEqual(ids(moveItem(items, "a", "ghost")), ["b", "a"], "unknown target parks it at the end")
})

test("add appends, remove drops and both renumber", () => {
  let items = list({ id: "a" }, { id: "b" })
  items = addItem(items, makeItem({ source: "note", text: "third" }))
  assert.equal(items.length, 3)
  assert.equal(items[2].order, 2)
  items = removeItem(items, "a")
  assert.deepEqual(ids(items), ["b", items[1].id])
  assert.deepEqual(items.map(i => i.order), [0, 1])
})

test("removing an id that is not there changes nothing", () => {
  assert.deepEqual(ids(removeItem(list({ id: "a" }), "ghost")), ["a"])
})

test("updateItem edits notes on any source but text only on notes", () => {
  const items = list({ id: "a", ref: "t1", source: "shared" }, { id: "b", source: "note", text: "old" })
  assert.equal(updateItem(items, "a", { notes: "page 4" })[0].notes, "page 4")
  assert.equal(updateItem(items, "a", { text: "hijack" })[0].text, "", "a ref item has no text of its own")
  assert.equal(updateItem(items, "b", { text: "new" })[1].text, "new")
})

test("long text and notes are clamped before they can reach Firestore", () => {
  const item = makeItem({ source: "note", text: "x".repeat(500), notes: "y".repeat(5000) })
  assert.equal(item.text.length, 200)
  assert.equal(item.notes.length, 2000)
})
