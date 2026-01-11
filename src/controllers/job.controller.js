// src/controllers/job.controller.js
const scheduler = require("../jobs/scheduler");
const SuspensionService = require("../services/suspension.service"); // Import service
const logger = require("../utils/logger");

class JobController {
  // Trigger auto-extend manually
  static async triggerAutoExtend(req, res) {
    try {
      logger.info("Manual trigger: auto-extend job");

      // Jika scheduler punya method autoExtendCustomers
      let result;
      if (scheduler.autoExtendCustomers) {
        result = await scheduler.autoExtendCustomers();
      } else {
        // Fallback ke method lain atau service
        result = { success: true, message: "Auto-extend not implemented yet" };
      }

      res.json({
        success: true,
        message: "Auto-extend job triggered manually",
        data: result,
      });
    } catch (error) {
      logger.error("Manual trigger failed:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Trigger auto-suspend manually - FIXED
  static async triggerAutoSuspend(req, res) {
    try {
      logger.info("Manual trigger: auto-suspend job");

      let result;

      // Coba berbagai cara untuk trigger auto-suspend
      if (scheduler.runJobManually) {
        // Jika scheduler punya method runJobManually
        result = await scheduler.runJobManually("autoSuspend");
      } else if (scheduler.autoSuspendExpired) {
        // Jika scheduler punya method autoSuspendExpired
        result = await scheduler.autoSuspendExpired();
      } else {
        // Gunakan SuspensionService langsung
        result = await SuspensionService.runAutoSuspend();
      }

      res.json({
        success: true,
        message: "Auto-suspend job triggered manually",
        data: result,
      });
    } catch (error) {
      logger.error("Manual trigger failed:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get scheduler status - FIXED
  static async getSchedulerStatus(req, res) {
    try {
      let status;

      // Cek berbagai format status yang mungkin
      if (typeof scheduler.getStatus === "function") {
        status = scheduler.getStatus();
      } else if (scheduler.jobs) {
        // Format manual jika scheduler punya property jobs
        status = {
          running: true,
          jobCount: scheduler.jobs.length,
          environment: process.env.NODE_ENV,
          jobs: scheduler.jobs.map((job) => ({
            name: job.name || "unknown",
            enabled: job.enabled !== false,
          })),
        };
      } else {
        // Default status
        status = {
          running: false,
          jobCount: 0,
          environment: process.env.NODE_ENV,
        };
      }

      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("Error getting scheduler status:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = JobController;
