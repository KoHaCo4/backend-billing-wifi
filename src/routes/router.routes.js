const express = require("express");
const router = express.Router();
const RouterController = require("../controllers/router.controller");
const { authenticate, authorize } = require("../middleware/auth");

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

module.exports = router;
