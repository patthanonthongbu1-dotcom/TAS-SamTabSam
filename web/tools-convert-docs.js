/* ─────────────────────────────────────────────────────────────
   File Converter — documents.

   Text, Markdown, HTML, CSV and .docx in; page canvases out, which
   the existing pipeline then encodes and staples into a PDF exactly
   as it does for photos. That reuse is the whole design: the page
   already knows how to turn a list of canvases into one PDF, so a
   document only has to become canvases.

   Why canvases and not real PDF text: the notes here are Thai, and
   the 14 fonts a PDF can assume are all Latin-only. Real text would
   mean embedding a Unicode font — fontkit plus a Thai TTF, several
   hundred KB, on a page whose point is to be light. Drawing through
   the browser's own text engine gets Thai, emoji and mixed scripts
   right for free.

   The cost is honest and worth stating in the UI: the words in the
   output are pixels, so they cannot be selected or searched. For
   handing in a printed sheet that is fine; for a document someone
   needs to copy from, Word's own Save as PDF is the better tool.

   On .docx specifically — mammoth extracts the document's structure,
   not its layout. Paragraphs, headings, bold/italic and lists survive.
   Tables, columns, headers, footers, page breaks and exact fonts do
   not. Legacy .doc, .pptx and .xlsx are not supported at all: they
   are different formats with no comparable browser-side reader.
   ───────────────────────────────────────────────────────────── */

export const TEXT_RE = /\.(txt|md|markdown|log|csv|tsv|json|html?|xml|ya?ml)$/i
export const DOCX_RE = /\.docx$/i
// Named so the "we can't do this one" message can be specific rather
// than a flat "unsupported file".
export const LEGACY_DOC_RE = /\.(docx?|pptx?|xlsx?|odt|odp|ods|rtf|pages)$/i

export const isTextDoc = f => !!f && TEXT_RE.test(f.name || "")
export const isDocx    = f => !!f && DOCX_RE.test(f.name || "")

/* A4 at 96dpi is 794x1123. Rendering at 2x gives text that still looks
   sharp when the PDF is opened at full size or printed. */
export const PAGE_W = 794
export const PAGE_H = 1123
const SCALE = 2
const MARGIN = 64

const MAX_PAGES = 60          // a runaway file should not lock up a phone
const MAX_CHARS = 400000

/* The bare specifier, not the /mammoth.browser.js subpath: that one
   exports only a default, so the named convertToHtml comes back
   undefined and the call fails as if the file were unreadable. */
let _mammoth = null
async function mammoth(){
  if(!_mammoth){
    const m = await import("https://esm.sh/mammoth@1.8.0")
    _mammoth = m.convertToHtml ? m : m.default
  }
  return _mammoth
}

/* ── Reading the source into a block list ─────────────────── */

/* Everything becomes the same intermediate shape before layout:
   { text, size, bold, mono, space } — a paragraph with a type size and
   a little vertical air. Markdown, HTML and plain text all reduce to
   this, which keeps the layout code from caring where a block came
   from. */

const H_SIZE = { 1: 30, 2: 24, 3: 20, 4: 18, 5: 16, 6: 15 }
const BODY = 15

function textBlocks(raw, name){
  const isMd  = /\.(md|markdown)$/i.test(name)
  const isCsv = /\.(csv|tsv)$/i.test(name)
  const isData = /\.(json|xml|ya?ml|log)$/i.test(name)

  /* Normalise line endings up front. A .txt or .md written on Windows
     arrives as CRLF, and every structural rule below is anchored to the
     start or end of a line — one stray \r and a heading stops looking
     like a heading. */
  const lines = raw.replace(/\r\n?/g, "\n").split("\n")

  if(isCsv){
    // Keep the columns lined up rather than pretending it is prose.
    const sep = /\.tsv$/i.test(name) ? "\t" : ","
    return lines.map(line => ({
      text: line.split(sep).map(c => c.trim()).join("   |   "),
      size: 12, mono: true, space: 4
    }))
  }
  if(isData){
    return lines.map(line => ({ text: line, size: 12, mono: true, space: 2 }))
  }
  if(!isMd){
    // Plain text keeps its own line breaks: a hand-formatted note should
    // not be reflowed into a wall of prose.
    return lines.map(line => ({ text: line, size: BODY, space: 3 }))
  }

  /* Markdown is classified a line at a time, with consecutive prose
     lines gathered into one paragraph so they reflow together. Splitting
     on blank lines first and matching the block as a whole does not
     work: "## Physics\nSome prose" is one such block, and a $-anchored
     heading rule can never match it. */
  const out = []
  let para = []
  const flushPara = () => {
    if(!para.length) return
    out.push({ text: stripMd(para.join(" ")), size: BODY, space: 8 })
    para = []
  }

  let inFence = false
  for(const line of lines){
    if(/^\s*```/.test(line)){ flushPara(); inFence = !inFence; continue }
    if(inFence){ out.push({ text: line, size: 12, mono: true, space: 2 }); continue }

    if(!line.trim()){ flushPara(); out.push({ text: "", size: BODY, space: 6 }); continue }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if(h){ flushPara()
      out.push({ text: stripMd(h[2]), size: H_SIZE[h[1].length], bold: true, space: 14 }); continue }

    // Before the bullet rule: "---" is a rule, not a "-" list item.
    if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){ flushPara()
      out.push({ rule: true, space: 12 }); continue }

    const li = line.match(/^\s*[-*+]\s+(.*)$/)
    if(li){ flushPara()
      out.push({ text: "•  " + stripMd(li[1]), size: BODY, space: 4 }); continue }

    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if(ol){ flushPara()
      out.push({ text: ol[1] + ".  " + stripMd(ol[2]), size: BODY, space: 4 }); continue }

    const bq = line.match(/^\s*>\s?(.*)$/)
    if(bq){ flushPara()
      out.push({ text: stripMd(bq[1]), size: BODY, space: 8 }); continue }

    para.push(line.trim())
  }
  flushPara()
  return out
}

/* Inline markdown is dropped rather than rendered: bold inside a
   wrapped line would need per-run measurement, and the payoff on a
   notes page is small. The markers themselves would be noise, so they
   go. */
function stripMd(s){
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .trim()
}

/* HTML — including whatever mammoth produced from a .docx. Walked as a
   DOM rather than regexed so nesting and entities come out right. The
   markup is parsed inert via DOMParser: it is never attached to this
   document, so scripts in a dropped .html file cannot run. */
function htmlBlocks(html){
  const doc = new DOMParser().parseFromString(html, "text/html")
  const out = []
  const walk = node => {
    for(const el of node.children){
      const tag = el.tagName.toLowerCase()
      const txt = (el.textContent || "").replace(/\s+/g, " ").trim()
      if(tag === "script" || tag === "style") continue
      if(/^h[1-6]$/.test(tag)){
        if(txt) out.push({ text: txt, size: H_SIZE[+tag[1]], bold: true, space: 14 })
      } else if(tag === "li"){
        if(txt) out.push({ text: "•  " + txt, size: BODY, space: 4 })
      } else if(tag === "hr"){
        out.push({ rule: true, space: 12 })
      } else if(tag === "tr"){
        const cells = [...el.children].map(c => (c.textContent || "").replace(/\s+/g, " ").trim())
        out.push({ text: cells.join("   |   "), size: 12, mono: true, space: 4 })
      } else if(tag === "p" || tag === "blockquote" || tag === "pre"){
        if(txt) out.push({ text: txt, size: BODY, mono: tag === "pre", space: 8 })
      } else if(el.children.length){
        walk(el)
      } else if(txt){
        out.push({ text: txt, size: BODY, space: 8 })
      }
    }
  }
  walk(doc.body)
  return out
}

/* ── Layout ──────────────────────────────────────────────── */

const fontFor = b =>
  (b.bold ? "600 " : "400 ") + b.size + "px " +
  (b.mono ? "ui-monospace, Menlo, Consolas, monospace"
          : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif")

/* Greedy wrap by measured width. Breaks on spaces where there are any,
   and per character where there are not — Thai does not put spaces
   between words, so a Thai paragraph is one enormous token and would
   otherwise run straight off the page. */
function wrap(ctx, text, maxW){
  if(!text) return [""]
  const words = text.split(/(\s+)/).filter(s => s !== "")
  const lines = []
  let line = ""
  const pushChars = word => {
    let cur = ""
    for(const ch of word){
      if(ctx.measureText(cur + ch).width > maxW && cur){ lines.push(cur); cur = ch }
      else cur += ch
    }
    line = cur
  }
  for(const w of words){
    const next = line + w
    if(ctx.measureText(next).width <= maxW){ line = next; continue }
    if(line){ lines.push(line.trimEnd()); line = "" }
    if(ctx.measureText(w).width > maxW) pushChars(w)
    else line = w.trimStart()
  }
  if(line.trim() || lines.length === 0) lines.push(line.trimEnd())
  return lines
}

/* Blocks to page canvases. Returns [] rather than throwing on an empty
   document, so the caller can report "nothing to render" plainly. */
export function renderBlocks(blocks, { pageW = PAGE_W, pageH = PAGE_H } = {}){
  const pages = []
  const maxW = pageW - MARGIN * 2
  let canvas = null, ctx = null, y = 0

  const newPage = () => {
    canvas = document.createElement("canvas")
    canvas.width = pageW * SCALE
    canvas.height = pageH * SCALE
    ctx = canvas.getContext("2d")
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, pageW, pageH)
    ctx.fillStyle = "#111111"
    ctx.textBaseline = "top"
    pages.push(canvas)
    y = MARGIN
  }
  newPage()

  const measure = document.createElement("canvas").getContext("2d")

  for(const b of blocks){
    if(pages.length > MAX_PAGES) break

    if(b.rule){
      if(y + 12 > pageH - MARGIN) newPage()
      ctx.strokeStyle = "#d5d5d5"
      ctx.beginPath(); ctx.moveTo(MARGIN, y + 4); ctx.lineTo(pageW - MARGIN, y + 4); ctx.stroke()
      y += (b.space || 12)
      continue
    }
    if(!b.text){ y += (b.space || 8); continue }

    measure.font = fontFor(b)
    const lines = wrap(measure, b.text, maxW)
    const lh = Math.round(b.size * 1.5)

    for(const line of lines){
      if(y + lh > pageH - MARGIN){
        if(pages.length > MAX_PAGES) break
        newPage()
      }
      ctx.font = fontFor(b)
      ctx.fillText(line, MARGIN, y)
      y += lh
    }
    y += (b.space || 8)
  }
  return pages
}

/* ── Entry points ────────────────────────────────────────── */

export async function textFileToPages(file){
  let raw = await file.text()
  let truncated = false
  if(raw.length > MAX_CHARS){ raw = raw.slice(0, MAX_CHARS); truncated = true }

  const blocks = /\.html?$/i.test(file.name) ? htmlBlocks(raw) : textBlocks(raw, file.name)
  if(!blocks.length) throw new Error("empty")
  return { pages: renderBlocks(blocks), truncated }
}

/* ── Text out ────────────────────────────────────────────────
   The other direction: producing text rather than pages. This is what
   makes a PDF or a .docx worth anything after conversion — a picture
   of a page cannot be searched, quoted or pasted into an assignment.

   None of it recovers layout. Reading text off a PDF gives the words
   in roughly reading order and nothing else, which is why the format
   table marks those steps one-way. */

let _pdfjs = null
async function pdfjs(){
  if(!_pdfjs){
    _pdfjs = await import("https://esm.sh/pdfjs-dist@4.7.76/build/pdf.min.mjs")
    _pdfjs.GlobalWorkerOptions.workerSrc =
      "https://esm.sh/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs"
  }
  return _pdfjs
}

/* Words off a PDF, page by page.

   pdfjs hands back positioned text runs, not lines, so the runs have to
   be regrouped: a new line whenever the vertical position moves, and a
   space between runs on the same line unless one is already there.
   Without that everything on a page arrives as one unbroken string. */
export async function pdfToText(file, { asMarkdown = false } = {}){
  let lib
  try { lib = await pdfjs() }
  catch(e){ throw new Error("reader-offline") }

  let doc
  try { doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise }
  catch(e){ throw new Error("unreadable") }

  const out = []
  const pages = Math.min(doc.numPages, MAX_PAGES)
  for(let p = 1; p <= pages; p++){
    const content = await (await doc.getPage(p)).getTextContent()
    let line = "", lastY = null
    const lines = []
    for(const item of content.items){
      if(!item.str) continue
      const y = item.transform ? Math.round(item.transform[5]) : lastY
      if(lastY !== null && y !== lastY){ lines.push(line); line = "" }
      line += (line && !/\s$/.test(line) && !/^\s/.test(item.str) ? " " : "") + item.str
      lastY = y
    }
    if(line) lines.push(line)
    const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    if(asMarkdown && pages > 1) out.push(`## Page ${p}\n\n${body}`)
    else out.push(body)
  }
  const text = out.join(asMarkdown ? "\n\n" : "\n\n")
  if(!text.trim()) throw new Error("no-text")
  return { text, truncated: doc.numPages > pages }
}

export async function docxToText(file, { as = "md" } = {}){
  let m
  try { m = await mammoth() }
  catch(e){ throw new Error("reader-offline") }
  try {
    const buf = await file.arrayBuffer()
    if(as === "html") return (await m.convertToHtml({ arrayBuffer: buf })).value || ""
    if(as === "txt")  return (await m.extractRawText({ arrayBuffer: buf })).value || ""
    return (await m.convertToMarkdown({ arrayBuffer: buf })).value || ""
  } catch(e){ throw new Error("unreadable") }
}

/* ── Data ────────────────────────────────────────────────────
   CSV and JSON round-trip properly, which makes them the cleanest
   reversible pair on the page. */

/* A real CSV parser rather than split(","): a marks column with
   "Smith, J." in it is exactly the file a student has, and splitting
   on commas would quietly shift every column after it. Handles quoted
   fields, escaped quotes and newlines inside quotes. */
export function parseCsv(text, sep = ","){
  const rows = []
  let row = [], field = "", quoted = false
  const src = text.replace(/\r\n?/g, "\n")
  for(let i = 0; i < src.length; i++){
    const c = src[i]
    if(quoted){
      if(c === '"'){
        if(src[i + 1] === '"'){ field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if(c === '"'){ quoted = true }
    else if(c === sep){ row.push(field); field = "" }
    else if(c === "\n"){ row.push(field); rows.push(row); row = []; field = "" }
    else field += c
  }
  if(field || row.length){ row.push(field); rows.push(row) }
  return rows.filter(r => r.length && !(r.length === 1 && !r[0].trim()))
}

const csvCell = v => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function csvToJson(text, { sep = "," } = {}){
  const rows = parseCsv(text, sep)
  if(!rows.length) throw new Error("empty")
  const [head, ...body] = rows
  const keys = head.map((h, i) => h.trim() || `column${i + 1}`)
  const out = body.map(r => {
    const o = {}
    keys.forEach((k, i) => {
      const raw = (r[i] == null ? "" : r[i]).trim()
      // Numbers and booleans come back as themselves, so the JSON is
      // worth something to whatever reads it next. Anything ambiguous
      // stays a string.
      if(raw === "") o[k] = ""
      else if(/^-?\d+(\.\d+)?$/.test(raw) && String(Number(raw)) === raw) o[k] = Number(raw)
      else if(raw === "true" || raw === "false") o[k] = raw === "true"
      else o[k] = raw
    })
    return o
  })
  return JSON.stringify(out, null, 2)
}

export function jsonToCsv(text){
  let data
  try { data = JSON.parse(text) }
  catch(e){ throw new Error("bad-json") }
  if(!Array.isArray(data)) data = [data]
  if(!data.length) throw new Error("empty")
  if(data.some(r => r === null || typeof r !== "object" || Array.isArray(r)))
    throw new Error("not-tabular")

  // Union of keys in first-seen order, so a row missing a field still
  // lines up under the right heading instead of shifting the row.
  const keys = []
  for(const row of data) for(const k of Object.keys(row)) if(!keys.includes(k)) keys.push(k)
  const lines = [keys.map(csvCell).join(",")]
  for(const row of data) lines.push(keys.map(k => csvCell(row[k])).join(","))
  return lines.join("\n")
}

/* ── Text to text ────────────────────────────────────────────
   Markdown, HTML and plain text between themselves. Small, but it is
   what lets md -> html -> md come back looking like what went in. */

export function htmlToMarkdown(html){
  const doc = new DOMParser().parseFromString(html, "text/html")
  const out = []
  const inline = el => (el.textContent || "").replace(/\s+/g, " ").trim()
  const walk = node => {
    for(const el of node.children){
      const tag = el.tagName.toLowerCase()
      const t = inline(el)
      if(tag === "script" || tag === "style") continue
      if(/^h[1-6]$/.test(tag)){ if(t) out.push("#".repeat(+tag[1]) + " " + t) }
      else if(tag === "li"){ if(t) out.push("- " + t) }
      else if(tag === "hr"){ out.push("---") }
      else if(tag === "pre"){ if(t) out.push("```\n" + (el.textContent || "").trim() + "\n```") }
      else if(tag === "blockquote"){ if(t) out.push("> " + t) }
      else if(tag === "p"){ if(t) out.push(t) }
      else if(el.children.length){ walk(el); continue }
      else if(t) out.push(t)
    }
  }
  walk(doc.body)
  return out.join("\n\n")
}

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function markdownToHtml(md){
  const blocks = textBlocks(md, "x.md")
  const body = blocks.map(b => {
    if(b.rule) return "<hr>"
    if(!b.text) return ""
    if(b.bold && b.size >= 15){
      const lv = Object.entries(H_SIZE).find(([, v]) => v === b.size)
      return `<h${lv ? lv[0] : 2}>${esc(b.text)}</h${lv ? lv[0] : 2}>`
    }
    if(b.text.startsWith("•  ")) return `<li>${esc(b.text.slice(3))}</li>`
    return `<p>${esc(b.text)}</p>`
  }).filter(Boolean).join("\n")
  return `<!doctype html>\n<meta charset="utf-8">\n${body}\n`
}

// Markdown or HTML down to bare words.
export function toPlainText(raw, fromId){
  if(fromId === "html")
    return (new DOMParser().parseFromString(raw, "text/html").body.textContent || "")
      .replace(/\n{3,}/g, "\n\n").trim()
  if(fromId === "md")
    return textBlocks(raw, "x.md").map(b => b.rule ? "---" : b.text).join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return raw
}

export async function docxToPages(file){
  let m
  try { m = await mammoth() }
  catch(e){ throw new Error("reader-offline") }

  let html
  try {
    const res = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    html = res.value || ""
  } catch(e){
    throw new Error("unreadable")
  }
  const blocks = htmlBlocks(html)
  if(!blocks.length) throw new Error("empty")
  return { pages: renderBlocks(blocks), truncated: false }
}
