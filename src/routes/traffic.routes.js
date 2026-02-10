const express = require("express");
const router = express.Router();
const TrafficController = require("../controllers/traffic.controller");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);

// Get realtime traffic data
router.get("/realtime", TrafficController.getRealtimeTraffic);

// Get customer traffic history
router.get("/customer/:customerId", TrafficController.getCustomerTraffic);

// Get router interface statistics
router.get("/router/:routerId", TrafficController.getRouterTraffic);

// Get bandwidth usage summary
router.get("/summary", TrafficController.getTrafficSummary);

// Manual bandwidth control (admin only)
router.post(
  "/customer/:customerId/limit",
  authorize("admin", "superadmin"),
  TrafficController.setBandwidthLimit,
);

// Reset customer usage (admin only)
router.post(
  "/customer/:customerId/reset",
  authorize("admin", "superadmin"),
  TrafficController.resetUsage,
);

// Get active PPPoE sessions ← INI HARUS ADA
router.get("/sessions/active", TrafficController.getActiveSessions);

module.exports = router;
