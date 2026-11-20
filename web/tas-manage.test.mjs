import { test } from "node:test"
import assert from "node:assert/strict"
import { activeGroups, editPatch, kindOf, OVERDUE_DAYS } from "./tas-manage.js"

const T = "2026-11-10"   // a Tuesday
const t = (id, end, extra = {}) => ({ id, name: "n" + id, subject: "s", end, ...extra })

test("activeGroups: tomorrow / today / overdue / later, dailies and plain markers off", () => {
  const g = activeGroups([
    t("a", "2026-11-11"), t("b", T), t("c", "2026-11-09"), t("d", "2026-11-20"),
    t("old", "2026-10-01"),                                    // past the overdue window
    t("q", "2026-11-11", { type: "marker", markerType: "quiz" }),
    t("e", "2026-11-11", { type: "marker", markerType: "event" }),
    t("x", "2026-11-11", { daily: true }), { id: "nodate", name: "n" },
  ], T)
  assert.equal(g.week, false)
  assert.deepEqual(g.next.map(x => x.id), ["a", "q"])
  assert.deepEqual(g.today.map(x => x.id), ["b"])
  assert.deepEqual(g.overdue.map(x => x.id), ["c"])
  assert.deepEqual(g.later.map(x => x.id), ["d"])
  assert.equal(OVERDUE_DAYS, 7)
})

test("activeGroups: Friday looks at the week ahead; search filters", () => {
  const fri = "2026-11-13"
  const g = activeGroups([t("mon", "2026-11-16"), t("fri", "2026-11-20"), t("far", "2026-11-21")], fri)
  assert.equal(g.week, true)
  assert.deepEqual(g.next.map(x => x.id), ["mon", "fri"])
  assert.deepEqual(g.later.map(x => x.id), ["far"])
  const s = activeGroups([t("a", "2026-11-11", { name: "Essay" }), t("b", "2026-11-11", { note: "ESSAY draft" }), t("c", "2026-11-11")], T, " essay ")
  assert.deepEqual(s.next.map(x => x.id), ["a", "b"])
})

const form = (task, over = {}) => ({ name: task.name, subject: task.subject, end: task.end, dueAt: task.dueAt || "",
  send: task.send || "", note: task.note || "", kind: kindOf(task), ...over })

test("editPatch: nothing changed → null; only changed fields written", () => {
  const task = t("a", "2026-11-11", { start: "2026-11-10", dueAt: "คาบ 2" })
  assert.equal(editPatch(task, form(task)), null)
  const p = editPatch(task, form(task, { name: " Essay v2 ", dueAt: "คาบ 3" }))
  assert.deepEqual(p.fields, { name: "Essay v2", dueAt: "คาบ 3" })
  assert.equal(p.detail, "name na → Essay v2, ส่งตอน คาบ 2 → คาบ 3")
})

test("editPatch: moving the due date before the start pulls the start along", () => {
  const task = t("a", "2026-11-14", { start: "2026-11-12" })
  assert.deepEqual(editPatch(task, form(task, { end: "2026-11-11" })).fields, { end: "2026-11-11", start: "2026-11-11" })
})

test("editPatch: switching kinds keeps markers' dates together", () => {
  const hw = t("a", "2026-11-12", { start: "2026-11-10" })
  assert.deepEqual(editPatch(hw, form(hw, { kind: "quiz" })).fields,
    { type: "marker", markerType: "quiz", date: "2026-11-12", start: "2026-11-12", end: "2026-11-12" })
  const quiz = t("q", "2026-11-12", { type: "marker", markerType: "quiz", date: "2026-11-12", start: "2026-11-12" })
  assert.equal(kindOf(quiz), "quiz")
  assert.deepEqual(editPatch(quiz, form(quiz, { kind: "homework" })).fields, { type: "normal", markerType: null, date: null })
  assert.match(editPatch(quiz, form(quiz, { note: "x" })).detail, /^note changed$/)
})
