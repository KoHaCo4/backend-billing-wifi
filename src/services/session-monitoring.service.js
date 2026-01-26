// services/session-monitoring.service.js
const db = require("../config/database");
const MikrotikService = require("./mikrotik.service");

class SessionMonitoringService {
  /**
   * Get active sessions from all routers
   */
  static async getActiveSessionsFromRouters() {
    const connection = await db.getConnection();

    try {
      // Get all active routers
      const [routers] = await connection.query(
        'SELECT * FROM routers WHERE status = "active"',
      );

      console.log(
        `🔄 Checking ${routers.length} active routers for PPPoE sessions`,
      );

      const allSessions = [];
      const routerStatus = [];

      // Check each router
      for (const router of routers) {
        try {
          console.log(
            `🔍 Checking router: ${router.name} (${router.ip_address})`,
          );

          const mikrotik = new MikrotikService({
            ip_address: router.ip_address,
            username: router.username,
            password: router.password,
            api_port: router.api_port || 8728,
          });

          // Try to get sessions with timeout
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Router timeout (10s)")), 10000),
          );

          const sessionsPromise = mikrotik.getActivePPPoESessions();

          const sessions = await Promise.race([
            sessionsPromise,
            timeoutPromise,
          ]);

          // Add router info to each session
          sessions.forEach((session) => {
            session.router_id = router.id;
            session.router_name = router.name;
            session.router_ip = router.ip_address;
            session.checked_at = new Date();
          });

          allSessions.push(...sessions);

          routerStatus.push({
            router_id: router.id,
            router_name: router.name,
            status: "online",
            session_count: sessions.length,
          });

          console.log(
            `✅ Router ${router.name}: ${sessions.length} active sessions`,
          );
        } catch (routerError) {
          console.error(`❌ Router ${router.name} error:`, routerError.message);

          routerStatus.push({
            router_id: router.id,
            router_name: router.name,
            status: "offline",
            error: routerError.message,
          });
        }
      }

      return {
        sessions: allSessions,
        router_status: routerStatus,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Error getting sessions from routers:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get monitoring data (combine with customer info)
   */
  static async getMonitoringData(filter = {}) {
    const connection = await db.getConnection();

    try {
      // Get active sessions from routers
      const routerData = await this.getActiveSessionsFromRouters();
      const activeSessions = routerData.sessions;

      // Get all active customers with their router info
      let customerQuery = `
        SELECT 
          c.id,
          c.name,
          c.username_pppoe,
          c.address,
          c.phone,
          c.status as customer_status,
          c.expired_at,
          r.id as router_id,
          r.name as router_name,
          r.ip_address as router_ip,
          p.name as package_name,
          p.rate_limit,
          p.profile_name,
          DATEDIFF(c.expired_at, CURDATE()) as days_until_expiry
        FROM customers c
        LEFT JOIN routers r ON c.router_id = r.id
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE c.status IN ('active', 'grace_period')
      `;

      const params = [];

      // Apply filters
      if (filter.router_id) {
        customerQuery += " AND c.router_id = ?";
        params.push(filter.router_id);
      }

      if (filter.search) {
        customerQuery +=
          " AND (c.name LIKE ? OR c.username_pppoe LIKE ? OR c.address LIKE ?)";
        const searchTerm = `%${filter.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      customerQuery += " ORDER BY c.name ASC";

      const [customers] = await connection.query(customerQuery, params);

      // Combine customer data with active sessions
      const monitoringData = customers.map((customer) => {
        // Find active session for this customer
        const activeSession = activeSessions.find(
          (session) => session.username === customer.username_pppoe,
        );

        return {
          // Customer info
          customer_id: customer.id,
          customer_name: customer.name,
          username_pppoe: customer.username_pppoe,
          address: customer.address,
          phone: customer.phone,
          customer_status: customer.customer_status,
          expired_at: customer.expired_at,
          days_until_expiry: customer.days_until_expiry,

          // Router & Package info
          router_id: customer.router_id,
          router_name: customer.router_name,
          router_ip: customer.router_ip,
          package_name: customer.package_name,
          rate_limit: customer.rate_limit,
          profile_name: customer.profile_name,

          // Session status
          is_online: !!activeSession,
          last_seen: activeSession?.checked_at || null,

          // Session details (if online)
          remote_address:
            activeSession?.address || activeSession?.remote_address || null,
          caller_id: activeSession?.caller_id || null,
          uptime: activeSession?.uptime || null,
          bytes_in: activeSession?.bytes_in || "0",
          bytes_out: activeSession?.bytes_out || "0",
          session_id: activeSession?.session_id || null,
          checked_at: activeSession?.checked_at || null,
        };
      });

      // Calculate statistics
      const totalCustomers = customers.length;
      const onlineCount = monitoringData.filter((c) => c.is_online).length;
      const offlineCount = totalCustomers - onlineCount;

      // Get unique routers with status
      const routers = monitoringData.reduce((acc, curr) => {
        if (!acc.find((r) => r.router_id === curr.router_id)) {
          acc.push({
            router_id: curr.router_id,
            router_name: curr.router_name,
            router_ip: curr.router_ip,
          });
        }
        return acc;
      }, []);

      return {
        data: monitoringData,
        statistics: {
          total_customers: totalCustomers,
          online: onlineCount,
          offline: offlineCount,
          online_percentage:
            totalCustomers > 0
              ? Math.round((onlineCount / totalCustomers) * 100)
              : 0,
          total_routers: routers.length,
          router_status: routerData.router_status,
        },
        filters: filter,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Error in getMonitoringData:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Format Mikrotik uptime to readable string
   */
  static formatUptime(uptimeStr) {
    if (!uptimeStr || uptimeStr === "0s") return "-";

    try {
      let seconds = 0;

      // Parse Mikrotik format: 1d2h3m4s
      const daysMatch = uptimeStr.match(/(\d+)d/);
      const hoursMatch = uptimeStr.match(/(\d+)h/);
      const minutesMatch = uptimeStr.match(/(\d+)m/);
      const secondsMatch = uptimeStr.match(/(\d+)s/);

      if (daysMatch) seconds += parseInt(daysMatch[1]) * 24 * 60 * 60;
      if (hoursMatch) seconds += parseInt(hoursMatch[1]) * 60 * 60;
      if (minutesMatch) seconds += parseInt(minutesMatch[1]) * 60;
      if (secondsMatch) seconds += parseInt(secondsMatch[1]);

      // Convert to readable format
      const days = Math.floor(seconds / (24 * 60 * 60));
      const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((seconds % (60 * 60)) / 60);
      const secs = seconds % 60;

      if (days > 0) {
        return `${days}h ${hours}j ${minutes}m`;
      } else if (hours > 0) {
        return `${hours}j ${minutes}m ${secs}d`;
      } else if (minutes > 0) {
        return `${minutes}m ${secs}d`;
      } else {
        return `${secs}d`;
      }
    } catch (error) {
      return uptimeStr;
    }
  }

  /**
   * Format bytes to readable format
   */
  static formatBytes(bytesStr) {
    if (!bytesStr || bytesStr === "0") return "0 B";

    try {
      const bytes = parseInt(bytesStr);
      if (isNaN(bytes)) return bytesStr;

      const sizes = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));

      return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    } catch (error) {
      return bytesStr;
    }
  }

  /**
   * Disconnect a customer session
   */
  static async disconnectCustomerSession(customerId) {
    const connection = await db.getConnection();

    try {
      // Get customer details
      const [customers] = await connection.query(
        `SELECT c.*, r.* 
         FROM customers c
         LEFT JOIN routers r ON c.router_id = r.id
         WHERE c.id = ?`,
        [customerId],
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];
      const router = customers[0];

      // Create Mikrotik service
      const mikrotik = new MikrotikService({
        ip_address: router.ip_address,
        username: router.username,
        password: router.password,
        api_port: router.api_port || 8728,
      });

      // Disconnect the session
      const result = await mikrotik.disconnectPPPoESession(
        customer.username_pppoe,
      );

      // Log the action
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "manual_disconnect",
          "customer",
          customerId,
          `Manual disconnect for ${customer.username_pppoe}`,
          "admin",
          1, // system admin
        ],
      );

      return result;
    } catch (error) {
      console.error("❌ Error disconnecting customer session:", error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = SessionMonitoringService;
