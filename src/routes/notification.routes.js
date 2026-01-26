const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

// Test notification
router.post("/test", notificationController.testNotification);

// Check device status
router.get("/device-status", notificationController.checkDeviceStatus);

// Health check
router.get("/health", notificationController.healthCheck);

// Trigger reminder manually
router.get("/trigger-reminder", notificationController.triggerReminderJob);

// Get reminder stats
router.get("/stats", notificationController.getReminderStats);

module.exports = router;
