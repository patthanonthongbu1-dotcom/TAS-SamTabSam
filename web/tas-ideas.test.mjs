import { test } from "node:test"
import assert from "node:assert/strict"
import { makeIdea, sanitizeIdeas, addIdea, ageLabel, tagsOf, parseQuick, sortIdeas, isStale, STALE_DAYS, MAX_IDEAS, MAX_IDEA_TEXT } from "./tas-ideas.js"

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

test("tags are found, lowercased, deduped, Thai marks kept", () => {
  assert.deepEqual(tagsOf("buy #Math ruler #math #ภาษาไทย"), ["math", "ภาษาไทย"])
  assert.deepEqual(tagsOf("no tags here"), [])
})

test("quick parse pulls subject and a trailing date word", () => {
  const thu = new Date(2026, 10, 5)   // Thursday 5 Nov 2026
  assert.deepEqual(parseQuick("read ch3 #bio fri", thu), { name: "read ch3", subject: "bio", due: "2026-11-06" })
  assert.equal(parseQuick("quiz thu", thu).due, "2026-11-12")          // never today
  assert.equal(parseQuick("call mom tomorrow", thu).due, "2026-11-06")
  assert.equal(parseQuick("ส่งงาน พรุ่งนี้", thu).due, "2026-11-06")
  assert.equal(parseQuick("exam 2/1", thu).due, "2027-01-02")          // passed → next year
  assert.equal(parseQuick("party 31/2", thu).due, "")
  assert.equal(parseQuick("friday", thu).name, "friday")               // nothing left → keep text
  assert.equal(parseQuick("fries are good", thu).due, "")              // only the last word counts
  assert.equal(parseQuick("buy fries", thu).due, "")                   // "fries" isn't a weekday
})

test("pinned ideas go first, the rest keep their order", () => {
  const list = [{ id: "a" }, { id: "b", pin: true }, { id: "c" }]
  assert.deepEqual(sortIdeas(list).map(i => i.id), ["b", "a", "c"])
})

test("stale means old and not pinned; sanitize keeps the pin", () => {
  const now = 100 * 86400000, old = now - (STALE_DAYS + 1) * 86400000
  assert.equal(isStale({ at: old }, now), true)
  assert.equal(isStale({ at: old, pin: true }, now), false)
  assert.equal(isStale({ at: now - 86400000 }, now), false)
  assert.equal(sanitizeIdeas([{ text: "x", pin: true }])[0].pin, true)
  assert.equal("pin" in sanitizeIdeas([{ text: "x", pin: "yes" }])[0], false)
})
