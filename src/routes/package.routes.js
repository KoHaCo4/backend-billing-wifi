const express = require("express");
const router = express.Router();
const PackageController = require("../controllers/package.controller");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get all packages (with optional ?all=true parameter)
router.get("/", PackageController.list);

// Create package (admin only)
router.post("/", authorize("admin", "superadmin"), PackageController.create);

// Get package by ID
router.get("/:id", PackageController.getById);

// Update package (admin only)
router.put("/:id", authorize("admin", "superadmin"), PackageController.update);

// Delete package (admin only)
router.delete(
  "/:id",
  authorize("admin", "superadmin"),
  PackageController.delete
);

module.exports = router;
