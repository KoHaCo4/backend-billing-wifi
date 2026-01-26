const logger = require("../utils/logger");
const CronUtils = require("../utils/cronUtils");

exports.testCronStatus = async (req, res) => {
  try {
    const schedule = "*/5 * * * *";
    const timezone = "Asia/Jakarta";

    // Gunakan CronUtils
    const nextRun = CronUtils.getNextRun(schedule, { timezone });
    const nextRuns = CronUtils.getNextRuns(schedule, 3, { timezone });

    res.json({
      success: true,
      message: "Cron test successful",
      data: {
        method: "CronUtils",
        schedule_test: schedule,
        timezone: timezone,
        next_run: nextRun.toISOString(),
        next_run_local: nextRun.toLocaleString("id-ID", { timeZone: timezone }),
        next_3_runs: nextRuns.map((run) =>
          run.toLocaleString("id-ID", { timeZone: timezone }),
        ),
        server_time: new Date().toISOString(),
        server_time_local: new Date().toLocaleString("id-ID", {
          timeZone: timezone,
        }),
      },
    });
  } catch (error) {
    logger.error("Test cron error:", error);
    res.status(500).json({
      success: false,
      message: "Cron test failed",
      error: error.message,
    });
  }
};

exports.testFonnteConnection = async (req, res) => {
  try {
    const fonnteService = require("../services/fonnte.service");
    const result = await fonnteService.testDirectConnection();

    res.json({
      success: result.connectionTest,
      message: result.connectionTest
        ? "Fonnte connection test successful"
        : "Fonnte connection test failed",
      data: result,
      api_token_exists: !!process.env.FONNTE_API_TOKEN,
      api_token_length: process.env.FONNTE_API_TOKEN?.length,
    });
  } catch (error) {
    logger.error("Test fonnte error:", error);
    res.status(500).json({
      success: false,
      message: "Fonnte test failed",
      error: error.message,
    });
  }
};

exports.testDatabaseConnection = async (req, res) => {
  try {
    const db = require("../config/database");

    // Test koneksi database
    const [rows] = await db.execute("SELECT 1 as test");

    // Cek tabel customers
    const [customers] = await db.execute(`
      SELECT COUNT(*) as total 
      FROM customers 
      WHERE status = 'active'
      AND phone IS NOT NULL
    `);

    // Cek pelanggan yang akan expired besok
    const [expiring] = await db.execute(`
      SELECT COUNT(*) as expiring_tomorrow
      FROM customers 
      WHERE status = 'active'
      AND DATE(expired_at) = DATE(DATE_ADD(CURDATE(), INTERVAL 1 DAY))
      AND phone IS NOT NULL
    `);

    res.json({
      success: true,
      message: "Database connection test successful",
      data: {
        database: {
          connected: rows[0].test === 1,
          test_result: rows[0],
        },
        customers: {
          total_active: customers[0].total,
          expiring_tomorrow: expiring[0].expiring_tomorrow,
        },
      },
    });
  } catch (error) {
    logger.error("Test database error:", error);
    res.status(500).json({
      success: false,
      message: "Database test failed",
      error: error.message,
    });
  }
};

exports.testSystemHealth = async (req, res) => {
  try {
    const results = {};

    // Test 1: Database
    try {
      const db = require("../config/database");
      const [dbTest] = await db.execute("SELECT 1 as ok");
      results.database = { success: true, data: dbTest[0] };
    } catch (error) {
      results.database = { success: false, error: error.message };
    }

    // Test 2: Cron Parser
    try {
      const nextRun = CronUtils.getNextRun("*/5 * * * *");
      results.cron = { success: true, nextRun: nextRun.toISOString() };
    } catch (error) {
      results.cron = { success: false, error: error.message };
    }

    // Test 3: Fonnte Token
    results.fonnte = {
      token_exists: !!process.env.FONNTE_API_TOKEN,
      token_length: process.env.FONNTE_API_TOKEN?.length || 0,
    };

    // Test 4: Server Time
    results.server = {
      time: new Date().toISOString(),
      time_local: new Date().toLocaleString("id-ID"),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    res.json({
      success: true,
      message: "System health check completed",
      results: results,
      overall: Object.values(results).every((r) => r.success !== false)
        ? "healthy"
        : "degraded",
    });
  } catch (error) {
    logger.error("System health check error:", error);
    res.status(500).json({
      success: false,
      message: "System health check failed",
      error: error.message,
    });
  }
};
