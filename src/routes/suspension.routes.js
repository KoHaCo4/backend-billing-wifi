// src/routes/suspension.routes.js - PERBAIKAN
const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const suspensionController = require("../controllers/suspension.controller");

// Pastikan file controller ada
try {
  // Gunakan middleware untuk semua route
  router.use(authenticate);

  // Definisikan routes
  router.get("/stats", suspensionController.getStats);
  router.get("/expiring-soon", suspensionController.getExpiringSoon);
  router.post("/trigger-auto-suspend", suspensionController.triggerAutoSuspend);
  router.get("/test-connection", suspensionController.testMikrotikConnection);

  module.exports = router;
} catch (error) {
  console.error("❌ Error loading suspension routes:", error.message);
  // Export router kosong jika ada error
  module.exports = router;
}
