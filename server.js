require("dotenv").config();
const app = require("./src/app");
const scheduler = require("./src/jobs/scheduler");
const { authenticate } = require("./src/middleware/auth");
const http = require("http");

// Import WebSocket
const { wss } = require("./src/websocket/traffic.websocket");

// Import Traffic Monitor Job
const trafficMonitorJob = require("./src/jobs/traffic-monitor.job");

const PORT = process.env.PORT || 5555;

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket to the same server
server.on("upgrade", (request, socket, head) => {
  console.log("🔄 HTTP upgrade request for WebSocket");

  // Handle WebSocket upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
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

// Start traffic monitor
trafficMonitorJob.start();

// ===========================================
// START SERVER
// ===========================================

// Start the server
server.listen(PORT, () => {
  console.log(`
🚀 Server running on port ${PORT}
🔌 WebSocket ready at ws://localhost:${PORT}
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
          `✅ Scheduler started: ${status.isRunning ? "RUNNING" : "STOPPED"}`,
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

// Export functions untuk digunakan di job
global.broadcastTrafficUpdate =
  require("./src/websocket/traffic.websocket").broadcastTrafficUpdate;
global.broadcastCustomerUpdate =
  require("./src/websocket/traffic.websocket").broadcastCustomerUpdate;
global.broadcastSystemAlert =
  require("./src/websocket/traffic.websocket").broadcastSystemAlert;

module.exports = server;
