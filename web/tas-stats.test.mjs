/* Tests for the pure statistics layer.
   Run from the repo root:  npm test
   No test framework — node's built-in runner, no new dependencies.

   `now` is injected everywhere so none of this goes red in October. */

import test from "node:test"
import assert from "node:assert/strict"
import {
  collect, headline, timeTotals, activity, punctuality, bySubject,
  streaks, awards, summarise, dayKey, parseDay, humanMs, humanDays
} from "./tas-stats.js"
import { PRESETS } from "./tas-points.js"

const NORMAL = PRESETS[2].points

// A fixed Saturday afternoon, so "today" is never a moving target.
const NOW = new Date(2026, 8, 12, 15, 0, 0)      // 2026-09-12
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()

const task = (over = {}) => ({
  id: "t1", name: "Thing", subject: "Maths", type: "normal",
  start: "2026-09-01", end: "2026-09-10", difficulty: 100, ...over
})

/* ── collect ──────────────────────────────────────────────── */

test("collect resolves each task once, with its weight and its tick", () => {
  const rows = collect({
    tasks: [task({ id: "a" })],
    personal: [task({ id: "b", difficulty: 250 })],
    done: { a: at(2026, 9, 11) }
  })
  assert.equal(rows.length, 2)
  const a = rows.find(r => r.id === "a")
  assert.equal(a.points, 100)
  assert.equal(a.isDone, true)
  assert.equal(dayKey(a.doneAt), "2026-09-11")
  assert.equal(rows.find(r => r.id === "b").isDone, false)
})

test("markers are not work and never reach any sum", () => {
  const rows = collect({ tasks: [task({ id: "m", type: "marker", difficulty: 500 })] })
  assert.equal(rows.length, 0)
})

test("a task that is both shared and personal is counted once", () => {
  // Nothing should be able to double a student's points by existing twice.
  const rows = collect({ tasks: [task({ id: "x" })], personal: [task({ id: "x" })] })
  assert.equal(rows.length, 1)
})

test("the reader's own weight beats the author's, as everywhere else", () => {
  const rows = collect({ tasks: [task({ id: "a", difficulty: 100 })], overrides: { a: 2000 } })
  assert.equal(rows[0].points, 2000)
})

test("a pre-V.3.3 tick counts as done but carries no date", () => {
  // `true` is what the map held before completions were stamped.
  const rows = collect({ tasks: [task({ id: "a" })], done: { a: true } })
  assert.equal(rows[0].isDone, true)
  assert.equal(rows[0].doneAt, null)
})

test("junk in the done map is not mistaken for a date", () => {
  for (const bad of [0, -1, NaN, "2026-09-01", {}, Infinity]) {
    const rows = collect({ tasks: [task({ id: "a" })], done: { a: bad } })
    assert.equal(rows[0].doneAt, null, "should reject " + JSON.stringify(bad))
  }
})

/* ── headline ─────────────────────────────────────────────── */

test("the headline splits finished, open and overdue by weight", () => {
  const rows = collect({
    tasks: [
      task({ id: "a", difficulty: 100, end: "2026-09-05" }),
      task({ id: "b", difficulty: 250, end: "2026-09-20" }),
      task({ id: "c", difficulty: 500, end: "2026-09-08" })   // late
    ],
    done: { a: at(2026, 9, 4) }
  })
  const h = headline(rows, { now: NOW })
  assert.deepEqual(h.done, { count: 1, points: 100 })
  assert.deepEqual(h.open, { count: 2, points: 750 })
  assert.equal(h.overdue.count, 1)
  assert.equal(h.overdue.points, 500)
  assert.equal(h.overdue.oldestDays, 4)          // 8th to the 12th
})

test("a finished task is never overdue, however late it was", () => {
  const rows = collect({ tasks: [task({ id: "a", end: "2026-08-01" })],
                         done: { a: at(2026, 9, 1) } })
  assert.equal(headline(rows, { now: NOW }).overdue.count, 0)
})

test("an estimate cannot be late", () => {
  // A guessed date is not a deadline — the calendar draws it the same way.
  for (const type of ["prediction", "estimated"]) {
    const rows = collect({ tasks: [task({ id: "a", type, end: "2026-08-01" })] })
    assert.equal(headline(rows, { now: NOW }).overdue.count, 0, type)
  }
})

test("due today is not yet overdue", () => {
  const rows = collect({ tasks: [task({ id: "a", end: "2026-09-12" })] })
  assert.equal(headline(rows, { now: NOW }).overdue.count, 0)
})

/* ── timeTotals ───────────────────────────────────────────── */

test("timeTotals adds up the days and picks today out", () => {
  const t = timeTotals({
    "2026-09-12": { ms: 3600000, opens: 4 },
    "2026-09-11": { ms: 1800000, opens: 2 }
  }, NOW)
  assert.equal(t.totalMs, 5400000)
  assert.equal(t.opens, 6)
  assert.equal(t.activeDays, 2)
  assert.equal(t.todayMs, 3600000)
  assert.equal(t.perDayMs, 2700000)
})

test("timeTotals refuses junk rather than propagating NaN", () => {
  // These documents are writable from a console; one bad value must not
  // turn the whole headline into NaN.
  const t = timeTotals({
    "2026-09-12": { ms: "nope", opens: null },
    "not-a-day": { ms: 999999 },
    "2026-09-11": null,
    "2026-09-10": { ms: -5000, opens: 3 }
  }, NOW)
  assert.equal(t.totalMs, 0)
  assert.equal(t.opens, 3)
  assert.equal(t.activeDays, 0)
})

test("timeTotals survives an empty or missing map", () => {
  assert.equal(timeTotals(undefined, NOW).totalMs, 0)
  assert.equal(timeTotals({}, NOW).perDayMs, 0)
})

/* ── activity ─────────────────────────────────────────────── */

test("activity returns every day in the window, empty ones included", () => {
  const a = activity(collect({}), { days: 7, now: NOW })
  assert.equal(a.series.length, 7)
  assert.equal(a.series[0].day, "2026-09-06")
  assert.equal(a.series[6].day, "2026-09-12")     // today is last
  assert.equal(a.peak, 0)
})

test("activity buckets points onto the day they were ticked", () => {
  const rows = collect({
    tasks: [task({ id: "a", difficulty: 100 }), task({ id: "b", difficulty: 250 }),
            task({ id: "c", difficulty: 500 })],
    done: { a: at(2026, 9, 11), b: at(2026, 9, 11, 23), c: at(2026, 9, 12) }
  })
  const a = activity(rows, { days: 7, now: NOW })
  const d11 = a.series.find(s => s.day === "2026-09-11")
  assert.equal(d11.points, 350)
  assert.equal(d11.count, 2)
  assert.equal(a.series.find(s => s.day === "2026-09-12").points, 500)
  assert.equal(a.peak, 500)
  assert.equal(a.stamped, 3)
})

test("a completion older than the window is counted but not charted", () => {
  // `stamped` is what tells the page it has history it isn't showing.
  const rows = collect({ tasks: [task({ id: "a" })], done: { a: at(2026, 1, 1) } })
  const a = activity(rows, { days: 7, now: NOW })
  assert.equal(a.stamped, 1)
  assert.equal(a.peak, 0)
})

test("undated ticks stay out of the chart entirely", () => {
  const rows = collect({ tasks: [task({ id: "a" })], done: { a: true } })
  const a = activity(rows, { days: 7, now: NOW })
  assert.equal(a.stamped, 0)
  assert.equal(a.peak, 0)
})

/* ── punctuality ──────────────────────────────────────────── */

test("punctuality measures against the deadline, early as negative", () => {
  const rows = collect({
    tasks: [
      task({ id: "a", end: "2026-09-10" }),   // ticked the 7th  -> 3 early
      task({ id: "b", end: "2026-09-10" }),   // ticked the 10th -> on the day
      task({ id: "c", end: "2026-09-08" })    // ticked the 10th -> 2 late
    ],
    done: { a: at(2026, 9, 7), b: at(2026, 9, 10), c: at(2026, 9, 10) }
  })
  const p = punctuality(rows)
  assert.equal(p.rated, 3)
  assert.equal(p.early, 1)
  assert.equal(p.onTime, 1)
  assert.equal(p.late, 1)
  assert.equal(p.avgDays, (-3 + 0 + 2) / 3)
  assert.equal(p.best.id, "a")
  assert.equal(p.worst.id, "c")
})

test("the time of day never turns an on-time finish into a late one", () => {
  // Ticked at 11pm on the day it was due is still on the day.
  const rows = collect({ tasks: [task({ id: "a", end: "2026-09-10" })],
                         done: { a: at(2026, 9, 10, 23) } })
  assert.equal(punctuality(rows).avgDays, 0)
})

test("punctuality reports nothing rather than zero when it has no sample", () => {
  const rows = collect({ tasks: [task({ id: "a" })], done: { a: true } })
  const p = punctuality(rows)
  assert.equal(p.rated, 0)
  assert.equal(p.best, null)
  assert.equal(p.worst, null)
})

test("estimates are left out of punctuality too", () => {
  const rows = collect({ tasks: [task({ id: "a", type: "prediction" })],
                         done: { a: at(2026, 9, 11) } })
  assert.equal(punctuality(rows).rated, 0)
})

/* ── bySubject ────────────────────────────────────────────── */

test("bySubject ranks cleared work by weight, heaviest first", () => {
  const rows = collect({
    tasks: [
      task({ id: "a", subject: "Maths",   difficulty: 100 }),
      task({ id: "b", subject: "Physics", difficulty: 500 }),
      task({ id: "c", subject: "Maths",   difficulty: 250 }),
      task({ id: "d", subject: "Art",     difficulty: 2000 })   // not done
    ],
    done: { a: true, b: at(2026, 9, 11), c: true }
  })
  const s = bySubject(rows)
  assert.equal(s.length, 2)
  assert.deepEqual(s[0], { subject: "Physics", points: 500, count: 1 })
  assert.deepEqual(s[1], { subject: "Maths", points: 350, count: 2 })
})

test("a task with no subject is grouped, not dropped", () => {
  const rows = collect({ tasks: [task({ id: "a", subject: "" })], done: { a: true } })
  assert.equal(bySubject(rows)[0].subject, "No subject")
})

/* ── streaks ──────────────────────────────────────────────── */

test("the longest streak is the longest run of consecutive days", () => {
  const done = {}
  for (const d of [1, 2, 3, 5, 9, 10]) done["t" + d] = at(2026, 9, d)
  const rows = collect({ tasks: Object.keys(done).map(id => task({ id })), done })
  assert.equal(streaks(rows, { now: NOW }).longest, 3)
  assert.equal(streaks(rows, { now: NOW }).activeDays, 6)
})

test("the current streak counts back from today", () => {
  const done = { a: at(2026, 9, 12), b: at(2026, 9, 11), c: at(2026, 9, 10) }
  const rows = collect({ tasks: ["a", "b", "c"].map(id => task({ id })), done })
  assert.equal(streaks(rows, { now: NOW }).current, 3)
})

test("a quiet morning does not break yesterday's streak", () => {
  // Nothing ticked today yet; at 9am that is not a broken streak.
  const done = { a: at(2026, 9, 11), b: at(2026, 9, 10) }
  const rows = collect({ tasks: ["a", "b"].map(id => task({ id })), done })
  assert.equal(streaks(rows, { now: NOW }).current, 2)
})

test("a gap of two days does break it", () => {
  const done = { a: at(2026, 9, 9), b: at(2026, 9, 8) }
  const rows = collect({ tasks: ["a", "b"].map(id => task({ id })), done })
  assert.equal(streaks(rows, { now: NOW }).current, 0)
  assert.equal(streaks(rows, { now: NOW }).longest, 2)
})

test("streaks on nothing at all are zero, not a crash", () => {
  assert.deepEqual(streaks([], { now: NOW }), { current: 0, longest: 0, activeDays: 0 })
})

/* ── awards ───────────────────────────────────────────────── */

test("the awards find the biggest task, the best day and the night owl", () => {
  const rows = collect({
    tasks: [
      task({ id: "a", difficulty: 2000, name: "The big one" }),
      task({ id: "b", difficulty: 100 }),
      task({ id: "c", difficulty: 250 })
    ],
    done: { a: at(2026, 9, 11, 23), b: at(2026, 9, 11, 2), c: at(2026, 9, 12, 14) }
  })
  const aw = awards(rows, { now: NOW })
  assert.equal(aw.biggest.name, "The big one")
  assert.equal(aw.biggest.points, 2000)
  assert.equal(aw.bestDay.day, "2026-09-11")
  assert.equal(aw.bestDay.points, 2100)
  assert.equal(aw.nightOwl, 2)             // 11pm and 2am, not the 2pm one
})

test("awards say nothing rather than zero when there is nothing to say", () => {
  const aw = awards([], { now: NOW })
  assert.equal(aw.biggest, null)
  assert.equal(aw.bestDay, null)
  assert.equal(aw.favourite, null)
  assert.equal(aw.nightOwl, 0)
})

/* ── summarise ────────────────────────────────────────────── */

test("summarise reports how much of its history is dated", () => {
  // This is what lets the page say "this fills in as you go" instead of
  // drawing an empty chart over a term's worth of finished work.
  const s = summarise({
    tasks: [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })],
    done: { a: true, b: true, c: at(2026, 9, 11) },
    now: NOW
  })
  assert.equal(s.done.count, 3)
  assert.equal(s.stamped, 1)
  assert.equal(s.undated, 2)
})

test("summarise survives being handed nothing at all", () => {
  const s = summarise({ now: NOW })
  assert.equal(s.total, 0)
  assert.equal(s.done.count, 0)
  assert.equal(s.time.totalMs, 0)
  assert.equal(s.activity.series.length, 30)
  assert.equal(s.punctuality.rated, 0)
  assert.deepEqual(s.subjects, [])
})

test("summarise weighs an unweighed task instead of scoring it zero", () => {
  // No difficulty on the doc and no override: tas-points guesses one.
  const s = summarise({ tasks: [task({ id: "a", difficulty: undefined })],
                        done: { a: true }, now: NOW })
  assert.ok(s.done.points > 0)
  assert.equal(s.done.points, NORMAL)
})

/* ── parseDay / formatting ────────────────────────────────── */

test("parseDay reads a date string and refuses anything else", () => {
  assert.equal(dayKey(parseDay("2026-09-12")), "2026-09-12")
  for (const bad of ["", null, undefined, "nonsense", "12/09/2026"]) {
    assert.equal(parseDay(bad), null, "should reject " + JSON.stringify(bad))
  }
})

test("humanMs climbs through the units", () => {
  assert.equal(humanMs(0), "0s")
  assert.equal(humanMs(59000), "59s")
  assert.equal(humanMs(60000), "1m")
  assert.equal(humanMs(3600000), "1h")
  assert.equal(humanMs(3600000 + 240000), "1h 4m")
  assert.equal(humanMs(86400000), "1d")
  assert.equal(humanMs(86400000 + 7200000), "1d 2h")
  assert.equal(humanMs("nope"), "0s")
  assert.equal(humanMs(-500), "0s")
})

test("humanDays says which side of the deadline it landed", () => {
  assert.equal(humanDays(0), "on the day")
  assert.equal(humanDays(-1), "1 day early")
  assert.equal(humanDays(-3), "3 days early")
  assert.equal(humanDays(2), "2 days late")
})
