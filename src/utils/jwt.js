const jwt = require("jsonwebtoken");

class TokenService {
  static generateTokens(payload) {
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_ACCESS_SECRET || "access-secret",
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || "12h" },
    );

    const refreshToken = jwt.sign(
      payload,
      process.env.JWT_REFRESH_SECRET || "refresh-secret",
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" },
    );

    return { accessToken, refreshToken };
  }

  static verifyToken(token, type = "access") {
    try {
      console.log(`🔑 Verifying ${type} token: ${token.substring(0, 20)}...`);

      const secret =
        type === "access"
          ? process.env.JWT_ACCESS_SECRET || "access-secret"
          : process.env.JWT_REFRESH_SECRET || "refresh-secret";

      const decoded = jwt.verify(token, secret);
      console.log(`✅ ${type} token verified successfully`);
      return decoded;
    } catch (error) {
      console.error(`❌ ${type} token verification failed:`, error.message);

      // **PERBAIKAN DISINI: Jangan biarkan error.message mengandung "next"**
      let userMessage;

      if (error.name === "TokenExpiredError") {
        userMessage = "Token has expired";
      } else if (error.name === "JsonWebTokenError") {
        if (error.message.includes("invalid signature")) {
          userMessage = "Invalid token signature";
        } else if (error.message.includes("jwt malformed")) {
          userMessage = "Malformed token";
        } else if (error.message.includes("invalid token")) {
          userMessage = "Invalid token";
        } else {
          // Hapus kata "next" dari error message jika ada
          userMessage = error.message.replace(/next/gi, "").trim();
        }
      } else {
        // Hapus kata "next" dari error message
        userMessage =
          error.message.replace(/next/gi, "").trim() ||
          "Token verification failed";
      }

      throw new Error(userMessage);
    }
  }

  static extractToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }

    return authHeader.split(" ")[1];
  }
}

module.exports = TokenService;
