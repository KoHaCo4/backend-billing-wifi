const Customer = require("../models/Customer");
const customerReminderJob = require("../jobs/customerReminder");
const logger = require("../utils/logger");
const CronUtils = require("../utils/cronUtils");

exports.getReminderStatus = async (req, res) => {
  try {
    const job = customerReminderJob.job;
    const schedule =
      process.env.NODE_ENV === "production" ? "0 9 * * *" : "*/5 * * * *";

    // Hitung waktu berikutnya menggunakan CronUtils
    const nextRun = CronUtils.getNextRun(schedule, {
      timezone: "Asia/Jakarta",
    });

    // Cek pelanggan yang akan expired
    let expiringData = {
      tomorrow: [],
      in_3_days: [],
      total_tomorrow: 0,
      total_3_days: 0,
    };
    try {
      expiringData = await customerReminderJob.getExpiringCustomers();
    } catch (error) {
      logger.warn("Error getting expiring customers:", error.message);
    }

    // Debug data customers
    let debugData = {};
    try {
      debugData = await Customer.debugCustomers();
    } catch (error) {
      logger.warn("Error debugging customers:", error.message);
    }

    // Dapatkan 3 waktu berikutnya untuk ditampilkan
    const nextRuns = CronUtils.getNextRuns(schedule, 3, {
      timezone: "Asia/Jakarta",
    });

    res.json({
      success: true,
      data: {
        cron_job: {
          is_running: customerReminderJob.isRunning,
          is_active: !!job,
          next_run: nextRun.toISOString(),
          next_run_local: nextRun.toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
          }),
          next_runs: nextRuns.map((run) => ({
            iso: run.toISOString(),
            local: run.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
          })),
          schedule: schedule,
          timezone: "Asia/Jakarta",
          started_at: customerReminderJob.startTime
            ? customerReminderJob.startTime.toISOString()
            : null,
        },
        customers: {
          expiring_tomorrow: expiringData.total_tomorrow || 0,
          expiring_in_3_days: expiringData.total_3_days || 0,
          list_tomorrow: (expiringData.tomorrow || []).slice(0, 5).map((c) => ({
            name: c.name,
            phone: c.phone,
            expired_at: c.expired_at,
            package: c.package_name,
            days_left: c.days_left,
          })),
          list_3_days: (expiringData.in_3_days || []).slice(0, 5).map((c) => ({
            name: c.name,
            phone: c.phone,
            expired_at: c.expired_at,
            package: c.package_name,
            days_left: c.days_left,
          })),
        },
        debug: debugData,
        server_time: new Date().toISOString(),
        server_time_local: new Date().toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        }),
      },
    });
  } catch (error) {
    logger.error("Error getting reminder status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ... (fungsi lainnya tetap sama)

exports.triggerReminderNow = async (req, res) => {
  try {
    const { type = "all", phone } = req.query;

    logger.info(
      `Triggering reminder job manually - type: ${type}, phone: ${phone}`,
    );

    if (phone) {
      // Test untuk nomor tertentu
      const result = await customerReminderJob.triggerManual({
        phone,
        days: 1,
      });

      res.json({
        success: result.success,
        message: result.success
          ? `Test reminder sent to ${phone}`
          : "Failed to send test reminder",
        data: result.data,
        error: result.error,
      });
    } else {
      // Jalankan job lengkap
      await customerReminderJob.run();

      res.json({
        success: true,
        message: "Reminder job executed successfully",
        data: {
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    logger.error("Error triggering reminder job:", error);
    res.status(500).json({
      success: false,
      message: "Error triggering reminder job",
      error: error.message,
    });
  }
};

exports.debugCustomers = async (req, res) => {
  try {
    const customers = await Customer.debugCustomers();

    res.json({
      success: true,
      data: customers,
      message: "Customer debug completed",
    });
  } catch (error) {
    logger.error("Error debugging customers:", error);
    res.status(500).json({
      success: false,
      message: "Error debugging customers",
      error: error.message,
    });
  }
};

exports.getExpiringCustomers = async (req, res) => {
  try {
    const { days = 1 } = req.query;

    const customers = await Customer.findExpiringInDays(parseInt(days));

    res.json({
      success: true,
      data: customers,
      count: customers.length,
      days: days,
    });
  } catch (error) {
    logger.error("Error getting expiring customers:", error);
    res.status(500).json({
      success: false,
      message: "Error getting expiring customers",
      error: error.message,
    });
  }
};

// Tambahkan endpoint untuk cek job status sederhana
exports.getJobInfo = async (req, res) => {
  try {
    const job = customerReminderJob.job;
    const schedule =
      process.env.NODE_ENV === "production" ? "0 9 * * *" : "*/5 * * * *";

    // Hitung waktu berikutnya
    let nextRun = null;
    try {
      const cronParser = require("cron-parser");
      const interval = cronParser.parseExpression(schedule, {
        tz: "Asia/Jakarta",
        currentDate: new Date(),
      });
      nextRun = interval.next().toDate();
    } catch (error) {
      logger.warn("Cron parse error:", error.message);
    }

    res.json({
      success: true,
      data: {
        job: {
          exists: !!job,
          running: customerReminderJob.isRunning,
          started_at: job ? "Started" : "Not started",
          schedule: schedule,
          timezone: "Asia/Jakarta",
        },
        next_run: nextRun ? nextRun.toISOString() : null,
        next_run_local: nextRun
          ? nextRun.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
          : null,
        current_time: new Date().toISOString(),
        current_time_local: new Date().toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        }),
      },
    });
  } catch (error) {
    logger.error("Error getting job info:", error);
    res.status(500).json({
      success: false,
      message: "Error getting job info",
      error: error.message,
    });
  }
};
