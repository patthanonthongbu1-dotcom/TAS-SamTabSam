/* ─────────────────────────────────────────────────────────────
   TAS statistics — what the term actually looked like.

   Pure arithmetic over the data the app already keeps, like
   tas-points.js and tas-todo-state.js: no DOM, no Firestore, so it
   runs under `node --test` (see tas-stats.test.mjs) and the home
   page is left with nothing to do but draw the answers.

   Weights come from tas-points.js rather than being worked out
   again here. That module exists precisely so the timeline, the To
   Do meter and this page can't disagree about what a task is worth,
   and a second opinion about it would be a bug with a long fuse.

   ── What it can and cannot know ──
   Completions, points, overdues and workload have always been
   derivable. *When* something was finished has not: `done` was a map
   of `{taskId: true}` with no timestamp anywhere in it. It stores an
   epoch stamp from V.3.3 on, so anything here that needs a date —
   the activity chart, punctuality, the streaks — describes only what
   has been ticked since then. Entries that are still `true` are
   counted as done and excluded from anything time-shaped, and every
   figure that depends on stamps reports its own `stamped` count so
   the page can say "this fills in as you go" rather than draw an
   empty chart and imply a quiet term.
   ───────────────────────────────────────────────────────────── */

import { pointsOf } from "./tas-points.js"

/* Tasks whose "due date" is a guess, and markers, which are places in
   time rather than work. Neither can be late, so neither counts as
   overdue — this is the same rule the calendar draws by. */
const NOT_WORK = new Set(["marker"])
const NOT_LATE = new Set(["marker", "prediction", "estimated"])

// Legacy spellings still sitting on live documents — see TYPE_ALIASES
// in calendar.html. Anything filtering on type has to know both.
const TYPE_ALIASES = { send_on: "normal", send_before: "deadline", estimated: "prediction" }
const typeOf = t => TYPE_ALIASES[t && t.type] || (t && t.type) || "normal"

export const dayKey = (d) => {
  const p = n => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}

/* Local midnight, so a comparison against a stamp made at 11pm doesn't
   slip a day. Returns null rather than an Invalid Date: a half-written
   document should read as "no date", not as NaN days late. */
export function parseDay(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(d.getTime()) ? d : null
}

// Whole days from a to b. Both are snapped to midnight first, so this
// counts calendar days rather than elapsed hours.
const daysBetween = (a, b) =>
  Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate())
            - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000)

/* A tick's date, or null. Pre-V.3.3 entries are `true`, which means
   done but undated — the distinction this whole file turns on. */
function doneDate(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/* Every weighable task this person has, each resolved once: its
   points, whether it is ticked, and when. Everything below reads this
   rather than walking the two arrays again — one pass, and one place
   where "what counts as a task" is decided.

   Markers are dropped here, not filtered out further down, because
   they are not work and would otherwise have to be excluded from six
   separate sums. */
export function collect({ tasks = [], personal = [], done = {}, overrides = {} } = {}) {
  const out = []
  const seen = new Set()
  for (const t of [...tasks, ...personal]) {
    if (!t || !t.id || seen.has(t.id)) continue
    seen.add(t.id)
    if (NOT_WORK.has(typeOf(t))) continue
    const tick = done[t.id]
    out.push({
      task: t,
      id: t.id,
      subject: t.subject || "No subject",
      type: typeOf(t),
      points: pointsOf(t, overrides).points,
      due: parseDay(t.end),
      isDone: !!tick,
      doneAt: doneDate(tick)
    })
  }
  return out
}

/* ── The headline ────────────────────────────────────────────
   Four numbers: what is finished, what is late, what is left, and
   how long it all took. `points` everywhere is the weight, not the
   count — a term of twenty brutal tasks and a term of twenty trivial
   ones are not the same term. */
export function headline(rows, { time = {}, now = new Date() } = {}) {
  let doneCount = 0, donePoints = 0
  let openCount = 0, openPoints = 0
  let overdueCount = 0, overduePoints = 0
  let oldestOverdue = null

  for (const r of rows) {
    if (r.isDone) { doneCount++; donePoints += r.points; continue }
    openCount++
    openPoints += r.points
    if (NOT_LATE.has(r.type) || !r.due) continue
    const late = daysBetween(r.due, now)
    if (late <= 0) continue
    overdueCount++
    overduePoints += r.points
    if (oldestOverdue === null || late > oldestOverdue) oldestOverdue = late
  }

  return {
    done: { count: doneCount, points: donePoints },
    open: { count: openCount, points: openPoints },
    overdue: { count: overdueCount, points: overduePoints, oldestDays: oldestOverdue },
    time: timeTotals(time, now)
  }
}

/* ── Time on site ────────────────────────────────────────────
   The map tas-time.js writes: { "YYYY-MM-DD": { ms, opens } }. It is
   user-writable like everything else in these documents, so every
   figure is coerced rather than trusted. */
export function timeTotals(time = {}, now = new Date()) {
  let totalMs = 0, opens = 0, activeDays = 0
  const today = dayKey(now)
  let todayMs = 0

  for (const [day, v] of Object.entries(time || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !v) continue
    const ms = Math.max(0, Number(v.ms) || 0)
    totalMs += ms
    opens += Math.max(0, Number(v.opens) || 0)
    if (ms > 0) activeDays++
    if (day === today) todayMs = ms
  }

  return {
    totalMs, opens, activeDays, todayMs,
    // What one sitting tends to look like, which is the readable number.
    perDayMs: activeDays ? Math.round(totalMs / activeDays) : 0
  }
}

/* ── The activity chart ──────────────────────────────────────
   Points cleared per day, newest last, with every day in the window
   present even when nothing happened — a chart that silently omits
   its empty days draws a busy term out of a quiet one. */
export function activity(rows, { days = 30, now = new Date() } = {}) {
  const buckets = new Map()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    buckets.set(dayKey(d), { day: dayKey(d), date: d, points: 0, count: 0 })
  }

  let stamped = 0
  for (const r of rows) {
    if (!r.doneAt) continue
    stamped++
    const b = buckets.get(dayKey(r.doneAt))
    if (!b) continue           // finished before the window opened
    b.points += r.points
    b.count++
  }

  const series = [...buckets.values()]
  return { series, stamped, peak: series.reduce((m, b) => Math.max(m, b.points), 0) }
}

/* ── How fast things actually got done ───────────────────────
   Measured against the deadline, because that is the question people
   ask themselves: did I finish this with time to spare, or the
   morning it was due? Negative days are early.

   Tasks with no deadline, or ticked before stamps existed, are not
   counted — and `rated` says how many were, so the page can show the
   average with the sample size beside it instead of a bare number
   built from three tasks. */
export function punctuality(rows) {
  const scored = []
  for (const r of rows) {
    if (!r.doneAt || !r.due || NOT_LATE.has(r.type)) continue
    scored.push({ id: r.id, name: r.task.name || "", subject: r.subject,
                  points: r.points, days: daysBetween(r.due, r.doneAt) })
  }

  if (!scored.length) {
    return { rated: 0, avgDays: 0, early: 0, onTime: 0, late: 0, best: null, worst: null }
  }

  let sum = 0, early = 0, onTime = 0, late = 0
  for (const s of scored) {
    sum += s.days
    if (s.days < 0) early++
    else if (s.days === 0) onTime++
    else late++
  }

  const byDays = [...scored].sort((a, b) => a.days - b.days)
  return {
    rated: scored.length,
    avgDays: sum / scored.length,
    early, onTime, late,
    best: byDays[0],                     // furthest ahead of the deadline
    worst: byDays[byDays.length - 1]     // furthest past it
  }
}

/* ── Where the work went ─────────────────────────────────────
   Cleared points per subject, heaviest first. Counts every finished
   task, stamped or not — this one has no time in it. */
export function bySubject(rows) {
  const map = new Map()
  for (const r of rows) {
    if (!r.isDone) continue
    const cur = map.get(r.subject) || { subject: r.subject, points: 0, count: 0 }
    cur.points += r.points
    cur.count++
    map.set(r.subject, cur)
  }
  return [...map.values()].sort((a, b) => b.points - a.points || b.count - a.count)
}

/* ── Streaks ─────────────────────────────────────────────────
   `current` runs back from today, and tolerates today being empty:
   at nine in the morning you have not broken anything yet, and a
   counter that resets at midnight would be wrong for most of the
   day. It only breaks once yesterday is empty too. */
export function streaks(rows, { now = new Date() } = {}) {
  const days = new Set()
  for (const r of rows) if (r.doneAt) days.add(dayKey(r.doneAt))
  if (!days.size) return { current: 0, longest: 0, activeDays: 0 }

  const sorted = [...days].sort()
  let longest = 1, run = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDay(sorted[i - 1]), cur = parseDay(sorted[i])
    run = daysBetween(prev, cur) === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }

  let current = 0
  const start = days.has(dayKey(now)) ? 0 : 1
  for (let i = start; ; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    if (!days.has(dayKey(d))) break
    current++
  }

  return { current, longest, activeDays: days.size }
}

/* ── The fun ones ────────────────────────────────────────────
   Each returns null when there is nothing to say, so the page can
   leave the card out rather than print a zero and call it an award. */
export function awards(rows, { now = new Date() } = {}) {
  const stampedRows = rows.filter(r => r.doneAt)

  // Heaviest single thing cleared. Stamps aren't needed for this one.
  let biggest = null
  for (const r of rows) {
    if (!r.isDone || !r.points) continue
    if (!biggest || r.points > biggest.points) biggest = r
  }

  // The day the most got cleared.
  const perDay = new Map()
  for (const r of stampedRows) {
    const k = dayKey(r.doneAt)
    const cur = perDay.get(k) || { day: k, points: 0, count: 0 }
    cur.points += r.points
    cur.count++
    perDay.set(k, cur)
  }
  let bestDay = null
  for (const d of perDay.values()) if (!bestDay || d.points > bestDay.points) bestDay = d

  /* Anything ticked between 10pm and 5am. The window wraps midnight,
     which is the whole point of the award. */
  const nightOwl = stampedRows.filter(r => {
    const h = r.doneAt.getHours()
    return h >= 22 || h < 5
  }).length

  // The most-cleared subject, if one is actually ahead.
  const subjects = bySubject(rows)
  const favourite = subjects.length ? subjects[0] : null

  return {
    biggest: biggest ? { name: biggest.task.name || "", points: biggest.points, subject: biggest.subject } : null,
    bestDay,
    nightOwl,
    favourite,
    ...streaks(rows, { now })
  }
}

/**
 * Everything the home page draws, in one pass.
 *
 * @param {object} input
 * @param {Array}  input.tasks     shared tasks
 * @param {Array}  input.personal  this account's own tasks
 * @param {object} input.done      userDone.done — { id: epochMs | true }
 * @param {object} input.overrides userDone.difficulty — this reader's weights
 * @param {object} input.time      settings.time — { "YYYY-MM-DD": {ms, opens} }
 * @param {Date}   [input.now]     injectable, so the tests aren't dated
 * @param {number} [input.windowDays] how far the activity chart looks back
 */
export function summarise(input = {}) {
  const now = input.now || new Date()
  const rows = collect(input)
  const stamped = rows.filter(r => r.doneAt).length

  return {
    now,
    total: rows.length,
    /* How many finished ticks carry a date. The page needs this to tell
       "you haven't done anything" apart from "this started recording
       recently", which look identical in every chart below. */
    stamped,
    undated: rows.filter(r => r.isDone && !r.doneAt).length,
    ...headline(rows, { time: input.time, now }),
    activity: activity(rows, { days: input.windowDays || 30, now }),
    punctuality: punctuality(rows),
    subjects: bySubject(rows),
    awards: awards(rows, { now })
  }
}

/* ── Formatting ──────────────────────────────────────────────
   Here rather than on the page, because the tests can then pin the
   awkward cases — 59 seconds, exactly an hour, a term's worth — and
   because the same durations appear in more than one card. */
export function humanMs(ms) {
  const s = Math.max(0, Math.round(Number(ms) || 0) / 1000)
  if (s < 60) return Math.round(s) + "s"
  const mins = Math.round(s / 60)
  if (mins < 60) return mins + "m"
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 24) return m ? h + "h " + m + "m" : h + "h"
  const d = Math.floor(h / 24)
  return (h % 24) ? d + "d " + (h % 24) + "h" : d + "d"
}

/** "3 days early" / "on the day" / "2 days late". */
export function humanDays(days) {
  const n = Math.round(Number(days) || 0)
  if (n === 0) return "on the day"
  const abs = Math.abs(n)
  return abs + (abs === 1 ? " day " : " days ") + (n < 0 ? "early" : "late")
}
