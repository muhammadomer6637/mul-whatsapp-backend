const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
app.use(express.json());

// Static files for PDF
app.use("/files", express.static(path.join(__dirname, "public")));

// CONFIG
const VERIFY_TOKEN = "mul_token_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = "1065169533344109";
const BASE_URL = process.env.BASE_URL || "https://mul-whatsapp-backend-production.up.railway.app";

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

Welcome to Minhaj University Lahore — a leading institution committed to academic excellence, innovation, research, and student success. We offer a wide range of degree programs to help students build strong professional futures.

Please choose an option:

1. Programs
2. Fee Structure
3. Scholarship
4. How to Apply for Admission
5. Anything Else

Reply 0 at any time for Main Menu.`;
}

function programsMenu() {
  return `📚 Programs Categories

Please choose:

1a. Associate Degree Programs (ADP - 2 Years)
1b. BS Programs (4 Years)
1c. M.Phil./MS Programs
1d. Ph.D. Programs

Reply 9 for Previous Menu
Reply 0 for Main Menu`;
}

function howToApplyMenu() {
  return `📝 How to Apply for Admission

Please choose:

4a. On Campus
4b. Online
4c. Documents Requirements

Reply 9 for Previous Menu
Reply 0 for Main Menu`;
}

function anythingElseMenu() {
  return `📞 Anything Else

Please choose:

5a. Related to Students Affairs Office
5b. Related to Examination
5c. Related to Account Office
5d. Admissions
5e. Talk to Agent

Reply 9 for Previous Menu
Reply 0 for Main Menu`;
}

function formatProgramChunk(title, items, currentIndex, totalChunks, baseCode) {
  const list = items.map((item, i) => `• ${item}`).join("\n");
  let msg = `🎓 ${title}\n\n${list}`;

  if (currentIndex < totalChunks - 1) {
    msg += `\n\nReply ${baseCode}-more for more programs`;
  }

  msg += `\nReply 1 for Programs Menu`;
  msg += `\nReply APPLY to apply online`;
  msg += `\nReply 0 for Main Menu`;

  return msg;
}

function getProgramResponse(code) {
  const mapping = {
    "1a": { title: "Associate Degree Programs (ADP - 2 Years)", key: "adp" },
    "1b": { title: "BS Programs (4 Years)", key: "bs" },
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
    "1a-more": { title: "Associate Degree Programs (ADP - 2 Years)", key: "adp", index: 1 },
    "1b-more": { title: "BS Programs (4 Years)", key: "bs", index: 1 },
    "1c-more": { title: "M.Phil./MS Programs", key: "mphil", index: 1 },
    "1d-more": { title: "Ph.D. Programs", key: "phd", index: 1 }
  };

  const item = mapping[code];
  if (!item) return null;

  const chunks = splitIntoChunks(PROGRAMS[item.key], 12);
  if (!chunks[item.index]) {
    return `No more programs in this category.\n\nReply 1 for Programs Menu\nReply 0 for Main Menu`;
  }

  return formatProgramChunk(item.title + " (More)", chunks[item.index], item.index, chunks.length, code.replace("-more", ""));
}

function applyNowMessage() {
  return `📝 Apply Now Online:
https://admission.mul.edu.pk/

Reply 0 for Main Menu`;
}

// =========================
// WHATSAPP SEND HELPERS
// =========================
async function sendTextMessage(to, message) {
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
  } catch (error) {
    console.error("Send text error:", error.response?.data || error.message);
  }
}

async function sendDocumentMessage(to, documentUrl, filename, caption = "") {
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
  } catch (error) {
    console.error("Send document error:", error.response?.data || error.message);
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

    if (!msg) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = msg.text?.body?.trim();

    if (!text) {
      return res.sendStatus(200);
    }

    const lowerText = text.toLowerCase();

    console.log("Incoming message from:", from, "| text:", lowerText);

    // Init state
    if (!userStates[from]) {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false
      };
    }

    // Global commands
    if (lowerText === "0") {
      userStates[from] = {
        previousMenu: "main",
        currentMenu: "main",
        awaitingLead: false
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
        await sendTextMessage(from, programsMenu());
      } else if (prev === "apply") {
        userStates[from].currentMenu = "apply";
        userStates[from].previousMenu = "main";
        await sendTextMessage(from, howToApplyMenu());
      } else if (prev === "anything") {
        userStates[from].currentMenu = "anything";
        userStates[from].previousMenu = "main";
        await sendTextMessage(from, anythingElseMenu());
      } else {
        await sendTextMessage(from, welcomeMessage());
      }

      return res.sendStatus(200);
    }

    if (lowerText === "apply") {
      await sendTextMessage(from, applyNowMessage());
      return res.sendStatus(200);
    }

    // Lead capture after 5e
    if (userStates[from].awaitingLead && text.includes(",")) {
      const [name, ...rest] = text.split(",");
      const program = rest.join(",").trim();

      console.log("Lead captured:", {
        phone: from,
        name: name.trim(),
        program
      });

      userStates[from].awaitingLead = false;
      userStates[from].previousMenu = "anything";
      userStates[from].currentMenu = "lead_done";

      await sendTextMessage(
        from,
        `✅ Thank you!

Your request has been received successfully.

Name: ${name.trim()}
Program: ${program}

Our admissions team will contact you shortly.

Reply 0 for Main Menu`
      );

      return res.sendStatus(200);
    }

    // Main greetings
    if (
      ["hi", "hello", "assalamualaikum", "assalamu alaikum", "menu", "start"].includes(lowerText)
    ) {
      userStates[from].currentMenu = "main";
      userStates[from].previousMenu = "main";
      userStates[from].awaitingLead = false;

      await sendTextMessage(from, welcomeMessage());
      return res.sendStatus(200);
    }

    // Option 1 - Programs
    if (lowerText === "1") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "programs";
      await sendTextMessage(from, programsMenu());
      return res.sendStatus(200);
    }

    if (["1a", "1b", "1c", "1d"].includes(lowerText)) {
      const response = getProgramResponse(lowerText);
      userStates[from].previousMenu = "programs";
      userStates[from].currentMenu = lowerText;
      await sendTextMessage(from, response);
      return res.sendStatus(200);
    }

    if (["1a-more", "1b-more", "1c-more", "1d-more"].includes(lowerText)) {
      const response = getMoreProgramResponse(lowerText);
      userStates[from].previousMenu = "programs";
      userStates[from].currentMenu = lowerText;
      await sendTextMessage(from, response);
      return res.sendStatus(200);
    }

    // Option 2 - Fee Structure PDF
    if (lowerText === "2") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "fee";

      const pdfUrl = `${BASE_URL}/files/Fee%20Structure%20Spring%202026.pdf`;

      await sendTextMessage(
        from,
        `💰 Fee Structure – Spring 2026

Please find attached the complete fee structure.

Reply 0 for Main Menu
Reply APPLY to apply online`
      );

      await sendDocumentMessage(
        from,
        pdfUrl,
        "Fee Structure Spring 2026.pdf",
        "MUL Fee Structure Spring 2026"
      );

      return res.sendStatus(200);
    }

    // Option 3 - Scholarship
    if (lowerText === "3") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "scholarship";

      await sendTextMessage(
        from,
        `🎓 Scholarships

For Scholarships details please visit our website:
https://www.mul.edu.pk/en/scholarships-and-fee-concession

Reply 0 for Main Menu`
      );

      return res.sendStatus(200);
    }

    // Option 4 - How to Apply
    if (lowerText === "4") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "apply";
      await sendTextMessage(from, howToApplyMenu());
      return res.sendStatus(200);
    }

    if (lowerText === "4a") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4a";

      await sendTextMessage(
        from,
        `🏫 On Campus Admission

Please visit University admissions office with required documents.
Buy Prospectus, fill Prospectus and attach documents.
Get Admission Fee challan and pay in Account Office or affiliated banks.

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4b") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4b";

      await sendTextMessage(
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
It may take 24 to 48 hours for processing.

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );

      return res.sendStatus(200);
    }

    if (lowerText === "4c") {
      userStates[from].previousMenu = "apply";
      userStates[from].currentMenu = "4c";

      await sendTextMessage(
        from,
        `📄 Documents Requirements

• Academic Results / Transcripts / Sanad
• Student CNIC copy or B Form
• Father CNIC copy
• Domicile
• 5 Photographs

All documents should be attested.

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );

      return res.sendStatus(200);
    }

    // Option 5 - Anything Else
    if (lowerText === "5") {
      userStates[from].previousMenu = "main";
      userStates[from].currentMenu = "anything";
      await sendTextMessage(from, anythingElseMenu());
      return res.sendStatus(200);
    }

    if (lowerText === "5a") {
      await sendTextMessage(
        from,
        `🎓 Students Affairs Office

Contact Details:
042-35145621-6
Extension: 346 & 446
Email: support.dsa@mul.edu.pk

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5b") {
      await sendTextMessage(
        from,
        `📝 Examination

Contact Details:
042-35145621-6
Extension: 317 & 307
Email: support.exams@mul.edu.pk

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5c") {
      await sendTextMessage(
        from,
        `💳 Account Office

Contact Details:
042-35145621-6
Extension: 310 & 388
Email: support.accounts@mul.edu.pk

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5d") {
      await sendTextMessage(
        from,
        `🎓 Admissions

Contact Details:
03111222685
Email: admissions@mul.edu.pk

Reply 9 for Previous Menu
Reply 0 for Main Menu`
      );
      return res.sendStatus(200);
    }

    if (lowerText === "5e") {
      userStates[from].awaitingLead = true;
      userStates[from].previousMenu = "anything";
      userStates[from].currentMenu = "agent";

      await sendTextMessage(
        from,
        `👤 Talk to Agent

Please send your details in this format:

Name, Program

Example:
Ali, BS Computer Science`
      );

      return res.sendStatus(200);
    }

    // Fallback
    await sendTextMessage(
      from,
      `Sorry, I did not understand your message.

Please use one of these options:
1, 2, 3, 4, 5
or submenu options like:
1a, 1b, 4a, 5e

Reply 0 for Main Menu`
    );

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
