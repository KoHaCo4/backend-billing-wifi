const db = require("../config/database");

class Customer {
  static async findExpiringInDays(days) {
    try {
      console.log(
        `🔍 Mencari pelanggan yang akan expired dalam ${days} hari...`,
      );

      const query = `
      SELECT 
        c.id,
        c.name,
        c.phone,
        c.address,
        c.expired_at,
        c.status,
        c.auto_renew,
        p.id as package_id,
        p.name as package_name,
        p.price as package_price,
        p.duration_days,
        DATEDIFF(c.expired_at, CURDATE()) as days_left
      FROM customers c
      LEFT JOIN packages p ON c.package_id = p.id
      WHERE DATE(c.expired_at) = DATE(DATE_ADD(CURDATE(), INTERVAL ? DAY))
      AND c.status = 'active'
      AND c.phone IS NOT NULL
      AND TRIM(c.phone) != ''
      AND c.phone != '0'
      AND (c.reminder_sent IS NULL OR c.reminder_sent = 0)
      AND (
        c.phone REGEXP '^[0-9]+$' OR
        c.phone REGEXP '^\\+[0-9]+$'
      )
      ORDER BY c.expired_at ASC
    `;

      console.log(`📊 Query: ${query.replace(/\s+/g, " ")}`);
      console.log(`📊 Parameter days: ${days}`);

      const [rows] = await db.execute(query, [days]);
      console.log(`✅ Ditemukan ${rows.length} pelanggan`);

      // Log detail setiap pelanggan
      rows.forEach((customer, index) => {
        console.log(
          `${index + 1}. ${customer.name} (${customer.phone}) - Expired: ${customer.expired_at} - Days left: ${customer.days_left}`,
        );
      });

      return rows;
    } catch (error) {
      console.error("❌ Error finding expiring customers:", error.message);
      if (error.sql) console.error("SQL Error:", error.sql);
      return [];
    }
  }

  static async findExpiringTomorrow() {
    return this.findExpiringInDays(1);
  }

  static async getAllActiveWithPhone() {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as package_name,
          p.price as package_price,
          DATEDIFF(c.expired_at, CURDATE()) as days_remaining
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE c.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        AND c.phone != '0'
        AND c.phone REGEXP '^[0-9]+$'
        ORDER BY c.expired_at ASC
      `;

      const [rows] = await db.execute(query);
      return rows;
    } catch (error) {
      console.error("❌ Error getting active customers:", error);
      return [];
    }
  }

  static async markReminderSent(customerId) {
    try {
      // Cek apakah kolom reminder_sent sudah ada
      const [columns] = await db.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'customers' 
        AND COLUMN_NAME = 'reminder_sent'
        AND TABLE_SCHEMA = DATABASE()
      `);

      if (columns.length === 0) {
        console.log("📝 Kolom reminder_sent belum ada, menambahkan...");
        // Tambahkan kolom
        await db.execute(`
          ALTER TABLE customers 
          ADD COLUMN reminder_sent TINYINT(1) DEFAULT 0,
          ADD COLUMN last_reminder_date DATETIME NULL
        `);
      }

      // Update reminder_sent
      const [result] = await db.execute(
        `
        UPDATE customers 
        SET reminder_sent = 1, 
            last_reminder_date = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `,
        [customerId],
      );

      return result.affectedRows > 0;
    } catch (error) {
      console.error("❌ Error marking reminder sent:", error.message);
      return false;
    }
  }

  static async resetReminderFlags() {
    try {
      // Cek apakah kolom reminder_sent sudah ada
      const [columns] = await db.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'customers' 
        AND COLUMN_NAME = 'reminder_sent'
        AND TABLE_SCHEMA = DATABASE()
      `);

      if (columns.length === 0) {
        console.log("📝 Kolom reminder_sent belum ada, tidak perlu reset");
        return 0;
      }

      const [result] = await db.execute(`
        UPDATE customers 
        SET reminder_sent = 0 
        WHERE DATE(expired_at) > CURDATE()
        AND status = 'active'
      `);

      return result.affectedRows;
    } catch (error) {
      console.error("❌ Error resetting reminder flags:", error.message);
      return 0;
    }
  }

  static async findExpiredCustomers() {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as package_name
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE DATE(c.expired_at) < CURDATE()
        AND c.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
      `;

      const [rows] = await db.execute(query);
      return rows;
    } catch (error) {
      console.error("❌ Error finding expired customers:", error);
      return [];
    }
  }

  static async getExpiringSoonCount(days = 3) {
    try {
      const query = `
        SELECT COUNT(*) as count
        FROM customers c
        WHERE DATE(c.expired_at) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND c.status = 'active'
        AND c.phone IS NOT NULL
        AND c.phone REGEXP '^[0-9]+$'
      `;

      const [rows] = await db.execute(query, [days]);
      return rows[0].count;
    } catch (error) {
      console.error("❌ Error getting expiring soon count:", error);
      return 0;
    }
  }

  static async getCustomerById(id) {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as package_name,
          p.price as package_price
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE c.id = ?
      `;

      const [rows] = await db.execute(query, [id]);
      return rows[0] || null;
    } catch (error) {
      console.error("❌ Error getting customer by id:", error);
      return null;
    }
  }

  static async updateCustomerStatus(customerId, status) {
    try {
      const query = `
        UPDATE customers 
        SET status = ?, 
            updated_at = NOW()
        WHERE id = ?
      `;

      const [result] = await db.execute(query, [status, customerId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error("❌ Error updating customer status:", error);
      return false;
    }
  }

  static async getCustomersForReminder(days = 1) {
    try {
      const query = `
        SELECT 
          c.id,
          c.name,
          c.phone,
          c.expired_at,
          p.name as package_name,
          p.price as package_price
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE DATE(c.expired_at) = DATE(DATE_ADD(CURDATE(), INTERVAL ? DAY))
        AND c.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        AND (c.reminder_sent IS NULL OR c.reminder_sent = 0)
        AND c.phone REGEXP '^8[0-9]{9,12}$'
        ORDER BY c.expired_at ASC
      `;

      const [rows] = await db.execute(query, [days]);
      return rows;
    } catch (error) {
      console.error("❌ Error getting customers for reminder:", error);
      return [];
    }
  }

  // Debug method untuk melihat data
  static async debugCustomers() {
    try {
      console.log("🔍 Debugging customer data...");

      const query = `
        SELECT 
          c.id,
          c.name,
          c.phone,
          c.expired_at,
          c.status,
          COALESCE(c.reminder_sent, 0) as reminder_sent,
          DATEDIFF(c.expired_at, CURDATE()) as days_left
        FROM customers c
        WHERE c.status = 'active'
        AND c.phone IS NOT NULL
        AND TRIM(c.phone) != ''
        ORDER BY c.expired_at ASC
        LIMIT 10
      `;

      const [rows] = await db.execute(query);

      console.log("📊 Data customers aktif:");
      console.log(`Total ditemukan: ${rows.length}`);

      rows.forEach((customer, index) => {
        console.log(
          `${index + 1}. ${customer.name} - ${customer.phone} - Expired: ${customer.expired_at} (${customer.days_left} hari lagi) - Reminder sent: ${customer.reminder_sent}`,
        );
      });

      return rows;
    } catch (error) {
      console.error("❌ Debug error:", error.message);
      return [];
    }
  }
}

module.exports = Customer;
