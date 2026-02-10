const db = require("../config/database");
const logger = require("../utils/logger");
const MikrotikTrafficService = require("../services/mikrotik-traffic.service");

class TrafficController {
  // Get active PPPoE sessions
  static async getActiveSessions(req, res) {
    try {
      console.log("👤 Fetching active PPPoE sessions...");

      // Ambil semua router aktif
      const [routers] = await db.query(
        "SELECT * FROM routers WHERE status = 'active'",
      );

      let allSessions = [];

      for (const router of routers) {
        try {
          const trafficService = new MikrotikTrafficService(router);

          // Ambil session dari MikroTik
          const sessions = await trafficService.getPPPoEActiveSessions();

          // Tambahkan info router ke setiap session
          const sessionsWithRouter = sessions.map((session) => ({
            ...session,
            router_id: router.id,
            router_name: router.name,
            router_ip: router.ip_address,
          }));

          allSessions = [...allSessions, ...sessionsWithRouter];
        } catch (routerError) {
          console.error(
            `❌ Failed to get sessions from router ${router.name}:`,
            routerError.message,
          );
          continue;
        }
      }

      // Match dengan data customer di database
      const enhancedSessions =
        await TrafficController.enhanceWithCustomerData(allSessions);

      res.json({
        success: true,
        message: `Found ${enhancedSessions.length} active sessions`,
        data: enhancedSessions,
        count: enhancedSessions.length,
      });
    } catch (error) {
      console.error("❌ Error in getActiveSessions:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch active sessions",
        error: error.message,
      });
    }
  }

  // Match session dengan data customer
  static async enhanceWithCustomerData(sessions) {
    if (sessions.length === 0) return [];

    try {
      // Ambil semua username dari sessions
      const usernames = sessions.map((s) => s.username).filter((u) => u);

      if (usernames.length === 0) {
        return sessions.map((session) => ({
          ...session,
          customer: null,
          is_registered: false,
        }));
      }

      // Query customer data
      const [customers] = await db.query(
        `SELECT c.id, c.name, c.username_pppoe, c.phone, c.status, 
                c.current_usage, c.expired_at, p.name as package_name,
                p.rate_limit, p.quota_bytes
         FROM customers c
         LEFT JOIN packages p ON c.package_id = p.id
         WHERE c.username_pppoe IN (?) AND c.status = 'active'`,
        [usernames],
      );

      // Buat mapping object
      const customerMap = {};
      customers.forEach((customer) => {
        customerMap[customer.username_pppoe] = customer;
      });

      // Gabungkan data
      return sessions.map((session) => {
        const customer = customerMap[session.username] || null;

        return {
          ...session,
          customer: customer
            ? {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                package_name: customer.package_name,
                rate_limit: customer.rate_limit,
                current_usage: customer.current_usage,
                quota_bytes: customer.quota_bytes,
                expired_at: customer.expired_at,
              }
            : null,
          is_registered: !!customer,
        };
      });
    } catch (error) {
      console.error("Error enhancing session data:", error);
      // Return original sessions jika error
      return sessions.map((session) => ({
        ...session,
        customer: null,
        is_registered: false,
      }));
    }
  }

  // Get realtime traffic data
  static async getRealtimeTraffic(req, res) {
    try {
      const [routers] = await db.query(
        "SELECT * FROM routers WHERE status = 'active' LIMIT 1",
      );

      if (routers.length === 0) {
        return res.json({
          success: true,
          data: [],
          message: "No active routers found",
        });
      }

      const router = routers[0];
      const trafficService = new MikrotikTrafficService(router);
      const interfaces = await trafficService.getInterfacesTraffic();

      res.json({
        success: true,
        data: {
          router: {
            id: router.id,
            name: router.name,
            ip_address: router.ip_address,
          },
          interfaces: interfaces,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get customer traffic history
  static async getCustomerTraffic(req, res) {
    try {
      const { customerId } = req.params;
      const { period = "today" } = req.query;

      let dateFilter = "";
      if (period === "today") {
        dateFilter = "AND DATE(logged_at) = CURDATE()";
      } else if (period === "week") {
        dateFilter = "AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
      } else if (period === "month") {
        dateFilter = "AND logged_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
      }

      const [logs] = await db.query(
        `SELECT * FROM traffic_logs 
         WHERE customer_id = ? ${dateFilter}
         ORDER BY logged_at DESC
         LIMIT 100`,
        [customerId],
      );

      res.json({
        success: true,
        data: logs,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get router interface statistics
  static async getRouterTraffic(req, res) {
    try {
      const { routerId } = req.params;
      const { hours = 24 } = req.query;

      const [logs] = await db.query(
        `SELECT 
           interface_name,
           DATE(logged_at) as date,
           HOUR(logged_at) as hour,
           AVG(rx_rate) as avg_rx_rate,
           AVG(tx_rate) as avg_tx_rate,
           MAX(rx_rate) as max_rx_rate,
           MAX(tx_rate) as max_tx_rate,
           SUM(rx_bytes) as total_rx_bytes,
           SUM(tx_bytes) as total_tx_bytes
         FROM traffic_logs 
         WHERE router_id = ? 
           AND logged_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
         GROUP BY interface_name, DATE(logged_at), HOUR(logged_at)
         ORDER BY date DESC, hour DESC`,
        [routerId, hours],
      );

      res.json({
        success: true,
        data: logs,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get traffic summary
  static async getTrafficSummary(req, res) {
    try {
      const [summary] = await db.query(
        `SELECT 
           COUNT(DISTINCT customer_id) as total_customers,
           COUNT(DISTINCT router_id) as total_routers,
           SUM(CASE WHEN DATE(logged_at) = CURDATE() THEN rx_bytes + tx_bytes ELSE 0 END) as today_bytes,
           SUM(CASE WHEN DATE(logged_at) = CURDATE() THEN 1 ELSE 0 END) as today_logs
         FROM traffic_logs 
         WHERE logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      );

      const [topCustomers] = await db.query(
        `SELECT 
           c.name,
           c.username_pppoe,
           SUM(tl.rx_bytes + tl.tx_bytes) as total_bytes
         FROM traffic_logs tl
         JOIN customers c ON tl.customer_id = c.id
         WHERE tl.logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY tl.customer_id
         ORDER BY total_bytes DESC
         LIMIT 10`,
      );

      res.json({
        success: true,
        data: {
          summary: summary[0],
          top_customers: topCustomers,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Set bandwidth limit untuk customer
  static async setBandwidthLimit(req, res) {
    try {
      const { customerId } = req.params;
      const { rate_limit } = req.body;

      if (!rate_limit) {
        return res.status(400).json({
          success: false,
          message: "Rate limit is required",
        });
      }

      // Ambil data customer
      const [customers] = await db.query(
        `SELECT c.*, r.* 
         FROM customers c
         JOIN routers r ON c.router_id = r.id
         WHERE c.id = ?`,
        [customerId],
      );

      if (customers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      const customer = customers[0];

      // Update di MikroTik
      const trafficService = new MikrotikTrafficService(customer);
      await trafficService.updateQueueForCustomer(customer.username_pppoe, {
        speed_limit: rate_limit,
      });

      // Update di database
      await db.query("UPDATE customers SET speed_profile = ? WHERE id = ?", [
        rate_limit,
        customerId,
      ]);

      // Log action
      await db.query(
        `INSERT INTO logs 
         (action, entity, entity_id, description, source, admin_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "set_bandwidth_limit",
          "customer",
          customerId,
          `Bandwidth limit set to ${rate_limit} for customer ${customer.name}`,
          "admin",
          req.user.id,
        ],
      );

      res.json({
        success: true,
        message: `Bandwidth limit updated to ${rate_limit}`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Reset customer usage
  static async resetUsage(req, res) {
    try {
      const { customerId } = req.params;

      await db.query(
        `UPDATE customers 
         SET current_usage = 0, 
             quota_exceeded = 0,
             suspended_at = NULL,
             status = 'active'
         WHERE id = ?`,
        [customerId],
      );

      // Log action
      await db.query(
        `INSERT INTO logs 
         (action, entity, entity_id, description, source, admin_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "reset_usage",
          "customer",
          customerId,
          `Usage reset for customer`,
          "admin",
          req.user.id,
        ],
      );

      res.json({
        success: true,
        message: "Customer usage has been reset",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = TrafficController;
