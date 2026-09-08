/* ─────────────────────────────────────────────────────────────
   TAS — the page navigator.

   A line at the bottom of every signed-in page. Tap it and it
   stretches into a pill of pages; tap away, or Escape, and it goes
   back to being a line. Whichever of the two you left it in is what
   you get on the next page and the next launch, so it behaves like
   an app's tab bar rather than a thing you re-open constantly.

   How many pages it offers depends on who is looking. Everyone
   gets Calendar and Tools. The task formatter is the whitelisted
   page, so it only appears for people on `config/modWhitelist` —
   which is a courtesy, not a lock: announce.html still gates
   itself, and this only decides whether the door is signposted.

   Usage from a page:
     import { mountNav } from "./tas-nav.js"
     mountNav({ active:"calendar", admin: isWhitelisted })

   `admin` may be a boolean or a promise of one. Passing a promise
   mounts the two everyone-gets pages immediately and slots the
   third in when the answer arrives, rather than holding the whole
   navigator back on a network round trip. Calling mountNav again
   updates the current page and the authority in place.

   Styling lives in tas-nav.css, which every host page links.

   This module deliberately has no imports. It cannot borrow
   icon() from tools-shell.js — that would drag a second Firebase
   init into calendar.html and announce.html — and it must not
   lean on calendar's <symbol> sprite, or it stops being a thing
   you can drop into any page.
   ───────────────────────────────────────────────────────────── */

/* `admin` marks a page that only shows for someone on the
   whitelist. Order is deliberate: the formatter sits between the
   two so the pill does not reshuffle when it appears. */
const PAGES = [
  { key:"calendar", href:"calendar.html",  icon:"calendar", label:"Calendar" },
  { key:"announce", href:"announce.html",  icon:"note",     label:"Formatter", admin:true },
  { key:"hub",      href:"tools.html",     icon:"tools",    label:"Tools" },
]

/* The Tools pages each pass their own tab key as `active`. None of
   them is a destination here, so they all light the Tools item. */
const TOOL_KEYS = ["hub", "qr", "link", "convert", "widget"]

/* Each entry is the inside of a 24×24 viewBox — same stroke
   convention as tools-shell.js, so the two icon sets look like
   one hand drew them. */
const PATHS = {
  calendar: `<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v4M16 3v4"/>`,
  note:     `<path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>`,
  tools:    `<path d="M4 9h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a1 1 0 0 1 1-1Z"/><path d="M9 9V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/><path d="M3 14h18"/>`,
}

function svg(name){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`
}

/* Fallback for a host that forgets to pass `active`: match the
   filename we are actually being served as. A tools-* page counts
   as Tools. Everything here is ours — no user text reaches
   innerHTML in this module. */
function detectActive(){
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase()
  if(file.startsWith("tools")) return "hub"
  const hit = PAGES.find(p => p.href.toLowerCase() === file)
  return hit ? hit.key : null
}

/* Open or shut is a setting, not a per-page mood. Someone who opens the
   bar and taps Calendar should arrive with the bar still open — like a
   tab bar, which is the whole point of it being one. localStorage rather
   than sessionStorage so it survives a relaunch of the installed app too;
   private windows throw on both, hence the try/catch either way. */
const OPEN_KEY = "tas_nav_open"
function readOpen(){
  try{ return localStorage.getItem(OPEN_KEY) === "1" }catch(e){ return false }
}
function writeOpen(open){
  try{ localStorage.setItem(OPEN_KEY, open ? "1" : "0") }catch(e){}
}

let mounted = null

function render(root, here, admin){
  const key = TOOL_KEYS.includes(here) ? "hub" : here
  const shown = PAGES.filter(p => !p.admin || admin)

  root.querySelector(".tasnav-body").innerHTML = shown.map(p => {
    const isHere = p.key === key
    const tag = isHere ? "span" : "a"
    const attrs = isHere ? ` aria-current="page"` : ` href="${p.href}"`
    return `<${tag} class="tasnav-item${isHere ? " here" : ""}"${attrs}>` +
      `${svg(p.icon)}<span class="tasnav-lab">${p.label}</span></${tag}>`
  }).join("")

  measure(root)
}

/* The open pill is exactly as wide as its contents. The body is
   absolutely positioned and sized to max-content, so it keeps that
   width while the surface around it is still a 6px line — which is
   the only reason this can be measured before anything opens. */
function measure(root){
  const w = Math.ceil(root.querySelector(".tasnav-body").getBoundingClientRect().width)
  if(w) root.style.setProperty("--tasnav-w", w + "px")
}

/**
 * Injects the navigator and wires it up. Safe to call again — a
 * second call re-marks the current page and re-reads authority
 * rather than stacking a second navigator on the first.
 *
 * @param {{active?: string, admin?: boolean|Promise<boolean>}} opts
 * @returns {HTMLElement} the navigator root
 */
export function mountNav({ active, admin = false } = {}){
  const here = active || detectActive()
  const settleAdmin = root => {
    if(admin && typeof admin.then === "function"){
      admin.then(ok => { if(ok) render(root, here, true) }).catch(() => {})
      return false
    }
    return !!admin
  }

  if(mounted){
    render(mounted, here, settleAdmin(mounted))
    return mounted
  }

  const root = document.createElement("div")
  /* no-anim for the first frame: a restored bar must be *already* open when
     the page paints, not seen stretching open again on every navigation.
     Same class and reason the calendar uses on re-renders. */
  root.className = "tasnav no-anim"
  root.dataset.open = "false"
  root.innerHTML =
    `<div class="tasnav-surface">` +
      `<svg class="tasnav-skin" aria-hidden="true">` +
        `<rect class="tasnav-cap" x="0" y="0" width="100%" height="100%"/>` +
      `</svg>` +
      `<nav class="tasnav-body" aria-label="Pages"></nav>` +
    `</div>` +
    `<button class="tasnav-hit" type="button" aria-expanded="false" aria-label="Show pages"></button>`

  document.body.appendChild(root)
  render(root, here, settleAdmin(root))

  const hit  = root.querySelector(".tasnav-hit")
  const body = root.querySelector(".tasnav-body")

  const isOpen = () => root.dataset.open === "true"
  function setOpen(open){
    root.dataset.open = open ? "true" : "false"
    hit.setAttribute("aria-expanded", open ? "true" : "false")
    writeOpen(open)
  }
  /* Restore before the first paint, then let the transitions back in. The
     timer is not belt-and-braces: a page opened in a background tab gets no
     animation frames at all, and without it the bar would stay unanimated
     for the rest of its life. */
  if(readOpen()) setOpen(true)
  const animate = () => root.classList.remove("no-anim")
  requestAnimationFrame(() => requestAnimationFrame(animate))
  setTimeout(animate, 150)

  /* The handle is the only thing that opens or closes it. Deliberately
     no outside-click handler: the bar keeps its state across pages, so a
     stray tap anywhere on the calendar would otherwise collapse it and
     every page after would open collapsed. */
  hit.addEventListener("click", e => {
    e.stopPropagation()
    measure(root)      // fonts may have landed since mount, changing the width
    setOpen(!isOpen())
  })

  /* Tapping a page lights it straight away — the browser spends a moment
     on the next document, and a bar still highlighting the page you just
     left reads as a dead tap. */
  body.addEventListener("click", e => {
    const item = e.target.closest(".tasnav-item")
    if(!item || !item.href) return
    body.querySelectorAll(".tasnav-item").forEach(el => el.classList.remove("here"))
    item.classList.add("here")
  })

  /* No Escape handler on purpose. The bar is usually open now, and a key
     that dismisses things would have to swallow Escape on every page —
     the calendar's modals, sheets and dropdowns all close on it, and they
     are what the key is for. The grip closes the bar. */

  // Kanit arrives after first paint and the labels get wider with it.
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => measure(root))
  window.addEventListener("resize", () => measure(root))

  mounted = root
  return root
}
