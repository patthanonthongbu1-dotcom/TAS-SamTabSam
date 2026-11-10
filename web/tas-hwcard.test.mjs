import { test } from "node:test"
import assert from "node:assert/strict"
import { duePill, cardModel, fromTasks, MAX_ROWS } from "./tas-hwcard.js"

const T = "2026-11-10"   // a Tuesday

test("duePill: every branch", () => {
  assert.equal(duePill("", T), null)
  assert.equal(duePill("junk", T), null)
  assert.equal(duePill("2026-11-09", T).label, "เลยกำหนด")
  assert.deepEqual(duePill(T, T), { label: "ส่งวันนี้", tone: "red" })
  assert.deepEqual(duePill("2026-11-11", T), { label: "ส่งพรุ่งนี้", tone: "orange" })
  assert.deepEqual(duePill("2026-11-13", T), { label: "ส่งวันศุกร์", tone: "grey" })
  assert.deepEqual(duePill("2026-11-17", T), { label: "ส่ง 17 พ.ย.", tone: "grey" })
  assert.equal(duePill("2027-01-02", "2026-12-31").label, "ส่งวันเสาร์")   // across a year
})

const row = subject => ({ subject, lines: ["x"], due: T })

test("cardModel: numbered within each section, empties dropped", () => {
  const m = cardModel({ date: T, name: " Non ", sections: [
    { icon: "📢", title: "การบ้าน", rows: [row("A"), { subject: " ", lines: ["", " "] }, row("B")] },
    { icon: "📌", title: "  ", rows: [] },
    { icon: "🗓️", title: "งานกลุ่ม", rows: [row("C")] },
  ] })
  assert.equal(m.name, "Non")
  assert.equal(m.weekday, "อังคาร")
  assert.deepEqual(m.sections.map(s => s.title), ["การบ้าน", "งานกลุ่ม"])
  assert.deepEqual(m.sections.map(s => s.rows.map(r => r.subject + r.n).join()), ["A1,B2", "C1"])
  assert.equal(m.sections[0].rows[0].pill.label, "ส่งวันนี้")
  assert.equal(m.more, 0)
})

test("cardModel: +N past the cap, counted across sections", () => {
  const many = n => Array.from({ length: n }, (_, i) => row("S" + i))
  const m = cardModel({ date: T, sections: [{ title: "a", rows: many(MAX_ROWS - 2) }, { title: "b", rows: many(5) }] })
  assert.equal(m.sections[1].rows.length, 2)
  assert.equal(m.more, 3)
})

test("fromTasks: open only, merged by subject/due, no markers/dailies", () => {
  const sub = n => ({ name: n.startsWith("คณิต") ? "คณิตศาสตร์พื้นฐาน" : n, code: n.startsWith("คณิต") ? "ค23102" : "", color: "#111", icon: "📐" })
  const rows = fromTasks([
    { id: "1", name: "Ex 1.2", subject: "คณิต", end: "2026-11-12" },
    { id: "2", name: "Ex 1.3", subject: "คณิตพื้นฐาน", end: "2026-11-12" },
    { id: "3", name: "Essay", subject: "อังกฤษ", end: "2026-11-11" },
    { id: "4", name: "Done today", subject: "ไทย", end: "2026-11-10" },
    { id: "6", name: "Quiz", subject: "คณิต", type: "marker", end: "2026-11-12" },
    { id: "7", name: "Daily", subject: "Daily", daily: true },
  ], { 4: Date.now() }, sub)
  assert.deepEqual(rows.map(r => [r.subject, r.code, r.lines.join("+")]), [
    ["อังกฤษ", "", "Essay"],
    ["คณิตศาสตร์พื้นฐาน", "ค23102", "Ex 1.2+Ex 1.3"],
  ])
})
