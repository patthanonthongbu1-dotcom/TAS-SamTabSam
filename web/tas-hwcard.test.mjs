import { test } from "node:test"
import assert from "node:assert/strict"
import { duePill, cardModel, fromTasks, MAX_ROWS, localKey } from "./tas-hwcard.js"

const T = "2026-11-10"   // a Tuesday

test("duePill: every branch", () => {
  assert.deepEqual(duePill("2026-11-01", true, T), { label: "ส่งแล้ว", tone: "green" })
  assert.equal(duePill("", false, T), null)
  assert.equal(duePill("junk", false, T), null)
  assert.equal(duePill("2026-11-09", false, T).label, "เลยกำหนด")
  assert.deepEqual(duePill(T, false, T), { label: "ส่งวันนี้", tone: "red" })
  assert.deepEqual(duePill("2026-11-11", false, T), { label: "ส่งพรุ่งนี้", tone: "orange" })
  assert.deepEqual(duePill("2026-11-13", false, T), { label: "ส่งวันศุกร์", tone: "grey" })
  assert.deepEqual(duePill("2026-11-17", false, T), { label: "ส่ง 17 พ.ย.", tone: "grey" })
  assert.equal(duePill("2027-01-02", false, "2026-12-31").label, "ส่งวันเสาร์")   // across a year
})

const row = (subject, done = false, due = T) => ({ subject, lines: ["x"], due, done })

test("cardModel: done last, progress needs 3+ subjects, toggles override", () => {
  const two = cardModel({ date: T, rows: [row("A", true), row("B")] })
  assert.deepEqual(two.rows.map(r => r.subject), ["B", "A"])
  assert.equal(two.progress, null)
  assert.equal(two.weekday, "อังคาร")
  const three = cardModel({ date: T, rows: [row("A", true), row("B"), row("C")] })
  assert.deepEqual(three.progress, { done: 1, total: 3 })
  assert.equal(cardModel({ date: T, rows: [row("A"), row("B"), row("C")], opts: { progress: false } }).progress, null)
  assert.ok(cardModel({ date: T, rows: [row("A")], opts: { progress: true } }).progress)
  assert.equal(cardModel({ date: T, rows: [row("A", true), row("B")], opts: { done: false } }).rows.length, 1)
  assert.equal(cardModel({ date: T, note: " hi ", rows: [] }).note, "hi")
  assert.equal(cardModel({ date: T, note: "hi", rows: [], opts: { note: false } }).note, "")
})

test("cardModel: empty rows dropped, +N past the cap", () => {
  assert.equal(cardModel({ date: T, rows: [{ subject: " ", lines: ["", " "] }] }).rows.length, 0)
  const m = cardModel({ date: T, rows: Array.from({ length: MAX_ROWS + 3 }, (_, i) => row("S" + i)) })
  assert.equal(m.rows.length, MAX_ROWS)
  assert.equal(m.more, 3)
})

test("fromTasks: open + finished today, merged by subject/due, no markers/dailies", () => {
  const today = localKey(new Date())
  const now = Date.now(), yesterday = now - 864e5 * 1.5
  const sub = n => ({ name: n.startsWith("คณิต") ? "คณิตศาสตร์" : n, color: "#111", icon: "📐" })
  const rows = fromTasks([
    { id: "1", name: "Ex 1.2", subject: "คณิต", end: "2026-11-12" },
    { id: "2", name: "Ex 1.3", subject: "คณิตพื้นฐาน", end: "2026-11-12" },
    { id: "3", name: "Essay", subject: "อังกฤษ", end: "2026-11-11" },
    { id: "4", name: "Done today", subject: "ไทย", end: "2026-11-10" },
    { id: "5", name: "Done before", subject: "ไทย", end: "2026-11-09" },
    { id: "6", name: "Quiz", subject: "คณิต", type: "marker", end: "2026-11-12" },
    { id: "7", name: "Daily", subject: "Daily", daily: true },
  ], { 4: now, 5: yesterday }, today, sub)
  assert.deepEqual(rows.map(r => [r.subject, r.lines.join("+"), r.done]), [
    ["ไทย", "Done today", true],
    ["อังกฤษ", "Essay", false],
    ["คณิตศาสตร์", "Ex 1.2+Ex 1.3", false],
  ])
})
