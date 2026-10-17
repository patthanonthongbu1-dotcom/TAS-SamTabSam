import { test } from "node:test"
import assert from "node:assert/strict"
import { makeIdea, sanitizeIdeas, addIdea, ageLabel, MAX_IDEAS, MAX_IDEA_TEXT } from "./tas-ideas.js"

test("an idea is trimmed and capped", () => {
  const i = makeIdea("   hi   ", 5)
  assert.equal(i.text, "hi")
  assert.equal(i.at, 5)
  assert.equal(makeIdea("x".repeat(MAX_IDEA_TEXT + 50)).text.length, MAX_IDEA_TEXT)
})

test("new ideas go on top, blanks are refused, the list stops at the cap", () => {
  const a = makeIdea("a"), b = makeIdea("b")
  assert.deepEqual(addIdea(addIdea([], a), b).map(i => i.text), ["b", "a"])
  assert.deepEqual(addIdea([a], makeIdea("   ")), [a])
  const full = Array.from({ length: MAX_IDEAS }, (_, n) => makeIdea("i" + n))
  assert.equal(addIdea(full, makeIdea("one more")).length, MAX_IDEAS)
})

test("sanitize drops junk and fills what's missing", () => {
  const out = sanitizeIdeas([null, { text: "  " }, { text: "kept", at: "soon" }, 7])
  assert.equal(out.length, 1)
  assert.equal(out[0].text, "kept")
  assert.equal(out[0].at, 0)
  assert.equal(typeof out[0].id, "string")
  assert.deepEqual(sanitizeIdeas("not a list"), [])
  assert.equal(sanitizeIdeas(Array.from({ length: MAX_IDEAS + 9 }, () => ({ text: "x" }))).length, MAX_IDEAS)
})

test("age reads roughly", () => {
  const now = 10 * 86400000
  assert.equal(ageLabel(now - 10e3, now), "just now")
  assert.equal(ageLabel(now - 5 * 60e3, now), "5m ago")
  assert.equal(ageLabel(now - 3 * 3600e3, now), "3h ago")
  assert.equal(ageLabel(now - 2 * 86400e3, now), "2d ago")
  assert.equal(ageLabel(0, now), "")
})
