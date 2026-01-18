// backend/src/routes/router.routes.js
const express = require("express");
const router = express.Router();
const RouterController = require("../controllers/router.controller");
const { authenticate, authorize } = require("../middleware/auth");
const db = require("../config/database"); // TAMBAHKAN INI
const MikrotikService = require("../services/mikrotik.service"); // TAMBAHKAN INI (perhatikan kapital M)

// All routes require authentication
router.use(authenticate);

// Get all routers
router.get("/", RouterController.getRouters);

// Get router by ID
router.get("/:id", RouterController.getRouter);

// Test router connection (MikroTik)
router.get("/:id/test", RouterController.testConnection);

// Create router (admin only)
router.post(
  "/",
  authorize("admin", "superadmin"),
  RouterController.createRouter
);

// Update router (admin only)
router.put(
  "/:id",
  authorize("admin", "superadmin"),
  RouterController.updateRouter
);

// Delete router (admin only)
router.delete(
  "/:id",
  authorize("admin", "superadmin"),
  RouterController.deleteRouter
);

// Test all routers
router.post("/test-all", authenticate, RouterController.testAllRouters);

// Juga tambahkan GET untuk kompatibilitas
router.get("/test-all", authenticate, RouterController.testAllRouters);
// Test all routers
router.get("/test-all", authenticate, RouterController.testAllRouters);
router.post("/test-all", authenticate, RouterController.testAllRouters);

// Test all routers with progress (optional - untuk real-time updates)
router.get(
  "/test-all/progress",
  authenticate,
  RouterController.testAllRoutersWithProgress
);

// router.routes.js - tambahkan endpoint test sederhana
router.get("/test-all/mock", authenticate, (req, res) => {
  console.log("🧪 Returning mock router test results");

  const mockResults = [
    {
      routerId: 1,
      routerName: "Router Test 1",
      ipAddress: "192.168.1.1",
      status: "connected",
      message: "Mock connection successful",
      duration: 1500,
      timestamp: new Date().toISOString(),
    },
    {
      routerId: 2,
      routerName: "Router Test 2",
      ipAddress: "192.168.1.2",
      status: "disconnected",
      message: "Mock connection failed",
      duration: 2000,
      timestamp: new Date().toISOString(),
    },
  ];

  res.json({
    success: true,
    message: "Mock test completed",
    data: {
      results: mockResults,
      summary: {
        total: 2,
        connected: 1,
        disconnected: 1,
        errors: 0,
        successRate: 50,
      },
    },
  });
});

module.exports = router;
