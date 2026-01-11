const express = require("express");
const router = express.Router();
const InvoiceController = require("../controllers/invoice.controller");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get all invoices
router.get("/", InvoiceController.getInvoices);

// Get invoice statistics
router.get(
  "/stats",
  authorize("admin", "superadmin"),
  InvoiceController.getStatistics
);

// Get customer invoices
router.get("/customer/:customer_id", InvoiceController.getCustomerInvoices);

// Get invoice by ID
router.get("/:id", InvoiceController.getInvoice);

// Create invoice (admin only)
router.post(
  "/",
  authorize("admin", "superadmin"),
  InvoiceController.createInvoice
);

// Process payment (admin only)
router.post(
  "/:id/pay",
  authorize("admin", "superadmin"),
  InvoiceController.processPayment
);

// Update invoice status (admin only)
router.put(
  "/:id/status",
  authorize("admin", "superadmin"),
  InvoiceController.updateInvoiceStatus
);

// Delete invoice (admin only)
router.delete(
  "/:id",
  authorize("admin", "superadmin"),
  InvoiceController.deleteInvoice
);

// Cancel invoice
router.post(
  "/:id/cancel",
  authorize("admin", "superadmin"),
  InvoiceController.cancel
);

module.exports = router;
