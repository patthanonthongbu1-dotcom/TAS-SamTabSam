import { test } from "node:test"
import assert from "node:assert/strict"
import { duePill, cardModel, fromTasks, MAX_ROWS, sendLabel, lineOf, footerModel, addDays, MAX_REMINDERS, reminderWindow, dayTasks } from "./tas-hwcard.js"

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
  assert.equal(duePill("2026-11-11", T, " คาบ 3 ").label, "ส่งพรุ่งนี้ · คาบ 3")
  assert.equal(duePill("2026-11-09", T, "คาบ 3").label, "เลยกำหนด")       // past: the period is moot
  assert.deepEqual(duePill("", T, "08:00"), { label: "ส่ง 08:00", tone: "grey" })
})

test("duePill: quiz/exam say so, in violet when far off", () => {
  assert.deepEqual(duePill("2026-11-11", T, "", "quiz"), { label: "ควิซพรุ่งนี้", tone: "orange" })
  assert.deepEqual(duePill("2026-11-13", T, "คาบ 2", "exam"), { label: "สอบวันศุกร์ · คาบ 2", tone: "violet" })
  assert.deepEqual(duePill("2026-11-09", T, "", "quiz"), { label: "ผ่านไปแล้ว", tone: "grey" })
  assert.equal(duePill(T, T, "", "nonsense").label, "ส่งวันนี้")
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
    { id: "2", name: "Ex 1.3", subject: "คณิตพื้นฐาน", end: "2026-11-12", send: "paper", dueAt: "คาบ 2" },
    { id: "5", name: "x", subject: "ไทย", end: "2026-11-20", send: "carrier pigeon" },
    { id: "3", name: "Essay", subject: "อังกฤษ", end: "2026-11-11" },
    { id: "4", name: "Done today", subject: "ไทย", end: "2026-11-10" },
    { id: "6", name: "Quiz", subject: "คณิต", type: "marker", end: "2026-11-12" },
    { id: "7", name: "Daily", subject: "Daily", daily: true },
  ], { 4: Date.now() }, sub)
  assert.deepEqual(rows.map(r => [r.subject, r.code, r.lines.join("+")]), [
    ["อังกฤษ", "", "Essay"],
    ["คณิตศาสตร์พื้นฐาน", "ค23102", "Ex 1.2+Ex 1.3"],
    ["ไทย", "", "x"],
  ])
  assert.deepEqual([rows[1].send, rows[1].dueAt], ["paper", "คาบ 2"])
  assert.equal(rows[2].send, "carrier pigeon")                           // typed text kept
})

test("sendLabel: key → label, text stays", () => {
  assert.equal(sendLabel("paper"), "ส่งกระดาษ")
  assert.equal(sendLabel(" ส่งใน LINE "), "ส่งใน LINE")
  assert.equal(sendLabel(""), "")
})

test("lines: strings and objects both become {text, style, size}", () => {
  assert.deepEqual(lineOf(" a "), { text: "a", style: "pills", size: "m" })
  assert.deepEqual(lineOf({ text: "b", style: "big", size: "l" }), { text: "b", style: "big", size: "l" })
  assert.deepEqual(lineOf({ text: "c", style: "neon", size: "xxl" }), { text: "c", style: "pills", size: "m" })
  const m = cardModel({ date: T, sections: [{ rows: [{ subject: "A", lines: ["x", { text: " ", style: "big" }, { text: "y", style: "plain" }] }] }] })
  assert.deepEqual(m.sections[0].rows[0].lines.map(l => l.text + ":" + l.style), ["x:pills", "y:plain"])
})

test("footer: reminders capped, kinds checked, empty → null", () => {
  assert.equal(footerModel(null), null)
  assert.equal(footerModel({ reminders: [] }), null)
  const rs = Array.from({ length: 6 }, (_, i) => ({ subject: "S" + i, name: "w", kind: i ? "quiz" : "bogus" }))
  const f = footerModel({ reminders: rs, qr: { svg: "<svg/>", url: "u" } })
  assert.equal(f.reminders.length, MAX_REMINDERS)
  assert.equal(f.moreReminders, 6 - MAX_REMINDERS)
  assert.equal(f.reminders[0].kind, "homework")
  assert.equal(f.reminders[1].kind, "quiz")
  assert.deepEqual(f.reminders[0].pill, { label: "Due tomorrow", tone: "orange" })
  assert.equal(f.reminders[1].n, 2)
  assert.deepEqual(footerModel({ reminders: [{ subject: "S", name: "w", kind: "exam", dueAt: "คาบ 2" }] }).reminders[0].pill,
    { label: "Exam tomorrow · คาบ 2", tone: "violet" })
  assert.deepEqual(f.reminders[0].lines, [{ text: "w", style: "pills", size: "m" }])
  assert.deepEqual(footerModel({ qr: { svg: "<svg/>" } }).reminders, [])
  assert.equal(cardModel({ date: T }).footer, null)
  assert.equal(cardModel({ date: T, footer: { qr: { svg: "<svg/>" } } }).footer.qr.svg, "<svg/>")
})

test("addDays: across months and years", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01")
  assert.equal(addDays("2026-12-31", 1), "2027-01-01")
  assert.equal(addDays("junk", 1), "")
})

test("Friday cards look at next week; other days at tomorrow", () => {
  assert.deepEqual(reminderWindow("2026-11-13"), { from: "2026-11-14", to: "2026-11-20", week: true })   // Friday
  assert.deepEqual(reminderWindow("2026-11-12"), { from: "2026-11-13", to: "2026-11-13", week: false })  // Thursday
  const f = footerModel({ week: true, reminders: [{ subject: "S", name: "w", due: "2026-11-16" }, { subject: "Q", name: "q", kind: "quiz", due: "2026-11-18", dueAt: "คาบ 2" }] })
  assert.equal(f.title, "Due next week")
  assert.equal(f.reminders[0].pill.label, "Due Mon")
  assert.equal(f.reminders[1].pill.label, "Quiz Wed · คาบ 2")
  assert.equal(footerModel({ reminders: [{ subject: "S", name: "w" }] }).title, "Due tomorrow")
})

test("dayTasks: due that day, then tomorrow (or next week on Fridays)", () => {
  const ts = [
    { id: "a", name: "A", subject: "Math", end: "2026-11-12" },
    { id: "b", name: "B", subject: "Eng", end: "2026-11-13" },
    { id: "c", name: "C", subject: "Sci", end: "2026-11-13", type: "marker", markerType: "quiz" },
    { id: "d", name: "D", subject: "Art", end: "2026-11-13", type: "marker", markerType: "event" },   // not a test: off
    { id: "e", name: "E", subject: "PE", end: "2026-11-13", daily: true },                          // daily: off
    { id: "f", name: "F", subject: "Thai", end: "2026-11-18" },
  ]
  const thu = dayTasks(ts, "2026-11-12")
  assert.deepEqual(thu.due.map(t => t.id), ["a"])
  assert.deepEqual(thu.upcoming.map(t => t.id), ["b", "c"])
  assert.equal(thu.week, false)
  const fri = dayTasks(ts, "2026-11-13")
  assert.deepEqual(fri.due.map(t => t.id), ["b", "c"])
  assert.deepEqual(fri.upcoming.map(t => t.id), ["f"])
  assert.equal(fri.week, true)
})
