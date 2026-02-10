const db = require("../config/database");

class Admin {
  // Get admin by ID
  static async findByPk(id, options = {}) {
    try {
      let query = "SELECT * FROM admins WHERE id = ?";
      const params = [id];

      // Jika tidak ingin password
      if (
        options.attributes &&
        options.attributes.exclude &&
        options.attributes.exclude.includes("password")
      ) {
        query =
          "SELECT id, name, email, role, is_active, last_login, created_at, updated_at FROM admins WHERE id = ?";
      }

      const [rows] = await db.execute(query, params);
      return rows[0] || null;
    } catch (error) {
      console.error("❌ Error finding admin by pk:", error);
      throw error;
    }
  }

  // Get all admins
  static async findAll(options = {}) {
    try {
      let query = "SELECT * FROM admins WHERE 1=1";
      const params = [];

      // Exclude password secara default
      if (
        !options.attributes ||
        (options.attributes &&
          !options.attributes.include &&
          (!options.attributes.exclude ||
            !options.attributes.exclude.includes("password")))
      ) {
        query =
          "SELECT id, name, email, role, is_active, last_login, created_at, updated_at FROM admins WHERE 1=1";
      }

      // Add where clause jika ada
      if (options.where) {
        if (options.where.role) {
          query += " AND role = ?";
          params.push(options.where.role);
        }
        if (options.where.is_active !== undefined) {
          query += " AND is_active = ?";
          params.push(options.where.is_active);
        }
      }

      // Add order
      if (options.order) {
        query +=
          " ORDER BY " + options.order.map((o) => o.join(" ")).join(", ");
      }

      const [rows] = await db.execute(query, params);
      return rows;
    } catch (error) {
      console.error("❌ Error finding all admins:", error);
      throw error;
    }
  }

  // Find one admin
  static async findOne(options = {}) {
    try {
      let query = "SELECT * FROM admins WHERE 1=1";
      const params = [];

      if (options.where) {
        if (options.where.id) {
          query += " AND id = ?";
          params.push(options.where.id);
        }
        if (options.where.email) {
          query += " AND email = ?";
          params.push(options.where.email);
        }
        if (options.where.role) {
          query += " AND role = ?";
          params.push(options.where.role);
        }
      }

      // Exclude password
      if (
        !options.attributes ||
        (options.attributes && !options.attributes.include)
      ) {
        query = query.replace(
          "SELECT *",
          "SELECT id, name, email, role, is_active, last_login, created_at, updated_at",
        );
      }

      const [rows] = await db.execute(query + " LIMIT 1", params);
      return rows[0] || null;
    } catch (error) {
      console.error("❌ Error finding one admin:", error);
      throw error;
    }
  }

  // Create admin
  static async create(data) {
    try {
      const { name, email, password, role = "admin", is_active = true } = data;

      const query = `
        INSERT INTO admins (name, email, password, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const [result] = await db.execute(query, [
        name,
        email,
        password,
        role,
        is_active,
      ]);

      return {
        id: result.insertId,
        name,
        email,
        role,
        is_active,
        created_at: new Date(),
        updated_at: new Date(),
      };
    } catch (error) {
      console.error("❌ Error creating admin:", error);
      throw error;
    }
  }

  // Update admin
  static async update(data, options) {
    try {
      const updateFields = [];
      const params = [];

      if (data.name !== undefined) {
        updateFields.push("name = ?");
        params.push(data.name);
      }
      if (data.email !== undefined) {
        updateFields.push("email = ?");
        params.push(data.email);
      }
      if (data.password !== undefined) {
        updateFields.push("password = ?");
        params.push(data.password);
      }
      if (data.role !== undefined) {
        updateFields.push("role = ?");
        params.push(data.role);
      }
      if (data.is_active !== undefined) {
        updateFields.push("is_active = ?");
        params.push(data.is_active);
      }
      if (data.last_login !== undefined) {
        updateFields.push("last_login = ?");
        params.push(data.last_login);
      }

      if (updateFields.length === 0) {
        throw new Error("No fields to update");
      }

      updateFields.push("updated_at = NOW()");

      let query = `UPDATE admins SET ${updateFields.join(", ")}`;

      if (options && options.where) {
        if (options.where.id) {
          query += " WHERE id = ?";
          params.push(options.where.id);
        }
      }

      const [result] = await db.execute(query, params);
      return result.affectedRows > 0;
    } catch (error) {
      console.error("❌ Error updating admin:", error);
      throw error;
    }
  }

  // Delete admin
  static async destroy(options) {
    try {
      let query = "DELETE FROM admins WHERE 1=1";
      const params = [];

      if (options && options.where) {
        if (options.where.id) {
          query += " AND id = ?";
          params.push(options.where.id);
        }
        if (options.where.email) {
          query += " AND email = ?";
          params.push(options.where.email);
        }
      }

      const [result] = await db.execute(query, params);
      return result.affectedRows > 0;
    } catch (error) {
      console.error("❌ Error deleting admin:", error);
      throw error;
    }
  }

  // Get admin statistics
  static async getStatistics(adminId = null, role = null) {
    try {
      // Query untuk mendapatkan statistik admin
      let query = `
        SELECT 
          COUNT(*) as total_customers,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_customers,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_customers,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_customers
        FROM customers
        WHERE 1=1
      `;

      const params = [];

      if (adminId && role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [rows] = await db.execute(query, params);
      return rows[0];
    } catch (error) {
      console.error("❌ Error getting admin statistics:", error);
      throw error;
    }
  }

  // Count admins
  static async count(options = {}) {
    try {
      let query = "SELECT COUNT(*) as count FROM admins WHERE 1=1";
      const params = [];

      if (options && options.where) {
        if (options.where.role) {
          query += " AND role = ?";
          params.push(options.where.role);
        }
        if (options.where.is_active !== undefined) {
          query += " AND is_active = ?";
          params.push(options.where.is_active);
        }
      }

      const [rows] = await db.execute(query, params);
      return rows[0].count;
    } catch (error) {
      console.error("❌ Error counting admins:", error);
      throw error;
    }
  }
}

module.exports = Admin;
