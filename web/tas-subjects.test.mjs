import { test } from "node:test"
import assert from "node:assert/strict"
import { sanitize, match, colorOf } from "./tas-subjects.js"

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
