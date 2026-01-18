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

  // Test all routers
  static async testAllRouters(req, res) {
    const startTime = Date.now();

    try {
      console.log("🔧 Testing all routers...");

      // 1. Get all routers from database
      const [routers] = await db.query(`
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
        ORDER BY id
      `);

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
            })`
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
            `🌐 Using IP: ${ipAddress}, Port: ${port}, User: ${username}`
          );

          // 🔥 PERBAIKAN DI SINI: Gunakan objek config, bukan parameter terpisah
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
            const timeout = 10000;

            // Gunakan simpleTestConnection atau testConnection
            const result = await mikrotik.simpleTestConnection();

            if (result.success) {
              const duration = Date.now() - routerStartTime;

              // Update database
              await db.query(
                "UPDATE routers SET status = 'active', last_check = NOW(), response_time = ?, last_error = NULL, updated_at = NOW() WHERE id = ?",
                [duration, router.id]
              );

              console.log(
                `✅ Router ${router.name}: Connected in ${duration}ms`
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
            [status, duration, message, router.id]
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

  // Versi alternatif: Test dengan timeout dan progress
  static async testAllRoutersWithProgress(req, res) {
    try {
      console.log("🔧 Testing all routers (with progress)...");

      const [routers] = await db.query(`
      SELECT id, name, ip_address, host, username, password, api_port, status 
      FROM routers 
      WHERE status IN ('active', 'inactive')
      ORDER BY name
    `);

      if (routers.length === 0) {
        return res.json({
          success: true,
          message: "No routers found",
          data: [],
        });
      }

      // Kirim response awal dengan progress
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (progress, current, total, result = null) => {
        const data = {
          progress: progress,
          current: current,
          total: total,
          result: result,
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const testResults = [];

      for (let i = 0; i < routers.length; i++) {
        const router = routers[i];
        const routerIp = router.ip_address || router.host;

        sendProgress(
          Math.round((i / routers.length) * 100),
          i + 1,
          routers.length,
          {
            routerName: router.name,
            status: "testing",
            message: "Testing connection...",
          }
        );

        try {
          const MikrotikService = require("../services/mikrotik.service");
          const mikrotik = new MikrotikService({
            ip_address: routerIp,
            username: router.username,
            password: router.password,
            api_port: router.api_port || 8728,
            timeout: 5000,
          });

          const result = await mikrotik.testConnection();

          const testResult = {
            routerId: router.id,
            routerName: router.name,
            ipAddress: routerIp,
            success: result.success,
            message: result.message,
            data: result.data,
          };

          testResults.push(testResult);

          sendProgress(
            Math.round(((i + 1) / routers.length) * 100),
            i + 1,
            routers.length,
            testResult
          );

          // Update database
          const status = result.success ? "active" : "inactive";
          await db.query("UPDATE routers SET status = ? WHERE id = ?", [
            status,
            router.id,
          ]);
        } catch (error) {
          const errorResult = {
            routerId: router.id,
            routerName: router.name,
            ipAddress: routerIp,
            success: false,
            message: error.message,
            error: error.message,
          };

          testResults.push(errorResult);

          sendProgress(
            Math.round(((i + 1) / routers.length) * 100),
            i + 1,
            routers.length,
            errorResult
          );

          await db.query("UPDATE routers SET status = 'error' WHERE id = ?", [
            router.id,
          ]);
        }

        // Delay kecil
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Send final result
      const finalData = {
        completed: true,
        results: testResults,
        summary: {
          total: routers.length,
          connected: testResults.filter((r) => r.success).length,
          failed: testResults.filter((r) => !r.success).length,
        },
      };

      res.write(`data: ${JSON.stringify(finalData)}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in progress test:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
}

module.exports = RouterController;
