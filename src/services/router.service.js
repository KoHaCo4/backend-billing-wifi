const db = require("../config/database");
const logger = require("../utils/logger");

class RouterService {
  // Create router
  static async createRouter(data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO routers 
         (name, ip_address, username, password, port, api_port, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.ip_address,
          data.username,
          data.password,
          data.port || 8728,
          data.api_port || 8728,
          data.status || "active",
        ]
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
        ]
      );

      await connection.commit();

      return {
        id: routerId,
        ...data,
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Create router error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Get all routers - PERBAIKI: Tampilkan semua status
  static async getRouters(showInactive = false) {
    try {
      let query = "SELECT * FROM routers";

      if (!showInactive) {
        query += ' WHERE status = "active"';
      }

      query += " ORDER BY name";

      const [routers] = await db.query(query);
      return routers;
    } catch (error) {
      logger.error("Get routers error:", error);
      throw error;
    }
  }

  // Get all routers untuk filter (admin panel) - TAMBAHKAN
  static async getAllRouters(showInactive = true) {
    try {
      let query = "SELECT * FROM routers ORDER BY status DESC, name";
      const [routers] = await db.query(query);
      return routers;
    } catch (error) {
      logger.error("Get all routers error:", error);
      throw error;
    }
  }

  // Get router by ID - PERBAIKI: Tidak filter status
  static async getRouterById(id) {
    try {
      const [routers] = await db.query(
        "SELECT * FROM routers WHERE id = ?", // HAPUS FILTER STATUS
        [id]
      );

      if (routers.length === 0) {
        throw new Error("Router not found");
      }

      return routers[0];
    } catch (error) {
      logger.error("Get router by ID error:", error);
      throw error;
    }
  }

  // Update router
  static async updateRouter(id, data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Check if router exists
      const [routers] = await connection.query(
        "SELECT * FROM routers WHERE id = ?",
        [id]
      );

      if (routers.length === 0) {
        throw new Error("Router not found");
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
          passwordToUpdate, // Gunakan password yang sudah di-handle
          data.port || 8728,
          data.api_port || 8728,
          data.status || "active",
          id,
        ]
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
        ]
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
        // Jangan return password
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Update router error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Delete router (soft delete)
  static async deleteRouter(id, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Check if router has customers
      const [customers] = await connection.query(
        'SELECT COUNT(*) as count FROM customers WHERE router_id = ? AND status = "active"',
        [id]
      );

      if (customers[0].count > 0) {
        throw new Error("Cannot delete router with active customers");
      }

      // Soft delete (update status to inactive)
      await connection.query(
        'UPDATE routers SET status = "inactive" WHERE id = ?',
        [id]
      );

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["delete_router", "router", id, "Router deleted", "admin", adminId]
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

  // Test router connection
  static async testConnection(routerId) {
    try {
      const router = await this.getRouterById(routerId);

      // Simple ping test (kita akan implementasi Mikrotik test nanti)
      const isReachable = await this.pingRouter(router.ip_address);

      return {
        router,
        reachable: isReachable,
        message: isReachable
          ? "Router is reachable"
          : "Router is not reachable",
      };
    } catch (error) {
      logger.error("Test connection error:", error);
      throw error;
    }
  }

  // Simple ping function
  static async pingRouter(ip) {
    return new Promise((resolve) => {
      const { exec } = require("child_process");
      const command =
        process.platform === "win32" ? `ping -n 1 ${ip}` : `ping -c 1 ${ip}`;

      exec(command, (error) => {
        resolve(!error);
      });
    });
  }
}

module.exports = RouterService;
