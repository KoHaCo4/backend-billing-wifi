const express = require("express");
const router = express.Router();
const statsController = require("../controllers/stats.controller");
const { authenticate } = require("../middleware/auth"); // Ganti auth jadi authenticate

// Apply authenticate middleware to all routes
router.use(authenticate);

// Dashboard statistics
router.get("/dashboard", statsController.getDashboardStats);

// Quick stats (for widgets/sidebar)
router.get("/quick", statsController.getQuickStats);

module.exports = router;
