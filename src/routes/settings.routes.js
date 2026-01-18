const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const db = require("../config/database");

// GET settings
router.get("/", authenticate, async (req, res) => {
  try {
    console.log("📋 GET /settings - Request by user:", req.user.id);

    // Cek jika ada settings di database untuk user ini
    const [settings] = await db.query(
      `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [req.user.id]
    );

    let settingsData;

    if (settings.length > 0 && settings[0].settings_json) {
      const dbData = settings[0].settings_json;

      // Cek tipe data - bisa string atau sudah object
      if (typeof dbData === "string") {
        try {
          settingsData = JSON.parse(dbData);
        } catch (e) {
          console.error("❌ Error parsing JSON string:", e);
          settingsData = getDefaultSettings();
        }
      } else if (typeof dbData === "object") {
        // Sudah object, langsung pakai
        settingsData = dbData;
      } else {
        settingsData = getDefaultSettings();
      }

      console.log("✅ Settings loaded from DB:", Object.keys(settingsData));
    } else {
      console.log("⚠️ No settings found, using defaults");
      settingsData = getDefaultSettings();
    }

    res.json({
      success: true,
      message: "Settings loaded",
      data: settingsData,
    });
  } catch (error) {
    console.error("❌ Error in GET /settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load settings",
      error: error.message,
    });
  }
});

// UPDATE settings dengan merge
router.put("/", authenticate, async (req, res) => {
  try {
    console.log("📝 PUT /settings - Saving settings...");
    console.log("User ID:", req.user.id);
    console.log("Request body keys:", Object.keys(req.body));

    // Log detail setiap kategori
    Object.keys(req.body).forEach((category) => {
      if (typeof req.body[category] === "object") {
        console.log(`  ${category}:`, Object.keys(req.body[category]));
      }
    });

    const newSettings = req.body;

    // 1. Get existing settings
    const [existingSettings] = await db.query(
      `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [req.user.id]
    );

    let finalSettings = getDefaultSettings();

    // 2. Merge with existing if exists
    if (existingSettings.length > 0 && existingSettings[0].settings_json) {
      const oldData =
        typeof existingSettings[0].settings_json === "string"
          ? JSON.parse(existingSettings[0].settings_json)
          : existingSettings[0].settings_json;

      console.log("Old data keys:", Object.keys(oldData));

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
      };

      console.log(
        "After merge - general keys:",
        Object.keys(finalSettings.general)
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
        mikrotik: { ...getDefaultSettings().mikrotik, ...newSettings.mikrotik },
        notifications: {
          ...getDefaultSettings().notifications,
          ...newSettings.notifications,
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
      console.warn("⚠️ Missing fields after merge:", missingFields);
      // Fill missing with defaults
      missingFields.forEach((path) => {
        const [category, field] = path.split(".");
        finalSettings[category][field] = getDefaultSettings()[category][field];
      });
    }

    console.log("✅ Final settings to save:", Object.keys(finalSettings));

    // 4. Save to database
    const settingsJson = JSON.stringify(finalSettings);

    await db.query(
      `INSERT INTO settings (admin_id, settings_json) 
       VALUES (?, ?) 
       ON DUPLICATE KEY UPDATE 
       settings_json = VALUES(settings_json), 
       updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, settingsJson]
    );

    console.log("✅ Settings saved successfully");

    try {
      const scheduler = require("../jobs/scheduler");

      console.log("🔄 Restarting scheduler due to settings update...");
      scheduler.stop();
      await scheduler.start();

      console.log("✅ Scheduler restarted successfully");
    } catch (err) {
      console.error("❌ Failed to restart scheduler:", err.message);
    }

    res.json({
      success: true,
      message: "Settings saved successfully",
      data: finalSettings,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Error saving settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save settings",
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// POST settings (alternate method)
router.post("/", authenticate, async (req, res) => {
  console.log("📝 POST /settings - Using PUT method instead");
  try {
    // Forward ke PUT handler
    req.method = "PUT";
    const putRoute = router.stack.find(
      (layer) =>
        layer.route && layer.route.path === "/" && layer.route.methods.put
    );

    if (putRoute && putRoute.route) {
      // Panggil handler PUT
      return putRoute.route.stack[0].handle(req, res);
    } else {
      // Jika tidak ditemukan, gunakan PUT handler yang sama
      return await router.handle(req, res);
    }
  } catch (error) {
    console.error("❌ Error in POST /settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process request",
      error: error.message,
    });
  }
});

// GET health info
router.get("/health", async (req, res) => {
  // Hapus authenticate untuk testing
  try {
    const [dbStatus] = await db.query("SELECT 1 as connected");
    const dbConnected = dbStatus.length > 0;

    // Get stats
    const [customerCount] = await db.query(
      "SELECT COUNT(*) as count FROM customers"
    );
    const [invoiceCount] = await db.query(
      "SELECT COUNT(*) as count FROM invoices"
    );
    const [routerCount] = await db.query(
      "SELECT COUNT(*) as count FROM routers"
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
    console.error("❌ Health check error:", error);
    res.status(500).json({
      success: false,
      message: "Health check failed",
    });
  }
});

// Helper function
function getDefaultSettings() {
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
    },
  };
}

module.exports = router;
