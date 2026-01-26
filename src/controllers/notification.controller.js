const fonnteService = require("../services/fonnte.service");
const logger = require("../utils/logger");

exports.testNotification = async (req, res) => {
  try {
    const { phone, message } = req.body;

    logger.info("Test notification request:", { phone });

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Nomor telepon diperlukan",
      });
    }

    const testMessage =
      message ||
      `✅ Test notifikasi dari Billing WiFi\n🕐 ${new Date().toLocaleString("id-ID")}`;

    const result = await fonnteService.sendMessage(phone, testMessage);

    if (result.success) {
      res.json({
        success: true,
        message: "Test notification sent successfully",
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to send notification",
        error: result.error,
        response: result.response,
      });
    }
  } catch (error) {
    logger.error("Notification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.checkDeviceStatus = async (req, res) => {
  try {
    const result = await fonnteService.checkDeviceStatus();

    if (result.success) {
      res.json({
        success: true,
        message: "Device status retrieved",
        data: result.data,
        device: result.device,
        connected: result.connected,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to check device status",
        error: result.error,
      });
    }
  } catch (error) {
    logger.error("Device status error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.healthCheck = async (req, res) => {
  try {
    const health = await fonnteService.healthCheck();

    if (health.healthy) {
      res.json({
        success: true,
        message: "Fonnte service is healthy",
        data: health,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        success: false,
        message: "Fonnte service is not healthy",
        data: health,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error("Health check error:", error);
    res.status(500).json({
      success: false,
      message: "Health check failed",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

exports.triggerReminderJob = async (req, res) => {
  try {
    const { phone, days = 1, type = "test" } = req.query;

    logger.info(`Triggering reminder job - type: ${type}, phone: ${phone}`);

    if (type === "test" && phone) {
      // Test untuk nomor tertentu
      const customerReminderJob = require("../jobs/customerReminder");
      const result = await customerReminderJob.triggerManual({
        phone,
        days: parseInt(days),
      });

      if (result.success) {
        res.json({
          success: true,
          message: `Test reminder berhasil dikirim ke ${phone}`,
          data: result.data,
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Gagal mengirim test reminder",
          error: result.error,
        });
      }
    } else {
      // Jalankan job sebenarnya
      const customerReminderJob = require("../jobs/customerReminder");
      await customerReminderJob.run();

      res.json({
        success: true,
        message: "Reminder job dijalankan",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error("Trigger reminder error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getReminderStats = async (req, res) => {
  try {
    // Try to get stats from customer reminder job
    const customerReminderJob = require("../jobs/customerReminder");
    const stats = await customerReminderJob.getExpiringCustomers();

    // Get recent logs from notification_logs if table exists
    let recentLogs = [];
    try {
      const NotificationLog = require("../models/NotificationLog");
      recentLogs = await NotificationLog.getRecentLogs(10);
    } catch (error) {
      logger.warn("NotificationLog model not available:", error.message);
    }

    res.json({
      success: true,
      data: {
        expiring_tomorrow: stats.total_tomorrow || 0,
        expiring_in_3_days: stats.total_3_days || 0,
        recent_notifications: recentLogs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Simple test endpoint
exports.test = (req, res) => {
  res.json({
    success: true,
    message: "Notification controller is working",
    timestamp: new Date().toISOString(),
  });
};
