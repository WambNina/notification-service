require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || 'postgres'; // 'mysql' or 'postgres'

let adapter;

if (DB_TYPE === 'mysql') {
  // ==========================================
  // MySQL Mode (mysql2/promise)
  // ==========================================
  const mysql = require('mysql2/promise');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  pool.getConnection()
    .then(conn => {
      console.log('✅ MySQL Connected');
      conn.release();
    })
    .catch(err => {
      console.error('❌ MySQL Connection Error:', err.message);
    });

  adapter = {
    async execute(sql, params) {
      // mysql2/promise returns [result, fields]
      return pool.execute(sql, params);
    }
  };

} else {
  // ==========================================
  // PostgreSQL / Supabase Mode (pg)
  // ==========================================
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: process.env.SUPABASE_DB || process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  pool.on('connect', () => console.log('✅ Supabase PostgreSQL Connected'));
  pool.on('error', (err) => console.error('❌ Supabase PostgreSQL Error:', err.message));

  adapter = {
    async execute(sql, params) {
      let pgSql = sql;

      // 1. Convert MySQL ? placeholders → PostgreSQL $1, $2...
      let counter = 1;
      pgSql = pgSql.replace(/\?/g, () => `$${counter++}`);

      // 2. Convert LIKE → ILIKE for case-insensitive search in PostgreSQL
      pgSql = pgSql.replace(/\bLIKE\b/g, 'ILIKE');

      // 3. Add RETURNING id for INSERTs if missing (so we can read insertId back)
      if (/^\s*INSERT\s+INTO/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
        pgSql += ' RETURNING id';
      }

      const result = await pool.query(pgSql, params);

      // Normalize to mysql2/promise shape: [data, fields]
      const isSelect = /^\s*SELECT/i.test(sql);

      if (isSelect) {
        // SELECT: first element must be the array of rows
        return [result.rows, []];
      } else {
        // INSERT/UPDATE/DELETE: first element must be a result-like object
        return [{
          affectedRows: result.rowCount,
          insertId: result.rows && result.rows[0] ? result.rows[0].id : null,
          rows: result.rows || []
        }, []];
      }
    }
  };
}

module.exports = adapter;