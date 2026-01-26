const db = require("../config/database");

class NotificationLog {
  static async create(logData) {
    const {
      customer_id,
      phone,
      message_type,
      message,
      status = "queued",
      message_id = null,
      response_data = null,
      error_message = null,
    } = logData;

    try {
      console.log(
        `📝 Creating notification log for customer ${customer_id}, phone ${phone}, type ${message_type}`,
      );

      // Cek apakah tabel notification_logs sudah ada
      const checkTableQuery = `
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME = 'notification_logs' 
      AND TABLE_SCHEMA = DATABASE()
    `;

      const [tables] = await db.execute(checkTableQuery);

      if (tables.length === 0) {
        console.log("📝 Tabel notification_logs belum ada, membuat...");
        // Buat tabel dengan struktur lengkap
        await db.execute(`
        CREATE TABLE notification_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          customer_id INT,
          phone VARCHAR(20),
          message_type VARCHAR(50),
          message TEXT,
          status VARCHAR(20) DEFAULT 'queued',
          message_id VARCHAR(100),
          response_data JSON,
          error_message TEXT,
          sent_at DATETIME,
          delivered_at DATETIME,
          read_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_customer_id (customer_id),
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        )
      `);
        console.log("✅ Tabel notification_logs berhasil dibuat");
      } else {
        console.log("✅ Tabel notification_logs sudah ada");
      }

      // Cek apakah kolom message_type ada
      const checkColumnQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'notification_logs' 
      AND TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME IN ('message_type', 'message_id', 'response_data')
    `;

      const [columns] = await db.execute(checkColumnQuery);
      const existingColumns = columns.map((col) => col.COLUMN_NAME);

      console.log(`📊 Kolom yang ada: ${existingColumns.join(", ")}`);

      // Jika kolom tidak lengkap, buat query yang dinamis
      let columnNames = [];
      let columnPlaceholders = [];
      let values = [];

      // Kolom wajib (harus ada di semua versi)
      columnNames.push("customer_id");
      columnPlaceholders.push("?");
      values.push(customer_id);

      columnNames.push("phone");
      columnPlaceholders.push("?");
      values.push(phone);

      columnNames.push("message");
      columnPlaceholders.push("?");
      values.push(message);

      columnNames.push("status");
      columnPlaceholders.push("?");
      values.push(status);

      columnNames.push("sent_at");
      columnPlaceholders.push("NOW()");

      // Kolom opsional (jika ada di tabel)
      if (existingColumns.includes("message_type")) {
        columnNames.push("message_type");
        columnPlaceholders.push("?");
        values.push(message_type);
      }

      if (existingColumns.includes("message_id")) {
        columnNames.push("message_id");
        columnPlaceholders.push("?");
        values.push(message_id);
      }

      if (existingColumns.includes("response_data") && response_data) {
        columnNames.push("response_data");
        columnPlaceholders.push("?");
        values.push(JSON.stringify(response_data));
      }

      if (existingColumns.includes("error_message") && error_message) {
        columnNames.push("error_message");
        columnPlaceholders.push("?");
        values.push(error_message);
      }

      // Buat query dinamis
      const query = `
      INSERT INTO notification_logs 
      (${columnNames.join(", ")})
      VALUES (${columnPlaceholders.join(", ")})
    `;

      console.log(`📝 Query: ${query}`);
      console.log(`📝 Values: ${values.length} parameters`);

      const [result] = await db.execute(query, values);

      console.log(`✅ Log created with ID: ${result.insertId}`);
      return result.insertId;
    } catch (error) {
      console.error("❌ Error creating notification log:", error.message);
      console.error("❌ Error details:", error.sql);

      // Fallback: log ke console jika database error
      console.log("📝 Fallback logging to console:");
      console.log({
        customer_id,
        phone,
        message_type,
        message: message.substring(0, 100) + "...",
        status,
        timestamp: new Date().toISOString(),
      });

      return 0;
    }
  }

  static async updateStatus(logId, status, data = {}) {
    try {
      console.log(`📝 Updating notification log ${logId} to status: ${status}`);

      // Cek apakah kolom ada
      const checkColumnQuery = `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'notification_logs' 
      AND TABLE_SCHEMA = DATABASE()
      AND COLUMN_NAME IN ('message_id', 'response_data', 'error_message', 'delivered_at', 'read_at', 'updated_at')
    `;

      const [columns] = await db.execute(checkColumnQuery);
      const existingColumns = columns.map((col) => col.COLUMN_NAME);

      console.log(`📊 Existing columns: ${existingColumns.join(", ")}`);

      const updates = [];
      const params = [];

      // Update status (kolom ini harus selalu ada)
      updates.push("status = ?");
      params.push(status);

      // Update berdasarkan kolom yang ada
      if (existingColumns.includes("message_id") && data.message_id) {
        updates.push("message_id = ?");
        params.push(data.message_id);
      }

      if (existingColumns.includes("response_data") && data.response_data) {
        updates.push("response_data = ?");
        params.push(JSON.stringify(data.response_data));
      }

      if (existingColumns.includes("error_message") && data.error_message) {
        updates.push("error_message = ?");
        params.push(data.error_message);
      }

      // Update timestamp berdasarkan status
      if (status === "delivered" && existingColumns.includes("delivered_at")) {
        updates.push("delivered_at = NOW()");
      }

      if (status === "read" && existingColumns.includes("read_at")) {
        updates.push("read_at = NOW()");
      }

      // Update updated_at jika kolom ada
      if (existingColumns.includes("updated_at")) {
        updates.push("updated_at = NOW()");
      }

      // Jika tidak ada kolom yang bisa diupdate selain status
      if (updates.length === 1) {
        console.log(`⚠️ Only updating status, no other columns available`);
      }

      // Tambahkan logId ke params
      params.push(logId);

      const query = `
      UPDATE notification_logs 
      SET ${updates.join(", ")}
      WHERE id = ?
    `;

      console.log(`📝 Update query: ${query}`);
      console.log(`📝 Params: ${JSON.stringify(params)}`);

      const [result] = await db.execute(query, params);

      if (result.affectedRows > 0) {
        console.log(
          `✅ Updated log ${logId}, affected rows: ${result.affectedRows}`,
        );
        return true;
      } else {
        console.log(`⚠️ Log ${logId} not found`);
        return false;
      }
    } catch (error) {
      console.error(
        "❌ Error updating notification log status:",
        error.message,
      );
      console.error("❌ Error details:", error.sql);
      console.error("❌ Error code:", error.code);
      return false;
    }
  }

  static async getLogsByCustomer(customerId, limit = 50) {
    try {
      const query = `
        SELECT * FROM notification_logs 
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const [rows] = await db.execute(query, [customerId, limit]);
      return rows;
    } catch (error) {
      console.error("Error getting notification logs by customer:", error);
      return [];
    }
  }

  static async getRecentLogs(limit = 100) {
    try {
      const query = `
        SELECT 
          nl.*,
          c.name as customer_name,
          s.end_date as subscription_end_date
        FROM notification_logs nl
        LEFT JOIN customers c ON nl.customer_id = c.id
        LEFT JOIN subscriptions s ON nl.subscription_id = s.id
        ORDER BY nl.created_at DESC
        LIMIT ?
      `;

      const [rows] = await db.execute(query, [limit]);
      return rows;
    } catch (error) {
      console.error("Error getting recent notification logs:", error);
      return [];
    }
  }

  static async getStats(days = 30) {
    try {
      const query = `
        SELECT 
          message_type,
          status,
          COUNT(*) as count,
          DATE(created_at) as date
        FROM notification_logs 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY message_type, status, DATE(created_at)
        ORDER BY date DESC, message_type
      `;

      const [rows] = await db.execute(query, [days]);
      return rows;
    } catch (error) {
      console.error("Error getting notification stats:", error);
      return [];
    }
  }
}

module.exports = NotificationLog;
