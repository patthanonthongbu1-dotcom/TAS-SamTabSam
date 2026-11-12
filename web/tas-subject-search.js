/* ─────────────────────────────────────────────────────────────
   Subject search box — type, see suggestions, pick. Used by the
   Formatter and the calendar's task form, so picking a subject works
   the same everywhere. Only subjects on the list can be picked; a
   moderator can add a new one from here (canAdd/onAdd).

   mountSubjectSearch(host, {
     items:  () => subject list (read live, so a reload shows up),
     value:  current subject text,
     onPick: item => …,             // the chosen list entry
     canAdd: () => bool,            // show "Add new subject"
     onAdd:  async item => item|null // save it; return the saved entry
   }) → { set(value) }

   Theme comes from the page's --field-bg / --field-brd / --text /
   --muted / --panel / --pink, with dark fallbacks.
   ───────────────────────────────────────────────────────────── */
import { search, match, label } from "./tas-subjects.js"

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const HEX = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#64748b"
const I = {
  caret: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  find:  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>`,
  plus:  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  warn:  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.3v.2"/></svg>`,
}

const CSS = `
.ss{position:relative;flex:1;min-width:0}
.ss-chip{width:100%;display:flex;align-items:center;gap:8px;min-height:42px;padding:8px 10px 8px 12px;border-radius:10px;
  border:1px solid var(--field-brd,rgba(255,255,255,.16));background:var(--field-bg,rgba(255,255,255,.07));color:var(--text,#fff);
  font-family:'Kanit',sans-serif;font-size:15px;text-align:left;cursor:pointer;transition:border-color .15s}
.ss-chip:hover,.ss.open .ss-chip{border-color:var(--pink,#ff4fa3)}
.ss-chip .ss-t{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.ss-chip .ss-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-chip .ss-sub{font-size:12px;color:var(--muted,rgba(255,255,255,.6));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ss-chip .ss-ph{color:var(--muted,rgba(255,255,255,.6))}
.ss-chip .ss-c{flex-shrink:0;opacity:.6;transition:transform .2s}
.ss.open .ss-chip .ss-c{transform:rotate(180deg)}
.ss-chip.warn{border-color:#f59e0b}
.ss-chip.warn .ss-w{color:#f59e0b;display:inline-flex}
.ss-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0}
.ss-pop{position:fixed;z-index:4000;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:13px;
  background:var(--panel,rgba(16,25,44,.99));color:var(--text,#fff);border:1px solid var(--field-brd,rgba(255,255,255,.16));
  box-shadow:0 18px 44px -10px rgba(0,0,0,.6);animation:ssIn .14s ease both}
@keyframes ssIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.ss-qw{display:flex;align-items:center;gap:7px;padding:0 10px;border-radius:9px;border:1px solid var(--field-brd,rgba(255,255,255,.16));background:var(--field-bg,rgba(255,255,255,.07))}
.ss-qw svg{opacity:.55;flex-shrink:0}
.ss-q{flex:1;min-width:0;border:0!important;background:transparent!important;color:inherit;font-family:'Kanit',sans-serif;font-size:16px;padding:9px 0!important;outline:none;box-shadow:none!important}
.ss-list{display:flex;flex-direction:column;gap:1px;max-height:280px;overflow-y:auto}
.ss-item{display:flex;align-items:center;gap:9px;padding:8px 9px;border:0;border-radius:8px;background:transparent;color:inherit;
  font-family:'Kanit',sans-serif;font-size:14.5px;text-align:left;cursor:pointer}
.ss-item.act,.ss-item:hover{background:color-mix(in srgb,var(--text,#fff) 9%,transparent)}
.ss-item .ss-n{flex:1;min-width:0}
.ss-item .ss-s{display:block;font-size:12px;color:var(--muted,rgba(255,255,255,.6))}
.ss-item.add{color:var(--pink,#ff4fa3);font-weight:500}
.ss-none{padding:10px;font-size:13.5px;color:var(--muted,rgba(255,255,255,.6));text-align:center}
.ss-form{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ss-form input{width:100%;padding:8px 10px!important;font-size:15px!important;border-radius:8px;border:1px solid var(--field-brd,rgba(255,255,255,.16));
  background:var(--field-bg,rgba(255,255,255,.07));color:inherit;font-family:'Kanit',sans-serif}
.ss-form input[type=color]{padding:2px!important;height:38px}
.ss-form .wide{grid-column:1/-1}
.ss-form .row{grid-column:1/-1;display:flex;gap:6px;justify-content:flex-end}
.ss-form button{padding:8px 14px;border-radius:8px;border:1px solid var(--field-brd,rgba(255,255,255,.16));background:transparent;color:inherit;font-family:'Kanit',sans-serif;font-size:14px;cursor:pointer}
.ss-form button.go{background:var(--pink,#ff4fa3);border-color:transparent;color:#fff;font-weight:500}
.ss-form .err{grid-column:1/-1;font-size:12.5px;color:#f87171}
`

const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"]

export function mountSubjectSearch(host, opts){
  const doc = host.ownerDocument
  if(!doc.getElementById("tasSsStyles")){
    const el = doc.createElement("style"); el.id = "tasSsStyles"; el.textContent = CSS; doc.head.appendChild(el)
  }
  let value = opts.value || "", act = 0, shown = [], pop = null
  const items = () => opts.items() || []

  host.innerHTML = `<div class="ss"><button type="button" class="ss-chip" aria-haspopup="listbox"></button></div>`
  const root = host.firstElementChild, chip = root.firstElementChild

  function paintChip(){
    const v = value.trim(), hit = match(v, items())
    chip.classList.toggle("warn", !!v && !hit)
    chip.innerHTML = hit
      ? `<span class="ss-dot" style="background:${HEX(hit.color)}"></span><span class="ss-t"><span class="ss-nm">${esc(hit.name)}</span>${hit.code || hit.teacher ? `<span class="ss-sub">${hit.code ? `<b style="color:${HEX(hit.color)};font-weight:600">${esc(hit.code)}</b>` : ""}${hit.code && hit.teacher ? " · " : ""}${esc(hit.teacher)}</span>` : ""}</span>${I.caret.replace("<svg", '<svg class="ss-c"')}`
      : v ? `<span class="ss-w">${I.warn}</span><span class="ss-t">${esc(v)} <span class="ss-ph">· ไม่อยู่ในรายการ</span></span>${I.caret.replace("<svg", '<svg class="ss-c"')}`
      : `<span class="ss-t ss-ph">เลือกวิชา… พิมพ์ค้นหาได้</span>${I.caret.replace("<svg", '<svg class="ss-c"')}`
  }

  // Fixed to the viewport so a scrolling modal can't clip it
  function place(){
    if(!pop) return
    const r = chip.getBoundingClientRect(), vh = window.innerHeight
    const w = Math.max(r.width, Math.min(320, window.innerWidth - 16))
    pop.style.width = w + "px"
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px"
    const below = vh - r.bottom
    if(below < 260 && r.top > below){ pop.style.top = ""; pop.style.bottom = (vh - r.top + 6) + "px" }
    else { pop.style.bottom = ""; pop.style.top = (r.bottom + 6) + "px" }
  }

  function list(q){
    shown = search(q, items())
    act = 0
    const box = pop.querySelector(".ss-list")
    const add = opts.canAdd?.() && q.trim()
    box.innerHTML = shown.map((s, i) => `<button type="button" class="ss-item${i === act ? " act" : ""}" data-i="${i}" role="option">
        <span class="ss-dot" style="background:${HEX(s.color)}"></span>
        <span class="ss-n">${s.code ? `<b style="color:${HEX(s.color)};font-weight:600">${esc(s.code)}</b> · ` : ""}${esc(s.name)}
          ${s.short || s.teacher ? `<span class="ss-s">${esc([s.short, s.teacher].filter(Boolean).join(" · "))}</span>` : ""}</span>
      </button>`).join("")
      + (!shown.length ? `<div class="ss-none">ไม่พบวิชา “${esc(q.trim())}”</div>` : "")
      + (add ? `<button type="button" class="ss-item add" data-add="1">${I.plus}<span class="ss-n">เพิ่มวิชาใหม่ “${esc(q.trim())}”</span></button>` : "")
  }

  function open(){
    if(pop) return
    root.classList.add("open")
    pop = doc.createElement("div")
    pop.className = "ss-pop"
    pop.innerHTML = `<div class="ss-qw">${I.find}<input class="ss-q" type="text" autocomplete="off" placeholder="eng core, คณิต > เพิ่ม, อ23102…" aria-label="Search subjects"></div><div class="ss-list" role="listbox"></div>`
    doc.body.appendChild(pop)
    const q = pop.querySelector(".ss-q")
    list("")
    place()
    q.focus()
    q.oninput = () => list(q.value)
    q.onkeydown = e => {
      const btns = [...pop.querySelectorAll(".ss-item")]
      if(e.key === "ArrowDown" || e.key === "ArrowUp"){
        e.preventDefault()
        act = (act + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % Math.max(1, btns.length)
        btns.forEach((b, i) => b.classList.toggle("act", i === act)); btns[act]?.scrollIntoView({ block: "nearest" })
      } else if(e.key === "Enter"){ e.preventDefault(); btns[act]?.click() }
      else if(e.key === "Escape"){ e.preventDefault(); close(); chip.focus() }
    }
    pop.addEventListener("click", e => {
      const it = e.target.closest(".ss-item")
      if(!it) return
      if(it.dataset.add) return addForm(q.value.trim())
      pick(shown[+it.dataset.i])
    })
    setTimeout(() => {
      doc.addEventListener("pointerdown", outside, true)
      window.addEventListener("resize", place)
      doc.addEventListener("scroll", place, true)
    })
  }
  function close(){
    if(!pop) return
    pop.remove(); pop = null
    root.classList.remove("open")
    doc.removeEventListener("pointerdown", outside, true)
    window.removeEventListener("resize", place)
    doc.removeEventListener("scroll", place, true)
  }
  const outside = e => { if(pop && !pop.contains(e.target) && !root.contains(e.target)) close() }
  function pick(s){
    if(!s) return
    value = s.name; paintChip(); close()
    opts.onPick(s)
  }

  // Moderators: a new subject, saved to the shared list, then picked
  function addForm(typed){
    const looksCode = /^[\p{L}]\d{3,}/u.test(typed)
    pop.querySelector(".ss-list").innerHTML = `<form class="ss-form">
      <input name="code" placeholder="Code อ23102" maxlength="10" value="${looksCode ? esc(typed) : ""}">
      <input name="short" placeholder="Short name" maxlength="20">
      <input class="wide" name="name" placeholder="Subject name" maxlength="60" required value="${looksCode ? "" : esc(typed)}">
      <input name="teacher" placeholder="Teacher" maxlength="40">
      <input name="color" type="color" value="${PALETTE[items().length % PALETTE.length]}" aria-label="Colour">
      <div class="err" hidden></div>
      <div class="row"><button type="button" class="back">Back</button><button class="go">Add subject</button></div>
    </form>`
    const f = pop.querySelector(".ss-form"), err = f.querySelector(".err")
    const field = k => f.elements.namedItem(k)
    f.querySelector(".back").onclick = () => list(pop.querySelector(".ss-q").value)
    field(field("name").value ? "code" : "name").focus()
    f.onsubmit = async e => {
      e.preventDefault()
      const it = Object.fromEntries(["code", "short", "name", "teacher", "color"].map(k => [k, field(k).value.trim()]))
      if(!it.name){ err.hidden = false; err.textContent = "Give it a name."; return }
      const go = f.querySelector(".go"); go.disabled = true; go.textContent = "Saving…"
      try {
        const saved = await opts.onAdd({ ...it, id: "", icon: "📝", aliases: [] })
        if(saved) pick(saved)
        else { err.hidden = false; err.textContent = "That name is already on the list."; go.disabled = false; go.textContent = "Add subject" }
      } catch(x){
        err.hidden = false; err.textContent = "Couldn't save: " + (x.message || x)
        go.disabled = false; go.textContent = "Add subject"
      }
    }
  }

  chip.onclick = () => pop ? close() : open()
  chip.onkeydown = e => { if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !pop){ open() } }
  paintChip()
  return { set(v){ value = v || ""; paintChip() }, close }
}
