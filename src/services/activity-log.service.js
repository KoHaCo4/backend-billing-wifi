// services/activity-log.service.js (buat file baru jika belum ada)
const db = require("../config/database");

class ActivityLogService {
  static async logActivity(logData) {
    try {
      const {
        action,
        entity,
        entity_id,
        invoice_id = null,
        description,
        admin_id = null,
        source = "system",
      } = logData;

      // Cek apakah tabel logs ada
      const [tableCheck] = await db.query("SHOW TABLES LIKE 'logs'");

      if (tableCheck.length === 0) {
        console.warn("⚠️ Table 'logs' does not exist, skipping activity log");
        return;
      }

      const query = `
        INSERT INTO logs (
          action, entity, entity_id, invoice_id, description,
          source, admin_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      const params = [
        action,
        entity,
        entity_id,
        invoice_id,
        description,
        source,
        admin_id,
      ];

      await db.query(query, params);
      console.log(`✅ Activity logged: ${action} ${entity} ${entity_id}`);
    } catch (error) {
      console.error("❌ Failed to log activity:", error.message);
      // Jangan throw error agar tidak mengganggu proses utama
    }
  }
}

module.exports = ActivityLogService;
