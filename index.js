const express = require("express")
const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args))
const cors = require("cors")

const app = express()
app.use(cors())
app.use(express.json())

const TOKEN = "zooSrMsoUz4bTWZNMGqqO2IaGguT0rPFpHnQEvCucVGgL6SSJDt8gVtUcGLEbpBKcAPEyIvg6AGDq4M1OKvBE4HNGVFNiGiZmbq40NhmXXuBV8ulyybl7352vaHU0GC4DqvauajEtCRWoVqVzm0jxAdB04t89/1O/w1cDnyilFU="

app.post("/send", async (req, res) => {
  const { groupId, message } = req.body

  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: groupId,
      messages: [{ type: "text", text: message }]
    })
  })

  res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))