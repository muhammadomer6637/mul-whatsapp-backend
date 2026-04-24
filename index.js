const express = require("express");
const axios = require("axios");
const path = require("path");
const pool = require("./db/db");
const { testConnection } = require("./db/db");
const initDb = require("./db/initDb");

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(path.join(__dirname, "public")));

// CONFIG
const VERIFY_TOKEN = "mul_token_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = "1065169533344109";
const BASE_URL =
  process.env.BASE_URL ||
  "https://mul-whatsapp-backend-production.up.railway.app";

// Temporary in-memory user state
const userStates = {};

// =========================
// PROGRAM DATA
// =========================
const PROGRAMS = {
  adp: [
    "Associate Degree in Business Administration",
    "Associate Degree in Accounting & Finance",
    "Associate Degree in Islamic Banking and Finance",
    "Associate Degree in Commerce",
    "Associate Degree in Computer Science",
    "ADP Information System & Technology Management",
    "Associate Degree in Mass Communication",
    "Associate Degree in Education",
    "Associate Degree in Information Technology",
    "Associate Degree in Software Engineering",
    "Associate Degree in Artificial Intelligence",
    "Associate Degree in Cyber Security",
    "Associate Degree in Bioinformatics",
    "Associate Degree in Political Science",
    "Associate Degree in Sociology",
    "Associate Degree in English",
    "Associate Degree in Digital Marketing",
    "Associate Degree in Psychology",
    "Associate Degree in Data Science",
    "Associate Degree in Digital Media Communication"
  ],
  bs: [
    "B.Com (Hons)",
    "BS Accounting & Finance",
    "BBA",
    "BS Islamic Banking & Finance",
    "BS Islamic Banking & Finance Technology",
    "BS Economics & Data Science",
    "BS Economics & Financial Technology",
    "BS Computer Science",
    "BS Information System & Technology Management",
    "BS Information Technology",
    "BS Software Engineering",
    "BS Data Science",
    "BS Cyber Security",
    "BS Artificial Intelligence",
    "BS Chemistry & Industrial Entrepreneurship",
    "Doctor of Pharmacy",
    "BS Computational Plant Sciences",
    "BS Zoology & Entomology",
    "BS Bio Chemistry",
    "BS Biotechnology",
    "BS Medical Lab Technology",
    "BS Human Nutrition & Dietetics",
    "BS Food Science and Technology",
    "BS Criminology and Forensic Sciences",
    "BS Mathematics & Data Science",
    "BS Statistics & Data Science",
    "BS Information Management",
    "BS English",
    "BS Mass Communication",
    "BS Sociology",
    "BS Education",
    "BS Peace & Conflict Studies",
    "BS E-Commerce",
    "BS in Digital Media Communication",
    "BS in Digital Marketing",
    "BS in Multimedia Arts",
    "BS in Financial Technology",
    "BS Defense and Strategic Studies",
    "BS International Relations",
    "BS Political Science",
    "BS Economics",
    "BS Business Analytics",
    "BS Psychology",
    "BS Governance and Public Policy",
    "Doctor of Physiotherapy",
    "Bachelor of Laws (LLB)"
  ],
  mphil: [
    "MBA Professional",
    "MBA Executive",
    "M.Phil Management Science",
    "M.Phil Accounting & Finance",
    "MS Islamic Banking & Finance",
    "M.Phil Economics",
    "M.Phil Computer Science",
    "MS Software Engineering",
    "MS Data Science",
    "M.Phil Chemistry",
    "M.Phil Botany",
    "M.Phil Zoology",
    "M.Phil Clinical Nutrition",
    "M.Phil Food Science & Technology",
    "M.Phil Bio Chemistry",
    "M.Phil Education",
    "M.Phil English (Linguistics)",
    "M.Phil English (Literature)",
    "M.Phil Mathematics",
    "M.Phil Statistics",
    "M.Phil Urdu",
    "M.Phil International Relations",
    "M.Phil Political Science",
    "M.Phil Sociology",
    "M.Phil Mass Communication",
    "M.Phil Library Information Science",
    "M.Phil Peace & Counter Terrorism",
    "M.Phil Theology and Religious Studies",
    "M.Phil Criminology",
    "M.Phil Pharmacology",
    "M.Phil Applied Psychology",
    "M.Phil in Halal Food Safety Management"
  ],
  phd: [
    "Ph.D International Relations",
    "Ph.D Mathematics",
    "Ph.D Islamic Economics & Finance",
    "Ph.D Economics",
    "Ph.D Bio Chemistry",
    "Ph.D Food Science & Technology",
    "Ph.D Mass Communication",
    "Ph.D Pharmacology",
    "Ph.D Peace and Counter Terrorism",
    "Ph.D Education"
  ]
};

// =========================
// DATABASE HELPERS
// =========================
async function createUserIfNotExists(phone, name = null) {
  try {
    await pool.query(
      `
      INSERT INTO users (phone, name, mode)
      VALUES ($1, $2, 'bot')
      ON CONFLICT (phone) DO NOTHING
      `,
      [phone, name]
    );
  } catch (err) {
    console.error("createUserIfNotExists error:", err.message);
  }
}

async function updateUserDetails(
  phone,
  { name = null, program = null, mode = null }
) {
  try {
    await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE($2, name),
        program = COALESCE($3, program),
        mode = COALESCE($4, mode)
      WHERE phone = $1
      `,
      [phone, name, program, mode]
    );
  } catch (err) {
    console.error("updateUserDetails error:", err.message);
  }
}

async function getUserByPhone(phone) {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE phone = $1 LIMIT 1`,
      [phone]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("getUserByPhone error:", err.message);
    return null;
  }
}

async function saveMessage({
  phone,
  sender,
  type = "text",
  text = null,
  media_id = null,
  media_url = null,
  file_name = null,
  mime_type = null
}) {
  try {
    await pool.query(
      `
      INSERT INTO messages
      (phone, sender, type, text, media_id, media_url, file_name, mime_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [phone, sender, type, text, media_id, media_url, file_name, mime_type]
    );
  } catch (err) {
    console.error("saveMessage error:", err.message);
  }
}

async function upsertChat(phone, lastMessage, status = "active") {
  try {
    await pool.query(
      `
      INSERT INTO chats (phone, status, last_message, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (phone)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_message = EXCLUDED.last_message,
        updated_at = NOW()
      `,
      [phone, status, lastMessage]
    );
  } catch (err) {
    console.error("upsertChat error:", err.message);
  }
}

async function incrementUnreadAndSetIncoming(phone, lastMessage, status = "active") {
  try {
    await pool.query(
      `
      INSERT INTO chats (
        phone,
        status,
        last_message,
        unread_count,
        last_incoming_at,
        updated_at
      )
      VALUES ($1, $2, $3, 1, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_message = EXCLUDED.last_message,
        unread_count = chats.unread_count + 1,
        last_incoming_at = NOW(),
        updated_at = NOW()
      `,
      [phone, status, lastMessage]
    );
  } catch (err) {
    console.error("incrementUnreadAndSetIncoming error:", err.message);
  }
}

async function setOutgoingMeta(phone, lastMessage, status = "active") {
  try {
    await pool.query(
      `
      INSERT INTO chats (
        phone,
        status,
        last_message,
        unread_count,
        last_outgoing_at,
        updated_at
      )
      VALUES ($1, $2, $3, 0, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE SET
        status = EXCLUDED.status,
        last_message = EXCLUDED.last_message,
        last_outgoing_at = NOW(),
        updated_at = NOW()
      `,
      [phone, status, lastMessage]
    );
  } catch (err) {
    console.error("setOutgoingMeta error:", err.message);
  }
}

async function resetUnreadCount(phone) {
  try {
    await pool.query(
      `
      UPDATE chats
      SET unread_count = 0, updated_at = NOW()
      WHERE phone = $1
      `,
      [phone]
    );
  } catch (err) {
    console.error("resetUnreadCount error:", err.message);
  }
}

// =========================
// MESSAGE HELPERS
// =========================
function splitIntoChunks(items, size = 12) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function welcomeMessage() {
  return `Assalamu Alaikum 👋

Welcome to Minhaj University Lahore.

Please choose an option:

1. Programs
2. Fee Structure
3. Scholarships
4. How to Apply
5. Other Support
6. Talk to Agent`;
}

function programsMenu() {
  return `📚 Programs Categories

1a. Associate Degree Programs (ADP)
1b. BS Programs
1c. M.Phil./MS Programs
1d. Ph.D. Programs`;
}

function howToApplyMenu() {
  return `📝 How to Apply

4a. On Campus
4b. Online
4c. Documents Requirements`;
}

function otherSupportMenu() {
  return `📞 Other Support

5a. Students Affairs Office
5b. Examination
5c. Accounts Office
5d. Admissions`;
}

function formatProgramChunk(title, items, currentIndex, totalChunks, baseCode) {
  const list = items.map((item) => `• ${item}`).join("\n");
  let msg = `🎓 ${title}\n\n${list}`;

  if (currentIndex < totalChunks - 1) {
    msg += `\n\nReply ${baseCode}-more for more programs`;
  }

  msg += `\nReply APPLY to apply online`;

  return msg;
}

function getProgramResponse(code) {
  const mapping = {
    "1a": { title: "Associate Degree Programs (ADP)", key: "adp" },
    "1b": { title: "BS Programs", key: "bs" },
    "1c": { title: "M.Phil./MS Programs", key: "mphil" },
    "1d": { title: "Ph.D. Programs", key: "phd" }
  };

  const item = mapping[code];
  if (!item) return null;

  const chunks = splitIntoChunks(PROGRAMS[item.key], 12);
  return formatProgramChunk(item.title, chunks[0], 0, chunks.length, code);
}

function getMoreProgramResponse(code) {
  const mapping = {
    "1a-more": {
      title: "Associate Degree Programs (ADP)",
      key: "adp",
      index: 1
    },
    "1b-more": { title: "BS Programs", key: "bs", index: 1 },
    "1c-more": { title: "M.Phil./MS Programs", key: "mphil", index: 1 },
    "1d-more": { title: "Ph.D. Programs", key: "phd", index: 1 }
  };

  const item = mapping[code];
  if (!item) return null;

  const chunks = splitIntoChunks(PROGRAMS[item.key], 12);
  if (!chunks[item.index]) {
    return `No more programs in this category.`;
  }

  return formatProgramChunk(
    item.title + " (More)",
    chunks[item.index],
    item.index,
    chunks.length,
    code.replace("-more", "")
  );
}

function applyNowMessage() {
  return `📝 Apply Now Online:
https://admission.mul.edu.pk/`;
}

// =========================
// WHATSAPP SEND HELPERS
// =========================
async function sendTextMessage(to, message, chatStatus = "active") {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    await saveMessage({
      phone: to,
      sender: "bot",
      type: "text",
      text: message
    });

    await setOutgoingMeta(to, message, chatStatus);
  } catch (error) {
    console.error("Send text error:", error.response?.data || error.message);
  }
}

async function sendDocumentMessage(
  to,
  documentUrl,
  filename,
  caption = "",
  chatStatus = "active"
) {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: documentUrl,
          filename,
          caption
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    await saveMessage({
      phone: to,
      sender: "bot",
      type: "document",
      text: caption || filename,
      media_url: documentUrl,
      file_name: filename,
      mime_type: "application/pdf"
    });

    await setOutgoingMeta(to, caption || filename, chatStatus);
  } catch (error) {
    console.error("Send document error:", error.response?.data || error.message);
  }
}

async function sendAgentTextMessage(to, message, chatStatus = "agent_active") {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    await saveMessage({
      phone: to,
      sender: "agent",
      type: "text",
      text: message
    });

    await setOutgoingMeta(to, message, chatStatus);
  } catch (error) {
    console.error(
      "Send agent text error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

async function sendReplyButtons(to, bodyText, buttons, chatStatus = "active") {
  try {
    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: bodyText
          },
          action: {
            buttons: buttons.map((btn) => ({
              type: "reply",
              reply: {
                id: btn.id,
                title: btn.title
              }
            }))
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    await saveMessage({
      phone: to,
      sender: "bot",
      type: "interactive",
      text: bodyText
    });

    await setOutgoingMeta(to, bodyText, chatStatus);
  } catch (error) {
    console.error("Send reply buttons error:", error.response?.data || error.message);
  }
}

// =========================
// ROUTES
// =========================
app.get("/", (req, res) => {
  res.send("MUL WhatsApp Backend Running 🚀");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const contact = req.body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

    if (!msg) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const contactName = contact?.profile?.name || null;
    const type = msg.type || "text";

    let text = msg.text?.body?.trim() || "";
    if (type === "interactive" && msg.interactive?.type === "button_reply") {
      text = msg.interactive.button_reply.id || "";
    }
    const lowerText = text?.toLowerCase();

    let incomingText = "";
    let media_id = null;
    let media_url = null;
    let file_name = null;
    let mime_type = null;

    if (type === "text") {
      incomingText = text || "";
    } else if (type === "interactive" && msg.interactive?.type === "button_reply") {
      incomingText = msg.interactive.button_reply?.title || text || "[Button Reply]";
    } else if (type === "image") {
      incomingText = "[Image]";
      media_id = msg.image?.id || null;
      mime_type = msg.image?.mime_type || null;
    } else if (type === "document") {
      incomingText = msg.document?.filename || "[Document]";
      media_id = msg.document?.id || null;
      file_name = msg.document?.filename || null;
      mime_type = msg.document?.mime_type || null;
    } else if (type === "video") {
      incomingText = "[Video]";
      media_id = msg.video?.id || null;
      mime_type = msg.video?.mime_type || null;
    } else if (type === "audio") {
      incomingText = "[Audio]";
      media_id = msg.audio?.id || null;
      mime_type = msg.audio?.mime_type || null;
    } else {
      incomingText = `[${type}]`;
    }

    console.log(
      "Incoming message from:",
      from,
      "| type:",
      type,
      "| text:",
      incomingText
    );

    await createUserIfNotExists(from, contactName);
    await updateUserDetails(from, { name: contactName });

    if (!userStates[from]) {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false,
        hasInteracted: false
      };
    }

    const currentUser = await getUserByPhone(from);
    const currentMode = currentUser?.mode || "bot";

    await saveMessage({
      phone: from,
      sender: "user",
      type,
      text: incomingText,
      media_id,
      media_url,
      file_name,
      mime_type
    });

    const incomingChatStatus =
      currentMode === "agent" ? "agent_waiting" : "active";

    await incrementUnreadAndSetIncoming(from, incomingText, incomingChatStatus);

    if (currentMode === "agent") {
      console.log(`Bot stopped for ${from} because user is in agent mode.`);
      return res.sendStatus(200);
    }

    if (!text && type !== "text" && type !== "interactive") {
      return res.sendStatus(200);
    }

    if (!text) {
      return res.sendStatus(200);
    }

    // AUTO MENU FOR FIRST MESSAGE
    if (!userStates[from].hasInteracted) {
      userStates[from].hasInteracted = true;

      if (!["1", "2", "3", "4", "5", "6", "apply"].includes(lowerText)) {
        await sendTextMessage(from, welcomeMessage());
        return res.sendStatus(200);
      }
    }

    if (lowerText === "main_menu") {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false,
        hasInteracted: true
      };
      await sendTextMessage(from, welcomeMessage());
      return res.sendStatus(200);
    }

    if (lowerText === "back") {
      const prev = userStates[from].previousMenu || "main";

      if (prev === "main") {
        userStates[from].currentMenu = "main";
        await sendTextMessage(from, welcomeMessage());
      } else if (prev === "programs") {
        userStates[from].currentMenu = "programs";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          programsMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else if (prev === "apply") {
        userStates[from].currentMenu = "apply";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          howToApplyMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else if (prev === "other_support") {
        userStates[from].currentMenu = "other_support";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          otherSupportMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else {
        await sendTextMessage(from, welcomeMessage());
      }

      return res.sendStatus(200);
    }

    if (lowerText === "0") {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false,
        hasInteracted: true
      };
      await sendTextMessage(from, welcomeMessage());
      return res.sendStatus(200);
    }

    if (lowerText === "9") {
      const prev = userStates[from].previousMenu || "main";

      if (prev === "main") {
        userStates[from].currentMenu = "main";
        await sendTextMessage(from, welcomeMessage());
      } else if (prev === "programs") {
        userStates[from].currentMenu = "programs";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          programsMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else if (prev === "apply") {
        userStates[from].currentMenu = "apply";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          howToApplyMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else if (prev === "other_support") {
        userStates[from].currentMenu = "other_support";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          otherSupportMenu(),
          [{ id: "main_menu", title: "Main Menu" }]
        );
      } else {
        await sendTextMessage(from, welcomeMessage());
      }

      return res.sendStatus(200);
    }

    if (lowerText === "apply") {
      await sendTextMessage(from, applyNowMessage());
      return res.sendStatus(200);
    }

    if (userStates[from].awaitingLead && text.includes(",")) {
      const [name, ...rest] = text.split(",");
      const program = rest.join(",").trim();
      const cleanName = name.trim();

      console.log("Lead captured:", {
        phone: from,
        name: cleanName,
        program
      });

      userStates[from].awaitingLead = false;
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "agent_waiting";
      userStates[from].hasInteracted = true;

      await updateUserDetails(from, {
        name: cleanName,
        program,
        mode: "agent"
      });

      await upsertChat(from, `Lead: ${cleanName} - ${program}`, "agent_waiting");

      await sendTextMessage(
        from,
        `✅ Thank you!

Your request has been forwarded to our support team.

Please wait, our admission representative will message you shortly.`,
        "agent_waiting"
      );

      return res.sendStatus(200);
    }

    if (
      [
        "hi",
        "hello",
        "assalamualaikum",
        "assalamu alaikum",
        "menu",
        "start"
      ].includes(lowerText)
    ) {
      userStates[from].currentMenu = "main";
      userStates[from].previousMenu = "main";
      userStates[from].awaitingLead = false;
      userStates[from].hasInteracted = true;

      await sendTextMessage(from, welcomeMessage());
      return res.sendStatus(200);
    }

    if (lowerText === "1") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "programs";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        programsMenu(),
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (["1a", "1b", "1c", "1d"].includes(lowerText)) {
      const response = getProgramResponse(lowerText);
      userStates[from].previousMenu = "programs";
      userStates[from].currentMenu = lowerText;
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        response,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (["1a-more", "1b-more", "1c-more", "1d-more"].includes(lowerText)) {
      const response = getMoreProgramResponse(lowerText);
      userStates[from].previousMenu = "programs";
      userStates[from].currentMenu = lowerText;
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        response,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "2") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "fee";
      userStates[from].hasInteracted = true;

      const pdfUrl = `${BASE_URL}/files/Fee%20Structure%20Spring%202026.pdf`;

      await sendReplyButtons(
        from,
        `💰 Fee Structure – Spring 2026

Please find attached the complete fee structure.`,
        [{ id: "main_menu", title: "Main Menu" }]
      );

      await sendDocumentMessage(
        from,
        pdfUrl,
        "Fee Structure Spring 2026.pdf",
        "MUL Fee Structure Spring 2026"
      );

      return res.sendStatus(200);
    }

    if (lowerText === "3") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "scholarship";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `🎓 Scholarships

For scholarship details please visit:
https://www.mul.edu.pk/en/scholarships-and-fee-concession`,
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "apply";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        howToApplyMenu(),
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4a") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4a";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `🏫 On Campus Admission

Please visit University admissions office with required documents.
Buy Prospectus, fill Prospectus and attach documents.
Get Admission Fee challan and pay in Account Office or affiliated banks.`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4b") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4b";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `🌐 Online Admission

For Apply Online please visit:
https://admission.mul.edu.pk/

Create your account by clicking Register.
After registration complete your Profile and download admission processing challan.
Pay challan through online banking apps or affiliated banks.

Status may take 24 hours to update after payment.
Once status changes from Pending to Paid, upload your documents and agree to terms & conditions.

Your application will be submitted successfully.
You will receive admission fee challan once your admission application is accepted.
It may take 24 to 48 hours for processing.`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4c") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4c";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `📄 Documents Requirements

• Academic Results / Transcripts / Sanad
• Student CNIC copy or B Form
• Father CNIC copy
• Domicile
• 5 Photographs

All documents should be attested.`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "5") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "other_support";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        otherSupportMenu(),
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (lowerText === "5a") {
      userStates[from].previousMenu = "other_support";
      userStates[from].currentMenu = "5a";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `🎓 Students Affairs Office

Contact Details:
042-35145621-6
Extension: 346 & 446
Email: support.dsa@mul.edu.pk`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5b") {
      userStates[from].previousMenu = "other_support";
      userStates[from].currentMenu = "5b";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `📝 Examination

Contact Details:
042-35145621-6
Extension: 317 & 307
Email: support.exams@mul.edu.pk`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5c") {
      userStates[from].previousMenu = "other_support";
      userStates[from].currentMenu = "5c";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `💳 Accounts Office

Contact Details:
042-35145621-6
Extension: 310 & 388
Email: support.accounts@mul.edu.pk`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5d") {
      userStates[from].previousMenu = "other_support";
      userStates[from].currentMenu = "5d";
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        `🎓 Admissions

Contact Details:
03111222685
Email: admissions@mul.edu.pk`,
        [
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );
      return res.sendStatus(200);
    }

    if (lowerText === "6") {
      userStates[from].awaitingLead = true;
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "agent";
      userStates[from].hasInteracted = true;

      await sendTextMessage(
        from,
        `👤 Talk to Agent

Please send your details:

Name, Program

Example:
Ali, BS Computer Science`
      );

      return res.sendStatus(200);
    }

    await sendTextMessage(
      from,
      `Sorry, I did not understand your message.

Please choose:
1 Programs
2 Fee Structure
3 Scholarships
4 How to Apply
5 Other Support
6 Talk to Agent`
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error(
      "Webhook error:",
      error.response?.data || error.message || error
    );
    return res.sendStatus(500);
  }
});

// =========================
// AGENT PANEL APIs
// =========================
app.get("/api/chats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.phone,
        c.status,
        c.last_message,
        c.unread_count,
        c.last_incoming_at,
        c.last_outgoing_at,
        c.updated_at,
        u.name,
        u.program,
        u.mode
      FROM chats c
      LEFT JOIN users u ON u.phone = c.phone
      ORDER BY
        CASE
          WHEN c.status = 'agent_waiting' THEN 0
          WHEN c.status = 'agent_active' THEN 1
          ELSE 2
        END,
        c.updated_at DESC
    `);

    return res.json({
      success: true,
      chats: result.rows
    });
  } catch (error) {
    console.error("GET /api/chats error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch chats"
    });
  }
});

app.get("/api/messages/:phone", async (req, res) => {
  try {
    const { phone } = req.params;

    const result = await pool.query(
      `
      SELECT id, phone, sender, type, text, media_id, media_url, file_name, mime_type, created_at
      FROM messages
      WHERE phone = $1
      ORDER BY created_at ASC
      `,
      [phone]
    );

    return res.json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error("GET /api/messages/:phone error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch messages"
    });
  }
});

app.post("/api/send", async (req, res) => {
  try {
    const { phone, message } = req.body;

    console.log("API SEND REQUEST:", { phone, message });

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "phone and message are required"
      });
    }

    await updateUserDetails(phone, { mode: "agent" });
    await sendAgentTextMessage(phone, message, "agent_active");

    return res.json({
      success: true,
      message: "Agent message sent successfully"
    });
  } catch (error) {
    console.error(
      "POST /api/send full error:",
      error.response?.data || error.message || error
    );

    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || "Failed to send agent message"
    });
  }
});

app.post("/api/switch-mode", async (req, res) => {
  try {
    const { phone, mode } = req.body;

    if (!phone || !mode) {
      return res.status(400).json({
        success: false,
        error: "phone and mode are required"
      });
    }

    if (!["bot", "agent"].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: "mode must be bot or agent"
      });
    }

    await updateUserDetails(phone, { mode });

    let chatStatus = "active";
    let lastMessage = "Chat switched to bot mode";

    if (mode === "agent") {
      chatStatus = "agent_active";
      lastMessage = "Chat switched to agent mode";
    }

    await upsertChat(phone, lastMessage, chatStatus);

    if (!userStates[phone]) {
      userStates[phone] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false,
        hasInteracted: true
      };
    }

    if (mode === "bot") {
      userStates[phone].awaitingLead = false;
      userStates[phone].currentMenu = "main";
      userStates[phone].previousMenu = "main";
    }

    return res.json({
      success: true,
      message: `Mode switched to ${mode}`
    });
  } catch (error) {
    console.error("POST /api/switch-mode error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to switch mode"
    });
  }
});

app.post("/api/mark-read", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "phone is required"
      });
    }

    await resetUnreadCount(phone);

    return res.json({
      success: true,
      message: "Unread count reset successfully"
    });
  } catch (error) {
    console.error("POST /api/mark-read error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to reset unread count"
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const range = req.query.range || "24h";
    const start = req.query.start;
    const end = req.query.end;

    let intervalSql = "INTERVAL '24 hours'";
    if (range === "7d") intervalSql = "INTERVAL '7 days'";
    if (range === "30d") intervalSql = "INTERVAL '30 days'";

    let whereCreated = `created_at >= NOW() - ${intervalSql}`;

    if (range === "custom" && start && end) {
      whereCreated = `created_at BETWEEN '${start}'::timestamp AND '${end}'::timestamp`;
    }

    const conversationsStarted = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE ${whereCreated}
    `);

    const unreadConversations = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM chats
      WHERE unread_count > 0
    `);

    const totalUnreadMessages = await pool.query(`
      SELECT COALESCE(SUM(unread_count), 0)::int AS count
      FROM chats
    `);

    const agentWaiting = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM chats
      WHERE status = 'agent_waiting'
    `);

    const agentActive = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM chats
      WHERE status = 'agent_active'
    `);

    const activeWithBot = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users u
      JOIN chats c ON c.phone = u.phone
      WHERE u.mode = 'bot'
      AND c.last_incoming_at >= NOW() - INTERVAL '10 minutes'
    `);

    const activeWithAgent = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users u
      JOIN chats c ON c.phone = u.phone
      WHERE u.mode = 'agent'
      AND c.last_incoming_at >= NOW() - INTERVAL '10 minutes'
    `);

    const topPrograms = await pool.query(`
      SELECT
        program,
        COUNT(*)::int AS inquiries
      FROM users
      WHERE program IS NOT NULL
        AND TRIM(program) <> ''
        AND ${whereCreated}
      GROUP BY program
      ORDER BY inquiries DESC, program ASC
      LIMIT 10
    `);

    const recentLeads = await pool.query(`
      SELECT
        u.name,
        u.program,
        u.phone,
        c.status,
        c.updated_at
      FROM users u
      LEFT JOIN chats c ON c.phone = u.phone
      WHERE u.program IS NOT NULL
        AND TRIM(u.program) <> ''
      ORDER BY c.updated_at DESC NULLS LAST
      LIMIT 10
    `);

    return res.json({
      success: true,
      filters: { range, start: start || null, end: end || null },
      stats: {
        conversationsStarted: conversationsStarted.rows[0].count,
        unreadConversations: unreadConversations.rows[0].count,
        totalUnreadMessages: totalUnreadMessages.rows[0].count,
        agentWaiting: agentWaiting.rows[0].count,
        agentActive: agentActive.rows[0].count,
        activeWithBot: activeWithBot.rows[0].count,
        activeWithAgent: activeWithAgent.rows[0].count
      },
      topPrograms: topPrograms.rows,
      recentLeads: recentLeads.rows
    });
  } catch (error) {
    console.error("GET /api/dashboard error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard data"
    });
  }
});

app.listen(3000, async () => {
  console.log("Server running on port 3000");

  await testConnection();
  await initDb();

  // 🔥 MEDIA COLUMNS AUTO ADD (RUN ONCE)
  try {
    await pool.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS message_type VARCHAR(30) DEFAULT 'text',
      ADD COLUMN IF NOT EXISTS media_id TEXT,
      ADD COLUMN IF NOT EXISTS media_url TEXT,
      ADD COLUMN IF NOT EXISTS mime_type TEXT,
      ADD COLUMN IF NOT EXISTS file_name TEXT,
      ADD COLUMN IF NOT EXISTS caption TEXT;
    `);

    console.log("✅ Media columns ensured in DB");
  } catch (err) {
    console.error("❌ Media columns error:", err.message);
  }
});
