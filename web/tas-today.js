/* ─────────────────────────────────────────────────────────────
   The Today report — one day's homework, drawn as the card itself:
   what was posted that day, what's due, and (in the footer) what's due
   tomorrow, or the week ahead on a Friday. Read-only.

   Lives inside the calendar now (switchView("today")); today.html only
   forwards there. No Firebase here: the page hands in the tasks, the
   subject list and a loadPhotos(id) function.
   ───────────────────────────────────────────────────────────── */
import { cardModel, reportFor, localKey, addDays, weekdayOf } from "./tas-hwcard.js"
import { mountHwCard, exportHwCard, thaiDate } from "./tas-card.js"
import * as Subj from "./tas-subjects.js"

const ICON = {
  prev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>`,
  next: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  save: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`,
  cal:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
}

export const TODAY_CSS = `
.tv{max-width:600px;margin:0 auto;padding:14px 12px 24px}
.tv-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.tv-ib{flex-shrink:0;width:42px;height:42px;border-radius:13px;border:1px solid var(--field-brd,rgba(127,127,127,.25));background:var(--field-bg,rgba(127,127,127,.08));color:var(--text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.tv-ib svg{width:19px;height:19px}.tv-ib[disabled]{opacity:.35;cursor:default}
.tv-day{flex:1;min-width:0;text-align:center;line-height:1.2}
.tv-day b{display:block;font-size:17px;font-weight:600;color:var(--text)}
.tv-day span{font-size:12.5px;color:var(--muted)}
.tv-day button{font:inherit;font-size:12px;color:var(--pink);background:none;border:none;padding:0;margin-left:6px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.tv-card .hw{width:100%;box-shadow:0 18px 50px -28px rgba(0,0,0,.45)}
.tv-card .hw-row[data-tid]{cursor:pointer;transition:transform .12s}
.tv-card .hw-row[data-tid]:active{transform:scale(.99)}
.tv-acts{display:flex;gap:8px;margin-top:14px}
.tv-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:46px;border-radius:14px;border:1px solid var(--field-brd,rgba(127,127,127,.25));background:var(--field-bg,rgba(127,127,127,.08));color:var(--text);font-family:'Kanit',sans-serif;font-size:15px;font-weight:500;cursor:pointer}
.tv-btn.primary{background:var(--accent-grad);border-color:transparent;color:#fff}
.tv-btn svg{width:17px;height:17px}
.tv-note{text-align:center;font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}
.tv-skel{height:520px;border-radius:26px;background:var(--field-bg,rgba(127,127,127,.1));animation:tvPulse 1.2s ease-in-out infinite alternate}
@keyframes tvPulse{to{opacity:.5}}
.tv-render{position:fixed;left:-10000px;top:0;width:540px;pointer-events:none}
`

/**
 * Mounts the view into `mount` and returns { render, setDate, ids }.
 * deps: { today?, loadPhotos(id) → Promise<[{src}]>, onDate(date), onOpenTask(id, event), onBack(ids) }
 */
export function mountToday(mount, deps) {
  const doc = mount.ownerDocument
  if (!doc.getElementById("tasTodayStyles")) {
    const st = doc.createElement("style"); st.id = "tasTodayStyles"; st.textContent = TODAY_CSS; doc.head.appendChild(st)
  }
  const today = deps.today || localKey()
  let date = deps.date || today, tasks = null, subjects = Subj.listOrTimetable(), ids = [], model = null
  const photos = new Map()        // id → [{src}] | "loading"

  mount.innerHTML = `<div class="tv">
    <div class="tv-bar">
      <button class="tv-ib" data-act="prev" aria-label="Day before" title="Day before">${ICON.prev}</button>
      <div class="tv-day"><b data-el="title">Today</b><span data-el="sub"></span></div>
      <button class="tv-ib" data-act="next" aria-label="Day after" title="Day after">${ICON.next}</button>
    </div>
    <div class="tv-card" data-el="card"><div class="tv-skel"></div></div>
    <div class="tv-acts">
      <button class="tv-btn" data-act="save">${ICON.save} Save image</button>
      <button class="tv-btn primary" data-act="back">${ICON.cal} Back to calendar</button>
    </div>
    <div class="tv-note" data-el="note">Straight from the class calendar — tap a homework to open it.</div>
    <div class="tv-render" data-el="render" aria-hidden="true"></div>
  </div>`
  const el = k => mount.querySelector(`[data-el="${k}"]`)

  const photosFor = t => {
    if (!t.photoCount || !deps.loadPhotos) return []
    const got = photos.get(t.id)
    if (Array.isArray(got)) return got
    if (!got) {
      photos.set(t.id, "loading")
      deps.loadPhotos(t.id).then(ph => { photos.set(t.id, ph || []); draw() }).catch(() => photos.set(t.id, []))
    }
    return []
  }
  const rowOf = t => {
    const ph = photosFor(t), h = Subj.match(t.subject, subjects)
    return { id: t.id, subject: h ? h.name : (t.subject || "").trim(), code: h ? h.code : "", teacher: h ? h.teacher : "",
             color: h ? h.color : "#64748b", icon: (h && h.icon) || "📝",
             kind: t.type === "marker" ? t.markerType : "homework",
             lines: [t.name || ""], due: t.end || "", dueAt: t.dueAt || "", send: t.send || "",
             photos: ph.map(p => ({ src: p.src, size: ph.length > 1 ? 50 : 100 })) }
  }

  function draw() {
    if (!mount.isConnected) return
    const isToday = date === today
    el("title").textContent = isToday ? "Today" : `วัน${weekdayOf(date)}`
    el("sub").innerHTML = thaiDate(date) + (isToday ? "" : `<button type="button" data-act="today">Today</button>`)
    mount.querySelector('[data-act="next"]').disabled = date >= addDays(today, 7)
    if (!tasks) return
    const r = reportFor(tasks, date)
    const postedIds = new Set(r.posted.map(t => t.id))
    const due = r.due.filter(t => !postedIds.has(t.id))
    const shown = new Set([...r.posted, ...due].map(t => t.id))
    const upcoming = r.upcoming.filter(t => !shown.has(t.id))
    ids = [...r.posted, ...due, ...upcoming].map(t => t.id)
    const sections = [
      { icon: "📢", title: "งานใหม่ · New", rows: r.posted.map(rowOf) },
      { icon: "📌", title: "ส่งวันนี้ · Due " + (isToday ? "today" : "this day"), rows: due.map(rowOf) },
    ]
    const footer = upcoming.length ? { week: r.week, qr: null,
      reminders: upcoming.map(t => ({ ...rowOf(t), name: t.name || "", due: t.end })) } : null
    model = cardModel({ date, name: "", sections, footer }, date)
    mountHwCard(el("card"), model)
  }

  const go = d => { date = d; deps.onDate?.(date); draw() }
  mount.addEventListener("click", async e => {
    const row = e.target.closest(".hw-row[data-tid]")
    if (row && el("card").contains(row)) return deps.onOpenTask?.(row.dataset.tid, e)
    const act = e.target.closest("[data-act]")?.dataset.act
    if (act === "prev") go(addDays(date, -1))
    else if (act === "next") go(addDays(date, 1))
    else if (act === "today") go(today)
    else if (act === "back") deps.onBack?.(ids)
    else if (act === "save" && model) {
      const btn = e.target.closest("button"); btn.disabled = true
      try {
        const { toBlob } = await import("https://esm.sh/html-to-image@1.11.13")
        const host = el("render")
        const blob = await exportHwCard(mountHwCard(host, model), toBlob)
        host.innerHTML = ""
        const a = doc.createElement("a")
        a.href = URL.createObjectURL(blob); a.download = "tas-today-" + date + ".png"
        doc.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      } catch (err) { console.warn("Save failed:", err); el("note").textContent = "Couldn't save the image — try again." }
      btn.disabled = false
    }
  })

  draw()
  return {
    /** New data (tasks, and the subject list when it changes) */
    render(nextTasks, nextSubjects) { if (nextTasks) tasks = nextTasks; if (nextSubjects) subjects = nextSubjects; draw() },
    setDate(d) { if (/^\d{4}-\d{2}-\d{2}$/.test(d || "")) { date = d; draw() } },
    get date() { return date },
    get ids() { return ids },
  }
}
