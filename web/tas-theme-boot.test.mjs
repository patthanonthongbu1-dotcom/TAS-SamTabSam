import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const SRC = readFileSync(new URL("./tas-theme-boot.js", import.meta.url), "utf8")

// Runs the boot script on a fresh page: saved storage, device dark or not.
function boot(saved = {}, deviceDark = false) {
  const store = new Map(Object.entries(saved))
  const listeners = []
  const meta = { content: "", setAttribute(k, v) { this[k] = v } }
  const html = { dataset: {}, style: {} }
  const win = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    matchMedia: () => ({ matches: deviceDark, addEventListener: (_, fn) => listeners.push(fn) }),
    document: {
      documentElement: html,
      querySelector: () => meta,
      dispatchEvent: () => {}
    },
    CustomEvent: class { constructor(t) { this.type = t } }
  }
  win.window = win
  vm.runInNewContext(SRC, win)
  return { theme: () => html.dataset.theme, store, win, meta, flip: dark => { win.matchMedia = () => ({ matches: dark }); deviceDark = dark } }
}

test("a first visit gets sky", () => {
  const p = boot()
  assert.equal(p.theme(), "sky")
  assert.equal(p.store.get("tas_theme"), "sky")
})

test("a saved 'dark' from before moves to sky, once", () => {
  assert.equal(boot({ tas_theme: "dark" }).theme(), "sky")
})

test("Legacy picked after the move stays Legacy", () => {
  assert.equal(boot({ tas_theme: "dark", tas_theme_sky: "1" }).theme(), "dark")
})

test("light and paper choices survive the move", () => {
  assert.equal(boot({ tas_theme: "light" }).theme(), "light")
  assert.equal(boot({ tas_theme: "paper" }).theme(), "paper")
})

test("sky follows a dark device", () => {
  const p = boot({}, true)
  assert.equal(p.theme(), "sky-dark")
  assert.equal(p.win.tasIsDark(), true)
  assert.equal(p.win.tasThemeChoice(), "sky")   // the choice, not the resolved attribute
  assert.equal(p.meta.content, "#0b1530")
})

test("a pick is saved and applied, junk falls back to sky", () => {
  const p = boot()
  p.win.tasApplyTheme("paper")
  assert.equal(p.theme(), "paper")
  assert.equal(p.store.get("tas_theme"), "paper")
  p.win.tasApplyTheme("neon")
  assert.equal(p.theme(), "sky")
  assert.equal(boot({ tas_theme: "neon", tas_theme_sky: "1" }).theme(), "sky")
})

test("storage that throws still paints sky", () => {
  const html = { dataset: {}, style: {} }
  const broken = { getItem() { throw new Error("blocked") }, setItem() { throw new Error("blocked") } }
  const win = { localStorage: broken, document: { documentElement: html, querySelector: () => null, dispatchEvent() {} }, CustomEvent: class {} }
  win.window = win
  vm.runInNewContext(SRC, win)
  assert.equal(html.dataset.theme, "sky")
})
