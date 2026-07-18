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
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "PASTE_YOUR_DISCORD_WEBHOOK_URL_HERE"

app.post("/send", async (req, res) => {
  // webhookUrl mirrors LINE's `groupId` (which target to post to), and is optional
  // message  -> plain text (Discord "content")
  // embed    -> rich card   (Discord "embed", the analog of LINE flexMessage)
  const { webhookUrl, message, embed } = req.body

  const url = webhookUrl || DISCORD_WEBHOOK
  if (!url || url === "PASTE_YOUR_DISCORD_WEBHOOK_URL_HERE") {
    return res.status(400).json({ ok: false, error: "No Discord webhook URL configured" })
  }

  const payload = embed
    ? { embeds: [embed] }
    : { content: message }

  // ?wait=true makes Discord return the created message JSON (like LINE's response),
  // otherwise a successful post is a bare 204 No Content.
  const response = await fetch(url + "?wait=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })

  const text = await response.text()
  const result = text ? JSON.parse(text) : { status: response.status }
  console.log("Discord response:", JSON.stringify(result))
  res.json({ ok: response.ok, discordResult: result })
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
