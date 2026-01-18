const express = require("express");
const router = express.Router();
const DashboardController = require("../controllers/dashboard.controller");
const { authenticate } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get dashboard statistics
router.get("/stats", DashboardController.getDashboardStats);

// Get monthly revenue
router.get("/monthly-revenue", DashboardController.getMonthlyRevenue);

module.exports = router;
