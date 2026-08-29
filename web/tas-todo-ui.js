/* ─────────────────────────────────────────────────────────────
   TAS To Do — rendering and drag/drop.

   Renders into the calendar's own #calWrap, the same container
   the timeline and archive views use, so switchView() can swap
   between the three without any extra plumbing.

   This module never reads Firestore directly and never does the
   list arithmetic itself: tas-todo-state.js works out what the
   next list should be, tas-todo-store.js persists it. What lives
   here is the DOM, the pointer-driven drag-and-drop wiring, and
   the optimistic-update/rollback dance around the store.

   The task lists are not fetched here either — the calendar
   already holds live `tasks` and `personalTasks` from its two
   onSnapshot listeners, and hands them over through getTasks() /
   getPersonal() so there is exactly one subscription per list.

   A row is a *view* of a task, not a copy: the tick, the progress
   bar and the detail popup are the calendar's own, borrowed
   through `helpers`, so a task can never look one way here and
   another way on the timeline.
   ───────────────────────────────────────────────────────────── */

import * as S from "./tas-todo-state.js"
import * as Store from "./tas-todo-store.js"

let uid = null
let mount = null
let H = {}                 // helpers borrowed from calendar.html
let getTasks = () => []
let getPersonal = () => []

let items = []             // the live list
let lastSaved = []         // last state Firestore confirmed — the rollback target
let loaded = false         // false until the first successful read
let loadFailed = false
let poolQuery = ""
let openNotes = new Set()  // item ids whose notes box is expanded
let onChange = () => {}    // lets the page keep its nav-pill count in step

/* Entrance animations play when you arrive at the view and never again.
   Every drop, keystroke and snapshot rebuilds the markup, so without this
   the columns replay their fade-in on every single interaction — the same
   re-render blink the calendar avoids with its `no-anim` class. */
let animateView = true
export function markViewEntered() { animateView = true }

/* Only overdue work from the last month is worth offering; anything older
   belongs in the archive, not on a list of what to do next. */
const POOL_OVERDUE_DAYS = 30

export function initTodo(opts) {
  uid = opts.uid
  mount = opts.mount
  H = opts.helpers
  getTasks = opts.getTasks
  getPersonal = opts.getPersonal
  if (opts.onChange) onChange = opts.onChange
  Store.initTodoStore(opts.db)

  /* A debounced reorder that never fired because the tab closed would
     silently lose the drag. */
  window.addEventListener("beforeunload", () => { if (Store.hasPendingSave()) Store.flushTodo() })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && Store.hasPendingSave()) Store.flushTodo()
  })
}

/* Read once per session, on first open — the doc is this user's alone, so
   there is nothing to keep a listener for. */
export async function loadTodoOnce() {
  if (loaded || !uid) return
  const got = await Store.loadTodo(uid)
  if (got === null) { loadFailed = true; return }
  items = got
  lastSaved = got
  loaded = true
  loadFailed = false
}

// How many items are on the list — drives the nav pill's count badge.
export const todoCount = () => items.length

/* ── Persisting ──────────────────────────────────────────────
   Every mutation is applied locally and drawn immediately; the write
   result only ever matters if it fails, in which case we snap back to the
   last list Firestore actually confirmed. */

function paint() { render(); onChange() }

function rollback(msg) {
  items = lastSaved
  openNotes = new Set([...openNotes].filter(id => items.some(it => it.id === id)))
  paint()
  H.toast(msg, { error: true })
}

/* Adding and removing are single deliberate acts, so they go out at once.
   `write` is the store's matching mutator — passed in rather than assumed
   so the intent is visible at the call site. */
async function commitNow(write, next, failMsg) {
  items = next
  paint()
  const ok = await write(uid, next)
  if (ok) lastSaved = next
  else rollback(failMsg)
  return ok
}

/* Reorders and note edits arrive in bursts, so these go through the
   store's ~500ms debounce and only report back on the write that
   actually goes out. */
function commitDebounced(write, next, failMsg) {
  items = next
  paint()
  write(uid, next, (ok, written) => {
    if (ok) lastSaved = written
    else rollback(failMsg)
  })
}

/* ── The task pool ───────────────────────────────────────────
   Everything still worth doing, minus what is already on the list.
   Markers are places in time rather than work, so they never appear, and
   a hidden side quest is out of sight here exactly as it is everywhere
   else — the point of the toggle is that nothing reminds you of it. */
function poolTasks() {
  const already = S.refIds(items)
  const q = poolQuery.trim().toLowerCase()
  const all = [...getTasks(), ...getPersonal()]
  return all
    .filter(t => {
      if (!t || !t.id || already.has(t.id)) return false
      if (H.taskType(t) === "marker") return false
      if (H.isHidden(t)) return false
      const due = t.end || t.date
      if (!due) return false
      if (H.isDone(t.id)) return false
      const dl = H.daysLeft(H.parseDate(due))
      if (dl < -POOL_OVERDUE_DAYS) return false
      if (q && !(String(t.name || "") + " " + String(t.subject || "")).toLowerCase().includes(q)) return false
      return true
    })
    .sort((a, b) => new Date(a.end || a.date) - new Date(b.end || b.date))
}

/* ── Rendering ───────────────────────────────────────────────
   Shared bits first. `dueMeta` is the one place a due date turns into a
   colour and a phrase, so pool cards and list rows can never disagree
   about how urgent something is. */
function dueMeta(type, dueStr) {
  if (!dueStr) return { color: "#64748b", date: "", phrase: "No date" }
  const d = H.parseDate(dueStr)
  const dl = H.daysLeft(d)
  return {
    color: H.urgencyColor(type, dl),
    date: H.shortDate(d),
    phrase: dl < 0 ? Math.abs(dl) + "d overdue" : dl === 0 ? "Due today" : dl + "d left"
  }
}

// The moon a side quest wears everywhere else on the page.
const sqMark = t => H.isSideQuest(t) ? `<span class="todo-sq" title="Side quest">${H.ico("moon")}</span>` : ""

function poolCardHTML(t) {
  const type = H.taskType(t)
  const m = dueMeta(type, t.end || t.date)
  return `<div class="todo-pool-card" data-task="${H.esc(t.id)}" data-ref="${H.esc(t.id)}"
               data-source="${t._personal ? "personal" : "shared"}">
    <span class="todo-dot" style="background:${m.color}"></span>
    <div class="todo-pool-info">
      <div class="todo-pool-name">${sqMark(t)}${H.esc(t.name || "Untitled")}</div>
      <div class="todo-pool-sub">${t.subject ? H.esc(t.subject) + " · " : ""}${H.esc(H.TYPE_LABEL[type] || type)}</div>
    </div>
    <div class="todo-pool-right">
      <div class="todo-pool-due" style="color:${m.color}">${H.esc(m.date)}</div>
      <div class="todo-pool-days">${H.esc(m.phrase)}</div>
    </div>
    <button class="todo-pool-add" title="Add to To Do" data-add="${H.esc(t.id)}">${H.ico("plus")}</button>
  </div>`
}

/* One row per item. A row backed by a real task carries the calendar's
   own check control — the same `.check-row` / `cr-<id>` markup the
   timeline draws — so the tick, the saving spinner and the hold-to-set-
   progress gesture all work here through the page's existing document
   handlers, with nothing to keep in step. */
function itemHTML(r) {
  const m = r.orphan || !r.end ? null : dueMeta(r.type, r.end)
  const color = r.orphan ? "#64748b" : r.source === "note" ? "#8b5cf6" : (m ? m.color : "#64748b")
  const notesOpen = openNotes.has(r.id)
  const isTask = !r.orphan && r.source !== "note"
  const done = isTask && H.isDone(r.ref)
  const prog = isTask ? H.progressOf(r.ref) : null
  const sub = r.orphan
    ? "This task was deleted"
    : r.source === "note"
      ? "Note"
      : (r.subject ? H.esc(r.subject) + " · " : "") + H.esc(H.TYPE_LABEL[r.type] || r.type)

  return `<div class="todo-item${r.orphan ? " orphan" : ""}${notesOpen ? " notes-open" : ""}${done ? " done" : ""}"
               data-item="${H.esc(r.id)}"${isTask ? ` data-ref="${H.esc(r.ref)}"` : ""}>
    <span class="todo-grip" aria-hidden="true">${H.ico("grip")}</span>
    ${isTask
      ? `<div class="check-row todo-check" id="cr-${H.esc(r.ref)}" title="Hold to set up progress">
           <input type="checkbox" title="Mark as done — hold to set up progress" ${done ? "checked" : ""}
             onchange="toggleDone('${H.esc(r.ref)}',this.checked,this)" />
           <div class="hold-ring"></div>
           <div class="check-spin"></div>
         </div>`
      : `<span class="todo-dot" style="background:${color}"></span>`}
    <div class="todo-item-info">
      <div class="todo-item-name">${sqMark(r.task)}${H.esc(r.title)}</div>
      <div class="todo-item-sub">${sub}</div>
      ${prog ? `<div class="todo-item-prog">${H.progressBarHTML(prog, { color })}
                  <span class="todo-item-progread">${H.esc(H.progressText(prog))}</span></div>` : ""}
    </div>
    ${m ? `<div class="todo-item-right">
      <div class="todo-item-due" style="color:${m.color}">${H.esc(m.date)}</div>
      <div class="todo-item-days">${H.esc(m.phrase)}</div>
    </div>` : ""}
    <div class="todo-item-acts">
      <button class="todo-act${r.notes ? " has-notes" : ""}" title="Notes" data-notes="${H.esc(r.id)}">${H.ico("note")}</button>
      <button class="todo-act danger" title="Remove" data-del="${H.esc(r.id)}">${H.ico("trash")}</button>
    </div>
    ${notesOpen ? `<textarea class="todo-notes" data-notesfor="${H.esc(r.id)}" rows="3"
      placeholder="Anything worth remembering — page numbers, what's left, who you're working with…">${H.esc(r.notes)}</textarea>` : ""}
  </div>`
}

function viewHTML() {
  const index = S.buildTaskIndex(getTasks(), getPersonal())
  // A hidden side quest drops out of the list as well as the pool — the
  // whole point of the toggle is that nothing on screen mentions it.
  const rows = S.resolveItems(items, index).filter(r => !H.isHidden(r.task))
  const pool = poolTasks()

  const poolBody = pool.length
    ? pool.map(poolCardHTML).join("")
    : `<div class="todo-empty small">${poolQuery ? "Nothing matches that." : "Nothing left to add — everything's already on your list."}</div>`

  const listBody = rows.length
    ? rows.map(itemHTML).join("")
    // No "from the left": below two columns the pool sits underneath.
    : `<div class="todo-empty" data-dropmsg="1">
         <span class="big">${H.ico("check-square")}</span>
         Nothing on the list yet<br><span>Drag a task over, or use the + on any card</span>
       </div>`

  // Consumed here rather than in render(), so the loading and error states
  // don't spend the one animated paint the view gets.
  const anim = animateView ? "" : " no-anim"
  animateView = false

  return `<div class="todo-view${anim}">
    <aside class="todo-col todo-pool-col">
      <div class="todo-head">
        <h2>${H.ico("inbox")} Tasks</h2>
        <span class="todo-count">${pool.length}</span>
      </div>
      <input class="todo-search" id="todoSearch" type="search" placeholder="Search tasks…"
             value="${H.esc(poolQuery)}" autocomplete="off" />
      <div class="todo-scroll todo-drop" data-lane="pool" id="todoPool">${poolBody}</div>
      <p class="todo-foot">Drag one over, or drop one back here to take it off the list.</p>
    </aside>

    <section class="todo-col todo-list-col" id="todoList">
      <div class="todo-head">
        <h2>${H.ico("check-square")} To Do</h2>
        <span class="todo-count">${rows.length}</span>
        <button class="todo-addnote" id="todoAddNote">${H.ico("plus")} Note</button>
      </div>
      <div class="todo-scroll todo-drop" data-lane="list">${listBody}</div>
      <p class="todo-foot">Tap a row to open it — the tick and the progress are the timeline's own.</p>
    </section>
  </div>`
}

export function render() {
  if (!mount) return
  if (loadFailed) {
    mount.innerHTML = `<div class="todo-view"><div class="todo-empty wide">
      <span class="big">${H.ico("warning")}</span>
      Couldn't load your To Do list.<br><span>Check your connection and reopen this tab.</span>
    </div></div>`
    return
  }
  if (!loaded) {
    mount.innerHTML = `<div class="todo-view"><div class="todo-empty wide">
      <span class="big">${H.ico("check-square")}</span>Loading your list…</div></div>`
    return
  }
  // A re-render mid-drag would tear the row out from under the finger.
  if (drag && drag.active) { pendingRender = true; return }

  // Keep focus and caret through a re-render: typing in the search box or a
  // notes field triggers renders, and a naive innerHTML swap would eject the
  // cursor on every keystroke.
  const active = document.activeElement
  const focusKey = active && (active.id === "todoSearch"
    ? "search"
    : active.dataset && active.dataset.notesfor ? "notes:" + active.dataset.notesfor : null)
  const caret = focusKey && active.selectionStart

  mount.innerHTML = viewHTML()
  wire()

  if (focusKey === "search") {
    const el = document.getElementById("todoSearch")
    if (el) { el.focus(); el.setSelectionRange(caret, caret) }
  } else if (focusKey && focusKey.startsWith("notes:")) {
    const el = mount.querySelector(`[data-notesfor="${CSS.escape(focusKey.slice(6))}"]`)
    if (el) { el.focus(); el.setSelectionRange(caret, caret) }
  }
}

/* ── Wiring ──────────────────────────────────────────────────
   Re-bound after every render. Listeners hang off the freshly built
   elements, so there is nothing to tear down. */
function wire() {
  const search = document.getElementById("todoSearch")
  if (search) search.oninput = e => { poolQuery = e.target.value; render() }

  const addNote = document.getElementById("todoAddNote")
  if (addNote) addNote.onclick = onAddNote

  mount.querySelectorAll("[data-add]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); addTaskToList(b.dataset.add) })
  mount.querySelectorAll("[data-del]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); onRemove(b.dataset.del) })
  mount.querySelectorAll("[data-notes]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); toggleNotes(b.dataset.notes) })

  mount.querySelectorAll("[data-notesfor]").forEach(ta => {
    ta.oninput = () => { items = S.updateItem(items, ta.dataset.notesfor, { notes: ta.value }) }
    // Notes are typed, not dragged, so they save when the field is left
    // rather than on every keystroke.
    ta.onblur = () => saveNotes(ta.dataset.notesfor)
    ta.onkeydown = e => { if (e.key === "Escape") ta.blur() }
  })

  wireCards()
}

/* Both card kinds behave the same way: a press that moves is a drag, a
   press that doesn't is a tap that opens the task. */
function wireCards() {
  mount.querySelectorAll(".todo-pool-card, .todo-item").forEach(card => {
    card.addEventListener("pointerdown", onCardPointerDown)
    card.addEventListener("click", onCardClick)
  })
}

/* A tap anywhere on a row that isn't one of its own controls opens the
   calendar's detail popup — the same sheet the timeline bar opens, for
   the same task. Notes have no task behind them, so they open their own
   notes field instead. */
function onCardClick(e) {
  if (justDragged()) { e.preventDefault(); e.stopPropagation(); return }
  if (e.target.closest("button, input, textarea, label, .check-row, .prog-bar")) return
  const card = e.currentTarget
  const ref = card.dataset.ref
  if (ref) { H.showDetail(e, ref); return }
  const id = card.dataset.item
  if (id) toggleNotes(id)   // an orphan or a note — its text is all there is
}

/* ── Drag and drop ───────────────────────────────────────────
   Pointer Events rather than HTML5 drag-and-drop: `dragstart` never
   fires on a touchscreen, so the old wiring left the whole view
   mouse-only. One code path now covers mouse, pen and finger.

   The gesture: a press arms a drag, and it starts once the finger has
   moved past a threshold (or has been held still long enough that it
   clearly isn't a scroll). Until then the press is still a tap, and the
   lane still scrolls — which is why the threshold exists at all. */
const DRAG_SLOP  = 8      // px of movement before a press becomes a drag
const HOLD_MS    = 220    // …or this long held still, for a deliberate pick-up
const EDGE_PX    = 44     // auto-scroll band at each end of a lane
const EDGE_SPEED = 14

const CLICK_GRACE = 250   // …after which a click is a fresh tap, not the drag's

let drag = null           // { kind, id, ref, source, el, ghost, active, … }
let pendingRender = false // a render that arrived mid-drag and must wait
let dropTarget = null     // { lane, row, before } — where a release would land

/* Releasing a drag fires a click, which would open the task you just
   moved. It has to be swallowed — but a plain "swallow the next one" flag
   never clears when the drop re-renders the list, because the element
   that would have fired the click is already gone, and it then eats the
   next genuine tap instead. A timestamp expires on its own. */
let dragEndedAt = 0
const justDragged = () => performance.now() - dragEndedAt < CLICK_GRACE

function onCardPointerDown(e) {
  // Left button / primary contact only, and never from inside a control.
  if (e.button !== 0 && e.pointerType === "mouse") return
  if (e.target.closest("button, input, textarea, label, .check-row, .prog-bar")) return
  const card = e.currentTarget
  const isPool = card.classList.contains("todo-pool-card")

  drag = {
    kind: isPool ? "task" : "item",
    id: isPool ? card.dataset.task : card.dataset.item,
    ref: card.dataset.ref || null,
    source: card.dataset.source || null,
    el: card,
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    offX: 0, offY: 0,
    ghost: null,
    active: false,
    holdTimer: setTimeout(() => { if (drag) beginDrag(e.clientX, e.clientY) }, HOLD_MS)
  }

  const move = ev => {
    if (!drag || ev.pointerId !== drag.pointerId) return
    if (!drag.active) {
      const far = Math.abs(ev.clientX - drag.startX) > DRAG_SLOP ||
                  Math.abs(ev.clientY - drag.startY) > DRAG_SLOP
      if (!far) return
      beginDrag(drag.startX, drag.startY)
    }
    ev.preventDefault()
    moveDrag(ev.clientX, ev.clientY)
  }
  const up = ev => {
    if (!drag || ev.pointerId !== drag.pointerId) return
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    endDrag(true)
  }
  const cancel = ev => {
    if (!drag || ev.pointerId !== drag.pointerId) return
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("pointercancel", cancel)
    endDrag(false)
  }
  // On window, not the card: the card is replaced by the next render, and
  // a listener on a detached node would strand the drag.
  window.addEventListener("pointermove", move, { passive: false })
  window.addEventListener("pointerup", up)
  window.addEventListener("pointercancel", cancel)
}

/* The ghost is a clone rather than the row itself: the row stays in place
   (dimmed) so the list doesn't reflow under the finger, and the clone can
   be dragged outside its scroll container without being clipped. */
function beginDrag(x, y) {
  if (!drag || drag.active) return
  clearTimeout(drag.holdTimer)
  /* A snapshot landing between the press and the first move rebuilds the
     list, and the row we were about to pick up is no longer in the page.
     Cloning it would give a zero-sized ghost at the top-left corner, so
     drop the gesture instead and let them press again. */
  if (!drag.el.isConnected) { drag = null; return }
  drag.active = true
  document.body.classList.add("todo-dragging")

  const r = drag.el.getBoundingClientRect()
  drag.offX = x - r.left
  drag.offY = y - r.top

  const ghost = drag.el.cloneNode(true)
  ghost.classList.add("todo-ghost")
  ghost.style.width = r.width + "px"
  ghost.style.height = r.height + "px"
  document.body.appendChild(ghost)
  drag.ghost = ghost

  drag.el.classList.add("dragging")
  moveDrag(x, y)
  navigator.vibrate?.(8)
}

function moveDrag(x, y) {
  if (!drag || !drag.active) return
  drag.ghost.style.transform = `translate(${x - drag.offX}px, ${y - drag.offY}px)`

  // The ghost sits under the pointer, so it has to be invisible to the
  // hit test or every lookup would just find the ghost.
  drag.ghost.style.pointerEvents = "none"
  const under = document.elementFromPoint(x, y)
  clearDropChrome()
  dropTarget = null
  if (!under) return

  const lane = under.closest(".todo-drop")
  if (!lane) return
  autoScroll(lane, y)

  // A task from the pool can only be added; it has no place to sit yet.
  if (drag.kind === "task") {
    if (lane.dataset.lane !== "list") return
    lane.classList.add("drag-over")
    dropTarget = { lane: "list", row: null, before: true }
    return
  }

  lane.classList.add("drag-over")
  const row = under.closest(".todo-item")
  if (!row || row === drag.el) { dropTarget = { lane: lane.dataset.lane, row: null, before: false }; return }
  const rr = row.getBoundingClientRect()
  const before = y < rr.top + rr.height / 2
  row.classList.toggle("drop-before", before)
  row.classList.toggle("drop-after", !before)
  dropTarget = { lane: lane.dataset.lane, row: row.dataset.item, before }
}

/* Dragging to the bottom of a long list has to be able to reach the rows
   below the fold, so the lane scrolls itself while the pointer sits in
   the band at either end. */
function autoScroll(lane, y) {
  const r = lane.getBoundingClientRect()
  if (y < r.top + EDGE_PX) lane.scrollTop -= EDGE_SPEED
  else if (y > r.bottom - EDGE_PX) lane.scrollTop += EDGE_SPEED
}

function endDrag(commit) {
  if (!drag) return
  clearTimeout(drag.holdTimer)
  const was = drag
  const target = dropTarget
  drag = null
  dropTarget = null

  if (was.ghost) was.ghost.remove()
  was.el.classList.remove("dragging")
  document.body.classList.remove("todo-dragging")
  clearDropChrome()

  if (!was.active) return           // never moved — it was a tap, let the click through
  dragEndedAt = performance.now()   // it moved — swallow the click the release fires

  if (commit && target) {
    if (was.kind === "task" && target.lane === "list") addTaskToList(was.id)
    else if (was.kind === "item") onItemDropped(was.id, target)
  }
  if (pendingRender) { pendingRender = false; render() }
}

function clearDropChrome() {
  mount.querySelectorAll(".drop-before, .drop-after, .drag-over")
    .forEach(el => el.classList.remove("drop-before", "drop-after", "drag-over"))
}

/* Dropped on the pool, a list row is being taken off the list — the same
   thing the row's own bin button does, and the obvious meaning of pulling
   it back where it came from. */
function onItemDropped(itemId, target) {
  if (target.lane === "pool") { onRemove(itemId); return }
  if (!target.row) {
    // Released over the lane but not over any row — park it at the end.
    const ordered = S.orderedItems(items)
    const last = ordered[ordered.length - 1]
    if (!last || last.id === itemId) return
    commitDebounced(Store.reorder, S.moveItem(items, itemId, last.id, false),
      "Couldn't move that — put back")
    return
  }
  if (target.row === itemId) return
  commitDebounced(Store.reorder, S.moveItem(items, itemId, target.row, target.before),
    "Couldn't move that — put back")
}

/* ── Actions ─────────────────────────────────────────── */

function addTaskToList(taskId) {
  if (S.refIds(items).has(taskId)) { H.toast("That's already on your list"); return }
  const personal = getPersonal().some(t => t.id === taskId)
  const task = S.buildTaskIndex(getTasks(), getPersonal()).get(taskId)
  if (!task) { H.toast("That task is no longer there", { error: true }); return }

  const item = S.makeItem({ source: personal ? "personal" : "shared", ref: taskId })
  commitNow(Store.addItem, S.addItem(items, item), "Couldn't add that — put back")
}

function onAddNote() {
  const item = S.makeItem({ source: "note", text: "" })
  openNotes.add(item.id)
  commitNow(Store.addItem, S.addItem(items, item), "Couldn't add that note")
  // A blank note is useless until it's named, so open it for typing.
  requestAnimationFrame(() => {
    const el = mount.querySelector(`[data-notesfor="${CSS.escape(item.id)}"]`)
    if (el) el.focus()
  })
}

function onRemove(id) {
  openNotes.delete(id)
  commitNow(Store.removeItem, S.removeItem(items, id), "Couldn't remove that — put back")
}

function toggleNotes(id) {
  if (openNotes.has(id)) { openNotes.delete(id); saveNotes(id) }
  else openNotes.add(id)
  render()
}

function saveNotes(id) {
  const item = items.find(it => it.id === id)
  const was = lastSaved.find(it => it.id === id)
  if (!item || (was && was.notes === item.notes)) return   // nothing changed
  // Debounced like a drag: leaving one notes field to open another
  // shouldn't be two writes.
  Store.reorder(uid, items, (ok, written) => {
    if (ok) lastSaved = written
    else rollback("Couldn't save that note")
  })
}
