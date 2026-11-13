import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeNavBar, moreSections, toggleInBar, moveInBar, NAV_DEFAULT } from "./tas-navbar.js"

test("normalizeNavBar: unknowns and repeats out, at most 4, default when empty", () => {
  assert.deepEqual(normalizeNavBar(["today", "bogus", "today", "archive"]), ["today", "archive"])
  assert.deepEqual(normalizeNavBar(["calendar", "today", "todo", "tasks", "archive"]), ["calendar", "today", "todo", "tasks"])
  assert.deepEqual(normalizeNavBar([]), NAV_DEFAULT)
  assert.deepEqual(normalizeNavBar(null), NAV_DEFAULT)
})

test("toggle and move", () => {
  assert.deepEqual(toggleInBar(["calendar", "todo"], "archive"), ["calendar", "todo", "archive"])
  assert.equal(toggleInBar(["calendar", "today", "todo", "tasks"], "archive"), null)   // a 5th
  assert.equal(toggleInBar(["calendar"], "calendar"), null)                            // the last one
  assert.deepEqual(toggleInBar(["calendar", "todo"], "todo"), ["calendar"])
  assert.deepEqual(moveInBar(["a", "b", "c"], "c", -1), ["a", "c", "b"])
  assert.deepEqual(moveInBar(["a", "b"], "a", -1), ["a", "b"])
  assert.deepEqual(moreSections(["calendar", "archive"]), ["today", "todo", "tasks", "settings"])
})
