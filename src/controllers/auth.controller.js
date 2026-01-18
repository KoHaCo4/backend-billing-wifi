const AuthService = require("../services/auth.service");

class AuthController {
  // Login
  static async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
      }

      const result = await AuthService.login(email, password);

      // Format response yang konsisten
      res.json({
        success: true,
        message: "Login successful",
        data: {
          user: result.user,
          tokens: {
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            // Juga kirim dalam snake_case
            access_token:
              result.tokens.accessToken || result.tokens.access_token,
            refresh_token:
              result.tokens.refreshToken || result.tokens.refresh_token,
          },
        },
      });
    } catch (error) {
      console.error("❌ Login error:", error);
      res.status(401).json({
        success: false,
        message: error.message || "Invalid credentials",
        code: "AUTH_FAILED",
      });
    }
  }

  // Refresh token method
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
          code: "REFRESH_TOKEN_REQUIRED",
        });
      }

      const result = await AuthService.refreshToken(refreshToken);

      res.json({
        success: true,
        message: "Token refreshed",
        data: {
          user: result.user,
          tokens: {
            accessToken: result.tokens.accessToken,
            refreshToken: result.tokens.refreshToken,
            access_token:
              result.tokens.accessToken || result.tokens.access_token,
            refresh_token:
              result.tokens.refreshToken || result.tokens.refresh_token,
          },
        },
      });
    } catch (error) {
      console.error("❌ Refresh token error:", error);
      res.status(401).json({
        success: false,
        message: error.message || "Invalid refresh token",
        code: "REFRESH_TOKEN_INVALID",
      });
    }
  }

  // Logout
  static async logout(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
        });
      }

      await AuthService.logout(refreshToken);

      res.json({
        success: true,
        message: "Logout successful",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get current user
  static async getMe(req, res) {
    try {
      const user = await AuthService.getCurrentUser(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = AuthController;
