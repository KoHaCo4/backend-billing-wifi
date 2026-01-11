const express = require("express");
const router = express.Router();
const CustomerController = require("../controllers/customer.controller");
const { authenticate, authorize } = require("../middleware/auth");

// All routes require authentication
router.use(authenticate);

// Get all customers
router.get("/", CustomerController.getCustomers);

// Get statistics
router.get("/stats", CustomerController.getStatistics);

// Get customer by ID
router.get("/:id", CustomerController.getCustomer);

// Create customer (admin only)
router.post(
  "/",
  authorize("admin", "superadmin"),
  CustomerController.createCustomer
);

// Customer Controller
router.post(
  "/:id/deactivate",
  authorize("admin", "superadmin"),
  CustomerController.deactivateCustomer
);

// Update customer (admin only)
router.put(
  "/:id",
  authorize("admin", "superadmin"),
  CustomerController.updateCustomer
);

// Delete customer (admin only)
router.delete(
  "/:id",
  authorize("admin", "superadmin"),
  CustomerController.deleteCustomer
);

// Extend customer package (admin only)
router.post(
  "/:id/extend",
  authorize("admin", "superadmin"),
  CustomerController.extendCustomer
);

// Suspend customer (admin only)
router.post(
  "/:id/suspend",
  authorize("admin", "superadmin"),
  CustomerController.suspendCustomer
);

// Activate customer (admin only)
router.post(
  "/:id/activate",
  authorize("admin", "superadmin"),
  CustomerController.activateCustomer
);

module.exports = router;
