const db = require("../config/database");
const logger = require("../utils/logger");

class RouterService {
  // Create router dengan admin_id
  static async createRouter(data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO routers 
         (name, ip_address, username, password, port, api_port, status, admin_id, is_shared, shared_with) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.ip_address,
          data.username,
          data.password,
          data.port || 8728,
          data.api_port || 8728,
          data.status || "active",
          adminId, // Tambahkan admin_id
          data.is_shared || 0,
          data.shared_with ? JSON.stringify(data.shared_with) : null,
        ],
      );

      const routerId = result.insertId;

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "create_router",
          "router",
          routerId,
          `Router created: ${data.name} (${data.ip_address})`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      return {
        id: routerId,
        ...data,
        admin_id: adminId,
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Create router error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Get all routers dengan filter multi-user
  static async getRouters(showInactive = false, adminId = null, role = null) {
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

      if (!showInactive) {
        whereClause += ' AND status = "active"';
      }

      whereClause += " ORDER BY name";

      const query = `SELECT * FROM routers ${whereClause}`;
      const [routers] = await db.query(query, params);
      return routers;
    } catch (error) {
      logger.error("Get routers error:", error);
      throw error;
    }
  }

  // Get router by ID dengan authorization
  static async getRouterById(id, adminId = null, role = null) {
    try {
      let query = "SELECT * FROM routers WHERE id = ?";
      const params = [id];

      // Tambahkan filter authorization jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [routers] = await db.query(query, params);

      if (routers.length === 0) {
        return null; // Return null jika tidak ditemukan atau tidak ada akses
      }

      return routers[0];
    } catch (error) {
      logger.error("Get router by ID error:", error);
      throw error;
    }
  }

  // Update router dengan authorization
  static async updateRouter(id, data, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Check if router exists and admin has access
      let query = "SELECT * FROM routers WHERE id = ?";
      const params = [id];

      if (role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [routers] = await connection.query(query, params);

      if (routers.length === 0) {
        throw new Error("Router not found or access denied");
      }

      const currentRouter = routers[0];

      // Handle password: jika kosong, gunakan password lama
      let passwordToUpdate = data.password;
      if (!passwordToUpdate || passwordToUpdate.trim() === "") {
        passwordToUpdate = currentRouter.password;
      }

      // Update router
      await connection.query(
        `UPDATE routers 
       SET name = ?, ip_address = ?, username = ?, password = ?, port = ?, api_port = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
        [
          data.name,
          data.ip_address,
          data.username,
          passwordToUpdate,
          data.port || 8728,
          data.api_port || 8728,
          data.status || "active",
          id,
        ],
      );

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "update_router",
          "router",
          id,
          `Router updated: ${data.name}`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      return {
        id,
        name: data.name,
        ip_address: data.ip_address,
        username: data.username,
        port: data.port,
        api_port: data.api_port,
        status: data.status,
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Update router error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Delete router (soft delete) dengan authorization
  static async deleteRouter(id, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Check if router has customers
      const [customers] = await connection.query(
        'SELECT COUNT(*) as count FROM customers WHERE router_id = ? AND status = "active"',
        [id],
      );

      if (customers[0].count > 0) {
        throw new Error("Cannot delete router with active customers");
      }

      // Check access
      if (role !== "superadmin") {
        const [routers] = await connection.query(
          "SELECT admin_id FROM routers WHERE id = ?",
          [id],
        );

        if (routers.length === 0) {
          throw new Error("Router not found");
        }

        if (routers[0].admin_id !== adminId) {
          throw new Error("Access denied to delete this router");
        }
      }

      // Soft delete (update status to inactive)
      await connection.query(
        'UPDATE routers SET status = "inactive" WHERE id = ?',
        [id],
      );

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["delete_router", "router", id, "Router deleted", "admin", adminId],
      );

      await connection.commit();

      return { success: true };
    } catch (error) {
      await connection.rollback();
      logger.error("Delete router error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Cek apakah admin bisa mengakses router
  static async canAccessRouter(routerId, adminId, role) {
    try {
      if (role === "superadmin") {
        return true;
      }

      const [routers] = await db.query(
        `SELECT id FROM routers 
         WHERE id = ? 
         AND (
           admin_id = ? 
           OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
         )`,
        [routerId, adminId, JSON.stringify([adminId])],
      );

      return routers.length > 0;
    } catch (error) {
      logger.error("Check router access error:", error);
      return false;
    }
  }
}

module.exports = RouterService;
