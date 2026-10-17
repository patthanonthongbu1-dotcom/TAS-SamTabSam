/* ─────────────────────────────────────────────────────────────
   TAS Ideas — a place to dump a thought before it's gone.

   Its own tab beside To Do. Type, Enter, and the box stays focused so
   the next one goes straight in. An idea that turns into a plan is
   "Plan it" → a date → a block on that day in Blocks, and leaves here.

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
    at: Number.isFinite(i.at) ? i.at : 0
  })).slice(0, MAX_IDEAS)
}

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
let uid = null, mount = null, H = {}, io = {}
let ideas = []            // as drawn
let lastSaved = []        // what the store confirmed — the rollback target
let loaded = false, loading = false, loadFailed = false
let editingId = null
// Motion: the rows stagger in when you arrive, and a new one springs in alone.
// Both are one-shot, so a redraw after a save never replays them.
let arrivePending = false, freshId = null

export function initIdeas(opts) {
  uid = opts.uid || null
  mount = opts.mount
  H = opts.helpers
  io = { load: opts.load, save: opts.save, adopt: opts.adopt, addToDay: opts.addToDay, removeFromDay: opts.removeFromDay }
  ideas = []; lastSaved = []; loaded = false; loadFailed = false; editingId = null
  ensureLoaded()
}

export const ideaCount = () => ideas.length

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
  if (!mount) return
  ensureLoaded()
  const { esc, ico } = H
  const now = Date.now()
  const arrive = arrivePending && ideas.length > 0
  if (arrive) arrivePending = false
  const rows = ideas.map((i, n) => i.id === editingId
    ? `<div class="idea-row editing" data-id="${esc(i.id)}">
        <input class="idea-edit" value="${esc(i.text)}" maxlength="${MAX_IDEA_TEXT}" aria-label="Edit idea">
      </div>`
    : `<div class="idea-row${i.id === freshId ? " fresh" : ""}" data-id="${esc(i.id)}" style="--i:${Math.min(n, 10)}">
        <button class="idea-text" data-act="edit">${esc(i.text)}<span class="idea-age">${esc(ageLabel(i.at, now))}</span></button>
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
      <input class="idea-add" id="ideaAdd" placeholder="Spit it out — Enter to keep it" maxlength="${MAX_IDEA_TEXT}"
        enterkeyhint="done" aria-label="New idea" ${ideas.length >= MAX_IDEAS ? "disabled" : ""}>
      <div class="idea-list">${rows || (loaded ? `<div class="idea-empty">${ico("inbox")}<p>Nothing here yet</p><small>Type anything above. You can turn it into a plan later.</small></div>` : "")}</div>
      <div class="tl-foot">${foot}</div>
    </div>`
  wire()
}

function wire() {
  const add = mount.querySelector("#ideaAdd")
  if (add && !editingId) add.focus({ preventScroll: true })
  add?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.isComposing) return
    e.preventDefault()
    const idea = makeIdea(add.value)
    if (!idea.text || !loaded) return
    // commit draws before it awaits, so "fresh" marks this one draw only
    freshId = idea.id
    commit(addIdea(ideas, idea))
    freshId = null
    navigator.vibrate?.(6)
  })

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
    row.querySelector('[data-act="edit"]').addEventListener("click", () => { editingId = id; render() })
    row.querySelector('[data-act="del"]').addEventListener("click", () => remove(id))
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
