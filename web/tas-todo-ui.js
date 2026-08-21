/* ─────────────────────────────────────────────────────────────
   TAS To Do — rendering and drag/drop.

   Renders into the calendar's own #calWrap, the same container
   the timeline and archive views use, so switchView() can swap
   between the three without any extra plumbing.

   This module never reads Firestore directly and never does the
   list arithmetic itself: tas-todo-state.js works out what the
   next list should be, tas-todo-store.js persists it. What lives
   here is the DOM, the HTML5 drag-and-drop wiring, and the
   optimistic-update/rollback dance around the store.

   The task lists are not fetched here either — the calendar
   already holds live `tasks` and `personalTasks` from its two
   onSnapshot listeners, and hands them over through getTasks() /
   getPersonal() so there is exactly one subscription per list.
   ───────────────────────────────────────────────────────────── */

import * as S from "./tas-todo-state.js"
import * as Store from "./tas-todo-store.js"

/* Custom drag types rather than text/plain: dragover can inspect
   `types` but not `getData`, so the drop zones need to tell a task drag
   from a list-item drag before the drop lands. Both are lowercase —
   Firefox lowercases custom types and would otherwise miss the match. */
const T_TASK = "application/x-tas-task"
const T_ITEM = "application/x-tas-item"

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
let dragging = null        // { kind:"task"|"item", id, source }
let onChange = () => {}    // lets the page keep its nav-pill count in step

/* Entrance animations play when you arrive at the view and never again.
   Every drop, keystroke and snapshot rebuilds the markup, so without this
   the three columns replay their fade-in on every single interaction —
   the same re-render blink the calendar avoids with its `no-anim` class. */
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
export const deckCount = () => S.deckItems(items).length

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

/* Reorders, deck moves and note edits arrive in bursts, so these go
   through the store's ~500ms debounce and only report back on the write
   that actually goes out. */
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
   Markers are places in time rather than work, so they never appear. */
function poolTasks() {
  const already = S.refIds(items)
  const q = poolQuery.trim().toLowerCase()
  const all = [...getTasks(), ...getPersonal()]
  return all
    .filter(t => {
      if (!t || !t.id || already.has(t.id)) return false
      if (H.taskType(t) === "marker") return false
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
   colour and a phrase, so pool cards, list rows and deck cards can never
   disagree about how urgent something is. */
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

function poolCardHTML(t) {
  const type = H.taskType(t)
  const m = dueMeta(type, t.end || t.date)
  return `<div class="todo-pool-card" draggable="true" data-task="${H.esc(t.id)}"
               data-source="${t._personal ? "personal" : "shared"}">
    <span class="todo-dot" style="background:${m.color}"></span>
    <div class="todo-pool-info">
      <div class="todo-pool-name">${H.esc(t.name || "Untitled")}</div>
      <div class="todo-pool-sub">${t.subject ? H.esc(t.subject) + " · " : ""}${H.esc(H.TYPE_LABEL[type] || type)}</div>
    </div>
    <div class="todo-pool-right">
      <div class="todo-pool-due" style="color:${m.color}">${H.esc(m.date)}</div>
      <div class="todo-pool-days">${H.esc(m.phrase)}</div>
    </div>
    <button class="todo-pool-add" title="Add to To Do" data-add="${H.esc(t.id)}">${H.ico("plus")}</button>
  </div>`
}

/* One row renderer for both lanes — a deck card is the same item with a
   different frame, so they cannot drift apart visually. */
function itemHTML(r, lane) {
  const m = r.orphan || !r.end ? null : dueMeta(r.type, r.end)
  const color = r.orphan ? "#64748b" : r.source === "note" ? "#8b5cf6" : (m ? m.color : "#64748b")
  const notesOpen = openNotes.has(r.id)
  const sub = r.orphan
    ? "This task was deleted"
    : r.source === "note"
      ? "Note"
      : (r.subject ? H.esc(r.subject) + " · " : "") + H.esc(H.TYPE_LABEL[r.type] || r.type)

  const moveBtn = lane === "deck"
    ? `<button class="todo-act" title="Back to the list" data-undeck="${H.esc(r.id)}">${H.ico("back")}</button>`
    : `<button class="todo-act" title="Send to the Focus Deck" data-deck="${H.esc(r.id)}">${H.ico("flame")}</button>`

  return `<div class="todo-item${r.orphan ? " orphan" : ""}${notesOpen ? " notes-open" : ""}"
               draggable="true" data-item="${H.esc(r.id)}">
    <span class="todo-grip" aria-hidden="true">${H.ico("grip")}</span>
    <span class="todo-dot" style="background:${color}"></span>
    <div class="todo-item-info">
      <div class="todo-item-name">${H.esc(r.title)}</div>
      <div class="todo-item-sub">${sub}</div>
    </div>
    ${m ? `<div class="todo-item-right">
      <div class="todo-item-due" style="color:${m.color}">${H.esc(m.date)}</div>
      <div class="todo-item-days">${H.esc(m.phrase)}</div>
    </div>` : ""}
    <div class="todo-item-acts">
      <button class="todo-act${r.notes ? " has-notes" : ""}" title="Notes" data-notes="${H.esc(r.id)}">${H.ico("note")}</button>
      ${moveBtn}
      <button class="todo-act danger" title="Remove" data-del="${H.esc(r.id)}">${H.ico("trash")}</button>
    </div>
    ${notesOpen ? `<textarea class="todo-notes" data-notesfor="${H.esc(r.id)}" rows="3"
      placeholder="Anything worth remembering — page numbers, what's left, who you're working with…">${H.esc(r.notes)}</textarea>` : ""}
  </div>`
}

function viewHTML() {
  const index = S.buildTaskIndex(getTasks(), getPersonal())
  const resolved = S.resolveItems(items, index)
  const listRows = resolved.filter(r => !r.deck)
  const deckRows = resolved.filter(r => r.deck)
  const pool = poolTasks()

  const poolBody = pool.length
    ? pool.map(poolCardHTML).join("")
    : `<div class="todo-empty small">${poolQuery ? "Nothing matches that." : "Nothing left to add — everything's already on your list."}</div>`

  const listBody = listRows.length
    ? listRows.map(r => itemHTML(r, "list")).join("")
    : `<div class="todo-empty" data-dropmsg="1">
         <span class="big">${H.ico("check-square")}</span>
         Drag a task over from the left<br><span>or use the + on any card</span>
       </div>`

  const deckBody = deckRows.length
    ? deckRows.map(r => itemHTML(r, "deck")).join("")
    : `<div class="todo-empty" data-dropmsg="1">
         <span class="big">${H.ico("flame")}</span>
         What are you working on <em>now</em>?<br><span>Drag up to ${S.DECK_LIMIT} items here</span>
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
      <div class="todo-scroll" id="todoPool">${poolBody}</div>
    </aside>

    <section class="todo-col todo-list-col" id="todoList">
      <div class="todo-head">
        <h2>${H.ico("check-square")} To Do</h2>
        <span class="todo-count">${listRows.length}</span>
        <button class="todo-addnote" id="todoAddNote">${H.ico("plus")} Note</button>
      </div>
      <div class="todo-scroll todo-drop" data-lane="list">${listBody}</div>
    </section>

    <aside class="todo-col todo-deck-col" id="todoDeck">
      <div class="todo-head">
        <h2>${H.ico("flame")} Focus Deck</h2>
        <span class="todo-count${deckRows.length >= S.DECK_LIMIT ? " full" : ""}">${deckRows.length}/${S.DECK_LIMIT}</span>
      </div>
      <div class="todo-scroll todo-drop" data-lane="deck">${deckBody}</div>
      <p class="todo-deck-foot">Only what you're doing right now.</p>
    </aside>
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
  mount.querySelectorAll("[data-deck]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); onSetDeck(b.dataset.deck, true) })
  mount.querySelectorAll("[data-undeck]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); onSetDeck(b.dataset.undeck, false) })
  mount.querySelectorAll("[data-notes]").forEach(b =>
    b.onclick = e => { e.stopPropagation(); toggleNotes(b.dataset.notes) })

  mount.querySelectorAll("[data-notesfor]").forEach(ta => {
    ta.oninput = () => { items = S.updateItem(items, ta.dataset.notesfor, { notes: ta.value }) }
    // Notes are typed, not dragged, so they save when the field is left
    // rather than on every keystroke.
    ta.onblur = () => saveNotes(ta.dataset.notesfor)
    ta.onkeydown = e => { if (e.key === "Escape") ta.blur() }
    // A drag started inside the textarea would tear the row out mid-sentence.
    ta.ondragstart = e => e.preventDefault()
  })

  wireDrag()
}

/* ── Drag and drop ───────────────────────────────────────────
   Native HTML5 DnD, no library. Pointer devices only — every drag has a
   button beside it that does the same job, which is what keeps the view
   usable on phones, where dragstart never fires. */
function wireDrag() {
  mount.querySelectorAll(".todo-pool-card").forEach(card => {
    card.ondragstart = e => {
      dragging = { kind: "task", id: card.dataset.task, source: card.dataset.source }
      e.dataTransfer.setData(T_TASK, card.dataset.task)
      e.dataTransfer.effectAllowed = "copy"
      card.classList.add("dragging")
    }
    card.ondragend = () => { dragging = null; clearDragChrome() }
  })

  mount.querySelectorAll(".todo-item").forEach(row => {
    row.ondragstart = e => {
      dragging = { kind: "item", id: row.dataset.item }
      e.dataTransfer.setData(T_ITEM, row.dataset.item)
      e.dataTransfer.effectAllowed = "move"
      row.classList.add("dragging")
    }
    row.ondragend = () => { dragging = null; clearDragChrome() }

    // Reorder marker: which side of this row the drop would land on.
    row.ondragover = e => {
      if (!dragging || dragging.kind !== "item" || dragging.id === row.dataset.item) return
      e.preventDefault()
      e.stopPropagation()
      const r = row.getBoundingClientRect()
      const before = e.clientY < r.top + r.height / 2
      row.classList.toggle("drop-before", before)
      row.classList.toggle("drop-after", !before)
    }
    row.ondragleave = () => row.classList.remove("drop-before", "drop-after")

    row.ondrop = e => {
      if (!dragging || dragging.kind !== "item") return
      e.preventDefault()
      e.stopPropagation()   // the lane's own handler must not also run
      const r = row.getBoundingClientRect()
      const before = e.clientY < r.top + r.height / 2
      const targetLane = row.closest("[data-lane]").dataset.lane
      onDropOnItem(dragging.id, row.dataset.item, before, targetLane)
      clearDragChrome()
    }
  })

  mount.querySelectorAll(".todo-drop").forEach(zone => {
    zone.ondragover = e => {
      // `types` is the only thing readable during dragover, which is why the
      // drag kind is encoded in the type rather than the payload.
      const t = e.dataTransfer.types
      if (!t.includes(T_TASK) && !t.includes(T_ITEM)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = t.includes(T_TASK) ? "copy" : "move"
      zone.classList.add("drag-over")
    }
    zone.ondragleave = e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over") }
    zone.ondrop = e => {
      e.preventDefault()
      zone.classList.remove("drag-over")
      const lane = zone.dataset.lane
      const taskId = e.dataTransfer.getData(T_TASK)
      const itemId = e.dataTransfer.getData(T_ITEM)
      if (taskId) addTaskToList(taskId, lane === "deck")
      else if (itemId) onDropOnLane(itemId, lane)
      clearDragChrome()
    }
  })
}

function clearDragChrome() {
  mount.querySelectorAll(".dragging, .drop-before, .drop-after, .drag-over")
    .forEach(el => el.classList.remove("dragging", "drop-before", "drop-after", "drag-over"))
}

/* ── Actions ─────────────────────────────────────────────── */

function addTaskToList(taskId, toDeck = false) {
  if (S.refIds(items).has(taskId)) { H.toast("That's already on your list"); return }
  const personal = getPersonal().some(t => t.id === taskId)
  const task = S.buildTaskIndex(getTasks(), getPersonal()).get(taskId)
  if (!task) { H.toast("That task is no longer there", { error: true }); return }

  if (toDeck && S.deckIsFull(items)) { rejectDeck(); return }

  const item = S.makeItem({ source: personal ? "personal" : "shared", ref: taskId, deck: toDeck })
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

function onSetDeck(id, deck) {
  const r = S.setDeck(items, id, deck)
  if (!r.ok) { rejectDeck(r.error); return }
  commitDebounced(Store.toggleDeck, r.items, "Couldn't move that — put back")
}

function onDropOnLane(itemId, lane) {
  const item = items.find(it => it.id === itemId)
  if (!item) return
  const wantDeck = lane === "deck"
  if (item.deck === wantDeck) return          // dropped back where it started
  onSetDeck(itemId, wantDeck)
}

/* A drop onto another row means two things at once when the lanes differ:
   move lane, and take that row's place. Both land in one list so only one
   write goes out. */
function onDropOnItem(dragId, targetId, before, targetLane) {
  const item = items.find(it => it.id === dragId)
  if (!item) return
  const wantDeck = targetLane === "deck"
  let next = items

  if (item.deck !== wantDeck) {
    const r = S.setDeck(next, dragId, wantDeck)
    if (!r.ok) { rejectDeck(r.error); return }
    next = r.items
  }
  next = S.moveItem(next, dragId, targetId, before)
  commitDebounced(Store.reorder, next, "Couldn't move that — put back")
}

/* The deck refusing a fourth item has to be seen, not just felt — a toast
   plus a shake on the panel itself, so it reads as "full", not "broken". */
function rejectDeck(msg) {
  H.toast(msg || `The Focus Deck holds ${S.DECK_LIMIT} — take something out first.`, { error: true })
  const panel = document.getElementById("todoDeck")
  if (!panel) return
  panel.classList.remove("deck-reject")
  void panel.offsetWidth          // restart the animation on a repeat drop
  panel.classList.add("deck-reject")
  setTimeout(() => panel.classList.remove("deck-reject"), 500)
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
