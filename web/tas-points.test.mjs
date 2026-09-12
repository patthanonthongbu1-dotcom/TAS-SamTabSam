/* Tests for the pure points layer.
   Run from the repo root:  node --test web/
   No test framework — node's built-in runner, no new dependencies. */

import test from "node:test"
import assert from "node:assert/strict"
import {
  PRESETS, MAX_POINTS, normPoints, nearestPreset, suggestPoints,
  pointsOf, pointsFromFactors, listTotals, explainSuggestion,
  normTarget, targetStep, loadBand, TARGET_FALLBACK, TARGET_MIN, TARGET_MAX
} from "./tas-points.js"

// A task with dates, so suggestPoints has something to read.
const task = (over = {}) => ({
  id: "t1", name: "Thing", type: "normal",
  start: "2026-09-01", end: "2026-09-06", ...over
})

/* ── normPoints ───────────────────────────────────────────── */

test("normPoints rejects everything that isn't a positive number", () => {
  for (const bad of [null, undefined, NaN, "", "abc", 0, -5, -0.4, {}, []]) {
    assert.equal(normPoints(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test("normPoints coerces, rounds and clamps", () => {
  assert.equal(normPoints("50"), 50)     // Firestore can hand back a string
  assert.equal(normPoints(49.6), 50)
  assert.equal(normPoints(0.4), null)    // rounds to 0, which is "no weight"
  assert.equal(normPoints(0.6), 1)
  assert.equal(normPoints(99999), MAX_POINTS)
})

/* ── nearestPreset ────────────────────────────────────────── */

test("nearestPreset snaps to a rung and never lands between two", () => {
  assert.equal(nearestPreset(70).id, "normal")     // 50 is 20 away, 100 is 30
  assert.equal(nearestPreset(80).id, "hard")
  assert.equal(nearestPreset(1).id, "trivial")
  assert.equal(nearestPreset(900).id, "brutal")
  assert.equal(nearestPreset(0), null)
  for (const p of PRESETS) assert.equal(nearestPreset(p.points).id, p.id)
})

/* ── suggestPoints ────────────────────────────────────────── */

test("suggestPoints always lands on a preset", () => {
  const values = PRESETS.map(p => p.points)
  for (const type of ["normal", "deadline", "prediction", "send_on", "estimated"]) {
    for (const end of ["2026-09-02", "2026-09-04", "2026-09-08", "2026-09-14", "2026-10-01"]) {
      const got = suggestPoints(task({ type, end }))
      assert.ok(values.includes(got), `${type} → ${end} gave ${got}`)
    }
  }
})

test("suggestPoints grows with the span", () => {
  const at = end => suggestPoints(task({ end }))
  assert.ok(at("2026-09-02") < at("2026-09-06"))
  assert.ok(at("2026-09-06") <= at("2026-09-12"))
  assert.ok(at("2026-09-12") < at("2026-10-01"))
})

test("suggestPoints reads the legacy type spellings", () => {
  // Live docs still carry these — see TYPE_ALIASES in calendar.html.
  assert.equal(suggestPoints(task({ type: "send_on" })), suggestPoints(task({ type: "normal" })))
  assert.equal(suggestPoints(task({ type: "estimated" })), suggestPoints(task({ type: "prediction" })))
})

test("markers weigh nothing", () => {
  assert.equal(suggestPoints(task({ type: "marker" })), 0)
  assert.deepEqual(pointsOf(task({ type: "marker" })), { points: 0, estimated: false })
})

test("suggestPoints copes with missing dates", () => {
  assert.equal(suggestPoints({ id: "x", type: "normal" }), 50)
  assert.equal(suggestPoints({ id: "x", type: "normal", start: "nonsense", end: "also" }), 50)
  assert.equal(suggestPoints(null), 0)
})

/* ── explainSuggestion ────────────────────────────────────── */

test("the explanation always lands on the number suggestPoints gives", () => {
  // The guide shows its working; if the working disagreed with the answer
  // it would be worse than showing nothing.
  for (const type of ["normal", "deadline", "prediction", "send_on", "estimated"]) {
    for (const end of ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-08",
                       "2026-09-14", "2026-09-20", "2026-11-01"]) {
      const t = task({ type, end })
      assert.equal(explainSuggestion(t).points, suggestPoints(t), `${type} → ${end}`)
    }
  }
})

test("the explanation names the band the span actually falls in", () => {
  assert.equal(explainSuggestion(task({ end: "2026-09-02" })).spanLabel, "a day or less")
  assert.equal(explainSuggestion(task({ end: "2026-09-04" })).spanLabel, "2–3 days")
  assert.equal(explainSuggestion(task({ end: "2026-09-06" })).spanLabel, "4–7 days")
  assert.equal(explainSuggestion(task({ end: "2026-09-12" })).spanLabel, "1–2 weeks")
  assert.equal(explainSuggestion(task({ end: "2026-10-01" })).spanLabel, "over 2 weeks")
})

test("the explanation reports a real span and a real base", () => {
  const e = explainSuggestion(task({ type: "prediction", end: "2026-09-06" }))
  assert.equal(e.days, 5)
  assert.equal(e.base, 25)
  assert.equal(e.factor, 1)
  assert.equal(e.raw, 25)
})

test("with no dates the explanation says so instead of inventing a span", () => {
  const e = explainSuggestion({ id: "x", type: "normal" })
  assert.equal(e.days, null)
  assert.equal(e.spanLabel, "no dates yet")
  assert.equal(e.points, 50)
})

test("markers have nothing to explain", () => {
  assert.equal(explainSuggestion(task({ type: "marker" })), null)
  assert.equal(explainSuggestion(null), null)
})

test("snapped says whether the ladder moved the raw number", () => {
  // 50 x 0.75 = 37.5 -> rounds to 38 -> nearest rung is 50
  const e = explainSuggestion(task({ end: "2026-09-04" }))
  assert.equal(e.raw, 38)
  assert.equal(e.points, 50)
  assert.equal(e.snapped, true)
  // 50 x 1 = 50, already a rung
  assert.equal(explainSuggestion(task({ end: "2026-09-06" })).snapped, false)
})

/* ── pointsOf ─────────────────────────────────────────────── */

test("pointsOf prefers the user's own weight, then the author's, then a guess", () => {
  const t = task({ difficulty: 100 })
  assert.deepEqual(pointsOf(t, { t1: 200 }), { points: 200, estimated: false })
  assert.deepEqual(pointsOf(t, {}),          { points: 100, estimated: false })
  assert.deepEqual(pointsOf(task(), {}),     { points: 50,  estimated: true  })
})

test("pointsOf steps past a junk override or a junk stored value", () => {
  assert.deepEqual(pointsOf(task({ difficulty: 100 }), { t1: "nope" }),
                   { points: 100, estimated: false })
  assert.deepEqual(pointsOf(task({ difficulty: -3 }), {}),
                   { points: 50, estimated: true })
})

test("pointsOf needs an id to look an override up by", () => {
  assert.deepEqual(pointsOf({ type: "normal" }, { t1: 200 }), { points: 0, estimated: false })
})

/* ── pointsFromFactors ────────────────────────────────────── */

test("the middle of every factor is Normal", () => {
  assert.equal(pointsFromFactors(3, 3, 3), 50)
})

test("pointsFromFactors stays inside the ladder's reach", () => {
  assert.equal(pointsFromFactors(1, 1, 1), 3)
  assert.equal(pointsFromFactors(5, 5, 5), 493)
  // Out-of-range rungs clamp rather than reading off the end of the scale
  assert.equal(pointsFromFactors(0, 1, 1), pointsFromFactors(1, 1, 1))
  assert.equal(pointsFromFactors(9, 5, 5), pointsFromFactors(5, 5, 5))
  assert.equal(pointsFromFactors("x", 3, 3), 50)
})

test("pointsFromFactors rises with every factor", () => {
  assert.ok(pointsFromFactors(2, 3, 3) < pointsFromFactors(4, 3, 3))
  assert.ok(pointsFromFactors(3, 2, 3) < pointsFromFactors(3, 4, 3))
  assert.ok(pointsFromFactors(3, 3, 2) < pointsFromFactors(3, 3, 4))
})

/* ── listTotals ───────────────────────────────────────────── */

const rows = tasks => tasks.map((t, i) => ({ id: "i" + i, task: t }))
const half = { mode: "percent", value: 50, total: 100 }
const pct = p => (p && p.total ? (p.value / p.total) * 100 : 0)

test("load and earned always add up to the total", () => {
  const list = rows([
    task({ id: "a", difficulty: 100 }),
    task({ id: "b", difficulty: 50 }),
    task({ id: "c", difficulty: 200 })
  ])
  const got = listTotals(list, {
    overrides: {},
    isDone: id => id === "a",
    progressOf: id => (id === "b" ? half : null),
    progressPct: pct
  })
  assert.equal(got.total, 350)
  assert.equal(got.earned, 125)   // all of a, half of b
  assert.equal(got.load, 225)
  assert.equal(got.load + got.earned, got.total)
})

test("a ticked task is all earned and no load", () => {
  const got = listTotals(rows([task({ id: "a", difficulty: 100 })]),
    { isDone: () => true, progressOf: () => null, progressPct: pct })
  assert.deepEqual(got, { load: 0, earned: 100, total: 100 })
})

test("a tick beats whatever the progress bar says", () => {
  const got = listTotals(rows([task({ id: "a", difficulty: 100 })]),
    { isDone: () => true, progressOf: () => half, progressPct: pct })
  assert.equal(got.earned, 100)
})

test("notes, orphans and markers add nothing", () => {
  const list = [
    { id: "n", task: null },
    { id: "m", task: task({ id: "m", type: "marker", difficulty: 500 }) },
    { id: "a", task: task({ id: "a", difficulty: 60 }) }
  ]
  const got = listTotals(list, { isDone: () => false, progressOf: () => null, progressPct: pct })
  assert.deepEqual(got, { load: 60, earned: 0, total: 60 })
})

test("listTotals will use a resolver handed in instead of its own", () => {
  // The page binds this user's own weights into its pointsOf and passes that.
  const got = listTotals(rows([task({ id: "a", difficulty: 10 })]),
    { resolve: () => ({ points: 70, estimated: false }),
      isDone: () => false, progressOf: () => null, progressPct: pct })
  assert.equal(got.total, 70)
})

test("listTotals survives being handed nothing at all", () => {
  assert.deepEqual(listTotals(), { load: 0, earned: 0, total: 0 })
  assert.deepEqual(listTotals([]), { load: 0, earned: 0, total: 0 })
  // No progress helpers: untouched work is all load, nothing throws.
  assert.deepEqual(listTotals(rows([task({ id: "a", difficulty: 40 })])),
                   { load: 40, earned: 0, total: 40 })
})

/* ── The target ───────────────────────────────────────────── */

test("normTarget clamps and falls back", () => {
  assert.equal(normTarget(2000), 2000)
  assert.equal(normTarget(1), TARGET_MIN)
  assert.equal(normTarget(999999), TARGET_MAX)
  assert.equal(normTarget("nope"), TARGET_FALLBACK)
  assert.equal(normTarget(undefined), TARGET_FALLBACK)
})

test("the stepper grows with the number", () => {
  assert.equal(targetStep(200), 50)
  assert.equal(targetStep(1000), 100)
  assert.equal(targetStep(5000), 250)
})

test("loadBand names the bands and calls past-target over", () => {
  assert.equal(loadBand(0, 1000).label, "Light")
  assert.equal(loadBand(400, 1000).label, "Comfortable")
  assert.equal(loadBand(800, 1000).label, "Busy")
  assert.equal(loadBand(1000, 1000).label, "Heavy")
  assert.equal(loadBand(1200, 1000).id, "over")
  assert.equal(loadBand(1200, 1000).ratio, 1.2)
})
