const express = require("express")
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args))
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

const TOKEN = "zooSrMsoUz4bTWZNMGqqO2IaGguT0rPFpHnQEvCucVGgL6SSJDt8gVtUcGLEbpBKcAPEyIvg6AGDq4M1OKvBE4HNGVFNiGiZmbq40NhmXXuBV8ulyybl7352vaHU0GC4DqvauajEtCRWoVqVzm0jxAdB04t89/1O/w1cDnyilFU="

app.post("/send", async (req, res) => {
  const { groupId, message, flexMessage } = req.body

  const messages = flexMessage
    ? [flexMessage]
    : [{ type: "text", text: message }]

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ to: groupId, messages })
  })

  const result = await response.json()
  console.log("LINE response:", JSON.stringify(result))
  res.json({ ok: true, lineResult: result })
})

app.post("/webhook", (req, res) => {
  const events = req.body.events
  if (events && events.length > 0) {
    const source = events[0].source
    console.log("Source:", JSON.stringify(source))
  }
  res.sendStatus(200)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))