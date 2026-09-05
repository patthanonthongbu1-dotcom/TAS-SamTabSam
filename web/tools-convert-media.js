/* ─────────────────────────────────────────────────────────────
   File Converter — audio and video.

   Two engines, because one of them costs 32MB.

   The light path is the common case: pull the audio out of a
   video and write it as MP3 or WAV. It leans on the browser's own
   decoder (the same one a <video> tag uses), so an mp4, mov, m4a,
   webm or wav all arrive as an AudioBuffer without shipping a
   codec of our own. lamejs then encodes the MP3 — about 50KB, and
   comfortably faster than real time.

   The heavy path is ffmpeg.wasm, loaded only when someone asks for
   something the light path genuinely cannot do — changing a video's
   format rather than extracting from it. It is a ~32MB download,
   and the site sets no COOP/COEP headers, so there is no
   SharedArrayBuffer and it runs single-threaded. That is slow, and
   the UI has to say so before starting it.

   Why not ffmpeg for everything: this page's promise is that it
   works on a phone without uploading anything. A 32MB stall on
   mobile data to do a job 50KB can do would break that for the one
   conversion people actually want.
   ───────────────────────────────────────────────────────────── */

/* Containers we advertise. Not an exhaustive list of what the browser
   can decode — every one is still checked at decode time. */
export const MEDIA_RE = /\.(mp4|m4v|m4a|mov|webm|ogg|oga|ogv|wav|flac|aac|mp3|3gp|avi|mkv)$/i

export const isMedia = f =>
  !!f && ((f.type || "").startsWith("audio/") ||
          (f.type || "").startsWith("video/") ||
          MEDIA_RE.test(f.name || ""))

/* Video containers — the ones where "convert" might mean something
   other than "give me the audio", so the UI offers the heavy path. */
export const isVideo = f =>
  !!f && ((f.type || "").startsWith("video/") ||
          /\.(mp4|m4v|mov|webm|ogv|3gp|avi|mkv)$/i.test(f.name || ""))

export const AUDIO_EXT   = { "audio/mpeg": "mp3", "audio/wav": "wav" }
export const AUDIO_LABEL = { "audio/mpeg": "MP3", "audio/wav": "WAV" }

/* ── Light path ───────────────────────────────────────────── */

let _lame = null
async function lame(){
  if(!_lame) _lame = await import("https://esm.sh/@breezystack/lamejs@1.2.7")
  return _lame
}

/* Decode whatever the browser can read into raw samples.

   decodeAudioData wants the whole file in memory and hands back the
   whole decoded signal — ~10MB per minute at 44.1kHz stereo. Fine for
   the lesson clip or voice memo this is for, hopeless for a two-hour
   film, which is why the caller caps duration.

   An OfflineAudioContext rather than a plain one: no output device is
   needed, it never trips autoplay policy, and it leaves no running
   audio context behind on a phone. */
export async function decodeMedia(file){
  const buf = await file.arrayBuffer()
  const ctx = new OfflineAudioContext(2, 1, 44100)
  try {
    return await ctx.decodeAudioData(buf)
  } catch(e){
    // Either there is no audio track, or it is in a codec this browser
    // has no decoder for. The caller can't tell those apart either.
    throw new Error("no-audio")
  }
}

/* Float32 [-1,1] to the Int16 lamejs wants. Clamped: a sample even
   slightly over 1.0 wraps to full-scale negative and clicks. */
function toInt16(f32){
  const out = new Int16Array(f32.length)
  for(let i = 0; i < f32.length; i++){
    const s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i]
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return out
}

/* MP3. onProgress gets 0..1 — a four-minute track is a couple of
   seconds of solid JS, long enough that a frozen row looks broken, so
   this yields periodically to let the page paint. */
export async function encodeMp3(ab, kbps = 192, onProgress){
  const { Mp3Encoder } = await lame()
  const channels = ab.numberOfChannels > 1 ? 2 : 1
  const enc = new Mp3Encoder(channels, ab.sampleRate, kbps)
  const L = toInt16(ab.getChannelData(0))
  const R = channels > 1 ? toInt16(ab.getChannelData(1)) : L

  const BLOCK = 1152          // one MP3 frame's worth of samples
  const YIELD_EVERY = 200     // ~5s of audio between repaints
  const parts = []
  let block = 0
  for(let i = 0; i < L.length; i += BLOCK){
    const chunk = enc.encodeBuffer(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK))
    if(chunk.length) parts.push(new Uint8Array(chunk))
    if(++block % YIELD_EVERY === 0){
      if(onProgress) onProgress(i / L.length)
      await new Promise(r => setTimeout(r, 0))
    }
  }
  const tail = enc.flush()
  if(tail.length) parts.push(new Uint8Array(tail))
  if(onProgress) onProgress(1)
  return new Blob(parts, { type: "audio/mpeg" })
}

/* WAV — uncompressed, written by hand because a RIFF header is 44
   bytes and a library for that would be silly. 16-bit interleaved PCM,
   which is what every player expects. */
export function encodeWav(ab){
  const channels = Math.min(ab.numberOfChannels, 2)
  const rate = ab.sampleRate
  const frames = ab.length
  const bytes = frames * channels * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const tag = (off, s) => { for(let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }

  tag(0, "RIFF");  v.setUint32(4, 36 + bytes, true)
  tag(8, "WAVE");  tag(12, "fmt ")
  v.setUint32(16, 16, true)                    // PCM header length
  v.setUint16(20, 1, true)                     // format 1 = PCM
  v.setUint16(22, channels, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * channels * 2, true)   // byte rate
  v.setUint16(32, channels * 2, true)          // block align
  v.setUint16(34, 16, true)                    // bits per sample
  tag(36, "data"); v.setUint32(40, bytes, true)

  const chans = []
  for(let c = 0; c < channels; c++) chans.push(ab.getChannelData(c))
  let off = 44
  for(let i = 0; i < frames; i++){
    for(let c = 0; c < channels; c++){
      const s = chans[c][i] < -1 ? -1 : chans[c][i] > 1 ? 1 : chans[c][i]
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      off += 2
    }
  }
  return new Blob([buf], { type: "audio/wav" })
}

/* ── Heavy path ───────────────────────────────────────────── */

/* ffmpeg.wasm, fetched on demand and kept behind an explicit confirm:
   this is a ~32MB download, and on a phone that is somebody's data.

   The single-threaded core is deliberate, not a fallback — the
   multi-threaded one needs SharedArrayBuffer, which needs COOP/COEP
   response headers, which this site does not set (and setting them
   would break the CDN imports every other tool here relies on). */
// Measured: ffmpeg-core.wasm is 30.6MB, plus ~115KB of loader.
export const FFMPEG_MB = 32
const FFMPEG_VER = "0.12.10"
const CORE_VER = "0.12.6"

/* jsDelivr rather than the esm.sh this project uses elsewhere, and that
   is not a stylistic slip. esm.sh rewrites packages into ES modules,
   which is exactly wrong here: its ffmpeg-core.js is a 229-byte
   re-export shim rather than the real core, its worker.js is likewise a
   shim that cannot be run as a Worker, and its ffmpeg-core.wasm does
   not serve at all. These three need to arrive as untouched files. */
const CDN = "https://cdn.jsdelivr.net/npm"

/* The ESM core, paired with the UMD worker below — a mix, and a
   deliberate one. The worker runs as a module worker, so its first
   attempt (importScripts on the core) always throws; it then falls back
   to `(await import(coreURL)).default`. Only the ESM core has that
   default export, so handing it the UMD core fails with the thoroughly
   misleading "failed to import ffmpeg-core.js". */
const CORE_BASE = CDN + "/@ffmpeg/core@" + CORE_VER + "/dist/esm"

/* The UMD worker chunk, not dist/esm/worker.js. The ESM one is written
   with relative imports ("./const.js"), and once it is running from a
   blob: URL those resolve against the blob origin and 404 — the worker
   dies without an error anyone can catch and load() simply never
   settles. The UMD chunk is self-contained, so it survives the trip.

   "814" is webpack's chunk id and moves with the version, which is why
   FFMPEG_VER is pinned rather than floating. */
const WORKER_URL = CDN + "/@ffmpeg/ffmpeg@" + FFMPEG_VER + "/dist/umd/814.ffmpeg.js"

/* Fetch a remote file and hand back a blob: URL for it. @ffmpeg/util
   exports exactly this, but importing a whole package for six lines
   would be another network round trip before the 32MB one. */
async function toBlobURL(url, type, onProgress){
  const res = await fetch(url)
  if(!res.ok) throw new Error("Couldn't fetch " + url + " (" + res.status + ")")
  if(!onProgress || !res.body)
    return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))

  // Read it in chunks so a 32MB download can show a real percentage
  // rather than a spinner that looks stuck.
  const total = Number(res.headers.get("content-length")) || 0
  const reader = res.body.getReader()
  const parts = []
  let got = 0
  for(;;){
    const { done, value } = await reader.read()
    if(done) break
    parts.push(value)
    got += value.length
    if(total) onProgress(got / total)
  }
  onProgress(1)
  return URL.createObjectURL(new Blob(parts, { type }))
}

const UMD_LIB = CDN + "/@ffmpeg/ffmpeg@" + FFMPEG_VER + "/dist/umd/ffmpeg.js"

/* The UMD build via a plain <script>, rather than the ESM one via
   import(). It is worth spelling out why, because the ESM route looks
   tidier and cannot be made to work from another origin:

     - The ESM build spawns its worker with { type: "module" }. A module
       worker may not call importScripts(), which is exactly how the
       core gets loaded, so the core import fails.
     - Its worker also cannot simply be handed over as a blob: the ESM
       worker.js imports "./const.js" and friends, and those relative
       paths do not resolve from a blob: URL.
     - The UMD build spawns a classic worker, and its worker chunk is
       self-contained, so both problems disappear.

   Everything still has to be passed as a blob: URL, because a worker
   script loaded straight off a CDN is a cross-origin SecurityError. */
function loadUmdLib(){
  if(window.FFmpegWASM) return Promise.resolve(window.FFmpegWASM)
  return new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = UMD_LIB
    s.onload = () => window.FFmpegWASM
      ? resolve(window.FFmpegWASM)
      : reject(new Error("ffmpeg loaded but exposed nothing"))
    s.onerror = () => reject(new Error("Couldn't reach the CDN"))
    document.head.appendChild(s)
  })
}

let _ff = null, _ffLoading = null

export async function loadFfmpeg(onProgress){
  if(_ff) return _ff
  if(_ffLoading) return _ffLoading
  _ffLoading = (async () => {
    const { FFmpeg } = await loadUmdLib()
    const ff = new FFmpeg()
    // The 32MB wasm is the whole wait, so the caller can show progress.
    const [classWorkerURL, coreURL, wasmURL] = [
      await toBlobURL(WORKER_URL, "text/javascript"),
      await toBlobURL(CORE_BASE + "/ffmpeg-core.js", "text/javascript"),
      await toBlobURL(CORE_BASE + "/ffmpeg-core.wasm", "application/wasm", onProgress)
    ]
    await ff.load({ classWorkerURL, coreURL, wasmURL })
    _ff = ff
    return ff
  })()
  try { return await _ffLoading } finally { _ffLoading = null }
}

export const ffmpegReady = () => !!_ff

/* Run one conversion. The caller names the input and output files and
   supplies the arg list that goes between them. */
export async function ffmpegRun(file, inName, outName, args, onProgress){
  const ff = await loadFfmpeg()
  const handler = p => { if(onProgress) onProgress(Math.max(0, Math.min(1, p.progress))) }
  ff.on("progress", handler)
  try {
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()))
    await ff.exec(args)
    const data = await ff.readFile(outName)
    return new Uint8Array(data)
  } finally {
    ff.off("progress", handler)
    // Or a second run on a phone piles files up in the in-memory FS.
    try { await ff.deleteFile(inName) } catch(e){}
    try { await ff.deleteFile(outName) } catch(e){}
  }
}
