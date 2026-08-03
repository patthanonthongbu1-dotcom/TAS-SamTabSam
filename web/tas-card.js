/* ─────────────────────────────────────────────────────────────
   Daily homework card — shared renderer.

   Takes the announcement shape that announce.html already builds and
   stores as a draft:

     { date: "2026-06-15", reporter: "Non",
       links: { classroom: true, calendar: true },
       sections: [ { icon, title, subjects: [
           { icon, title, note, bullets: [ { text, … } ] } ] } ] }

   …and paints the flex-card layout as real DOM, which html-to-image
   then rasterises. Used by announce.html ("Download card image") and
   by tools-card.html, so the image is identical from either page.
   ───────────────────────────────────────────────────────────── */

export const CARD_WIDTH = 360          // CSS px; exported at pixelRatio 3
export const DRAFT_KEY  = "tas_fmt_draft_v4"   // written by announce.html

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                     "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]

export function thaiDate(dateStr){
  if(!dateStr) return ""
  const d = new Date(dateStr + "T00:00:00")
  if(isNaN(d)) return ""
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))
}

/** Reads the announce-page draft. Returns null when nothing is saved. */
export function loadDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  }catch(e){ return null }
}

/** True when there's at least one subject or bullet worth rendering. */
export function hasContent(data){
  if(!data || !Array.isArray(data.sections)) return false
  return data.sections.some(sec =>
    (sec.subjects || []).some(su =>
      (su.title || "").trim() || (su.bullets || []).some(b => (b.text || "").trim())))
}

const CSS = `
.tc-root{
  width:${CARD_WIDTH}px;
  font-family:'Kanit',sans-serif;
  border-radius:16px;overflow:hidden;background:#ffffff;color:#1a1a1a;
  box-shadow:0 18px 40px -18px rgba(0,0,0,0.55);
}
/* ── Header banner ── */
.tc-hero{
  position:relative;padding:17px 18px 15px;
  background:linear-gradient(135deg,#1b3a72 0%,#16305e 45%,#0b1c3d 100%);
  display:flex;align-items:center;gap:13px;overflow:hidden;
}
/* Faint circuit arcs, same idea as the panel texture on index.html */
.tc-hero-deco{
  position:absolute;inset:0;opacity:0.5;
  background-image:radial-gradient(circle at 88% 22%,rgba(255,255,255,0.16) 0 1.5px,transparent 1.6px),
                   radial-gradient(circle at 94% 66%,rgba(255,255,255,0.12) 0 1.5px,transparent 1.6px),
                   radial-gradient(circle at 74% 82%,rgba(255,255,255,0.10) 0 1.5px,transparent 1.6px),
                   radial-gradient(circle at 12% 78%,rgba(255,79,163,0.20) 0 2px,transparent 2.1px);
}
.tc-hero-ico{
  position:relative;width:42px;height:42px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  border-radius:11px;background:rgba(255,255,255,0.10);
  border:1px solid rgba(255,255,255,0.18);
}
.tc-hero-text{position:relative;flex:1;min-width:0}
.tc-hero-title{font-size:16px;font-weight:600;color:#ffffff;letter-spacing:0.01em;line-height:1.25}
.tc-hero-sub{
  font-size:8.5px;font-weight:700;color:#ff86c0;
  letter-spacing:0.42em;text-transform:uppercase;margin-top:3px;
}
.tc-hero-logo{position:relative;width:38px;height:38px;object-fit:contain;flex-shrink:0}

/* ── Body ── */
.tc-body{padding:16px 18px 14px;background:#ffffff}
.tc-date{font-size:20px;font-weight:600;letter-spacing:-0.2px;line-height:1.25}
.tc-reporter{
  display:flex;align-items:center;gap:6px;margin-top:7px;
  font-size:12.5px;font-weight:400;color:#4a5568;
}
.tc-hr{height:1px;background:#e8ecef;margin:13px 0}

.tc-section{margin-top:13px}
.tc-section:first-child{margin-top:0}
.tc-section-head{
  display:flex;align-items:center;gap:7px;
  font-size:13.5px;font-weight:600;color:#d92d5e;margin-bottom:9px;
}
.tc-subject{margin-top:10px}
.tc-subject:first-child{margin-top:0}
.tc-subject-head{
  display:flex;align-items:baseline;gap:5px;
  font-size:13px;font-weight:600;color:#16305e;line-height:1.45;
}
.tc-num{flex-shrink:0;color:#16305e}
.tc-bullets{margin-top:3px;padding-left:2px}
.tc-bullet{
  font-size:12px;font-weight:300;color:#2d3748;line-height:1.62;
  display:flex;gap:6px;
}
.tc-bullet .tc-dash{flex-shrink:0;color:#8fa0b3}
.tc-note{
  margin-top:5px;font-size:11.5px;font-weight:400;color:#a3690b;
  background:#fff8e6;border:1px solid #ffe2a8;border-radius:8px;
  padding:6px 9px;line-height:1.55;display:flex;gap:6px;
}
.tc-empty{font-size:12px;font-weight:300;color:#94a3b8;font-style:italic;padding:6px 0}
`

const ICO = {
  book: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5S9.5 4.5 4 4.5v13c5.5 0 8 2 8 2s2.5-2 8-2v-13c-5.5 0-8 2-8 2Z"/><path d="M12 6.5v15"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>`,
  pin:  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-7"/><path d="M8 3h8l-1 6 3 3H6l3-3-1-6Z"/></svg>`,
}

/**
 * Builds the card markup for the given announcement data.
 * Section and subject icons stay as the emoji picked on the announce
 * page — those are the author's choice and carry meaning, unlike the
 * app's own chrome icons.
 */
export function cardHTML(data){
  const date     = thaiDate(data.date)
  const reporter = (data.reporter || "").trim()
  // data.links is intentionally unused — the card carries no link buttons.
  // The Classroom/Calendar chips still apply to the text and Discord output.

  const sections = (data.sections || []).map(sec => {
    const subjects = (sec.subjects || []).filter(su =>
      (su.title || "").trim() || (su.bullets || []).some(b => (b.text || "").trim()))

    if(!subjects.length) return ""

    const body = subjects.map((su, i) => {
      const bullets = (su.bullets || [])
        .filter(b => (b.text || "").trim())
        .map(b => `<div class="tc-bullet"><span class="tc-dash">-</span><span>${esc(b.text.trim())}</span></div>`)
        .join("")
      const note = (su.note || "").trim()
        ? `<div class="tc-note">${ICO.pin}<span>${esc(su.note.trim())}</span></div>` : ""
      return `<div class="tc-subject">
        <div class="tc-subject-head">
          <span class="tc-num">${i+1}.</span>
          <span>${esc(su.icon || "")} ${esc((su.title || "").trim())}</span>
        </div>
        ${bullets ? `<div class="tc-bullets">${bullets}</div>` : ""}
        ${note}
      </div>`
    }).join("")

    const title = (sec.title || "").trim()
    return `<div class="tc-section">
      ${title ? `<div class="tc-section-head">${esc(sec.icon || "")} ${esc(title)}</div>` : ""}
      ${body}
    </div>`
  }).join("")

  return `<div class="tc-root">
    <div class="tc-hero">
      <div class="tc-hero-deco"></div>
      <div class="tc-hero-ico">${ICO.book}</div>
      <div class="tc-hero-text">
        <div class="tc-hero-title">การบ้านประจำวัน</div>
        <div class="tc-hero-sub">Homework</div>
      </div>
      <img class="tc-hero-logo" src="TASLogoLIGHT.png" alt="">
    </div>
    <div class="tc-body">
      ${date ? `<div class="tc-date">${esc(date)}</div>` : ""}
      ${reporter ? `<div class="tc-reporter">${ICO.user}<span>${esc(reporter)}</span></div>` : ""}
      <div class="tc-hr"></div>
      ${sections || `<div class="tc-empty">— nothing to show yet —</div>`}
    </div>
  </div>`
}

/** Injects the card stylesheet once per document. */
export function ensureCardStyles(doc = document){
  if(doc.getElementById("tasCardStyles")) return
  const el = doc.createElement("style")
  el.id = "tasCardStyles"
  el.textContent = CSS
  doc.head.appendChild(el)
}

/** Renders the card into a container element. */
export function mountCard(container, data){
  ensureCardStyles(container.ownerDocument || document)
  container.innerHTML = cardHTML(data)
  return container.firstElementChild
}

/* ── Font embedding ───────────────────────────────────────────
   The card is Thai text in Kanit. html-to-image can't inline the
   Google Fonts stylesheet itself (cross-origin), and skipping fonts
   would fall back to whatever Thai face the OS happens to have — so
   the exported image wouldn't match the preview. We fetch the CSS and
   the woff2 files ourselves (both send CORS headers) and hand the
   result to html-to-image as fontEmbedCSS. Cached per page load. */
const FONT_CSS_URL = "https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap"
let fontCSSPromise = null

export function embeddedFontCSS(){
  if(fontCSSPromise) return fontCSSPromise
  fontCSSPromise = (async () => {
    const res = await fetch(FONT_CSS_URL)
    if(!res.ok) throw new Error("font css " + res.status)
    let css = await res.text()
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]))]
    const pairs = await Promise.all(urls.map(async u => {
      const r = await fetch(u)
      if(!r.ok) throw new Error("font file " + r.status)
      const buf = new Uint8Array(await r.arrayBuffer())
      let bin = ""
      // Chunked so a large font doesn't blow the argument limit of apply()
      for(let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192))
      return [u, `data:font/woff2;base64,${btoa(bin)}`]
    }))
    for(const [u, uri] of pairs) css = css.split(u).join(uri)
    return css
  })().catch(e => {
    console.warn("Could not embed Kanit for export:", e)
    return ""   // fall back to system fonts rather than failing the export
  })
  return fontCSSPromise
}
