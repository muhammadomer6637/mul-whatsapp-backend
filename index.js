const express = require("express");
const app = express();

app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("MUL WhatsApp Backend Running 🚀");
});

// Webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = "mul_token_123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// Webhook receive message
app.post("/webhook", (req, res) => {
  console.log("Message received:", JSON.stringify(req.body, null, 2));

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
