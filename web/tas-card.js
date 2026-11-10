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
   and exported at pixelRatio 2, so the PNG is 1080 px wide — LINE's
   full-width size. The header is the class banner itself (same image the
   Discord embed uses), kept local so html-to-image can read it. Below it,
   the old card's shape: date, name, then sections with numbered rows. */
export const HW_WIDTH = 540
const PILL = { red: ["#fee2e2","#b91c1c"], orange: ["#ffedd5","#c2410c"], grey: ["#eef2f6","#475569"] }

/* The picker emoji, drawn. Emoji look different on every phone (Windows
   shows some as letters), so the card draws its own line icons in the
   subject's colour. Anything not here falls back to the emoji as text. */
const svg = d => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
const ICONS = {
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
const iconHTML = e => {
  const key = String(e || "").replace(/️/g, "").trim()
  if(!key) return ""
  return ICONS[key] ? `<span class="hw-ico">${ICONS[key]}</span>` : `<span class="hw-emo">${esc(e)}</span>`
}

const HW_CSS = `
.hw{width:${HW_WIDTH}px;font-family:'Kanit',sans-serif;background:#f6f8fb;color:#0f1d3a;line-height:1.35;overflow:hidden}
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
.hw-code{font-size:12.5px;font-weight:400;color:#94a3b8;margin-left:6px;white-space:nowrap}
.hw-pill{flex-shrink:0;font-size:12.5px;font-weight:600;line-height:1.35;padding:3px 11px;border-radius:99px;white-space:nowrap;margin-top:1px}
.hw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hw-chip{font-size:13.5px;font-weight:400;line-height:1.35;padding:4px 10px;border-radius:8px;background:#f1f5f9;color:#1e293b;overflow-wrap:anywhere;max-width:100%}
.hw-photos{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hw-photo{display:block;border-radius:8px;border:1px solid #e2e8f0;min-width:0}
.hw-more{text-align:center;font-size:13.5px;color:#64748b;padding:10px 0 0}
.hw-empty{text-align:center;padding:30px 0 26px;font-size:19px;font-weight:500;color:#64748b}
.hw-empty b{display:block;font-size:34px;margin-bottom:4px}
.hw-foot{height:18px}
`

export function hwCardHTML(m){
  const pill = p => p ? `<span class="hw-pill" style="background:${PILL[p.tone][0]};color:${PILL[p.tone][1]}">${esc(p.label)}</span>` : ""
  const color = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#64748b"
  const rowHTML = r => `<div class="hw-row">
      <div class="hw-strip" style="background:${color(r.color)}"></div>
      <div class="hw-main">
        <div class="hw-head">
          <div class="hw-subj" style="color:#0f1d3a"><span class="hw-num">${r.n}.</span><span style="color:${color(r.color)};display:contents">${iconHTML(r.icon)}</span><span class="hw-subj-t">${esc(r.subject || "")}${r.code ? `<span class="hw-code">${esc(r.code)}</span>` : ""}</span></div>
          ${pill(r.pill)}
        </div>
        ${r.lines.length ? `<div class="hw-chips">${r.lines.map(l => `<span class="hw-chip">${esc(l)}</span>`).join("")}</div>` : ""}
        ${(r.photos || []).length ? `<div class="hw-photos">${r.photos.map(ph =>
          `<img class="hw-photo" src="${esc(ph.src)}" alt="" style="width:calc(${Math.min(100, Math.max(10, Number(ph.size) || 100))}% - 4px)">`).join("")}</div>` : ""}
      </div>
    </div>`
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
      ${sections || `<div class="hw-empty"><b>🎉</b>ไม่มีการบ้านวันนี้</div>`}
      ${m.more > 0 ? `<div class="hw-more">+${m.more} รายการ</div>` : ""}
    </div>
    <div class="hw-foot"></div>
  </div>`
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
  const opts = { pixelRatio: 2, backgroundColor: "#f6f8fb", ...(fontEmbedCSS ? { fontEmbedCSS } : { skipFonts: true }) }
  if(!warmed){ await toBlob(node, opts).catch(() => {}); warmed = true }
  const blob = await toBlob(node, opts)
  if(!blob) throw new Error("empty card image")
  return blob
}
