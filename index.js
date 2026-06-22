const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db/db");
const { testConnection } = require("./db/db");
const initDb = require("./db/initDb");

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(path.join(__dirname, "public")));
const uploadsDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// CONFIG
const VERIFY_TOKEN = "mul_token_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = "1065169533344109";
const BASE_URL =
  process.env.BASE_URL ||
  "https://mul-whatsapp-backend-production.up.railway.app";
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateAgent(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized access"
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    req.agent = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired token"
    });
  }
}

function requireAdmin(req, res, next) {
  if (!req.agent || req.agent.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Admin access required"
    });
  }

  next();
}

// Temporary in-memory user state
const userStates = {};

async function isAgentAvailable() {
  try {
    const result = await pool.query(
      "SELECT value FROM system_settings WHERE key = 'agent_available'"
    );
    return result.rows[0]?.value === "true";
  } catch (err) {
    console.error("Agent status error:", err.message);
    return true;
  }
}

// Track agent category selection
// admissions | other
// per user

// =========================
// REAL-TIME SSE HELPERS
// =========================
const sseClients = [];

function sendSseEvent(eventName, data = {}) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch (err) {
      console.error("SSE write error:", err.message);
    }
  });
}

function notifyChatUpdated(phone) {
  sendSseEvent("chat_updated", {
    phone,
    time: new Date().toISOString()
  });
}

// =========================
// PROGRAM DATA
// =========================
const PROGRAMS = {
  adp: [
    "ADP Information System & Technology Management",
    "Associate Degree in Accounting and Finance",
    "Associate Degree in Artificial Intelligence",
    "Associate Degree in Arts",
    "Associate Degree in Bioinformatics",
    "Associate Degree in Business Administration",
    "Associate Degree in Commerce",
    "Associate Degree in Computer Science",
    "Associate Degree in Culinary Arts",
    "Associate Degree in Cyber Security",
    "Associate Degree in Data Science",
    "Associate Degree in Digital Marketing",
    "Associate Degree in Digital Media Communication",
    "Associate Degree in Education",
    "Associate Degree in English",
    "Associate Degree in Fine Arts",
    "Associate Degree in Information Technology",
    "Associate Degree in Islamic Banking and Finance",
    "Associate Degree in Mass Communication",
    "Associate Degree in Political Science",
    "Associate Degree in Sociology",
    "Associate Degree in Software Engineering",
    "Associate Degree Program in Psychology"
  ],

  bs: [
    "B.Com (Hons)",
    "Doctor of Pharmacy",
    "LLB (4 Years)",
    "B.Sc Chemical Engineering",
    "B.Sc Electrical Engineering",
    "Bachelor of Science in Aesthetics and Cosmetology",
    "Bachelor of Science in Computational Linguistics",
    "BBA",
    "BS Accounting and Finance",
    "BS Artificial Intelligence",
    "BS Biochemistry",
    "BS Biotechnology",
    "BS Business Analytics",
    "BS Chemistry & Industrial Entrepreneurship",
    "BS Computational Plant Sciences",
    "BS Computer Science",
    "BS Criminology and Forensic Science",
    "BS Cyber Security",
    "BS Data Science",
    "BS Digital Marketing",
    "BS Digital Media Communication",
    "BS E-Commerce",
    "BS Economics",
    "BS Economics & Data Science",
    "BS Economics & Financial Technology",
    "BS Education",
    "BS English",
    "BS Financial Technology",
    "BS Food Science & Technology",
    "BS Human Nutrition and Dietetics",
    "BS Information Management",
    "BS Information System & Technology Management",
    "BS Information Technology",
    "BS International Relations",
    "BS Islamic Banking & Finance",
    "BS Islamic Banking & Financial Technology",
    "BS Mass Communication",
    "BS Mathematics & Data Science",
    "BS Medical Laboratory Technology",
    "BS Multimedia Arts Animation",
    "BS Peace and Conflict Studies",
    "BS Political Science",
    "BS Psychology",
    "BS Sociology",
    "BS Software Engineering",
    "BS Statistics & Data Science",
  ],

  mphil: [
    "M.Phil Accounting and Finance",
    "M.Phil Applied Psychology",
    "M.Phil Biochemistry",
    "M.Phil Botany",
    "M.Phil Chemistry",
    "M.Phil Clinical Nutrition",
    "M.Phil Computer Science",
    "M.Phil Criminology",
    "M.Phil Economics",
    "M.Phil Education",
    "M.Phil English (Applied Linguistics)",
    "M.Phil English (Literature)",
    "M.Phil Halal Food and Safety Management",
    "M.Phil International Relations",
    "M.Phil Library & Information Science",
    "M.Phil Management Science",
    "M.Phil Mass Communication",
    "M.Phil Mathematics",
    "M.Phil Peace and Counter Terrorism",
    "M.Phil Pharmacology",
    "M.Phil Physics",
    "M.Phil Political Science",
    "M.Phil Sociology",
    "M.Phil Statistics",
    "M.Phil Theology and Religious Studies",
    "M.Phil Urdu",
    "M.Phil Zoology",
    "M.S. Food Science & Technology",
    "MBA (Professional) 2 Year",
    "MBA Executive",
    "MS Data Science",
    "MS Islamic Banking & Finance",
    "MS Software Engineering"
  ],

  phd: [
    "Ph.D. Biochemistry",
    "Ph.D. Education",
    "Ph.D. English (Linguistics)",
    "Ph.D. Library & Information Science",
    "Ph.D. Management Sciences",
    "Ph.D. Peace & Counter Terrorism",
    "Ph.D. Sociology",
    "Ph.D. Urdu",
    "Ph.D. Economics",
    "Ph.D. Food Science & Technology",
    "Ph.D. International Relations",
    "Ph.D. Islamic Economics and Finance",
    "Ph.D. Mass Communication",
    "Ph.D. Mathematics",
    "Ph.D. Pharmacology",
    "Ph.D. Political Science"
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
        name = COALESCE(NULLIF($2, ''), name),
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

async function createCallbackRequest(phone) {
  try {
    const userResult = await pool.query(
      `
      SELECT name, program
      FROM users
      WHERE phone = $1
      LIMIT 1
      `,
      [phone]
    );

    const user = userResult.rows[0] || {};

    const existingCallback = await pool.query(
      `
      SELECT id, request_count
      FROM callback_requests
      WHERE phone = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [phone]
    );

    let callbackRequestId = null;

    if (existingCallback.rows.length > 0) {
      const existing = existingCallback.rows[0];

      await pool.query(
        `
        UPDATE callback_requests
        SET
          name = COALESCE($2, name),
          program = COALESCE($3, program),
          status = 'pending',
          request_count = COALESCE(request_count, 1) + 1,
          is_repeat = true,
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          existing.id,
          user.name || null,
          user.program || null
        ]
      );

      callbackRequestId = existing.id;
    } else {
      const insertResult = await pool.query(
        `
        INSERT INTO callback_requests (
          phone,
          name,
          program,
          status,
          request_count,
          is_repeat,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'pending', 1, false, NOW(), NOW())
        RETURNING id
        `,
        [
          phone,
          user.name || null,
          user.program || null
        ]
      );

      callbackRequestId = insertResult.rows[0].id;
    }

    await pool.query(
      `
      INSERT INTO callback_request_logs (
        callback_request_id,
        phone,
        name,
        program
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        callbackRequestId,
        phone,
        user.name || null,
        user.program || null
      ]
    );

    await pool.query(
      `
      UPDATE users
      SET mode = 'bot'
      WHERE phone = $1
      `,
      [phone]
    );

    await pool.query(
      `
      UPDATE chats
      SET
        callback_requested = true,
        callback_status = 'pending',
        callback_requested_at = NOW(),
        status = 'active',
        unread_count = 0,
        last_message = 'Callback requested - shifted back to bot',
        updated_at = NOW()
      WHERE phone = $1
      `,
      [phone]
    );

    notifyChatUpdated(phone);

  } catch (error) {
    console.error("createCallbackRequest error:", error.message);
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
      (
        phone,
        sender,
        type,
        text,
        media_id,
        media_url,
        file_name,
        mime_type,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,NOW()
      )
      `,
      [
        phone,
        sender,
        type,
        text,
        media_id,
        media_url,
        file_name,
        mime_type
      ]
    );

    notifyChatUpdated(phone);

  } catch (err) {
    console.error(
      "saveMessage error:",
      err.message
    );
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

async function markFollowupSent(phone) {
  try {
    await pool.query(
      `
      UPDATE chats
      SET followup_sent = true,
          followup_sent_at = NOW(),
          updated_at = NOW()
      WHERE phone = $1
      `,
      [phone]
    );
  } catch (err) {
    console.error("markFollowupSent error:", err.message);
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

async function saveUserInteraction(phone, interactionType, category) {
  try {
    const sourceKey = `live:${phone}:${interactionType}:${category}:${Date.now()}:${crypto.randomBytes(4).toString("hex")}`;

    await pool.query(
      `
      INSERT INTO user_interactions (
        phone,
        interaction_type,
        category,
        source_key,
        created_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (source_key) DO NOTHING
      `,
      [phone, interactionType, category, sourceKey]
    );
  } catch (err) {
    console.error("saveUserInteraction error:", err.message);
  }
}

// =========================
// MEDIA HELPERS
// =========================
function getExtensionFromMime(mimeType = "") {
  if (mimeType.includes("image/jpeg")) return "jpg";
  if (mimeType.includes("image/png")) return "png";
  if (mimeType.includes("image/webp")) return "webp";
  if (mimeType.includes("application/pdf")) return "pdf";
  if (mimeType.includes("video/mp4")) return "mp4";
  if (mimeType.includes("audio/ogg")) return "ogg";
  if (mimeType.includes("audio/mpeg")) return "mp3";
  return "bin";
}

async function downloadWhatsAppMedia(mediaId, mimeType) {
  try {
    if (!mediaId) return null;

    const mediaInfo = await axios.get(
      `https://graph.facebook.com/v23.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`
        }
      }
    );

    const mediaDownloadUrl = mediaInfo.data?.url;
    if (!mediaDownloadUrl) return null;

    const mediaFile = await axios.get(mediaDownloadUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });

    const ext = getExtensionFromMime(mimeType);
    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, mediaFile.data);

   return `${BASE_URL}/files/uploads/${fileName}`;
  } catch (err) {
    console.error("downloadWhatsAppMedia error:", err.response?.data || err.message);
    return null;
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

Welcome to Minhaj University Lahore Admissions Assistant

How may we assist you today?

1️⃣ Programs Offered
2️⃣ Fee Structure
3️⃣ Scholarships & Financial Assistance
4️⃣ Admission Process
5️⃣ Why Choose MUL?
6️⃣ Other Support Offices
7️⃣ Chat with Admissions Advisor

📌 Please reply with the number of your choice.

Example:
Send 1 for Programs
Send 2 for Fee Structure
Send 7 to connect with an Admissions Advisor

💡 Type MENU anytime to see these options again.`;
}

function programsMenu() {
  return `📚 Programs Categories

Please reply with the exact option code:

1a. Associate Degree Programs (ADP)
1b. BS Programs
1c. M.Phil./MS Programs
1d. Ph.D. Programs

Example:
Send 1b for BS Programs

📌 Note: 1a means number 1 + letter a.`;
}

function howToApplyMenu() {
  return `📝 Admission Process

Please reply with the exact option code:

4a. On Campus Admission
4b. Online Admission
4c. Documents Requirements

Example:
Send 4b for Online Admission

📌 Note: 4b means number 4 + letter b.`;
}

function whyChooseMenu() {
  return `🌟 Why Choose MUL?

Please reply with the exact option code:

5a. Accreditation & Recognition
5b. International Rankings
5c. Asia's First Robotic Library
5d. Vibrant Student Life & Societies
5e. Research Excellence & Innovation

Example:
Send 5c for Robotic Library

📌 Note: 5c means number 5 + letter c.`;
}

function otherSupportMenu() {
  return `📞 Other Support Offices

Please reply with the exact option code:

6a. Admission Office
6b. Students Affairs Office
6c. Advancement Office
6d. Account Office
6e. PITMAN - ICE
6f. Directorate of Examination
6g. Directorate of Academics
6h. Quality Enhancement Cell (QEC)
6i. ORIC
6j. Vice Chancellor Secretariat
6k. Office of the Registrar
6l. Directorate of Administration

Example:
Send 6a for Admission Office

📌 Note: 6a means number 6 + letter a.`;
}

function formatProgramChunk(title, items, currentIndex, totalChunks, nextCode = null) {
  const list = items.map((item) => `• ${item}`).join("\n");
  let msg = `🎓 ${title}\n\n${list}`;

  if (currentIndex < totalChunks - 1 && nextCode) {
    msg += `\n\n📌 To view the next list, please type exactly:\n${nextCode}`;
  }

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
  const nextCode = chunks.length > 1 ? `${code}-more` : null;

  return formatProgramChunk(item.title, chunks[0], 0, chunks.length, nextCode);
}

function getMoreProgramResponse(code) {
  const mapping = {
    "1a": { title: "Associate Degree Programs (ADP)", key: "adp" },
    "1b": { title: "BS Programs", key: "bs" },
    "1c": { title: "M.Phil./MS Programs", key: "mphil" },
    "1d": { title: "Ph.D. Programs", key: "phd" }
  };

  const match = code.match(/^(1[a-d])-more(?:-(\d+))?$/);
  if (!match) return null;

  const baseCode = match[1];
  const index = match[2] ? parseInt(match[2], 10) : 1;
  const item = mapping[baseCode];

  if (!item) return null;

  const chunks = splitIntoChunks(PROGRAMS[item.key], 12);
  if (!chunks[index]) {
    return `No more programs in this category.`;
  }

  const nextCode = index < chunks.length - 1 ? `${baseCode}-more-${index + 1}` : null;

  return formatProgramChunk(
    item.title + " (More)",
    chunks[index],
    index,
    chunks.length,
    nextCode
  );
}

function applyNowMessage() {
  return `📝 Apply Now Online:
https://admission.mul.edu.pk/`;
}

function getWhyChooseResponse(code) {
  const responses = {
    "5a": `✅ Accreditation & Recognition

Minhaj University Lahore (MUL) is recognized by the Higher Education Commission (HEC) of Pakistan and the Punjab Higher Education Commission (PHEC). Additionally, MUL holds accreditation from HEC affiliated councils, ensuring the highest standards of academic excellence.

Accreditations:
• National Computing Education Accreditation Council - NCEAC
• Pakistan Engineering Council - PEC
• Pakistan Bar Council - PBC
• National Agriculture Education Accreditation Council - NAEAC
• Pharmacy Council of Pakistan - PCP`,

    "5b": `🌍 International Rankings

• Ranked 211 internationally in Higher Education Ranking 2025
• 644th globally in UI GreenMetric (Sustainability)
• 1501+ rank in Times Higher Education Impact Ranking (SDGs)
• Top 100 universities worldwide in WURI 2025
• 20th globally in Student Support & Engagement`,

    "5c": `🤖 Asia’s First Robotic Library

Minhaj University Lahore hosts Asia’s First Robotic Library, offering a fully automated and technology-driven learning environment. Students can access thousands of books and research materials through advanced robotic systems, ensuring quick retrieval and a modern academic experience.

This innovation reflects MUL’s commitment to digital transformation and future-ready education.`,

    "5d": `🎓 Vibrant Student Life & Societies

A dynamic campus with active student societies, events, leadership programs, and sports activities to build confidence and personal growth.

Through initiatives like the Seekers Club, students engage in character building, community service, leadership development, and intellectual discussions, creating a well-rounded university experience.`,

    "5e": `🔬 Research Excellence & Innovation

Minhaj University Lahore is home to leading research centers such as CHART, CRIMA, CEPD, CRC, ICRIE and the UNESCO Chair on Peace Education & Intercultural Dialogue.

The university actively promotes a strong research culture through international conferences, seminars, and academic collaborations. Students and faculty contribute to impactful research published in recognized journals, fostering innovation, critical thinking, and solutions to global challenges.`
  };

  return responses[code] || null;
}

function getOtherSupportResponse(code) {
  const responses = {
    "6a": `🎓 Admission Office

Phone: 03111222685
Email: admissions@mul.edu.pk
Location: Ground Floor, Omar Bin Al Khattab Block`,

    "6b": `🎓 Students Affairs Office

Phone: 042-35145621-6
Extensions: 346 & 446
Email: support.students@mul.edu.pk
Location: First Floor, Omar Bin Al Khattab Block`,

    "6c": `🤝 Advancement Office

Phone: 042-35145621-6
Extension: 368
Email: advancement.office@mul.edu.pk
Location: First Floor, Omar Bin Al Khattab Block`,

    "6d": `💳 Account Office

Phone: 042-35145621-6
Extensions: 388 & 310
Email: support.accounts@mul.edu.pk
Location: Second Floor, Omar Bin Al Khattab Block`,

    "6e": `🏫 PITMAN - ICE

Phone: 042-35145621-6
Extension: 416
Email: ice-pitman@mul.edu.pk
Location: Third Floor, Omar Bin Al Khattab Block`,

    "6f": `📝 Directorate of Examination

Phone: 042-35145621-6
Extensions: 307 & 317
Email: support.exams@mul.edu.pk
Location: Fourth Floor, Omar Bin Al Khattab Block`,

    "6g": `📚 Directorate of Academics

Phone: 042-35145621-6
Extensions: 318 & 429
Email: coordinator.academics@mul.edu.pk
Location: Office # 305, Ground Floor, Jabir Ibn Hayyan Block`,

    "6h": `✅ Quality Enhancement Cell (QEC)

Phone: 042-35145621-6
Extensions: 374 & 349
Email: qec@mul.edu.pk
Location: Office # 310, Ground Floor, Jabir Ibn Hayyan Block`,

    "6i": `🔬 Office of Research, Innovation & Commercialization (ORIC)

Phone: 042-35145621-6
Extensions: 417 & 344
Email: oric@mul.edu.pk
Location: Office # 470, 2nd Floor, Jaffar As Sadiq Block`,

    "6j": `🏛️ Vice Chancellor Secretariat

Phone: 042-35145621-6
Extensions: 323 & 322
Email: pa.vc@mul.edu.pk
Location: First Floor, Umar Ibn Abdul Aziz Block`,

    "6k": `🏢 Office of the Registrar

Phone: 042-35145621-6
Extensions: 311 & 312
Email: pa.registrar@mul.edu.pk
Location: 5th Floor, Omar Bin Al Khattab Block`,

    "6l": `🛠️ Directorate of Administration

Phone: 042-35145621-6
Extension: 364
Email: admin@mul.edu.pk
Location: Office # 303, Ground Floor, Jabir Ibn Hayyan Block`
  };

  return responses[code] || null;
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

async function sendFollowupMessage(to) {
  const message = `We tried to reach you but couldn't respond in time.

If you still want to continue with an admission representative, please reply YES.

To explore options, type MENU.`;

  await sendTextMessage(to, message, "agent_waiting");
  await markFollowupSent(to);
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
// 24H FOLLOW-UP CHECKER
// =========================
async function checkPendingFollowups() {
  try {
    const result = await pool.query(`
      SELECT phone
      FROM chats
      WHERE status = 'agent_waiting'
        AND followup_sent = false
        AND updated_at <= NOW() - INTERVAL '22 hours'
      LIMIT 20
    `);

    for (const row of result.rows) {
      await sendFollowupMessage(row.phone);
    }

  } catch (err) {
    console.error("checkPendingFollowups error:", err.message);
  }
}

async function checkCallbackOffers() {
  try {
    console.log("Running callback offer checker...");

    const result = await pool.query(`
      SELECT phone
      FROM chats
      WHERE status = 'agent_waiting'
        AND (
          callback_offer_last_sent_at IS NULL
          OR callback_offer_last_sent_at <= NOW() - INTERVAL '10 minutes'
        )
      LIMIT 20
    `);

    console.log("Callback offer chats:", result.rows.length);
    console.log("Callback phones:", result.rows.map(x => x.phone));

    for (const row of result.rows) {
      const message = `Our admissions representatives are currently assisting other students.

Please choose an option:

1. Continue waiting for live agent
2. Request a callback from admissions team`;

      await sendTextMessage(row.phone, message, "agent_waiting");

      await pool.query(
        `
        UPDATE chats
        SET
          callback_offer_last_sent_at = NOW(),
          callback_offer_count = COALESCE(callback_offer_count, 0) + 1,
          updated_at = NOW()
        WHERE phone = $1
        `,
        [row.phone]
      );
    }

  } catch (error) {
    console.error("checkCallbackOffers error:", error.message);
  }
}
// =========================
// ROUTES
// =========================
// =========================
// AUTH APIs
// =========================

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required"
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM agents
      WHERE username = $1
      AND active = true
      LIMIT 1
      `,
      [username]
    );

    const agent = result.rows[0];

    if (!agent) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      agent.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid username or password"
      });
    }

    const token = jwt.sign(
      {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        role: agent.role
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    return res.json({
      success: true,
      token,
      agent: {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        role: agent.role,
        can_view_dashboard: agent.can_view_dashboard,
        can_view_all_chats: agent.can_view_all_chats,
        can_create_agents: agent.can_create_agents,
        can_export_data: agent.can_export_data
      }
    });
  } catch (error) {
    console.error("POST /api/login error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Login failed"
    });
  }
});

// CURRENT LOGGED-IN AGENT
app.get("/api/me", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        username,
        role,
        active,
        can_view_dashboard,
        can_view_all_chats,
        can_create_agents,
        can_export_data,
        created_at
      FROM agents
      WHERE id = $1
      LIMIT 1
      `,
      [req.agent.id]
    );

    const agent = result.rows[0];

    if (!agent || agent.active !== true) {
      return res.status(401).json({
        success: false,
        error: "Agent not found or inactive"
      });
    }

    return res.json({
      success: true,
      agent
    });
  } catch (error) {
    console.error("GET /api/me error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch agent profile"
    });
  }
});

// =========================
// PROFILE APIs
// =========================

app.get("/api/profile", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        username,
        role,
        active,
        email,
        designation,
        phone,
        last_password_change_at,
        created_at
      FROM agents
      WHERE id = $1
      LIMIT 1
      `,
      [req.agent.id]
    );

    const agent = result.rows[0];

    if (!agent || agent.active !== true) {
      return res.status(401).json({
        success: false,
        error: "Agent not found or inactive"
      });
    }

    return res.json({
      success: true,
      profile: agent
    });
  } catch (error) {
    console.error("GET /api/profile error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch profile"
    });
  }
});

app.put("/api/profile", authenticateAgent, async (req, res) => {
  try {
    const { name, email, designation, phone } = req.body;

    if (name !== undefined && String(name).trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "Name must be at least 2 characters"
      });
    }

    const result = await pool.query(
      `
      UPDATE agents
      SET
        name = COALESCE(NULLIF($1, ''), name),
        email = COALESCE(NULLIF($2, ''), email),
        designation = COALESCE(NULLIF($3, ''), designation),
        phone = COALESCE(NULLIF($4, ''), phone)
      WHERE id = $5
      RETURNING
        id,
        name,
        username,
        role,
        active,
        email,
        designation,
        phone,
        last_password_change_at,
        created_at
      `,
      [
        name !== undefined ? String(name).trim() : null,
        email !== undefined ? String(email).trim() : null,
        designation !== undefined ? String(designation).trim() : null,
        phone !== undefined ? String(phone).trim() : null,
        req.agent.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Profile not found"
      });
    }

    return res.json({
      success: true,
      profile: result.rows[0]
    });
  } catch (error) {
    console.error("PUT /api/profile error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update profile"
    });
  }
});

app.put("/api/profile/password", authenticateAgent, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password, new password and confirm password are required"
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: "New password and confirm password do not match"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 6 characters"
      });
    }

    const agentResult = await pool.query(
      `
      SELECT id, password_hash
      FROM agents
      WHERE id = $1
      AND active = true
      LIMIT 1
      `,
      [req.agent.id]
    );

    const agent = agentResult.rows[0];

    if (!agent) {
      return res.status(401).json({
        success: false,
        error: "Agent not found or inactive"
      });
    }

    const passwordMatch = await bcrypt.compare(
      currentPassword,
      agent.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: "Current password is incorrect"
      });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE agents
      SET
        password_hash = $1,
        last_password_change_at = NOW()
      WHERE id = $2
      `,
      [password_hash, req.agent.id]
    );

    return res.json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (error) {
    console.error("PUT /api/profile/password error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to change password"
    });
  }
});

// =========================
// AGENT MANAGEMENT APIs
// =========================

// GET ALL AGENTS
app.get("/api/agents", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        username,
        role,
        active,
        can_view_dashboard,
        can_view_all_chats,
        can_create_agents,
        can_export_data,
        created_at
      FROM agents
      ORDER BY id ASC
    `);

    return res.json({
      success: true,
      agents: result.rows
    });

  } catch (error) {
    console.error("GET /api/agents error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch agents"
    });
  }
});

// UPDATE AGENT
app.put("/api/agents/:id", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      role,
      active,
      can_view_dashboard,
      can_view_all_chats,
      can_create_agents,
      can_export_data
    } = req.body;

    const result = await pool.query(
      `
      UPDATE agents
      SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        active = COALESCE($3, active),
        can_view_dashboard = COALESCE($4, can_view_dashboard),
        can_view_all_chats = COALESCE($5, can_view_all_chats),
        can_create_agents = COALESCE($6, can_create_agents),
        can_export_data = COALESCE($7, can_export_data)
      WHERE id = $8
      RETURNING
        id,
        name,
        username,
        role,
        active,
        can_view_dashboard,
        can_view_all_chats,
        can_create_agents,
        can_export_data
      `,
      [
        name ?? null,
        role ?? null,
        active ?? null,
        can_view_dashboard ?? null,
        can_view_all_chats ?? null,
        can_create_agents ?? null,
        can_export_data ?? null,
        id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Agent not found"
      });
    }

    return res.json({
      success: true,
      agent: result.rows[0]
    });
  } catch (error) {
    console.error("PUT /api/agents/:id error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to update agent"
    });
  }
});

// RESET AGENT PASSWORD
app.put("/api/agents/:id/password", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters"
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      UPDATE agents
      SET password_hash = $1
      WHERE id = $2
      RETURNING id, name, username, role
      `,
      [password_hash, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Agent not found"
      });
    }

    return res.json({
      success: true,
      agent: result.rows[0]
    });

  } catch (error) {
    console.error("PUT /api/agents/:id/password error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to reset password"
    });
  }
});

// CREATE AGENT
app.post("/api/agents", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      role,
      can_view_dashboard
    } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, username and password are required"
      });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM agents
      WHERE username = $1
      LIMIT 1
      `,
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Username already exists"
      });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO agents (
        name,
        username,
        password_hash,
        role,
        active,
        can_view_dashboard,
        can_view_all_chats,
        can_create_agents,
        can_export_data
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        true,
        $5,
        true,
        false,
        false
      )
      RETURNING
        id,
        name,
        username,
        role,
        active,
        can_view_dashboard
      `,
      [
        name,
        username,
        password_hash,
        role || "chat_agent",
        !!can_view_dashboard
      ]
    );

    return res.json({
      success: true,
      agent: result.rows[0]
    });

  } catch (error) {
    console.error("POST /api/agents error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to create agent"
    });
  }
});

// =========================
// CALLBACK APIs
// =========================

function requireCallbackAccess(req, res, next) {
  if (
    !req.agent ||
    !["admin", "call_agent"].includes(req.agent.role)
  ) {
    return res.status(403).json({
      success: false,
      error: "Callback Center access required"
    });
  }

  next();
}

// GET CALLBACK REQUESTS
app.get(
  "/api/callbacks",
  authenticateAgent,
  requireCallbackAccess,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          cb.id,
          cb.phone,
          cb.name,
          cb.program,
          cb.status,
          cb.notes,
          cb.assigned_call_agent_id,
          cb.next_followup_at,
          cb.created_at,
          cb.updated_at,
          cb.request_count,
          cb.is_repeat,
          cb.first_response_at,
          cb.first_response_seconds,
          cb.first_response_status,
          cb.first_response_agent_id,
          a.name AS assigned_call_agent
        FROM callback_requests cb
        LEFT JOIN agents a
          ON a.id = cb.assigned_call_agent_id
        ORDER BY
          CASE
            WHEN cb.status = 'pending' THEN 0
            WHEN cb.status = 'follow_up_required' THEN 1
            WHEN cb.status = 'not_responded' THEN 2
            WHEN cb.status = 'called' THEN 3
            WHEN cb.status = 'converted' THEN 4
            ELSE 5
          END,
          cb.updated_at DESC
      `);

      return res.json({
        success: true,
        callbacks: result.rows
      });

    } catch (error) {
      console.error("GET /api/callbacks error:", error.message);

      return res.status(500).json({
        success: false,
        error: "Failed to fetch callback requests"
      });
    }
  }
);

// UPDATE CALLBACK REQUEST
app.put(
  "/api/callbacks/:id",
  authenticateAgent,
  requireCallbackAccess,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes, next_followup_at } = req.body;

      const allowedStatuses = [
        "pending",
        "called",
        "not_responded",
        "follow_up_required",
        "converted"
      ];

      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid callback status"
        });
      }

      const result = await pool.query(
        `
        UPDATE callback_requests
        SET
          status = COALESCE($1, status),
          notes = COALESCE($2, notes),
          next_followup_at = COALESCE($3, next_followup_at),
          assigned_call_agent_id = COALESCE(assigned_call_agent_id, $4),

          first_response_at = CASE
            WHEN first_response_at IS NULL
              AND $1 IS NOT NULL
              AND $1 <> 'pending'
            THEN NOW()
            ELSE first_response_at
          END,

          first_response_seconds = CASE
            WHEN first_response_seconds IS NULL
              AND $1 IS NOT NULL
              AND $1 <> 'pending'
            THEN EXTRACT(EPOCH FROM (NOW() - created_at))::int
            ELSE first_response_seconds
          END,

          first_response_status = CASE
            WHEN first_response_status IS NULL
              AND $1 IS NOT NULL
              AND $1 <> 'pending'
            THEN $1
            ELSE first_response_status
          END,

          first_response_agent_id = CASE
            WHEN first_response_agent_id IS NULL
              AND $1 IS NOT NULL
              AND $1 <> 'pending'
            THEN $4
            ELSE first_response_agent_id
          END,

          updated_at = NOW()
        WHERE id = $5
        RETURNING *
        `,
        [
          status ?? null,
          notes ?? null,
          next_followup_at ?? null,
          req.agent.id,
          id
        ]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Callback request not found"
        });
      }

      return res.json({
        success: true,
        callback: result.rows[0]
      });
    } catch (error) {
      console.error("PUT /api/callbacks/:id error:", error.message);
      return res.status(500).json({
        success: false,
        error: "Failed to update callback request"
      });
    }
  }
);

// TEMP CREATE ADMIN
app.get("/create-admin", async (req, res) => {
  try {
    const result = await pool.query(
      `
      INSERT INTO agents (
        name,
        username,
        password_hash,
        role,
        active,
        can_view_dashboard,
        can_view_all_chats,
        can_create_agents,
        can_export_data
      )
      VALUES (
        'Omer',
        'omer',
        '$2b$10$eL0q/0ZPaVI7u59Pv5Pg2O2qUv52GcuAjNBu4M9EyYBZuitHdLwuy',
        'admin',
        true,
        true,
        true,
        true,
        true
      )
      ON CONFLICT (username)
      DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        role = 'admin',
        active = true,
        can_view_dashboard = true,
        can_view_all_chats = true,
        can_create_agents = true,
        can_export_data = true
      RETURNING id, name, username, role;
      `
    );

    return res.json({
      success: true,
      admin: result.rows[0]
    });
  } catch (error) {
    console.error("Create admin error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Admin creation failed"
    });
  }
});

// =========================
// REAL-TIME SSE ROUTE
// =========================
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders();

  res.write(`event: connected\ndata: "SSE Connected"\n\n`);

  sseClients.push(res);

  req.on("close", () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
    console.log("SSE client disconnected");
  });
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
    let lowerText = text?.toLowerCase();

// =========================
// SMART KEYWORD DETECTION
// Bot mode only
// =========================

const currentUserForKeyword = await getUserByPhone(from);
const currentModeForKeyword = currentUserForKeyword?.mode || "bot";

if (currentModeForKeyword !== "agent") {
  if (
    lowerText &&
    (
      lowerText.includes("fee") ||
      lowerText.includes("fees") ||
      lowerText.includes("fee structure") ||
      lowerText.includes("tuition fee") ||
      lowerText.includes("semester fee") ||
      lowerText.includes("charges") ||
      lowerText.includes("cost")
    )
  ) {
    text = "2";
  }

  if (
    lowerText &&
    (
      lowerText.includes("scholarship") ||
      lowerText.includes("scholarships") ||
      lowerText.includes("financial aid") ||
      lowerText.includes("discount") ||
      lowerText.includes("fee concession") ||
      lowerText.includes("merit scholarship") ||
      lowerText.includes("need based")
    )
  ) {
    text = "3";
  }

  if (
    lowerText &&
    (
      lowerText.includes("admission") ||
      lowerText.includes("apply") ||
      lowerText.includes("apply online") ||
      lowerText.includes("registration") ||
      lowerText.includes("how to apply") ||
      lowerText.includes("documents") ||
      lowerText.includes("requirements")
    )
  ) {
    text = "4";
  }

  if (
    lowerText &&
    (
      lowerText.includes("agent") ||
      lowerText.includes("representative") ||
      lowerText.includes("advisor") ||
      lowerText.includes("counselor") ||
      lowerText.includes("human") ||
      lowerText.includes("call me")
    )
  ) {
    text = "7";
  }
}

lowerText = text?.toLowerCase();

    const currentChatForCallback = await pool.query(
  `
  SELECT status, followup_sent
  FROM chats
  WHERE phone = $1
  LIMIT 1
  `,
  [from]
);

const chatForCallback = currentChatForCallback.rows[0];

if (
  chatForCallback?.status === "agent_waiting" &&
  lowerText === "2"
) {
  await createCallbackRequest(from);

  await sendTextMessage(
    from,
    `Thank you for requesting a callback.

Our admissions representative will contact you shortly.

Meanwhile, you have been shifted back to our automated assistant and may continue exploring admissions information anytime.

${welcomeMessage()}`,
    "active"
  );

  return res.sendStatus(200);
}

// =========================
// FOLLOW-UP RESPONSE HANDLING
// =========================
if (lowerText === "yes") {
  userStates[from].currentMenu = "agent";

  await updateUserDetails(from, { mode: "agent" });
  await upsertChat(from, "User re-engaged via YES", "agent_waiting");

  await sendTextMessage(
    from,
    "Thank you. Connecting you with our representative. Please wait...",
    "agent_waiting"
  );

  return res.sendStatus(200);
}

if (lowerText === "menu") {
  userStates[from].currentMenu = "main";

  await updateUserDetails(from, { mode: "bot" });

  await sendTextMessage(
    from,
    `Please choose an option:

1. Programs
2. Fee Structure
3. Scholarships
4. How to Apply
5. Why Choose MUL?
6. Other Support
7. Chat with Agent`
  );

  return res.sendStatus(200);
}
    
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

  media_url = await downloadWhatsAppMedia(media_id, mime_type);

    } else if (type === "document") {
  incomingText = msg.document?.filename || "[Document]";
  media_id = msg.document?.id || null;
  file_name = msg.document?.filename || null;
  mime_type = msg.document?.mime_type || null;

  media_url = await downloadWhatsAppMedia(media_id, mime_type);

   } else if (type === "video") {
  incomingText = "[Video]";
  media_id = msg.video?.id || null;
  mime_type = msg.video?.mime_type || null;

  media_url = await downloadWhatsAppMedia(media_id, mime_type);

    } else if (type === "audio") {
  incomingText = "[Audio]";
  media_id = msg.audio?.id || null;
  mime_type = msg.audio?.mime_type || null;

  media_url = await downloadWhatsAppMedia(media_id, mime_type);

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

    if (!userStates[from]) {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false,
        hasInteracted: false
      };
    }

    // =========================
// AGENT CATEGORY HANDLING
// =========================
if (userStates[from]?.currentMenu === "agent_category") {
  if (lowerText === "1") {
    userStates[from].agentType = "admissions";
    await saveUserInteraction(from, "agent_category", "admissions_related");    
    const existingUser = await pool.query(
      "SELECT name, program FROM users WHERE phone = $1",
      [from]
    );

    if (
      existingUser.rows.length > 0 &&
      existingUser.rows[0].name &&
      existingUser.rows[0].program
    ) {
      
      userStates[from].currentMenu = "agent";

      await updateUserDetails(from, { mode: "agent" });
      
      await upsertChat(from, "Admissions query forwarded to agent", "agent_waiting");

      await pool.query(
  `
  UPDATE chats
  SET agent_requested = true
  WHERE phone = $1
  `,
  [from]
);

      await pool.query(
  `
  UPDATE chats
  SET
    agent_waiting_started_at = NOW(),
    agent_taken_at = NULL,
    agent_response_seconds = NULL
  WHERE phone = $1
  `,
  [from]
);

      await pool.query(
  "UPDATE chats SET followup_sent = false, followup_sent_at = NULL WHERE phone = $1",
  [from]
);

      await sendTextMessage(
        from,
        "Connecting you with an admissions representative. Please wait a moment...",
        "agent_waiting"
      );
      
    } else {
      userStates[from].awaitingLead = true;
      userStates[from].currentMenu = "agent";

      await sendTextMessage(
        from,
        `Please share your details in this format:

Your Name, Interested Program

⚠️ Please add comma ( , ) between your name and program.

Example:
Ali, BS Computer Science

If comma is missing, your request may not be forwarded correctly.`
      );
    }

    return res.sendStatus(200);
  }

  if (lowerText === "2") {
    userStates[from].agentType = "other";
    await saveUserInteraction(from, "agent_category", "other");
    userStates[from].currentMenu = "agent";

    await updateUserDetails(from, { mode: "agent" });
    
    await upsertChat(from, "General query forwarded to agent", "agent_waiting");

    await pool.query(
  `
  UPDATE chats
  SET agent_requested = true
  WHERE phone = $1
  `,
  [from]
);

    await pool.query(
  `
  UPDATE chats
  SET
    agent_waiting_started_at = NOW(),
    agent_taken_at = NULL,
    agent_response_seconds = NULL
  WHERE phone = $1
  `,
  [from]
);

    await pool.query(
  "UPDATE chats SET followup_sent = false, followup_sent_at = NULL WHERE phone = $1",
  [from]
);

    await sendTextMessage(
      from,
      "Your query is being forwarded to our representative. Please wait...",
      "agent_waiting"
    );

    return res.sendStatus(200);
  }

  await sendTextMessage(from, "Please reply with 1 or 2");
  return res.sendStatus(200);
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

const existingChatResult = await pool.query(
  "SELECT status FROM chats WHERE phone = $1 LIMIT 1",
  [from]
);

const existingChatStatus = existingChatResult.rows[0]?.status;

const incomingChatStatus =
  currentMode === "agent"
    ? existingChatStatus === "agent_active"
      ? "agent_active"
      : "agent_waiting"
    : "active";

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

      if (
        ![
          "1", "2", "3", "4", "5", "6", "7",
          "1a", "1b", "1c", "1d",
          "5a", "5b", "5c", "5d", "5e",
          "6a", "6b", "6c", "6d", "6e", "6f", "6g", "6h", "6i", "6j", "6k", "6l",
          "apply"
        ].includes(lowerText)
      ) {
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

    if (lowerText === "back" || lowerText === "9") {
      const prev = userStates[from].previousMenu || "main";

      if (prev === "programs") {
        userStates[from].currentMenu = "programs";
        userStates[from].previousMenu = "main";
        await saveUserInteraction(from, "bot_info", "programs");
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
      } else if (prev === "why_mul") {
        userStates[from].currentMenu = "why_mul";
        userStates[from].previousMenu = "main";
        await sendReplyButtons(
          from,
          whyChooseMenu(),
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
        userStates[from].currentMenu = "main";
        userStates[from].previousMenu = "main";
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

await pool.query(
  `
  UPDATE users
  SET name = $2,
      program = $3
  WHERE phone = $1
  `,
  [from, cleanName, program]
);
      
      await upsertChat(from, `Lead: ${cleanName} - ${program}`, "agent_waiting");

      await pool.query(
  `
  UPDATE chats
  SET agent_requested = true
  WHERE phone = $1
  `,
  [from]
);

      await pool.query(
  `
  UPDATE chats
  SET
    agent_waiting_started_at = NOW(),
    agent_taken_at = NULL,
    agent_response_seconds = NULL
  WHERE phone = $1
  `,
  [from]
);

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
      await saveUserInteraction(from, "bot_info", "programs");
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
          { id: "apply", title: "Apply Now" },
          { id: "back", title: "Back" },
          { id: "main_menu", title: "Main Menu" }
        ]
      );

      return res.sendStatus(200);
    }

    if (/^1[a-d]-more(?:-\d+)?$/.test(lowerText)) {
      const response = getMoreProgramResponse(lowerText);
      userStates[from].previousMenu = "programs";
      userStates[from].currentMenu = lowerText;
      userStates[from].hasInteracted = true;

      await sendReplyButtons(
        from,
        response,
        [
          { id: "apply", title: "Apply Now" },
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

     const pdfUrl = `${BASE_URL}/files/Fee%20Structure%20Fall%202026.pdf`;
      await saveUserInteraction(from, "bot_info", "fee_structure");
      await sendReplyButtons(
        from,
        `💰 Fee Structure – Fall 2026

Please find attached the complete fee structure.`,
        [{ id: "main_menu", title: "Main Menu" }]
      );

      await sendDocumentMessage(
        from,
        pdfUrl,
        "Fee Structure Fall 2026.pdf",
        "MUL Fee Structure Fall 2026"
      );

      return res.sendStatus(200);
    }

    if (lowerText === "3") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "scholarship";
      userStates[from].hasInteracted = true;
      await saveUserInteraction(from, "bot_info", "scholarships");
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
      await saveUserInteraction(from, "bot_info", "admission_process");
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
      userStates[from].currentMenu = "why_mul";
      userStates[from].hasInteracted = true;
      await saveUserInteraction(from, "bot_info", "why_choose_mul");
      await sendReplyButtons(
        from,
        whyChooseMenu(),
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (["5a", "5b", "5c", "5d", "5e"].includes(lowerText)) {
      const response = getWhyChooseResponse(lowerText);

      userStates[from].previousMenu = "why_mul";
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

    if (lowerText === "6") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "other_support";
      userStates[from].hasInteracted = true;
     await saveUserInteraction(from, "bot_info", "other_support");
      await sendReplyButtons(
        from,
        otherSupportMenu(),
        [{ id: "main_menu", title: "Main Menu" }]
      );

      return res.sendStatus(200);
    }

    if (
      [
        "6a", "6b", "6c", "6d", "6e", "6f",
        "6g", "6h", "6i", "6j", "6k", "6l"
      ].includes(lowerText)
    ) {
      const response = getOtherSupportResponse(lowerText);

      userStates[from].previousMenu = "other_support";
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

if (lowerText === "7") {
  const available = await isAgentAvailable();

  if (!available) {
    await sendTextMessage(
      from,
      `Thank you for contacting Minhaj University Lahore.

Our representatives are currently unavailable as this inquiry has been received outside our support hours.

🕘 Support Hours:
Monday to Friday: 09:00 AM – 04:30 PM

For immediate information, you may continue exploring the available menu options.

Thank you for your patience.`
    );

    return res.sendStatus(200);
  }

  // 👉 Ask category instead of direct lead
  userStates[from].currentMenu = "agent_category";

  await sendTextMessage(
    from,
    `👤 Chat with Agent

Please choose:

1. Admissions Related
2. Other`
  );

  return res.sendStatus(200);
}

await sendTextMessage(
  from,
  `Assalamu Alaikum 👋

I couldn't understand your selection.

Please choose one of the following options:

1️⃣ Programs Offered
2️⃣ Fee Structure
3️⃣ Scholarships & Financial Assistance
4️⃣ Admission Process
5️⃣ Why Choose MUL?
6️⃣ Other Support Offices
7️⃣ Chat with Admissions Advisor

📌 Please reply with the number of your choice.

💡 Type MENU anytime to see these options again.`
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

// Get agent status
app.get("/api/agent-status", authenticateAgent, async (req, res) => {
  const result = await pool.query(
    "SELECT value FROM system_settings WHERE key = 'agent_available'"
  );

  res.json({
    success: true,
    status: result.rows[0]?.value === "true"
  });
});

// Toggle agent status
app.post("/api/toggle-agent", authenticateAgent, async (req, res) => {
  const { status } = req.body;
  if (!["admin", "chat_agent"].includes(req.agent.role)) {
  return res.status(403).json({
    success: false,
    error: "Only admin or chat agent can change live admissions status"
  });
}

  await pool.query(
    "UPDATE system_settings SET value = $1 WHERE key = 'agent_available'",
    [status ? "true" : "false"]
  );

  res.json({ success: true });
});

app.post("/api/funnel-status", authenticateAgent, async (req, res) => {
  try {
    const { phone, stage } = req.body;

    if (!phone || !stage) {
      return res.status(400).json({
        success: false,
        error: "phone and stage are required"
      });
    }

    const allowedStages = [
      "registered",
      "processing_fee_paid",
      "documents_submitted",
      "admission_fee_paid"
    ];

    if (!allowedStages.includes(stage)) {
      return res.status(400).json({
        success: false,
        error: "Invalid funnel stage"
      });
    }

    let updateSql = "";

    if (stage === "registered") {
      updateSql = `
        registered_at = COALESCE(registered_at, NOW())
      `;
    }

    if (stage === "processing_fee_paid") {
      updateSql = `
        registered_at = COALESCE(registered_at, NOW()),
        processing_fee_paid_at = COALESCE(processing_fee_paid_at, NOW())
      `;
    }

    if (stage === "documents_submitted") {
      updateSql = `
        registered_at = COALESCE(registered_at, NOW()),
        processing_fee_paid_at = COALESCE(processing_fee_paid_at, NOW()),
        documents_submitted_at = COALESCE(documents_submitted_at, NOW())
      `;
    }

    if (stage === "admission_fee_paid") {
      updateSql = `
        registered_at = COALESCE(registered_at, NOW()),
        processing_fee_paid_at = COALESCE(processing_fee_paid_at, NOW()),
        documents_submitted_at = COALESCE(documents_submitted_at, NOW()),
        admission_fee_paid_at = COALESCE(admission_fee_paid_at, NOW())
      `;
    }

    const result = await pool.query(
      `
      UPDATE users
      SET ${updateSql}
      WHERE phone = $1
      RETURNING
        phone,
        registered_at,
        processing_fee_paid_at,
        documents_submitted_at,
        admission_fee_paid_at
      `,
      [phone]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    return res.json({
      success: true,
      funnel: result.rows[0]
    });

  } catch (error) {
    console.error("POST /api/funnel-status error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update funnel status"
    });
  }
});

app.get("/api/funnel-status/:phone", authenticateAgent, async (req, res) => {
  try {
    const { phone } = req.params;

    const result = await pool.query(
      `
      SELECT
        phone,
        registered_at,
        processing_fee_paid_at,
        documents_submitted_at,
        admission_fee_paid_at
      FROM users
      WHERE phone = $1
      `,
      [phone]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    return res.json({
      success: true,
      funnel: result.rows[0]
    });

  } catch (error) {
    console.error("GET /api/funnel-status error:", error.message);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch funnel status"
    });
  }
});

app.get("/api/chats", authenticateAgent, async (req, res) => {
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
 c.assigned_agent_id,
a.name AS assigned_agent,
c.assigned_at,
  u.name,
  u.program,
  u.mode
      FROM chats c
      LEFT JOIN users u ON u.phone = c.phone
      LEFT JOIN agents a ON a.id = c.assigned_agent_id
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

app.get("/api/messages/:phone", authenticateAgent, async (req, res) => {
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

app.post("/api/send", authenticateAgent, async (req, res) => {
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

app.post("/api/switch-mode", authenticateAgent, async (req, res) => {
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

  await sendTextMessage(
    phone,
    `Thank you for contacting Minhaj University Lahore.

You have now been transferred back to our automated admissions assistant. You may continue exploring admissions information, programs, fee structure, scholarships, and other services at any time.

If you require further assistance from an admissions representative, simply select "Chat with Admissions Advisor" again.`,
    "active"
  );
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

app.post("/api/assign-chat", authenticateAgent, async (req, res) => {
  try {
    const { phone, agent } = req.body;

   console.log("ASSIGN API HIT:", {
  phone,
  agentFromRequest: agent,
  loggedInAgent: req.agent
});

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Missing phone"
      });
    }

const shouldAssign = agent !== null && agent !== false && agent !== "";

const result = await pool.query(
  `
  UPDATE chats
  SET
    assigned_agent_id = $1::integer,
    assigned_at = CASE WHEN $1::integer IS NULL THEN NULL ELSE NOW() END,
    status = CASE WHEN $1::integer IS NULL THEN status ELSE 'agent_active' END,

    agent_taken_at = CASE
      WHEN $1::integer IS NULL THEN agent_taken_at
      ELSE NOW()
    END,

    agent_response_seconds = CASE
      WHEN $1::integer IS NULL THEN agent_response_seconds
      WHEN agent_waiting_started_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (NOW() - agent_waiting_started_at))::int
      ELSE NULL
    END,

    updated_at = NOW()
  WHERE phone = $2
  RETURNING
    phone,
    assigned_agent_id,
    assigned_at,
    status,
    agent_waiting_started_at,
    agent_taken_at,
    agent_response_seconds
  `,
  [shouldAssign ? req.agent.id : null, phone]
);

    console.log("ASSIGN RESULT:", result.rows[0]);

    return res.json({
      success: true,
      chat: result.rows[0]
    });
  } catch (error) {
    console.error("Assign chat error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/mark-read", authenticateAgent, async (req, res) => {
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

app.get("/api/dashboard", authenticateAgent, async (req, res) => {
  try {
    const range = req.query.range || "24h";
    const start = req.query.start;
    const end = req.query.end;

    let intervalSql = "INTERVAL '24 hours'";
    if (range === "7d") intervalSql = "INTERVAL '7 days'";
    if (range === "30d") intervalSql = "INTERVAL '30 days'";

    let whereCreated = `created_at >= NOW() - ${intervalSql}`;
    let queryParams = [];

    if (range === "custom" && start && end) {
      whereCreated = `
        created_at >= $1::timestamp
        AND created_at < ($2::date + INTERVAL '1 day')
      `;

      queryParams = [start, end];
    }

    const conversationsStarted = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE ${whereCreated}
      `,
      queryParams
    );

    const unreadConversations = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM chats
      WHERE unread_count > 0
    `);

    const totalIncomingMessages = await pool.query(
  `
  SELECT COUNT(*)::int AS count
  FROM messages
  WHERE sender = 'user'
    AND ${whereCreated}
  `,
  queryParams
);

const agentChatRequests = await pool.query(
  `
  SELECT COUNT(DISTINCT phone)::int AS count
  FROM chats
  WHERE agent_requested = true
    AND ${whereCreated.replaceAll("created_at", "updated_at")}
  `,
  queryParams
);

const agentMessagesSent = await pool.query(
  `
  SELECT COUNT(*)::int AS count
  FROM messages
  WHERE sender = 'agent'
    AND ${whereCreated}
  `,
  queryParams
);

const botInterestStats = await pool.query(
  `
  SELECT category, COUNT(DISTINCT phone)::int AS count
  FROM user_interactions
  WHERE interaction_type = 'bot_info'
    AND ${whereCreated}
  GROUP BY category
  ORDER BY count DESC, category ASC
  `,
  queryParams
);

const agentCategoryStats = await pool.query(
  `
  SELECT category, COUNT(DISTINCT phone)::int AS count
  FROM user_interactions
  WHERE interaction_type = 'agent_category'
    AND ${whereCreated}
  GROUP BY category
  ORDER BY count DESC, category ASC
  `,
  queryParams
);
    
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

    const topPrograms = await pool.query(
      `
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
      `,
      queryParams
    );

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

    const funnelDateFilter = range === "custom" && start && end
  ? `
    >= $1::timestamp
    AND < ($2::date + INTERVAL '1 day')
  `
  : `>= NOW() - ${intervalSql}`;

const funnelStats = await pool.query(`
  SELECT
    COUNT(*) FILTER (
      WHERE (
        registered_at IS NOT NULL
        OR processing_fee_paid_at IS NOT NULL
        OR documents_submitted_at IS NOT NULL
        OR admission_fee_paid_at IS NOT NULL
      )
    )::int AS registrations,

    COUNT(*) FILTER (
      WHERE (
        processing_fee_paid_at IS NOT NULL
        OR documents_submitted_at IS NOT NULL
        OR admission_fee_paid_at IS NOT NULL
      )
    )::int AS processing_fee,

    COUNT(*) FILTER (
      WHERE (
        documents_submitted_at IS NOT NULL
        OR admission_fee_paid_at IS NOT NULL
      )
    )::int AS documents_submitted,

    COUNT(*) FILTER (
      WHERE admission_fee_paid_at IS NOT NULL
    )::int AS fee_paid

  FROM users
`);
    
    const callbackTotals = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_requests,
        COUNT(DISTINCT phone)::int AS unique_numbers
      FROM callback_request_logs
      WHERE ${whereCreated}
      `,
      queryParams
    );

    const callbackRepeat = await pool.query(
      `
      SELECT COUNT(*)::int AS repeat_numbers
      FROM (
        SELECT phone
        FROM callback_request_logs
        WHERE ${whereCreated}
        GROUP BY phone
        HAVING COUNT(*) > 1
      ) repeated
      `,
      queryParams
    );

    const callbackStatuses = await pool.query(
      `
      WITH scoped_callbacks AS (
        SELECT DISTINCT callback_request_id
        FROM callback_request_logs
        WHERE ${whereCreated}
          AND callback_request_id IS NOT NULL
      )
      SELECT
        COUNT(*) FILTER (WHERE cb.status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE cb.status = 'called')::int AS called,
        COUNT(*) FILTER (WHERE cb.status = 'not_responded')::int AS not_responded,
        COUNT(*) FILTER (WHERE cb.status = 'follow_up_required')::int AS follow_up_required,
        COUNT(*) FILTER (WHERE cb.status = 'converted')::int AS converted
      FROM callback_requests cb
      JOIN scoped_callbacks sc
        ON sc.callback_request_id = cb.id
      `,
      queryParams
    );

        const responseStats = await pool.query(
      `
      SELECT
        COALESCE(ROUND(AVG(agent_response_seconds))::int, 0) AS average_chat_response_seconds
      FROM chats
      WHERE agent_response_seconds IS NOT NULL
        AND ${whereCreated.replaceAll("created_at", "agent_taken_at")}
      `,
      queryParams
    );

    const callbackResponseStats = await pool.query(
      `
      SELECT
        COALESCE(ROUND(AVG(first_response_seconds))::int, 0) AS average_callback_response_seconds
      FROM callback_requests
      WHERE first_response_seconds IS NOT NULL
        AND ${whereCreated.replaceAll("created_at", "first_response_at")}
      `,
      queryParams
    );

    return res.json({
      success: true,

      filters: {
        range,
        start: start || null,
        end: end || null
      },

      stats: {
        conversationsStarted: conversationsStarted.rows[0].count,
        unreadConversations: unreadConversations.rows[0].count,
        totalIncomingMessages: totalIncomingMessages.rows[0].count,
        agentChatRequests: agentChatRequests.rows[0].count,
        agentMessagesSent: agentMessagesSent.rows[0].count,
        agentWaiting: agentWaiting.rows[0].count,
        agentActive: agentActive.rows[0].count,
        activeWithBot: activeWithBot.rows[0].count,
        activeWithAgent: activeWithAgent.rows[0].count
      },

      funnelStats: {
        registrations: funnelStats.rows[0].registrations || 0,
        processingFee: funnelStats.rows[0].processing_fee || 0,
        documentsSubmitted: funnelStats.rows[0].documents_submitted || 0,
        feePaid: funnelStats.rows[0].fee_paid || 0
      },
      
      callbackStats: {
        totalRequests: callbackTotals.rows[0].total_requests,
        uniqueNumbers: callbackTotals.rows[0].unique_numbers,
        repeatRequests: callbackRepeat.rows[0].repeat_numbers,
        pending: callbackStatuses.rows[0].pending || 0,
        called: callbackStatuses.rows[0].called || 0,
        notResponded: callbackStatuses.rows[0].not_responded || 0,
        followupRequired: callbackStatuses.rows[0].follow_up_required || 0,
        converted: callbackStatuses.rows[0].converted || 0
      },

            responseStats: {
        averageChatResponseSeconds:
          responseStats.rows[0].average_chat_response_seconds || 0,
        averageCallbackResponseSeconds:
          callbackResponseStats.rows[0].average_callback_response_seconds || 0
      },

      botInterestStats: botInterestStats.rows,
      agentCategoryStats: agentCategoryStats.rows,
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

app.get("/api/export-leads", authenticateAgent, async (req, res) => {
  try {
    const range = req.query.range || "24h";
    const start = req.query.start;
    const end = req.query.end;

    let intervalSql = "INTERVAL '24 hours'";
    if (range === "7d") intervalSql = "INTERVAL '7 days'";
    if (range === "30d") intervalSql = "INTERVAL '30 days'";

    let whereCreated = `u.created_at >= NOW() - ${intervalSql}`;
    let queryParams = [];

    if (range === "custom" && start && end) {
      whereCreated = `
        u.created_at >= $1::timestamp
        AND u.created_at < ($2::date + INTERVAL '1 day')
      `;
      queryParams = [start, end];
    }

    const result = await pool.query(
      `
      SELECT
        u.created_at,
        u.name,
        u.phone,
        u.program,
        c.status AS current_status,
        COALESCE(cb.status, 'no_callback') AS callback_status
      FROM users u
      LEFT JOIN chats c ON c.phone = u.phone
      LEFT JOIN callback_requests cb ON cb.phone = u.phone
      WHERE ${whereCreated}
      ORDER BY u.created_at DESC
      `,
      queryParams
    );

    const headers = [
      "Sr #",
      "Date",
      "Name",
      "WhatsApp Number",
      "Program",
      "Current Status",
      "Callback Status"
    ];

    const rows = result.rows.map((row, index) => [
      index + 1,
      row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "",
      row.name || "",
      row.phone || "",
      row.program || "",
      row.current_status || "",
      row.callback_status === "no_callback"
        ? "No Callback"
        : row.callback_status.replaceAll("_", " ")
    ]);

    const csv = [
      headers.join(","),
      ...rows.map(r =>
        r.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mul-nexus-leads-export.csv"`
    );

    return res.send(csv);
  } catch (error) {
    console.error("GET /api/export-leads error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to export leads"
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/live", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "live.html"));
});

app.get("/live-chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "live-chat.html"));
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

    // 🔥 SYSTEM SETTINGS TABLE AUTO CREATE
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    await pool.query(`
      INSERT INTO system_settings (key, value)
      VALUES ('agent_available', 'true')
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log("✅ System settings ensured in DB");
  } catch (err) {
    console.error("❌ System settings error:", err.message);
  }

    // 🔥 24H FOLLOW-UP COLUMNS AUTO ADD
  try {
    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMP NULL;
    `);

    console.log("✅ 24h follow-up columns ensured in DB");
  } catch (err) {
    console.error("❌ 24h follow-up columns error:", err.message);
  }

  // 🔥 START 24H FOLLOW-UP CHECKER
  setInterval(checkPendingFollowups, 10 * 60 * 1000); // every 10 minutes
  setInterval(checkCallbackOffers, 10 * 60 * 1000);
  console.log("10m callback offer checker started");
  checkCallbackOffers();
  console.log("✅ 24h follow-up checker started");
  
});
