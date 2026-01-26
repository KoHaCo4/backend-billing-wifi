// routes/monitoring.routes.js
const express = require("express");
const router = express.Router();
const SessionMonitoringService = require("../services/session-monitoring.service");
const { authenticate } = require("../middleware/auth");

// Get monitoring data
router.get("/", authenticate, async (req, res) => {
  try {
    const { router_id, search, limit = 100 } = req.query;

    console.log("📡 Requesting monitoring data with filters:", req.query);

    const filter = {};
    if (router_id) filter.router_id = parseInt(router_id);
    if (search) filter.search = search;

    const monitoringData =
      await SessionMonitoringService.getMonitoringData(filter);

    // Apply limit if specified
    if (limit && parseInt(limit) > 0) {
      monitoringData.data = monitoringData.data.slice(0, parseInt(limit));
    }

    res.json({
      success: true,
      message: `Found ${monitoringData.data.length} customers, ${monitoringData.statistics.online} online`,
      data: monitoringData,
    });
  } catch (error) {
    console.error("❌ Error getting monitoring data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get monitoring data: " + error.message,
    });
  }
});

// Get real-time statistics
router.get("/stats", authenticate, async (req, res) => {
  try {
    const monitoringData = await SessionMonitoringService.getMonitoringData({});

    res.json({
      success: true,
      data: monitoringData.statistics,
    });
  } catch (error) {
    console.error("❌ Error getting statistics:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Disconnect customer session
router.post("/customer/:id/disconnect", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await SessionMonitoringService.disconnectCustomerSession(id);

    res.json({
      success: true,
      message: "Customer session disconnected",
      data: result,
    });
  } catch (error) {
    console.error("❌ Error disconnecting session:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get router status
router.get("/routers/status", authenticate, async (req, res) => {
  try {
    const routerData =
      await SessionMonitoringService.getActiveSessionsFromRouters();

    res.json({
      success: true,
      data: {
        router_status: routerData.router_status,
        timestamp: routerData.timestamp,
      },
    });
  } catch (error) {
    console.error("❌ Error getting router status:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
