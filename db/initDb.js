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

    console.log("Tables created / verified successfully");
  } catch (error) {
    console.error("initDb error:", error.message);
  }
};
