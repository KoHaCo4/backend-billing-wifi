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

      res.json({
        success: true,
        message: "Login successful",
        data: result,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Refresh token
  static async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
        });
      }

      const result = await AuthService.refreshToken(refreshToken);

      res.json({
        success: true,
        message: "Token refreshed",
        data: result,
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        message: error.message,
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
