const express = require("express");
const router = express.Router();
const pool = require("../config/database");
const os = require("os");

router.get("/detailed", async (req, res) => {
  try {
    // Database health
    let dbStatus = "unknown";
    let dbConnections = 0;

    try {
      const [rows] = await pool.query("SELECT 1 as health");
      dbStatus = rows.length > 0 ? "healthy" : "unhealthy";

      // Get connection pool stats
      const [stats] = await pool.query("SHOW STATUS LIKE 'Threads_connected'");
      dbConnections = stats[0]?.Value || 0;
    } catch (dbError) {
      dbStatus = "error";
    }

    // System health
    const systemHealth = {
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      freemem: os.freemem(),
      totalmem: os.totalmem(),
      cpus: os.cpus().length,
    };

    // Process health
    const processHealth = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      pid: process.pid,
    };

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      health: {
        database: {
          status: dbStatus,
          connections: dbConnections,
        },
        system: systemHealth,
        process: processHealth,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
