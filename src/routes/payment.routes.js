const express = require("express");
const router = express.Router();
const PaymentController = require("../controllers/payment.controller");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get all payments (Admin only)
router.get(
  "/",
  authorize("admin", "superadmin"),
  PaymentController.getPayments,
);

// Get payment statistics (Admin only)
router.get(
  "/stats",
  authorize("admin", "superadmin"),
  PaymentController.getStatistics,
);

// Get payment by ID (Admin only)
router.get(
  "/:id",
  authorize("admin", "superadmin"),
  PaymentController.getPayment,
);

// Get customer payments (Customer can see their own)
router.get("/customer/:customer_id", PaymentController.getCustomerPayments);

// Create manual payment (Admin only)
router.post(
  "/manual",
  authorize("admin", "superadmin"),
  PaymentController.createManualPayment,
);

// ============ MIDTRANS ENDPOINTS ============

// Create Snap transaction (Customer can create for their own invoices)
router.post("/snap/create", PaymentController.createSnapTransaction);

// Get Snap.js configuration
router.get("/config/snap", PaymentController.getSnapConfig);

// Check payment status
router.get("/status/:order_id", PaymentController.checkPaymentStatus);

// Manual verify payment (Admin only)
router.post(
  "/:payment_id/verify",
  authorize("admin", "superadmin"),
  PaymentController.manualVerifyPayment,
);

// Get payment methods
router.get("/methods/all", PaymentController.getPaymentMethods);

// ============ WEBHOOK (NO AUTH) ============

// Midtrans webhook callback (no authentication needed)
router.post("/callback/midtrans", PaymentController.midtransWebhook);

// Test endpoint
router.get("/test", PaymentController.testPayments);

module.exports = router;
