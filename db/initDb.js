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
    
    // Safe ALTERs for existing DB
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
