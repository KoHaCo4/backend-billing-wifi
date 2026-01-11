// src/models/customer.model.js - VERSION WITHOUT ORM
class CustomerModel {
  static async create(data) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      const [result] = await connection.query(
        `INSERT INTO customers SET ?`,
        data
      );
      return { id: result.insertId, ...data };
    } finally {
      connection.release();
    }
  }

  static async findById(id) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      const [rows] = await connection.query(
        `SELECT * FROM customers WHERE id = ?`,
        [id]
      );
      return rows[0] || null;
    } finally {
      connection.release();
    }
  }

  static async update(id, data) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      await connection.query(`UPDATE customers SET ? WHERE id = ?`, [data, id]);
      return { id, ...data };
    } finally {
      connection.release();
    }
  }

  static async findExpired(gracePeriodDays = 3) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      const today = new Date();
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - gracePeriodDays);

      const [rows] = await connection.query(
        `
        SELECT c.*, r.* 
        FROM customers c
        JOIN routers r ON c.router_id = r.id
        WHERE c.status = 'active'
        AND c.expired_at < ?
        ORDER BY c.expired_at ASC
      `,
        [targetDate.toISOString().split("T")[0]]
      );

      return rows;
    } finally {
      connection.release();
    }
  }
}

module.exports = CustomerModel;
