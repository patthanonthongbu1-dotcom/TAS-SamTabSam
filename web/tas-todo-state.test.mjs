/* Tests for the pure To Do state layer.
   Run from the repo root:  node --test web/
   No test framework — node's built-in runner, no new dependencies. */

import test from "node:test"
import assert from "node:assert/strict"
import {
  DECK_LIMIT, makeItem, sanitizeItems, toStored, normalizeOrder,
  listItems, deckItems, deckIsFull, buildTaskIndex, resolveItem, resolveItems,
  refIds, addItem, removeItem, updateItem, moveItem, setDeck
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
    deck: !!s.deck,
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
    ["createdAt", "deck", "id", "notes", "order", "ref", "source", "text"])
  assert.equal("title" in stored, false)
  assert.equal("end" in stored, false)
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

/* ── Lanes and the deck cap ─────────────────────────────────── */

test("lanes split on the deck flag and keep one shared order space", () => {
  const items = list({ id: "a" }, { id: "b", deck: true }, { id: "c" })
  assert.deepEqual(ids(listItems(items)), ["a", "c"])
  assert.deepEqual(ids(deckItems(items)), ["b"])
})

test("the deck accepts exactly DECK_LIMIT and rejects the next", () => {
  let items = list({ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" })
  for (const id of ["a", "b", "c"]) {
    const r = setDeck(items, id, true)
    assert.equal(r.ok, true)
    items = r.items
  }
  assert.equal(deckIsFull(items), true)
  assert.equal(deckItems(items).length, DECK_LIMIT)

  const rejected = setDeck(items, "d", true)
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /Focus Deck holds 3/)
  assert.equal(deckItems(rejected.items).length, DECK_LIMIT, "list unchanged on reject")
  assert.equal(rejected.items.find(i => i.id === "d").deck, false)
})

test("taking one out of a full deck makes room again", () => {
  let items = list({ id: "a", deck: true }, { id: "b", deck: true }, { id: "c", deck: true }, { id: "d" })
  assert.equal(setDeck(items, "d", true).ok, false)
  items = setDeck(items, "a", false).items
  const r = setDeck(items, "d", true)
  assert.equal(r.ok, true)
  assert.equal(r.items.find(i => i.id === "d").deck, true)
})

test("re-decking an item already in the deck is a no-op, not a rejection", () => {
  const items = list({ id: "a", deck: true }, { id: "b", deck: true }, { id: "c", deck: true })
  const r = setDeck(items, "a", true)
  assert.equal(r.ok, true)
  assert.equal(r.error, null)
})

test("setDeck on a vanished id reports rather than throws", () => {
  const r = setDeck(list({ id: "a" }), "ghost", true)
  assert.equal(r.ok, false)
  assert.match(r.error, /no longer here/)
})

test("an item keeps its place in the list after a trip through the deck", () => {
  let items = list({ id: "a" }, { id: "b" }, { id: "c" })
  items = setDeck(items, "b", true).items
  items = setDeck(items, "b", false).items
  assert.deepEqual(ids(listItems(items)), ["a", "b", "c"])
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
