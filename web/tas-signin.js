// ── Sign-in, where you are ─────────────────────────────────────────────
// Every page used to answer "you need an account" by throwing the reader
// at index.html. That loses the thing they were doing, and on the calendar
// — which reads fine signed out — it was answering a question nobody had
// asked. So the prompt comes to them instead: a sheet over the page, one
// button, and the page carries on afterwards.
//
// Self-contained on purpose. It injects its own styles rather than asking
// six stylesheets to agree, and it holds no Firebase app of its own — each
// page passes the `auth` it already built.

import { GoogleAuthProvider, signInWithPopup }
  from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"

const provider = new GoogleAuthProvider()
// Always offer the account chooser. Shared machines are the norm here and
// a silent reuse of whoever signed in last is the wrong default.
provider.setCustomParameters({ prompt: "select_account" })

let el = null          // the overlay, built once and reused
let openResolve = null // resolves the promise the caller is awaiting

const CSS = `
.signin-ovl{
  position:fixed; inset:0; z-index:4000;
  display:none; align-items:center; justify-content:center;
  padding:20px; background:rgba(6,12,26,0.62);
  -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px);
  opacity:0; transition:opacity .18s ease;
  font-family:'Kanit','Prompt',system-ui,-apple-system,'Segoe UI',sans-serif;
}
.signin-ovl.open{display:flex; opacity:1}
.signin-card{
  width:100%; max-width:380px; border-radius:20px; padding:26px 24px 22px;
  background:#16233d; border:1px solid rgba(255,255,255,0.12);
  box-shadow:0 30px 70px -20px rgba(0,0,0,0.7);
  color:#fff; text-align:center;
  transform:translateY(10px) scale(.98); transition:transform .2s ease;
}
.signin-ovl.open .signin-card{transform:none}
html[data-theme="light"] .signin-card{background:#fff; color:#16233d; border-color:rgba(0,0,0,0.1)}
.signin-logo{width:46px;height:46px;object-fit:contain;margin:0 auto 12px;display:block}
.signin-title{font-size:19px; font-weight:600; margin-bottom:6px}
.signin-why{font-size:14px; font-weight:300; line-height:1.6; opacity:.72; margin-bottom:20px}
.signin-go{
  width:100%; display:flex; align-items:center; justify-content:center; gap:10px;
  padding:12px; border-radius:11px; border:0; cursor:pointer;
  background:#fff; color:#3c4043; font-size:15px; font-weight:600; font-family:inherit;
}
.signin-go:disabled{opacity:.6; cursor:default}
html[data-theme="light"] .signin-go{background:#1D9E75; color:#fff}
.signin-go svg{width:18px;height:18px;flex-shrink:0}
html[data-theme="light"] .signin-go svg{display:none}
.signin-cancel{
  margin-top:12px; width:100%; padding:9px; border-radius:10px; cursor:pointer;
  background:none; border:0; color:inherit; opacity:.6;
  font-size:13.5px; font-weight:300; font-family:inherit;
}
.signin-cancel:hover{opacity:.9}
.signin-err{margin-top:12px; font-size:13px; font-weight:300; color:#ff9b8a; display:none}
.signin-err.show{display:block}
@media (prefers-reduced-motion:reduce){ .signin-ovl,.signin-card{transition:none} }
`

// Google's mark, inline — one fewer request, and it can't 404.
const G = `<svg viewBox="0 0 48 48" aria-hidden="true">
<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4H24v7.5h12.7c-.3 2.1-1.6 5.3-4.7 7.4l7.6 5.9c4.5-4.2 6.5-10.3 6.5-16.8z"/>
<path fill="#FBBC05" d="M10.4 28.7a14.7 14.7 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z"/>
<path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.7 2.4-6.3 0-11.7-3.7-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`

function build(){
  if (el) return el

  const style = document.createElement("style")
  style.textContent = CSS
  document.head.appendChild(style)

  el = document.createElement("div")
  el.className = "signin-ovl"
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-modal", "true")
  el.innerHTML =
    '<div class="signin-card">' +
      '<img class="signin-logo" src="TASLogoLIGHT.png" alt="">' +
      '<div class="signin-title">Sign in to TAS</div>' +
      '<div class="signin-why" id="signinWhy"></div>' +
      '<button class="signin-go" id="signinGo">' + G + '<span>Continue with Google</span></button>' +
      '<div class="signin-err" id="signinErr"></div>' +
      '<button class="signin-cancel" id="signinCancel">Not now</button>' +
    '</div>'
  document.body.appendChild(el)

  // Clicking the backdrop is a cancel; clicking the card is not.
  el.addEventListener("click", e => { if (e.target === el) close(false) })
  el.querySelector("#signinCancel").onclick = () => close(false)
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && el.classList.contains("open")) close(false)
  })
  return el
}

function close(result){
  if (!el) return
  el.classList.remove("open")
  setTimeout(() => { if (el && !el.classList.contains("open")) el.style.display = "" }, 200)
  const r = openResolve
  openResolve = null
  if (r) r(result)
}

/**
 * Ask for an account, in place.
 *
 * @param auth            the page's Firebase auth instance
 * @param reason          "tick tasks off" → "Sign in to tick tasks off."
 * @param cancelLabel     text for the dismiss button
 * @param onCancel        called instead of resolving, when dismissed
 * @returns Promise<boolean> — true once signed in
 *
 * The caller does not have to do anything with a `true`: every page is
 * already listening on onAuthStateChanged, and that fires on its own.
 */
export function promptSignIn(auth, { reason, cancelLabel, onCancel } = {}){
  build()
  // A second ask while one is open just returns the first one's answer.
  if (openResolve) return new Promise(res => { const p = openResolve; openResolve = v => { p(v); res(v) } })

  el.querySelector("#signinWhy").textContent = reason
    ? "Sign in to " + reason + "."
    : "This needs an account."
  el.querySelector("#signinCancel").textContent = cancelLabel || "Not now"
  const err = el.querySelector("#signinErr")
  const go  = el.querySelector("#signinGo")
  err.classList.remove("show")
  go.disabled = false

  go.onclick = async () => {
    go.disabled = true
    err.classList.remove("show")
    try {
      await signInWithPopup(auth, provider)
      close(true)
    } catch (e) {
      go.disabled = false
      // Closing the Google window is a decision, not a failure.
      if (e && e.code === "auth/popup-closed-by-user") return
      if (e && e.code === "auth/popup-blocked"){
        err.textContent = "Your browser blocked the popup — allow popups for this site and try again."
      } else {
        err.textContent = "Couldn't sign in: " + ((e && e.message) || "unknown error")
      }
      err.classList.add("show")
    }
  }

  el.style.display = "flex"
  requestAnimationFrame(() => el.classList.add("open"))
  setTimeout(() => go.focus(), 60)

  return new Promise(res => {
    openResolve = v => { if (!v && onCancel) onCancel(); res(v) }
  })
}

export function closeSignIn(){ close(false) }
