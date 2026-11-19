const pool = require("../db/connect");

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (errors) {
    await client.query("ROLLBACK");
    throw errors;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
