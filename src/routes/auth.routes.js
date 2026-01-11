const express = require("express");
const router = express.Router();
const AuthController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth");

// Login
router.post("/login", AuthController.login);

// Refresh token
router.post("/refresh", AuthController.refreshToken);

// Logout
router.post("/logout", AuthController.logout);

// Get current user (protected route)
router.get("/me", authenticate, AuthController.getMe);

module.exports = router;
