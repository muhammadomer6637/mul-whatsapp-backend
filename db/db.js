const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

console.log("DATABASE_URL exists:", !!connectionString);

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    console.log("✅ Database connected successfully");
    console.log("DB time:", result.rows[0].now);
    client.release();
  } catch (error) {
    console.error("❌ Database connection error:", error.message);
  }
}

module.exports = {
  pool,
  testConnection,
};
