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

/* The ladder gets rescaled from time to time - it went x10 for V.3.3.
   Anything asserting *where on the scale* an answer lands reads the rung
   off PRESETS, so the next rescale only breaks the tests that are really
   about the arithmetic. NORMAL is the middle rung, the one everything
   else is tuned around. */
const [TRIVIAL, EASY, NORMAL, HARD, BRUTAL] = PRESETS.map(p => p.points)

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
  assert.equal(normPoints(MAX_POINTS * 10), MAX_POINTS)
})

test("the cap is the one the app promises", () => {
  // 7500 is a number the picker's max="" attributes repeat in two places.
  assert.equal(MAX_POINTS, 7500)
  assert.ok(BRUTAL < MAX_POINTS, "the top rung must leave room above it")
})

/* ── nearestPreset ────────────────────────────────────────── */

test("nearestPreset snaps to a rung and never lands between two", () => {
  // Just under halfway between two rungs goes down, just over goes up.
  const mid = (NORMAL + HARD) / 2
  assert.equal(nearestPreset(mid - 1).id, "normal")
  assert.equal(nearestPreset(mid + 1).id, "hard")
  assert.equal(nearestPreset(1).id, "trivial")            // below the bottom rung
  assert.equal(nearestPreset(BRUTAL * 4).id, "brutal")    // past the top rung
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
  assert.equal(suggestPoints({ id: "x", type: "normal" }), NORMAL)
  assert.equal(suggestPoints({ id: "x", type: "normal", start: "nonsense", end: "also" }), NORMAL)
  assert.equal(suggestPoints(null), 0)
})

test("an unrecognised type is weighed as an ordinary one", () => {
  // A document written by some future client mustn't fall off the ladder.
  assert.equal(suggestPoints({ id: "x", type: "whatever-this-is" }), NORMAL)
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
  assert.equal(e.factor, 1)          // 4-7 days is the neutral band
  assert.equal(e.raw, e.base)        // so the raw number is the base untouched
  assert.ok(e.base < NORMAL, "a prediction starts lighter than an ordinary task")
})

test("with no dates the explanation says so instead of inventing a span", () => {
  const e = explainSuggestion({ id: "x", type: "normal" })
  assert.equal(e.days, null)
  assert.equal(e.spanLabel, "no dates yet")
  assert.equal(e.points, NORMAL)
})

test("markers have nothing to explain", () => {
  assert.equal(explainSuggestion(task({ type: "marker" })), null)
  assert.equal(explainSuggestion(null), null)
})

test("snapped says whether the ladder moved the raw number", () => {
  // 2-3 days scales the base by 0.75, which lands between two rungs
  const e = explainSuggestion(task({ end: "2026-09-04" }))
  assert.equal(e.raw, Math.round(NORMAL * 0.75))
  assert.notEqual(e.points, e.raw)
  assert.equal(e.snapped, true)
  // 4-7 days leaves the base alone, and the base IS a rung
  const flat = explainSuggestion(task({ end: "2026-09-06" }))
  assert.equal(flat.raw, NORMAL)
  assert.equal(flat.points, NORMAL)
  assert.equal(flat.snapped, false)
})

/* ── pointsOf ─────────────────────────────────────────────── */

test("pointsOf prefers the user's own weight, then the author's, then a guess", () => {
  const t = task({ difficulty: 100 })
  assert.deepEqual(pointsOf(t, { t1: 200 }), { points: 200, estimated: false })
  assert.deepEqual(pointsOf(t, {}),          { points: 100, estimated: false })
  assert.deepEqual(pointsOf(task(), {}),     { points: NORMAL, estimated: true })
})

test("pointsOf steps past a junk override or a junk stored value", () => {
  assert.deepEqual(pointsOf(task({ difficulty: 100 }), { t1: "nope" }),
                   { points: 100, estimated: false })
  assert.deepEqual(pointsOf(task({ difficulty: -3 }), {}),
                   { points: NORMAL, estimated: true })
})

test("pointsOf needs an id to look an override up by", () => {
  assert.deepEqual(pointsOf({ type: "normal" }, { t1: 200 }), { points: 0, estimated: false })
})

/* ── pointsFromFactors ────────────────────────────────────── */

test("the middle of every factor is Normal", () => {
  // The whole panel is tuned around this: middle x middle x middle is the
  // middle rung. If a rescale misses one of the three scales, this catches it.
  assert.equal(pointsFromFactors(3, 3, 3), NORMAL)
})

test("pointsFromFactors brackets the ladder without escaping the cap", () => {
  const low  = pointsFromFactors(1, 1, 1)
  const high = pointsFromFactors(5, 5, 5)
  assert.ok(low < TRIVIAL, "bottom of the panel should sit under Trivial, got " + low)
  assert.ok(high > BRUTAL, "top of the panel should sit over Brutal, got " + high)
  assert.ok(high <= MAX_POINTS, "and still inside the cap")
  // Out-of-range rungs clamp rather than reading off the end of the scale
  assert.equal(pointsFromFactors(0, 1, 1), low)
  assert.equal(pointsFromFactors(9, 5, 5), high)
  assert.equal(pointsFromFactors("x", 3, 3), NORMAL)
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
  assert.equal(normTarget(TARGET_FALLBACK), TARGET_FALLBACK)
  assert.equal(normTarget(1), TARGET_MIN)
  assert.equal(normTarget(TARGET_MAX * 10), TARGET_MAX)
  assert.equal(normTarget("nope"), TARGET_FALLBACK)
  assert.equal(normTarget(undefined), TARGET_FALLBACK)
})

test("the target brackets a believable week of work", () => {
  // A target you cannot reach with a handful of tasks is not an indicator.
  assert.ok(TARGET_MIN <= NORMAL, "the floor must be reachable in one task")
  assert.ok(TARGET_FALLBACK >= BRUTAL, "the default must hold more than one hard task")
  assert.ok(TARGET_MAX > TARGET_FALLBACK)
})

test("the stepper grows with the number", () => {
  const small = targetStep(TARGET_MIN)
  const mid   = targetStep(TARGET_FALLBACK)
  const big   = targetStep(TARGET_MAX)
  assert.ok(small < mid && mid < big, small + " / " + mid + " / " + big + " should climb")
  // Nudging must never be so coarse that one tap jumps past the floor itself
  assert.ok(small <= TARGET_MIN)
})

test("loadBand names the bands and calls past-target over", () => {
  // Bands are fractions of the target, so they are stated that way.
  const t = TARGET_FALLBACK
  assert.equal(loadBand(0, t).label, "Light")
  assert.equal(loadBand(t * 0.4, t).label, "Comfortable")
  assert.equal(loadBand(t * 0.8, t).label, "Busy")
  assert.equal(loadBand(t, t).label, "Heavy")
  assert.equal(loadBand(t * 1.2, t).id, "over")
  assert.equal(loadBand(t * 1.2, t).ratio, 1.2)
})
