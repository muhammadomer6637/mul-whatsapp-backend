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

    console.log("Tables created / verified successfully");
  } catch (error) {
    console.error("initDb error:", error.message);
  }
};
