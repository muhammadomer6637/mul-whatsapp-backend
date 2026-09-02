const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
  // Raising this to 20 (previous attempt at this same bug) made things
  // worse, not better - Railway's Postgres plan has its own server-side
  // connection ceiling we can't see or confirm (their Console doesn't
  // support running a query to check it), and asking for more
  // connections than the DB will actually admit just means more of them
  // queue at the server, invisible to Railway's CPU/Memory graphs but
  // very visible as p99 response-time spikes (confirmed live: 20-25s).
  // Back to a conservative default; the real fix is BATCH_SIZE in
  // /api/dashboard's query list, capping how many connections that one
  // endpoint ever asks for at once.
  max: 10,
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
