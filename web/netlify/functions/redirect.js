/* ─────────────────────────────────────────────────────────────
   Short-link redirect:  /r/<code>  →  302 to the original URL.

   netlify.toml rewrites /r/* here. Lookup goes through the Firestore
   REST API rather than firebase-admin: the links collection is
   world-readable by design (a short link has to work for signed-out
   visitors), so this needs no service-account credentials — just the
   same public web API key the client already ships.
   ───────────────────────────────────────────────────────────── */

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "tas-samtabsam"
const API_KEY    = process.env.FIREBASE_API_KEY    || "AIzaSyA7jTnrA4qvIyqJRec3LYRgkIpJ4lKqX18"
const BASE       = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/links`

// A dead link shouldn't hang the page waiting on a counter write.
const CLICK_TIMEOUT_MS = 800

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
}

function errorPage(title, message, code) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — TAS</title>
<link rel="icon" type="image/x-icon" href="/TASLogo.png">
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Kanit',sans-serif;min-height:100vh;background:#0b1c3d;color:#fff;
       display:flex;align-items:center;justify-content:center;padding:1.5rem;text-align:center}
  .box{max-width:400px;background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.16);
       border-radius:20px;padding:2.4rem 1.9rem;backdrop-filter:blur(10px);
       box-shadow:0 20px 50px -22px rgba(0,0,0,0.8)}
  .em{font-size:44px;display:block;margin-bottom:14px}
  h1{font-size:20px;font-weight:600;margin-bottom:9px}
  p{font-size:13px;font-weight:300;color:rgba(255,255,255,0.72);line-height:1.7}
  code{font-family:ui-monospace,Menlo,Consolas,monospace;background:rgba(255,79,163,0.16);
       border:1px solid rgba(255,79,163,0.4);border-radius:6px;padding:1px 7px;color:#ffc2e0;font-size:12.5px}
  a.btn{display:inline-flex;align-items:center;gap:7px;margin-top:1.6rem;padding:11px 20px;border-radius:11px;
        background:linear-gradient(180deg,#ff5fac 0%,#c02e7e 100%);color:#fff;text-decoration:none;
        font-size:13.5px;font-weight:500;box-shadow:0 8px 20px -8px rgba(255,79,163,0.55)}
</style>
</head><body>
  <div class="box">
    <span class="em">🔗</span>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="btn" href="/tools-link.html">Open the link shortener</a>
  </div>
</body></html>`
}

/** Bump the click counter. Read-then-write: the increment transform can't
 *  be validated by security rules, and an exact +1 write can. Losing the
 *  odd count under simultaneous clicks is fine for this. */
async function countClick(code, current) {
  const url = `${BASE}/${encodeURIComponent(code)}?key=${API_KEY}&updateMask.fieldPaths=clicks`
  await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { clicks: { integerValue: String(current + 1) } } }),
  })
}

exports.handler = async (event) => {
  // Path is /r/<code> before the rewrite and /.netlify/functions/redirect/<code>
  // after it, so take the last non-empty segment either way.
  const segments = (event.path || "").split("/").filter(Boolean)
  const code = decodeURIComponent(segments[segments.length - 1] || "").toLowerCase()

  if (!code || code === "redirect" || code === "r") {
    return {
      statusCode: 404,
      headers: HTML_HEADERS,
      body: errorPage("No link code", "This address is missing a short code. A TAS short link looks like <code>/r/k7m2xq</code>."),
    }
  }

  let doc
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(code)}?key=${API_KEY}`)
    if (res.status === 404) {
      return {
        statusCode: 404,
        headers: HTML_HEADERS,
        body: errorPage("Link not found", `No short link exists for <code>${code.replace(/[<>&]/g, "")}</code>. It may have been deleted, or the code was typed wrong.`),
      }
    }
    if (!res.ok) throw new Error("Firestore responded " + res.status)
    doc = await res.json()
  } catch (e) {
    console.error("Lookup failed for", code, e)
    return {
      statusCode: 502,
      headers: HTML_HEADERS,
      body: errorPage("Something went wrong", "We couldn't look that link up right now. Please try again in a moment."),
    }
  }

  const target = doc.fields && doc.fields.originalURL && doc.fields.originalURL.stringValue
  if (!target || !/^https?:\/\//i.test(target)) {
    return {
      statusCode: 404,
      headers: HTML_HEADERS,
      body: errorPage("Broken link", "That short code exists but doesn't point anywhere valid."),
    }
  }

  const clicks = Number((doc.fields.clicks && doc.fields.clicks.integerValue) || 0)
  // Never let the counter delay (or break) the redirect itself.
  try {
    await Promise.race([
      countClick(code, clicks),
      new Promise(resolve => setTimeout(resolve, CLICK_TIMEOUT_MS)),
    ])
  } catch (e) {
    console.warn("Click count failed for", code, e)
  }

  return {
    statusCode: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",   // counted every visit, not once per browser
    },
  }
}
