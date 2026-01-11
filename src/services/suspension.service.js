// src/services/suspension.service.js - PERBAIKAN LENGKAP
const pool = require("../config/database");
const MikrotikService = require("./mikrotik.service");
const MikrotikSafe = require("../utils/mikrotikSafe");

class SuspensionService {
  /**
   * Auto suspend expired customers - FIXED VERSION
   */
  static async autoSuspendExpiredCustomers() {
    console.log("🚀 Starting auto-suspend job...");

    const today = new Date();
    const GRACE_PERIOD_DAYS = parseInt(process.env.GRACE_PERIOD_DAYS) || 3;
    const SUSPEND_WITH_PENDING_INVOICES =
      process.env.SUSPEND_WITH_PENDING_INVOICES === "true";

    console.log(`📅 Today: ${today.toISOString().split("T")[0]}`);
    console.log(`📅 Grace period: ${GRACE_PERIOD_DAYS} days`);
    console.log(
      `💰 Suspend with pending invoices: ${SUSPEND_WITH_PENDING_INVOICES}`
    );

    // ✅ PERBAIKAN: Grace deadline HARUS dikurangi grace period
    const graceDeadline = new Date(today);
    graceDeadline.setDate(graceDeadline.getDate() - GRACE_PERIOD_DAYS);

    const connection = await pool.getConnection();

    try {
      const [expiredCustomers] = await connection.query(
        `
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        c.username_pppoe,
        c.password_pppoe,
        c.router_id,
        c.package_id,
        c.expired_at,
        c.status AS customer_status,
        c.auto_renew,
        r.id AS router_id,
        r.name AS router_name,
        r.ip_address,
        r.username AS router_username,
        r.password AS router_password,
        r.port,
        r.api_port,
        r.status AS router_status,
        (SELECT COUNT(*) FROM invoices i 
         WHERE i.customer_id = c.id 
         AND i.status IN ('pending', 'overdue')) as pending_invoices
      FROM customers c
      JOIN routers r ON c.router_id = r.id
      WHERE c.status = 'active'
      AND DATE(c.expired_at) <= DATE(?)
      ORDER BY c.expired_at ASC
      `,
        [graceDeadline.toISOString().split("T")[0]]
      );

      console.log(
        `🔍 Found ${expiredCustomers.length} expired customers (beyond grace period)`
      );

      let results = {
        total: expiredCustomers.length,
        suspended: 0,
        failed: 0,
        skipped: 0,
        customers: [],
      };

      for (const customer of expiredCustomers) {
        try {
          const daysOverdue = Math.floor(
            (today - new Date(customer.expired_at)) / (1000 * 60 * 60 * 24)
          );

          console.log(
            `\n🔧 Processing: ${customer.customer_name} (ID: ${customer.customer_id})`
          );
          console.log(`   Username: ${customer.username_pppoe}`);
          console.log(
            `   Expired: ${customer.expired_at} (${daysOverdue} days ago)`
          );
          console.log(`   Pending invoices: ${customer.pending_invoices}`);

          // ✅ PERBAIKAN KRITIS: BUSINESS LOGIC DECISION
          if (customer.pending_invoices > 0 && !SUSPEND_WITH_PENDING_INVOICES) {
            console.log(
              `⏭️ Skipping - has ${customer.pending_invoices} pending invoice(s)`
            );

            await connection.query(
              `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
               VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
              [
                "auto_suspend_skipped",
                "customer",
                customer.customer_id,
                `Customer ${customer.customer_name} skipped - has ${customer.pending_invoices} pending invoice(s)`,
                "system",
              ]
            );

            results.skipped++;
            results.customers.push({
              id: customer.customer_id,
              username: customer.username_pppoe,
              status: "skipped",
              reason: "Pending invoice",
            });
            continue;
          } else if (customer.pending_invoices > 0) {
            console.log(
              `⚠️ Warning: Customer has ${customer.pending_invoices} pending invoice(s) but will be suspended anyway`
            );
          }

          // Handle MikroTik
          let mikrotikSuccess = false;
          let mikrotikMessage = "Not attempted";

          if (customer.ip_address && customer.router_status === "active") {
            try {
              const mikrotik = new MikrotikService({
                ip_address: customer.ip_address,
                username: customer.router_username,
                password: customer.router_password,
                api_port: customer.api_port || 8728,
              });

              const testResult = await mikrotik.testConnection();

              if (testResult.success) {
                const disableResult = await mikrotik.disablePPPoEUser(
                  customer.username_pppoe
                );
                mikrotikSuccess = disableResult.success;
                mikrotikMessage =
                  disableResult.message || "Disabled in MikroTik";
              } else {
                mikrotikMessage = `Router offline: ${testResult.message}`;
              }
            } catch (mikrotikError) {
              mikrotikMessage = `Mikrotik error: ${mikrotikError.message}`;
            }
          }

          // ✅ Gunakan TRANSACTION untuk consistency
          await connection.beginTransaction();

          try {
            // Update customer status
            const [updateResult] = await connection.query(
              `UPDATE customers 
               SET status = 'suspended', 
                   suspended_at = NOW(),
                   updated_at = NOW() 
               WHERE id = ? AND status = 'active'`,
              [customer.customer_id]
            );

            if (updateResult.affectedRows === 0) {
              throw new Error(
                `Customer ${customer.customer_id} not found or already suspended`
              );
            }

            // Log success (dengan info tentang pending invoices)
            const logDescription =
              customer.pending_invoices > 0
                ? `Customer ${customer.customer_name} auto-suspended (with ${customer.pending_invoices} pending invoice(s)). MikroTik: ${mikrotikMessage}`
                : `Customer ${customer.customer_name} auto-suspended. MikroTik: ${mikrotikMessage}`;

            await connection.query(
              `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
               VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
              [
                customer.pending_invoices > 0
                  ? "auto_suspend_with_invoice"
                  : "auto_suspend_success",
                "customer",
                customer.customer_id,
                logDescription,
                "system",
              ]
            );

            await connection.commit();

            results.suspended++;
            results.customers.push({
              id: customer.customer_id,
              username: customer.username_pppoe,
              name: customer.customer_name,
              expired_at: customer.expired_at,
              days_overdue: daysOverdue,
              pending_invoices: customer.pending_invoices,
              mikrotik_success: mikrotikSuccess,
              mikrotik_message: mikrotikMessage,
              status: "suspended",
            });

            console.log(
              `✅ Suspended: ${customer.username_pppoe} (${daysOverdue} days overdue)`
            );
          } catch (transactionError) {
            await connection.rollback();
            throw transactionError;
          }
        } catch (error) {
          console.error(
            `❌ Failed to suspend ${customer.username_pppoe}:`,
            error.message
          );

          await connection.query(
            `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
            [
              "auto_suspend_error",
              "customer",
              customer.customer_id,
              `Failed to auto-suspend ${customer.username_pppoe}: ${error.message}`,
              "system",
            ]
          );

          results.failed++;
          results.customers.push({
            id: customer.customer_id,
            username: customer.username_pppoe,
            status: "failed",
            error: error.message,
          });
        }
      }

      console.log(`
📊 AUTO-SUSPEND SUMMARY:
├── Total checked: ${results.total}
├── Suspended: ${results.suspended}
├── Failed: ${results.failed}
├── Skipped (invoice pending): ${results.skipped}
└── Total customers processed: ${
        results.suspended + results.failed + results.skipped
      }
      `);

      return results;
    } catch (error) {
      console.error("❌ Auto-suspend job failed:", error);
      throw error;
    } finally {
      if (connection) {
        connection.release();
        console.log("🔓 Database connection released");
      }
    }
  }

  /**
   * **PERBAIKAN: Fungsi untuk manual trigger sederhana**
   */
  static async runAutoSuspend() {
    console.log("🚀 Running auto-suspend via simplified method...");

    try {
      const results = await this.autoSuspendExpiredCustomers();
      return {
        success: true,
        message: "Auto-suspend completed successfully",
        data: results,
      };
    } catch (error) {
      console.error("❌ runAutoSuspend failed:", error);
      return {
        success: false,
        message: error.message,
        data: null,
      };
    }
  }

  /**
   * Reactivate suspended customer
   */
  static async reactivateCustomer(
    customerId,
    adminId = null,
    reason = "Manual reactivation"
  ) {
    console.log(`🔄 Reactivating customer ${customerId}, reason: ${reason}`);

    const connection = await pool.getConnection();

    try {
      // Get customer with router info
      const [customers] = await connection.query(
        `
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        c.username_pppoe,
        c.status AS customer_status,
        r.ip_address,
        r.username AS router_username,
        r.password AS router_password,
        r.api_port,
        r.status AS router_status
      FROM customers c
      JOIN routers r ON c.router_id = r.id
      WHERE c.id = ?
      `,
        [customerId]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      if (customer.customer_status !== "suspended") {
        console.log(
          `ℹ️ Customer ${customerId} is not suspended, skipping reactivation`
        );
        return {
          success: true,
          message: "Customer not suspended, no action needed",
          customer_status: customer.customer_status,
        };
      }

      // Enable PPPoE in MikroTik
      let mikrotikSuccess = false;
      let mikrotikMessage = "Not attempted";

      if (customer.ip_address && customer.router_status === "active") {
        try {
          const mikrotik = new MikrotikService({
            ip_address: customer.ip_address,
            username: customer.router_username,
            password: customer.router_password,
            api_port: customer.api_port || 8728,
          });

          const testResult = await mikrotik.testConnection();
          if (testResult.success) {
            const result = await mikrotik.enablePPPoEUser(
              customer.username_pppoe
            );
            mikrotikSuccess = result.success;
            mikrotikMessage = result.message || "Enabled in MikroTik";
            console.log(`🔧 MikroTik: ${mikrotikMessage}`);
          } else {
            mikrotikMessage = `Router offline: ${testResult.message}`;
            console.warn(`⚠️ ${mikrotikMessage}`);
          }
        } catch (mikrotikError) {
          mikrotikMessage = `Mikrotik error: ${mikrotikError.message}`;
          console.warn(`⚠️ ${mikrotikMessage}`);
        }
      }

      // Update customer status to active
      console.log(`   Updating customer ID ${customerId} to active...`);

      const [updateResult] = await connection.query(
        `UPDATE customers 
       SET status = 'active', 
           updated_at = NOW() 
       WHERE id = ?`,
        [customerId]
      );

      console.log(`   ✅ Affected rows: ${updateResult.affectedRows}`);

      if (updateResult.affectedRows === 0) {
        throw new Error(`Failed to update customer ${customerId}`);
      }

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "reactivate_customer",
          "customer",
          customerId,
          `Customer ${customer.customer_name} reactivated. Reason: ${reason}. MikroTik: ${mikrotikMessage}`,
          adminId === null ? "system" : "admin",
          adminId,
        ]
      );

      console.log(`✅ Customer ${customer.username_pppoe} reactivated`);

      return {
        success: true,
        message: "Customer reactivated successfully",
        customer: {
          id: customerId,
          username: customer.username_pppoe,
          status: "active",
        },
        mikrotik: {
          success: mikrotikSuccess,
          message: mikrotikMessage,
        },
      };
    } catch (error) {
      console.error("❌ Reactivate customer failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Manual suspend customer
   */
  static async suspendCustomer(
    customerId,
    adminId,
    reason = "Manual suspension"
  ) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      console.log(
        `🚫 Manual suspend customer ${customerId}, reason: ${reason}`
      );

      // 1. Get customer with router info
      const [customers] = await connection.query(
        `
        SELECT c.*, r.* 
        FROM customers c
        JOIN routers r ON c.router_id = r.id
        WHERE c.id = ?
      `,
        [customerId]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      if (customer.status === "suspended") {
        throw new Error("Customer already suspended");
      }

      // 2. Disable PPPoE in MikroTik
      let mikrotikSuccess = false;
      let mikrotikMessage = "Not attempted";

      if (customer.ip_address) {
        try {
          const mikrotik = new MikrotikService({
            ip_address: customer.ip_address,
            username: customer.username,
            password: customer.password,
            api_port: customer.api_port || 8728,
          });

          const testResult = await mikrotik.testConnection();

          if (testResult.success) {
            const result = await mikrotik.disablePPPoEUser(
              customer.username_pppoe
            );
            mikrotikSuccess = result.success;
            mikrotikMessage = result.message || "Disabled in MikroTik";
          } else {
            mikrotikMessage = `Router offline: ${testResult.message}`;
          }
        } catch (mikrotikError) {
          mikrotikMessage = `MikroTik error: ${mikrotikError.message}`;
        }
      }

      // 3. Update customer status
      await connection.query(
        'UPDATE customers SET status = "suspended", suspended_at = NOW(), updated_at = NOW() WHERE id = ?',
        [customerId]
      );

      // 4. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
   VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
        [
          "manual_suspend",
          "customer",
          customerId,
          `Customer ${
            customer.name
          } manually suspended. Reason: ${reason}. MikroTik: ${
            mikrotikSuccess ? "success" : "failed"
          }`,
          "admin",
          adminId,
        ]
      );

      console.log(`✅ Customer ${customer.username_pppoe} manually suspended`);

      return {
        success: true,
        message: "Customer suspended successfully",
        customer: {
          id: customerId,
          username: customer.username_pppoe,
          status: "suspended",
        },
        mikrotik: {
          success: mikrotikSuccess,
          message: mikrotikMessage,
        },
      };
    } catch (error) {
      console.error("❌ Manual suspend failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get suspension statistics - FIXED VERSION
   */
  static async getSuspensionStats() {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      const today = new Date();
      const oneWeekAgo = new Date(today);
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      const graceDate = new Date(today);
      graceDate.setDate(graceDate.getDate() - 3);

      // Query untuk statistik
      const queries = [
        // Total suspended
        connection.query(
          'SELECT COUNT(*) as count FROM customers WHERE status = "suspended"'
        ),

        // Recently auto-suspended (last 7 days)
        connection.query(
          `SELECT COUNT(*) as count 
           FROM logs 
           WHERE action = 'auto_suspend' 
           AND created_at >= ?`,
          [oneWeekAgo]
        ),

        // Expired but not suspended (beyond grace period)
        connection.query(
          `SELECT COUNT(*) as count 
           FROM customers 
           WHERE status = 'active' 
           AND expired_at < ?`,
          [graceDate.toISOString().split("T")[0]]
        ),

        // Total auto-suspended all time
        connection.query(
          `SELECT COUNT(*) as count 
           FROM logs 
           WHERE action = 'auto_suspend'`
        ),
      ];

      const [
        [totalSuspended],
        [recentAutoSuspended],
        [expiredNotSuspended],
        [totalAutoSuspended],
      ] = await Promise.all(queries);

      return {
        total_suspended: totalSuspended[0].count,
        recent_auto_suspended: recentAutoSuspended[0].count,
        expired_not_suspended: expiredNotSuspended[0].count,
        total_auto_suspended: totalAutoSuspended[0].count,
        grace_period_days: 3,
        checked_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Get suspension stats failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get expiring soon customers
   */
  static async getExpiringSoonCustomers(daysThreshold = 3) {
    const pool = require("../config/database");
    const connection = await pool.getConnection();

    try {
      const today = new Date();
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysThreshold);

      const [customers] = await connection.query(
        `
        SELECT 
          c.id,
          c.name,
          c.username_pppoe,
          c.phone,
          c.expired_at,
          DATEDIFF(c.expired_at, CURDATE()) as days_left,
          r.name as router_name
        FROM customers c
        LEFT JOIN routers r ON c.router_id = r.id
        WHERE c.status = 'active'
        AND c.expired_at BETWEEN ? AND ?
        ORDER BY c.expired_at ASC
      `,
        [
          today.toISOString().split("T")[0],
          targetDate.toISOString().split("T")[0],
        ]
      );

      return {
        count: customers.length,
        threshold_days: daysThreshold,
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          username_pppoe: c.username_pppoe,
          expired_at: c.expired_at,
          days_left: c.days_left,
          router_name: c.router_name,
        })),
      };
    } catch (error) {
      console.error("❌ Get expiring soon failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }
  // Dalam suspension.service.js - fungsi runAutoSuspend
  static async runAutoSuspend() {
    try {
      console.log("🚀 Running auto-suspend via SuspensionService...");

      // 1. Get customers that should be suspended
      const customersToSuspend = await this.getCustomersToSuspend();

      console.log(`📊 Found ${customersToSuspend.length} customers to suspend`);

      let suspended = 0;
      let failed = 0;
      let skipped = 0;

      // 2. Process each customer
      for (const customer of customersToSuspend) {
        try {
          const result = await this.suspendCustomer(customer);
          if (result.success) {
            suspended++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          console.error(
            `Error suspending customer ${customer.customer_name}:`,
            error
          );
        }
      }

      const result = {
        success: true,
        checked: customersToSuspend.length,
        suspended,
        failed,
        skipped,
        timestamp: new Date().toISOString(),
      };

      console.log("✅ Auto-suspend completed:", result);
      return result;
    } catch (error) {
      console.error("❌ Auto-suspend failed:", error);
      throw error;
    }
  }
}

module.exports = SuspensionService;
