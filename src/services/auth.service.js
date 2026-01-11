const bcrypt = require("bcryptjs");
const db = require("../config/database");
const TokenService = require("../utils/jwt");

class AuthService {
  // Login
  static async login(email, password) {
    try {
      console.log(`🔐 Login attempt for: ${email}`);

      // Sesuaikan dengan kolom yang ada di tabel admins
      const [admins] = await db.query(
        "SELECT id, email, password, name, role, status FROM admins WHERE email = ?",
        [email]
      );

      if (admins.length === 0) {
        console.log(`❌ Admin not found: ${email}`);
        throw new Error("Invalid email or password");
      }

      const admin = admins[0];
      console.log(`✅ Admin found: ${admin.name}, role: ${admin.role}`);

      // Check password
      const isValidPassword = await bcrypt.compare(password, admin.password);
      if (!isValidPassword) {
        console.log(`❌ Invalid password for: ${email}`);
        throw new Error("Invalid email or password");
      }

      // Check status
      if (admin.status !== "active") {
        console.log(`❌ Admin inactive: ${email}`);
        throw new Error("Account is inactive");
      }

      // Generate tokens
      const tokens = TokenService.generateTokens({
        id: admin.id,
        email: admin.email,
        role: admin.role,
      });

      console.log(`✅ Tokens generated for: ${admin.email}`);

      // Simpan refresh token dan last login ke database
      try {
        await db.query(
          "UPDATE admins SET refresh_token = ?, last_login = NOW(), updated_at = NOW() WHERE id = ?",
          [tokens.refreshToken, admin.id]
        );
        console.log(`✅ Refresh token saved for: ${admin.email}`);
      } catch (updateError) {
        console.error("❌ Failed to save refresh token:", updateError.message);
        // Lanjutkan meski gagal update, jangan batalkan login
      }

      return {
        user: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
        },
        tokens,
      };
    } catch (error) {
      console.error("❌ Login service error:", error.message);
      throw error;
    }
  }

  // Refresh token
  static async refreshToken(refreshToken) {
    try {
      console.log("🔄 Refresh token attempt");

      // Verifikasi refresh token
      const decoded = TokenService.verifyToken(refreshToken, "refresh");

      // Cek di database - sesuaikan dengan kolom yang ada
      const [admins] = await db.query(
        "SELECT id, email, name, role FROM admins WHERE id = ? AND refresh_token = ?",
        [decoded.id, refreshToken]
      );

      if (admins.length === 0) {
        console.log("❌ Invalid refresh token or user not found");
        throw new Error("Invalid refresh token");
      }

      const admin = admins[0];
      console.log(`✅ Refresh token valid for: ${admin.email}`);

      // Generate new tokens
      const tokens = TokenService.generateTokens({
        id: admin.id,
        email: admin.email,
        role: admin.role,
      });

      // Update refresh token di database
      try {
        await db.query(
          "UPDATE admins SET refresh_token = ?, updated_at = NOW() WHERE id = ?",
          [tokens.refreshToken, admin.id]
        );
        console.log(`✅ New refresh token saved for: ${admin.email}`);
      } catch (updateError) {
        console.error(
          "❌ Failed to update refresh token:",
          updateError.message
        );
      }

      return {
        user: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
        },
        tokens,
      };
    } catch (error) {
      console.error("❌ Refresh token error:", error.message);
      throw error;
    }
  }

  // Logout
  static async logout(refreshToken) {
    try {
      console.log("🚪 Logout attempt");

      // Hapus refresh token dari database
      const [result] = await db.query(
        "UPDATE admins SET refresh_token = NULL, updated_at = NOW() WHERE refresh_token = ?",
        [refreshToken]
      );

      if (result.affectedRows > 0) {
        console.log("✅ Logout successful, refresh token cleared");
      } else {
        console.log("⚠️  No matching refresh token found");
      }
    } catch (error) {
      console.error("❌ Logout error:", error.message);
      throw error;
    }
  }

  // Get current user
  static async getCurrentUser(userId) {
    try {
      console.log(`👤 GetCurrentUser for ID: ${userId}`);

      // Sesuaikan dengan kolom yang ada
      const [admins] = await db.query(
        "SELECT id, email, name, role, created_at, last_login FROM admins WHERE id = ?",
        [userId]
      );

      if (admins.length === 0) {
        console.log(`❌ User not found: ${userId}`);
        return null;
      }

      console.log(`✅ User found: ${admins[0].email}`);
      return admins[0];
    } catch (error) {
      console.error("❌ GetCurrentUser error:", error.message);
      throw error;
    }
  }
}

module.exports = AuthService;
