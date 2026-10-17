/* ─────────────────────────────────────────────────────────────
   TAS — which theme, decided before first paint.

   Loaded as a plain blocking <script> in <head> by every themed page,
   so html[data-theme] is right before anything is drawn and nothing
   flashes. It replaces the one-liner each page used to copy.

   The choice saved in tas_theme:
     sky    — the default. Calm white and soft blue, after DESIGN.md.
              Follows the device: "sky" in light mode, "sky-dark" in
              dark, and switches live when the device does.
     dark   — Legacy: the navy and pink glass that came before.
     light  — Classic, green on white.
     paper  — Papercraft.

   "sky" is built on the light theme the way paper is (every light rule
   is written :is(light, paper, sky)); "sky-dark" is built on the dark
   base, which is what the unthemed CSS already draws.
   ───────────────────────────────────────────────────────────── */
(function () {
  var KEY = "tas_theme"
  // Every page that ever opened the calendar has "dark" saved, because the
  // old setTheme wrote the default back on load. So the new default would
  // reach no one: move "dark" (and nothing) to sky once. Legacy is still
  // one tap away in Settings, and a pick made after this sticks.
  var MIGRATED = "tas_theme_sky"
  var CHOICES = ["sky", "dark", "light", "paper"]
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null

  function stored() {
    var t = null
    try {
      t = localStorage.getItem(KEY)
      if (!localStorage.getItem(MIGRATED)) {
        if (!t || t === "dark") { t = "sky"; localStorage.setItem(KEY, t) }
        localStorage.setItem(MIGRATED, "1")
      }
    } catch (e) {}
    return CHOICES.indexOf(t) === -1 ? "sky" : t
  }

  // The attribute the CSS keys on, which for sky depends on the device.
  function resolve(choice) {
    return choice === "sky" && mq && mq.matches ? "sky-dark" : choice
  }

  var choice = stored()
  // The browser's own bar (Android, installed app) matches the page top.
  var BAR = { sky: "#f8fbff", "sky-dark": "#0b1530", dark: "#0b1c3d", light: "#f4f6f4", paper: "#c5dccf" }
  function apply() {
    var t = resolve(choice)
    document.documentElement.dataset.theme = t
    document.documentElement.style.colorScheme = window.tasIsDark() ? "dark" : "light"
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute("content", BAR[t] || BAR.dark)
  }

  window.tasThemeChoice = function () { return choice }
  // Dark surfaces take the light-on-dark logo: Legacy and sky's dark mode.
  window.tasIsDark = function () {
    var t = document.documentElement.dataset.theme
    return t === "dark" || t === "sky-dark"
  }
  // Saves the pick and applies it. Pages wrap it to update their own chrome.
  window.tasApplyTheme = function (t) {
    choice = CHOICES.indexOf(t) === -1 ? "sky" : t
    try { localStorage.setItem(KEY, choice) } catch (e) {}
    apply()
    document.dispatchEvent(new CustomEvent("tas-theme"))
  }
  if (mq) {
    var onChange = function () {
      if (choice !== "sky") return
      apply()
      document.dispatchEvent(new CustomEvent("tas-theme"))
    }
    if (mq.addEventListener) mq.addEventListener("change", onChange)
    else if (mq.addListener) mq.addListener(onChange)
  }
  apply()
})()
