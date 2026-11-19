require("dotenv").config();
const { Pool } = require("pg");

const { PGHOST, PGDATABASE, PGUSER, PGPASSWORD } = process.env;

const pool = new Pool({
  host: PGHOST,
  database: PGDATABASE,
  port: 5432,
  user: PGUSER,
  password: PGPASSWORD,
  ssl: {
    require: true,
    rejectUnauthorized: false,
  },
});

module.exports = pool;
