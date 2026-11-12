import { sendLabel, LINE_SIZES, DUE_KINDS } from "./tas-hwcard.js"
/* ─────────────────────────────────────────────────────────────
   Homework card painter + font-safe PNG export. The model comes from
   tas-hwcard.js; calendar.html and announce.html both paint it here.
   ───────────────────────────────────────────────────────────── */

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

const ICO = {
  bell: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>`,
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

/* ── Homework card, design A ──────────────────────────────────
   Paints a model from tas-hwcard.js (cardModel). Laid out at 540 CSS px
   and exported at pixelRatio 3, so the PNG is 1620 px wide — sharp
   even after chat apps recompress it. The header is the class banner itself (same image the
   Discord embed uses), kept local so html-to-image can read it. Below it,
   the old card's shape: date, name, then sections with numbered rows. */
export const HW_WIDTH = 540
const PILL = { red: ["#fee2e2","#b91c1c"], orange: ["#ffedd5","#c2410c"], grey: ["#eef2f6","#475569"], violet: ["#ede9fe","#6d28d9"] }

/* The picker emoji, drawn. Emoji look different on every phone (Windows
   shows some as letters), so the card draws its own line icons in the
   subject's colour. Anything not here falls back to the emoji as text. */
const svg = d => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
export const ICONS = {
  "📢": svg(`<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1Z"/><path d="M17 8.5a5 5 0 0 1 0 7"/><path d="M19.5 6a8.5 8.5 0 0 1 0 12"/>`),
  "📚": svg(`<rect x="3.5" y="4" width="4.5" height="16" rx="1"/><rect x="8" y="4" width="4.5" height="16" rx="1"/><path d="m13.5 5.2 4.3-1.1 3.7 14.6-4.3 1.1Z"/>`),
  "💻": svg(`<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>`),
  "🎨": svg(`<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>`),
  "🔬": svg(`<path d="M9 3h6"/><path d="M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.2 15h9.6"/>`),
  "🏫": svg(`<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5"/><path d="M12 5V2.5h3"/>`),
  "📌": svg(`<path d="M12 21v-7"/><path d="M8 3h8l-1 6 3 3H6l3-3-1-6Z"/>`),
  "🗓": svg(`<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`),
  "📝": svg(`<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 17h5"/>`),
  "🏃": svg(`<circle cx="14.5" cy="4.5" r="1.8"/><path d="M6 11.5 9 8.5l4 .8 2.2 3 3.3 1"/><path d="m12.8 9.4-2.3 5.8 3.5 2.3.8 3.5"/><path d="m10.5 15.2-2.3 5.3"/>`),
  "🎵": svg(`<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`),
  "📐": svg(`<path d="M4 20V4l16 16Z"/><path d="M8 16v-4.5l4.5 4.5Z"/>`),
  "✏": svg(`<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/><path d="m14.5 5.5 3 3"/>`),
}
const SEND_ICO = svg(`<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>`)
// The drawn icon for a picker emoji ("" when there isn't one) — the
// formatter's own dropdowns use these too.
export const iconSVG = e => ICONS[String(e || "").replace(/️/g, "").trim()] || ""
const iconHTML = e => {
  const key = String(e || "").replace(/️/g, "").trim()
  if(!key) return ""
  return ICONS[key] ? `<span class="hw-ico">${ICONS[key]}</span>` : `<span class="hw-emo">${esc(e)}</span>`
}

const HW_CSS = `
.hw{width:${HW_WIDTH}px;font-family:'Kanit',sans-serif;background:#f6f8fb;color:#0f1d3a;line-height:1.35;overflow:hidden;border-radius:26px}
.hw *{box-sizing:border-box}
.hw-banner{display:block;width:100%;height:auto}
.hw-date{padding:18px 24px 16px;background:#fff;border-bottom:1px solid #e6ebf2}
.hw-wd{font-size:14px;font-weight:500;color:#db2777;line-height:1.4}
.hw-big{font-size:30px;font-weight:600;line-height:1.3;letter-spacing:-0.3px}
.hw-name{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:16px;color:#4a5568;line-height:1.4}
.hw-name svg{width:18px;height:18px;flex-shrink:0}
.hw-list{padding:6px 18px 6px}
.hw-sec{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.hw-sec-head{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:600;color:#d92d5e;line-height:1.4;padding:2px 2px 0}
.hw-sec-head .hw-ico{width:20px;height:20px}
.hw-row{display:flex;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,29,58,.06),0 0 0 1px #e8edf3}
.hw-strip{width:6px;flex-shrink:0}
.hw-main{flex:1;min-width:0;padding:11px 14px 12px}
.hw-head{display:flex;align-items:flex-start;gap:10px}
.hw-subj{flex:1;min-width:0;display:flex;align-items:flex-start;gap:7px;font-size:17px;font-weight:600;line-height:1.35}
.hw-num{flex-shrink:0;color:#16305e;font-variant-numeric:tabular-nums}
.hw-ico{display:inline-flex;width:19px;height:19px;flex-shrink:0;margin-top:2px}
.hw-emo{flex-shrink:0}
.hw-subj-t{min-width:0;overflow-wrap:anywhere}
.hw-code{display:inline-block;font-size:12px;font-weight:600;line-height:1.3;padding:2px 8px;border-radius:99px;margin-left:7px;white-space:nowrap;vertical-align:2px;font-variant-numeric:tabular-nums}
.hw-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:5px;font-size:13px;color:#64748b;line-height:1.35}
.hw-meta>span{display:inline-flex;align-items:center;gap:5px}
.hw-meta svg{width:14px;height:14px;flex-shrink:0}
.hw-send{color:#1d4ed8;font-weight:500}
.hw-pill{flex-shrink:0;font-size:12.5px;font-weight:600;line-height:1.35;padding:3px 11px;border-radius:99px;white-space:nowrap;margin-top:1px}
.hw-lines{margin-top:8px;color:#1e293b;line-height:1.4;display:flex;flex-direction:column;gap:6px}
.hw-lines *{overflow-wrap:anywhere}
.hw-pills{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.hw-chip{padding:.25em .65em;border-radius:8px;background:#f1f5f9;max-width:100%}
.hw-lg{padding:.45em .8em;border-radius:12px;font-weight:500}
.hw-bul{display:flex;gap:.55em}
.hw-bul::before{content:"";flex-shrink:0;width:.42em;height:.42em;border-radius:50%;margin-top:.52em;background:var(--c)}
.hw-photos{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hw-photo{display:block;border-radius:8px;border:1px solid #e2e8f0;min-width:0}
.hw-more{text-align:center;font-size:13.5px;color:#64748b;padding:10px 0 0}
.hw-empty{text-align:center;padding:30px 0 26px;font-size:19px;font-weight:500;color:#64748b}
.hw-empty .hw-ico{display:flex;width:40px;height:40px;margin:0 auto 6px;color:#16a34a}
.hw-foot{height:18px}
.hw-ft{display:grid;grid-template-columns:minmax(0,1fr) 108px;gap:14px;margin:20px 18px 0;padding:14px 0 16px;border-top:1px solid #e2e8f0;align-items:start}
.hw-rem{margin-top:0;min-width:0;gap:6px}
.hw-ft .hw-sec-head{font-size:13.5px;gap:6px;padding:0 2px}
.hw-ft .hw-sec-head .hw-ico{width:15px;height:15px;margin-top:0}
.hw-sec-head .hw-ico svg{width:100%;height:100%}
.hw-ft .hw-row{border-radius:10px}
.hw-ft .hw-strip{width:4px}
.hw-ft .hw-main{padding:6px 9px 7px}
.hw-ft .hw-head{gap:6px}
.hw-ft .hw-subj{font-size:12px;gap:5px}
.hw-ft .hw-ico{width:13px;height:13px;margin-top:1px}
.hw-ft .hw-code{font-size:9px;padding:0 5px;margin-left:4px;vertical-align:1px}
.hw-ft .hw-pill{font-size:9.5px;padding:1px 7px;margin-top:0}
.hw-ft .hw-meta{font-size:10px;margin-top:1px;gap:3px 8px}
.hw-ft .hw-meta svg{width:10px;height:10px}
.hw-ft .hw-lines{margin-top:4px;gap:4px}
.hw-ft .hw-chip{font-size:11px !important;border-radius:6px}
.hw-rem-more{font-size:10.5px;color:#64748b;padding:0 2px}
.hw-qr{grid-column:2;display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding-top:2px;min-width:0}
.hw-qr-code{width:68px;height:68px}
.hw-qr-code svg{display:block;width:100%;height:100%}
.hw-qr-t{margin-top:2px;font-size:11.5px;font-weight:600;color:#0f1d3a;line-height:1.25;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.hw-qr-t svg{width:11px;height:11px}
.hw-qr-d{font-size:9.5px;color:#64748b;line-height:1.35}
.hw-qr-u{font-size:9px;font-weight:500;color:#16305e;padding:1px 7px;border-radius:99px;background:#e8edf6;white-space:nowrap}
.hw-ft-solo{display:flex;align-items:center;gap:14px;margin:22px 18px 16px;padding:10px 12px 10px 14px;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,29,58,.06),0 0 0 1px #e8edf3}
.hw-solo-txt{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px}
.hw-ft-solo .hw-qr-t{margin:0}
.hw-ft-solo .hw-qr-d{text-align:left}
.hw-ft-solo .hw-qr-u{margin-top:2px}
.hw-ft-solo .hw-qr-code{width:56px;height:56px;flex-shrink:0}
`

// A row's lines, each in its own style and size. Neighbouring pills
// share one wrapping row; every other style is a line of its own.
function linesHTML(r, c){
  if(!r.lines.length) return ""
  const out = []
  for(const l of r.lines){
    const fs = `font-size:${LINE_SIZES[l.size] || LINE_SIZES.m}px`
    if(l.style === "pills"){
      const chip = `<span class="hw-chip" style="${fs}">${esc(l.text)}</span>`
      if(out.at(-1)?.pills) out.at(-1).html.push(chip)
      else out.push({ pills: true, html: [chip] })
      continue
    }
    out.push({ html: [l.style === "big"
      ? `<div class="hw-lg" style="${fs};background:${c}1a;color:${c}">${esc(l.text)}</div>`
      : `<div class="hw-${l.style === "bullets" ? "bul" : "plain"}" style="${fs}">${esc(l.text)}</div>`] })
  }
  return `<div class="hw-lines" style="--c:${c}">${out.map(g => g.pills ? `<div class="hw-pills">${g.html.join("")}</div>` : g.html[0]).join("")}</div>`
}

// One numbered row: the main list and the footer reminders both paint with it
const pillHTML = p => p ? `<span class="hw-pill" style="background:${PILL[p.tone][0]};color:${PILL[p.tone][1]}">${esc(p.label)}</span>` : ""
const colorOf = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#64748b"
function rowHTML(r){ return  `<div class="hw-row">
      <div class="hw-strip" style="background:${colorOf(r.color)}"></div>
      <div class="hw-main">
        <div class="hw-head">
          <div class="hw-subj" style="color:#0f1d3a"><span class="hw-num">${r.n}.</span><span style="color:${colorOf(r.color)};display:contents">${iconHTML(r.icon)}</span><span class="hw-subj-t">${esc(r.subject || "")}${r.code ? `<span class="hw-code" style="background:${colorOf(r.color)}1a;color:${colorOf(r.color)}">${esc(r.code)}</span>` : ""}</span></div>
          ${pillHTML(r.pill)}
        </div>
        ${r.teacher || sendLabel(r.send) ? `<div class="hw-meta">${r.teacher ? `<span>${ICO.user}${esc(r.teacher)}</span>` : ""}${sendLabel(r.send) ? `<span class="hw-send">${SEND_ICO}${esc(sendLabel(r.send))}</span>` : ""}</div>` : ""}
        ${linesHTML(r, colorOf(r.color))}
        ${(r.photos || []).length ? `<div class="hw-photos">${r.photos.map(ph =>
          `<img class="hw-photo" src="${esc(ph.src)}" alt="" style="width:calc(${Math.min(100, Math.max(10, Number(ph.size) || 100))}% - 4px)">`).join("")}</div>` : ""}
      </div>
    </div>` }

export function hwCardHTML(m){
  const sections = m.sections.map(s => `<div class="hw-sec">
      ${s.title ? `<div class="hw-sec-head">${iconHTML(s.icon)}<span>${esc(s.title)}</span></div>` : ""}
      ${s.rows.map(rowHTML).join("")}
    </div>`).join("")
  return `<div class="hw">
    <img class="hw-banner" src="img/hw-banner.png" alt="การบ้านประจำวัน HOMEWORK">
    <div class="hw-date">
      <div class="hw-wd">วัน${esc(m.weekday)}</div>
      <div class="hw-big">${esc(thaiDate(m.date))}</div>
      ${m.name ? `<div class="hw-name">${ICO.user}<span>${esc(m.name)}</span></div>` : ""}
    </div>
    <div class="hw-list">
      ${sections || `<div class="hw-empty"><span class="hw-ico">${svg(`<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>`)}</span>ไม่มีการบ้านวันนี้</div>`}
      ${m.more > 0 ? `<div class="hw-more">+${m.more} รายการ</div>` : ""}
    </div>
    ${footerHTML(m.footer)}
  </div>`
}

// Footer: "due tomorrow" reminders on the left 60%, the TAS QR on the right 40%
function footerHTML(f){
  if(!f) return `<div class="hw-foot"></div>`
  const rem = f.reminders.length ? `<div class="hw-sec hw-rem">
      <div class="hw-sec-head"><span class="hw-ico">${ICO.bell}</span><span>${esc(f.title || "Due tomorrow")}</span></div>
      ${f.reminders.map(rowHTML).join("")}
      ${f.moreReminders > 0 ? `<div class="hw-rem-more">+${f.moreReminders} more on the calendar</div>` : ""}
    </div>` : ""
  const qr = f.qr ? `<div class="hw-qr">
      <div class="hw-qr-code">${f.qr.svg}</div>
      <div class="hw-qr-t">${ICO.scan}Scan to view</div>
      <div class="hw-qr-d">All homework on<br>the TAS calendar</div>
      ${f.qr.url ? `<div class="hw-qr-u">${esc(f.qr.url.replace(/^https?:\/\/|\/.*$/g, ""))}</div>` : ""}
    </div>` : ""
  // Nothing due tomorrow: a slim strip, words left and the QR right
  if(!rem && f.qr) return `<div class="hw-ft-solo">
      <div class="hw-solo-txt">
        <div class="hw-qr-t">${ICO.scan}Scan to view</div>
        <div class="hw-qr-d">All homework &amp; deadlines on the TAS calendar</div>
        ${f.qr.url ? `<div class="hw-qr-u">${esc(f.qr.url.replace(/^https?:\/\/|\/.*$/g, ""))}</div>` : ""}
      </div>
      <div class="hw-qr-code">${f.qr.svg}</div>
    </div>`
  return `<div class="hw-ft">${rem}${qr}</div>`
}

export function mountHwCard(container, model){
  const doc = container.ownerDocument || document
  if(!doc.getElementById("tasHwStyles")){
    const el = doc.createElement("style"); el.id = "tasHwStyles"; el.textContent = HW_CSS; doc.head.appendChild(el)
  }
  container.innerHTML = hwCardHTML(model)
  return container.firstElementChild
}

/* Font-safe export. The first html-to-image pass on a page often comes out
   in a fallback face — Kanit and the banner aren't decoded yet when it
   clones the node. So: wait for the fonts and every image in the card,
   run one throwaway pass, then the real one. toBlob is passed in so this
   file stays importable without a bundler. */
let warmed = false
export async function exportHwCard(node, toBlob){
  const fonts = node.ownerDocument.fonts
  if(fonts){
    await Promise.all(["400 16px Kanit", "500 16px Kanit", "600 16px Kanit"].map(f => fonts.load(f, "กขค").catch(() => {})))
    await fonts.ready
  }
  await Promise.all([...node.querySelectorAll("img")].map(i => i.decode ? i.decode().catch(() => {}) : null))
  const fontEmbedCSS = await embeddedFontCSS()
  // 3× = a 1620 px PNG: crisp text even after LINE/Discord recompress it
  const opts = { pixelRatio: 3, backgroundColor: "#f6f8fb", ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }) }
  if(!warmed){ await toBlob(node, opts).catch(() => {}); warmed = true }
  const blob = await toBlob(node, opts)
  if(!blob) throw new Error("empty card image")
  return blob
}
