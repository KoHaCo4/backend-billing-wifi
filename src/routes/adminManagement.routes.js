const express = require("express");
const router = express.Router();
const AdminManagementController = require("../controllers/adminManagement.controller");
const { authenticate, authorize } = require("../middleware/auth");

// Semua route memerlukan autentikasi
router.use(authenticate);

// Profile routes (accessible by all admins)
router.get("/profile", AdminManagementController.getProfile);
router.put("/profile", AdminManagementController.updateProfile);
router.get("/stats", AdminManagementController.getAdminStats);

// Admin management routes (superadmin only)
router.get(
  "/",
  authorize("superadmin"), // Gunakan authorize, bukan requireRole
  AdminManagementController.getAllAdmins,
);
router.post(
  "/",
  authorize("superadmin"),
  AdminManagementController.createAdmin,
);
router.put(
  "/:id",
  authorize("superadmin"),
  AdminManagementController.updateAdmin,
);
router.delete(
  "/:id",
  authorize("superadmin"),
  AdminManagementController.deleteAdmin,
);

module.exports = router;
