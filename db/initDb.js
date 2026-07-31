module.exports = async function initDb() {
  const pool = require("./db");

  try {
    // USERS TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) UNIQUE NOT NULL,
        name TEXT,
        program TEXT,
        mode VARCHAR(20) DEFAULT 'bot',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // CHATS TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) UNIQUE NOT NULL,
        status VARCHAR(30) DEFAULT 'active',
        last_message TEXT,
        unread_count INTEGER DEFAULT 0,
        last_incoming_at TIMESTAMP,
        last_outgoing_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // MESSAGES TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) NOT NULL,
        sender VARCHAR(20) NOT NULL,
        type VARCHAR(30),
        text TEXT,
        media_id TEXT,
        media_url TEXT,
        file_name TEXT,
        mime_type TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_phone_created_at
      ON messages (phone, created_at);
    `);

    await pool.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_text TEXT;
    `);
    await pool.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(20);
    `);
    await pool.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_type VARCHAR(30);
    `);

    await pool.query(`
      ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_csat_asked_at TIMESTAMP;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS csat_responses (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(30) NOT NULL,
        rating VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_csat_responses_created_at ON csat_responses (created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_status_updated_at
      ON chats (status, updated_at DESC);
    `);

    // AGENTS TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY,

        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,

        role VARCHAR(30) DEFAULT 'chat_agent',

        active BOOLEAN DEFAULT true,

        can_view_dashboard BOOLEAN DEFAULT false,
        can_view_all_chats BOOLEAN DEFAULT true,
        can_create_agents BOOLEAN DEFAULT false,
        can_export_data BOOLEAN DEFAULT false,

        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

// CALLBACK REQUESTS TABLE
await pool.query(`
  CREATE TABLE IF NOT EXISTS callback_requests (
    id SERIAL PRIMARY KEY,

    phone VARCHAR(30) NOT NULL,

    name TEXT,
    program TEXT,

    status VARCHAR(30) DEFAULT 'pending',

    notes TEXT,

    assigned_call_agent_id INTEGER,

    next_followup_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

// CALLBACK REQUEST LOGS TABLE
await pool.query(`
  CREATE TABLE IF NOT EXISTS callback_request_logs (
    id SERIAL PRIMARY KEY,

    callback_request_id INTEGER,

    phone VARCHAR(30) NOT NULL,

    name TEXT,
    program TEXT,

    created_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_interactions (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(30) NOT NULL,
    interaction_type VARCHAR(50) NOT NULL,
    category VARCHAR(80) NOT NULL,
    source_key TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS quick_replies (
    id SERIAL PRIMARY KEY,
    shortcut VARCHAR(50) UNIQUE NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

    // Safe ALTERs for existing DB
    await pool.query(`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS email TEXT;
    `);

    await pool.query(`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS designation TEXT;
    `);

    await pool.query(`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
    `);

    await pool.query(`
      ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS last_password_change_at TIMESTAMP;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS last_incoming_at TIMESTAMP;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS last_outgoing_at TIMESTAMP;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS assigned_agent_id INTEGER;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS callback_requested BOOLEAN DEFAULT false;
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS callback_status VARCHAR(30);
    `);

    await pool.query(`
      ALTER TABLE chats
      ADD COLUMN IF NOT EXISTS callback_requested_at TIMESTAMP;
    `);
await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS callback_offer_last_sent_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS callback_offer_count INTEGER DEFAULT 0;
`);

await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS agent_waiting_started_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS agent_taken_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS agent_response_seconds INTEGER;
`);

await pool.query(`
  ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS agent_requested BOOLEAN DEFAULT false;
`);

await pool.query(`
  UPDATE chats c
  SET agent_requested = true
  WHERE agent_requested = false
    AND EXISTS (
      SELECT 1
      FROM messages m
      WHERE m.phone = c.phone
        AND m.sender = 'bot'
        AND m.text ILIKE '%Please choose:%'
        AND m.text ILIKE '%Admissions Related%'
        AND m.text ILIKE '%Other%'
    );
`);
    
await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS processing_fee_paid_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS documents_submitted_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admission_fee_paid_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS awaiting_lead BOOLEAN DEFAULT false;
`);

await pool.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS awaiting_callback_lead BOOLEAN DEFAULT false;
`);

await pool.query(`
  ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS wamid TEXT;
`);

await pool.query(`
  ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS status TEXT;
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages (wamid);
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender_created_at ON messages (sender, created_at);
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_user_interactions_type_created_at ON user_interactions (interaction_type, created_at);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_status_logs (
    id SERIAL PRIMARY KEY,
    status VARCHAR(10) NOT NULL,
    changed_by_agent_id INTEGER,
    changed_by_agent_name TEXT,
    changed_at TIMESTAMP DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_agent_status_logs_changed_at ON agent_status_logs (changed_at);
`);

    await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS request_count INTEGER DEFAULT 1;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS is_repeat BOOLEAN DEFAULT false;
`);

    await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS updated_by INTEGER;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS followup_date TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS callback_notes TEXT;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS first_response_seconds INTEGER;
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS first_response_status VARCHAR(30);
`);

await pool.query(`
  ALTER TABLE callback_requests
  ADD COLUMN IF NOT EXISTS first_response_agent_id INTEGER;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'programs', 'backfill:' || id || ':programs', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%Programs Categories%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'fee_structure', 'backfill:' || id || ':fee_structure', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%Please find attached the complete fee structure%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'scholarships', 'backfill:' || id || ':scholarships', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%For scholarship details please visit%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'admission_process', 'backfill:' || id || ':admission_process', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%4a. On Campus Admission%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'why_choose_mul', 'backfill:' || id || ':why_choose_mul', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%5a. Accreditation%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'bot_info', 'other_support', 'backfill:' || id || ':other_support', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%6a. Admission Office%'
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'agent_category', 'admissions_related', 'backfill:' || id || ':agent_admissions', created_at
  FROM messages
  WHERE sender = 'bot'
    AND (
      text ILIKE '%Connecting you with an admissions representative%'
      OR text ILIKE '%Please share your details in this format%'
      OR text ILIKE '%Your request has been forwarded to our support team%'
    )
  ON CONFLICT (source_key) DO NOTHING;
`);

await pool.query(`
  INSERT INTO user_interactions (phone, interaction_type, category, source_key, created_at)
  SELECT phone, 'agent_category', 'other', 'backfill:' || id || ':agent_other', created_at
  FROM messages
  WHERE sender = 'bot'
    AND text ILIKE '%Your query is being forwarded to our representative%'
  ON CONFLICT (source_key) DO NOTHING;
`);    
    
    // Safe foreign key for assigned agent
    try {
      await pool.query(`
        ALTER TABLE chats
        ADD CONSTRAINT chats_assigned_agent_fk
        FOREIGN KEY (assigned_agent_id)
        REFERENCES agents(id)
        ON DELETE SET NULL;
      `);
    } catch (err) {
      // Ignore if constraint already exists
    }

    // FEE STRUCTURE TABLES (admin-managed, powers the WhatsApp Flow fee calculator)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_categories (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_programs (
        id SERIAL PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES fee_categories(id) ON DELETE CASCADE,
        program_name TEXT NOT NULL,
        pattern_type VARCHAR(20) NOT NULL DEFAULT 'quarterly',
        admission_fee NUMERIC,
        per_instalment_amount NUMERIC,
        total_instalments INTEGER,
        early_semester_amount NUMERIC,
        later_semester_amount NUMERIC,
        total_fee NUMERIC,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fee_programs_category_id ON fee_programs (category_id);
    `);

    // One-time seed from the original JSON extraction - only runs if the
    // tables are still empty, so it never overwrites admin edits made
    // through the Settings > Fee Structure panel after this first run.
    const feeCategoryCount = await pool.query("SELECT COUNT(*) FROM fee_categories");
    if (Number(feeCategoryCount.rows[0].count) === 0) {
      const fs = require("fs");
      const path = require("path");
      const seedPath = path.join(__dirname, "..", "data", "fee-structure-fall-2026.json");

      if (fs.existsSync(seedPath)) {
        const seedData = JSON.parse(fs.readFileSync(seedPath, "utf-8"));

        for (const [, category] of Object.entries(seedData.categories || {})) {
          const categoryResult = await pool.query(
            "INSERT INTO fee_categories (label) VALUES ($1) RETURNING id",
            [category.label]
          );
          const categoryId = categoryResult.rows[0].id;

          for (const program of category.programs || []) {
            const isEarlyLate = program.installmentEarly != null;

            await pool.query(
              `
              INSERT INTO fee_programs (
                category_id, program_name, pattern_type,
                admission_fee, per_instalment_amount, total_instalments,
                early_semester_amount, later_semester_amount, total_fee
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `,
              [
                categoryId,
                program.program,
                isEarlyLate ? "early_late" : "quarterly",
                program.admissionFee ?? null,
                isEarlyLate ? null : (program.installment ?? null),
                isEarlyLate ? null : (program.totalInstallments || category.totalInstallments || null),
                isEarlyLate ? program.installmentEarly : null,
                isEarlyLate ? program.installmentLate : null,
                program.totalFee ?? null
              ]
            );
          }
        }

        console.log("Fee structure seeded from data/fee-structure-fall-2026.json");
      }
    }

    console.log("Tables created / verified successfully");
  } catch (error) {
    console.error("initDb error:", error.message);
  }
};
