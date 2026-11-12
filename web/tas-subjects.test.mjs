import { test } from "node:test"
import assert from "node:assert/strict"
import { sanitize, match, candidates, colorOf, label, TIMETABLE } from "./tas-subjects.js"

const items = sanitize([
  { name: "คณิตศาสตร์พื้นฐาน 5", short: "คณิต", color: "#2563EB", icon: "📐", aliases: ["คณิตพื้นฐาน"] },
  { name: "คณิตศาสตร์เพิ่มเติม", short: "คณิตเพิ่ม", color: "#dc2626" },
  { name: "ภาษาอังกฤษ", short: "อังกฤษ", color: "nope" },
  { name: "  ภาษาอังกฤษ " },   // duplicate, dropped
  { name: "" },               // empty, dropped
  null,
])

test("sanitize drops junk and dupes, fixes colours", () => {
  assert.equal(items.length, 3)
  assert.equal(items[0].color, "#2563eb")
  assert.equal(items[2].color, "#64748b")
  assert.equal(sanitize([{ name: "x", code: "bad code!" }])[0].code, "")
})

test("match: exact name, short, alias", () => {
  assert.equal(match("คณิตศาสตร์พื้นฐาน 5", items).short, "คณิต")
  assert.equal(match(" คณิต ", items).name, "คณิตศาสตร์พื้นฐาน 5")
  assert.equal(match("คณิตพื้นฐาน", items).name, "คณิตศาสตร์พื้นฐาน 5")
  assert.equal(match("ENGLISH", sanitize([{ name: "English" }])).name, "English")
})

test("match: unique prefix wins, ambiguous prefix is null", () => {
  assert.equal(match("ภาษาอังกฤษ (ครูบี)", items).name, "ภาษาอังกฤษ")
  assert.equal(match("คณิตศาสตร์", items), null)   // fits both maths
  assert.equal(match("ฟิสิกส์", items), null)
  assert.equal(match("", items), null)
})

test("colorOf", () => {
  assert.equal(colorOf("คณิตเพิ่ม", items), "#dc2626")
  assert.equal(colorOf("ไม่มี", items), null)
})

const tt = sanitize(TIMETABLE)

test("timetable: codes settle it, the three Englishes stay apart", () => {
  assert.equal(tt.length, 17)
  assert.equal(match("อ23212", tt).name, "English Reading & Writing")
  assert.equal(match("อ23204 งานพูด", tt).name, "English Communication")
  assert.equal(match("english-core", tt).code, "อ23102")
  assert.equal(match("Eng.Core", tt).code, "อ23102")
  assert.equal(match("T.Miles", tt).code, "อ23204")          // by teacher
  assert.equal(tt[9].teacher, "T.Allan")
  assert.equal(match("ว23210", tt).code, "ว23104")          // second code, as an alias
  assert.equal(match("อังกฤษ", tt), null)
  assert.equal(candidates("อังกฤษ", tt).length, 3)          // ambiguous, not unknown
  assert.equal(candidates("english", tt).length, 3)
  assert.equal(candidates("คณิต", tt).length, 2)
  assert.equal(match("คณิตศาสตร์พื้นฐาน 5", tt).code, "ค23102")
  assert.equal(match("island", tt), null)                   // short "IS" can't swallow it
  assert.equal(label(tt[0]), "ท23102 · ภาษาไทย")
})

test("listOrTimetable: falls back only when empty", async () => {
  const S = await import("./tas-subjects.js")
  assert.equal(S.listOrTimetable(undefined).length, S.TIMETABLE.length)
  assert.deepEqual(S.listOrTimetable([{ name: "X" }]).map(x => x.name), ["X"])
})

test("timetable aliases settle the spellings seen on the live calendar", async () => {
  const S = await import("./tas-subjects.js")
  const L = S.sanitize(S.TIMETABLE)
  const code = t => S.match(t, L)?.code ?? null
  assert.equal(code("Communications"), "อ23204")      // was Computer via "com"
  assert.equal(code("Communication"), "อ23204")
  assert.equal(code("Com"), "ว23104")
  assert.equal(code("Math Core"), "ค23102")
  assert.equal(code("Math Sup"), "ค23202")
  assert.equal(code("Health"), "พ23102")
  assert.equal(code("Science"), "ว23102")
  assert.equal(code("นาฎศิลป์"), "ศ23102")
  assert.equal(code("Thai"), "ท23102")
  assert.equal(code("Reading & Writting"), "อ23212")
  assert.equal(code("ประวัติสาสตร์"), "ส23104")
  assert.equal(code("Social (UNIT 1)"), "ส23102")
  assert.equal(code("คณิตศาสตร์"), null)              // two maths: still asked, never guessed
  assert.equal(code("Math"), null)
  assert.equal(code("อังกฤษ"), null)
})

test("search: every word narrows, best first, one typo forgiven", async () => {
  const S = await import("./tas-subjects.js")
  const L = S.sanitize(S.TIMETABLE)
  const codes = q => S.search(q, L).map(x => x.code)
  assert.deepEqual(codes("eng").sort(), ["อ23102", "อ23204", "อ23212"])
  assert.deepEqual(codes("eng core"), ["อ23102"])
  assert.deepEqual(codes("english > core"), ["อ23102"])
  assert.deepEqual(codes("คณิต core"), ["ค23102"])
  assert.deepEqual(codes("คณิต > เพิ่ม"), ["ค23202"])
  assert.deepEqual(codes("อ232").sort(), ["อ23204", "อ23212"])
  assert.equal(codes("Englsh core")[0], "อ23102")
  assert.equal(codes("คนิต").length, 2)
  assert.equal(codes("thai")[0], "ท23102")               // the exact alias beats Thai Dance
  assert.equal(codes("allan")[0], "อ23102")               // teacher
  assert.deepEqual(codes("zzzz"), [])
  assert.equal(codes("  ").length, L.length)
})
