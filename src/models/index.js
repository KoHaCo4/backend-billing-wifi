// src/models/index.js - SIMPLE VERSION (jika diperlukan oleh kode lain)
const pool = require("../config/database");

module.exports = {
  // Ekspor pool untuk digunakan langsung
  pool,

  // Helper functions
  async query(sql, params) {
    const connection = await pool.getConnection();
    try {
      const [results] = await connection.query(sql, params);
      return results;
    } finally {
      connection.release();
    }
  },

  async findOne(sql, params) {
    const results = await this.query(sql, params);
    return results[0] || null;
  },
};
