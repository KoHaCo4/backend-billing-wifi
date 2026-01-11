// routes/job.routes.js - SEMUA endpoint jobs
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const scheduler = require("../jobs/scheduler");

// GET /api/jobs/status - Public untuk monitoring
router.get("/status", (req, res) => {
  try {
    const status = scheduler.getStatus
      ? scheduler.getStatus()
      : {
          running: false,
          jobs: [],
          lastRun: null,
        };

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });
  } catch (error) {
    console.error("Error getting job status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get job status",
      error: error.message,
    });
  }
});

// POST /api/jobs/run/:jobName - Protected
router.post("/run/:jobName", authenticate, async (req, res) => {
  try {
    const { jobName } = req.params;
    const validJobs = [
      "autoSuspend",
      "checkExpiring",
      "checkOverdue",
      "generateInvoices",
      "cleanupLogs",
    ];

    if (!validJobs.includes(jobName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid job name. Valid jobs: ${validJobs.join(", ")}`,
      });
    }

    console.log(
      `🔧 Manual job trigger: ${jobName} by user ${req.user?.id || "system"}`
    );

    if (scheduler.runJobManually) {
      const result = await scheduler.runJobManually(jobName);

      res.json({
        success: true,
        message: `Job ${jobName} completed successfully`,
        data: result,
        triggeredBy: req.user?.username || "manual",
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(501).json({
        success: false,
        message: `Scheduler doesn't support manual execution`,
      });
    }
  } catch (error) {
    console.error(`Job ${req.params.jobName} failed:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to run job ${req.params.jobName}`,
      error: error.message,
    });
  }
});

// GET /api/jobs/list - Get all scheduled jobs
router.get("/list", authenticate, (req, res) => {
  try {
    const jobs = [
      {
        name: "autoSuspend",
        description: "Auto suspend expired customers",
        schedule: "Daily at 01:00",
        enabled: process.env.AUTO_SUSPEND_ENABLED === "true",
      },
      {
        name: "checkExpiring",
        description: "Check expiring soon customers",
        schedule: "Daily at 09:00",
        enabled: true,
      },
      {
        name: "checkOverdue",
        description: "Check overdue invoices",
        schedule: "Daily at 02:00",
        enabled: true,
      },
    ];

    res.json({
      success: true,
      data: jobs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get jobs list",
    });
  }
});

module.exports = router;
