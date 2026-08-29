/* ─────────────────────────────────────────────────────────────
   TAS Tools — shared shell module.

   Owns everything the four Tools pages have in common: Firebase
   init, the auth gate (signed out → back to index.html), the orb
   backdrop, the topbar with its tab strip and profile dropdown,
   plus esc() / toast() copied from calendar.html so the helpers
   behave identically across the app.

   Usage from a page:
     import { initShell, db, esc, toast } from "./tools-shell.js"
     const user = await initShell({ title:"QR Code", active:"qr" })
   ───────────────────────────────────────────────────────────── */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js"
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js"

const firebaseConfig = {
  apiKey:"AIzaSyA7jTnrA4qvIyqJRec3LYRgkIpJ4lKqX18",
  authDomain:"tas-samtabsam.firebaseapp.com",
  projectId:"tas-samtabsam",
  storageBucket:"tas-samtabsam.firebasestorage.app",
  messagingSenderId:"645483732924",
  appId:"1:645483732924:web:5a1ec2b9f7c58a18c655b9"
}

const LOGIN_URL = "index.html"

export const app  = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getFirestore(app)

/* ── Icon set ─────────────────────────────────────────────────
   Inline SVG rather than emoji: emoji ignore currentColor (so they
   can't go yellow), and every OS draws them differently. Each entry
   is the *inside* of a 24×24 viewBox; icon() wraps it. Stroke icons
   inherit the text colour. */
const PATHS = {
  tools:    `<path d="M4 9h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a1 1 0 0 1 1-1Z"/><path d="M9 9V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/><path d="M3 14h18"/>`,
  qr:       `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v3M18 21h3M14 21h1"/>`,
  link:     `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
  card:     `<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M7 13h7M7 17h4"/>`,
  download: `<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>`,
  copy:     `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>`,
  share:    `<path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>`,
  plus:     `<path d="M12 5v14M5 12h14"/>`,
  trash:    `<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>`,
  external: `<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`,
  back:     `<path d="m14 6-6 6 6 6"/>`,
  next:     `<path d="m10 6 6 6-6 6"/>`,
  lock:     `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`,
  calendar: `<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v4M16 3v4"/>`,
  refresh:  `<path d="M20 11a8 8 0 1 0-1.7 5"/><path d="M20 4v7h-7"/>`,
  scissors: `<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8 7.5 20 18M8 16.5 20 6"/>`,
  image:    `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>`,
  file:     `<path d="M5 3h8l6 6v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M13 3v6h6"/>`,
  edit:     `<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5 17.5 10.5"/>`,
  phone:    `<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 5.5h3"/>`,
  check:    `<path d="M4 12.5 9 17.5 20 6.5"/>`,
  clock:    `<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>`,
}

/**
 * Inline SVG icon markup. Safe to drop into innerHTML — the paths are
 * ours, the only interpolated values are numbers.
 */
export function icon(name, size = 16){
  const d = PATHS[name]
  if(!d) return ""
  return `<span class="ico" style="width:${size}px;height:${size}px" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`
}

/**
 * Fills every empty `data-ico="name"` element with its SVG, sized by an
 * optional `data-size`. Lets pages declare icons in plain HTML instead of
 * building strings, and can be re-run after any innerHTML render.
 */
export function paintIcons(root = document){
  root.querySelectorAll("[data-ico]").forEach(el => {
    el.innerHTML = icon(el.dataset.ico, Number(el.dataset.size) || 16)
  })
}

// The pages of the section, in tab order.
const TOOL_TABS = [
  { key:"hub",  href:"tools.html",      icon:"tools", label:"Tools"   },
  { key:"qr",   href:"tools-qr.html",   icon:"qr",    label:"QR Code" },
  { key:"link", href:"tools-link.html", icon:"link",  label:"Links"   },
  { key:"convert", href:"tools-convert.html", icon:"file", label:"Convert" },
  { key:"widget", href:"tools-widget.html", icon:"phone", label:"Widget" },
]

/* Escape user text before it goes anywhere near innerHTML — same
   helper the calendar uses, for the same reason. */
export function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))
}

export function toast(msg,{action,onAction,duration=4000,error=false}={}){
  let wrap=document.getElementById("toastWrap")
  if(!wrap){wrap=document.createElement("div");wrap.id="toastWrap";document.body.appendChild(wrap)}
  const el=document.createElement("div")
  el.className="toast"+(error?" error":"")
  el.innerHTML=`<span>${esc(msg)}</span>${action?`<button class="toast-action">${esc(action)}</button>`:""}`
  wrap.appendChild(el)
  requestAnimationFrame(()=>el.classList.add("show"))
  const dismiss=()=>{el.classList.remove("show");setTimeout(()=>el.remove(),300)}
  if(action&&onAction)el.querySelector(".toast-action").onclick=()=>{onAction();dismiss()}
  setTimeout(dismiss,duration)
  return dismiss
}

/* Copy helper — navigator.clipboard needs a secure context, so keep a
   textarea+execCommand fallback for anyone on http:// or an old browser. */
export async function copyText(text,label="Copied to clipboard"){
  try{
    await navigator.clipboard.writeText(text)
    toast(label)
    return true
  }catch(e){
    try{
      const ta=document.createElement("textarea")
      ta.value=text; ta.style.position="fixed"; ta.style.opacity="0"
      document.body.appendChild(ta); ta.select()
      const ok=document.execCommand("copy")
      ta.remove()
      if(!ok) throw new Error("execCommand failed")
      toast(label)
      return true
    }catch(e2){
      toast("Couldn't copy — long-press the text to copy it manually",{error:true})
      return false
    }
  }
}

/* Trigger a browser download from a blob or data URL. */
export function download(dataOrBlob,filename){
  const url = typeof dataOrBlob==="string" ? dataOrBlob : URL.createObjectURL(dataOrBlob)
  const a=document.createElement("a")
  a.href=url; a.download=filename
  document.body.appendChild(a); a.click(); a.remove()
  if(typeof dataOrBlob!=="string") setTimeout(()=>URL.revokeObjectURL(url),4000)
}

function orbsHTML(){
  return `<div class="bg-orbs" aria-hidden="true">
    <span class="orb orb-1"></span><span class="orb orb-2"></span><span class="orb orb-3"></span>
  </div>`
}

function topbarHTML(title,active){
  const tabs = TOOL_TABS.map(t=>
    `<a class="tool-tab${t.key===active?" active":""}" href="${t.href}">${icon(t.icon,14)} ${esc(t.label)}</a>`
  ).join("")
  // Same swap the calendar's setTheme() does — the LIGHT file is the logo
  // *for* dark backgrounds, so the light theme needs the other one.
  const logo = document.documentElement.dataset.theme === "light" ? "TASLogo.png" : "TASLogoLIGHT.png"
  return `<div class="topbar">
    <div class="topbar-row1">
      <a class="topbar-brand" href="tools.html">
        <div class="brand-chip"><img class="brand-mini" src="${logo}" alt="3/3 Academic System" /></div>
        <div class="brand-text">
          <h1>${esc(title)}</h1>
          <div class="brand-sub">TAS Tools</div>
        </div>
      </a>
      <div class="user-pill" id="userPill">
        <div id="pillAv"></div>
        <span class="pill-name" id="pillName"></span>
        <span class="pill-caret">▾</span>
      </div>
    </div>
    <div class="tool-tabs">${tabs}</div>
    <div class="user-dropdown" id="userDropdown">
      <div class="user-dropdown-info">
        <div class="user-dropdown-name" id="dropdownName"></div>
        <div class="user-dropdown-email" id="dropdownEmail"></div>
      </div>
      <a class="user-dropdown-btn menu" href="calendar.html">${icon("calendar",15)} Calendar</a>
      <a class="user-dropdown-btn menu" href="index.html">${icon("back",15)} Return to menu</a>
      <button class="user-dropdown-btn signout" id="signOutBtn">${icon("external",15)} Sign out</button>
    </div>
  </div>`
}

function renderUserPill(user){
  const pill = document.getElementById("userPill")
  const av   = document.getElementById("pillAv")
  const label = user.displayName || user.email || ""
  document.getElementById("pillName").textContent = label.split(" ")[0]
  const init = label.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)
  if(user.photoURL){
    // no-referrer: Google avatar URLs 403 when sent a referrer; fall back to initials
    av.innerHTML = `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" />`
    av.querySelector("img").onerror = () => { av.innerHTML = `<div class="user-pill-fb">${esc(init)}</div>` }
  }else{
    av.innerHTML = `<div class="user-pill-fb">${esc(init)}</div>`
  }
  pill.classList.add("visible")
  document.getElementById("dropdownName").textContent  = user.displayName || user.email
  document.getElementById("dropdownEmail").textContent = user.email
}

/**
 * Injects the shared chrome and resolves with the signed-in user.
 * Never resolves when signed out — the page is redirected to the login
 * screen instead, so callers can treat the resolved user as guaranteed.
 */
export function initShell({ title="TAS Tools", active="hub" } = {}){
  document.body.insertAdjacentHTML("afterbegin", orbsHTML())
  const wrap = document.getElementById("appWrap")
  wrap.insertAdjacentHTML("afterbegin", topbarHTML(title,active))

  document.getElementById("userPill").onclick = e => {
    e.stopPropagation()
    document.getElementById("userDropdown").classList.toggle("open")
  }
  document.addEventListener("click", () =>
    document.getElementById("userDropdown")?.classList.remove("open"))
  document.getElementById("signOutBtn").onclick = async () => {
    await signOut(auth)
    window.location.href = LOGIN_URL
  }
  paintIcons()

  return new Promise(resolve => {
    onAuthStateChanged(auth, user => {
      if(!user){ window.location.href = LOGIN_URL; return }
      document.getElementById("authGate").style.display = "none"
      wrap.style.display = "block"
      renderUserPill(user)
      resolve(user)
    })
  })
}
