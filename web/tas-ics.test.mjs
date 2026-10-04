/* Tests for the .ics builder.
   Run from the repo root:  node --test web/*.test.mjs */

import test from "node:test"
import assert from "node:assert/strict"
import { icsFor } from "./tas-ics.js"

const NOW = new Date("2026-10-04T05:06:07Z")

test("a task becomes an all-day event that ends the day after it is due", () => {
  const ics = icsFor({ id: "abc", name: "Essay", subject: "English", end: "2026-10-31" }, NOW)
  assert.match(ics, /DTSTART;VALUE=DATE:20261031\r\n/)
  assert.match(ics, /DTEND;VALUE=DATE:20261101\r\n/)       // rolls over the month
  assert.match(ics, /DTSTAMP:20261004T050607Z\r\n/)
  assert.match(ics, /SUMMARY:Essay \(English\)\r\n/)
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"))
})

test("commas, semicolons, backslashes and newlines can't break the file", () => {
  const ics = icsFor({ id: "x", name: "Read ch. 1, 2; 3", end: "2026-10-05", note: "line one\r\nC:\\notes" }, NOW)
  assert.match(ics, /SUMMARY:Read ch\. 1\\, 2\\; 3\r\n/)
  assert.match(ics, /DESCRIPTION:line one\\nC:\\\\notes\r\n/)
})

test("a marker uses its date, and a task with no date gives nothing", () => {
  assert.match(icsFor({ id: "m", name: "Quiz", type: "marker", date: "2026-12-31" }, NOW), /DTEND;VALUE=DATE:20270101/)
  assert.equal(icsFor({ id: "n", name: "No date" }, NOW), null)
})
