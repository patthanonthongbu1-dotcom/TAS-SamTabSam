/* ─────────────────────────────────────────────────────────────
   TAS Ideas — a place to dump a thought before it's gone.

   Its own tab beside To Do. Type, Enter, and the box stays focused so
   the next one goes straight in. An idea that turns into a plan is
   "Plan it" → a date → a block on that day in Blocks, and leaves here.
   One that is real work is "Task" → the My Tasks form, name filled in;
   it leaves here once that task is saved.

   One file: the pure list maths up top (tested under node, so nothing
   here imports Firestore), the view below. The page hands in how to
   load and save — tas-blocks-store.js, which keeps the list on the
   device when signed out, in dayPlans/{uid}/ideas/inbox when not —
   and how to drop a line into a day, from tas-blocks-ui.js.
   ───────────────────────────────────────────────────────────── */

// Mirrors the cap in firestore.rules, so the page refuses first.
export const MAX_IDEAS = 300
export const MAX_IDEA_TEXT = 500

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export function makeIdea(text, now = Date.now()) {
  return { id: newId(), text: String(text).trim().slice(0, MAX_IDEA_TEXT), at: now }
}

/* Cleaned on the way in, like sanitizeBlocks: a hand-edited doc or a
   newer client can't hand the renderer something it can't draw. */
export function sanitizeIdeas(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(i => i && typeof i.text === "string" && i.text.trim()).map(i => ({
    id: typeof i.id === "string" && i.id ? i.id : newId(),
    text: i.text.slice(0, MAX_IDEA_TEXT),
    at: Number.isFinite(i.at) ? i.at : 0,
    ...(i.pin === true ? { pin: true } : {})
  })).slice(0, MAX_IDEAS)
}

// "#math buy ruler" → ["math"]. \p{M} keeps Thai vowel marks inside a tag.
const TAG_RE = /#([\p{L}\p{N}\p{M}_-]+)/gu
export const tagsOf = text => [...new Set([...String(text).matchAll(TAG_RE)].map(m => m[1].toLowerCase()))]

const pad = n => String(n).padStart(2, "0")
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const FULL_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

/* A trailing word as a date: today/วันนี้, tmr/tomorrow/พรุ่งนี้, a weekday
   (the next one, never today) or d/m (this year, next if it's passed). */
function dueFrom(word, today) {
  const w = word.toLowerCase()
  const at = n => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n))
  if (w === "today" || w === "วันนี้") return at(0)
  if (w === "tmr" || w === "tomorrow" || w === "พรุ่งนี้") return at(1)
  const wd = WEEKDAYS.findIndex((d, n) => w === d || w === FULL_DAYS[n])
  if (wd !== -1) return at((wd - today.getDay() + 7) % 7 || 7)
  const m = w.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (m) {
    const day = +m[1], mon = +m[2] - 1
    let d = new Date(today.getFullYear(), mon, day)
    if (d.getMonth() !== mon || d.getDate() !== day) return ""   // 31/2 and friends
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(today.getFullYear() + 1, mon, day)
    return dayKey(d)
  }
  return ""
}

/* What "Task" pre-fills: the first tag is the subject, a trailing date
   word is the due date, and the name is what's left. */
export function parseQuick(text, today = new Date()) {
  const subject = tagsOf(text)[0] || ""
  const words = String(text).replace(TAG_RE, " ").trim().split(/\s+/).filter(Boolean)
  const due = words.length ? dueFrom(words[words.length - 1], today) : ""
  if (due) words.pop()
  return { name: words.join(" ") || String(text).trim(), subject, due }
}

// Pinned first; otherwise the stored order (newest first). Sort is stable.
export const sortIdeas = list => [...list].sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0))

export const STALE_DAYS = 14
export const isStale = (i, now = Date.now()) => !i.pin && i.at > 0 && now - i.at > STALE_DAYS * 86400000

// Newest first: the one just typed is the one you're looking at.
export function addIdea(list, idea) {
  if (!idea.text || list.length >= MAX_IDEAS) return list
  return [idea, ...list]
}

/* "just now", "5m ago", "3h ago", "2d ago", then the date. Rough on
   purpose: it says how fresh a thought is, not when exactly. */
export function ageLabel(at, now = Date.now()) {
  if (!at) return ""
  const m = Math.floor((now - at) / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/* ── The view ────────────────────────────────────────────── */
let uid = null, mount = null, getMount = () => null, H = {}, io = {}
let ideas = []            // as drawn
let lastSaved = []        // what the store confirmed — the rollback target
let loaded = false, loading = false, loadFailed = false
let editingId = null
// Motion: the rows stagger in when you arrive, and a new one springs in alone.
// Both are one-shot, so a redraw after a save never replays them.
let arrivePending = false, freshId = null, keepFocus = false
let query = ""            // the search box, kept across redraws
let shared = []           // text shared in from the OS before the list loaded
let rec = null            // the live speech recogniser, if listening
const SWIPE = 90          // px a row has to travel before a swipe counts

export function initIdeas(opts) {
  uid = opts.uid || null
  // A getter, because the host can rebuild the element (My Tasks redraws its
  // panes); a plain element still works.
  getMount = typeof opts.mount === "function" ? opts.mount : () => opts.mount
  mount = getMount()
  H = opts.helpers
  io = { load: opts.load, save: opts.save, adopt: opts.adopt, addToDay: opts.addToDay, removeFromDay: opts.removeFromDay, makeTask: opts.makeTask }
  ideas = []; lastSaved = []; loaded = false; loadFailed = false; editingId = null
  ensureLoaded()
}

export const ideaCount = () => ideas.length

/* Text shared from another app (the manifest's share_target). Held until
   the list has loaded, so it lands in the right place — device or account. */
export function queueShared(text) {
  const t = String(text || "").trim()
  if (t) shared.push(t)
  if (loaded) flushShared()
}

function flushShared() {
  if (!shared.length) return
  let next = ideas
  for (const t of shared) next = addIdea(next, makeIdea(t))
  shared = []
  if (next !== ideas) commit(next).then(ok => ok && H.toast("Kept what you shared"))
}

// The page calls this once the task made from an idea has been saved.
export function removeIdea(id) {
  if (ideas.some(i => i.id === id)) commit(ideas.filter(i => i.id !== id))
}

/* Arriving on the tab. A failed read is retried here, not from render —
   render runs after every failure, so retrying there would loop. */
export function open() {
  editingId = null
  arrivePending = true
  if (loadFailed) loadFailed = false
  render()
}

async function ensureLoaded() {
  if (loaded || loading || loadFailed) return
  loading = true
  const me = uid
  if (me && io.adopt) {
    const n = await io.adopt(me)
    if (n) H.toast(`Kept the ${n} idea${n === 1 ? "" : "s"} you wrote before signing in`)
  }
  const got = await io.load(me)
  loading = false
  if (me !== uid) return   // signed in or out while the read was out
  if (got === null) { loadFailed = true }
  else { ideas = got; lastSaved = got; loaded = true; loadFailed = false }
  H.onCount?.(ideas.length)
  if (H.isActive()) render()
  if (loaded) flushShared()
}

/* Optimistic: draw first, save, and put the last confirmed list back if
   the store refuses. Each change saves at once — an idea is committed on
   Enter, not per keystroke, so there's no burst to debounce. */
async function commit(next) {
  ideas = next
  H.onCount?.(ideas.length)
  if (H.isActive()) render()
  const ok = await io.save(uid, next)
  if (ok) { lastSaved = next; return true }
  ideas = lastSaved
  H.onCount?.(ideas.length)
  if (H.isActive()) render()
  H.toast("Couldn't save that — put back", { error: true })
  return false
}

export function render() {
  mount = getMount()
  if (!mount) return
  ensureLoaded()
  // Keep the keyboard up while typing idea after idea, but don't pop it
  // open on a phone just because the tab was opened or a row was deleted.
  keepFocus = document.activeElement?.id === "ideaAdd" || matchMedia("(pointer: fine)").matches
  const { esc, ico } = H
  const now = Date.now()
  const arrive = arrivePending && ideas.length > 0
  if (arrive) arrivePending = false
  const today = new Date()
  const stale = loaded ? ideas.filter(i => isStale(i, now)) : []
  const rows = sortIdeas(ideas).map((i, n) => i.id === editingId
    ? `<div class="idea-row editing" data-id="${esc(i.id)}">
        <input class="idea-edit" value="${esc(i.text)}" maxlength="${MAX_IDEA_TEXT}" aria-label="Edit idea">
      </div>`
    : `<div class="idea-row${i.id === freshId ? " fresh" : ""}${i.pin ? " pinned" : ""}${isStale(i, now) ? " stale" : ""}" data-id="${esc(i.id)}" style="--i:${Math.min(n, 10)}">
        <button class="idea-pin" data-act="pin" title="${i.pin ? "Unpin" : "Pin to the top"}" aria-label="${i.pin ? "Unpin" : "Pin"} idea" aria-pressed="${!!i.pin}">${ico("tack")}</button>
        <button class="idea-text" data-act="edit">${esc(i.text)}<span class="idea-meta"><span class="idea-age">${esc(ageLabel(i.at, now))}</span>${metaChips(i, today)}</span></button>
        <button class="idea-plan" data-act="task" title="Make it a task">${ico("check-square")}<span>Task</span></button>
        <label class="idea-plan" title="Plan it on a day">${ico("calendar")}<span>Plan it</span>
          <input type="date" data-act="plan" aria-label="Plan “${esc(i.text)}” on a day">
        </label>
        <button class="idea-del" data-act="del" title="Delete" aria-label="Delete idea">${ico("trash")}</button>
      </div>`).join("")

  const foot = loadFailed ? `${ico("warning")} Couldn't load your ideas — check your connection`
    : !loaded ? "Loading your ideas…"
    : ideas.length >= MAX_IDEAS ? `That's ${MAX_IDEAS}, the most this list holds — plan or clear some`
    : uid ? "Saved to your account" : "Saved on this device — sign in to keep them everywhere"

  mount.innerHTML = `
    <div class="tl-wrap idea-wrap${arrive ? " arrive" : ""}">
      <div class="tl-head"><div class="tl-title">Ideas${ideas.length ? `<span class="tl-yr">${ideas.length}</span>` : ""}</div></div>
      <form class="idea-add-row" id="ideaForm">
        <input class="idea-add" id="ideaAdd" placeholder="Spit it out — Enter to keep it" maxlength="${MAX_IDEA_TEXT}"
          enterkeyhint="enter" autocomplete="off" aria-label="New idea" ${ideas.length >= MAX_IDEAS ? "disabled" : ""}>
        <button class="idea-go" type="submit" aria-label="Add idea" ${ideas.length >= MAX_IDEAS ? "disabled" : ""}>${ico("plus")}</button>
        ${SR ? `<button class="idea-go idea-mic${rec ? " on" : ""}" type="button" data-act="mic" aria-label="Say it" title="Say it">${ico("mic")}</button>` : ""}
      </form>
      ${ideas.length >= 8 || query ? `<input class="idea-add idea-search" id="ideaSearch" type="search" placeholder="Search, or #tag" value="${esc(query)}" aria-label="Search ideas" autocomplete="off">` : ""}
      ${stale.length && !query ? `<div class="idea-stale-bar">${ico("timer")}<span>${stale.length} idea${stale.length === 1 ? " is" : "s are"} over ${STALE_DAYS} days old. Still want ${stale.length === 1 ? "it" : "them"}?</span>
        <button data-act="keep-stale">Keep</button><button data-act="clear-stale" class="danger">Clear</button></div>` : ""}
      <div class="idea-list">${rows || (loaded ? `<div class="idea-empty">${ico("inbox")}<p>Nothing here yet</p><small>Type anything above. You can turn it into a plan later.</small></div>` : "")}</div>
      <div class="tl-foot">${foot}</div>
    </div>`
  wire()
  applyFilter()
}

// A due chip if a date word was found, then the tags.
function metaChips(i, today) {
  const { esc } = H
  const { due } = parseQuick(i.text, today)
  return (due ? `<span class="idea-chip due">due ${esc(H.shortDate(new Date(due + "T00:00:00")))}</span>` : "") +
    tagsOf(i.text).map(t => `<span class="idea-chip tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join("")
}

// Hides rows rather than redrawing, so typing in search keeps its caret.
function applyFilter() {
  const q = query.trim().toLowerCase()
  mount.querySelectorAll(".idea-row").forEach(r => {
    const i = ideas.find(x => x.id === r.dataset.id)
    r.hidden = !!q && !!i && !i.text.toLowerCase().includes(q)
  })
}

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition

function listen(btn) {
  if (rec) { rec.stop(); return }
  rec = new SR()
  rec.lang = navigator.language || "th-TH"
  rec.interimResults = false
  rec.onresult = e => {
    const box = mount.querySelector("#ideaAdd")
    const said = e.results[0]?.[0]?.transcript || ""
    if (box && said) { box.value = (box.value + " " + said).trim(); box.focus() }
  }
  rec.onerror = e => { if (e.error !== "aborted" && e.error !== "no-speech") H.toast("Couldn't hear that — check the mic permission", { error: true }) }
  rec.onend = () => { rec = null; mount.querySelector(".idea-mic")?.classList.remove("on") }
  rec.start()
  btn.classList.add("on")
}

const makeTask = id => {
  const idea = ideas.find(i => i.id === id)
  if (idea) io.makeTask?.(idea, parseQuick(idea.text))
}

/* Touch only: slide a row left to delete it, right to make it a task.
   touch-action: pan-y hands vertical drags to the page, which cancels
   ours — so scrolling the list never trips a swipe. */
function swipe(row, id) {
  let x0 = null, y0 = 0, dx = 0, on = false, swallow = false
  const reset = () => { row.style.transform = ""; row.dataset.swipe = "" }
  row.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return
    x0 = e.clientX; y0 = e.clientY; dx = 0; on = false
  })
  row.addEventListener("pointermove", e => {
    if (x0 === null) return
    dx = e.clientX - x0
    if (!on) {
      if (Math.abs(e.clientY - y0) > 12) { x0 = null; return }
      if (Math.abs(dx) < 12) return
      on = true
    }
    row.style.transform = `translateX(${dx}px)`
    row.dataset.swipe = dx <= -SWIPE ? "del" : dx >= SWIPE ? "task" : ""
  })
  row.addEventListener("pointerup", () => {
    if (x0 === null) return
    x0 = null
    if (!on) return
    swallow = true   // the lift would otherwise click whatever is under it
    reset()
    if (dx <= -SWIPE) remove(id)
    else if (dx >= SWIPE) makeTask(id)
  })
  row.addEventListener("pointercancel", () => { x0 = null; on = false; reset() })
  row.addEventListener("click", e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault() } }, true)
}

function clearStale() {
  const now = Date.now()
  const gone = ideas.filter(i => isStale(i, now))
  if (!gone.length) return
  commit(ideas.filter(i => !isStale(i, now))).then(ok => ok && H.toast(`Cleared ${gone.length} old idea${gone.length === 1 ? "" : "s"}`, {
    action: "Undo",
    // The oldest ideas sit at the end of the newest-first list, so they go back there
    onAction: () => commit([...ideas, ...gone.filter(g => !ideas.some(i => i.id === g.id))].slice(0, MAX_IDEAS))
  }))
}

function wire() {
  const add = mount.querySelector("#ideaAdd")
  if (add && !editingId && keepFocus) add.focus({ preventScroll: true })
  // A form, so the phone's Enter key and the + button both land here.
  mount.querySelector("#ideaForm")?.addEventListener("submit", e => {
    e.preventDefault()
    if (e.isComposing) return
    const idea = makeIdea(add.value)
    if (!idea.text || !loaded) return
    // commit draws before it awaits, so "fresh" marks this one draw only
    freshId = idea.id
    commit(addIdea(ideas, idea))
    freshId = null
    navigator.vibrate?.(6)
  })
  mount.querySelector('[data-act="mic"]')?.addEventListener("click", e => listen(e.currentTarget))
  mount.querySelector("#ideaSearch")?.addEventListener("input", e => {
    const had = !!query
    query = e.target.value
    if (had === !!query) { applyFilter(); return }
    // The stale bar comes and goes with an empty box, so that needs a redraw
    render()
    const box = mount.querySelector("#ideaSearch")
    box?.focus(); box?.setSelectionRange(box.value.length, box.value.length)
  })
  mount.querySelector('[data-act="keep-stale"]')?.addEventListener("click", () => {
    const now = Date.now()
    commit(ideas.map(i => isStale(i, now) ? { ...i, at: now } : i))
  })
  mount.querySelector('[data-act="clear-stale"]')?.addEventListener("click", clearStale)

  mount.querySelectorAll(".idea-row").forEach(row => {
    const id = row.dataset.id
    const edit = row.querySelector(".idea-edit")
    if (edit) {
      edit.focus(); edit.setSelectionRange(edit.value.length, edit.value.length)
      let done = false
      const finish = save => {
        if (done) return
        done = true
        editingId = null
        const text = edit.value.trim().slice(0, MAX_IDEA_TEXT)
        const was = ideas.find(i => i.id === id)
        if (save && text && was && text !== was.text) commit(ideas.map(i => i.id === id ? { ...i, text } : i))
        else render()
      }
      edit.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); finish(true) }
        else if (e.key === "Escape") finish(false)
      })
      edit.addEventListener("blur", () => finish(true))
      return
    }
    row.querySelector('[data-act="edit"]').addEventListener("click", e => {
      const tag = e.target.closest("[data-tag]")
      if (tag) { query = "#" + tag.dataset.tag; render(); return }
      editingId = id; render()
    })
    row.querySelector('[data-act="pin"]').addEventListener("click", () => commit(ideas.map(i => {
      if (i.id !== id) return i
      if (!i.pin) return { ...i, pin: true }
      const { pin, ...rest } = i
      return rest
    })))
    row.querySelector('[data-act="del"]').addEventListener("click", () => remove(id))
    row.querySelector('[data-act="task"]').addEventListener("click", () => makeTask(id))
    swipe(row, id)
    row.querySelector('[data-act="plan"]').addEventListener("change", e => plan(id, e.target.value))
  })
}

async function remove(id) {
  const at = ideas.findIndex(i => i.id === id)
  if (at === -1) return
  const gone = ideas[at]
  navigator.vibrate?.(6)
  if (!(await commit(ideas.filter(i => i.id !== id)))) return
  H.toast("Idea deleted", { action: "Undo", onAction: () => restore(gone, at) })
}

function restore(idea, at) {
  if (ideas.some(i => i.id === idea.id)) return
  const next = [...ideas]
  next.splice(Math.min(at, next.length), 0, idea)
  commit(next.slice(0, MAX_IDEAS))
}

/* The block goes in first; only once it's placed does the idea leave, so
   a full day or a failed read never makes a thought vanish. */
async function plan(id, dayKey) {
  const idea = ideas.find(i => i.id === id)
  if (!idea || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return
  const blockId = await io.addToDay(dayKey, idea.text)
  if (!blockId) { H.toast("Couldn't add it to that day — it may be full", { error: true }); render(); return }
  const at = ideas.findIndex(i => i.id === id)
  navigator.vibrate?.(6)
  if (!(await commit(ideas.filter(i => i.id !== id)))) return
  H.toast(`Planned for ${H.shortDate(new Date(dayKey + "T00:00:00"))}`, {
    action: "Undo", onAction: () => { io.removeFromDay(dayKey, blockId); restore(idea, at) }
  })
}
