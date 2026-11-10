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
  book: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5S9.5 4.5 4 4.5v13c5.5 0 8 2 8 2s2.5-2 8-2v-13c-5.5 0-8 2-8 2Z"/><path d="M12 6.5v15"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>`,
  pin:  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-7"/><path d="M8 3h8l-1 6 3 3H6l3-3-1-6Z"/></svg>`,
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
   Discord embed uses), kept local so html-to-image can read it. */
export const HW_WIDTH = 540
const PILL = { red: ["#fee2e2","#b91c1c"], orange: ["#ffedd5","#c2410c"], grey: ["#eef2f6","#475569"], green: ["#dcfce7","#15803d"] }

const HW_CSS = `
.hw{width:${HW_WIDTH}px;font-family:'Kanit',sans-serif;background:#f6f8fb;color:#0f1d3a;line-height:1.35;overflow:hidden}
.hw *{box-sizing:border-box}
.hw-banner{display:block;width:100%;height:auto}
.hw-date{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:18px 24px 14px;background:#fff;border-bottom:1px solid #e6ebf2}
.hw-wd{font-size:14px;font-weight:500;color:#db2777;line-height:1.4}
.hw-big{font-size:30px;font-weight:600;line-height:1.3;letter-spacing:-0.3px}
.hw-name{display:flex;align-items:center;gap:6px;font-size:14px;color:#4a5568;padding-bottom:5px;text-align:right}
.hw-prog{display:flex;align-items:center;gap:12px;padding:12px 24px 0;font-size:13.5px;font-weight:500;color:#334155}
.hw-bar{flex:1;height:9px;border-radius:9px;background:#e2e8f0;overflow:hidden}
.hw-bar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#16a34a,#22c55e)}
.hw-list{padding:14px 18px 6px;display:flex;flex-direction:column;gap:10px}
.hw-row{display:flex;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,29,58,.06),0 0 0 1px #e8edf3}
.hw-strip{width:6px;flex-shrink:0}
.hw-main{flex:1;min-width:0;padding:11px 14px 12px}
.hw-head{display:flex;align-items:flex-start;gap:10px}
.hw-subj{flex:1;min-width:0;font-size:17px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.hw-pill{flex-shrink:0;font-size:12.5px;font-weight:600;line-height:1.35;padding:3px 11px;border-radius:99px;white-space:nowrap;margin-top:1px}
.hw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hw-chip{font-size:13.5px;font-weight:400;line-height:1.35;padding:4px 10px;border-radius:8px;background:#f1f5f9;color:#1e293b;overflow-wrap:anywhere;max-width:100%}
.hw-row.done .hw-subj{text-decoration:line-through;text-decoration-color:#94a3b8;color:#64748b}
.hw-row.done .hw-chip{color:#94a3b8;background:#f8fafc}
.hw-check{display:inline-flex;vertical-align:-3px;margin-right:6px}
.hw-photos{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hw-photo{display:block;border-radius:8px;border:1px solid #e2e8f0;min-width:0}
.hw-more{text-align:center;font-size:13.5px;color:#64748b;padding:2px 0 4px}
.hw-empty{text-align:center;padding:30px 0 26px;font-size:19px;font-weight:500;color:#64748b}
.hw-empty b{display:block;font-size:34px;margin-bottom:4px}
.hw-note{margin:6px 18px 0;padding:11px 14px;border-radius:12px;background:#fff8e6;border:1px solid #ffe2a8;color:#8a5a08;font-size:14px;line-height:1.5;display:flex;gap:8px;white-space:pre-line;overflow-wrap:anywhere}
.hw-foot{height:18px}
`
const CHECK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`

export function hwCardHTML(m){
  const pill = p => p ? `<span class="hw-pill" style="background:${PILL[p.tone][0]};color:${PILL[p.tone][1]}">${esc(p.label)}</span>` : ""
  const color = c => /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#64748b"
  const rows = m.rows.map(r => `<div class="hw-row${r.done ? " done" : ""}">
      <div class="hw-strip" style="background:${r.done ? "#16a34a" : color(r.color)}"></div>
      <div class="hw-main">
        <div class="hw-head"><div class="hw-subj">${r.done ? `<span class="hw-check">${CHECK}</span>` : ""}${r.icon ? esc(r.icon) + " " : ""}${esc(r.subject || "")}</div>${pill(r.pill)}</div>
        ${r.lines.length ? `<div class="hw-chips">${r.lines.map(l => `<span class="hw-chip">${esc(l)}</span>`).join("")}</div>` : ""}
        ${(r.photos || []).length ? `<div class="hw-photos">${r.photos.map(ph =>
          `<img class="hw-photo" src="${esc(ph.src)}" alt="" style="width:calc(${Math.min(100, Math.max(10, Number(ph.size) || 100))}% - 4px)">`).join("")}</div>` : ""}
      </div>
    </div>`).join("")
  const p = m.progress
  return `<div class="hw">
    <img class="hw-banner" src="img/hw-banner.png" alt="การบ้านประจำวัน HOMEWORK">
    <div class="hw-date">
      <div><div class="hw-wd">วัน${esc(m.weekday)}</div><div class="hw-big">${esc(thaiDate(m.date))}</div></div>
      ${m.name ? `<div class="hw-name">${ICO.user}<span>${esc(m.name)}</span></div>` : ""}
    </div>
    ${p ? `<div class="hw-prog"><span>ส่งแล้ว ${p.done}/${p.total}</span><div class="hw-bar"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div></div>` : ""}
    <div class="hw-list">
      ${rows || `<div class="hw-empty"><b>🎉</b>ไม่มีการบ้านวันนี้</div>`}
      ${m.more > 0 ? `<div class="hw-more">+${m.more} รายการ</div>` : ""}
    </div>
    ${m.note ? `<div class="hw-note">${ICO.pin}<span>${esc(m.note)}</span></div>` : ""}
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
