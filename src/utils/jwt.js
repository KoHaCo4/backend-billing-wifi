const jwt = require("jsonwebtoken");

class TokenService {
  // Generate both access and refresh tokens
  static generateTokens(payload) {
    const accessToken = jwt.sign(
      { ...payload, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || "15m" }
    );

    const refreshToken = jwt.sign(
      { id: payload.id, type: "refresh" },
      process.env.JWT_SECRET, // Gunakan secret yang sama atau beda
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || "7d" }
    );

    return { accessToken, refreshToken };
  }

  // Verify token
  static verifyToken(token, type = "access") {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== type) {
        throw new Error(`Invalid token type. Expected: ${type}`);
      }

      return decoded;
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        throw new Error("Token has expired");
      }
      if (error.name === "JsonWebTokenError") {
        throw new Error("Invalid token");
      }
      throw error;
    }
  }

  // Extract token from request
  static extractToken(req) {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7); // Remove "Bearer "
    }

    return null;
  }
}

module.exports = TokenService;
