const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");

// Admin dashboard - superadmin only
router.get("/dashboard", authorize("superadmin"), (req, res) => {
  res.json({
    success: true,
    message: "Admin dashboard",
    data: {
      user: req.user,
      timestamp: new Date().toISOString(),
    },
  });
});

module.exports = router;
