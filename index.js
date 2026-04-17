const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// CONFIG
const VERIFY_TOKEN = "mul_token_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = "1065169533344109";

// Home
app.get("/", (req, res) => {
  res.send("MUL WhatsApp Backend Running 🚀");
});

// Webhook verify
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// Send message function
async function sendMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Send error:", error.response?.data || error.message);
  }
}

// Receive messages
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (msg) {
      const from = msg.from;
      const text = msg.text?.body?.trim().toLowerCase();

      let reply = "";

      if (!text || text === "hi" || text === "hello" || text === "menu") {
        reply = `👋 Welcome to Minhaj University Lahore

Please choose an option:

1️⃣ Programs
2️⃣ Fee
3️⃣ Scholarships
4️⃣ Apply
5️⃣ Talk to Agent`;
      } else if (text === "1") {
        reply = "📘 We offer BS CS, IT, AI, Business, Media and many more programs.";
      } else if (text === "2") {
        reply = "💰 Fee depends on the program. Please send your program name.";
      } else if (text === "3") {
        reply = "🎓 Scholarships are available on merit and need basis.";
      } else if (text === "4") {
        reply = "📝 Apply here: https://admission.mul.edu.pk/";
      } else if (text === "5") {
        reply = "👤 Please send your details in this format:\nName, Program\nExample: Ali, BS CS";
      } else if (text.includes(",")) {
        reply = "✅ Thank you! Our admissions team will contact you soon.";
      } else {
        reply = "Please type 1, 2, 3, 4 or 5.";
      }

      await sendMessage(from, reply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
    res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
