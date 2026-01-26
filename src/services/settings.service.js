const db = require("../config/database");
const logger = require("../utils/logger");

class SettingsService {
  constructor() {
    this.defaultSettings = this.getDefaultSettings();
  }

  getDefaultSettings() {
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
    };
  }

  async getUserSettings(userId) {
    try {
      const [settings] = await db.query(
        `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [userId],
      );

      if (settings.length === 0) {
        return this.defaultSettings;
      }

      const dbData = settings[0].settings_json;

      if (typeof dbData === "string") {
        try {
          return JSON.parse(dbData);
        } catch (error) {
          logger.error("Error parsing settings JSON:", error);
          return this.defaultSettings;
        }
      }

      return dbData;
    } catch (error) {
      logger.error("Error getting user settings:", error);
      return this.defaultSettings;
    }
  }

  async saveUserSettings(userId, settings) {
    try {
      // Validate and merge with defaults
      const validatedSettings = this.validateAndMerge(settings);
      const settingsJson = JSON.stringify(validatedSettings);

      await db.query(
        `INSERT INTO settings (admin_id, settings_json) 
         VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE 
         settings_json = VALUES(settings_json), 
         updated_at = CURRENT_TIMESTAMP`,
        [userId, settingsJson],
      );

      logger.info(`Settings saved for user ${userId}`);
      return validatedSettings;
    } catch (error) {
      logger.error("Error saving user settings:", error);
      throw error;
    }
  }

  validateAndMerge(settings) {
    const merged = { ...this.defaultSettings };

    // Deep merge for each category
    Object.keys(this.defaultSettings).forEach((category) => {
      if (settings[category] && typeof settings[category] === "object") {
        merged[category] = {
          ...this.defaultSettings[category],
          ...settings[category],
        };
      }
    });

    return merged;
  }

  async getNotificationSettings(userId) {
    const settings = await this.getUserSettings(userId);
    return settings.notifications || this.defaultSettings.notifications;
  }

  async updateNotificationSettings(userId, notificationSettings) {
    const currentSettings = await this.getUserSettings(userId);

    const updatedSettings = {
      ...currentSettings,
      notifications: {
        ...currentSettings.notifications,
        ...notificationSettings,
      },
    };

    return await this.saveUserSettings(userId, updatedSettings);
  }

  async getBillingSettings(userId) {
    const settings = await this.getUserSettings(userId);
    return settings.billing || this.defaultSettings.billing;
  }

  async getSchedulerSettings(userId) {
    const settings = await this.getUserSettings(userId);
    return settings.scheduler || this.defaultSettings.scheduler;
  }
}

module.exports = new SettingsService();
