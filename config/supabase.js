const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB,
  ssl: {
    rejectUnauthorized: false, // Required for Supabase
  },
});

pool.on('connect', () => {
  console.log('✅ Supabase PostgreSQL Connected');
});

pool.on('error', (err) => {
  console.error('❌ Supabase PostgreSQL Error:', err.message);
});

module.exports = pool;