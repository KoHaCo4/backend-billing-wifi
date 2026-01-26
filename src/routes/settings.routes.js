const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const settingsController = require("../controllers/settings.controller");

// GET settings - hanya untuk user yang terautentikasi
router.get("/", authenticate, settingsController.getSettings);

// UPDATE settings - hanya untuk user yang terautentikasi
router.put("/", authenticate, settingsController.updateSettings);

// POST settings (alternate) - hanya untuk user yang terautentikasi
router.post("/", authenticate, settingsController.postSettings);

// GET notification settings
router.get(
  "/notifications",
  authenticate,
  settingsController.getNotificationSettings,
);

// UPDATE notification settings
router.put(
  "/notifications",
  authenticate,
  settingsController.updateNotificationSettings,
);

// GET health info (public, no auth required)
router.get("/health", settingsController.getHealth);

// Test endpoint tanpa auth
router.get("/test-no-auth", (req, res) => {
  res.json({
    success: true,
    message: "This endpoint works without authentication",
    timestamp: new Date().toISOString(),
  });
});

// Test endpoint dengan auth
router.get("/test-with-auth", authenticate, (req, res) => {
  res.json({
    success: true,
    message: "This endpoint requires authentication",
    user: req.user,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
