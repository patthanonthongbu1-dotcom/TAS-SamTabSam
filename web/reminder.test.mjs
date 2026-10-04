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
