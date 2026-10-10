/* ─────────────────────────────────────────────────────────────
   TAS Blocks — the month of plans, and the Day Designer.

   The third calendar layout, beside Timeline and Month grid. It
   renders into the calendar's own #calWrap like the other two, so
   switching layouts needs no extra plumbing; the Day Designer is a
   sheet of its own on <body>, built once and redrawn in place.

   Same split as To Do: tas-blocks-state.js does the array maths,
   tas-blocks-store.js persists it, and this file is the DOM, the
   pointer-driven drag, and the optimistic-update/rollback around
   the store. Tasks are never fetched here — the calendar hands its
   live lists over through helpers, so a linked block shows the same
   colour its task wears on the timeline.
   ───────────────────────────────────────────────────────────── */

import * as S from "./tas-blocks-state.js"
import * as Store from "./tas-blocks-store.js"

let uid = null
let mount = null
let H = {}

let month = null           // first of the month on screen
let data = {}              // dayKey → blocks, as drawn
let lastSaved = {}         // dayKey → blocks Firestore confirmed — the rollback target
let loadedRange = null     // "from|to" of the last successful read
let loading = false
let loadFailed = false

let openKey = null         // the day in the designer, or null
let editingId = null       // the block whose editor is open
let refocusPart = null     // the add field to put the caret back in after a redraw

const CHIPS_PER_DAY = 3
let wired = false

export function initBlocks(opts) {
  uid = opts.uid || null
  mount = opts.mount
  H = opts.helpers
  Store.initBlocksStore(opts.db)
  data = {}; lastSaved = {}; loadedRange = null
  if (!month) month = firstOf(H.today())
  buildSheet()
  if (wired) return
  wired = true   // a guest who signs in is initialised a second time
  window.addEventListener("beforeunload", () => { if (Store.hasPendingSave()) Store.flushAll() })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { if (Store.hasPendingSave()) Store.flushAll(); return }
    // Back from another device? The days are written whole, so a stale
    // copy here would save over the newer one — read them again first.
    if (uid && !Store.hasPendingSave() && !drag) { loadedRange = null; if (H.isActive()) render() }
  })
}

const firstOf = d => new Date(d.getFullYear(), d.getMonth(), 1)

export function goMonth(delta) {
  month = new Date(month.getFullYear(), month.getMonth() + delta, 1)
  render()
}
export function goToday() { month = firstOf(H.today()); render() }

/* The visible grid runs Sunday to Saturday, so it starts before the 1st
   and ends after the last day — those spill-over days get their plans
   drawn too, which is why the read covers the grid, not the month. */
function gridBounds() {
  const start = new Date(month); start.setDate(1 - month.getDay())
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const end = new Date(last); end.setDate(last.getDate() + (6 - last.getDay()))
  return { start, end }
}

async function ensureLoaded() {
  const { start, end } = gridBounds()
  const from = S.dayKey(start), to = S.dayKey(end)
  const want = from + "|" + to
  if (loadedRange === want || loading) return
  loading = true
  const got = await Store.loadRange(uid, from, to)
  loading = false
  if (got === null) { loadFailed = true; if (H.isActive()) render(); return }
  loadFailed = false
  // Days written elsewhere replace ours — unless an edit made here is
  // still waiting to go out, in which case the local copy is the newer.
  const busy = Store.hasPendingSave()
  for (const k of Object.keys(data)) if (!busy && k >= from && k <= to && !(k in got)) delete data[k]
  for (const [k, v] of Object.entries(got)) if (!busy || !(k in data)) data[k] = v
  Object.assign(lastSaved, got)
  loadedRange = want
  if (H.isActive()) render()
  if (openKey) renderSheet()
}

const blocksOf = k => data[k] || []

/* ── Colours ──────────────────────────────────────────────
   A block linked to a task wears that task's colour; otherwise its
   category's. The category colours are tokens in calendar.html. */
function linkedTask(b) { return b.taskId ? H.findTask(b.taskId) : null }
function blockColor(b) {
  const t = linkedTask(b)
  return t ? H.taskColor(t) : `var(--bk-${b.cat})`
}

/* ── The month ───────────────────────────────────────── */
export function render() {
  if (!mount) return
  const { esc, ico } = H
  if (!uid) {
    mount.innerHTML = `<div class="tl-wrap"><div class="bk-guest">
      <span class="big">${ico("grip")}</span>
      <p>Blocks plan your day — morning, afternoon, evening.</p>
      <small>They're saved to your account, so sign in to start one.</small>
      <button class="modal-save" onclick="requireSignIn('plan your days with Blocks')">Sign in</button>
    </div></div>`
    return
  }
  ensureLoaded()

  const today = H.today()
  const todayKey = S.dayKey(today)
  const { start, end } = gridBounds()
  let cells = ""
  let planned = 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = S.dayKey(d)
    const bl = blocksOf(k)
    const out = d.getMonth() !== month.getMonth()
    if (!out && bl.length) planned++
    const p = S.progress(bl)
    const chips = bl.slice(0, CHIPS_PER_DAY).map(b =>
      `<span class="bk-chip${b.done ? " done" : ""}" style="--c:${blockColor(b)}">${esc(b.text)}</span>`).join("")
    const more = bl.length > CHIPS_PER_DAY ? `<span class="bk-more">+${bl.length - CHIPS_PER_DAY} more</span>` : ""
    const cls = ["bk-cell", out ? "out" : "", k === todayKey ? "today" : "",
                 d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "",
                 p.total && p.done === p.total ? "all-done" : ""].filter(Boolean).join(" ")
    cells += `<button class="${cls}" onclick="bkOpenDay('${k}')"
        aria-label="${esc(H.longDate(d))}${bl.length ? `, ${p.done} of ${p.total} done` : ""}">
      <span class="bk-cell-top">
        <span class="tl-daynum">${d.getDate()}</span>
        ${p.total ? `<span class="bk-prog">${p.done}/${p.total}</span>` : ""}
      </span>
      <span class="bk-chips">${chips}${more}</span>
    </button>`
  }

  const wd = H.EN_DAYS.map((n, i) =>
    `<div class="tl-wd d${i}"><span class="tl-wd-full">${n}</span><span class="tl-wd-abbr">${n.slice(0, 3)}</span></div>`).join("")
  const onThisMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
  const foot = loadFailed
    ? `${ico("warning")} Couldn't load your plans — check your connection`
    : loadedRange === null ? "Loading your plans…"
    : planned ? `${planned} day${planned === 1 ? "" : "s"} planned this month · tap a day to design it`
    : `${ico("tap")} Tap any day to plan it`

  mount.innerHTML = `
    <div class="tl-wrap bk-wrap">
      <div class="tl-head">
        <button class="tl-nav prev" onclick="bkMonth(-1)" title="Previous month" aria-label="Previous month">‹</button>
        <div class="tl-title">${H.EN_MONTHS[month.getMonth()]}<span class="tl-yr">${month.getFullYear()}</span></div>
        ${onThisMonth ? "" : `<button class="tl-today-btn" onclick="bkToday()">${ico("back")} Today</button>`}
        <button class="tl-nav next" onclick="bkMonth(1)" title="Next month" aria-label="Next month">›</button>
      </div>
      <div class="bk-legend">${S.CATS.map(c =>
        `<span class="bk-leg"><span class="bk-leg-sw" style="background:var(--bk-${c.id})"></span>${c.label}</span>`).join("")}
        <span class="bk-leg muted">Linked blocks wear their task's colour</span>
      </div>
      <div class="tl-grid bk-grid">
        <div class="tl-wd-row">${wd}</div>
        <div class="bk-days">${cells}</div>
      </div>
      <div class="tl-foot">${foot}</div>
    </div>`
}

/* ── The Day Designer ────────────────────────────────── */
let sheet = null
function buildSheet() {
  if (sheet) return
  sheet = document.createElement("div")
  sheet.className = "modal-overlay bk-overlay"
  sheet.id = "bkOverlay"
  sheet.setAttribute("role", "dialog")
  sheet.setAttribute("aria-label", "Day Designer")
  sheet.innerHTML = `<div class="modal bk-modal" id="bkModal"></div>`
  sheet.addEventListener("click", e => { if (e.target === sheet) closeDay() })
  document.body.appendChild(sheet)
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && openKey && !e.target.closest?.(".bk-edit")) closeDay()
  })
}

export function openDay(k) {
  if (!uid) { H.requireSignIn("plan your days with Blocks"); return }
  openKey = k
  editingId = null
  renderSheet()
  sheet.classList.add("open")
  document.body.classList.add("bk-open")
}
export function closeDay() {
  if (!openKey) return
  openKey = null
  editingId = null
  sheet.classList.remove("open")
  document.body.classList.remove("bk-open")
  if (H.isActive()) render()
}
export function shiftDay(n) { openKey = S.addDays(openKey, n); editingId = null; renderSheet() }

function renderSheet() {
  if (!openKey || !sheet) return
  // A redraw mid-drag would pull the row out from under the finger.
  if (drag) { drag.pendingRender = true; return }
  const { esc, ico } = H
  const date = S.keyToDate(openKey)
  const bl = blocksOf(openKey)
  const p = S.progress(bl)
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0
  const isToday = openKey === S.dayKey(H.today())
  const modal = sheet.querySelector("#bkModal")
  const scroller = modal.querySelector(".bk-body")
  const keepScroll = scroller ? scroller.scrollTop : 0

  const sections = S.PARTS.map(part => {
    const rows = S.inPart(bl, part.id).map(b => rowHTML(b)).join("")
    return `<section class="bk-sec" data-part="${part.id}">
      <div class="bk-sec-head"><span class="bk-sec-name">${part.label}</span>
        <span class="bk-sec-count">${S.inPart(bl, part.id).length || ""}</span></div>
      <div class="bk-list" data-part="${part.id}">${rows || `<div class="bk-empty">Nothing yet</div>`}</div>
      <input class="bk-add" data-part="${part.id}" enterkeyhint="done" maxlength="${S.MAX_TEXT}"
        placeholder="Add to ${part.label.toLowerCase()} — type, then Enter" aria-label="Add a ${part.label.toLowerCase()} block" />
    </section>`
  }).join("")

  modal.innerHTML = `
    <div class="bk-top">
      <button class="bk-icon-btn" onclick="bkShiftDay(-1)" aria-label="Previous day">‹</button>
      <div class="bk-title">
        <h2>${esc(H.longDate(date))}</h2>
        <span class="bk-sub">${isToday ? "Today · " : ""}${p.total ? `${p.done} of ${p.total} done` : "Nothing planned yet"}</span>
      </div>
      <button class="bk-icon-btn" onclick="bkShiftDay(1)" aria-label="Next day">›</button>
      <button class="bk-icon-btn close" onclick="bkCloseDay()" aria-label="Close">&#10005;</button>
    </div>
    <div class="bk-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <span style="width:${pct}%"></span></div>
    <div class="bk-body">${sections}</div>
    <div class="modal-actions bk-actions">
      <button class="modal-cancel" onclick="bkCopyTomorrow()" ${bl.length ? "" : "disabled"}>
        ${ico("clipboard")} Copy to tomorrow</button>
      <button class="modal-save" onclick="bkCloseDay()">Done</button>
    </div>`

  const body = modal.querySelector(".bk-body")
  body.scrollTop = keepScroll
  wireSheet(modal)
  if (refocusPart) {
    modal.querySelector(`.bk-add[data-part="${refocusPart}"]`)?.focus()
    refocusPart = null
  }
}

function rowHTML(b) {
  const { esc, ico } = H
  const t = linkedTask(b)
  const link = t ? `<span class="bk-link">${ico(t._personal && t.sideQuest ? "moon" : "tack")} ${esc(t.name)}</span>` : ""
  const cat = S.CATS.find(c => c.id === b.cat)
  const editing = editingId === b.id
  return `<div class="bk-row${b.done ? " done" : ""}${editing ? " editing" : ""}" data-id="${b.id}" style="--c:${blockColor(b)}">
    <div class="bk-row-main">
      <span class="bk-grip" aria-label="Drag to move">${ico("grip")}</span>
      <button class="bk-check" data-act="tick" aria-label="${b.done ? "Mark not done" : "Mark done"}" aria-pressed="${b.done}">
        ${ico("check-circle")}</button>
      <button class="bk-text" data-act="edit">
        <span class="bk-text-line">${esc(b.text)}</span>
        <span class="bk-meta"><span class="bk-cat">${cat ? cat.label : ""}</span>${link}</span>
      </button>
    </div>
    ${editing ? editorHTML(b) : ""}
  </div>`
}

function editorHTML(b) {
  const { esc, ico } = H
  const opts = H.linkableTasks().map(t =>
    `<option value="${esc(t.id)}"${t.id === b.taskId ? " selected" : ""}>${esc(t.name)}${t.subject ? " · " + esc(t.subject) : ""} · ${esc(t.due)}</option>`).join("")
  // A link to a task that has since finished or gone still shows, so
  // saving the editor never quietly drops it.
  const stale = b.taskId && !H.linkableTasks().some(t => t.id === b.taskId)
  const staleT = stale ? linkedTask(b) : null
  return `<div class="bk-edit">
    <input class="bk-edit-text" value="${esc(b.text)}" maxlength="${S.MAX_TEXT}" enterkeyhint="done" aria-label="Block text" />
    <div class="bk-cats">${S.CATS.map(c =>
      `<button class="filter-chip${b.cat === c.id ? " active" : ""}" data-act="cat" data-cat="${c.id}">
        <span class="bk-leg-sw" style="background:var(--bk-${c.id})"></span>${c.label}</button>`).join("")}</div>
    <label class="bk-link-field"><span>${ico("tack")} Link to a task or quest</span>
      <select class="bk-link-sel">
        <option value="">None</option>
        ${stale ? `<option value="${esc(b.taskId)}" selected>${staleT ? esc(staleT.name) : "A task that's gone"}</option>` : ""}
        ${opts}
      </select>
    </label>
    <div class="bk-edit-actions">
      <button class="modal-delete" data-act="delete">${ico("trash")} Delete</button>
      <button class="modal-save" data-act="close-edit">Done</button>
    </div>
  </div>`
}

/* Delegated once per redraw: the sheet's markup is rebuilt on every change,
   and inline handlers can't reach these module functions. */
function wireSheet(modal) {
  modal.querySelectorAll(".bk-add").forEach(inp => {
    inp.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.isComposing) return
      e.preventDefault()
      const { text, part } = S.parseEntry(inp.value, inp.dataset.part)
      if (!text) return
      const bl = blocksOf(openKey)
      if (bl.length >= S.MAX_BLOCKS) { H.toast(`A day holds up to ${S.MAX_BLOCKS} blocks`, { error: true }); return }
      refocusPart = inp.dataset.part
      setDay(openKey, S.addBlock(bl, S.makeBlock({ text, part, cat: guessCat(text) })))
    })
  })

  modal.querySelectorAll(".bk-row").forEach(row => {
    const id = row.dataset.id
    row.querySelector(".bk-grip").addEventListener("pointerdown", e => startDrag(e, row))
    row.addEventListener("click", e => {
      const act = e.target.closest("[data-act]")?.dataset.act
      if (!act) return
      const b = blocksOf(openKey).find(x => x.id === id)
      if (!b) return
      if (act === "tick") {
        setDay(openKey, S.updateBlock(blocksOf(openKey), id, { done: !b.done }))
        if (!b.done) navigator.vibrate?.(6)
      } else if (act === "edit") {
        editingId = editingId === id ? null : id
        renderSheet()
        if (editingId) sheet.querySelector(".bk-edit-text")?.focus()
      } else if (act === "cat") {
        setDay(openKey, S.updateBlock(blocksOf(openKey), id, { cat: e.target.closest("[data-cat]").dataset.cat }))
      } else if (act === "delete") {
        const was = blocksOf(openKey)
        const key = openKey
        editingId = null
        setDay(key, S.removeBlock(was, id))
        H.toast("Block deleted", { action: "Undo", onAction: () => setDay(key, was) })
      } else if (act === "close-edit") {
        commitText(row, id)
        editingId = null
        renderSheet()
      }
    })
    const txt = row.querySelector(".bk-edit-text")
    if (txt) {
      txt.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commitText(row, id); editingId = null; renderSheet() }
        else if (e.key === "Escape") { editingId = null; renderSheet() }
      })
      txt.addEventListener("change", () => commitText(row, id))
    }
    row.querySelector(".bk-link-sel")?.addEventListener("change", e => {
      setDay(openKey, S.updateBlock(blocksOf(openKey), id, { taskId: e.target.value || null }))
    })
  })
}

function commitText(row, id) {
  const inp = row.querySelector(".bk-edit-text")
  if (!inp) return
  const text = inp.value.trim().slice(0, S.MAX_TEXT)
  const b = blocksOf(openKey).find(x => x.id === id)
  if (!b || !text || text === b.text) return
  data[openKey] = S.updateBlock(blocksOf(openKey), id, { text })
  persist(openKey)
}

/* A first guess at the category from the words typed, so most blocks need
   no second tap. Anything it gets wrong is one chip away. */
function guessCat(text) {
  const s = text.toLowerCase()
  if (/\b(rest|break|nap|sleep|gym|walk|lunch|dinner|chill|relax)\b/.test(s)) return "rest"
  if (/\b(project|build|code|coding|design|sketch|app|website|story|draw)/.test(s)) return "project"
  return "study"
}

/* ── Persisting ─────────────────────────────────────────── */
function setDay(k, next) {
  data[k] = next
  renderSheet()
  if (H.isActive()) render()
  persist(k)
}

function persist(k) {
  Store.queueSave(uid, k, data[k] || [], (ok, written) => {
    if (ok) { lastSaved[k] = written; return }
    data[k] = lastSaved[k] || []
    renderSheet()
    if (H.isActive()) render()
    H.toast("Couldn't save that — put back", { error: true })
  })
}

export function copyToTomorrow() {
  if (!openKey) return
  const from = blocksOf(openKey)
  if (!from.length) return
  const to = S.addDays(openKey, 1)
  const { blocks, copied } = S.copyInto(from, blocksOf(to))
  if (!copied) { H.toast(`Tomorrow is full — ${S.MAX_BLOCKS} blocks at most`, { error: true }); return }
  const before = blocksOf(to)
  data[to] = blocks
  persist(to)
  if (H.isActive()) render()
  H.toast(`Copied ${copied} block${copied === 1 ? "" : "s"} to ${H.shortDate(S.keyToDate(to))}`, {
    action: "Undo", onAction: () => { data[to] = before; persist(to); if (H.isActive()) render() }
  })
}

/* ── Drag and drop ──────────────────────────────────────
   Pointer Events, as in To Do — HTML5 drag never fires on a touchscreen.
   Unlike To Do, a drag only starts from the grip: the rest of the row is
   for ticking and editing, and on an iPad the list must still scroll
   under a finger that lands on a block. The grip is touch-action:none,
   so pressing it never scrolls and the drag can start at once. */
let drag = null

function startDrag(e, row) {
  if (e.button !== 0 && e.pointerType === "mouse") return
  e.preventDefault()
  const r = row.getBoundingClientRect()
  const ghost = row.cloneNode(true)
  ghost.classList.add("bk-ghost")
  ghost.style.width = r.width + "px"
  document.body.appendChild(ghost)
  row.classList.add("dragging")
  drag = { id: row.dataset.id, row, ghost, offX: e.clientX - r.left, offY: e.clientY - r.top,
           pointerId: e.pointerId, target: null, pendingRender: false }
  navigator.vibrate?.(8)
  moveDrag(e.clientX, e.clientY)

  const move = ev => { if (ev.pointerId === drag?.pointerId) { ev.preventDefault(); moveDrag(ev.clientX, ev.clientY) } }
  const done = commit => ev => {
    if (ev.pointerId !== drag?.pointerId) return
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    endDrag(commit)
  }
  const up = done(true), cancel = done(false)
  window.addEventListener("pointermove", move, { passive: false })
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
}

function moveDrag(x, y) {
  drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px)`
  clearDropChrome()
  drag.target = null
  const under = document.elementFromPoint(x, y)
  const body = sheet.querySelector(".bk-body")
  // The designer scrolls itself while the finger sits near either edge.
  const br = body.getBoundingClientRect()
  if (y < br.top + 44) body.scrollTop -= 12
  else if (y > br.bottom - 44) body.scrollTop += 12
  const sec = under?.closest(".bk-sec")
  if (!sec) return
  const list = sec.querySelector(".bk-list")
  const rows = [...list.querySelectorAll(".bk-row")].filter(r => r !== drag.row)
  // The first row whose middle is below the finger is the one to land
  // before — so dropping on a section's header or add field still works.
  const before = rows.find(r => { const rr = r.getBoundingClientRect(); return y < rr.top + rr.height / 2 })
  list.classList.add("drag-over")
  if (before) before.classList.add("drop-before")
  else if (rows.length) rows[rows.length - 1].classList.add("drop-after")
  drag.target = { part: sec.dataset.part, beforeId: before ? before.dataset.id : null }
}

function clearDropChrome() {
  sheet.querySelectorAll(".drop-before,.drop-after,.drag-over")
    .forEach(el => el.classList.remove("drop-before", "drop-after", "drag-over"))
}

function endDrag(commit) {
  const was = drag
  drag = null
  was.ghost.remove()
  was.row.classList.remove("dragging")
  clearDropChrome()
  if (commit && was.target) {
    const next = S.moveBlock(blocksOf(openKey), was.id, was.target.part, was.target.beforeId)
    if (next !== blocksOf(openKey)) { setDay(openKey, next); return }
  }
  if (was.pendingRender) renderSheet()
}

/* Inline handlers in the markup resolve against window. */
Object.assign(window, {
  bkOpenDay: openDay, bkCloseDay: closeDay, bkShiftDay: shiftDay,
  bkMonth: goMonth, bkToday: goToday, bkCopyTomorrow: copyToTomorrow
})
