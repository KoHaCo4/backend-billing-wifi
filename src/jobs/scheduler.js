// src/jobs/scheduler.js - PERBAIKAN FINAL
const cron = require("node-cron");
const { timeToCron } = require("../utils/timeToCron");
const pool = require("../config/database");
const SuspensionService = require("../services/suspension.service");
const loadSettings = require("../config/settingsBilling");
const normalizeTime = require("../utils/normalizeTime");

class Scheduler {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
    this.isProcessing = false;
    this.jobCount = 0;
    this.activeJobs = [];
    this.jobDetails = [];
  }

  async start() {
    if (this.isRunning) {
      console.log("⚠️ Scheduler already running");
      return;
    }

    console.log("⏰ Starting scheduler...");

    const settings = await loadSettings();
    const scheduler = settings.scheduler;

    if (!scheduler?.autoSuspendEnabled) {
      console.log("🚫 Auto-suspend disabled in settings");
      return;
    }

    const suspendTime = normalizeTime(scheduler.suspendCheckHour);
    const suspendCron = timeToCron(suspendTime);

    console.log(
      "⏰ Auto-suspend scheduled at",
      suspendTime,
      `(${suspendCron})`
    );

    // Job 1: Auto-suspend dengan LOCK mechanism
    const autoSuspendJob = cron.schedule(
      suspendCron,
      async () => {
        if (this.isProcessing) {
          console.log(
            "⏸️ Auto-suspend job skipped - another job is processing"
          );
          return;
        }

        this.isProcessing = true;
        console.log("🚀 Running scheduled auto-suspend job...");

        try {
          const SuspensionService = require("../services/suspension.service");
          const result = await SuspensionService.autoSuspendExpiredCustomers();

          console.log("✅ Auto-suspend job completed successfully");
          console.log(
            `📊 Results: ${result.suspended} suspended, ${result.failed} failed, ${result.skipped} skipped`
          );

          // Log ke database dengan timeout
          setTimeout(async () => {
            try {
              const pool = require("../config/database");
              const connection = await pool.getConnection();
              await connection.query(
                `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
               VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
                [
                  "auto_suspend_job",
                  "system",
                  0,
                  `Auto-suspend job completed: ${result.total} checked, ${result.suspended} suspended, ${result.failed} failed, ${result.skipped} skipped`,
                  "system",
                ]
              );
              connection.release();
            } catch (logError) {
              console.error("Failed to log job completion:", logError.message);
            }
          }, 100); // Delay kecil untuk tidak blocking
        } catch (error) {
          console.error("❌ Auto-suspend job failed:", error.message);
        } finally {
          this.isProcessing = false;
          console.log("🔓 Job lock released");
        }
      },
      {
        scheduled: true,
        timezone: "Asia/Jakarta",
      }
    );

    this.jobs.push(autoSuspendJob);
    this.isRunning = true;

    console.log("✅ Safe scheduler started with lock mechanism");
  }

  stop() {
    if (!this.isRunning) {
      console.log("⚠️ Scheduler not running");
      return;
    }

    this.jobs.forEach((job) => job.stop());
    this.jobs = [];
    this.isRunning = false;

    console.log("🛑 Job scheduler stopped");
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      jobCount: this.jobs.length,
      activeJobs: this.jobs.map((job, index) => ({
        id: index + 1,
        running: job.task ? job.task.running : false,
      })),
      lastRun: this.lastRunTime,
      environment: process.env.NODE_ENV || "development",
    };
  }

  async autoSuspendExpired() {
    try {
      console.log(
        "⏰ [SCHEDULER] Running auto-suspend job at",
        new Date().toLocaleString("id-ID")
      );

      const result = await SuspensionService.autoSuspendExpiredCustomers();

      console.log("📊 [SCHEDULER] Auto-suspend completed:", {
        total: result.total,
        suspended: result.suspended,
        failed: result.failed,
        skipped: result.skipped,
        timestamp: new Date().toLocaleString("id-ID"),
      });

      // Log ke database
      const connection = await pool.getConnection();
      try {
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "auto_suspend_job",
            "system",
            0,
            `Auto-suspend job completed: ${result.total} checked, ${result.suspended} suspended, ${result.failed} failed, ${result.skipped} skipped`,
            "system",
          ]
        );
      } finally {
        connection.release();
      }

      return result;
    } catch (error) {
      console.error("❌ [SCHEDULER] Auto-suspend job failed:", error);

      // Log error ke database
      try {
        const connection = await pool.getConnection();
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "auto_suspend_error",
            "system",
            0,
            `Auto-suspend job failed: ${error.message}`,
            "system",
          ]
        );
        connection.release();
      } catch (logError) {
        console.error("Failed to log error:", logError);
      }

      throw error;
    }
  }

  async checkExpiringSoon() {
    const connection = await pool.getConnection();

    try {
      // Cari customer yang akan expired dalam 3 hari ke depan
      // PERBAIKAN: Hapus kolom email yang tidak ada
      const [customers] = await connection.query(`
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
        AND c.expired_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        ORDER BY days_left ASC
        LIMIT 50
      `);

      if (customers.length > 0) {
        console.log(
          `⚠️ [SCHEDULER] ${customers.length} customer(s) expiring soon (1-3 days)`
        );

        // Log ke database
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "expiring_soon_check",
            "system",
            0,
            `${customers.length} customer(s) expiring soon (1-3 days)`,
            "system",
          ]
        );

        // Log detail ke console
        for (const customer of customers) {
          console.log(
            `   - ${customer.name} (${customer.username_pppoe}) expires in ${customer.days_left} days`
          );
        }
      } else {
        console.log("✅ [SCHEDULER] No customers expiring soon");
      }

      return {
        count: customers.length,
        customers: customers,
      };
    } catch (error) {
      console.error("❌ [SCHEDULER] Check expiring soon failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async checkOverdueInvoices() {
    const connection = await pool.getConnection();

    try {
      const [result] = await connection.query(
        `UPDATE invoices 
         SET status = 'overdue' 
         WHERE status = 'pending' 
         AND due_date < CURDATE()`
      );

      if (result.affectedRows > 0) {
        console.log(
          `✅ [SCHEDULER] Updated ${result.affectedRows} invoices to overdue`
        );

        // Log ke database
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "invoice_overdue_check",
            "system",
            0,
            `Updated ${result.affectedRows} invoices to overdue status`,
            "system",
          ]
        );
      } else {
        console.log("✅ [SCHEDULER] No overdue invoices found");
      }

      return result;
    } catch (error) {
      console.error("❌ [SCHEDULER] Check overdue invoices failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  async generateAutoRenewInvoices() {
    const connection = await pool.getConnection();

    try {
      console.log("🧾 [SCHEDULER] Generating auto-renew invoices...");

      // Cari customer dengan auto_renew = 1 yang akan expired dalam 7 hari
      const [customers] = await connection.query(`
        SELECT 
          c.id,
          c.name,
          c.username_pppoe,
          c.package_id,
          p.price,
          p.name as package_name,
          p.duration_days,
          c.expired_at,
          DATEDIFF(c.expired_at, CURDATE()) as days_left
        FROM customers c
        JOIN packages p ON c.package_id = p.id
        WHERE c.status = 'active'
        AND c.auto_renew = 1
        AND c.expired_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND NOT EXISTS (
          SELECT 1 FROM invoices i 
          WHERE i.customer_id = c.id 
          AND i.status IN ('pending', 'paid')
          AND DATE(i.issue_date) >= DATE_SUB(CURDATE(), INTERVAL p.duration_days DAY)
        )
        ORDER BY c.expired_at ASC
      `);

      let generatedCount = 0;

      for (const customer of customers) {
        try {
          // Generate invoice
          const invoiceNumber = `INV-${Date.now()}-${customer.id}`;
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7); // Jatuh tempo 7 hari dari sekarang

          await connection.query(
            `INSERT INTO invoices 
             (invoice_number, customer_id, amount, description, status, issue_date, due_date)
             VALUES (?, ?, ?, ?, 'pending', CURDATE(), ?)`,
            [
              invoiceNumber,
              customer.id,
              customer.price,
              `Auto-renew untuk paket ${customer.package_name} (${customer.duration_days} hari)`,
              dueDate,
            ]
          );

          generatedCount++;
          console.log(
            `   ✅ Generated invoice for ${customer.name} (ID: ${customer.id})`
          );
        } catch (error) {
          console.error(
            `   ❌ Failed to generate invoice for customer ${customer.id}:`,
            error.message
          );
        }
      }

      if (generatedCount > 0) {
        console.log(
          `✅ [SCHEDULER] Generated ${generatedCount} auto-renew invoices`
        );

        // Log ke database
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "invoice_auto_generate",
            "system",
            0,
            `Generated ${generatedCount} auto-renew invoices`,
            "system",
          ]
        );
      } else {
        console.log("✅ [SCHEDULER] No auto-renew invoices needed");
      }

      return { generated: generatedCount, total: customers.length };
    } catch (error) {
      console.error(
        "❌ [SCHEDULER] Generate auto-renew invoices failed:",
        error
      );
      throw error;
    } finally {
      connection.release();
    }
  }

  async cleanupOldLogs() {
    const connection = await pool.getConnection();

    try {
      console.log("🧹 [SCHEDULER] Cleaning up old logs...");

      // Hapus logs yang lebih dari 90 hari, kecuali yang penting
      const [result] = await connection.query(
        `DELETE FROM logs 
         WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
         AND action NOT LIKE '%suspend%'
         AND action NOT LIKE '%reactivate%'
         AND action NOT LIKE '%payment%'`
      );

      if (result.affectedRows > 0) {
        console.log(
          `✅ [SCHEDULER] Cleaned up ${result.affectedRows} old logs`
        );

        // Log cleanup activity
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
           VALUES (?, ?, ?, ?, ?, NULL, NOW())`,
          [
            "logs_cleanup",
            "system",
            0,
            `Cleaned up ${result.affectedRows} logs older than 90 days`,
            "system",
          ]
        );
      } else {
        console.log("✅ [SCHEDULER] No old logs to cleanup");
      }

      return result;
    } catch (error) {
      console.error("❌ [SCHEDULER] Cleanup old logs failed:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Manual trigger untuk testing
  async runJobManually(jobName) {
    console.log(`🔧 [MANUAL] Running job: ${jobName}`);

    switch (jobName) {
      case "autoSuspend":
        return await this.autoSuspendExpired();
      case "checkExpiring":
        return await this.checkExpiringSoon();
      case "checkOverdue":
        return await this.checkOverdueInvoices();
      case "generateInvoices":
        return await this.generateAutoRenewInvoices();
      case "cleanupLogs":
        return await this.cleanupOldLogs();
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  }
}

module.exports = new Scheduler();
