const cron = require("node-cron");
const db = require("../config/database");
const MikrotikTrafficService = require("../services/mikrotik-traffic.service");
const logger = require("../utils/logger");
const { publishTrafficUpdate } = require("../websocket/traffic.websocket");

class TrafficMonitorJob {
  constructor() {
    this.isRunning = false;
    this.activeRouters = [];
  }

  async start() {
    // Jalankan setiap 5 detik untuk realtime monitoring
    cron.schedule("*/5 * * * * *", async () => {
      if (this.isRunning) return;

      this.isRunning = true;
      try {
        await this.monitorAllRouters();
      } catch (error) {
        logger.error("Traffic monitor error:", error);
      } finally {
        this.isRunning = false;
      }
    });

    // Jalankan setiap 1 menit untuk customer usage update
    cron.schedule("*/1 * * * *", async () => {
      await this.updateCustomerUsage();
    });

    // Reset monthly usage setiap tanggal 1 jam 00:00
    cron.schedule("0 0 1 * *", async () => {
      await this.resetMonthlyUsage();
    });

    logger.info("🚦 Traffic Monitor Job Started");
  }

  async monitorAllRouters() {
    try {
      // Ambil semua router aktif
      const [routers] = await db.query(
        "SELECT * FROM routers WHERE status = 'active'",
      );

      for (const router of routers) {
        try {
          const trafficService = new MikrotikTrafficService(router);

          // 1. Ambil data interface traffic
          const interfaces = await trafficService.getInterfacesTraffic();

          // 2. Simpan ke database
          for (const iface of interfaces) {
            await db.query(
              `INSERT INTO traffic_logs 
               (router_id, interface_name, rx_bytes, tx_bytes, rx_rate, tx_rate, logged_at)
               VALUES (?, ?, ?, ?, ?, ?, NOW())`,
              [
                iface.router_id,
                iface.interface_name,
                iface.rx_bytes,
                iface.tx_bytes,
                iface.rx_rate,
                iface.tx_rate,
              ],
            );
          }

          // 3. Kirim update via WebSocket untuk realtime dashboard
          publishTrafficUpdate({
            router_id: router.id,
            router_name: router.name,
            interfaces: interfaces,
            timestamp: new Date(),
          });

          // 4. Monitor PPPoE sessions untuk customer-specific tracking
          const sessions = await trafficService.getPPPoEActiveSessions();

          for (const session of sessions) {
            // Cari customer berdasarkan username PPPoE
            const [customers] = await db.query(
              "SELECT id, username_pppoe, package_id FROM customers WHERE username_pppoe = ?",
              [session.username],
            );

            if (customers.length > 0) {
              const customer = customers[0];

              // Update current usage di memory (akan diproses di job terpisah)
              await db.query(
                `UPDATE customers 
                 SET current_usage = current_usage + ? 
                 WHERE id = ?`,
                [session.rx_bytes + session.tx_bytes, customer.id],
              );

              // Cek kuota
              await this.checkQuotaAndNotify(customer.id);
            }
          }
        } catch (routerError) {
          logger.error(
            `Router ${router.name} monitoring failed:`,
            routerError.message,
          );

          // Update router status
          await db.query(
            "UPDATE routers SET status = 'error', last_error = ? WHERE id = ?",
            [routerError.message, router.id],
          );
        }
      }
    } catch (error) {
      logger.error("Monitor all routers error:", error);
    }
  }

  async updateCustomerUsage() {
    try {
      // Ambil semua customer aktif
      const [customers] = await db.query(
        `SELECT c.*, p.quota_bytes, p.rate_limit 
   FROM customers c
   LEFT JOIN packages p ON c.package_id = p.id
   WHERE c.status = 'active' AND c.mikrotik_status = 'active'`,
      );

      for (const customer of customers) {
        // Cek apakah kuota sudah habis
        if (
          customer.quota_bytes &&
          customer.current_usage > customer.quota_bytes
        ) {
          if (!customer.quota_exceeded) {
            // Mark as exceeded
            await db.query(
              `UPDATE customers 
               SET quota_exceeded = 1, 
                   suspension_reason = 'Kuota habis',
                   suspended_at = NOW(),
                   status = 'suspended'
               WHERE id = ?`,
              [customer.id],
            );

            // Log ke sistem
            await db.query(
              `INSERT INTO logs 
               (action, entity, entity_id, description, source, admin_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                "quota_exceeded",
                "customer",
                customer.id,
                `Customer ${customer.name} kuota habis (${this.formatBytes(customer.current_usage)} / ${this.formatBytes(customer.quota_bytes)})`,
                "system",
                1,
              ],
            );

            // Kirim notifikasi (WhatsApp/Email)
            await this.sendQuotaNotification(customer);
          }
        }
      }
    } catch (error) {
      logger.error("Update customer usage error:", error);
    }
  }

  async resetMonthlyUsage() {
    try {
      await db.query(
        `UPDATE customers 
         SET current_usage = 0, 
             last_reset_date = CURDATE(),
             quota_exceeded = 0
         WHERE status = 'active'`,
      );

      logger.info("✅ Monthly usage reset completed");
    } catch (error) {
      logger.error("Reset monthly usage error:", error);
    }
  }

  async checkQuotaAndNotify(customerId) {
    try {
      const [customers] = await db.query(
        `SELECT c.*, p.quota_bytes 
         FROM customers c
         LEFT JOIN packages p ON c.package_id = p.id
         WHERE c.id = ?`,
        [customerId],
      );

      if (customers.length === 0) return;

      const customer = customers[0];

      if (!customer.quota_bytes) return; // Unlimited

      const usagePercent =
        (customer.current_usage / customer.quota_bytes) * 100;

      // Kirim notifikasi pada threshold tertentu
      const thresholds = [80, 90, 95, 100];

      for (const threshold of thresholds) {
        if (usagePercent >= threshold && usagePercent < threshold + 5) {
          // Cek apakah sudah dikirim notifikasi untuk threshold ini
          const [notifications] = await db.query(
            `SELECT COUNT(*) as count FROM notification_logs 
             WHERE customer_id = ? 
             AND message_type = 'quota_alert'
             AND message LIKE '%${threshold}%'
             AND DATE(created_at) = CURDATE()`,
            [customerId],
          );

          if (notifications[0].count === 0) {
            await this.sendQuotaAlert(customer, threshold, usagePercent);
          }
          break;
        }
      }
    } catch (error) {
      logger.error("Check quota error:", error);
    }
  }

  async sendQuotaAlert(customer, threshold, usagePercent) {
    const message =
      `⚠️ Peringatan Kuota: ${customer.name}\n` +
      `Penggunaan: ${this.formatBytes(customer.current_usage)} / ${this.formatBytes(customer.quota_bytes)}\n` +
      `Persentase: ${usagePercent.toFixed(1)}%`;

    // Simpan ke notification_logs
    await db.query(
      `INSERT INTO notification_logs 
       (customer_id, phone, message_type, message, status)
       VALUES (?, ?, ?, ?, ?)`,
      [customer.id, customer.phone, "quota_alert", message, "sent"],
    );

    // TODO: Integrasi dengan WhatsApp API (Fonnte)
    // await whatsappService.sendMessage(customer.phone, message);

    logger.info(`Quota alert sent to ${customer.name}: ${threshold}%`);
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

module.exports = new TrafficMonitorJob();
