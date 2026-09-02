const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
  // pg's default max is 10 - too small now that /api/dashboard alone
  // fires ~34 concurrent queries in one Promise.all, on top of ongoing
  // webhook/bot traffic sharing the same pool. Confirmed live: the
  // Dashboard was hanging in a loading state for extended periods,
  // consistent with requests queuing for a free connection.
  // connectionTimeoutMillis makes that fail fast with a clear error
  // instead of hanging indefinitely if the pool is ever still exhausted.
  max: 20,
  connectionTimeoutMillis: 10000
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("Database connected successfully");
    client.release();
  } catch (error) {
    console.error("Database connection error:", error.message);
  }
}

module.exports = pool;
module.exports.testConnection = testConnection;
