/* ─────────────────────────────────────────────────────────────
   TAS points — how heavy a task is.

   More points = harder. A weight lets the To Do list say something
   a count never could: whether what you are carrying is a quiet
   week or a wall.

   Pure arithmetic, like tas-todo-state.js: no DOM, no Firestore,
   so it can be run under `node --test` (see tas-points.test.mjs).
   Both calendar.html and tas-todo-ui.js import it, which is what
   stops the timeline, the To Do rows and the meter from ever
   disagreeing about what a task is worth.

   Where the number comes from, in order:
     1. the weight this user set for themselves
     2. the weight whoever wrote the task gave it
     3. an estimate from the task's own shape

   That third rung is why there is no migration. Every task that
   already exists has a weight the moment this ships — it is just
   marked as a guess (`estimated`), so the app can draw it faintly
   and the meter stays honest about what it actually knows.
   ───────────────────────────────────────────────────────────── */

export const MAX_POINTS = 7500

/* The ladder. A plain number is what gets stored, never a preset id —
   so a custom value and a worked-out one live in the same field, and
   nothing downstream has to know which door a number came through. */
export const PRESETS = [
  { id: "trivial", label: "Trivial", points: 100,  desc: "Minutes"          },
  { id: "easy",    label: "Easy",    points: 250,  desc: "One sitting"      },
  { id: "normal",  label: "Normal",  points: 500,  desc: "An evening"       },
  { id: "hard",    label: "Hard",    points: 1000, desc: "Several sessions" },
  { id: "brutal",  label: "Brutal",  points: 2000, desc: "Days of work"     }
]

/* Anything read back from Firestore is untrusted — an old client, a
   console edit or a half-written doc must not be able to render a NaN
   pill or poison the meter's total. Same clamp-and-coerce shape as
   normProgress() in calendar.html. Returns null for "no weight set",
   which is a different thing from zero. */
export function normPoints(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(MAX_POINTS, n)
}

/* ── The estimate ────────────────────────────────────────────
   Two things the task already tells us: what kind of due date it has,
   and how long it runs. Neither measures difficulty on its own, but
   together they beat 50-for-everything as a first guess.

   Types normally arrive normalised (calendar.html's taskType()), but the
   legacy spellings are listed here too so a caller handing over a raw
   document still gets a sensible answer rather than the fallback. */
const TYPE_BASE = {
  normal: 500, send_on: 500,
  deadline: 500, send_before: 500,
  prediction: 250, estimated: 250,
  marker: 0
}

/* What an unrecognised type is worth: the same as an ordinary one.
   Named, so a rescale of the ladder cannot leave a bare 50 behind. */
const NORMAL_BASE = TYPE_BASE.normal

/* A task that runs three weeks is not three weeks of work, but it is
   more work than one due tomorrow. Bands rather than a curve, since the
   answer is snapped to a preset anyway. */
function spanFactor(days) {
  if (!Number.isFinite(days)) return 1
  // SPAN_BANDS is declared below and is the one copy of these numbers, so
  // the estimate and the explanation of it can never drift apart.
  return SPAN_BANDS.find(b => days <= b.upto).factor
}

// Whole days between two YYYY-MM-DD strings. NaN when either is missing.
function spanDays(start, end) {
  if (!start || !end) return NaN
  const a = Date.parse(String(start) + "T00:00:00")
  const b = Date.parse(String(end) + "T00:00:00")
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.round((b - a) / 864e5)
}

/* Snap to the nearest rung. A suggestion landing between two presets
   would leave every chip unlit, which reads as "nothing is selected"
   rather than "here is our guess". */
export function nearestPreset(points) {
  const n = normPoints(points)
  if (n === null) return null
  return PRESETS.reduce((best, p) =>
    Math.abs(p.points - n) < Math.abs(best.points - n) ? p : best)
}

/* Markers are places in time rather than work — they carry no weight
   anywhere, and the To Do pool already refuses to offer them. */
export function suggestPoints(task) {
  if (!task) return 0
  const type = String(task.type || "normal")
  const base = TYPE_BASE[type] === undefined ? NORMAL_BASE : TYPE_BASE[type]
  if (!base) return 0
  const raw = base * spanFactor(spanDays(task.start, task.end))
  return nearestPreset(raw).points
}

/* How the estimate was reached, in parts, so the app can show its
   working rather than asserting a number. Same arithmetic as
   suggestPoints — this returns the steps instead of just the answer, and
   the two are kept honest by a test that checks they agree. */
export const SPAN_BANDS = [
  { upto: 1,        factor: 0.5,  label: "a day or less" },
  { upto: 3,        factor: 0.75, label: "2–3 days"      },
  { upto: 7,        factor: 1,    label: "4–7 days"      },
  { upto: 14,       factor: 1.5,  label: "1–2 weeks"     },
  { upto: Infinity, factor: 2,    label: "over 2 weeks"  }
]

export const TYPE_REASON = {
  normal:     "a fixed send date",
  deadline:   "a hard deadline",
  prediction: "no clear deadline, so probably lighter"
}

export function explainSuggestion(task) {
  if (!task) return null
  const type = String(task.type || "normal")
  const canon = { send_on: "normal", send_before: "deadline", estimated: "prediction" }[type] || type
  if (canon === "marker") return null

  const base = TYPE_BASE[type] === undefined ? NORMAL_BASE : TYPE_BASE[type]
  const days = spanDays(task.start, task.end)
  const known = Number.isFinite(days)
  const band = known ? SPAN_BANDS.find(b => days <= b.upto) : null
  const factor = band ? band.factor : 1
  const raw = base * factor
  const preset = nearestPreset(raw)

  return {
    base,
    reason: TYPE_REASON[canon] || "how it's due",
    days: known ? days : null,
    spanLabel: band ? band.label : "no dates yet",
    factor,
    raw: Math.round(raw),
    points: preset ? preset.points : 0,
    presetLabel: preset ? preset.label : "",
    // True when the ladder pulled the raw number to a different rung
    snapped: preset ? preset.points !== Math.round(raw) : false
  }
}

/* ── Resolving ───────────────────────────────────────────────
   `overrides` is this user's own map of taskId → points, which lives
   beside their ticks and progress in userDone/{uid}. It wins: a shared
   class task is written by someone else, and they cannot know how hard
   it is going to be for you. */
export function pointsOf(task, overrides) {
  if (!task || !task.id) return { points: 0, estimated: false }
  if (String(task.type || "") === "marker") return { points: 0, estimated: false }

  const mine = overrides ? normPoints(overrides[task.id]) : null
  if (mine !== null) return { points: mine, estimated: false }

  const theirs = normPoints(task.difficulty)
  if (theirs !== null) return { points: theirs, estimated: false }

  return { points: suggestPoints(task), estimated: true }
}

/* ── The factor panel ────────────────────────────────────────
   Three 1–5 rows multiplied together, for when no preset fits and a bare
   number field is too blank a page. Tuned so the middle of everything is
   Normal: 500 × 1 × 1. The range runs 34…4928, bracketing the ladder at
   both ends. */
export const FACTORS = {
  effort: { label: "Effort", desc: "How hard is the thinking",
            scale: [120, 250, 500, 850, 1400],
            words: ["Barely", "A little", "Real work", "Tough", "Gruelling"] },
  time:   { label: "Time", desc: "How long it takes",
            scale: [0.4, 0.7, 1.0, 1.5, 2.2],
            words: ["Minutes", "An hour", "An evening", "Days", "All week"] },
  weight: { label: "Weight", desc: "How much it counts for",
            scale: [0.7, 0.85, 1.0, 1.25, 1.6],
            words: ["Barely", "A bit", "Normal", "A lot", "Everything"] }
}

export const FACTOR_KEYS = ["effort", "time", "weight"]
export const FACTOR_MID = { effort: 3, time: 3, weight: 3 }

const rung = (key, i) => {
  const s = FACTORS[key].scale
  const n = Math.round(Number(i))
  return s[Math.min(s.length, Math.max(1, Number.isFinite(n) ? n : 3)) - 1]
}

export function pointsFromFactors(effort, time, weight) {
  const raw = rung("effort", effort) * rung("time", time) * rung("weight", weight)
  return Math.min(MAX_POINTS, Math.max(1, Math.round(raw)))
}

/* ── The meter ───────────────────────────────────────────────
   What the To Do box reads. `load` is what is left to do, `earned` is
   what has been cleared, and they always sum to `total` — so flipping
   the meter between them is two readings of one number rather than two
   sums that might not agree.

   Half-finished work counts half. The progress data is already there and
   already means exactly this; ignoring it would make a task you are
   nearly through weigh the same as one you have not opened.

   `rows` are the resolved To Do rows. Anything without a live task
   behind it — a note, an orphan — has no weight and is skipped.

   `resolve` lets a caller that already has its own pointsOf — one with
   this user's overrides bound into it — hand that in rather than pass the
   override map down through here. */
export function listTotals(rows, { overrides, resolve, isDone, progressOf, progressPct } = {}) {
  const weigh = resolve || (t => pointsOf(t, overrides))
  let load = 0, earned = 0
  for (const r of rows || []) {
    const task = r && r.task
    if (!task || !task.id) continue
    const { points } = weigh(task)
    if (!points) continue

    let frac = 0
    if (isDone && isDone(task.id)) {
      frac = 1
    } else if (progressOf && progressPct) {
      const p = progressOf(task.id)
      if (p) frac = Math.min(1, Math.max(0, progressPct(p) / 100))
    }
    earned += points * frac
    load   += points * (1 - frac)
  }
  // Rounded at the end, not per row, so the two halves still add up.
  const l = Math.round(load)
  const e = Math.round(earned)
  return { load: l, earned: e, total: l + e }
}

/* ── The target ──────────────────────────────────────────────
   Not a limit — an indicator. It is whatever this person reckons a
   comfortable amount of work to be carrying, and the meter reads
   against it. */
export const TARGET_FALLBACK = 10000
export const TARGET_MIN = 500
export const TARGET_MAX = 200000

export function normTarget(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return TARGET_FALLBACK
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, n))
}

/* The ± buttons move by more as the number grows — forty taps to reach
   20000 in five-hundreds would be its own kind of homework. */
export function targetStep(target) {
  const n = normTarget(target)
  if (n < 5000) return 500
  if (n < 20000) return 1000
  return 2500
}

/* How the meter describes itself. Bands rather than a bare percentage,
   because "Busy" is the thing you actually wanted to know. */
const BANDS = [
  { upto: 0.25, label: "Light" },
  { upto: 0.60, label: "Comfortable" },
  { upto: 0.85, label: "Busy" },
  { upto: 1.00, label: "Heavy" }
]

export function loadBand(load, target) {
  const t = normTarget(target)
  const ratio = t > 0 ? load / t : 0
  if (ratio > 1) return { id: "over", label: "Over target", ratio }
  const band = BANDS.find(b => ratio <= b.upto) || BANDS[BANDS.length - 1]
  return { id: band.label.toLowerCase(), label: band.label, ratio }
}
