const RouterService = require("../services/router.service");
const db = require("../config/database");
const logger = require("../utils/logger");

class RouterController {
  // Create router
  static async createRouter(req, res) {
    try {
      const { name, ip_address, username, password, port, api_port, status } =
        req.body;
      const adminId = req.user.id;

      if (!name || !ip_address || !username || !password) {
        return res.status(400).json({
          success: false,
          message: "Name, IP address, username, and password are required",
        });
      }

      // Check if IP already exists
      const [existingRouters] = await db.query(
        "SELECT id FROM routers WHERE ip_address = ?",
        [ip_address]
      );

      if (existingRouters.length > 0) {
        return res.status(400).json({
          success: false,
          message: `IP address ${ip_address} already used by another router`,
        });
      }

      const router = await RouterService.createRouter(
        {
          name,
          ip_address,
          username,
          password,
          port,
          api_port,
          status,
        },
        adminId
      );

      res.status(201).json({
        success: true,
        message: "Router created successfully",
        data: router,
      });
    } catch (error) {
      // Handle duplicate IP error from database
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(400).json({
          success: false,
          message: "IP address already exists",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get all routers - TAMBAHKAN PARAMETER `all`
  static async getRouters(req, res) {
    try {
      const { all } = req.query;
      const showInactive = all === "true";

      console.log(`📡 Fetching routers - showInactive: ${showInactive}`);

      // Jika ada parameter all=true, gunakan getAllRouters, jika tidak gunakan getRouters biasa
      const routers = showInactive
        ? await RouterService.getAllRouters()
        : await RouterService.getRouters();

      res.json({
        success: true,
        data: routers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get router by ID
  static async getRouter(req, res) {
    try {
      const { id } = req.params;

      const router = await RouterService.getRouterById(id);

      res.json({
        success: true,
        data: router,
      });
    } catch (error) {
      if (error.message === "Router not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update router
  static async updateRouter(req, res) {
    try {
      const { id } = req.params;
      const { name, ip_address, username, password, port, api_port, status } =
        req.body;
      const adminId = req.user.id;

      // Validate required fields
      if (!name || !ip_address || !username) {
        return res.status(400).json({
          success: false,
          message: "Name, IP address, and username are required",
        });
      }

      // Validate IP address format
      const ipPattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
      if (!ipPattern.test(ip_address)) {
        return res.status(400).json({
          success: false,
          message: "Invalid IP address format",
        });
      }

      // Validate port numbers
      const portNum = port ? parseInt(port) : 8728;
      const apiPortNum = api_port ? parseInt(api_port) : 8728;

      if (portNum < 1 || portNum > 65535) {
        return res.status(400).json({
          success: false,
          message: "Port must be between 1 and 65535",
        });
      }

      if (apiPortNum < 1 || apiPortNum > 65535) {
        return res.status(400).json({
          success: false,
          message: "API port must be between 1 and 65535",
        });
      }

      const router = await RouterService.updateRouter(
        id,
        {
          name,
          ip_address,
          username,
          password, // Bisa undefined/kosong
          port: portNum,
          api_port: apiPortNum,
          status: status || "active",
        },
        adminId
      );

      res.json({
        success: true,
        message: "Router updated successfully",
        data: router,
      });
    } catch (error) {
      if (error.message === "Router not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete router (soft delete)
  static async deleteRouter(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      // Check if router has customers
      const [customers] = await db.query(
        'SELECT COUNT(*) as count FROM customers WHERE router_id = ? AND status = "active"',
        [id]
      );

      if (customers[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete router with active customers",
        });
      }

      // Soft delete (update status to inactive)
      await db.query('UPDATE routers SET status = "inactive" WHERE id = ?', [
        id,
      ]);

      // Log activity
      await db.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "delete_router",
          "router",
          id,
          "Router marked as inactive",
          "admin",
          adminId,
        ]
      );

      res.json({
        success: true,
        message: "Router marked as inactive",
      });
    } catch (error) {
      if (error.message === "Router not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Test router connection - VERSI YANG LEBIH SIMPLE
  static async testConnection(req, res) {
    try {
      const { id } = req.params;

      // Get router from database
      const [routers] = await db.query("SELECT * FROM routers WHERE id = ?", [
        id,
      ]);

      if (routers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Router not found",
        });
      }

      const router = routers[0];

      // Simple ping test
      const { exec } = require("child_process");
      const command =
        process.platform === "win32"
          ? `ping -n 2 ${router.ip_address}`
          : `ping -c 2 ${router.ip_address}`;

      exec(command, async (pingError) => {
        if (pingError) {
          // Ping failed
          return res.json({
            success: false,
            message: "Router is not reachable (ping failed)",
            data: {
              router: {
                id: router.id,
                name: router.name,
                ip_address: router.ip_address,
                status: router.status,
              },
              ping_reachable: false,
              api_reachable: false,
              reachable: false,
              error: "Ping failed",
            },
          });
        }

        // Ping successful, try MikroTik API
        try {
          const MikrotikService = require("../services/mikrotik.service");
          const mikrotik = new MikrotikService({
            ip_address: router.ip_address,
            username: router.username,
            password: router.password,
            port: router.port || 8728,
            api_port: router.api_port || 8728,
          });

          // Test dengan method testConnection yang sudah diperbaiki
          const result = await mikrotik.testConnection();

          if (result.success) {
            res.json({
              success: true,
              message: result.message || "MikroTik connection successful",
              data: {
                router: {
                  id: router.id,
                  name: router.name,
                  ip_address: router.ip_address,
                  status: router.status,
                },
                ping_reachable: true,
                api_reachable: true,
                reachable: true,
                system_info: result.data || {},
              },
            });
          } else {
            // API failed
            res.json({
              success: false,
              message: `Router reachable but MikroTik API failed: ${result.message}`,
              data: {
                router: {
                  id: router.id,
                  name: router.name,
                  ip_address: router.ip_address,
                  status: router.status,
                },
                ping_reachable: true,
                api_reachable: false,
                reachable: true,
                error: result.message,
                error_type: result.error_type,
              },
            });
          }
        } catch (mikrotikError) {
          // MikroTik service error
          res.json({
            success: false,
            message: `Router reachable but MikroTik service error: ${mikrotikError.message}`,
            data: {
              router: {
                id: router.id,
                name: router.name,
                ip_address: router.ip_address,
                status: router.status,
              },
              ping_reachable: true,
              api_reachable: false,
              reachable: true,
              error: mikrotikError.message,
            },
          });
        }
      });
    } catch (error) {
      console.error("Test connection error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = RouterController;
