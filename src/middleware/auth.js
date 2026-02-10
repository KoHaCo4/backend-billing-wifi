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

    // Check if admin exists and get role
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

    // Attach user to request with role
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: admins[0].role, // Get role from database
    };

    console.log(
      "✅ Auth successful for user:",
      req.user.email,
      "Role:",
      req.user.role,
    );

    return next();
  } catch (error) {
    console.error("❌ Auth failed:", error.message);

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

    if (!roles.includes(req.user.role) && req.user.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    return next();
  };
};

// Middleware untuk authorize berdasarkan ownership
const authorizeDataAccess = (modelType = "customer") => {
  return async (req, res, next) => {
    try {
      const { id: adminId, role } = req.user;

      // Superadmin bisa akses semua
      if (role === "superadmin") {
        return next();
      }

      const dataId = req.params.id || req.params.customerId;

      if (!dataId) {
        return res.status(400).json({
          success: false,
          message: "Data ID is required",
        });
      }

      // Check access berdasarkan model type
      let query;
      let params;

      switch (modelType) {
        case "customer":
          query = `
            SELECT id FROM customers 
            WHERE id = ? 
            AND (
              admin_id = ? 
              OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
            )
          `;
          params = [dataId, adminId, JSON.stringify([adminId])];
          break;

        case "invoice":
          query = `
            SELECT id FROM invoices 
            WHERE id = ? 
            AND (
              admin_id = ? 
              OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
            )
          `;
          params = [dataId, adminId, JSON.stringify([adminId])];
          break;

        case "package":
          query = `
            SELECT id FROM packages 
            WHERE id = ? 
            AND (
              admin_id = ? 
              OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
            )
          `;
          params = [dataId, adminId, JSON.stringify([adminId])];
          break;

        case "router":
          query = `
            SELECT id FROM routers 
            WHERE id = ? 
            AND (
              admin_id = ? 
              OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
            )
          `;
          params = [dataId, adminId, JSON.stringify([adminId])];
          break;

        default:
          return res.status(400).json({
            success: false,
            message: "Invalid model type",
          });
      }

      const [rows] = await db.execute(query, params);

      if (rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this data",
        });
      }

      next();
    } catch (error) {
      console.error("Data access authorization error:", error);
      return res.status(500).json({
        success: false,
        message: "Authorization error",
      });
    }
  };
};

module.exports = {
  authenticate,
  authorize,
  authorizeDataAccess,
};
