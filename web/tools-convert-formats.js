/* ─────────────────────────────────────────────────────────────
   File Converter — what can become what.

   One table drives the whole page: the accept="" list, the format
   detection, the buttons offered on the right, whether the swap
   arrow lights up, and the warning shown before a lossy step. Adding
   a format is meant to be an edit here plus a pipeline, not a hunt
   through the UI.

   A conversion is "reversible" when going there and back lands you
   somewhere usable — PNG to PDF to PNG gives you your picture. It is
   NOT a claim that the bytes survive: re-encoding a JPEG loses a
   little every time, and a PDF built from photos holds pictures of
   pages, not the pages. What it rules out is the genuinely one-way
   step, where the reverse cannot be done at all: a .docx becomes a
   PDF and no browser can turn that PDF back into Word.

   Being straight about that in the table is the point. A swap arrow
   that quietly produced a worse file every press would be a lie the
   user only discovers after they have thrown the original away.
   ───────────────────────────────────────────────────────────── */

/* Every format the page will accept, keyed by the id used everywhere
   else. `ext` is what output files are named with; `mime` is what the
   blob is tagged as; `accept` is what goes in the file picker. */
export const FORMATS = {
  jpeg: { label:"JPEG", ext:"jpg",  mime:"image/jpeg", group:"image",
          accept:[".jpg",".jpeg"] },
  png:  { label:"PNG",  ext:"png",  mime:"image/png",  group:"image",
          accept:[".png"] },
  webp: { label:"WebP", ext:"webp", mime:"image/webp", group:"image",
          accept:[".webp"] },
  gif:  { label:"GIF",  ext:"gif",  mime:"image/gif",  group:"image",
          accept:[".gif"] },

  pdf:  { label:"PDF",  ext:"pdf",  mime:"application/pdf", group:"doc",
          accept:[".pdf"] },
  docx: { label:"Word", ext:"docx", mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          group:"doc", accept:[".docx"], readOnly:true },

  txt:  { label:"Text", ext:"txt",  mime:"text/plain",    group:"text",
          accept:[".txt",".log"] },
  md:   { label:"Markdown", ext:"md", mime:"text/markdown", group:"text",
          accept:[".md",".markdown"] },
  html: { label:"HTML", ext:"html", mime:"text/html",     group:"text",
          accept:[".html",".htm"] },
  csv:  { label:"CSV",  ext:"csv",  mime:"text/csv",      group:"data",
          accept:[".csv",".tsv"] },
  json: { label:"JSON", ext:"json", mime:"application/json", group:"data",
          accept:[".json"] },

  mp3:  { label:"MP3",  ext:"mp3",  mime:"audio/mpeg",    group:"audio",
          accept:[".mp3"] },
  wav:  { label:"WAV",  ext:"wav",  mime:"audio/wav",     group:"audio",
          accept:[".wav"] },
  m4a:  { label:"M4A",  ext:"m4a",  mime:"audio/mp4",     group:"audio",
          accept:[".m4a",".aac",".ogg",".oga",".flac"], readOnly:true },

  mp4:  { label:"MP4",  ext:"mp4",  mime:"video/mp4",     group:"video",
          accept:[".mp4",".m4v"] },
  webm: { label:"WebM", ext:"webm", mime:"video/webm",    group:"video",
          accept:[".webm"] },
  mov:  { label:"MOV",  ext:"mov",  mime:"video/quicktime", group:"video",
          accept:[".mov",".3gp",".avi",".mkv",".ogv"], readOnly:true }
}

/* What each input can turn into.

   `to`     the formats offered on the right
   `lossy`  targets where something real is thrown away, so the UI can
            say so before the click rather than after
   `oneWay` targets that cannot be brought back by this page — these
            grey out the swap arrow */
export const CONVERSIONS = {
  jpeg: { to:["png","webp","pdf"],            lossy:[],           oneWay:[] },
  png:  { to:["jpeg","webp","pdf"],           lossy:["jpeg"],     oneWay:[] },
  webp: { to:["jpeg","png","pdf"],            lossy:["jpeg"],     oneWay:[] },
  gif:  { to:["png","jpeg","webp","pdf"],     lossy:["jpeg"],     oneWay:[] },

  // A PDF comes apart into a picture per page, or its text comes out.
  // Text is one-way: the layout does not survive being read off.
  pdf:  { to:["png","jpeg","webp","txt","md"], lossy:["jpeg"],    oneWay:["txt","md"] },

  // Word in, nothing back out — no browser writes .docx.
  docx: { to:["pdf","md","txt","html"],        lossy:["pdf","txt"], oneWay:["pdf","md","txt","html"] },

  txt:  { to:["pdf","md","html"],              lossy:[],           oneWay:["pdf"] },
  md:   { to:["pdf","html","txt"],             lossy:["txt"],      oneWay:["pdf"] },
  html: { to:["pdf","md","txt"],               lossy:["md","txt"], oneWay:["pdf"] },

  csv:  { to:["json","pdf","txt"],             lossy:[],           oneWay:["pdf"] },
  json: { to:["csv","pdf","txt"],              lossy:["csv"],      oneWay:["pdf"] },

  mp3:  { to:["wav"],                          lossy:[],           oneWay:[] },
  wav:  { to:["mp3"],                          lossy:["mp3"],      oneWay:[] },
  m4a:  { to:["mp3","wav"],                    lossy:["mp3"],      oneWay:["mp3","wav"] },

  // Sound out of a video can never put the picture back.
  mp4:  { to:["mp3","wav","webm","gif"],       lossy:["mp3","webm","gif"], oneWay:["mp3","wav","gif"] },
  webm: { to:["mp3","wav","mp4","gif"],        lossy:["mp3","mp4","gif"],  oneWay:["mp3","wav","gif"] },
  mov:  { to:["mp3","wav","mp4","webm","gif"], lossy:["mp3","mp4","webm","gif"],
          oneWay:["mp3","wav","mp4","webm","gif"] }
}

/* Formats the heavy engine is needed for. Kept here rather than in the
   media module so the UI can warn before anything is downloaded. */
export const NEEDS_FFMPEG = new Set(["mp4","webm","gif"])

const EXT_TO_ID = (() => {
  const m = {}
  for(const [id, f] of Object.entries(FORMATS))
    for(const a of f.accept) m[a.replace(".", "")] = id
  return m
})()

export function detect(file){
  const name = (file && file.name || "").toLowerCase()
  const ext = name.includes(".") ? name.split(".").pop() : ""
  if(EXT_TO_ID[ext]) return EXT_TO_ID[ext]

  // Fall back to the browser's sniffing for a file with no useful name
  // (a share-sheet drop on a phone often has none).
  const type = (file && file.type || "").toLowerCase()
  for(const [id, f] of Object.entries(FORMATS)) if(f.mime === type) return id
  if(type.startsWith("image/")) return "png"
  if(type.startsWith("audio/")) return "m4a"
  if(type.startsWith("video/")) return "mp4"
  return null
}

export const ACCEPT_ATTR = Object.values(FORMATS)
  .flatMap(f => f.accept).join(",")

export const targetsFor  = id => (CONVERSIONS[id] || {}).to || []
export const canConvert  = (from, to) => targetsFor(from).includes(to)
export const isLossy     = (from, to) => ((CONVERSIONS[from] || {}).lossy || []).includes(to)
export const isOneWay    = (from, to) => ((CONVERSIONS[from] || {}).oneWay || []).includes(to)
// Round trip only if the reverse exists AND is not itself a dead end.
export const isReversible = (from, to) => !isOneWay(from, to) && canConvert(to, from)

export const label = id => (FORMATS[id] || {}).label || String(id || "?").toUpperCase()
export const extOf = id => (FORMATS[id] || {}).ext || "bin"
export const mimeOf = id => (FORMATS[id] || {}).mime || "application/octet-stream"
export const groupOf = id => (FORMATS[id] || {}).group || "other"

/* The one-line explanation under the format buttons. Says the true
   thing about the pair rather than a generic "this may reduce
   quality" that people learn to ignore. */
export function describe(from, to){
  if(!from || !to) return ""
  const F = label(from), T = label(to)
  if(isReversible(from, to))
    return `${F} and ${T} convert both ways — you can swap back.`
  if(isOneWay(from, to))
    return `${F} to ${T} is one-way: this page can't turn a ${T} back into a ${F}. Keep your original.`
  if(isLossy(from, to))
    return `${T} throws some detail away. Keep the original if you might need it again.`
  return `${F} to ${T}.`
}
