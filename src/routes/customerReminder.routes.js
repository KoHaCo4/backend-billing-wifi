const express = require("express");
const router = express.Router();
const customerReminderController = require("../controllers/customerReminder.controller");

// Get reminder status
router.get("/status", customerReminderController.getReminderStatus);

// Get simple job info
router.get("/job-info", customerReminderController.getJobInfo);

// Trigger reminder job manually
router.post("/trigger", customerReminderController.triggerReminderNow);

// Debug customers
router.get("/debug", customerReminderController.debugCustomers);

// Get expiring customers
router.get("/expiring", customerReminderController.getExpiringCustomers);

module.exports = router;
