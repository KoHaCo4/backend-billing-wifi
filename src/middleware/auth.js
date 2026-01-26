const TokenService = require("../utils/jwt");
const db = require("../config/database");

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    console.log("🔐 Auth check for:", req.originalUrl);

    const token = TokenService.extractToken(req);

    if (!token) {
      console.log("❌ No token provided");
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Verify token
    console.log("✅ Token found, verifying...");
    const decoded = TokenService.verifyToken(token, "access");

    // Check if admin exists
    const [admins] = await db.query(
      "SELECT id, email, role, status FROM admins WHERE id = ?",
      [decoded.id],
    );

    if (admins.length === 0) {
      console.log("❌ User not found in database");
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (admins[0].status !== "active") {
      console.log("❌ User is inactive");
      return res.status(401).json({
        success: false,
        message: "User is inactive",
      });
    }

    // Attach user to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    console.log("✅ Auth successful for user:", req.user.email);

    // **PASTIKAN next() dipanggil**
    return next();
  } catch (error) {
    console.error("❌ Auth failed:", error.message);

    // **PERBAIKAN: Pastikan error message tidak mengandung "next"**
    const safeMessage = error.message.replace(
      /next is not a function/gi,
      "authentication failed",
    );

    if (
      safeMessage.includes("Token has expired") ||
      error.message.includes("Token has expired")
    ) {
      return res.status(401).json({
        success: false,
        message: "Token has expired",
        code: "TOKEN_EXPIRED",
        renewUrl: "/api/auth/refresh",
      });
    }

    return res.status(401).json({
      success: false,
      message: `Authentication failed: ${safeMessage}`,
    });
  }
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    return next();
  };
};

module.exports = { authenticate, authorize };
