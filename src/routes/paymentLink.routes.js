const express = require("express");
const router = express.Router();
const PaymentLinkController = require("../controllers/paymentLink.controller");

// Public routes (no authentication required for payment links)

// NEW: Get public payment page data (for auto-pay)
router.get("/public/:payment_code", PaymentLinkController.getPublicPaymentPage);

// NEW: Create direct payment (auto-pay)
router.post("/direct/:payment_code", PaymentLinkController.createDirectPayment);

// NEW: Generate WhatsApp message with auto-pay link
router.get(
  "/autopay-message/:invoice_id",
  PaymentLinkController.generateAutoPayMessage,
);

// NEW: Batch generate payment links
router.post("/batch-generate", PaymentLinkController.batchGenerateLinks);

// Existing routes...
router.get("/check/:payment_code", PaymentLinkController.checkPaymentLink);
router.get("/page/:payment_code", PaymentLinkController.getPaymentPage);
router.post(
  "/snap/:payment_code",
  PaymentLinkController.createSnapFromPaymentCode,
);
router.get("/verify/:payment_code", PaymentLinkController.verifyPaymentByCode);
router.post("/extend/:payment_code", PaymentLinkController.extendPaymentLink);
router.get(
  "/whatsapp/:invoice_id",
  PaymentLinkController.generateWhatsAppMessage,
);
router.post("/generate/:invoice_id", PaymentLinkController.generatePaymentLink);

module.exports = router;
