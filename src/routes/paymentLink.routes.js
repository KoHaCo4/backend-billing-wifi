const express = require("express");
const router = express.Router();
const PaymentLinkController = require("../controllers/paymentLink.controller");

// Public routes (no authentication required for payment links)

// Check if payment link is valid
router.get("/check/:payment_code", PaymentLinkController.checkPaymentLink);

// Get payment page data
router.get("/page/:payment_code", PaymentLinkController.getPaymentPage);

// Create Snap transaction from payment code
router.post(
  "/snap/:payment_code",
  PaymentLinkController.createSnapFromPaymentCode,
);

// Verify payment status
router.get("/verify/:payment_code", PaymentLinkController.verifyPaymentByCode);

// Extend payment link expiry
router.post("/extend/:payment_code", PaymentLinkController.extendPaymentLink);

// Generate WhatsApp message
router.get(
  "/whatsapp/:invoice_id",
  PaymentLinkController.generateWhatsAppMessage,
);

// Generate payment link for existing invoice
router.post("/generate/:invoice_id", PaymentLinkController.generatePaymentLink);

module.exports = router;
