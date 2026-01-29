const db = require("../config/database");
const logger = require("../utils/logger");

// Default settings
const getDefaultSettings = () => {
  return {
    general: {
      siteName: "Billing WiFi",
      timezone: "Asia/Jakarta",
      currency: "IDR",
      dateFormat: "DD/MM/YYYY",
      language: "id",
    },
    billing: {
      autoSuspend: true,
      gracePeriod: 3,
      suspendWithPendingInvoices: true,
      taxRate: 0,
      invoicePrefix: "INV",
    },
    scheduler: {
      suspendCheckHour: 1,
      expiringCheckHour: 9,
      overdueCheckHour: 2,
      autoSuspendEnabled: true,
    },
    mikrotik: {
      timeout: 5000,
      retryAttempts: 3,
      mockMode: false,
      autoSync: true,
    },
    notifications: {
      emailNotifications: true,
      notifyOnSuspend: true,
      notifyOnPayment: true,
      notifyBeforeExpiry: true,
      daysBeforeExpiry: 3,
      whatsappEnabled: true,
      whatsappProvider: "fonnte",
      fonnteApiToken: "",
      fonnteDeviceId: "",
      fonnteSender: "BillingWifi",
    },
    whatsapp: {
      enableReminder: true,
      reminderSchedule: "0 9,15 * * *", // Default jam 09:00 dan 15:00
      daysBefore: [3, 1], // H-3 dan H-1
      enablePaymentLinks: true,
      testPhoneNumber: "",
      companyName: "Billing WiFi",
      companyPhone: "081234567890",
      paymentLinkExpiryHours: 24,
      useEnvironmentVars: true, // Gunakan env var atau dari settings
    },
  };
};

class SettingsController {
  // GET settings
  getSettings = async (req, res) => {
    // Gunakan arrow function
    try {
      logger.info("📋 GET /settings - Request by user:", req.user.id);

      // Cek jika ada settings di database untuk user ini
      const [settings] = await db.query(
        `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [req.user.id],
      );

      let settingsData;

      if (settings.length > 0 && settings[0].settings_json) {
        const dbData = settings[0].settings_json;

        // Cek tipe data - bisa string atau sudah object
        if (typeof dbData === "string") {
          try {
            settingsData = JSON.parse(dbData);
          } catch (e) {
            logger.error("❌ Error parsing JSON string:", e);
            settingsData = getDefaultSettings();
          }
        } else if (typeof dbData === "object") {
          // Sudah object, langsung pakai
          settingsData = dbData;
        } else {
          settingsData = getDefaultSettings();
        }

        logger.info("✅ Settings loaded from DB:", Object.keys(settingsData));
      } else {
        logger.info("⚠️ No settings found, using defaults");
        settingsData = getDefaultSettings();
      }

      res.json({
        success: true,
        message: "Settings loaded",
        data: settingsData,
      });
    } catch (error) {
      logger.error("❌ Error in GET /settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to load settings",
        error: error.message,
      });
    }
  };

  // UPDATE settings dengan merge
  updateSettings = async (req, res) => {
    // Gunakan arrow function
    try {
      logger.info("📝 PUT /settings - Saving settings...");
      logger.info("User ID:", req.user.id);
      logger.info("Request body keys:", Object.keys(req.body));

      // Log detail setiap kategori
      Object.keys(req.body).forEach((category) => {
        if (typeof req.body[category] === "object") {
          logger.info(`  ${category}:`, Object.keys(req.body[category]));
        }
      });

      const newSettings = req.body;

      // 1. Get existing settings
      const [existingSettings] = await db.query(
        `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [req.user.id],
      );

      let finalSettings = getDefaultSettings();

      // 2. Merge with existing if exists
      if (existingSettings.length > 0 && existingSettings[0].settings_json) {
        const oldData =
          typeof existingSettings[0].settings_json === "string"
            ? JSON.parse(existingSettings[0].settings_json)
            : existingSettings[0].settings_json;

        logger.info("Old data keys:", Object.keys(oldData));

        // Deep merge
        finalSettings = {
          general: {
            ...getDefaultSettings().general,
            ...oldData.general,
            ...newSettings.general,
          },
          billing: {
            ...getDefaultSettings().billing,
            ...oldData.billing,
            ...newSettings.billing,
          },
          scheduler: {
            ...getDefaultSettings().scheduler,
            ...oldData.scheduler,
            ...newSettings.scheduler,
          },
          mikrotik: {
            ...getDefaultSettings().mikrotik,
            ...oldData.mikrotik,
            ...newSettings.mikrotik,
          },
          notifications: {
            ...getDefaultSettings().notifications,
            ...oldData.notifications,
            ...newSettings.notifications,
          },
          whatsapp: {
            ...getDefaultSettings().whatsapp,
            ...oldData.whatsapp,
            ...newSettings.whatsapp,
          },
        };

        // VALIDASI WHATSAPP SETTINGS SETELAH MERGE
        if (finalSettings.whatsapp) {
          // 1. Pastikan daysBefore adalah array
          if (!Array.isArray(finalSettings.whatsapp.daysBefore)) {
            // Coba parse jika string
            if (typeof finalSettings.whatsapp.daysBefore === "string") {
              try {
                finalSettings.whatsapp.daysBefore = JSON.parse(
                  finalSettings.whatsapp.daysBefore,
                );
              } catch (e) {
                finalSettings.whatsapp.daysBefore = [3, 1]; // Default
              }
            } else if (finalSettings.whatsapp.daysBefore === false) {
              // Jika false, ubah ke array default
              finalSettings.whatsapp.daysBefore = [3, 1];
            } else {
              finalSettings.whatsapp.daysBefore = [3, 1]; // Default
            }
          }

          // 2. Pastikan reminderSchedule tidak kosong
          if (
            !finalSettings.whatsapp.reminderSchedule ||
            finalSettings.whatsapp.reminderSchedule.trim() === ""
          ) {
            finalSettings.whatsapp.reminderSchedule = "*/2 * * * *"; // Default dev
            if (process.env.NODE_ENV === "production") {
              finalSettings.whatsapp.reminderSchedule = "0 9,15 * * *";
            }
          }

          // 3. Pastikan paymentLinkExpiryHours angka
          if (
            !finalSettings.whatsapp.paymentLinkExpiryHours ||
            isNaN(parseInt(finalSettings.whatsapp.paymentLinkExpiryHours))
          ) {
            finalSettings.whatsapp.paymentLinkExpiryHours = 24; // Default 24 jam
          } else {
            finalSettings.whatsapp.paymentLinkExpiryHours = parseInt(
              finalSettings.whatsapp.paymentLinkExpiryHours,
            );
          }

          // 4. Pastikan companyName tidak kosong
          if (
            !finalSettings.whatsapp.companyName ||
            finalSettings.whatsapp.companyName.trim() === ""
          ) {
            finalSettings.whatsapp.companyName = "Billing WiFi";
          }

          // 5. Pastikan enableReminder boolean
          if (typeof finalSettings.whatsapp.enableReminder !== "boolean") {
            finalSettings.whatsapp.enableReminder = true;
          }

          // 6. Pastikan enablePaymentLinks boolean
          if (typeof finalSettings.whatsapp.enablePaymentLinks !== "boolean") {
            finalSettings.whatsapp.enablePaymentLinks = true;
          }

          logger.info(
            "✅ Validated WhatsApp settings:",
            finalSettings.whatsapp,
          );
        }

        logger.info(
          "After merge - general keys:",
          Object.keys(finalSettings.general),
        );
      } else {
        // No existing data, use new + defaults
        finalSettings = {
          general: { ...getDefaultSettings().general, ...newSettings.general },
          billing: { ...getDefaultSettings().billing, ...newSettings.billing },
          scheduler: {
            ...getDefaultSettings().scheduler,
            ...newSettings.scheduler,
          },
          mikrotik: {
            ...getDefaultSettings().mikrotik,
            ...newSettings.mikrotik,
          },
          notifications: {
            ...getDefaultSettings().notifications,
            ...newSettings.notifications,
          },
          whatsapp: {
            ...getDefaultSettings().whatsapp,
            ...newSettings.whatsapp,
          },
        };
      }

      // 3. Validate all required fields are present
      const missingFields = [];
      Object.keys(getDefaultSettings()).forEach((category) => {
        Object.keys(getDefaultSettings()[category]).forEach((field) => {
          if (finalSettings[category][field] === undefined) {
            missingFields.push(`${category}.${field}`);
          }
        });
      });

      if (missingFields.length > 0) {
        logger.warn("⚠️ Missing fields after merge:", missingFields);
        // Fill missing with defaults
        missingFields.forEach((path) => {
          const [category, field] = path.split(".");
          finalSettings[category][field] =
            getDefaultSettings()[category][field];
        });
      }

      logger.info("✅ Final settings to save:", Object.keys(finalSettings));

      // 4. Save to database
      const settingsJson = JSON.stringify(finalSettings);

      await db.query(
        `INSERT INTO settings (admin_id, settings_json) 
         VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE 
         settings_json = VALUES(settings_json), 
         updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, settingsJson],
      );

      logger.info("✅ Settings saved successfully");

      // 5. Restart scheduler jika ada perubahan
      try {
        const scheduler = require("../jobs/scheduler");
        logger.info("🔄 Restarting scheduler due to settings update...");
        scheduler.stop();
        await scheduler.start();
        logger.info("✅ Scheduler restarted successfully");
      } catch (err) {
        logger.error("❌ Failed to restart scheduler:", err.message);
      }

      // 6. PERBAIKAN INI: Update CustomerReminderJob dengan admin_id yang benar
      try {
        const customerReminderJob = require("../jobs/customerReminder");

        // Set admin_id ke job
        customerReminderJob.setAdminId(req.user.id);

        // Load settings ulang
        await customerReminderJob.loadWhatsAppSettings();

        // Restart job jika perlu
        if (customerReminderJob.job) {
          customerReminderJob.stop();
          await customerReminderJob.start();
        } else {
          await customerReminderJob.start();
        }

        logger.info("✅ Customer reminder job updated with correct admin_id");
      } catch (jobError) {
        logger.warn("⚠️ Failed to update reminder job:", jobError.message);
      }

      res.json({
        success: true,
        message: "Settings saved successfully",
        data: finalSettings,
        savedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("❌ Error saving settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to save settings",
        error: error.message,
      });
    }
  };

  // POST settings (alternate method) - FIX THIS FUNCTION
  postSettings = async (req, res) => {
    // Gunakan arrow function
    logger.info("📝 POST /settings - Using PUT method instead");
    try {
      // Langsung panggil updateSettings dengan context yang benar
      return await this.updateSettings(req, res);
    } catch (error) {
      logger.error("❌ Error in POST /settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process request",
        error: error.message,
      });
    }
  };

  // GET health info
  getHealth = async (req, res) => {
    // Gunakan arrow function
    try {
      const [dbStatus] = await db.query("SELECT 1 as connected");
      const dbConnected = dbStatus.length > 0;

      // Get stats
      const [customerCount] = await db.query(
        "SELECT COUNT(*) as count FROM customers",
      );
      const [invoiceCount] = await db.query(
        "SELECT COUNT(*) as count FROM invoices",
      );
      const [routerCount] = await db.query(
        "SELECT COUNT(*) as count FROM routers",
      );

      res.json({
        success: true,
        data: {
          status: "OK",
          uptime: process.uptime(),
          database: dbConnected ? "connected" : "disconnected",
          version: "1.0.0",
          environment: process.env.NODE_ENV,
          stats: {
            customers: customerCount[0]?.count || 0,
            invoices: invoiceCount[0]?.count || 0,
            routers: routerCount[0]?.count || 0,
          },
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("❌ Health check error:", error);
      res.status(500).json({
        success: false,
        message: "Health check failed",
      });
    }
  };

  // Get WhatsApp settings
  getWhatsAppSettings = async (req, res) => {
    try {
      const settings = await this.getUserSettings(req.user.id);

      res.json({
        success: true,
        data: settings.whatsapp || getDefaultSettings().whatsapp,
      });
    } catch (error) {
      logger.error("Error getting WhatsApp settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get WhatsApp settings",
      });
    }
  };

  // Method untuk trigger test WhatsApp
  testWhatsApp = async (req, res) => {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({
          success: false,
          message: "Phone number is required",
        });
      }

      // Panggil customerReminderJob untuk test
      const customerReminderJob = require("../jobs/customerReminder");

      const result = await customerReminderJob.triggerManual({
        phone: phone,
        days: 1,
        name: "Test Customer",
        package_name: "Paket Test",
        amount: 100000,
      });

      res.json({
        success: result.status === "success",
        message:
          result.status === "success"
            ? "Test message sent successfully"
            : "Failed to send test message",
        data: result,
      });
    } catch (error) {
      logger.error("Error testing WhatsApp:", error);
      res.status(500).json({
        success: false,
        message: "Failed to test WhatsApp",
        error: error.message,
      });
    }
  };

  // Get notification settings
  getNotificationSettings = async (req, res) => {
    // Gunakan arrow function
    try {
      const settings = await this.getUserSettings(req.user.id);

      res.json({
        success: true,
        data: settings.notifications || getDefaultSettings().notifications,
      });
    } catch (error) {
      logger.error("Error getting notification settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get notification settings",
      });
    }
  };

  // Update notification settings
  updateNotificationSettings = async (req, res) => {
    // Gunakan arrow function
    try {
      const notificationSettings = req.body;

      // Get current settings
      const currentSettings = await this.getUserSettings(req.user.id);

      // Merge with new notification settings
      const updatedSettings = {
        ...currentSettings,
        notifications: {
          ...currentSettings.notifications,
          ...notificationSettings,
        },
      };

      // Save to database
      await this.saveUserSettings(req.user.id, updatedSettings);

      res.json({
        success: true,
        message: "Notification settings updated",
        data: updatedSettings.notifications,
      });
    } catch (error) {
      logger.error("Error updating notification settings:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update notification settings",
      });
    }
  };

  // Helper method: Get user settings
  getUserSettings = async (userId) => {
    // Gunakan arrow function
    const [settings] = await db.query(
      `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [userId],
    );

    if (settings.length > 0 && settings[0].settings_json) {
      const dbData = settings[0].settings_json;
      if (typeof dbData === "string") {
        return JSON.parse(dbData);
      }
      return dbData;
    }

    return getDefaultSettings();
  };

  // Helper method: Save user settings
  saveUserSettings = async (userId, settings) => {
    // Gunakan arrow function
    const settingsJson = JSON.stringify(settings);

    await db.query(
      `INSERT INTO settings (admin_id, settings_json) 
       VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE 
       settings_json = VALUES(settings_json), 
       updated_at = CURRENT_TIMESTAMP`,
      [userId, settingsJson],
    );
  };
}

// Ekspor instance, bukan class
module.exports = new SettingsController();
