const { RouterOSAPI } = require("node-routeros");
const logger = require("../utils/logger");

class MikrotikService {
  constructor(config) {
    // ✅ VALIDASI LENGKAP
    if (!config) {
      throw new Error("MikroTik configuration is required");
    }

    if (!config.ip_address) {
      throw new Error("MikroTik IP address is required");
    }

    this.config = {
      ip_address: config.ip_address,
      username: config.username || "admin",
      password: config.password || "",
      api_port: config.api_port || 8728,
      timeout: config.timeout || 5000,
    };

    this.client = null;
    console.log(`🔧 MikroTikService initialized for ${this.config.ip_address}`);
  }

  /**
   * ✅ CONNECT METHOD YANG BENAR - Return client instance
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.client = new RouterOSAPI({
          host: this.config.ip_address,
          user: this.config.username,
          password: this.config.password,
          port: this.config.api_port,
          timeout: this.config.timeout,
        });

        // Handle error events
        this.client.on("error", (error) => {
          console.warn(`⚠️ MikroTik connection error: ${error.message}`);
          reject(error);
        });

        this.client.on("timeout", () => {
          const error = new Error(
            `Connection timeout to ${this.config.ip_address}`,
          );
          console.warn(`⚠️ ${error.message}`);
          reject(error);
        });

        // Connect
        this.client
          .connect()
          .then(() => {
            console.log(`✅ Connected to MikroTik: ${this.config.ip_address}`);
            resolve(this.client);
          })
          .catch((error) => {
            console.warn(`❌ Connection failed: ${error.message}`);
            reject(error);
          });
      } catch (error) {
        console.error(`❌ Failed to create MikroTik client: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * ✅ TEST CONNECTION METHOD YANG BENAR - Tidak pakai client.write langsung
   */
  async testConnection() {
    console.log(
      `🔄 Testing MikroTik connection to ${this.config.ip_address}...`,
    );

    try {
      const connected = await this.connect();

      if (!connected) {
        return {
          success: false,
          message: "Failed to connect to router",
          router_ip: this.config.ip_address,
        };
      }

      // Test dengan command yang lebih sederhana
      try {
        await this.client.write("/system/identity/print");

        this.close();

        return {
          success: true,
          message: "Connected successfully",
          router_ip: this.config.ip_address,
          identity: "MikroTik Router",
        };
      } catch (apiError) {
        this.close();
        return {
          success: false,
          message: `API error: ${apiError.message}`,
          router_ip: this.config.ip_address,
        };
      }
    } catch (error) {
      console.error(`❌ Connection test failed: ${error.message}`);
      return {
        success: false,
        message: `Connection failed: ${error.message}`,
        router_ip: this.config.ip_address,
      };
    }
  }

  /**
   * ✅ SIMPLE CONNECTION CHECK (untuk UI test)
   */
  async simpleTestConnection() {
    console.log(`🧪 Simple test connection to ${this.config.ip_address}`);

    try {
      // Coba koneksi dengan timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Connection timeout after 5s")),
          5000,
        );
      });

      const connectPromise = new Promise(async (resolve, reject) => {
        try {
          const client = new RouterOSAPI({
            host: this.config.ip_address,
            user: this.config.username,
            password: this.config.password,
            port: this.config.api_port,
            timeout: 5000,
          });

          client.on("error", reject);
          client.on("timeout", () => reject(new Error("Timeout")));

          await client.connect();

          // Quick test
          await client.write("/system/identity/print");

          client.close();
          resolve(true);
        } catch (error) {
          reject(error);
        }
      });

      await Promise.race([connectPromise, timeoutPromise]);

      return {
        success: true,
        message: "Router reachable and API working",
        router_ip: this.config.ip_address,
      };
    } catch (error) {
      return {
        success: false,
        message: `Router reachable but MikroTik API failed: ${error.message}`,
        router_ip: this.config.ip_address,
        error_type: error.message.includes("timeout")
          ? "timeout"
          : "connection",
      };
    }
  }

  async disconnect() {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }

  // Get system resource information - TAMBAHKAN METHOD INI
  async getSystemResource() {
    let client = null;
    try {
      client = await this.connect();

      // Get system resource info
      const resource = await client.write("/system/resource/print");

      // Get system identity
      const identity = await client.write("/system/identity/print");

      // Get system package info
      const packageInfo = await client.write("/system/package/print");

      await this.disconnect();

      if (resource && resource.length > 0) {
        return {
          board_name:
            resource[0]["board-name"] || resource[0].board || "Unknown",
          version: resource[0].version || "Unknown",
          uptime: resource[0].uptime || "Unknown",
          cpu_load: resource[0]["cpu-load"] || "Unknown",
          free_memory: parseInt(resource[0]["free-memory"]) || 0,
          total_memory: parseInt(resource[0]["total-memory"]) || 0,
          free_memory_mb: Math.round(
            (parseInt(resource[0]["free-memory"]) || 0) / 1024 / 1024,
          ),
          total_memory_mb: Math.round(
            (parseInt(resource[0]["total-memory"]) || 0) / 1024 / 1024,
          ),
          memory_usage: resource[0]["memory-usage"] || "Unknown",
          architecture_name: resource[0]["architecture-name"] || "Unknown",
          platform: resource[0].platform || "Unknown",
          identity:
            identity && identity.length > 0 ? identity[0].name : "Unknown",
          packages: packageInfo?.map((pkg) => pkg.name) || [],
        };
      }

      return {};
    } catch (error) {
      console.error(`❌ Failed to get system resource: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Get simple system info (alternative)
  async getSystemInfo() {
    let client = null;
    try {
      client = await this.connect();

      // Get basic info
      const resource = await client.write("/system/resource/print");
      const identity = await client.write("/system/identity/print");

      await this.disconnect();

      return {
        success: true,
        data: {
          identity: identity?.[0]?.name || "Unknown",
          board:
            resource?.[0]?.["board-name"] || resource?.[0]?.board || "Unknown",
          version: resource?.[0]?.version || "Unknown",
          uptime: resource?.[0]?.uptime || "Unknown",
        },
      };
    } catch (error) {
      console.error(`❌ Failed to get system info: ${error.message}`);
      return {
        success: false,
        message: error.message,
      };
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Test connection dengan lebih banyak detail
  async testConnection() {
    try {
      const client = await this.connect();

      // Test multiple commands
      const resource = await client.write("/system/resource/print");
      const identity = await client.write("/system/identity/print");

      await this.disconnect();

      return {
        success: true,
        message: "MikroTik connection successful",
        data: {
          identity: identity?.[0]?.name || "Unknown",
          board:
            resource?.[0]?.["board-name"] || resource?.[0]?.board || "Unknown",
          version: resource?.[0]?.version || "Unknown",
        },
      };
    } catch (error) {
      console.error(`❌ Connection test failed: ${error.message}`);

      // Categorize error
      let errorType = "unknown";
      if (error.message.includes("login failure")) {
        errorType = "auth";
      } else if (error.message.includes("connect")) {
        errorType = "network";
      } else if (error.message.includes("timeout")) {
        errorType = "timeout";
      }

      return {
        success: false,
        message: `Connection failed: ${error.message}`,
        error_type: errorType,
      };
    }
  }

  static async testAllRouters(req, res) {
    try {
      console.log("🔧 POST /routers/test-all - Testing all routers");

      // Get all routers from database
      const [routers] = await db.query(`
      SELECT id, name, ip_address, host, username, password, api_port, status 
      FROM routers 
      WHERE deleted_at IS NULL
      ORDER BY status DESC, name
    `);

      if (routers.length === 0) {
        return res.json({
          success: true,
          message: "No routers found in database",
          data: [],
          stats: {
            total: 0,
            connected: 0,
            disconnected: 0,
            errors: 0,
          },
        });
      }

      console.log(`Found ${routers.length} routers to test`);

      const testResults = [];
      let connectedCount = 0;
      let errorCount = 0;

      // Test each router sequentially (untuk menghindari overload)
      for (const router of routers) {
        try {
          console.log(
            `Testing router: ${router.name} (${
              router.ip_address || router.host
            })`,
          );

          const startTime = Date.now();

          // Gunakan MikrotikService
          const MikrotikService = require("../services/mikrotik.service");

          // Gunakan ip_address jika ada, jika tidak gunakan host
          const routerIp = router.ip_address || router.host;

          if (!routerIp) {
            testResults.push({
              routerId: router.id,
              routerName: router.name,
              ipAddress: "N/A",
              status: "error",
              message: "Router IP/host not configured",
              duration: 0,
              timestamp: new Date().toISOString(),
            });
            errorCount++;
            continue;
          }

          const mikrotik = new MikrotikService({
            ip_address: routerIp,
            username: router.username,
            password: router.password,
            api_port: router.api_port || 8728,
            timeout: 8000,
          });

          // Test connection dengan timeout handling
          const testPromise = mikrotik.testConnection();

          // Add timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Connection timeout (8s)")),
              8000,
            );
          });

          const result = await Promise.race([testPromise, timeoutPromise]);
          const duration = Date.now() - startTime;

          if (result.success) {
            connectedCount++;

            testResults.push({
              routerId: router.id,
              routerName: router.name,
              ipAddress: routerIp,
              status: "connected",
              message: result.message || "Connection successful",
              duration: duration,
              systemInfo: result.data || {},
              timestamp: new Date().toISOString(),
            });

            // Update status di database
            await db.query(
              "UPDATE routers SET status = 'active', last_check = NOW() WHERE id = ?",
              [router.id],
            );

            console.log(`✅ Router ${router.name}: Connected in ${duration}ms`);
          } else {
            testResults.push({
              routerId: router.id,
              routerName: router.name,
              ipAddress: routerIp,
              status: "disconnected",
              message: result.message || "Connection failed",
              error: result.error_type,
              duration: duration,
              timestamp: new Date().toISOString(),
            });

            // Update status di database
            await db.query(
              "UPDATE routers SET status = 'inactive', last_check = NOW() WHERE id = ?",
              [router.id],
            );

            console.log(`❌ Router ${router.name}: Failed - ${result.message}`);
          }
        } catch (error) {
          errorCount++;
          const duration = Date.now() - startTime;

          console.error(
            `❌ Error testing router ${router.name}:`,
            error.message,
          );

          testResults.push({
            routerId: router.id,
            routerName: router.name,
            ipAddress: router.ip_address || router.host || "N/A",
            status: "error",
            message: `Error: ${error.message}`,
            error: error.message,
            duration: duration,
            timestamp: new Date().toISOString(),
          });

          // Update status ke error
          await db.query(
            "UPDATE routers SET status = 'error', last_check = NOW() WHERE id = ?",
            [router.id],
          );
        }
      }

      // Hitung statistik
      const disconnectedCount = testResults.filter(
        (r) => r.status === "disconnected",
      ).length;
      const totalCount = routers.length;

      res.json({
        success: true,
        message: `Test completed for ${totalCount} routers`,
        data: {
          results: testResults,
          summary: {
            total: totalCount,
            connected: connectedCount,
            disconnected: disconnectedCount,
            errors: errorCount,
            successRate:
              totalCount > 0
                ? Math.round((connectedCount / totalCount) * 100)
                : 0,
          },
        },
      });

      console.log(
        `✅ Test complete: ${connectedCount}/${totalCount} connected (${errorCount} errors)`,
      );
    } catch (error) {
      console.error("❌ Error testing all routers:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test routers",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // Create PPPoE user
  async createPPPoEUser(username, password, profile = "default", comment = "") {
    let client = null;

    try {
      client = await this.connect();

      if (!client) {
        throw new Error("Failed to connect to router");
      }

      // Check if user already exists
      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length > 0) {
        // Update existing user
        await client.write("/ppp/secret/set", [
          `=.id=${users[0][".id"]}`,
          `=password=${password}`,
          `=profile=${profile}`,
          `=comment=${comment}`,
          "=disabled=no",
        ]);
        return { success: true, message: "PPPoE user updated" };
      }

      // Create new user
      await client.write("/ppp/secret/add", [
        `=name=${username}`,
        `=password=${password}`,
        "=service=pppoe",
        `=profile=${profile}`,
        `=comment=${comment}`,
        "=disabled=no",
      ]);

      console.log(`✅ PPPoE user created: ${username}`);
      return { success: true, message: "PPPoE user created" };
    } catch (error) {
      console.error(`❌ Failed to create PPPoE user: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        client.close();
      }
    }
  }

  // backend/src/services/mikrotik.service.js - Tambah method
  async getAllPPPoEUsers() {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print");

      const formattedUsers = users.map((user) => ({
        id: user[".id"],
        name: user.name,
        service: user.service,
        profile: user.profile,
        comment: user.comment || "",
        disabled: user.disabled === "true",
        last_logged_out: user["last-logged-out"] || null,
      }));

      console.log(`✅ Found ${formattedUsers.length} PPPoE users`);
      return formattedUsers;
    } catch (error) {
      console.error(`❌ Failed to get PPPoE users: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }
  // Update PPPoE username (rename user)
  async updatePPPoEUsername(oldUsername, newUsername) {
    let client = null;
    try {
      client = await this.connect();

      // Check if old user exists
      const oldUsers = await client.write("/ppp/secret/print", [
        `?name=${oldUsername}`,
      ]);

      if (oldUsers.length === 0) {
        console.log(`PPPoE user ${oldUsername} not found`);
        return { success: false, message: "User not found" };
      }

      // Check if new username already exists
      const newUsers = await client.write("/ppp/secret/print", [
        `?name=${newUsername}`,
      ]);

      if (newUsers.length > 0) {
        console.log(`PPPoE user ${newUsername} already exists`);
        return { success: false, message: "New username already exists" };
      }

      const userId = oldUsers[0][".id"];

      // Get existing user data
      const existingUser = oldUsers[0];

      // Create new user with same settings but new username
      await client.write("/ppp/secret/add", [
        `=name=${newUsername}`,
        `=password=${existingUser.password}`,
        `=service=${existingUser.service || "pppoe"}`,
        `=profile=${existingUser.profile || "default"}`,
        `=comment=${existingUser.comment || ""}`,
        `=disabled=${existingUser.disabled === "true" ? "yes" : "no"}`,
      ]);

      // Remove old user
      await client.write("/ppp/secret/remove", [`=.id=${userId}`]);

      console.log(
        `✅ PPPoE username updated: ${oldUsername} -> ${newUsername}`,
      );
      return { success: true, message: "PPPoE username updated" };
    } catch (error) {
      console.error(`❌ Failed to update PPPoE username: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Update PPPoE password
  async updatePPPoEPassword(username, newPassword) {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        console.log(`PPPoE user ${username} not found`);
        return { success: false, message: "User not found" };
      }

      const userId = users[0][".id"];

      await client.write("/ppp/secret/set", [
        `=.id=${userId}`,
        `=password=${newPassword}`,
      ]);

      console.log(`✅ PPPoE password updated for user: ${username}`);
      return { success: true, message: "PPPoE password updated" };
    } catch (error) {
      console.error(`❌ Failed to update PPPoE password: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Alternative: Update user with all fields at once
  async updatePPPoEUser(username, updates) {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        console.log(`PPPoE user ${username} not found`);
        return { success: false, message: "User not found" };
      }

      const userId = users[0][".id"];
      const params = [`=.id=${userId}`];

      if (updates.password !== undefined) {
        params.push(`=password=${updates.password}`);
      }
      if (updates.profile !== undefined) {
        params.push(`=profile=${updates.profile}`);
      }
      if (updates.comment !== undefined) {
        params.push(`=comment=${updates.comment}`);
      }
      if (updates.disabled !== undefined) {
        params.push(`=disabled=${updates.disabled ? "yes" : "no"}`);
      }

      if (params.length > 1) {
        // If there's more than just .id
        await client.write("/ppp/secret/set", params);
        console.log(`✅ PPPoE user updated: ${username}`);
        return { success: true, message: "PPPoE user updated" };
      }

      return { success: false, message: "No updates provided" };
    } catch (error) {
      console.error(`❌ Failed to update PPPoE user: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Get PPPoE active sessions
  async getPPPoEActiveSessions() {
    let client = null;
    try {
      client = await this.connect();

      // Get active PPPoE sessions
      const active = await client.write("/ppp/active/print");

      const sessions = active.map((session) => ({
        username: session.name,
        address: session.address,
        uptime: session.uptime,
        service: session.service,
        caller_id: session["caller-id"] || null,
      }));

      console.log(`✅ Found ${sessions.length} active PPPoE sessions`);
      return { success: true, data: sessions };
    } catch (error) {
      console.error(`❌ Failed to get PPPoE active sessions: ${error.message}`);
      return { success: false, message: error.message };
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Remove PPPoE user
  // backend/src/services/mikrotik.service.js - Tambah method removePPPoEUser
  async removePPPoEUser(username) {
    let client = null;
    try {
      client = await this.connect();

      // Find user
      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        console.log(`PPPoE user ${username} not found in MikroTik`);
        return { success: false, message: "User not found in MikroTik" };
      }

      const userId = users[0][".id"];

      // Disable first (optional)
      await client.write("/ppp/secret/set", [
        `=.id=${userId}`,
        "=disabled=yes",
      ]);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Remove user
      await client.write("/ppp/secret/remove", [`=.id=${userId}`]);

      console.log(`✅ PPPoE user removed from MikroTik: ${username}`);
      return { success: true, message: "PPPoE user removed from MikroTik" };
    } catch (error) {
      console.error(
        `❌ Failed to remove PPPoE user from MikroTik: ${error.message}`,
      );
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Disable PPPoE user
  async disablePPPoEUser(username) {
    let client = null;

    try {
      client = await this.connect();

      if (!client) {
        return {
          success: false,
          message: "Router offline, cannot disable PPPoE",
          username: username,
          router_ip: this.config.ip_address,
        };
      }

      // Find user
      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        return {
          success: false,
          message: `PPPoE user '${username}' not found on router`,
          username: username,
          router_ip: this.config.ip_address,
        };
      }

      // Disable user
      await client.write("/ppp/secret/set", [
        `=.id=${users[0][".id"]}`,
        "=disabled=yes",
      ]);

      return {
        success: true,
        message: `PPPoE user '${username}' disabled`,
        username: username,
        router_ip: this.config.ip_address,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to disable: ${error.message}`,
        username: username,
        router_ip: this.config.ip_address,
      };
    } finally {
      if (client) {
        client.close();
      }
    }
  }

  // Enable PPPoE user
  async enablePPPoEUser(username) {
    let client = null;

    try {
      client = await this.connect();

      if (!client) {
        return {
          success: false,
          message: "Router offline, cannot enable PPPoE",
          username: username,
          router_ip: this.config.ip_address,
        };
      }

      // Find user
      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        return {
          success: false,
          message: `PPPoE user '${username}' not found on router`,
          username: username,
          router_ip: this.config.ip_address,
        };
      }

      // Enable user
      await client.write("/ppp/secret/set", [
        `=.id=${users[0][".id"]}`,
        "=disabled=no",
      ]);

      return {
        success: true,
        message: `PPPoE user '${username}' enabled`,
        username: username,
        router_ip: this.config.ip_address,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to enable: ${error.message}`,
        username: username,
        router_ip: this.config.ip_address,
      };
    } finally {
      if (client) {
        client.close();
      }
    }
  }

  close() {
    if (this.client) {
      try {
        this.client.close();
      } catch (error) {
        console.warn("Error closing MikroTik connection:", error.message);
      }
      this.client = null;
    }
  }

  // Update PPPoE user comment (expiration date)
  async updatePPPoEUserComment(username, comment) {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        console.log(`PPPoE user ${username} not found`);
        return { success: false, message: "User not found" };
      }

      const userId = users[0][".id"];

      await client.write("/ppp/secret/set", [
        `=.id=${userId}`,
        `=comment=${comment}`,
      ]);

      console.log(`✅ PPPoE user comment updated: ${username} -> ${comment}`);
      return { success: true, message: "PPPoE user comment updated" };
    } catch (error) {
      console.error(`❌ Failed to update PPPoE user comment: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Check if user exists
  async checkPPPoEUserExists(username) {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      return users.length > 0;
    } catch (error) {
      console.error(`❌ Failed to check PPPoE user: ${error.message}`);
      return false;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Create PPPoE profile if not exists
  // mikrotik.service.js - Optimize with better timeout
  async createPPPoEProfile(profileName, rateLimit = "10M/10M") {
    let client = null;

    try {
      // Connect dengan timeout 8 detik
      client = await this.connectWithTimeout(8000);

      // Cek apakah profil sudah ada - dengan timeout 3 detik
      const checkPromise = client.write("/ppp/profile/print", [
        `?name=${profileName}`,
      ]);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout checking profile")), 3000),
      );

      const profiles = await Promise.race([checkPromise, timeoutPromise]);

      if (profiles.length > 0) {
        console.log(`PPPoE profile ${profileName} already exists`);
        return {
          success: true,
          message: "Profile already exists",
          exists: true,
        };
      }

      // Buat profil baru - dengan timeout 5 detik
      const createPromise = client.write("/ppp/profile/add", [
        `=name=${profileName}`,
        `=rate-limit=${rateLimit}`,
        "=local-address=10.0.0.1",
        "=remote-address=pppoe",
        "=only-one=yes",
        "=change-tcp-mss=yes",
      ]);

      const createTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout creating profile")), 5000),
      );

      await Promise.race([createPromise, createTimeout]);

      console.log(`✅ PPPoE profile created: ${profileName}`);
      return {
        success: true,
        message: "PPPoE profile created",
        created: true,
      };
    } catch (error) {
      console.error(`❌ Failed to create PPPoE profile: ${error.message}`);
      throw new Error(`Mikrotik error: ${error.message}`);
    } finally {
      if (client) {
        try {
          await client.close();
        } catch (closeError) {
          console.warn("Failed to close connection:", closeError.message);
        }
      }
    }
  }

  // Helper untuk connect dengan timeout
  async connectWithTimeout(timeout = 8000) {
    const { MikrotikApi } = require("mikrotik-api");

    const client = new MikrotikApi({
      host: this.config.ip_address,
      username: this.config.username,
      password: this.config.password,
      port: this.config.api_port || 8728,
      timeout: timeout,
    });

    // Buat promise untuk connect dengan timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Connection timeout after ${timeout}ms`)),
        timeout,
      ),
    );

    await Promise.race([connectPromise, timeoutPromise]);
    return client;
  }

  // Update PPPoE profile rate limit
  async updatePPPoEProfile(profileName, rateLimit) {
    let client = null;
    try {
      client = await this.connect();

      // Cek apakah profile ada
      const profiles = await client.write("/ppp/profile/print", [
        `?name=${profileName}`,
      ]);

      if (profiles.length === 0) {
        throw new Error(`PPPoE profile ${profileName} not found`);
      }

      // Update profile
      await client.write("/ppp/profile/set", [
        `=.id=${profiles[0][".id"]}`,
        `=rate-limit=${rateLimit}`,
      ]);

      console.log(`✅ PPPoE profile updated: ${profileName} -> ${rateLimit}`);
      return { success: true, message: "PPPoE profile updated" };
    } catch (error) {
      console.error(`❌ Failed to update PPPoE profile: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  // Delete PPPoE profile
  async deletePPPoEProfile(profileName) {
    let client = null;
    try {
      client = await this.connect();

      // Check if profile exists
      const profiles = await client.write("/ppp/profile/print", [
        `?name=${profileName}`,
      ]);

      if (profiles.length === 0) {
        console.log(`PPPoE profile ${profileName} not found, skipping delete`);
        return {
          success: true,
          message: "Profile not found, already deleted or never existed",
        };
      }

      // Delete profile
      await client.write("/ppp/profile/remove", [`=.id=${profiles[0][".id"]}`]);

      console.log(`✅ PPPoE profile deleted: ${profileName}`);
      return {
        success: true,
        message: "PPPoE profile deleted successfully",
      };
    } catch (error) {
      console.error(`❌ Failed to delete PPPoE profile: ${error.message}`);
      throw error;
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }

  //  Tambah method untuk debugging
  async getPPPoEUserDetails(username) {
    let client = null;
    try {
      client = await this.connect();

      const users = await client.write("/ppp/secret/print", [
        `?name=${username}`,
      ]);

      if (users.length === 0) {
        return { success: false, message: "User not found" };
      }

      const user = users[0];

      // Get active session if any
      const activeSessions = await client.write("/ppp/active/print", [
        `?name=${username}`,
      ]);

      return {
        success: true,
        data: {
          id: user[".id"],
          name: user.name,
          service: user.service,
          profile: user.profile,
          comment: user.comment,
          disabled: user.disabled === "true",
          last_logged_out: user["last-logged-out"] || null,
          last_caller_id: user["caller-id"] || null,
          active_session:
            activeSessions.length > 0
              ? {
                  address: activeSessions[0].address,
                  uptime: activeSessions[0].uptime,
                  caller_id: activeSessions[0]["caller-id"] || null,
                }
              : null,
        },
      };
    } catch (error) {
      console.error(`❌ Failed to get PPPoE user details: ${error.message}`);
      return { success: false, message: error.message };
    } finally {
      if (client) {
        await this.disconnect();
      }
    }
  }
}

module.exports = MikrotikService;
