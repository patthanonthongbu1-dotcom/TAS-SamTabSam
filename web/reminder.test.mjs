/* The reminder's catch-up window — the part that decides whether somebody
   is told once, twice or not at all.
   Run from the repo root:  node --test web/*.test.mjs */

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const { reminderDay, minutesInZone } =
  createRequire(import.meta.url)("./netlify/functions/reminder.js")._internals

const TZ = "Asia/Bangkok"
const CATCHUP = 60

// The handler's own window test, replayed over a run of cron ticks.
function sends(want, ticks) {
  let last = null, n = 0
  for (const iso of ticks) {
    const now = new Date(iso)
    const past = (minutesInZone(now, TZ) - want + 1440) % 1440
    if (past >= CATCHUP) continue
    const day = reminderDay(now, past, TZ)
    if (last === day) continue
    last = day; n++
  }
  return n
}
const at = (d, times) => times.map(t => `2026-10-${d}T${t}:00+07:00`)

test("a time near midnight is sent once, not on both sides of it", () => {
  assert.equal(sends(23 * 60 + 10,
    [...at("04", ["23:15", "23:30", "23:45"]), ...at("05", ["00:00", "00:15"])]), 1)
})

test("a time caught after midnight still belongs to the day it was set for", () => {
  assert.equal(reminderDay(new Date("2026-10-05T00:00:00+07:00"), 10, TZ), "2026-10-04")
})

test("a dropped run is made up by the next one, and tomorrow still sends", () => {
  assert.equal(sends(18 * 60,
    [...at("04", ["18:15", "18:30"]), ...at("05", ["18:00", "18:15"])]), 2)
})

const { pickNewHomework, newHomeworkMessage } =
  createRequire(import.meta.url)("./netlify/functions/reminder.js")._internals

test("new homework: first run only seeds", () => {
  const r = pickNewHomework([{ createdAt: 500 }, { createdAt: 900 }], null, 10_000)
  assert.equal(r.seed, true); assert.equal(r.ready, false); assert.equal(r.newest, 900)
})

test("new homework: waits for the whole Publish, skips dailies and old work", () => {
  const ts = [
    { name: "old", createdAt: 100 },
    { name: "A", subject: "Math", createdAt: 1_000 },
    { name: "B", subject: "Eng", createdAt: 1_020 },
    { name: "daily", createdAt: 1_030, daily: true },
    { name: "event", createdAt: 1_030, type: "marker", markerType: "event" },
    { name: "quiz", createdAt: 1_040, type: "marker", markerType: "quiz" },
  ]
  const early = pickNewHomework(ts, 500, 1_040 + 60_000)
  assert.equal(early.ready, false)                       // newest only a minute old
  assert.deepEqual(early.list.map(t => t.name), ["A", "B", "quiz"])
  const later = pickNewHomework(ts, 500, 1_040 + 180_000)
  assert.equal(later.ready, true); assert.equal(later.newest, 1_040)
  assert.equal(pickNewHomework(ts, 1_040, 1e9).ready, false)   // nothing newer
  const m = newHomeworkMessage(later.list)
  assert.equal(m.title, "📚 3 new homework")
  assert.equal(m.body.split("\n")[0], "Math: A")
})
