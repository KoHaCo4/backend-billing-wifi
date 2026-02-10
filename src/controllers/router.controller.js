const RouterService = require("../services/router.service");
const db = require("../config/database");
const logger = require("../utils/logger");

class RouterController {
  // Create router dengan admin_id
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
        [ip_address],
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
        adminId,
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

  // Get all routers dengan filter multi-user
  static async getRouters(req, res) {
    try {
      const { all } = req.query;
      const showInactive = all === "true";
      const adminId = req.user.id;
      const role = req.user.role;

      console.log(
        `📡 Fetching routers - Admin: ${adminId}, Role: ${role}, showInactive: ${showInactive}`,
      );

      // Jika ada parameter all=true, gunakan getAllRouters, jika tidak gunakan getRouters biasa
      const routers = await RouterService.getRouters(
        showInactive,
        adminId,
        role,
      );

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

  // Get router by ID dengan authorization
  static async getRouter(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      const router = await RouterService.getRouterById(id, adminId, role);

      if (!router) {
        return res.status(404).json({
          success: false,
          message: "Router not found or access denied",
        });
      }

      res.json({
        success: true,
        data: router,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update router dengan authorization
  static async updateRouter(req, res) {
    try {
      const { id } = req.params;
      const { name, ip_address, username, password, port, api_port, status } =
        req.body;
      const adminId = req.user.id;
      const role = req.user.role;

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
          password,
          port: portNum,
          api_port: apiPortNum,
          status: status || "active",
        },
        adminId,
        role,
      );

      res.json({
        success: true,
        message: "Router updated successfully",
        data: router,
      });
    } catch (error) {
      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Router not found or access denied",
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete router (soft delete) dengan authorization
  static async deleteRouter(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      // Check if router has customers
      const [customers] = await db.query(
        'SELECT COUNT(*) as count FROM customers WHERE router_id = ? AND status = "active"',
        [id],
      );

      if (customers[0].count > 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete router with active customers",
        });
      }

      // Cek akses terlebih dahulu
      if (role !== "superadmin") {
        const [routers] = await db.query(
          "SELECT admin_id FROM routers WHERE id = ?",
          [id],
        );

        if (routers.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Router not found",
          });
        }

        if (routers[0].admin_id !== adminId) {
          return res.status(403).json({
            success: false,
            message: "Access denied to delete this router",
          });
        }
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
        ],
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

  // Test router connection dengan authorization
  static async testConnection(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      // Get router with authorization
      const router = await RouterService.getRouterById(id, adminId, role);

      if (!router) {
        return res.status(404).json({
          success: false,
          message: "Router not found or access denied",
        });
      }

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

  // Test all routers yang bisa diakses oleh admin
  static async testAllRouters(req, res) {
    const startTime = Date.now();

    try {
      console.log(
        "🔧 Testing all routers for admin:",
        req.user.id,
        "Role:",
        req.user.role,
      );

      // 1. Get routers yang bisa diakses oleh admin
      let query = `
        SELECT 
          id, 
          name, 
          ip_address, 
          username, 
          password, 
          api_port, 
          port,
          status
        FROM routers 
        WHERE 1=1
      `;

      const params = [];

      // Filter berdasarkan admin jika bukan superadmin
      if (req.user.role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(req.user.id, JSON.stringify([req.user.id]));
      }

      query += " ORDER BY id";

      const [routers] = await db.query(query, params);

      console.log(`Found ${routers.length} routers to test`);

      // 2. Import MikrotikService
      const MikrotikService = require("../services/mikrotik.service");

      const testResults = [];
      let connected = 0;
      let disconnected = 0;
      let errors = 0;

      // 3. Process routers
      for (let i = 0; i < routers.length; i++) {
        const router = routers[i];
        const routerStartTime = Date.now();

        try {
          console.log(
            `[${i + 1}/${routers.length}] Testing router: ${router.name} (${
              router.ip_address
            })`,
          );

          // Validasi data router
          if (!router.ip_address || router.ip_address.trim() === "") {
            throw new Error("IP address is required");
          }

          const ipAddress = router.ip_address.trim();
          const port = router.api_port || router.port || 8728;
          const username = router.username ? router.username.trim() : "admin";
          const password = router.password ? router.password.trim() : "";

          console.log(
            `🌐 Using IP: ${ipAddress}, Port: ${port}, User: ${username}`,
          );

          const mikrotik = new MikrotikService({
            ip_address: ipAddress,
            username: username,
            password: password,
            api_port: port,
            timeout: 10000,
          });

          console.log(`✅ MikrotikService instance created`);

          try {
            // Test connection
            const result = await mikrotik.simpleTestConnection();

            if (result.success) {
              const duration = Date.now() - routerStartTime;

              // Update database
              await db.query(
                "UPDATE routers SET status = 'active', last_check = NOW(), response_time = ?, last_error = NULL, updated_at = NOW() WHERE id = ?",
                [duration, router.id],
              );

              console.log(
                `✅ Router ${router.name}: Connected in ${duration}ms`,
              );

              testResults.push({
                routerId: router.id,
                routerName: router.name,
                ipAddress: ipAddress,
                status: "active",
                message: result.message || `Connected in ${duration}ms`,
                duration,
                timestamp: new Date().toISOString(),
              });

              connected++;
            } else {
              throw new Error(result.message || "Connection failed");
            }
          } catch (connectionError) {
            throw connectionError;
          }
        } catch (error) {
          const duration = Date.now() - routerStartTime;

          // Tentukan status error
          let status = "error";
          let message = `Error: ${error.message}`;

          if (error.message.includes("timeout")) {
            status = "error";
            message = "Connection timeout (10s)";
          } else if (
            error.message.includes("Connection refused") ||
            error.message.includes("ECONNREFUSED") ||
            error.message.includes("ENETUNREACH")
          ) {
            status = "disconnected";
            message = "Connection refused or network unreachable";
          }

          // Update database
          await db.query(
            "UPDATE routers SET status = ?, last_check = NOW(), response_time = ?, last_error = ?, updated_at = NOW() WHERE id = ?",
            [status, duration, message, router.id],
          );

          console.log(`❌ Router ${router.name}: ${message}`);

          if (status === "disconnected") {
            disconnected++;
          } else {
            errors++;
          }

          testResults.push({
            routerId: router.id,
            routerName: router.name,
            ipAddress: router.ip_address || "",
            status: status,
            message: message,
            error: error.message,
            duration,
            timestamp: new Date().toISOString(),
          });
        }

        // Delay antar router
        if (i < routers.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // 4. Calculate results
      const successRate =
        routers.length > 0 ? Math.round((connected / routers.length) * 100) : 0;
      const totalDuration = Date.now() - startTime;

      console.log(`✅ Test complete (${totalDuration}ms):`);
      console.log(`   Total: ${routers.length}`);
      console.log(`   Connected: ${connected}`);
      console.log(`   Disconnected: ${disconnected}`);
      console.log(`   Errors: ${errors}`);
      console.log(`   Success Rate: ${successRate}%`);

      // 5. Return response
      res.json({
        success: true,
        message: `Test completed in ${totalDuration}ms`,
        summary: {
          total: routers.length,
          connected,
          disconnected,
          errors,
          success_rate: successRate,
          total_duration: totalDuration,
        },
        results: testResults,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("🔥 Error in testAllRouters:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test routers",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Share router dengan admin lain
  static async shareRouter(req, res) {
    try {
      const { id } = req.params;
      const { admin_ids } = req.body;
      const adminId = req.user.id;
      const role = req.user.role;

      if (!Array.isArray(admin_ids)) {
        return res.status(400).json({
          success: false,
          message: "admin_ids harus berupa array",
        });
      }

      // Hanya superadmin atau pemilik router yang bisa share
      if (role !== "superadmin") {
        // Cek apakah router milik admin ini
        const [routers] = await db.query(
          "SELECT admin_id FROM routers WHERE id = ?",
          [id],
        );

        if (routers.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Router not found",
          });
        }

        if (routers[0].admin_id !== adminId) {
          return res.status(403).json({
            success: false,
            message: "You can only share your own routers",
          });
        }
      }

      // Filter out current admin
      const filteredAdminIds = admin_ids.filter(
        (targetId) => targetId !== adminId,
      );

      // Update sharing
      const isShared = filteredAdminIds.length > 0;
      const sharedWithJson = isShared ? JSON.stringify(filteredAdminIds) : null;

      await db.query(
        `UPDATE routers 
         SET is_shared = ?, shared_with = ?, updated_at = NOW() 
         WHERE id = ?`,
        [isShared ? 1 : 0, sharedWithJson, id],
      );

      res.json({
        success: true,
        message: "Router shared successfully",
        data: {
          router_id: id,
          is_shared: isShared,
          shared_with: filteredAdminIds,
        },
      });
    } catch (error) {
      console.error("Share router error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = RouterController;
