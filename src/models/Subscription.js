const db = require("../config/database");

class Subscription {
  static async findExpiringTomorrow() {
    try {
      const query = `
        SELECT 
          s.id as subscription_id,
          s.customer_id,
          s.package_id,
          s.start_date,
          s.end_date,
          s.status,
          s.created_at,
          s.updated_at,
          c.id as customer_id,
          c.name as customer_name,
          c.phone,
          c.email,
          c.address,
          p.id as package_id,
          p.name as package_name,
          p.price as package_price,
          p.speed,
          p.duration_days
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN packages p ON s.package_id = p.id
        WHERE DATE(s.end_date) = DATE(DATE_ADD(NOW(), INTERVAL 1 DAY))
        AND s.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        AND (s.reminder_sent IS NULL OR s.reminder_sent = 0)
      `;

      const [rows] = await db.execute(query);
      return rows;
    } catch (error) {
      console.error("Error finding expiring subscriptions:", error);
      throw error;
    }
  }

  static async findExpiringInDays(days) {
    try {
      const query = `
        SELECT 
          s.id as subscription_id,
          s.customer_id,
          s.package_id,
          s.start_date,
          s.end_date,
          s.status,
          s.created_at,
          s.updated_at,
          c.id as customer_id,
          c.name as customer_name,
          c.phone,
          c.email,
          c.address,
          p.id as package_id,
          p.name as package_name,
          p.price as package_price,
          p.speed,
          p.duration_days
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN packages p ON s.package_id = p.id
        WHERE DATE(s.end_date) = DATE(DATE_ADD(NOW(), INTERVAL ? DAY))
        AND s.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        AND (s.reminder_sent IS NULL OR s.reminder_sent = 0)
      `;

      const [rows] = await db.execute(query, [days]);
      return rows;
    } catch (error) {
      console.error("Error finding expiring subscriptions:", error);
      throw error;
    }
  }

  static async findActiveSubscriptionsWithCustomers() {
    try {
      const query = `
        SELECT 
          s.*,
          c.name as customer_name,
          c.phone,
          c.email,
          p.name as package_name,
          p.price as package_price
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN packages p ON s.package_id = p.id
        WHERE s.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        ORDER BY s.end_date ASC
      `;

      const [rows] = await db.execute(query);
      return rows;
    } catch (error) {
      console.error("Error finding active subscriptions:", error);
      throw error;
    }
  }

  static async markReminderSent(subscriptionId) {
    try {
      // Cek apakah kolom reminder_sent sudah ada
      const checkQuery = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'subscriptions' 
        AND COLUMN_NAME = 'reminder_sent'
        AND TABLE_SCHEMA = DATABASE()
      `;

      const [columns] = await db.execute(checkQuery);

      if (columns.length === 0) {
        console.log("Kolom reminder_sent belum ada, menambahkan...");
        // Tambahkan kolom jika belum ada
        await db.execute(`
          ALTER TABLE subscriptions 
          ADD COLUMN reminder_sent TINYINT(1) DEFAULT 0,
          ADD COLUMN last_reminder_date DATETIME NULL
        `);
      }

      const query = `
        UPDATE subscriptions 
        SET reminder_sent = 1, 
            last_reminder_date = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `;

      const [result] = await db.execute(query, [subscriptionId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error marking reminder sent:", error);
      throw error;
    }
  }

  static async resetReminderFlags() {
    try {
      // Cek apakah kolom reminder_sent sudah ada
      const checkQuery = `
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'subscriptions' 
        AND COLUMN_NAME = 'reminder_sent'
        AND TABLE_SCHEMA = DATABASE()
      `;

      const [columns] = await db.execute(checkQuery);

      if (columns.length === 0) {
        return 0; // Kolom belum ada, tidak perlu reset
      }

      const query = `
        UPDATE subscriptions 
        SET reminder_sent = 0 
        WHERE DATE(end_date) > DATE(NOW())
        AND status = 'active'
      `;

      const [result] = await db.execute(query);
      return result.affectedRows;
    } catch (error) {
      console.error("Error resetting reminder flags:", error);
      throw error;
    }
  }

  static async getSubscriptionById(id) {
    try {
      const query = `
        SELECT 
          s.*,
          c.name as customer_name,
          c.phone,
          c.email,
          p.name as package_name,
          p.price as package_price
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN packages p ON s.package_id = p.id
        WHERE s.id = ?
      `;

      const [rows] = await db.execute(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error getting subscription by id:", error);
      throw error;
    }
  }

  static async updateSubscriptionStatus(subscriptionId, status) {
    try {
      const query = `
        UPDATE subscriptions 
        SET status = ?, 
            updated_at = NOW()
        WHERE id = ?
      `;

      const [result] = await db.execute(query, [status, subscriptionId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error updating subscription status:", error);
      throw error;
    }
  }

  static async findExpiredSubscriptions() {
    try {
      const query = `
        SELECT 
          s.*,
          c.name as customer_name,
          c.phone,
          c.email,
          p.name as package_name
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN packages p ON s.package_id = p.id
        WHERE DATE(s.end_date) < DATE(NOW())
        AND s.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
      `;

      const [rows] = await db.execute(query);
      return rows;
    } catch (error) {
      console.error("Error finding expired subscriptions:", error);
      throw error;
    }
  }

  // Untuk dashboard stats
  static async getExpiringSoonCount(days = 3) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM subscriptions s
        JOIN customers c ON s.customer_id = c.id
        WHERE DATE(s.end_date) BETWEEN DATE(NOW()) AND DATE(DATE_ADD(NOW(), INTERVAL ? DAY))
        AND s.status = 'active'
        AND c.phone IS NOT NULL
      `;

      const [rows] = await db.execute(query, [days]);
      return rows[0].count;
    } catch (error) {
      console.error("Error getting expiring soon count:", error);
      return 0;
    }
  }
}

module.exports = Subscription;
