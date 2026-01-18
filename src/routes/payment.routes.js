const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/payment.controller");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get all payments
router.get(
  "/",
  authorize("admin", "superadmin"),
  PaymentController.getPayments,
);

// Get payment statistics
router.get(
  "/stats",
  authorize("admin", "superadmin"),
  PaymentController.getStatistics,
);

// Get payment by ID
router.get(
  "/:id",
  authorize("admin", "superadmin"),
  PaymentController.getPayment,
);

router.get("/test", PaymentController.testPayments);

module.exports = router;
