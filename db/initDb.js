const { pool } = require("./db");

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255),
        program VARCHAR(255),
        mode VARCHAR(20) DEFAULT 'bot',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        last_message TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        sender VARCHAR(20) NOT NULL,
        type VARCHAR(20) DEFAULT 'text',
        text TEXT,
        media_id TEXT,
        media_url TEXT,
        file_name TEXT,
        mime_type TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ Tables created / verified successfully");
  } catch (error) {
    console.error("❌ Database init error:", error.message);
  }
}

module.exports = initDb;
