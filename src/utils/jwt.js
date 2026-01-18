// utils/jwt.js atau utils/TokenService.js
const jwt = require("jsonwebtoken");

class TokenService {
  static generateTokens(payload) {
    const accessToken = jwt.sign(
      payload,
      process.env.JWT_ACCESS_SECRET || "access-secret",
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m" }
    );

    const refreshToken = jwt.sign(
      payload,
      process.env.JWT_REFRESH_SECRET || "refresh-secret",
      { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" }
    );

    return { accessToken, refreshToken };
  }

  static verifyToken(token, type = "access") {
    try {
      const secret =
        type === "access"
          ? process.env.JWT_ACCESS_SECRET || "access-secret"
          : process.env.JWT_REFRESH_SECRET || "refresh-secret";

      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error(`Invalid ${type} token: ${error.message}`);
    }
  }

  // Tambahkan fungsi extractToken ini
  static extractToken(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }

    return authHeader.split(" ")[1];
  }
}

module.exports = TokenService;
