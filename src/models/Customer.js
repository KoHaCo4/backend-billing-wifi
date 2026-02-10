const db = require("../config/database");

class Customer {
  // Method untuk mendapatkan customers dengan filter multi-user
  static async findExpiringInDays(days, adminId = null, role = null) {
    try {
      console.log(
        `🔍 Mencari pelanggan yang akan expired dalam ${days} hari LAGI...`,
        `Admin ID: ${adminId}, Role: ${role}`,
      );

      // Base query
      let query = `
SELECT 
  c.id,
  c.name,
  c.phone,
  c.address,
  c.expired_at,
  c.status,
  c.auto_renew,
  c.reminder_sent,
  c.last_reminder_date,
  c.admin_id,
  c.is_shared,
  c.shared_with,
  p.id as package_id,
  p.name as package_name,
  p.price as package_price,
  p.duration_days,
  DATEDIFF(DATE(c.expired_at), CURDATE()) as days_left
FROM customers c
LEFT JOIN packages p ON c.package_id = p.id
WHERE c.status = 'active'
AND c.expired_at IS NOT NULL
AND DATE(c.expired_at) = DATE_ADD(CURDATE(), INTERVAL ? DAY)
AND c.phone IS NOT NULL
AND TRIM(c.phone) != ''
AND c.phone != '0'
AND (
  c.reminder_sent IS NULL 
  OR c.reminder_sent = 0
  OR DATE(c.last_reminder_date) != CURDATE()
)
`;

      const params = [days];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      query += `ORDER BY c.expired_at ASC`;

      console.log(`📊 Query untuk days=${days}: ${query.replace(/\s+/g, " ")}`);
      console.log(`📊 Parameter:`, params);

      const [rows] = await db.execute(query, params);
      console.log(`✅ Ditemukan ${rows.length} pelanggan`);

      return rows;
    } catch (error) {
      console.error("❌ Error finding expiring customers:", error.message);
      if (error.sql) console.error("SQL Error:", error.sql);
      return [];
    }
  }

  // Method untuk mendapatkan semua customers dengan filter multi-user
  static async getAllActiveWithPhone(adminId = null, role = null) {
    try {
      let query = `
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
      `;

      const params = [];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      query += ` ORDER BY c.expired_at ASC`;

      const [rows] = await db.execute(query, params);
      return rows;
    } catch (error) {
      console.error("❌ Error getting active customers:", error);
      return [];
    }
  }

  // Method untuk mendapatkan customer by ID dengan authorization
  static async getCustomerById(id, adminId = null, role = null) {
    try {
      let query = `
        SELECT 
          c.*,
          p.name as package_name,
          p.price as package_price
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE c.id = ?
      `;

      const params = [id];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [rows] = await db.execute(query, params);
      return rows[0] || null;
    } catch (error) {
      console.error("❌ Error getting customer by id:", error);
      return null;
    }
  }

  // Method untuk mendapatkan customers dengan pagination dan filter multi-user
  static async getCustomersWithPagination(
    page = 1,
    limit = 20,
    filters = {},
    adminId = null,
    role = null,
  ) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params = [];

      // Filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        whereClause += `
        AND (
          c.admin_id = ? 
          OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, ?))
        )
      `;
        params.push(adminId);
        params.push(JSON.stringify([adminId]));
      }

      // Filter status
      if (filters.status) {
        whereClause += " AND c.status = ?";
        params.push(filters.status);
      }

      // Filter router
      if (filters.router_id) {
        whereClause += " AND c.router_id = ?";
        params.push(filters.router_id);
      }

      // Filter search
      if (filters.search) {
        whereClause +=
          " AND (c.name LIKE ? OR c.username_pppoe LIKE ? OR c.phone LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // PERBAIKAN 1: Gunakan query sederhana tanpa placeholder untuk LIMIT/OFFSET
      const limitNum = parseInt(limit);
      const offsetNum = parseInt(offset);

      // Query untuk data
      const dataQuery = `
      SELECT 
        c.*,
        r.name as router_name,
        r.ip_address as router_ip,
        p.name as package_name,
        p.price as package_price,
        p.duration_days,
        a.name as admin_name,
        a.email as admin_email,
        DATE_FORMAT(c.expired_at, '%Y-%m-%d') as expired_at_formatted,
        DATEDIFF(c.expired_at, CURDATE()) as days_remaining
      FROM customers c
      LEFT JOIN routers r ON c.router_id = r.id
      LEFT JOIN packages p ON c.package_id = p.id
      LEFT JOIN admins a ON c.admin_id = a.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

      // Query untuk count
      const countQuery = `
      SELECT COUNT(*) as total 
      FROM customers c
      ${whereClause}
    `;

      console.log("🔍 Debug Customer Query:");
      console.log("Query:", dataQuery);
      console.log("Params:", params);

      // Execute queries
      const [rows] = await db.execute(dataQuery, params);
      const [[countResult]] = await db.execute(countQuery, params);

      const total = countResult.total;
      const totalPages = Math.ceil(total / limit);

      return {
        data: rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: limitNum,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (error) {
      console.error("❌ Error getting customers with pagination:", error);
      console.error("❌ SQL:", error.sql);
      console.error("❌ Parameters:", error.parameters);
      throw error;
    }
  }

  // Method untuk create customer dengan admin_id
  static async createCustomer(data) {
    try {
      const {
        name,
        phone,
        address,
        username_pppoe,
        password_pppoe,
        router_id,
        package_id,
        expired_at,
        status = "active",
        auto_renew = 1,
        admin_id,
        is_shared = 0,
        shared_with = null,
      } = data;

      const query = `
        INSERT INTO customers (
          name, phone, address, username_pppoe, password_pppoe,
          router_id, package_id, expired_at, status, auto_renew,
          admin_id, is_shared, shared_with, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const sharedWithJson = shared_with ? JSON.stringify(shared_with) : null;

      const [result] = await db.execute(query, [
        name,
        phone || null,
        address || null,
        username_pppoe,
        password_pppoe,
        router_id,
        package_id,
        expired_at,
        status,
        auto_renew,
        admin_id,
        is_shared,
        sharedWithJson,
      ]);

      return {
        id: result.insertId,
        ...data,
      };
    } catch (error) {
      console.error("❌ Error creating customer:", error);
      throw error;
    }
  }

  // Method untuk update customer dengan authorization
  static async updateCustomer(id, data, adminId, role) {
    try {
      // Cek apakah customer ada dan bisa diakses
      const customer = await this.getCustomerById(id, adminId, role);

      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      // Build update fields
      const updateFields = [];
      const params = [];

      const fieldMappings = {
        name: data.name,
        phone: data.phone,
        address: data.address,
        username_pppoe: data.username_pppoe,
        password_pppoe: data.password_pppoe,
        router_id: data.router_id,
        package_id: data.package_id,
        expired_at: data.expired_at,
        status: data.status,
        auto_renew: data.auto_renew,
        is_shared: data.is_shared,
        shared_with: data.shared_with,
      };

      for (const [field, value] of Object.entries(fieldMappings)) {
        if (value !== undefined) {
          updateFields.push(`${field} = ?`);

          if (field === "shared_with" && value) {
            params.push(JSON.stringify(value));
          } else {
            params.push(value);
          }
        }
      }

      if (updateFields.length === 0) {
        throw new Error("No fields to update");
      }

      // Tambahkan updated_at dan id ke params
      updateFields.push("updated_at = NOW()");
      params.push(id);

      const query = `
        UPDATE customers 
        SET ${updateFields.join(", ")}
        WHERE id = ?
      `;

      const [result] = await db.execute(query, params);

      if (result.affectedRows === 0) {
        throw new Error("Failed to update customer");
      }

      return await this.getCustomerById(id, adminId, role);
    } catch (error) {
      console.error("❌ Error updating customer:", error);
      throw error;
    }
  }

  // Method untuk delete customer dengan authorization
  static async deleteCustomer(id, adminId, role) {
    try {
      // Cek apakah customer ada dan bisa diakses
      const customer = await this.getCustomerById(id, adminId, role);

      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      // Hanya superadmin atau pemilik yang bisa delete
      if (role !== "superadmin" && customer.admin_id !== adminId) {
        throw new Error("You can only delete your own customers");
      }

      const query = "DELETE FROM customers WHERE id = ?";
      const [result] = await db.execute(query, [id]);

      if (result.affectedRows === 0) {
        throw new Error("Failed to delete customer");
      }

      return { id, deleted: true };
    } catch (error) {
      console.error("❌ Error deleting customer:", error);
      throw error;
    }
  }

  // Method untuk share customer dengan admin lain
  static async shareCustomer(customerId, ownerAdminId, targetAdminIds) {
    try {
      // Cek apakah customer milik admin
      const [customers] = await db.execute(
        "SELECT * FROM customers WHERE id = ? AND admin_id = ?",
        [customerId, ownerAdminId],
      );

      if (customers.length === 0) {
        throw new Error("Customer not found or you don't own this customer");
      }

      // Filter out the owner from target admins
      const filteredAdmins = targetAdminIds.filter((id) => id !== ownerAdminId);
      const isShared = filteredAdmins.length > 0;

      const query = `
        UPDATE customers 
        SET is_shared = ?, shared_with = ?, updated_at = NOW()
        WHERE id = ? AND admin_id = ?
      `;

      const sharedWithJson = isShared ? JSON.stringify(filteredAdmins) : null;

      const [result] = await db.execute(query, [
        isShared ? 1 : 0,
        sharedWithJson,
        customerId,
        ownerAdminId,
      ]);

      if (result.affectedRows === 0) {
        throw new Error("Failed to share customer");
      }

      return {
        customerId,
        is_shared: isShared,
        shared_with: filteredAdmins,
      };
    } catch (error) {
      console.error("❌ Error sharing customer:", error);
      throw error;
    }
  }

  // Method untuk mendapatkan statistics per admin
  static async getStatistics(adminId = null, role = null) {
    try {
      let whereClause = "WHERE 1=1";
      const params = [];

      // Filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        whereClause += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const query = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
          SUM(CASE WHEN DATEDIFF(expired_at, CURDATE()) <= 3 AND status = 'active' THEN 1 ELSE 0 END) as expiring_soon
        FROM customers
        ${whereClause}
      `;

      const [rows] = await db.execute(query, params);
      return rows[0];
    } catch (error) {
      console.error("❌ Error getting statistics:", error);
      throw error;
    }
  }

  // Method untuk mendapatkan customers berdasarkan admin
  static async getCustomersByAdmin(adminId, limit = 10) {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as package_name,
          p.price as package_price,
          r.name as router_name
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        LEFT JOIN routers r ON c.router_id = r.id
        WHERE c.admin_id = ?
        ORDER BY c.created_at DESC
        LIMIT ?
      `;

      const [rows] = await db.execute(query, [adminId, limit]);
      return rows;
    } catch (error) {
      console.error("❌ Error getting customers by admin:", error);
      throw error;
    }
  }

  // Method untuk memeriksa apakah admin bisa mengakses customer
  static async canAccessCustomer(customerId, adminId, role) {
    try {
      if (role === "superadmin") {
        return true;
      }

      const query = `
        SELECT id FROM customers 
        WHERE id = ? 
        AND (
          admin_id = ? 
          OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
        )
      `;

      const [rows] = await db.execute(query, [
        customerId,
        adminId,
        JSON.stringify([adminId]),
      ]);

      return rows.length > 0;
    } catch (error) {
      console.error("❌ Error checking customer access:", error);
      return false;
    }
  }

  // Existing methods tetap dipertahankan dengan tambahan parameter admin
  static async findExpiringTomorrow(adminId = null, role = null) {
    return this.findExpiringInDays(1, adminId, role);
  }

  static async markReminderSent(customerId) {
    try {
      await db.execute(
        `UPDATE customers 
       SET reminder_sent = 1,
           last_reminder_date = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
        [customerId],
      );
      console.log(`✅ Marked reminder sent for customer ${customerId}`);
      return true;
    } catch (error) {
      console.error("❌ Error marking reminder sent:", error);
      return false;
    }
  }

  static async resetReminderFlags() {
    try {
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

  static async findExpiredCustomers(adminId = null, role = null) {
    try {
      let query = `
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

      const params = [];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [rows] = await db.execute(query, params);
      return rows;
    } catch (error) {
      console.error("❌ Error finding expired customers:", error);
      return [];
    }
  }

  static async getExpiringSoonCount(days = 3, adminId = null, role = null) {
    try {
      let query = `
        SELECT COUNT(*) as count
        FROM customers c
        WHERE DATE(c.expired_at) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND c.status = 'active'
        AND c.phone IS NOT NULL
        AND c.phone REGEXP '^[0-9]+$'
      `;

      const params = [days];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [rows] = await db.execute(query, params);
      return rows[0].count;
    } catch (error) {
      console.error("❌ Error getting expiring soon count:", error);
      return 0;
    }
  }

  static async updateCustomerStatus(
    customerId,
    status,
    adminId = null,
    role = null,
  ) {
    try {
      // Cek akses terlebih dahulu
      if (adminId && role && role !== "superadmin") {
        const canAccess = await this.canAccessCustomer(
          customerId,
          adminId,
          role,
        );
        if (!canAccess) {
          throw new Error("Access denied to update customer status");
        }
      }

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

  static async getCustomersForReminder(days = 1, adminId = null, role = null) {
    try {
      let query = `
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
      `;

      const params = [days];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            c.admin_id = ? 
            OR (c.is_shared = 1 AND JSON_CONTAINS(c.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      query += ` ORDER BY c.expired_at ASC`;

      const [rows] = await db.execute(query, params);
      return rows;
    } catch (error) {
      console.error("❌ Error getting customers for reminder:", error);
      return [];
    }
  }
}

module.exports = Customer;
