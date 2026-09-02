const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pool = require("./db/db");
const { testConnection } = require("./db/db");
const initDb = require("./db/initDb");
const {
  findMatchingCanonicalProgramStrict,
  tightClean: pmTightClean,
  stringSimilarity: pmStringSimilarity,
  significantProgramWords: pmSignificantWords,
  escapeRegExpLiteral: pmEscapeRegExp
} = require("./lib/programMatcher");
const { getMulProgramId } = require("./lib/mulProgramIds");
const webpush = require("web-push");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/files", express.static(path.join(__dirname, "public")));
const uploadsDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// CONFIG
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "mul_token_123";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1065169533344109";
const BASE_URL =
  process.env.BASE_URL ||
  "https://mul-whatsapp-backend-production.up.railway.app";
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY;
const WHATSAPP_FLOW_PRIVATE_KEY = (process.env.WHATSAPP_FLOW_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const WHATSAPP_FLOW_ID = process.env.WHATSAPP_FLOW_ID;
const WHATSAPP_LEAD_FLOW_ID = process.env.WHATSAPP_LEAD_FLOW_ID;
const WHATSAPP_REGISTRATION_FLOW_ID = process.env.WHATSAPP_REGISTRATION_FLOW_ID;
// MUL's own admissions CMS API (cms.mul.edu.pk) - submits a completed
// registration directly, provided by MUL IT. Kept as an env var, never in
// source, same as every other secret in this file.
const MUL_REGISTRATION_API_URL =
  process.env.MUL_REGISTRATION_API_URL ||
  "https://cms.mul.edu.pk/api/v2/wa/wa-mulnexus-registration.php";
const MUL_REGISTRATION_API_KEY = process.env.MUL_REGISTRATION_API_KEY;
// registration.php's "Source of Information" dropdown value for MUL IT's
// dedicated "WhatsApp - MUL Nexus" option (confirmed live on
// admission.mul.edu.pk). An env var, not hardcoded, in case MUL ever
// renumbers their dropdown options - no redeploy needed to fix it then.
const MUL_SOURCE_OF_INFORMATION_WHATSAPP = process.env.MUL_SOURCE_OF_INFORMATION_WHATSAPP || "16";

// Push Notifications (Web Push, no native app) - lets agents get a
// real-time alert on their phone/laptop for new agent-relevant messages
// even when admin.html/live.html isn't open. VAPID_PUBLIC_KEY is also
// handed to the browser via /api/push/vapid-public-key. Both must be set
// (a matched pair, generated together) or push is treated as disabled -
// same "both-or-neither" env var pattern as the registration flow.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@mulnexus.online";
const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("⚠️ Push notifications disabled - VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set");
}

// Outgoing email (Gmail SMTP via a dedicated @mul.edu.pk mailbox + App
// Password - not the personal inbox of anyone on the team). Used for
// agent password resets now; the student-survey email feature planned
// next will reuse this same transporter.
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "MUL Nexus";
const emailEnabled = !!(EMAIL_USER && EMAIL_APP_PASSWORD);

const emailTransporter = emailEnabled
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
      // Some hosts (Railway included) block/drop outbound SMTP silently -
      // the TCP connection just never completes instead of failing
      // cleanly, which without these left sendMail() hanging forever (no
      // response, no error - confirmed live). Fail fast instead so
      // sendEmail() always resolves one way or another within ~10s.
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    })
  : null;

if (!emailEnabled) {
  console.warn("⚠️ Email sending disabled - EMAIL_USER/EMAIL_APP_PASSWORD not set");
}

async function sendEmail({ to, subject, html }) {
  if (!emailEnabled) {
    console.error("sendEmail called but email is not configured");
    return { success: false, error: "Email not configured" };
  }
  try {
    await emailTransporter.sendMail({
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_USER}>`,
      to,
      subject,
      html
    });
    return { success: true };
  } catch (err) {
    console.error("sendEmail error:", err.message);
    return { success: false, error: err.message };
  }
}

// WhatsApp Flows data-exchange encryption (Meta's spec: RSA-OAEP-SHA256 for
// the AES key, AES-128-GCM for the payload, response IV is the bitwise
// inverse of the request IV). See:
// https://developers.facebook.com/docs/whatsapp/flows/reference/flowsdataendpoint
function decryptFlowRequest(body) {
  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const encryptedAesKeyBuffer = Buffer.from(encrypted_aes_key, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");

  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: WHATSAPP_FLOW_PRIVATE_KEY,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    encryptedAesKeyBuffer
  );

  const TAG_LENGTH = 16;
  const encryptedBody = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKeyBuffer, initialVectorBuffer);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedBody),
    decipher.final()
  ]).toString("utf-8");

  return {
    decryptedBody: JSON.parse(decrypted),
    aesKeyBuffer,
    initialVectorBuffer
  };
}

function encryptFlowResponse(responseObject, aesKeyBuffer, initialVectorBuffer) {
  const flippedIv = Buffer.from(initialVectorBuffer.map((byte) => ~byte & 0xff));

  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(responseObject), "utf-8"),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  return encrypted.toString("base64");
}

function formatPkr(amount) {
  return typeof amount === "number" ? `PKR ${amount.toLocaleString("en-PK")}` : "N/A";
}

// ============================================================
// FEE PROGRAM CATALOG MATCHING
// Recognizes a program by name/keyword directly against the live
// fee_programs table (Settings > Fee Structure - admin-editable "Keywords
// / Alternate Names" field), so the bot can answer a fee/eligibility
// question - or a bare program mention like "BSSC" - with real numbers
// straight in the chat, instead of only pointing at the generic PDF.
// Deliberately NOT the same engine as lib/programMatcher.js's static
// MUL_CANONICAL_PROGRAMS list: that list is for classifying leads and
// doesn't know which programs actually have fee data published, or what
// an admin has typed as a keyword for a specific program today.
// ============================================================

async function getActiveFeeProgramCatalog() {
  const result = await pool.query(
    `
    SELECT id, program_name, keywords, pattern_type, admission_fee,
           per_instalment_amount, total_instalments, early_semester_amount,
           later_semester_amount, total_fee, eligibility_criteria
    FROM fee_programs
    WHERE active = true
    `
  );
  return result.rows;
}

function feeProgramPhrases(row) {
  const phrases = [row.program_name];
  if (row.keywords) {
    for (const k of row.keywords.split(",")) {
      const trimmed = k.trim();
      if (trimmed) phrases.push(trimmed);
    }
  }
  return phrases.filter(p => pmTightClean(p).length >= 2);
}

// Tier 1: does any known phrase (program name or an admin-added keyword)
// for any program appear as a whole word/phrase in the message? Word-
// boundary matched, not a plain substring check, for the same reason
// isBareProgramMention needed it earlier ("llm" inside "enrollment").
// Longer phrases are checked first so a specific match ("bs ai") wins over
// an accidental shorter one.
function matchFeeProgramConfident(rawText, catalog) {
  const candidates = [];
  for (const row of catalog) {
    for (const phrase of feeProgramPhrases(row)) {
      candidates.push({ row, phrase });
    }
  }
  candidates.sort((a, b) => b.phrase.length - a.phrase.length);

  for (const { row, phrase } of candidates) {
    const re = new RegExp(`\\b${pmEscapeRegExp(phrase).replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(rawText)) return row;
  }
  return null;
}

// Tier 2: no exact phrase found - loose fuzzy fallback for a typo'd
// program name ("BSSC" if it weren't already a known keyword). Threshold
// is deliberately high (0.82) since this only runs after we already know
// the message looks like a fee question or a bare program mention, not on
// arbitrary free text.
function matchFeeProgramFuzzy(rawText, catalog) {
  const inputWords = pmSignificantWords(rawText);
  if (!inputWords.length) return null;

  let best = null;
  let bestScore = 0;
  for (const row of catalog) {
    for (const phrase of feeProgramPhrases(row)) {
      const phraseWords = pmSignificantWords(phrase);
      // Same lesson as lib/programMatcher.js's strict mode: a phrase with
      // only one significant word ("BS E-Commerce" -> just "commerce")
      // lets an ordinary similarly-spelled English word ("commence")
      // false-match it. Require at least two words for this fuzzy path -
      // single-word phrases still match fine via the exact/confident tier
      // above, just not through typo-tolerant fuzzy matching.
      if (phraseWords.length < 2) continue;

      for (const pw of phraseWords) {
        if (pw.length < 4) continue;
        for (const iw of inputWords) {
          if (iw.length < 4) continue;
          const score = pmStringSimilarity(iw, pw);
          if (score > bestScore) { bestScore = score; best = row; }
        }
      }
    }
  }
  return bestScore >= 0.82 ? best : null;
}

// Combined lookup: { row, confident } or null if nothing usable found at
// all (caller decides the fallback for that case).
function matchFeeProgramFromCatalog(rawText, catalog) {
  const confidentMatch = matchFeeProgramConfident(rawText, catalog);
  if (confidentMatch) return { row: confidentMatch, confident: true };

  const fuzzyMatch = matchFeeProgramFuzzy(rawText, catalog);
  if (fuzzyMatch) return { row: fuzzyMatch, confident: false };

  return null;
}

function buildFeeProgramAnswer(row) {
  const feeLines = [];
  if (row.admission_fee != null) {
    feeLines.push(`Admission Fee: Approx ${formatPkr(Number(row.admission_fee))}`);
  }
  if (row.pattern_type === "quarterly") {
    if (row.per_instalment_amount != null) {
      const count = row.total_instalments ? ` × ${row.total_instalments} instalments` : "";
      feeLines.push(`Per Instalment: Approx ${formatPkr(Number(row.per_instalment_amount))}${count}`);
    }
  } else {
    if (row.early_semester_amount != null) {
      feeLines.push(`1st & 2nd Semester: Approx ${formatPkr(Number(row.early_semester_amount))} each`);
    }
    if (row.later_semester_amount != null) {
      feeLines.push(`Later Semesters: Approx ${formatPkr(Number(row.later_semester_amount))} each`);
    }
  }
  if (row.total_fee != null) {
    feeLines.push(`Total Fee Package: Approx ${formatPkr(Number(row.total_fee))}`);
  }

  const feeBlock = feeLines.length
    ? `💰 ${feeLines.join("\n")}`
    : `💰 Fee details for this program aren't published yet - please check with our admissions advisor.`;

  const eligibilityBlock = row.eligibility_criteria
    ? `\n\n📋 Eligibility: ${row.eligibility_criteria}`
    : "";

  return `🎓 ${row.program_name}

${feeBlock}${eligibilityBlock}

For more details, you can chat with our admission advisor (during office hours: Mon–Fri, 9:00 AM – 4:30 PM). Type 7 anytime.`;
}

// Sends the matched program's answer (confident, or hedged with a "did you
// mean" for a fuzzy match) and returns true - or returns false without
// sending anything if there was no match at all, so the caller can decide
// its own fallback (generic Fee Structure PDF for a fee question, an
// apology + program list for a bare program-name mention that didn't
// resolve to anything real).
async function sendFeeProgramMatchReply(from, match) {
  if (!match) return false;

  await saveUserInteraction(from, "bot_info", "fee_structure");

  if (match.confident) {
    await sendTextMessage(from, buildFeeProgramAnswer(match.row));
  } else {
    await sendTextMessage(
      from,
      `Mujhe lagta hai ap *${match.row.program_name}* ke baray mein poochna chahte hain:

${buildFeeProgramAnswer(match.row)}

Agar yeh sahi nahi hai, 1️⃣ dabayen humare offered programs ki poori list dekhne ke liye.`
    );
  }

  return true;
}

async function getFeeCategoryOptions() {
  const result = await pool.query(
    "SELECT id, label FROM fee_categories WHERE active = true ORDER BY display_order ASC, label ASC"
  );
  return result.rows.map((row) => ({ id: String(row.id), title: row.label }));
}

async function getFeeProgramOptions(categoryId) {
  const result = await pool.query(
    "SELECT program_name FROM fee_programs WHERE category_id = $1 AND active = true ORDER BY program_name ASC",
    [categoryId]
  );
  return result.rows.map((row) => ({ id: row.program_name, title: row.program_name }));
}

async function sendFeeCalculatorFlow(to) {
  if (!WHATSAPP_FLOW_ID) return;
  try {
    const categories = await getFeeCategoryOptions();

    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          header: { type: "text", text: "Explore Programs & Fees" },
          body: { text: "Browse programs, check eligibility, and see the exact fee - all in a few taps." },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: WHATSAPP_FLOW_ID,
              flow_cta: "Explore Now",
              flow_action: "navigate",
              flow_action_payload: {
                screen: "CATEGORY",
                data: { categories }
              }
            }
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

    // Logged only after the WhatsApp API call actually succeeds - this
    // used to run before the send attempt, so a failed delivery (network
    // error, rejected token, rate limit) still counted as "Sent" on the
    // Flow Performance panel, inflating the denominator with flows the
    // student never actually saw.
    await saveUserInteraction(to, "flow_sent", "fee_calculator");
  } catch (error) {
    console.error("Send fee calculator flow error:", error.response?.data || error.message);
    recordSendFailure();
  }
}

// The full Fee Structure PDF + Fee Calculator Flow - what option 2 always
// showed. Extracted into its own function so the new per-program fee
// answer (matchFeeProgramFromCatalog below) can fall back to this exact
// same thing when a "fee" question doesn't clearly name one of our actual
// programs, instead of duplicating it.
async function sendGenericFeeStructure(from) {
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

  await sendFeeCalculatorFlow(from);
}

async function sendLeadCaptureFlow(to) {
  if (!WHATSAPP_LEAD_FLOW_ID) return false;
  try {
    const categories = await getFeeCategoryOptions();

    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          header: { type: "text", text: "Talk to an Advisor" },
          body: { text: "Please share a few quick details so our admissions team can reach out to you." },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: WHATSAPP_LEAD_FLOW_ID,
              flow_cta: "Continue",
              flow_action: "navigate",
              flow_action_payload: {
                screen: "LEAD_CATEGORY",
                data: { categories }
              }
            }
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

    // Logged only after the WhatsApp API call actually succeeds - see the
    // matching comment in sendFeeCalculatorFlow above.
    await saveUserInteraction(to, "flow_sent", "lead_capture_flow");
    return true;
  } catch (error) {
    console.error("Send lead capture flow error:", error.response?.data || error.message);
    recordSendFailure();
    return false;
  }
}

// Uses its own screens (REG_CATEGORY -> REG_PROGRAM), kept fully separate
// from the Lead Capture Flow's LEAD_CATEGORY/LEAD_PROGRAM - a distinct Flow
// in Meta Business Suite with its own Flow ID, not shared or derived at
// runtime (built by duplicating the Lead Capture Flow as a starting point
// and renaming its screens, since the category->program cascade logic is
// identical, but the two are otherwise fully independent from here on).
// WHATSAPP_REGISTRATION_FLOW_ID is a separate env var; if it isn't set yet,
// this returns false and the caller falls back to the plain
// admission.mul.edu.pk link exactly as before - zero risk shipping this
// ahead of the Flow being created.
async function sendRegistrationFlow(to) {
  // Both need to be present - offering the Flow with no API key configured
  // would let a student fill in the whole form only to hit a guaranteed
  // failure at submission (real scenario: only MUL_REGISTRATION_API_KEY
  // got removed while pausing this feature, Flow ID was left in place).
  if (!WHATSAPP_REGISTRATION_FLOW_ID || !MUL_REGISTRATION_API_KEY) return false;
  try {
    const categories = await getFeeCategoryOptions();

    await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          header: { type: "text", text: "Complete Your Registration" },
          body: { text: "Register for admission directly here - no need to visit the website." },
          action: {
            name: "flow",
            parameters: {
              flow_message_version: "3",
              flow_id: WHATSAPP_REGISTRATION_FLOW_ID,
              flow_cta: "Register Now",
              flow_action: "navigate",
              flow_action_payload: {
                screen: "REG_CATEGORY",
                data: { categories }
              }
            }
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

    await saveUserInteraction(to, "flow_sent", "registration_flow");
    return true;
  } catch (error) {
    console.error("Send registration flow error:", error.response?.data || error.message);
    recordSendFailure();
    return false;
  }
}

// Every "Apply Now" entry point in the bot should offer the real
// registration Flow first, and only fall back to the plain website link if
// the Flow isn't configured yet or fails to send - never a dead end.
async function offerRegistrationFlow(from) {
  const flowSent = await sendRegistrationFlow(from);
  if (!flowSent) {
    await sendTextMessage(from, applyNowMessage());
  }
}

// MUL's Fee Categories are stored as free-text labels ("Associate Degree
// Programs (ADP)", "BS Programs"...) but cms.mul.edu.pk's registration API
// expects one of its own fixed short codes (adp/bs/mphil/phd/course) - this
// maps by keyword rather than an exact-string table so small label wording
// differences don't silently break every submission.
function mapCategoryLabelToMulCode(categoryLabel) {
  const lower = String(categoryLabel || "").toLowerCase();
  if (lower.includes("associate") || lower.includes("adp")) return "adp";
  if (lower.includes("m.phil") || lower.includes("mphil") || lower.includes("ms ") || lower.includes(" ms")) return "mphil";
  if (lower.includes("ph.d") || lower.includes("phd") || lower.includes("doctor of philosophy")) return "phd";
  if (lower.includes("short") || lower.includes("diploma") || lower.includes("course")) return "course";
  return "bs";
}

async function getFeeCategoryLabel(categoryId) {
  const result = await pool.query("SELECT label FROM fee_categories WHERE id = $1", [categoryId]);
  return result.rows[0]?.label || "";
}

// WhatsApp gives us the phone in international format with no leading "+"
// (e.g. "923001234567"). The one manual test that actually succeeded used
// local Pakistani format ("03001234567") - every automated submission
// since (still sending the raw WhatsApp format) has failed with
// "Validation failed", so cms.mul.edu.pk's mobile_number field very likely
// only accepts the local 03xxxxxxxxx form.
function formatPhoneForMul(waPhone) {
  const digits = String(waPhone || "").replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) {
    return "0" + digits.slice(2);
  }
  return digits;
}

// Resolves a program's MUL numeric id, checking the admin-editable
// fee_programs.mul_program_id column FIRST (so a newly-added program can be
// mapped by whoever manages Fee Structure, straight from the admin panel,
// without needing a code change) and only falling back to the built-in
// scraped map (lib/mulProgramIds.js) if nothing's been entered there.
// Scoped to categoryId (not just the category label) so it can never
// cross-match a same-named program sitting in a different category.
async function resolveMulProgramId(program, categoryId, mulCategory) {
  if (categoryId) {
    try {
      const dbResult = await pool.query(
        `
        SELECT mul_program_id FROM fee_programs
        WHERE category_id = $1 AND LOWER(program_name) = LOWER($2)
        LIMIT 1
        `,
        [categoryId, program]
      );
      const dbId = dbResult.rows[0]?.mul_program_id;
      if (dbId && dbId.trim()) return dbId.trim();
    } catch (err) {
      console.error("resolveMulProgramId DB lookup error:", err.message);
    }
  }

  return getMulProgramId(program, mulCategory);
}

// Submits a completed registration to MUL's own admissions system
// (cms.mul.edu.pk, provided by MUL IT). Always saves a local copy in
// mul_registrations regardless of the outcome - if MUL's side has any
// issue, the data isn't lost, and an admin can see/resubmit it.
async function submitMulRegistration({ phone, fullName, email, category, categoryId, program }) {
  const idempotencyKey = `WA-${phone}-${Date.now()}`;
  let result;

  // cms.mul.edu.pk rejects a plain program name ("BS Data Science") with
  // "Validation failed" - confirmed by direct testing - it needs the same
  // numeric id (e.g. "292,0") the real registration.php form itself sends.
  // If we can't confidently resolve one, don't guess and don't call the
  // API at all - a wrong-but-"successful"-looking submission would be
  // worse than an honest local failure here.
  const mulProgramId = await resolveMulProgramId(program, categoryId, category);

  if (!MUL_REGISTRATION_API_KEY) {
    result = { success: false, reference: null, error: "MUL_REGISTRATION_API_KEY not configured" };
  } else if (!mulProgramId) {
    result = {
      success: false,
      reference: null,
      error: `No MUL program id mapping found for "${program}" in category "${category}"`
    };
  } else {
    try {
      const response = await axios.post(
        MUL_REGISTRATION_API_URL,
        {
          full_name: fullName,
          mobile_number: formatPhoneForMul(phone),
          email,
          category,
          program: mulProgramId,
          // MUL IT added a dedicated "WhatsApp - MUL Nexus" option to the
          // real registration.php dropdown (value "16", confirmed live) -
          // we'd been sending the literal string "whatsapp" before this
          // existed. Kept as a named constant since this is exactly the
          // kind of value MUL could renumber if their dropdown options
          // ever get reordered/edited.
          source_of_information: MUL_SOURCE_OF_INFORMATION_WHATSAPP
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": MUL_REGISTRATION_API_KEY,
            "Idempotency-Key": idempotencyKey
          },
          timeout: 15000
        }
      );

      result = {
        success: !!response.data?.success,
        reference: response.data?.reference || null,
        error: response.data?.success ? null : (response.data?.message || "Unknown response")
      };
    } catch (error) {
      result = {
        success: false,
        reference: null,
        error: error.response?.data?.message || error.message
      };
    }
  }

  try {
    await pool.query(
      `
      INSERT INTO mul_registrations
        (phone, full_name, email, category, program, idempotency_key, mul_success, mul_reference, mul_error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [phone, fullName, email, category, program, idempotencyKey, result.success, result.reference, result.error]
    );
  } catch (dbError) {
    console.error("mul_registrations insert error:", dbError.message);
  }

  return result;
}

async function getFeeResult(categoryId, programName) {
  const result = await pool.query(
    "SELECT * FROM fee_programs WHERE category_id = $1 AND program_name = $2 LIMIT 1",
    [categoryId, programName]
  );
  const entry = result.rows[0];

  if (!entry) {
    return {
      program: programName,
      eligibility: "Not available - please contact an admissions advisor.",
      admission_fee: "N/A",
      installment_detail: "Fee details not available - please contact an admissions advisor.",
      total_fee: "N/A"
    };
  }

  const perInstalment = entry.per_instalment_amount != null ? Number(entry.per_instalment_amount) : null;
  const earlyAmount = entry.early_semester_amount != null ? Number(entry.early_semester_amount) : null;
  const lateAmount = entry.later_semester_amount != null ? Number(entry.later_semester_amount) : null;
  const admissionFee = entry.admission_fee != null ? Number(entry.admission_fee) : null;
  const totalFee = entry.total_fee != null ? Number(entry.total_fee) : null;

  const installmentDetail = perInstalment != null
    ? `${formatPkr(perInstalment)} per quarterly instalment (${entry.total_instalments} instalments)`
    : earlyAmount != null
      ? `${formatPkr(earlyAmount)} (1st & 2nd semester), then ${formatPkr(lateAmount)} per semester after`
      : "Fee details not available yet - please contact an admissions advisor.";

  return {
    program: entry.program_name,
    eligibility: entry.eligibility_criteria || "Not available - please contact an admissions advisor.",
    admission_fee: formatPkr(admissionFee),
    installment_detail: installmentDetail,
    total_fee: formatPkr(totalFee)
  };
}

function isValidRecoveryKey(providedKey) {
  if (!ADMIN_RECOVERY_KEY || !providedKey) return false;
  const provided = Buffer.from(String(providedKey));
  const expected = Buffer.from(ADMIN_RECOVERY_KEY);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

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

const USER_STATE_MAX_IDLE_MS = 48 * 60 * 60 * 1000; // 48 hours

setInterval(() => {
  const now = Date.now();
  for (const phone in userStates) {
    const lastSeenAt = userStates[phone]?.lastSeenAt || 0;
    if (now - lastSeenAt > USER_STATE_MAX_IDLE_MS) {
      delete userStates[phone];
    }
  }
}, 60 * 60 * 1000); // runs every hour

// =========================
// SYSTEM HEALTH TRACKING
// =========================
let lastFollowupCheckAt = null;
let lastCallbackOfferCheckAt = null;
let recentSendFailures = [];

function recordSendFailure() {
  const now = Date.now();
  recentSendFailures.push(now);
  recentSendFailures = recentSendFailures.filter(t => now - t <= 60 * 60 * 1000);
}

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

// Only option 7 ("Chat with Admissions Advisor") used to check this before
// telling a student "connecting you" - every other path into agent_waiting
// (option 1, option 2, typed "Name, Program", the Lead Capture WhatsApp
// Flow, "yes" re-engagement, and the program-mention auto-detection) skipped
// it entirely, so a student contacting outside support hours got a
// "please wait a moment" that nobody was ever coming to answer, with the
// bot itself now silenced (mode="agent") - a real dead end. This shared
// message + the isAgentAvailable() check are now used consistently at
// every one of those entry points.
function agentUnavailableMessage() {
  return `Thank you for contacting Minhaj University Lahore.

Our representatives are currently unavailable as this inquiry has been received outside our support hours.

🕘 Support Hours:
Monday to Friday: 09:00 AM – 04:30 PM

For immediate information, you may continue exploring the available menu options.

Thank you for your patience.`;
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

// Bounded-concurrency drop-in for pool.query(), used only by
// /api/dashboard's query fan-out. That endpoint fires ~34 queries at
// once via Promise.all - fine for the app's own connection pool (see
// db/db.js), but Railway's Postgres plan has its own server-side
// connection ceiling we have no way to see or confirm (their Console
// doesn't support running a query to check it), and asking for more
// connections than the DB will admit just means the excess queue
// invisibly at the server - confirmed live as p99 response-time spikes
// of 20-25s with 0% error rate and near-idle CPU/Memory on both
// services, not the connection-pool-exhaustion-with-visible-hang this
// was first (wrongly) diagnosed as. Capping how many of THIS endpoint's
// queries are ever in flight at once keeps its peak connection demand
// well under any plausible real ceiling, whatever it turns out to be.
const DASHBOARD_QUERY_CONCURRENCY = 8;
let dashboardQueryActive = 0;
const dashboardQueryQueue = [];

function runDashboardQuery(sql, params) {
  return new Promise((resolve, reject) => {
    const run = () => {
      dashboardQueryActive++;
      pool.query(sql, params)
        .then(resolve, reject)
        .finally(() => {
          dashboardQueryActive--;
          const next = dashboardQueryQueue.shift();
          if (next) next();
        });
    };

    if (dashboardQueryActive < DASHBOARD_QUERY_CONCURRENCY) {
      run();
    } else {
      dashboardQueryQueue.push(run);
    }
  });
}

// Sends one push notification, cleaning up the subscription if the
// browser reports it's gone (404/410 - user uninstalled, cleared site
// data, or revoked permission) so it doesn't get retried forever.
async function sendPushToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]).catch(() => {});
    } else {
      console.error("web-push send error:", err.message);
    }
  }
}

async function sendPushToAgents(agentIds, payload) {
  if (!pushEnabled || !agentIds || !agentIds.length) return;
  try {
    const result = await pool.query(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE agent_id = ANY($1::int[])",
      [agentIds]
    );
    await Promise.all(result.rows.map(sub => sendPushToSubscription(sub, payload)));
  } catch (err) {
    console.error("sendPushToAgents error:", err.message);
  }
}

// Broadcasts to every subscribed admin/chat_agent - used for "a student
// needs an agent" type events where any available agent can pick it up,
// as opposed to a message in a chat already assigned to one specific agent.
async function sendPushToAllAvailableAgents(payload) {
  if (!pushEnabled) return;
  try {
    const result = await pool.query(`
      SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
      FROM push_subscriptions ps
      JOIN agents a ON a.id = ps.agent_id
      WHERE a.role IN ('admin', 'chat_agent')
    `);
    await Promise.all(result.rows.map(sub => sendPushToSubscription(sub, payload)));
  } catch (err) {
    console.error("sendPushToAllAvailableAgents error:", err.message);
  }
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
  {
    name = null,
    program = null,
    mode = null,
    awaitingLead = null,
    awaitingCallbackLead = null
  }
) {
  try {
    await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE(NULLIF($2, ''), name),
        program = COALESCE($3, program),
        mode = COALESCE($4, mode),
        awaiting_lead = COALESCE($5, awaiting_lead),
        awaiting_callback_lead = COALESCE($6, awaiting_callback_lead),
        program_captured_at = CASE
          WHEN $3 IS NOT NULL AND TRIM($3) <> '' THEN NOW()
          ELSE program_captured_at
        END
      WHERE phone = $1
      `,
      [phone, name, program, mode, awaitingLead, awaitingCallbackLead]
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

// source: "student_request" (default - student explicitly asked for a
// call, typed "call me back", etc) or "meta_ad" (proactively queued
// because their conversation started from a Click-to-WhatsApp ad - they
// never actually asked for a callback). Surfaced to Call Agents in
// /api/callbacks so they don't open a call with "you requested a
// callback" when the student never said that.
async function createCallbackRequest(phone, source = "student_request") {
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
          updated_at = NOW(),
          assigned_call_agent_id = NULL,
          next_followup_at = NULL,
          first_response_at = NULL,
          first_response_seconds = NULL,
          first_response_status = NULL,
          first_response_agent_id = NULL,
          source = $4
        WHERE id = $1
        `,
        [
          existing.id,
          user.name || null,
          user.program || null,
          source
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
          updated_at,
          source
        )
        VALUES ($1, $2, $3, 'pending', 1, false, NOW(), NOW(), $4)
        RETURNING id
        `,
        [
          phone,
          user.name || null,
          user.program || null,
          source
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
  mime_type = null,
  wamid = null,
  status = null,
  reply_to_text = null,
  reply_to_sender = null,
  reply_to_type = null
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
        wamid,
        status,
        reply_to_text,
        reply_to_sender,
        reply_to_type,
        created_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
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
        mime_type,
        wamid,
        status,
        reply_to_text,
        reply_to_sender,
        reply_to_type
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

// Looks up the message an agent is replying to and returns the WhatsApp
// context needed to send a quoted reply. Returns null (silently, no
// quote attached) if the message has no wamid - e.g. bot messages,
// which aren't tracked for read-receipts and can't be quoted via the API.
async function buildReplyContext(phone, replyToMessageId) {
  if (!replyToMessageId) return null;

  const result = await pool.query(
    "SELECT wamid, text, sender, type FROM messages WHERE id = $1 AND phone = $2 LIMIT 1",
    [replyToMessageId, phone]
  );
  const quoted = result.rows[0];
  if (!quoted?.wamid) return null;

  return {
    wamid: quoted.wamid,
    text: (quoted.text || "").slice(0, 200),
    sender: quoted.sender,
    type: quoted.type
  };
}

const MESSAGE_STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

async function updateMessageStatus(wamid, newStatus) {
  try {
    if (!wamid || !MESSAGE_STATUS_RANK[newStatus]) return;

    const result = await pool.query(
      "SELECT phone, status FROM messages WHERE wamid = $1 LIMIT 1",
      [wamid]
    );
    if (!result.rows.length) return;

    const { phone, status: currentStatus } = result.rows[0];
    const currentRank = MESSAGE_STATUS_RANK[currentStatus] || 0;

    if (MESSAGE_STATUS_RANK[newStatus] <= currentRank) return;

    await pool.query(
      "UPDATE messages SET status = $1 WHERE wamid = $2",
      [newStatus, wamid]
    );

    notifyChatUpdated(phone);
  } catch (err) {
    console.error("updateMessageStatus error:", err.message);
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
  if (mimeType.includes("msword")) return "doc";
  if (mimeType.includes("wordprocessingml.document")) return "docx";
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

// Real incoming-message data (5000-message audit, Aug 2026) showed a lot of
// free text falling into a handful of recurring, recognizable patterns that
// the old fee/scholarship/admission/agent keyword buckets never covered -
// greetings, plain acknowledgments, ad-click openers, bare program names,
// challan/payment problems, percentage/eligibility questions, deadline
// questions, and job/career inquiries. These helpers detect those patterns
// without needing any external AI - just normalized string matching against
// real spelling variants seen in production.

function isGreetingOnly(rawText) {
  // Guard first: every real menu code contains a digit (1a, 6k, 4b...) and
  // no genuine greeting does. Without this, digit-stripping below could
  // collapse a real code down to a letter that coincidentally matches.
  if (/\d/.test(String(rawText || "").trim())) return false;

  const clean = String(rawText || "").toLowerCase().replace(/[^a-z؀-ۿ]/g, "");
  if (!clean) return false;

  const knownGreetings = [
    "hi", "hii", "hiii", "hiiii", "hello", "hellooo", "hey", "heyy", "heyyy",
    "hlo", "hy", "hyy", "hola",
    "salam", "salaam", "assalam", "aoa", "aoaa",
    "assalamoalaikum", "assalamualaikum", "asalamualaikum", "asalamoalaikum",
    "asslamoalaikum", "asslamoalikum", "assalamoalikum", "assalamalikum",
    "assalamualikum", "asalamalaikum", "assalamalaikum", "aslamualaikum",
    "salamualaikum", "walaikumassalam", "waalaikumassalam", "wasalam"
  ];
  if (knownGreetings.includes(clean)) return true;

  // Short pure Arabic-script message (e.g. "السلام علیکم") - our keyword
  // matching only ever checks Roman/English substrings, so this script is
  // otherwise completely invisible to it. Most such short messages here are
  // greetings, so treat them as one rather than dead-ending silently.
  const trimmed = String(rawText || "").trim();
  if (trimmed && /^[؀-ۿ\s!؟.,]+$/.test(trimmed) && trimmed.length <= 30) {
    return true;
  }

  return false;
}

function isAcknowledgmentOnly(rawText) {
  // Same digit-guard as isGreetingOnly - "6k" must never collapse to "k"
  // and get mistaken for the filler word "k".
  if (/\d/.test(String(rawText || "").trim())) return false;

  const clean = String(rawText || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return false;

  const knownFillers = [
    "ok", "okk", "okkk", "okay", "okey", "okie", "k", "kk",
    "yes", "yep", "yup", "sure", "great", "greatthanks", "thanks", "thankyou",
    "thanku", "thnx", "tysm", "gotit", "noted", "done", "fine", "alright",
    "cool", "nice", "good", "gud", "understood", "welcome"
  ];
  return knownFillers.includes(clean);
}

// Generic ad/lead-form auto-fill openers (Meta "Send Message" click-to-chat
// buttons pre-fill these verbatim - not something the student typed
// themselves, so it should behave like a fresh MENU trigger, not an
// unrecognized message).
function isAdOpenerMessage(rawText) {
  const trimmed = String(rawText || "").trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === "hello! can i get more info on this?") return true;
  if (trimmed.startsWith("hello! i filled out your form")) return true;
  return false;
}

// Full fuzzy program-catalog matcher, ported from the admin dashboard's
// lead classifier (see lib/programMatcher.js) - catches typos, abbreviations
// and extra filler words ("Pharm D ka Kya merit he", "Uzma Shoukat,
// M.phil"), not just a fixed list of exact spellings.
function isBareProgramMention(rawText) {
  const clean = String(rawText || "").trim();
  if (!clean) return false;
  // Keep this narrow - only short messages, so it doesn't fire on a long
  // sentence that merely mentions a program name in passing.
  if (clean.split(/\s+/).length > 8) return false;

  return !!findMatchingCanonicalProgramStrict(clean);
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
8️⃣ Request a Call Back
9️⃣ Apply Now

📌 Please reply with the number of your choice.

Example:
Send 1 for Programs
Send 2 for Fee Structure
Send 7 to connect with an Admissions Advisor
Send 8 to request a call back
Send 9 to apply now

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
    recordSendFailure();
  }
}

async function sendDocumentMessage(
  to,
  documentUrl,
  filename,
  caption = "",
  chatStatus = "active",
  sender = "bot",
  mimeType = "application/pdf",
  replyContext = null
) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        link: documentUrl,
        filename,
        caption
      }
    };
    if (replyContext?.wamid) payload.context = { message_id: replyContext.wamid };

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Read-receipt tracking is only wired up for agent-sent messages -
    // bot messages stay untouched (wamid/status left null).
    const wamid = sender === "agent" ? (response?.data?.messages?.[0]?.id || null) : null;

    await saveMessage({
      phone: to,
      sender,
      type: "document",
      text: caption || filename,
      media_url: documentUrl,
      file_name: filename,
      mime_type: mimeType,
      wamid,
      status: wamid ? "sent" : null,
      reply_to_text: replyContext?.wamid ? replyContext.text : null,
      reply_to_sender: replyContext?.wamid ? replyContext.sender : null,
      reply_to_type: replyContext?.wamid ? replyContext.type : null
    });

    await setOutgoingMeta(to, caption || filename, chatStatus);
  } catch (error) {
    console.error("Send document error:", error.response?.data || error.message);
    recordSendFailure();
  }
}

async function sendImageMessage(
  to,
  imageUrl,
  caption = "",
  chatStatus = "active",
  sender = "agent",
  replyContext = null
) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption
      }
    };
    if (replyContext?.wamid) payload.context = { message_id: replyContext.wamid };

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const wamid = sender === "agent" ? (response?.data?.messages?.[0]?.id || null) : null;

    await saveMessage({
      phone: to,
      sender,
      type: "image",
      text: caption || "",
      media_url: imageUrl,
      mime_type: "image/jpeg",
      wamid,
      status: wamid ? "sent" : null,
      reply_to_text: replyContext?.wamid ? replyContext.text : null,
      reply_to_sender: replyContext?.wamid ? replyContext.sender : null,
      reply_to_type: replyContext?.wamid ? replyContext.type : null
    });

    await setOutgoingMeta(to, caption || "[Image]", chatStatus);
  } catch (error) {
    console.error("Send image error:", error.response?.data || error.message);
    recordSendFailure();
  }
}

async function sendAgentTextMessage(to, message, chatStatus = "agent_active", replyContext = null) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message }
    };
    if (replyContext?.wamid) payload.context = { message_id: replyContext.wamid };

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const wamid = response?.data?.messages?.[0]?.id || null;

    await saveMessage({
      phone: to,
      sender: "agent",
      type: "text",
      text: message,
      wamid,
      status: wamid ? "sent" : null,
      reply_to_text: replyContext?.wamid ? replyContext.text : null,
      reply_to_sender: replyContext?.wamid ? replyContext.sender : null,
      reply_to_type: replyContext?.wamid ? replyContext.type : null
    });

    await setOutgoingMeta(to, message, chatStatus);
  } catch (error) {
    console.error(
      "Send agent text error:",
      error.response?.data || error.message
    );
    recordSendFailure();
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
    recordSendFailure();
  }
}

// =========================
// 24H FOLLOW-UP CHECKER
// =========================
async function checkPendingFollowups() {
  lastFollowupCheckAt = Date.now();
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
  lastCallbackOfferCheckAt = Date.now();
  try {
    console.log("Running callback offer checker...");

    const result = await pool.query(`
      SELECT phone
      FROM chats
      WHERE status = 'agent_waiting'
        AND callback_offer_last_sent_at IS NULL
        AND agent_waiting_started_at IS NOT NULL
        AND agent_waiting_started_at <= NOW() - INTERVAL '10 minutes'
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

const MEDIA_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

async function cleanupOldMedia() {
  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    let deletedCount = 0;

    for (const fileName of files) {
      const filePath = path.join(uploadsDir, fileName);

      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch (err) {
        continue;
      }

      if (!stats.isFile()) continue;

      if (now - stats.mtimeMs > MEDIA_MAX_AGE_MS) {
        fs.unlinkSync(filePath);
        deletedCount += 1;

        await pool.query(
          `
          UPDATE messages
          SET media_url = NULL, text = '[Media expired - older than 5 days]'
          WHERE media_url LIKE $1
          `,
          [`%${fileName}%`]
        );
      }
    }

    if (deletedCount > 0) {
      console.log(`cleanupOldMedia: deleted ${deletedCount} file(s) older than 5 days`);
    }
  } catch (error) {
    console.error("cleanupOldMedia error:", error.message);
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

// FORGOT PASSWORD - sends a reset link to the agent's email on file.
// Deliberately specific error messages (no email on file / account not
// found) rather than a generic "if this account exists" response - this
// is a small internal team, not a public sign-up, so the usual
// enumeration-prevention trade-off isn't worth the extra support burden
// of agents not knowing why nothing arrived.
app.post("/api/forgot-password", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !String(username).trim()) {
      return res.status(400).json({ success: false, error: "Username is required" });
    }

    const result = await pool.query(
      "SELECT id, name, email FROM agents WHERE username = $1 AND active = true LIMIT 1",
      [String(username).trim()]
    );
    const agent = result.rows[0];

    if (!agent) {
      return res.status(404).json({ success: false, error: "No account found with that username" });
    }

    if (!agent.email) {
      return res.status(400).json({
        success: false,
        error: "No email is on file for this account - ask an admin to reset your password, or add an email to your profile first"
      });
    }

    if (!emailEnabled) {
      return res.status(503).json({ success: false, error: "Email sending isn't configured yet - ask an admin to reset your password directly" });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await pool.query(
      "INSERT INTO password_reset_tokens (agent_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [agent.id, tokenHash, expiresAt]
    );

    const resetUrl = `${BASE_URL}/reset-password.html?token=${rawToken}`;

    const emailResult = await sendEmail({
      to: agent.email,
      subject: "Reset your MUL Nexus password",
      html: `
        <p>Hi ${agent.name || ""},</p>
        <p>Someone requested a password reset for your MUL Nexus account. Click the button below to set a new password - this link expires in 30 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#2f7df6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>
        <p>If you didn't request this, you can safely ignore this email - your password won't change unless you click the link above and set a new one.</p>
        <p style="color:#888;font-size:12px;">MUL Nexus Admissions System</p>
      `
    });

    if (!emailResult.success) {
      return res.status(500).json({ success: false, error: "Failed to send reset email - please try again" });
    }

    return res.json({ success: true, message: `Reset link sent to ${agent.email}` });
  } catch (error) {
    console.error("POST /api/forgot-password error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to process request" });
  }
});

app.post("/api/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: "Token and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");

    const tokenResult = await pool.query(
      `
      SELECT id, agent_id, expires_at, used
      FROM password_reset_tokens
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash]
    );
    const tokenRow = tokenResult.rows[0];

    if (!tokenRow) {
      return res.status(400).json({ success: false, error: "This reset link is invalid" });
    }
    if (tokenRow.used) {
      return res.status(400).json({ success: false, error: "This reset link has already been used" });
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: "This reset link has expired - request a new one" });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE agents SET password_hash = $1 WHERE id = $2", [password_hash, tokenRow.agent_id]);
    await pool.query("UPDATE password_reset_tokens SET used = true WHERE id = $1", [tokenRow.id]);

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/reset-password error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to reset password" });
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
          cb.source,
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

// =========================
// QUICK REPLIES APIs
// =========================

app.get("/api/quick-replies", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, shortcut, message, created_at, updated_at
      FROM quick_replies
      ORDER BY shortcut ASC
    `);

    return res.json({
      success: true,
      quickReplies: result.rows
    });
  } catch (error) {
    console.error("GET /api/quick-replies error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch quick replies"
    });
  }
});

app.post("/api/quick-replies", authenticateAgent, async (req, res) => {
  try {
    const { shortcut, message } = req.body;

    if (!shortcut || !message) {
      return res.status(400).json({
        success: false,
        error: "Shortcut and message are required"
      });
    }

    const cleanShortcut = String(shortcut).trim().toLowerCase().replace(/^\/+/, "");

    if (!cleanShortcut) {
      return res.status(400).json({
        success: false,
        error: "Shortcut cannot be empty"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO quick_replies (shortcut, message)
      VALUES ($1, $2)
      RETURNING id, shortcut, message, created_at, updated_at
      `,
      [cleanShortcut, message]
    );

    return res.json({
      success: true,
      quickReply: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "A quick reply with this shortcut already exists"
      });
    }

    console.error("POST /api/quick-replies error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create quick reply"
    });
  }
});

app.put("/api/quick-replies/:id", authenticateAgent, async (req, res) => {
  try {
    const { id } = req.params;
    const { shortcut, message } = req.body;

    const cleanShortcut = shortcut
      ? String(shortcut).trim().toLowerCase().replace(/^\/+/, "")
      : null;

    const result = await pool.query(
      `
      UPDATE quick_replies
      SET
        shortcut = COALESCE(NULLIF($1, ''), shortcut),
        message = COALESCE(NULLIF($2, ''), message),
        updated_at = NOW()
      WHERE id = $3
      RETURNING id, shortcut, message, created_at, updated_at
      `,
      [cleanShortcut, message ?? null, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Quick reply not found"
      });
    }

    return res.json({
      success: true,
      quickReply: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        error: "A quick reply with this shortcut already exists"
      });
    }

    console.error("PUT /api/quick-replies/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update quick reply"
    });
  }
});

app.delete("/api/quick-replies/:id", authenticateAgent, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM quick_replies WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        error: "Quick reply not found"
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/quick-replies/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to delete quick reply"
    });
  }
});

// =========================
// FEE STRUCTURE (admin-managed, powers the WhatsApp Flow fee calculator)
// =========================

app.get("/api/fee-structure", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const categoriesResult = await pool.query(
      "SELECT id, label, display_order, active FROM fee_categories ORDER BY display_order ASC, label ASC"
    );
    const programsResult = await pool.query(
      "SELECT * FROM fee_programs ORDER BY program_name ASC"
    );

    const categories = categoriesResult.rows.map((category) => ({
      ...category,
      programs: programsResult.rows.filter((program) => program.category_id === category.id)
    }));

    return res.json({ success: true, categories });
  } catch (error) {
    console.error("GET /api/fee-structure error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch fee structure"
    });
  }
});

app.post("/api/fee-categories", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { label } = req.body;

    if (!label || !label.trim()) {
      return res.status(400).json({ success: false, error: "Category name is required" });
    }

    const result = await pool.query(
      "INSERT INTO fee_categories (label) VALUES ($1) RETURNING id, label, display_order",
      [label.trim()]
    );

    return res.json({ success: true, category: result.rows[0] });
  } catch (error) {
    console.error("POST /api/fee-categories error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create category"
    });
  }
});

app.put("/api/fee-categories/:id", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { label } = req.body;

    if (!label || !label.trim()) {
      return res.status(400).json({ success: false, error: "Category name is required" });
    }

    const result = await pool.query(
      "UPDATE fee_categories SET label = $1 WHERE id = $2 RETURNING id, label, display_order",
      [label.trim(), id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Category not found" });
    }

    return res.json({ success: true, category: result.rows[0] });
  } catch (error) {
    console.error("PUT /api/fee-categories/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update category"
    });
  }
});

app.put("/api/fee-categories/:id/active", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const result = await pool.query(
      "UPDATE fee_categories SET active = $1 WHERE id = $2 RETURNING id, label, display_order, active",
      [!!active, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Category not found" });
    }

    return res.json({ success: true, category: result.rows[0] });
  } catch (error) {
    console.error("PUT /api/fee-categories/:id/active error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update category status"
    });
  }
});

app.delete("/api/fee-categories/:id", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM fee_categories WHERE id = $1 RETURNING id",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Category not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/fee-categories/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to delete category"
    });
  }
});

function validateFeeProgramInput(body) {
  const { categoryId, programName, patternType } = body;

  if (!categoryId || !programName || !programName.trim()) {
    return "Category and program name are required";
  }
  if (!["quarterly", "early_late"].includes(patternType)) {
    return "Pattern type must be quarterly or early_late";
  }

  // Fee fields are intentionally optional - some programs (e.g. short
  // courses) only have eligibility criteria and no published fee yet.
  return null;
}

app.post("/api/fee-programs", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const validationError = validateFeeProgramInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const {
      categoryId, programName, patternType, admissionFee, totalFee,
      perInstalmentAmount, totalInstalments, earlySemesterAmount, laterSemesterAmount,
      eligibilityCriteria, keywords, mulProgramId
    } = req.body;

    const isQuarterly = patternType === "quarterly";

    const result = await pool.query(
      `
      INSERT INTO fee_programs (
        category_id, program_name, pattern_type,
        admission_fee, per_instalment_amount, total_instalments,
        early_semester_amount, later_semester_amount, total_fee,
        eligibility_criteria, keywords, mul_program_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        categoryId,
        programName.trim(),
        patternType,
        admissionFee || null,
        isQuarterly ? (perInstalmentAmount || null) : null,
        isQuarterly ? (totalInstalments || null) : null,
        isQuarterly ? null : (earlySemesterAmount || null),
        isQuarterly ? null : (laterSemesterAmount || null),
        totalFee || null,
        eligibilityCriteria || null,
        (keywords || "").trim() || null,
        (mulProgramId || "").trim() || null
      ]
    );

    return res.json({ success: true, program: result.rows[0] });
  } catch (error) {
    console.error("POST /api/fee-programs error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create program"
    });
  }
});

app.put("/api/fee-programs/:id", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const validationError = validateFeeProgramInput(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const {
      categoryId, programName, patternType, admissionFee, totalFee,
      perInstalmentAmount, totalInstalments, earlySemesterAmount, laterSemesterAmount,
      eligibilityCriteria, keywords, mulProgramId
    } = req.body;

    const isQuarterly = patternType === "quarterly";

    const result = await pool.query(
      `
      UPDATE fee_programs SET
        category_id = $1,
        program_name = $2,
        pattern_type = $3,
        admission_fee = $4,
        per_instalment_amount = $5,
        total_instalments = $6,
        early_semester_amount = $7,
        later_semester_amount = $8,
        total_fee = $9,
        eligibility_criteria = $10,
        keywords = $11,
        mul_program_id = $12
      WHERE id = $13
      RETURNING *
      `,
      [
        categoryId,
        programName.trim(),
        patternType,
        admissionFee || null,
        isQuarterly ? (perInstalmentAmount || null) : null,
        isQuarterly ? (totalInstalments || null) : null,
        isQuarterly ? null : (earlySemesterAmount || null),
        isQuarterly ? null : (laterSemesterAmount || null),
        totalFee || null,
        eligibilityCriteria || null,
        (keywords || "").trim() || null,
        (mulProgramId || "").trim() || null,
        id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Program not found" });
    }

    return res.json({ success: true, program: result.rows[0] });
  } catch (error) {
    console.error("PUT /api/fee-programs/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update program"
    });
  }
});

app.put("/api/fee-programs/:id/active", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const result = await pool.query(
      "UPDATE fee_programs SET active = $1 WHERE id = $2 RETURNING *",
      [!!active, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Program not found" });
    }

    return res.json({ success: true, program: result.rows[0] });
  } catch (error) {
    console.error("PUT /api/fee-programs/:id/active error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update program status"
    });
  }
});

app.delete("/api/fee-programs/:id", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "DELETE FROM fee_programs WHERE id = $1 RETURNING id",
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Program not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/fee-programs/:id error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to delete program"
    });
  }
});

// =========================
// SYSTEM HEALTH API
// =========================

function getDirectorySizeBytes(dirPath) {
  let total = 0;
  let fileCount = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const sub = getDirectorySizeBytes(fullPath);
        total += sub.bytes;
        fileCount += sub.fileCount;
      } else {
        total += fs.statSync(fullPath).size;
        fileCount += 1;
      }
    }
  } catch (err) {
    console.error("getDirectorySizeBytes error:", err.message);
  }

  return { bytes: total, fileCount };
}

app.get(
  "/api/system-health",
  authenticateAgent,
  requireAdmin,
  async (req, res) => {
    const health = {};

    // Database
    try {
      const start = Date.now();
      await pool.query("SELECT 1");
      health.database = {
        ok: true,
        responseMs: Date.now() - start
      };
    } catch (error) {
      health.database = { ok: false, error: error.message };
    }

    // WhatsApp API / token
    try {
      const start = Date.now();
      await axios.get(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}?fields=id`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
      health.whatsappApi = {
        ok: true,
        responseMs: Date.now() - start
      };
    } catch (error) {
      health.whatsappApi = {
        ok: false,
        error: error.response?.data?.error?.message || error.message
      };
    }

    // Webhook - last incoming message
    try {
      const result = await pool.query(`
        SELECT MAX(created_at) AS last_at
        FROM messages
        WHERE sender = 'user'
      `);
      health.lastIncomingMessageAt = result.rows[0]?.last_at || null;
    } catch (error) {
      health.lastIncomingMessageAt = null;
    }

    // Row counts
    try {
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM messages)::int AS messages,
          (SELECT COUNT(*) FROM users)::int AS users,
          (SELECT COUNT(*) FROM chats)::int AS chats
      `);
      health.rowCounts = counts.rows[0];
    } catch (error) {
      health.rowCounts = null;
    }

    // Media storage
    try {
      const { bytes, fileCount } = getDirectorySizeBytes(uploadsDir);
      health.mediaStorage = {
        bytes,
        fileCount,
        mb: Math.round((bytes / (1024 * 1024)) * 10) / 10
      };
    } catch (error) {
      health.mediaStorage = null;
    }

    // WhatsApp Business Profile - fields relevant to Meta's business
    // verification checklist (address, description, email, etc.)
    try {
      const profileRes = await axios.get(
        `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`,
        {
          params: { fields: "about,address,description,email,profile_picture_url,websites,vertical" },
          headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        }
      );
      health.businessProfile = {
        ok: true,
        data: profileRes.data?.data?.[0] || {}
      };
    } catch (error) {
      health.businessProfile = {
        ok: false,
        error: error.response?.data?.error?.message || error.message
      };
    }

    // Env var sanity check
    health.envVars = {
      WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
      JWT_SECRET: !!process.env.JWT_SECRET,
      DATABASE_URL: !!process.env.DATABASE_URL
    };

    // Background jobs
    health.backgroundJobs = {
      followupCheckerLastRunAt: lastFollowupCheckAt,
      callbackOfferCheckerLastRunAt: lastCallbackOfferCheckAt
    };

    // Recent send failures (last hour)
    const now = Date.now();
    recentSendFailures = recentSendFailures.filter(t => now - t <= 60 * 60 * 1000);
    health.recentSendFailures = recentSendFailures.length;

    // Server process info
    health.server = {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
      inMemoryUserStates: Object.keys(userStates).length
    };

    return res.json({ success: true, health });
  }
);

// TEMP CREATE ADMIN
app.get("/create-admin", async (req, res) => {
  if (!isValidRecoveryKey(req.query.key)) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized"
    });
  }

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

app.post("/api/whatsapp-flow", async (req, res) => {
  let aesKeyBuffer;
  let initialVectorBuffer;

  try {
    const decrypted = decryptFlowRequest(req.body);
    aesKeyBuffer = decrypted.aesKeyBuffer;
    initialVectorBuffer = decrypted.initialVectorBuffer;

    const { action, screen, data } = decrypted.decryptedBody;

    if (action === "ping") {
      const response = encryptFlowResponse({ data: { status: "active" } }, aesKeyBuffer, initialVectorBuffer);
      res.setHeader("Content-Type", "text/plain");
      return res.send(response);
    }

    let responsePayload;

    if (action === "INIT") {
      responsePayload = {
        screen: "CATEGORY",
        data: { categories: await getFeeCategoryOptions() }
      };
    } else if (action === "data_exchange" && screen === "CATEGORY") {
      const categoryId = data?.category;
      responsePayload = {
        screen: "PROGRAM",
        data: {
          category: categoryId,
          programs: await getFeeProgramOptions(categoryId)
        }
      };
    } else if (action === "data_exchange" && screen === "PROGRAM") {
      responsePayload = {
        screen: "RESULT",
        data: await getFeeResult(data?.category, data?.program)
      };
    } else if (action === "data_exchange" && screen === "LEAD_CATEGORY") {
      const categoryId = data?.category;
      const programs = await getFeeProgramOptions(categoryId);
      programs.push({ id: "OTHER", title: "Other (my program isn't listed)" });
      responsePayload = {
        screen: "LEAD_PROGRAM",
        data: { category: categoryId, programs }
      };
    } else if (action === "data_exchange" && screen === "REG_CATEGORY") {
      // Separate, independent screens from the Lead Capture Flow above -
      // deliberately no "Other" fallback option here (unlike LEAD_CATEGORY):
      // a registration submitted to MUL's real admissions system needs an
      // actual, valid program, not free text a human would resolve later.
      const categoryId = data?.category;
      responsePayload = {
        screen: "REG_PROGRAM",
        data: {
          category: categoryId,
          programs: await getFeeProgramOptions(categoryId)
        }
      };
    } else {
      responsePayload = { screen: "CATEGORY", data: { categories: await getFeeCategoryOptions() } };
    }

    const encryptedResponse = encryptFlowResponse(responsePayload, aesKeyBuffer, initialVectorBuffer);
    res.setHeader("Content-Type", "text/plain");
    return res.send(encryptedResponse);
  } catch (error) {
    console.error("POST /api/whatsapp-flow error:", error.message);
    // 432 tells WhatsApp decryption/processing failed so it can retry
    // rather than treating this as a normal server error.
    return res.status(432).send();
  }
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
    const value = req.body.entry?.[0]?.changes?.[0]?.value;

    // Delivery/read receipts for messages we sent arrive as a separate
    // "statuses" payload (no "messages" array). Handled here in complete
    // isolation from the message-processing logic below, then we return
    // immediately - this must never fall through into the bot state machine.
    const statusUpdates = value?.statuses;
    if (statusUpdates && statusUpdates.length) {
      for (const statusUpdate of statusUpdates) {
        await updateMessageStatus(statusUpdate.id, statusUpdate.status);
      }
      return res.sendStatus(200);
    }

    const msg = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!msg) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const contactName = contact?.profile?.name || null;

    // Click-to-WhatsApp Meta ad attribution. WhatsApp's Cloud API includes
    // a "referral" object, at no extra API/permission cost, on the very
    // first message of a conversation that started from clicking a
    // Facebook/Instagram "Click to WhatsApp" ad. Recorded once per phone
    // in its own audit table (meta_ad_leads) - the chat itself proceeds
    // completely normally below, nothing here changes how it's handled.
    // Also auto-queues a callback request so a Call Agent gets the lead
    // too, on top of the normal bot/Chat Agent conversation - two
    // engagement layers on the same lead, per explicit request.
    if (msg.referral) {
      try {
        const alreadyLogged = await pool.query(
          "SELECT id FROM meta_ad_leads WHERE phone = $1 LIMIT 1",
          [from]
        );

        if (!alreadyLogged.rows.length) {
          await pool.query(
            `
            INSERT INTO meta_ad_leads (phone, name, ad_headline, ad_body, source_url, ctwa_clid)
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
              from,
              contactName,
              msg.referral.headline || null,
              msg.referral.body || null,
              msg.referral.source_url || null,
              msg.referral.ctwa_clid || null
            ]
          );

          // createCallbackRequest() updates existing users/chats rows -
          // this runs before createUserIfNotExists() further down (this is
          // almost always this phone's very first-ever message), so make
          // sure both rows exist first or its UPDATEs would silently match
          // nothing and the callback would never actually get queued.
          await createUserIfNotExists(from, contactName);
          await upsertChat(from, "New Meta ad lead", "active");
          await createCallbackRequest(from, "meta_ad");
        }
      } catch (adLeadErr) {
        console.error("meta_ad_leads capture error:", adLeadErr.message);
      }
    }

    // CSAT button tap ("csat_good"/"csat_bad" sent from switch-mode's
    // reply-buttons prompt). Handled in complete isolation, before the
    // bot state machine below ever sees this message - it is not a menu
    // navigation choice and must never be interpreted as one.
    if (
      msg.type === "interactive" &&
      msg.interactive?.type === "button_reply" &&
      ["csat_good", "csat_bad"].includes(msg.interactive.button_reply.id)
    ) {
      const rating = msg.interactive.button_reply.id === "csat_good" ? "positive" : "negative";
      await pool.query(
        "INSERT INTO csat_responses (phone, rating) VALUES ($1, $2)",
        [from, rating]
      );
      await sendTextMessage(from, "Thank you for your feedback!", "active");
      return res.sendStatus(200);
    }

    // WhatsApp Flow completion ("nfm_reply"). Handled in isolation, before
    // the bot state machine below ever sees this message. Three flows share
    // this branch, told apart by which fields are present: the Fee
    // Calculator (no "name" field - just logged for analytics), the
    // Registration Flow (has "name" AND "email" - submits straight to
    // MUL's admissions system), and the Lead Capture flow (has "name" but
    // no "email" - treated as a lead, same handoff as the typed
    // "Name, Program" path further down). The Registration Flow is a
    // duplicate of the Lead Capture Flow in Meta Business Suite with one
    // added field (Email) - "does this payload have an email" is what
    // separates the two, not the Flow ID.
    if (msg.type === "interactive" && msg.interactive?.type === "nfm_reply") {
      try {
        const flowResponse = JSON.parse(msg.interactive.nfm_reply?.response_json || "{}");
        const leadName = (flowResponse.name || "").trim();
        const leadEmail = (flowResponse.email || "").trim();

        if (leadName && leadEmail) {
          const finalProgram = (flowResponse.other_program || "").trim()
            || flowResponse.program
            || "Not specified";
          const categoryLabel = await getFeeCategoryLabel(flowResponse.category);
          const mulCategory = mapCategoryLabelToMulCode(categoryLabel);

          await saveUserInteraction(from, "registration_flow", finalProgram);

          const registrationResult = await submitMulRegistration({
            phone: from,
            fullName: leadName,
            email: leadEmail,
            category: mulCategory,
            categoryId: flowResponse.category,
            program: finalProgram
          });

          await updateUserDetails(from, { name: leadName, program: finalProgram });

          const registrationErrorLower = (registrationResult.error || "").toLowerCase();

          if (registrationResult.success) {
            // Auto-advance the Admission Funnel's "Registered" stage the
            // same way an agent manually marking it would (see
            // /api/funnel-status) - a real MUL-confirmed registration
            // shouldn't need an agent to remember to also flag it by hand.
            // COALESCE keeps this a no-op if somehow already set (e.g. an
            // agent had marked them registered some other way first).
            try {
              await pool.query(
                `UPDATE users SET registered_at = COALESCE(registered_at, NOW()) WHERE phone = $1`,
                [from]
              );
            } catch (funnelErr) {
              console.error("Auto-mark registered_at error:", funnelErr.message);
            }

            // No reference number shown here - it's a CMS-generated
            // tracking id with nothing the student can actually do with
            // it (they don't log in with it, nowhere asks for it later).
            // The real next step is their email for account access.
            await sendTextMessage(
              from,
              `✅ Your registration is confirmed, ${leadName}!

📧 Please check your email - you will receive your Username and Password from Minhaj University Lahore.

Next steps:
1️⃣ Sign in at admission.mul.edu.pk
2️⃣ Update your profile and pay the admission processing fee
3️⃣ After paying, add your education details and upload your documents
4️⃣ Accept the rules & regulations - and you're done!

Our admissions team will review your application and issue your Admission Fee challan once it's accepted.

💡 Type MENU anytime for more information.`
            );
          } else if (registrationErrorLower.includes("mobile") && registrationErrorLower.includes("already")) {
            // MUL's own duplicate check, keyed on mobile number - confirmed
            // via our own mul_registrations log (2026-08-22): the same
            // phone, once it has one successful registration on file, gets
            // this exact error on every later attempt even with a
            // different email each time. Genuinely MUL-side, not us.
            await sendTextMessage(
              from,
              `It looks like a registration already exists for this mobile number.

✅ If you've registered before (via WhatsApp or the website), check your email for your Username & Password, then sign in at admission.mul.edu.pk to continue your registration process.

❓ If you're sure you've never applied before, please type 7️⃣ to speak with an Admissions Advisor.`
            );
          } else if (registrationErrorLower.includes("email") && registrationErrorLower.includes("already")) {
            await sendTextMessage(
              from,
              `It looks like a registration already exists for this email address.

✅ If you've registered before (via WhatsApp or the website), check your email for your Username & Password, then sign in at admission.mul.edu.pk to continue your registration process.

❓ If you're sure you've never applied before, please type 7️⃣ to speak with an Admissions Advisor. If you meant to use a different email, please try registering again with that one.`
            );
          } else if (registrationErrorLower.includes("already")) {
            // MUL also returns a generic "This registration has already
            // been submitted." that names neither field - same duplicate
            // situation as the two branches above, just without saying
            // which one triggered it, so the guidance stays field-neutral.
            await sendTextMessage(
              from,
              `It looks like a registration already exists for you.

✅ If you've registered before (via WhatsApp or the website), check your email for your Username & Password, then sign in at admission.mul.edu.pk to continue your registration process.

❓ If you're sure you've never applied before, please type 7️⃣ to speak with an Admissions Advisor.`
            );
          } else {
            await sendTextMessage(
              from,
              `We received your details, but weren't able to submit your registration automatically due to a technical issue. Our team has been notified and your information is saved - please type 7️⃣ to speak with an Admissions Advisor so we can complete it for you.`
            );
          }

          return res.sendStatus(200);
        }

        if (leadName) {
          const finalProgram = (flowResponse.other_program || "").trim()
            || flowResponse.program
            || "Not specified";

          await saveUserInteraction(from, "lead_capture_flow", finalProgram);

          const chatStatusResult = await pool.query(
            "SELECT status FROM chats WHERE phone = $1 LIMIT 1",
            [from]
          );
          const alreadyActive = chatStatusResult.rows[0]?.status === "agent_active";

          if (!alreadyActive) {
            const agentAvailableForFlow = await isAgentAvailable();

            // Save their details either way - useful either way, only the
            // live-queue/mode and the message shown differ by availability.
            await updateUserDetails(from, {
              name: leadName,
              program: finalProgram,
              mode: agentAvailableForFlow ? "agent" : "bot",
              awaitingLead: false
            });

            await pool.query(
              "UPDATE users SET name = $2, program = $3 WHERE phone = $1",
              [from, leadName, finalProgram]
            );

            if (!agentAvailableForFlow) {
              if (userStates[from]) {
                userStates[from].awaitingLead = false;
                userStates[from].previousMenu = "main";
                userStates[from].currentMenu = "main";
                userStates[from].hasInteracted = true;
              }
              await sendTextMessage(from, agentUnavailableMessage());
              return res.sendStatus(200);
            }

            await upsertChat(from, `Lead: ${leadName} - ${finalProgram}`, "agent_waiting");

            await pool.query(
              "UPDATE chats SET agent_requested = true WHERE phone = $1",
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

            if (userStates[from]) {
              userStates[from].awaitingLead = false;
              userStates[from].previousMenu = "main";
              userStates[from].currentMenu = "agent_waiting";
              userStates[from].hasInteracted = true;
            }

            await sendTextMessage(
              from,
              `✅ Thank you, ${leadName}!

Your request has been forwarded to our support team.

Please wait, our admission representative will message you shortly.`,
              "agent_waiting"
            );
          }
        } else {
          await saveUserInteraction(from, "fee_calculator", flowResponse.program || "unknown");
        }
      } catch (flowLogError) {
        console.error("Flow completion handling error:", flowLogError.message);
      }
      return res.sendStatus(200);
    }

    const type = msg.type || "text";

    let text = msg.text?.body?.trim() || "";
    if (type === "interactive" && msg.interactive?.type === "button_reply") {
      text = msg.interactive.button_reply.id || "";
    }
    // Preserved because the smart-keyword block below rewrites `text` into
    // a short code/pseudo-code ("2", "__fee_query__"...) - the fee-program
    // catalog matcher further down needs the student's actual wording to
    // work with, not the code it got rewritten into.
    const originalIncomingText = text;
    let lowerText = text?.toLowerCase();

// Small formatting near-misses ("1b more" instead of "1b-more", a stray
// trailing period on a bare code like "7.") shouldn't fall all the way
// through to the generic fallback - normalize before any matching happens.
if (lowerText) {
  let normalizedCode = lowerText.trim();
  normalizedCode = normalizedCode.replace(
    /^([1-6][a-l])\s+more(?:[\s-]*(\d+))?$/i,
    (m, base, n) => (n ? `${base}-more-${n}` : `${base}-more`)
  );
  normalizedCode = normalizedCode.replace(/^([0-9][a-l]?)[.\s]+$/i, "$1");
  if (normalizedCode !== lowerText) {
    lowerText = normalizedCode;
    text = normalizedCode;
  }
}

// =========================
// SMART KEYWORD DETECTION
// Bot mode only
// =========================

const currentUserForKeyword = await getUserByPhone(from);
const currentModeForKeyword = currentUserForKeyword?.mode || "bot";
const isAwaitingLeadDetails =
  !!currentUserForKeyword?.awaiting_lead ||
  !!currentUserForKeyword?.awaiting_callback_lead;

if (currentModeForKeyword !== "agent" && !isAwaitingLeadDetails) {
  // Order matters below: the narrow/whole-message checks (greeting, pure
  // acknowledgment, ad-opener, bare program name) go first since they're
  // low false-positive-risk and don't overlap with the broader keyword
  // buckets. The new narrow topic buckets (challan, job, percentage,
  // deadline) go last, after the original four, so they never steal a
  // message that already matches an established, proven route.

  if (isGreetingOnly(text) || isAdOpenerMessage(text)) {
    text = "__greeting__";
  } else if (isAcknowledgmentOnly(text)) {
    text = "__filler__";
  } else if (isBareProgramMention(text)) {
    text = "__program_mention__";
  }

  if (
    lowerText &&
    (
      lowerText.includes("fee") ||
      lowerText.includes("fees") ||
      lowerText.includes("fee structure") ||
      lowerText.includes("tuition fee") ||
      lowerText.includes("semester fee") ||
      lowerText.includes("charges") ||
      lowerText.includes("cost") ||
      lowerText.includes("kharcha") ||
      lowerText.includes("kharcha kitna") ||
      lowerText.includes("paisay kitne") ||
      lowerText.includes("paise kitne") ||
      lowerText.includes("fees kitni")
    )
  ) {
    // Was a plain "2" (generic Fee Structure PDF + Flow) before - now
    // routed through the fee-program catalog matcher first, so a message
    // that names a specific program ("BS CS ki fee kya hai") gets that
    // program's real fee/eligibility directly; the handler falls back to
    // the exact old behaviour when no program is identifiable.
    text = "__fee_query__";
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
      lowerText.includes("need based") ||
      lowerText.includes("wazifa")
    )
  ) {
    text = "3";
  }

  if (
    lowerText &&
    (
      lowerText.includes("admission") ||
      lowerText.includes("registration") ||
      lowerText.includes("documents") ||
      lowerText.includes("requirements") ||
      lowerText.includes("dakhla") ||
      lowerText.includes("dakhila")
    )
  ) {
    text = "4";
  }

  // Clear apply-INTENT phrasing (not just admission-process info-seeking)
  // goes straight to the registration flow, not the generic Admission
  // Process menu - runs after the bucket above so it wins on overlap
  // ("how to apply" would otherwise land on text="4").
  if (
    lowerText &&
    (
      lowerText === "apply" ||
      lowerText.includes("apply online") ||
      lowerText.includes("how to apply") ||
      lowerText.includes("want to apply") ||
      lowerText.includes("apply karna") ||
      lowerText.includes("apply kaise")
    )
  ) {
    text = "__apply_now__";
  }

  if (
    lowerText &&
    (
      lowerText.includes("agent") ||
      lowerText.includes("representative") ||
      lowerText.includes("advisor") ||
      lowerText.includes("counselor") ||
      lowerText.includes("human") ||
      lowerText.includes("call me") ||
      lowerText.includes("insaan") ||
      lowerText.includes("banda") ||
      lowerText.includes("koi hai")
    )
  ) {
    text = "7";
  }

  // Challan/payment problems are account-specific - the bot has no way to
  // look up or fix a real payment record, so route straight to an agent
  // the same way option 7 does, instead of the generic fallback.
  if (
    lowerText &&
    (lowerText.includes("challan") || lowerText.includes("voucher")) &&
    (
      lowerText.includes("paid") ||
      lowerText.includes("pending") ||
      lowerText.includes("number") ||
      lowerText.includes("date") ||
      lowerText.includes("issue") ||
      lowerText.includes("wrong") ||
      lowerText.includes("forgot") ||
      lowerText.includes("forget") ||
      lowerText.includes("showing") ||
      lowerText.includes("#") ||
      /\d/.test(lowerText)
    )
  ) {
    text = "7";
  }

  if (
    lowerText &&
    (
      lowerText.includes("job") ||
      lowerText.includes("vacancy") ||
      lowerText.includes("vacancies") ||
      lowerText.includes("hiring") ||
      lowerText.includes("recruit") ||
      lowerText.includes("career opportunit")
    )
  ) {
    text = "__job_inquiry__";
  }

  if (
    lowerText &&
    (
      lowerText.includes("percentage") ||
      lowerText.includes("percent") ||
      lowerText.includes("cgpa") ||
      lowerText.includes("eligib") ||
      lowerText.includes("kitne number") ||
      lowerText.includes("kitny number") ||
      lowerText.includes("kitny bnty") ||
      lowerText.includes("kitne bnty") ||
      lowerText.includes("marks chahiye") ||
      lowerText.includes("marks required")
    )
  ) {
    text = "__percentage_query__";
  }

  if (
    lowerText &&
    (
      lowerText.includes("deadline") ||
      lowerText.includes("last date") ||
      lowerText.includes("kab tak") ||
      lowerText.includes("kab shuru") ||
      lowerText.includes("kab start") ||
      lowerText.includes("classes start") ||
      lowerText.includes("class start") ||
      lowerText.includes("zero semester") ||
      lowerText.includes("how many days") ||
      lowerText.includes("kitne din") ||
      lowerText.includes("further process") ||
      lowerText.includes("application kab")
    )
  ) {
    text = "__deadline_query__";
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

if (!userStates[from]) {
  if (currentUserForKeyword?.awaiting_lead) {
    userStates[from] = {
      previousMenu: "main",
      currentMenu: "agent",
      awaitingLead: true,
      hasInteracted: true
    };
  } else if (currentUserForKeyword?.awaiting_callback_lead) {
    userStates[from] = {
      previousMenu: "main",
      currentMenu: "callback_lead",
      awaitingLead: false,
      awaitingCallbackLead: true,
      hasInteracted: true
    };
  } else {
    userStates[from] = {
      previousMenu: "main",
      currentMenu: "main",
      awaitingLead: false,
      hasInteracted: false
    };
  }
}
userStates[from].lastSeenAt = Date.now();

// =========================
// FOLLOW-UP RESPONSE HANDLING
// =========================
if (lowerText === "yes" && chatForCallback?.status !== "agent_active") {
  const agentAvailableForReengage = await isAgentAvailable();
  if (!agentAvailableForReengage) {
    await sendTextMessage(from, agentUnavailableMessage());
    return res.sendStatus(200);
  }

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
7. Chat with Agent
8. Call Me Back`
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
      const agentAvailableForAdmissions = await isAgentAvailable();
      if (!agentAvailableForAdmissions) {
        await sendTextMessage(from, agentUnavailableMessage());
        return res.sendStatus(200);
      }

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
  "UPDATE chats SET followup_sent = false, followup_sent_at = NULL, callback_offer_last_sent_at = NULL WHERE phone = $1",
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

      await updateUserDetails(from, { mode: "agent", awaitingLead: true });

      const flowSent = await sendLeadCaptureFlow(from);
      if (flowSent) {
        return res.sendStatus(200);
      }

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

    const agentAvailableForOther = await isAgentAvailable();
    if (!agentAvailableForOther) {
      await sendTextMessage(from, agentUnavailableMessage());
      return res.sendStatus(200);
    }

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
  "UPDATE chats SET followup_sent = false, followup_sent_at = NULL, callback_offer_last_sent_at = NULL WHERE phone = $1",
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
      mime_type,
      wamid: msg.id || null
    });

const existingChatResult = await pool.query(
  "SELECT status, assigned_agent_id FROM chats WHERE phone = $1 LIMIT 1",
  [from]
);

const existingChatStatus = existingChatResult.rows[0]?.status;
const existingAssignedAgentId = existingChatResult.rows[0]?.assigned_agent_id;

const incomingChatStatus =
  currentMode === "agent"
    ? existingChatStatus === "agent_active"
      ? "agent_active"
      : "agent_waiting"
    : "active";

await incrementUnreadAndSetIncoming(from, incomingText, incomingChatStatus);

// Push Notifications - fire-and-forget (don't hold up the webhook
// response on an external push-service call). Two cases only, to avoid
// spamming agents on every bot-mode message: a new message in a chat
// already assigned to a specific agent (notify just them), or a chat
// newly entering agent_waiting that wasn't already waiting (notify
// every available agent, since anyone can pick it up).
if (currentMode === "agent") {
  if (incomingChatStatus === "agent_active" && existingAssignedAgentId) {
    sendPushToAgents([existingAssignedAgentId], {
      title: contactName || from,
      body: incomingText,
      url: "/admin.html"
    }).catch(err => console.error("push (agent_active) error:", err.message));
  } else if (incomingChatStatus === "agent_waiting" && existingChatStatus !== "agent_waiting") {
    sendPushToAllAvailableAgents({
      title: "New chat request",
      body: `${contactName || from} needs an agent`,
      url: "/admin.html"
    }).catch(err => console.error("push (agent_waiting) error:", err.message));
  }
}

    if (
      currentMode === "agent" &&
      !userStates[from].awaitingLead &&
      !userStates[from].awaitingCallbackLead
    ) {
      console.log(`Bot stopped for ${from} because user is in agent mode.`);
      return res.sendStatus(200);
    }

    if (!text && type !== "text" && type !== "interactive") {
      if (type === "audio") {
        await sendTextMessage(
          from,
          `We received your voice message, but we're currently unable to understand voice notes. 🎙️

Please type your question, or type MENU and choose option 7️⃣ (Chat with Admissions Advisor) to speak with our team directly.`
        );
      } else {
        await sendTextMessage(
          from,
          `Sorry, we're unable to process this type of message right now. 😔

To get help, please type MENU and choose option 7️⃣ (Chat with Admissions Advisor) to speak with our team directly.`
        );
      }
      return res.sendStatus(200);
    }

    if (!text) {
      return res.sendStatus(200);
    }

    // AUTO MENU FOR FIRST MESSAGE
    //
    // Note: userStates is in-memory only, so "first message" really means
    // "first message since the last server restart/deploy" for every
    // student, not just genuinely-new ones - this gate fires far more
    // often in practice than the name suggests. The new pseudo-codes from
    // the smart-keyword detection above (__filler__, __program_mention__,
    // __job_inquiry__, __percentage_query__, __deadline_query__) are
    // allow-listed here too, so a returning student isn't sent the generic
    // welcome menu instead of the tailored reply just because the server
    // happened to restart recently.
    if (!userStates[from].hasInteracted) {
      userStates[from].hasInteracted = true;

      if (
        ![
          "1", "2", "3", "4", "5", "6", "7", "8", "9",
          "1a", "1b", "1c", "1d",
          "5a", "5b", "5c", "5d", "5e",
          "6a", "6b", "6c", "6d", "6e", "6f", "6g", "6h", "6i", "6j", "6k", "6l",
          "apply",
          "__filler__", "__program_mention__", "__job_inquiry__",
          "__percentage_query__", "__deadline_query__", "__fee_query__", "__apply_now__"
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

    // "9" used to double as a hidden "back" shortcut alongside the word
    // "back" - now that 9 is the main menu's "Apply Now" option, that
    // numeric alias is dropped (never advertised anywhere, so nothing
    // user-visible breaks). The word "back" still works exactly as before.
    if (lowerText === "back") {
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

    if (lowerText === "apply" || lowerText === "9" || lowerText === "__apply_now__") {
      userStates[from].hasInteracted = true;
      await offerRegistrationFlow(from);
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

      const agentAvailableForLead = await isAgentAvailable();

      userStates[from].awaitingLead = false;
      userStates[from].previousMenu = "main";
      userStates[from].hasInteracted = true;

      // Save their details either way - that's real, useful data an agent
      // can follow up on later even if nobody's available right now. Only
      // the live-queue/mode and the message shown differ by availability.
      await updateUserDetails(from, {
        name: cleanName,
        program,
        mode: agentAvailableForLead ? "agent" : "bot",
        awaitingLead: false
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

      if (!agentAvailableForLead) {
        userStates[from].currentMenu = "main";
        await sendTextMessage(from, agentUnavailableMessage());
        return res.sendStatus(200);
      }

      userStates[from].currentMenu = "agent_waiting";

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
      userStates[from].awaitingCallbackLead = false;
      userStates[from].hasInteracted = true;

      await updateUserDetails(from, { awaitingLead: false, awaitingCallbackLead: false });

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

      await sendFeeCalculatorFlow(from);

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

      await sendGenericFeeStructure(from);

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

      const flowSentFor4b = await sendRegistrationFlow(from);

      if (flowSentFor4b) {
        await sendReplyButtons(
          from,
          `🌐 Online Admission

You can register directly here on WhatsApp - no need to visit the website.

Once registered, you'll get an admission processing challan. Pay it through online banking or an affiliated bank, and your status will update within 24 hours. After that, upload your documents and agree to the terms - your application will then be submitted.

It may take 24 to 48 hours for processing.`,
          [
            { id: "back", title: "Back" },
            { id: "main_menu", title: "Main Menu" }
          ]
        );
      } else {
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
      }

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
    await sendTextMessage(from, agentUnavailableMessage());
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

if (lowerText === "8") {
  const existingUser = await pool.query(
    "SELECT name, program FROM users WHERE phone = $1",
    [from]
  );

  if (
    existingUser.rows.length > 0 &&
    existingUser.rows[0].name &&
    existingUser.rows[0].program
  ) {
    await createCallbackRequest(from);

    userStates[from].currentMenu = "main";
    userStates[from].hasInteracted = true;

    await sendTextMessage(
      from,
      `✅ Thank you! Your callback request has been received.

Our team will contact you shortly.`
    );
  } else {
    userStates[from].awaitingCallbackLead = true;
    userStates[from].currentMenu = "callback_lead";

    await updateUserDetails(from, { awaitingCallbackLead: true });

    await sendTextMessage(
      from,
      `Please share your details in this format:

Your Name, Interested Program

⚠️ Please add comma ( , ) between your name and program.

Example:
Ali, BS Computer Science`
    );
  }

  return res.sendStatus(200);
}

if (userStates[from].awaitingCallbackLead && text.includes(",")) {
  const [name, ...rest] = text.split(",");
  const program = rest.join(",").trim();
  const cleanName = name.trim();

  userStates[from].awaitingCallbackLead = false;
  userStates[from].currentMenu = "main";
  userStates[from].previousMenu = "main";
  userStates[from].hasInteracted = true;

  await updateUserDetails(from, {
    name: cleanName,
    program,
    awaitingCallbackLead: false
  });

  await createCallbackRequest(from);

  await sendTextMessage(
    from,
    `✅ Thank you! Your callback request has been received.

Our team will contact you shortly.`
  );

  return res.sendStatus(200);
}

if (lowerText === "__greeting__") {
  userStates[from].currentMenu = "main";
  userStates[from].previousMenu = "main";
  userStates[from].hasInteracted = true;

  await sendTextMessage(from, welcomeMessage());
  return res.sendStatus(200);
}

if (lowerText === "__filler__") {
  userStates[from].hasInteracted = true;

  await sendTextMessage(
    from,
    `👍 You're welcome! If you have any other questions, just type MENU to see all options, or 7️⃣ to talk to our Admissions Advisor.`
  );
  return res.sendStatus(200);
}

if (lowerText === "__fee_query__") {
  userStates[from].hasInteracted = true;

  const feeCatalogForQuery = await getActiveFeeProgramCatalog();
  const feeMatch = matchFeeProgramFromCatalog(originalIncomingText, feeCatalogForQuery);

  const handled = await sendFeeProgramMatchReply(from, feeMatch);
  if (!handled) {
    // No specific program identifiable - same PDF + Fee Calculator Flow
    // this bucket always showed before.
    userStates[from].previousMenu = "main";
    userStates[from].currentMenu = "fee";
    await sendGenericFeeStructure(from);
  }

  return res.sendStatus(200);
}

// A bare program name/interest with no explicit "fee" wording ("LLB",
// "Now I'm interested in D pharmacy") is treated the same way - it's
// almost always the shortest possible form of "tell me about this
// program", and fee is the first thing a student wants to know. This
// replaces the previous behaviour of immediately pushing into lead
// capture/agent handoff for every bare mention regardless of what the
// student actually asked for.
if (lowerText === "__program_mention__") {
  userStates[from].hasInteracted = true;

  const feeCatalogForMention = await getActiveFeeProgramCatalog();
  const mentionMatch = matchFeeProgramFromCatalog(originalIncomingText, feeCatalogForMention);

  const handled = await sendFeeProgramMatchReply(from, mentionMatch);
  if (!handled) {
    await sendTextMessage(
      from,
      `Maazrat, hamare paas is naam ka koi program nahi mila. 1️⃣ dabayen humare offered programs ki poori list dekhne ke liye, ya 7️⃣ dabayen humaray Advisor se seedha baat karne ke liye.`
    );
  }

  return res.sendStatus(200);
}

if (lowerText === "__job_inquiry__") {
  userStates[from].hasInteracted = true;

  await sendTextMessage(
    from,
    `This WhatsApp number is for admissions inquiries only. 🎓

For career and job opportunities at Minhaj University Lahore, please visit our official website:
https://www.mul.edu.pk/

💡 Type MENU anytime for admissions information.`
  );
  return res.sendStatus(200);
}

if (lowerText === "__percentage_query__") {
  userStates[from].hasInteracted = true;

  await sendTextMessage(
    from,
    `Eligibility criteria (required percentage/marks) is different for every program. 📋

1️⃣ Type 1 to see Programs Offered and their eligibility details, or
7️⃣ Type 7 to talk directly to our Admissions Advisor for a precise answer.`
  );
  return res.sendStatus(200);
}

if (lowerText === "__deadline_query__") {
  userStates[from].hasInteracted = true;

  await sendTextMessage(
    from,
    `For admission deadlines and process details: 🗓️

4️⃣ Type 4 to see the Admission Process, or
7️⃣ Type 7 to talk directly to our Admissions Advisor for exact dates.`
  );
  return res.sendStatus(200);
}

await sendTextMessage(
  from,
  `Assalamu Alaikum 👋

We want to help, but we're not quite sure what you're looking for. 🙂

Please choose one of the following options:

1️⃣ Programs Offered
2️⃣ Fee Structure
3️⃣ Scholarships & Financial Assistance
4️⃣ Admission Process
5️⃣ Why Choose MUL?
6️⃣ Other Support Offices
7️⃣ Chat with Admissions Advisor
8️⃣ Request a Call Back
9️⃣ Apply Now

📌 Please reply with the number of your choice.

💬 Or type 7 anytime to talk directly to a real Admissions Advisor.

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
// PUSH NOTIFICATIONS
// =========================

// Public key the browser needs to create a subscription - not a secret,
// safe to hand to any authenticated agent.
app.get("/api/push/vapid-public-key", authenticateAgent, async (req, res) => {
  if (!pushEnabled) {
    return res.status(503).json({ success: false, error: "Push notifications not configured" });
  }
  return res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", authenticateAgent, async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ success: false, error: "Invalid subscription" });
    }

    // One row per browser/device (endpoint is unique per subscription) -
    // re-subscribing (e.g. after clearing site data) just replaces which
    // agent it's tied to and refreshes the keys, rather than erroring.
    await pool.query(
      `
      INSERT INTO push_subscriptions (agent_id, endpoint, p256dh, auth)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint) DO UPDATE SET
        agent_id = EXCLUDED.agent_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth
      `,
      [req.agent.id, endpoint, keys.p256dh, keys.auth]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/push/subscribe error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to save subscription" });
  }
});

app.post("/api/push/unsubscribe", authenticateAgent, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ success: false, error: "endpoint is required" });
    }

    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/push/unsubscribe error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to remove subscription" });
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
  try {
    const { status } = req.body;
    if (!["admin", "chat_agent"].includes(req.agent.role)) {
      return res.status(403).json({
        success: false,
        error: "Only admin or chat agent can change live admissions status"
      });
    }

    // Skip the write (and the log entry below) if this isn't an actual
    // change - guards against a double-fired request writing/logging the
    // same value twice, which was flooding Agent Availability Today with
    // near-duplicate 0m entries.
    const current = await pool.query(
      "SELECT value FROM system_settings WHERE key = 'agent_available'"
    );
    const currentStatus = current.rows[0]?.value === "true";
    const newStatus = !!status;

    if (currentStatus === newStatus) {
      return res.json({ success: true, unchanged: true });
    }

    await pool.query(
      "UPDATE system_settings SET value = $1 WHERE key = 'agent_available'",
      [status ? "true" : "false"]
    );

    try {
      await pool.query(
        `
        INSERT INTO agent_status_logs (status, changed_by_agent_id, changed_by_agent_name)
        VALUES ($1, $2, $3)
        `,
        [status ? "on" : "off", req.agent.id, req.agent.name || null]
      );
    } catch (logError) {
      // Don't let a logging failure block the actual toggle from succeeding.
      console.error("agent_status_logs insert error:", logError.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("POST /api/toggle-agent error:", error.message);
    res.status(500).json({ success: false, error: "Failed to toggle agent status" });
  }
});

app.get("/api/agent-status-log", authenticateAgent, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT status, changed_by_agent_name, changed_at
      FROM agent_status_logs
      WHERE changed_at >= CURRENT_DATE
        AND changed_at < CURRENT_DATE + INTERVAL '1 day'
      ORDER BY changed_at ASC
      `
    );

    return res.json({
      success: true,
      log: result.rows
    });
  } catch (error) {
    console.error("GET /api/agent-status-log error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch agent status log"
    });
  }
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

app.post("/api/update-lead", authenticateAgent, async (req, res) => {
  try {
    const { phone, name, program } = req.body;

    if (!phone || !name || !program) {
      return res.status(400).json({
        success: false,
        error: "phone, name and program are required"
      });
    }

    const existingUser = await pool.query(
      "SELECT phone FROM users WHERE phone = $1 LIMIT 1",
      [phone]
    );

    if (!existingUser.rows.length) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    await updateUserDetails(phone, { name, program });

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/update-lead error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update lead details"
    });
  }
});

// One-time admin-triggered data import: fills in eligibility_criteria for
// existing programs (matched against MUL's public admissions page) and
// adds a new "Short Courses" category with its own programs. Safe to run
// more than once - eligibility updates are idempotent, and course rows are
// only inserted if a program with that exact name doesn't already exist
// under the Short Courses category.
app.post("/api/admin/import-eligibility", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const eligibilityData = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data", "eligibility-import.json"), "utf-8")
    );
    const courseData = JSON.parse(
      fs.readFileSync(path.join(__dirname, "data", "course-programs-import.json"), "utf-8")
    );

    let updatedCount = 0;
    for (const entry of eligibilityData) {
      const result = await pool.query(
        "UPDATE fee_programs SET eligibility_criteria = $1 WHERE program_name = $2",
        [entry.eligibility, entry.ourProgram]
      );
      updatedCount += result.rowCount;
    }

    let courseCategoryResult = await pool.query(
      "SELECT id FROM fee_categories WHERE label = 'Short Courses' LIMIT 1"
    );
    let courseCategoryId;
    if (courseCategoryResult.rows.length) {
      courseCategoryId = courseCategoryResult.rows[0].id;
    } else {
      const inserted = await pool.query(
        "INSERT INTO fee_categories (label, display_order) VALUES ('Short Courses', 100) RETURNING id"
      );
      courseCategoryId = inserted.rows[0].id;
    }

    let coursesAdded = 0;
    for (const course of courseData) {
      const existing = await pool.query(
        "SELECT id FROM fee_programs WHERE category_id = $1 AND program_name = $2 LIMIT 1",
        [courseCategoryId, course.name]
      );
      if (existing.rows.length) continue;

      await pool.query(
        `
        INSERT INTO fee_programs (category_id, program_name, pattern_type, eligibility_criteria)
        VALUES ($1, $2, 'quarterly', $3)
        `,
        [courseCategoryId, course.name, course.eligibility]
      );
      coursesAdded++;
    }

    return res.json({
      success: true,
      eligibilityUpdated: updatedCount,
      coursesAdded
    });
  } catch (error) {
    console.error("POST /api/admin/import-eligibility error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to import eligibility data"
    });
  }
});

// Admin-only testing utility: clears a phone's name/program so the bot
// treats it as a brand-new lead again (the "existing user" branches skip
// straight past lead-capture otherwise). Not used by any live student flow.
app.post("/api/admin/reset-test-lead", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "phone is required"
      });
    }

    await pool.query(
      "UPDATE users SET name = NULL, program = NULL WHERE phone = $1",
      [phone]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/admin/reset-test-lead error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to reset test lead"
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

app.post("/api/assign-call-agent", authenticateAgent, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "phone is required"
      });
    }

    await createCallbackRequest(phone);

    await sendTextMessage(
      phone,
      `Thank you for contacting Minhaj University Lahore.

Your request has been forwarded to our call-back team, and one of our representatives will contact you shortly.

Meanwhile, you may continue exploring admissions information anytime.

${welcomeMessage()}`,
      "active"
    );

    return res.json({ success: true });

  } catch (error) {
    console.error("POST /api/assign-call-agent error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to assign to call agent"
    });
  }
});

const CHATS_COLUMNS = `
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
`;

const CHATS_JOIN = `
  FROM chats c
  LEFT JOIN users u ON u.phone = c.phone
  LEFT JOIN agents a ON a.id = c.assigned_agent_id
`;

app.get("/api/chats", authenticateAgent, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    if (search) {
      const result = await pool.query(
        `
        SELECT ${CHATS_COLUMNS}
        ${CHATS_JOIN}
        WHERE
          u.name ILIKE $1
          OR c.phone ILIKE $1
          OR u.program ILIKE $1
        ORDER BY
          CASE
            WHEN c.status = 'agent_waiting' THEN 0
            WHEN c.status = 'agent_active' THEN 1
            ELSE 2
          END,
          c.updated_at DESC
        LIMIT 150
        `,
        [`%${search}%`]
      );

      return res.json({
        success: true,
        chats: result.rows,
        hasMore: false,
        searchMode: true
      });
    }

    const before = req.query.before || null;
    const RECENT_PAGE_SIZE = 75;

    const result = await pool.query(
      `
      SELECT * FROM (
        (
          SELECT ${CHATS_COLUMNS}
          ${CHATS_JOIN}
          WHERE c.status IN ('agent_waiting', 'agent_active')
        )
        UNION ALL
        (
          SELECT ${CHATS_COLUMNS}
          ${CHATS_JOIN}
          WHERE c.status NOT IN ('agent_waiting', 'agent_active')
            AND ($1::timestamptz IS NULL OR c.updated_at < $1::timestamptz)
          ORDER BY c.updated_at DESC
          LIMIT ${RECENT_PAGE_SIZE + 1}
        )
      ) combined
      ORDER BY
        CASE
          WHEN status = 'agent_waiting' THEN 0
          WHEN status = 'agent_active' THEN 1
          ELSE 2
        END,
        updated_at DESC
      `,
      [before]
    );

    const rows = result.rows;
    const liveChats = rows.filter(r => r.status === "agent_waiting" || r.status === "agent_active");
    const recentChats = rows.filter(r => r.status !== "agent_waiting" && r.status !== "agent_active");
    const hasMore = recentChats.length > RECENT_PAGE_SIZE;

    if (hasMore) recentChats.pop();

    return res.json({
      success: true,
      chats: [...liveChats, ...recentChats],
      hasMore,
      searchMode: false
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
      SELECT * FROM (
        SELECT id, phone, sender, type, text, media_id, media_url, file_name, mime_type, status, wamid, reply_to_text, reply_to_sender, reply_to_type, created_at
        FROM messages
        WHERE phone = $1
        ORDER BY created_at DESC
        LIMIT 300
      ) recent
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
    const { phone, message, replyToMessageId } = req.body;

    console.log("API SEND REQUEST:", { phone, message });

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "phone and message are required"
      });
    }

    const replyContext = await buildReplyContext(phone, replyToMessageId);

    await updateUserDetails(phone, { mode: "agent" });
    await sendAgentTextMessage(phone, message, "agent_active", replyContext);

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

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB cap
});

function handleMediaUpload(req, res, next) {
  mediaUpload.single("file")(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "File is too large. Maximum size is 20MB."
        : "Failed to upload file";
      return res.status(400).json({ success: false, error: message });
    }
    next();
  });
}

app.post("/api/send-media", authenticateAgent, handleMediaUpload, async (req, res) => {
  try {
    const { phone, caption, replyToMessageId } = req.body;
    const file = req.file;

    if (!phone || !file) {
      return res.status(400).json({
        success: false,
        error: "phone and file are required"
      });
    }

    const mimeType = file.mimetype || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isDocument =
      mimeType === "application/pdf" ||
      mimeType === "application/msword" ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (!isImage && !isDocument) {
      return res.status(400).json({
        success: false,
        error: "Unsupported file type. Please send an image, PDF, or Word document."
      });
    }

    const ext = getExtensionFromMime(mimeType);
    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, file.buffer);

    const publicUrl = `${BASE_URL}/files/uploads/${fileName}`;

    const replyContext = await buildReplyContext(phone, replyToMessageId);

    await updateUserDetails(phone, { mode: "agent" });

    if (isImage) {
      await sendImageMessage(phone, publicUrl, caption || "", "agent_active", "agent", replyContext);
    } else {
      await sendDocumentMessage(
        phone,
        publicUrl,
        file.originalname || fileName,
        caption || "",
        "agent_active",
        "agent",
        mimeType,
        replyContext
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("POST /api/send-media error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to send file"
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

    const priorChatResult = await pool.query(
      "SELECT status, last_csat_asked_at FROM chats WHERE phone = $1 LIMIT 1",
      [phone]
    );
    const priorChat = priorChatResult.rows[0];

    await updateUserDetails(phone, {
      mode,
      awaitingLead: mode === "bot" ? false : null,
      awaitingCallbackLead: mode === "bot" ? false : null
    });

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
  userStates[phone].awaitingCallbackLead = false;
  userStates[phone].currentMenu = "main";
  userStates[phone].previousMenu = "main";

  await sendTextMessage(
    phone,
    `Thank you for contacting Minhaj University Lahore.

You have now been transferred back to our automated admissions assistant. You may continue exploring admissions information, programs, fee structure, scholarships, and other services at any time.

If you require further assistance from an admissions representative, simply select "Chat with Admissions Advisor" again.`,
    "active"
  );

  const askedToday = priorChat?.last_csat_asked_at &&
    new Date(priorChat.last_csat_asked_at).toDateString() === new Date().toDateString();

  if (priorChat?.status === "agent_active" && !askedToday) {
    await sendReplyButtons(
      phone,
      "How was your experience with our admissions representative today?",
      [
        { id: "csat_good", title: "👍 Good" },
        { id: "csat_bad", title: "👎 Not great" }
      ],
      "active"
    );
    await pool.query(
      "UPDATE chats SET last_csat_asked_at = NOW() WHERE phone = $1",
      [phone]
    );
  }
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
const targetAgentId = shouldAssign ? req.agent.id : null;

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
    AND (
      $1::integer IS NULL
      OR assigned_agent_id IS NULL
      OR assigned_agent_id = $1::integer
    )
  RETURNING
    phone,
    assigned_agent_id,
    assigned_at,
    status,
    agent_waiting_started_at,
    agent_taken_at,
    agent_response_seconds
  `,
  [targetAgentId, phone]
);

    console.log("ASSIGN RESULT:", result.rows[0]);

    if (shouldAssign && result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: "This chat has already been taken by another agent."
      });
    }

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

    // All of the below are independent of each other (none use another
    // query's result), so they run concurrently instead of one-at-a-time -
    // this was previously ~20 sequential round-trips to Postgres on every
    // dashboard load.
    const funnelDateFilter = range === "custom" && start && end
      ? `
        >= $1::timestamp
        AND < ($2::date + INTERVAL '1 day')
      `
      : `>= NOW() - ${intervalSql}`;

    const [
      conversationsStarted,
      weeklyConversations,
      monthlyConversations,
      unreadConversations,
      totalIncomingMessages,
      agentChatRequests,
      agentMessagesSent,
      botInterestStats,
      agentCategoryStats,
      agentWaiting,
      agentActive,
      activeWithBot,
      activeWithAgent,
      topPrograms,
      allTimeTopPrograms,
      recentLeads,
      funnelStats,
      funnelStudents,
      callbackTotals,
      callbackRepeat,
      callbackStatuses,
      responseStats,
      callbackResponseStats,
      csatStats,
      feeCalcSent,
      feeCalcCompletedTotal,
      feeCalcCompletedByProgram,
      leadCaptureSent,
      leadCaptureCompleted,
      registrationTotals,
      registrationTopPrograms,
      registrationAttempts,
      metaAdLeadsTotal,
      metaAdLeadsList
    ] = await Promise.all([
      runDashboardQuery(
        `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(`
        SELECT
          TO_CHAR(day, 'Dy') AS label,
          COUNT(u.id)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS day
        LEFT JOIN users u ON u.created_at::date = day::date
        GROUP BY day
        ORDER BY day
      `),

      // Same shape as weeklyConversations above, just a 30-day window with
      // day-of-month labels instead of day-name labels - feeds the
      // Weekly/Monthly toggle on the Weekly Overview chart (independent of
      // the main dashboard date-range filter, always daily granularity).
      runDashboardQuery(`
        SELECT
          TO_CHAR(day, 'DD') AS label,
          COUNT(u.id)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        ) AS day
        LEFT JOIN users u ON u.created_at::date = day::date
        GROUP BY day
        ORDER BY day
      `),

      runDashboardQuery(`
        SELECT COUNT(*)::int AS count
        FROM chats
        WHERE unread_count > 0
      `),

      runDashboardQuery(
        `
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE sender = 'user'
          AND ${whereCreated}
        `,
        queryParams
      ),

      // Was COUNT(DISTINCT phone) FROM chats WHERE agent_requested=true -
      // but that flag only gets set once a name+program is already on
      // file (see the "agent_category" handler around line 3526), so a
      // first-time student who asked for an agent but hasn't given their
      // name/program yet was silently missing from this count while still
      // correctly appearing in agentCategoryStats below (logged
      // unconditionally the moment they ask). Switched to the same
      // interaction-log source so this total and the Agent Request
      // Insights breakdown can never disagree - they're now literally the
      // same query, one grouped and one not.
      runDashboardQuery(
        `
        SELECT COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'agent_category'
          AND ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT COUNT(*)::int AS count
        FROM messages
        WHERE sender = 'agent'
          AND ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT category, COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'bot_info'
          AND ${whereCreated}
        GROUP BY category
        ORDER BY count DESC, category ASC
        `,
        queryParams
      ),

      // Was COUNT(DISTINCT phone) per category, which double-counts anyone
      // who requested an agent under BOTH categories in the same period
      // (e.g. "Other" once, "Admissions Related" another time) - they'd
      // show up in each category's distinct-phone tally, so the two
      // category counts summed to more than the single-source overall
      // total above. Picks each phone's most recent category choice in
      // the range first (DISTINCT ON), so categories are mutually
      // exclusive per phone and this always sums to exactly that total.
      runDashboardQuery(
        `
        SELECT category, COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT ON (phone) phone, category
          FROM user_interactions
          WHERE interaction_type = 'agent_category'
            AND ${whereCreated}
          ORDER BY phone, created_at DESC
        ) latest_choice
        GROUP BY category
        ORDER BY count DESC, category ASC
        `,
        queryParams
      ),

      runDashboardQuery(`
        SELECT COUNT(*)::int AS count
        FROM chats
        WHERE status = 'agent_waiting'
      `),

      runDashboardQuery(`
        SELECT COUNT(*)::int AS count
        FROM chats
        WHERE status = 'agent_active'
      `),

      runDashboardQuery(`
        SELECT COUNT(*)::int AS count
        FROM users u
        JOIN chats c ON c.phone = u.phone
        WHERE u.mode = 'bot'
        AND c.last_incoming_at >= NOW() - INTERVAL '10 minutes'
      `),

      runDashboardQuery(`
        SELECT COUNT(*)::int AS count
        FROM users u
        JOIN chats c ON c.phone = u.phone
        WHERE u.mode = 'agent'
        AND c.last_incoming_at >= NOW() - INTERVAL '10 minutes'
      `),

      runDashboardQuery(
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
      ),

      // All-time (not scoped to the selected date range) - fed to the normalized
      // "Top Programs" panel that merges free-text spelling variants client-side.
      // No LIMIT here beyond a safety cap: normalization merges rows together in
      // admin.js, so we need the raw grouped counts, not a pre-merge top 10.
      runDashboardQuery(`
        SELECT
          program,
          COUNT(*)::int AS inquiries
        FROM users
        WHERE program IS NOT NULL
          AND TRIM(program) <> ''
        GROUP BY program
        ORDER BY inquiries DESC, program ASC
        LIMIT 300
      `),

      // Scoped to the selected date range (unlike the funnel/all-time queries
      // below) so the "Total Leads Captured" stat cluster and its download
      // modals match what the rest of the dashboard is showing. Capped at
      // 3000 as a safety limit, not a real-world expectation.
      //
      // Date-scoped by COALESCE(program_captured_at, created_at) - i.e. when
      // this lead's name/program was actually captured, not u.created_at
      // (which is just the phone's very first-ever contact with the bot,
      // possibly months earlier). program_captured_at is NULL for every row
      // written before this column existed, so historical leads fall back
      // to the old created_at behaviour unchanged - only newly-captured/
      // updated leads going forward use the more accurate date.
      runDashboardQuery(
        `
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
          AND ${whereCreated.replace(
            /created_at/g,
            "COALESCE(u.program_captured_at, u.created_at)"
          )}
        ORDER BY c.updated_at DESC NULLS LAST
        LIMIT 3000
        `,
        queryParams
      ),

      // Deliberately NOT scoped to the date range - this must always show
      // the true overall funnel, not just students who first messaged in
      // the selected window (per explicit user instruction).
      runDashboardQuery(`
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
      `),

      // Per-student detail behind each of the 4 Admission Funnel cards -
      // same population/predicates as funnelStats above (also deliberately
      // NOT date-scoped, for the same reason), split into buckets
      // client-side so each card's modal list count matches its stat
      // number exactly.
      runDashboardQuery(`
        SELECT
          phone, name, program,
          registered_at, processing_fee_paid_at,
          documents_submitted_at, admission_fee_paid_at
        FROM users
        WHERE registered_at IS NOT NULL
           OR processing_fee_paid_at IS NOT NULL
           OR documents_submitted_at IS NOT NULL
           OR admission_fee_paid_at IS NOT NULL
        ORDER BY COALESCE(
          admission_fee_paid_at, documents_submitted_at,
          processing_fee_paid_at, registered_at
        ) DESC
        LIMIT 3000
      `),

      runDashboardQuery(
        `
        SELECT
          COUNT(*)::int AS total_requests,
          COUNT(DISTINCT phone)::int AS unique_numbers
        FROM callback_request_logs
        WHERE ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
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
      ),

      runDashboardQuery(
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
      ),

      runDashboardQuery(
        `
        SELECT
          COALESCE(ROUND(AVG(agent_response_seconds))::int, 0) AS average_chat_response_seconds
        FROM chats
        WHERE agent_response_seconds IS NOT NULL
          AND ${whereCreated.replaceAll("created_at", "agent_taken_at")}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT
          COALESCE(ROUND(AVG(first_response_seconds))::int, 0) AS average_callback_response_seconds
        FROM callback_requests
        WHERE first_response_seconds IS NOT NULL
          AND ${whereCreated.replaceAll("created_at", "first_response_at")}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT
          COUNT(*) FILTER (WHERE rating = 'positive')::int AS positive,
          COUNT(*) FILTER (WHERE rating = 'negative')::int AS negative,
          COUNT(*)::int AS total
        FROM csat_responses
        WHERE ${whereCreated}
        `,
        queryParams
      ),

      // Flow Performance panel. Counts DISTINCT PHONE, not raw event rows -
      // sendFeeCalculatorFlow fires every time a student hits option 1/2
      // OR types anything containing "fee" (smart-keyword redirect), so
      // one engaged-but-confused student asking about fees repeatedly was
      // inflating "Sent" many times over versus how many actual people saw
      // it, making the completion rate look far worse than reality.
      // "Completed" was also already being logged before "sent" tracking
      // was added, so a naive completed/sent ratio would compare two
      // different populations and never mean anything (could even show
      // >100%). Fixed by also floor-ing the completed queries at the
      // timestamp of that flow's very first logged "sent" - whatever that
      // turns out to be, since it's the actual moment both sides of the
      // ratio became comparable, not a hardcoded date. COALESCE'd to NOW()
      // so a flow with zero sends yet reports 0 completions instead of
      // matching everything before a NULL cutoff.
      runDashboardQuery(
        `
        SELECT COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'flow_sent'
          AND category = 'fee_calculator'
          AND ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'fee_calculator'
          AND ${whereCreated}
          AND created_at >= COALESCE(
            (SELECT MIN(created_at) FROM user_interactions WHERE interaction_type = 'flow_sent' AND category = 'fee_calculator'),
            NOW()
          )
        `,
        queryParams
      ),

      // Same completed rows, but grouped by which program they checked -
      // feeds the "Top Programs Checked" list, so this one stays a count
      // of check-events per program rather than unique-phone-per-program
      // (a student re-checking the same program later is still a genuine
      // repeat interest signal for that ranking, unlike the raw Sent count
      // above which was inflated by the same person triggering it without
      // ever engaging).
      runDashboardQuery(
        `
        SELECT category, COUNT(*)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'fee_calculator'
          AND ${whereCreated}
          AND created_at >= COALESCE(
            (SELECT MIN(created_at) FROM user_interactions WHERE interaction_type = 'flow_sent' AND category = 'fee_calculator'),
            NOW()
          )
        GROUP BY category
        ORDER BY count DESC
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'flow_sent'
          AND category = 'lead_capture_flow'
          AND ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT COUNT(DISTINCT phone)::int AS count
        FROM user_interactions
        WHERE interaction_type = 'lead_capture_flow'
          AND ${whereCreated}
          AND created_at >= COALESCE(
            (SELECT MIN(created_at) FROM user_interactions WHERE interaction_type = 'flow_sent' AND category = 'lead_capture_flow'),
            NOW()
          )
        `,
        queryParams
      ),

      // Registration Performance panel - sourced from mul_registrations
      // (our own audit log of every submission attempt to MUL's live
      // registration API), not user_interactions, since it's the only
      // place that records success/failure and the actual MUL-side error
      // text per attempt.
      //
      // Counted by UNIQUE PHONE, not raw attempt rows - a student who
      // retries several times (different program/email after a rejection,
      // or just re-tapping the flow) was inflating Total/Failed by one row
      // per retry instead of counting as the one person they are. Each
      // unique phone in the period is classified once: "successful" if ANY
      // of their attempts in the period went through, "failed" only if
      // every attempt they made failed - so Total always equals
      // Successful + Failed, and a student who failed twice then succeeded
      // is counted as one success, not one success plus two failures.
      runDashboardQuery(
        `
        WITH per_phone AS (
          SELECT phone, BOOL_OR(mul_success) AS succeeded
          FROM mul_registrations
          WHERE ${whereCreated}
          GROUP BY phone
        )
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE succeeded)::int AS successful,
          COUNT(*) FILTER (WHERE NOT succeeded)::int AS failed
        FROM per_phone
        `,
        queryParams
      ),

      // Top programs among SUCCESSFUL registrations only - a failed
      // attempt (e.g. a program that couldn't be mapped to MUL's id) isn't
      // a genuine signal of program demand the same way a completed one is.
      // DISTINCT phone here too, though in practice a phone can only
      // succeed once (MUL rejects any later attempt as a duplicate), so
      // this mainly guards against that assumption ever changing.
      runDashboardQuery(
        `
        SELECT program, COUNT(DISTINCT phone)::int AS count
        FROM mul_registrations
        WHERE mul_success = true
          AND ${whereCreated}
        GROUP BY program
        ORDER BY count DESC
        LIMIT 10
        `,
        queryParams
      ),

      // One row per unique phone (not one row per raw attempt) for the
      // three stat cards' modals, so a student who retried several times
      // shows up once - matching the unique-phone counts above instead of
      // re-inflating the list with every retry. Picks each phone's most
      // recent attempt for the displayed program/date, but "success" and
      // "error" reflect the OVERALL outcome (succeeded if any attempt in
      // the period succeeded; error is blank once they're in, even if a
      // later stray retry after that happened to fail).
      runDashboardQuery(
        `
        SELECT * FROM (
          SELECT DISTINCT ON (phone)
            full_name AS name,
            phone,
            program,
            BOOL_OR(mul_success) OVER (PARTITION BY phone) AS success,
            CASE
              WHEN BOOL_OR(mul_success) OVER (PARTITION BY phone) THEN NULL
              ELSE mul_error
            END AS error,
            created_at
          FROM mul_registrations
          WHERE ${whereCreated}
          ORDER BY phone, created_at DESC
        ) latest_per_phone
        ORDER BY created_at DESC
        LIMIT 2000
        `,
        queryParams
      ),

      // Meta Ad Leads panel - students whose conversation started from
      // clicking a Click-to-WhatsApp ad (see the "referral" capture in the
      // webhook handler). One row per phone by construction (meta_ad_leads
      // only ever gets one insert per phone), so no dedup needed here.
      runDashboardQuery(
        `
        SELECT COUNT(*)::int AS count
        FROM meta_ad_leads
        WHERE ${whereCreated}
        `,
        queryParams
      ),

      runDashboardQuery(
        `
        SELECT phone, name, ad_headline, ad_body, created_at
        FROM meta_ad_leads
        WHERE ${whereCreated}
        ORDER BY created_at DESC
        LIMIT 2000
        `,
        queryParams
      )
    ]);

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
      funnelStudents: funnelStudents.rows,
      
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

      csatStats: {
        positive: csatStats.rows[0].positive || 0,
        negative: csatStats.rows[0].negative || 0,
        total: csatStats.rows[0].total || 0
      },

      botInterestStats: botInterestStats.rows,
      agentCategoryStats: agentCategoryStats.rows,
      topPrograms: topPrograms.rows,
      allTimeTopPrograms: allTimeTopPrograms.rows,
      recentLeads: recentLeads.rows,
      weeklyConversations: weeklyConversations.rows,
      monthlyConversations: monthlyConversations.rows,

      flowPerformance: {
        feeCalculator: {
          sent: feeCalcSent.rows[0].count || 0,
          completed: feeCalcCompletedTotal.rows[0].count || 0,
          topPrograms: feeCalcCompletedByProgram.rows
        },
        leadCapture: {
          sent: leadCaptureSent.rows[0].count || 0,
          completed: leadCaptureCompleted.rows[0].count || 0
        }
      },

      registrationPerformance: {
        total: registrationTotals.rows[0].total || 0,
        successful: registrationTotals.rows[0].successful || 0,
        failed: registrationTotals.rows[0].failed || 0,
        topPrograms: registrationTopPrograms.rows,
        attempts: registrationAttempts.rows
      },

      metaAdLeads: {
        total: metaAdLeadsTotal.rows[0].count || 0,
        leads: metaAdLeadsList.rows
      }
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
        COALESCE(cb.status, 'no_callback') AS callback_status,
        u.registered_at,
        u.processing_fee_paid_at,
        u.documents_submitted_at,
        u.admission_fee_paid_at
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
      "Callback Status",
      "Funnel Stage"
    ];

    const funnelStageLabel = (row) => {
      if (row.admission_fee_paid_at) return "Fee Paid";
      if (row.documents_submitted_at) return "Documents Submitted";
      if (row.processing_fee_paid_at) return "Processing Fee Paid";
      if (row.registered_at) return "Registered";
      return "Not Started";
    };

    const rows = result.rows.map((row, index) => [
      index + 1,
      row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "",
      row.name || "",
      row.phone || "",
      row.program || "",
      row.current_status || "",
      row.callback_status === "no_callback"
        ? "No Callback"
        : row.callback_status.replaceAll("_", " "),
      funnelStageLabel(row)
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

// One-off diagnostic export: raw incoming student text messages, most
// recent first. Admin-only, read-only - built so real conversation
// content can be reviewed directly (e.g. to see how students actually
// phrase things vs what the bot's menu/keyword logic expects) without
// needing separate database access.
app.get("/api/admin/export-messages", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 20000);

    const result = await pool.query(
      `
      SELECT m.phone, m.text, m.created_at, u.name, u.program
      FROM messages m
      LEFT JOIN users u ON u.phone = m.phone
      WHERE m.sender = 'user'
        AND m.type = 'text'
        AND m.text IS NOT NULL
        AND m.text <> ''
      ORDER BY m.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    const headers = ["Date", "Phone", "Name", "Program", "Message"];

    const rows = result.rows.map(row => [
      row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "",
      row.phone || "",
      row.name || "",
      row.program || "",
      row.text || ""
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
      `attachment; filename="mul-nexus-raw-messages-export.csv"`
    );

    return res.send(csv);
  } catch (error) {
    console.error("GET /api/admin/export-messages error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to export messages"
    });
  }
});

// One-off diagnostic export: every MUL admissions registration submission
// attempt (success or failure), with the exact error text saved by
// submitMulRegistration() - built for the same reason as export-messages
// above, Railway's own Postgres "Data" tab query browser has repeatedly
// been unreliable this session.
app.get("/api/admin/export-registrations", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT phone, full_name, email, category, program, mul_success, mul_reference, mul_error, created_at
      FROM mul_registrations
      ORDER BY created_at DESC
      LIMIT 2000
      `
    );

    const headers = ["Date", "Phone", "Name", "Email", "Category", "Program", "Success", "Reference", "Error"];

    const rows = result.rows.map(row => [
      row.created_at ? new Date(row.created_at).toLocaleString("en-GB") : "",
      row.phone || "",
      row.full_name || "",
      row.email || "",
      row.category || "",
      row.program || "",
      row.mul_success ? "Yes" : "No",
      row.mul_reference || "",
      row.mul_error || ""
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
      `attachment; filename="mul-nexus-registration-attempts-export.csv"`
    );

    return res.send(csv);
  } catch (error) {
    console.error("GET /api/admin/export-registrations error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to export registration attempts"
    });
  }
});

// One-off diagnostic export: every fee_programs row alongside whether it
// currently has a working MUL numeric-id mapping (lib/mulProgramIds.js) -
// built to audit this properly in one pass instead of reacting to one
// missing program at a time as real students hit it live.
app.get("/api/admin/export-fee-programs", authenticateAgent, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT fp.program_name, fp.keywords, fp.active, fp.mul_program_id, fc.label AS category_label
      FROM fee_programs fp
      JOIN fee_categories fc ON fc.id = fp.category_id
      ORDER BY fc.label ASC, fp.program_name ASC
      `
    );

    const headers = ["Category", "Program Name", "Keywords", "Active", "MUL Program ID (Admin-entered)", "MUL ID Mapped?"];

    const rows = result.rows.map(row => {
      // Same precedence as resolveMulProgramId(): admin-entered value first,
      // fall back to the built-in scraped map.
      const mulCategory = mapCategoryLabelToMulCode(row.category_label);
      const mulId = (row.mul_program_id || "").trim() || getMulProgramId(row.program_name, mulCategory);
      return [
        row.category_label || "",
        row.program_name || "",
        row.keywords || "",
        row.active === false ? "No" : "Yes",
        row.mul_program_id || "",
        mulId ? `Yes (${mulId})` : "MISSING"
      ];
    });

    const csv = [
      headers.join(","),
      ...rows.map(r =>
        r.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mul-nexus-fee-programs-mapping-export.csv"`
    );

    return res.send(csv);
  } catch (error) {
    console.error("GET /api/admin/export-fee-programs error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to export fee programs"
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

  // 🔥 LEAD-CAPTURE-DATE COLUMN AUTO ADD
  // Recent Leads used to be date-filtered by users.created_at (the phone's
  // very first-ever contact with the bot), not by when their name/program
  // was actually captured - a returning student who first texted months
  // ago but only gave their program details today was invisible from
  // today's/this week's Leads numbers, even though "Agent Request
  // Insights" (scoped by the request's own date) correctly counted them.
  // This column is purely additive and NULL for all existing rows, so
  // historical numbers/behaviour are completely unaffected until a lead's
  // program is next captured/updated - no backfill, no data at risk.
  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS program_captured_at TIMESTAMPTZ NULL;
    `);

    console.log("✅ program_captured_at column ensured in DB");
  } catch (err) {
    console.error("❌ program_captured_at column error:", err.message);
  }

  // 🔥 FEE PROGRAM KEYWORDS COLUMN AUTO ADD + ONE-TIME BEST-EFFORT SEED
  // Admin-editable alternate names/spellings per program (Settings > Fee
  // Structure), used by the bot to recognize a program from free text
  // ("BSSC", "computer science", a typo) and answer fee/eligibility
  // directly. Purely additive column; the one-time seed only fills rows
  // where keywords is still NULL, using the existing alias map (built up
  // over many rounds of real "Other" lead data) as a head start - it never
  // overwrites anything an admin has already typed in.
  try {
    await pool.query(`
      ALTER TABLE fee_programs
      ADD COLUMN IF NOT EXISTS keywords TEXT NULL;
    `);

    const { PROGRAM_ALIAS_MAP } = require("./lib/programMatcher");
    const aliasesByCanonical = {};
    for (const [alias, canonical] of Object.entries(PROGRAM_ALIAS_MAP)) {
      const key = canonical.toLowerCase();
      if (!aliasesByCanonical[key]) aliasesByCanonical[key] = new Set();
      aliasesByCanonical[key].add(alias);
    }

    const unseededPrograms = await pool.query(
      "SELECT id, program_name FROM fee_programs WHERE keywords IS NULL"
    );

    let seededCount = 0;
    for (const row of unseededPrograms.rows) {
      const aliases = aliasesByCanonical[row.program_name.toLowerCase()];
      if (!aliases || !aliases.size) continue;

      await pool.query(
        "UPDATE fee_programs SET keywords = $1 WHERE id = $2",
        [[...aliases].join(", "), row.id]
      );
      seededCount++;
    }

    console.log(
      `✅ fee_programs.keywords column ensured in DB (seeded ${seededCount} of ${unseededPrograms.rows.length} unseeded programs from the existing alias map)`
    );
  } catch (err) {
    console.error("❌ fee_programs.keywords column error:", err.message);
  }

  // 🔥 FEE PROGRAM MUL PROGRAM ID COLUMN AUTO ADD + ONE-TIME BEST-EFFORT SEED
  // Admin-editable override (Settings > Fee Structure) for the MUL numeric
  // program id needed by WhatsApp Registration submissions - lets whoever
  // adds a new program to Fee Structure map its id themselves straight from
  // the admin panel (see resolveMulProgramId()), instead of needing a code
  // change every time. Purely additive column; the one-time seed only fills
  // rows where mul_program_id is still NULL, using the existing scraped map
  // (lib/mulProgramIds.js) as a head start - it never overwrites anything
  // an admin has already typed in.
  try {
    await pool.query(`
      ALTER TABLE fee_programs
      ADD COLUMN IF NOT EXISTS mul_program_id TEXT NULL;
    `);

    const unseededMulIds = await pool.query(
      `
      SELECT fp.id, fp.program_name, fc.label AS category_label
      FROM fee_programs fp
      JOIN fee_categories fc ON fc.id = fp.category_id
      WHERE fp.mul_program_id IS NULL
      `
    );

    let mulIdSeededCount = 0;
    for (const row of unseededMulIds.rows) {
      const mulCategory = mapCategoryLabelToMulCode(row.category_label);
      const knownId = getMulProgramId(row.program_name, mulCategory);
      if (!knownId) continue;

      await pool.query(
        "UPDATE fee_programs SET mul_program_id = $1 WHERE id = $2",
        [knownId, row.id]
      );
      mulIdSeededCount++;
    }

    console.log(
      `✅ fee_programs.mul_program_id column ensured in DB (seeded ${mulIdSeededCount} of ${unseededMulIds.rows.length} unseeded programs from the existing scraped map)`
    );
  } catch (err) {
    console.error("❌ fee_programs.mul_program_id column error:", err.message);
  }

  // 🔥 MUL REGISTRATION SUBMISSIONS TABLE AUTO CREATE
  // Our own copy of every WhatsApp-registration attempt, independent of
  // whatever happens on MUL's cms.mul.edu.pk side - so if their system has
  // an issue, or an admin needs to double-check/resubmit something, the
  // data still exists here regardless.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mul_registrations (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) NOT NULL,
        full_name TEXT,
        email TEXT,
        category TEXT,
        program TEXT,
        idempotency_key TEXT,
        mul_success BOOLEAN,
        mul_reference TEXT,
        mul_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_mul_registrations_phone ON mul_registrations (phone);
    `);

    console.log("✅ mul_registrations table ensured in DB");
  } catch (err) {
    console.error("❌ mul_registrations table error:", err.message);
  }

  // 🔥 META AD LEADS TABLE AUTO CREATE
  // Own record of every conversation that started from a "Click to
  // WhatsApp" Meta ad (Facebook/Instagram), captured from the "referral"
  // object WhatsApp's Cloud API includes on that first message - see the
  // detection block in the webhook handler. Independent of the normal
  // chats/users tables so these leads keep showing up as completely
  // normal chats, with this as a separate audit trail on the side.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_ad_leads (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) NOT NULL,
        name TEXT,
        ad_headline TEXT,
        ad_body TEXT,
        source_url TEXT,
        ctwa_clid TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_meta_ad_leads_phone ON meta_ad_leads (phone);
    `);

    console.log("✅ meta_ad_leads table ensured in DB");
  } catch (err) {
    console.error("❌ meta_ad_leads table error:", err.message);
  }

  // 🔥 CALLBACK REQUESTS SOURCE COLUMN AUTO ADD
  // Distinguishes a genuine student-requested callback from one we
  // proactively queued ourselves (currently just Meta ad leads) - lets
  // Call Agents see, right on the card, that the student never actually
  // asked for a call, so they don't open with "you requested a callback".
  try {
    await pool.query(`
      ALTER TABLE callback_requests
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'student_request';
    `);

    console.log("✅ callback_requests.source column ensured in DB");
  } catch (err) {
    console.error("❌ callback_requests.source column error:", err.message);
  }

  // 🔥 PUSH SUBSCRIPTIONS TABLE AUTO CREATE
  // One row per browser/device an agent has enabled Push Notifications on
  // (an agent using both their phone and laptop gets two rows). endpoint
  // is unique per subscription - a device re-subscribing (new browser
  // profile, cleared site data) just replaces the row via ON CONFLICT in
  // /api/push/subscribe rather than duplicating it.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_agent_id ON push_subscriptions (agent_id);
    `);

    console.log("✅ push_subscriptions table ensured in DB");
  } catch (err) {
    console.error("❌ push_subscriptions table error:", err.message);
  }

  // 🔥 ADMISSION FUNNEL COLUMN INDEXES
  // funnelStats and funnelStudents (both in /api/dashboard) filter/sort
  // users by these 4 timestamp columns, none of which were ever indexed -
  // every dashboard load was a full sequential scan of the users table
  // for both queries. Partial indexes (only non-null rows) since most
  // users have never reached any of these stages, keeping the index
  // small and letting Postgres bitmap-OR across them for the "reached at
  // least this stage" queries.
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_registered_at ON users (registered_at) WHERE registered_at IS NOT NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_processing_fee_paid_at ON users (processing_fee_paid_at) WHERE processing_fee_paid_at IS NOT NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_documents_submitted_at ON users (documents_submitted_at) WHERE documents_submitted_at IS NOT NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_admission_fee_paid_at ON users (admission_fee_paid_at) WHERE admission_fee_paid_at IS NOT NULL;`);

    console.log("✅ Admission Funnel column indexes ensured in DB");
  } catch (err) {
    console.error("❌ Admission Funnel column indexes error:", err.message);
  }

  // 🔥 PASSWORD RESET TOKENS TABLE AUTO CREATE
  // Only the SHA-256 hash of the token is ever stored, same principle as
  // password_hash - a raw token only exists in the emailed link itself
  // and briefly in memory while /api/reset-password verifies it, never
  // written to the database. A stolen DB backup alone can't be used to
  // reset anyone's password.
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_agent_id ON password_reset_tokens (agent_id);
    `);

    console.log("✅ password_reset_tokens table ensured in DB");
  } catch (err) {
    console.error("❌ password_reset_tokens table error:", err.message);
  }

  // 🔥 START 24H FOLLOW-UP CHECKER
  setInterval(checkPendingFollowups, 10 * 60 * 1000); // every 10 minutes
  setInterval(checkCallbackOffers, 10 * 60 * 1000);
  console.log("10m callback offer checker started");
  checkCallbackOffers();
  console.log("✅ 24h follow-up checker started");

  setInterval(cleanupOldMedia, 24 * 60 * 60 * 1000); // once a day
  cleanupOldMedia();
  console.log("✅ Media cleanup job started (5 day retention)");
  
});
