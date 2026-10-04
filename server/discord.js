const express = require("express")
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args))
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

// Discord webhook URL. This is the equivalent of the LINE bot's TOKEN + groupId
// combined — it identifies BOTH the target channel and the auth to post there.
// Do NOT hardcode it in source (unlike the old LINE bot). Set it via env:
//   DISCORD_WEBHOOK="https://discord.com/api/webhooks/xxx/yyy" node discord.js
// It is never taken from the request: a caller-supplied URL would turn this
// server into a relay that POSTs to anywhere.
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "tas-samtabsam"
const WHITELIST_URL =
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/config/modWhitelist`

/* Is the caller a moderator? They send their Firebase ID token; the
   whitelist is read from Firestore AS them, and its rule only answers a
   signed-in user — so a 200 is Google vouching for the token, and the
   email inside it can then be trusted without verifying the signature here. */
async function isModerator(idToken) {
  if (!idToken) return false
  const res = await fetch(WHITELIST_URL, { headers: { Authorization: "Bearer " + idToken } })
  if (!res.ok) return false
  const doc = await res.json()
  const emails = ((doc.fields && doc.fields.emails && doc.fields.emails.arrayValue.values) || [])
    .map(v => String(v.stringValue || "").toLowerCase())
  const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"))
  return !!claims.email && claims.email_verified === true && emails.includes(claims.email.toLowerCase())
}

app.post("/send", async (req, res) => {
  // message  -> plain text (Discord "content")
  // embed    -> rich card   (Discord "embed", the analog of LINE flexMessage)
  const { message, embed } = req.body || {}

  if (!DISCORD_WEBHOOK) {
    return res.status(500).json({ ok: false, error: "No Discord webhook URL configured" })
  }

  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer /, "")
    if (!(await isModerator(idToken))) {
      return res.status(403).json({ ok: false, error: "Only moderators can post to Discord" })
    }

    const payload = embed
      ? { embeds: [embed] }
      : { content: message }

    // ?wait=true makes Discord return the created message JSON (like LINE's response),
    // otherwise a successful post is a bare 204 No Content.
    const response = await fetch(DISCORD_WEBHOOK + "?wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })

    // An error page from Discord (or a proxy in front of it) isn't JSON.
    const text = await response.text()
    let result
    try { result = text ? JSON.parse(text) : { status: response.status } }
    catch (e) { result = { status: response.status } }
    console.log("Discord response:", JSON.stringify(result))
    res.json({ ok: response.ok, discordResult: result })
  } catch (e) {
    console.error("Send failed:", e)
    res.status(502).json({ ok: false, error: "Could not reach Discord" })
  }
})

// Webhooks are send-only, so Discord never calls back here — this route exists only
// to keep the file structurally identical to the LINE bot. It becomes real if you
// ever upgrade to a full bot with slash commands / interactions.
app.post("/webhook", (req, res) => {
  console.log("Discord inbound:", JSON.stringify(req.body))
  res.sendStatus(200)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Discord server running on port ${PORT}`))
