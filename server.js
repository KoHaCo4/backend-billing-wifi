// server.js - PERBAIKAN ROUTING
require("dotenv").config();
const app = require("./src/app");
const scheduler = require("./src/jobs/scheduler");
const { authenticate } = require("./src/middleware/auth");

const PORT = process.env.PORT || 8080;

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
  // Jangan exit process, log saja
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
  // Jangan exit process, log saja
});

// ===========================================
// ROUTE MONITORING & MANUAL JOBS - FIXED PATH
// ===========================================

// ✅ Endpoint untuk cek status jobs (PUBLIC - untuk monitoring)
app.get("/api/jobs/status", (req, res) => {
  try {
    const status = scheduler.getStatus
      ? scheduler.getStatus()
      : {
          running: false,
          jobs: [],
        };

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get job status",
    });
  }
});

// ✅ Endpoint untuk manual trigger jobs (PROTECTED)
app.post("/api/jobs/run/:jobName", authenticate, (req, res) => {
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

    console.log(`🔧 Manual job trigger: ${jobName} by user ${req.user.id}`);

    // Jalankan job secara async
    if (scheduler.runJobManually) {
      scheduler
        .runJobManually(jobName)
        .then((result) => {
          res.json({
            success: true,
            message: `Job ${jobName} started successfully`,
            data: result,
          });
        })
        .catch((error) => {
          console.error(`Job ${jobName} failed:`, error);
          res.status(500).json({
            success: false,
            message: `Failed to run job ${jobName}: ${error.message}`,
          });
        });
    } else {
      // Fallback jika scheduler tidak punya method runJobManually
      res.status(501).json({
        success: false,
        message: `Scheduler doesn't support manual execution`,
      });
    }
  } catch (error) {
    console.error("Error in manual job trigger:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// ===========================================
// START SERVER
// ===========================================

// Start the server
const server = app.listen(PORT, () => {
  console.log(`
🚀 Server running on port ${PORT}
📁 Environment: ${process.env.NODE_ENV}
📅 Date: ${new Date().toLocaleString("id-ID")}
⏰ Scheduler: ${
    process.env.ENABLE_SCHEDULER === "true" ? "ENABLED" : "DISABLED"
  }
  `);

  // Start scheduler jika di-enable
  if (process.env.ENABLE_SCHEDULER === "true") {
    console.log("⏰ Starting scheduler...");
    try {
      scheduler.start();

      // Periksa apakah scheduler benar-benar running
      setTimeout(() => {
        const status = scheduler.getStatus();
        console.log(
          `✅ Scheduler started: ${status.isRunning ? "RUNNING" : "STOPPED"}`
        );
        console.log(`📊 Active jobs: ${status.jobCount}`);
      }, 1000);
    } catch (error) {
      console.error("❌ Failed to start scheduler:", error);
    }
  } else {
    console.log("⏸️  Scheduler disabled (set ENABLE_SCHEDULER=true in .env)");
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  if (scheduler.stop) scheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  if (scheduler.stop) scheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

module.exports = server;
