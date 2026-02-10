const bcrypt = require("bcryptjs");
const db = require("../config/database");
const TokenService = require("../utils/jwt");

class AuthService {
  // Login
  static async login(email, password) {
    let connection;
    try {
      console.log(`🔐 Login attempt for: ${email}`);

      // Gunakan koneksi terpisah untuk menghindari deadlock
      connection = await db.getConnection();

      // Sesuaikan dengan kolom yang ada di tabel admins
      const [admins] = await connection.query(
        "SELECT id, email, password, name, role, status FROM admins WHERE email = ?",
        [email],
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

      // Update refresh token dengan timeout yang lebih pendek
      await connection.query(
        "UPDATE admins SET refresh_token = ?, last_login = NOW(), updated_at = NOW() WHERE id = ?",
        [tokens.refreshToken, admin.id],
      );

      // Juga simpan di tabel refresh_tokens dengan transaction
      await connection.beginTransaction();
      try {
        // Hapus token lama untuk admin ini
        await connection.query(
          "DELETE FROM refresh_tokens WHERE admin_id = ?",
          [admin.id],
        );

        // Insert token baru
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 hari

        await connection.query(
          "INSERT INTO refresh_tokens (admin_id, token, expires_at, revoked) VALUES (?, ?, ?, 0)",
          [admin.id, tokens.refreshToken, expiresAt],
        );

        await connection.commit();
        console.log(`✅ Refresh token saved for: ${admin.email}`);
      } catch (transactionError) {
        await connection.rollback();
        console.error("❌ Transaction failed:", transactionError.message);
        // Tetapi jangan gagalkan login, update di admins sudah berhasil
      }

      return {
        user: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        },
      };
    } catch (error) {
      console.error("❌ Login service error:", error.message);
      throw error;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Refresh token
  static async refreshToken(refreshToken) {
    let connection;
    try {
      console.log("🔄 Refresh token attempt");

      // Verifikasi refresh token
      const decoded = TokenService.verifyToken(refreshToken, "refresh");

      connection = await db.getConnection();

      // Cek di database
      const [admins] = await connection.query(
        "SELECT id, email, name, role FROM admins WHERE id = ? AND refresh_token = ?",
        [decoded.id, refreshToken],
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

      // Update refresh token di database dengan transaction
      await connection.beginTransaction();
      try {
        // Update di admins
        await connection.query(
          "UPDATE admins SET refresh_token = ?, updated_at = NOW() WHERE id = ?",
          [tokens.refreshToken, admin.id],
        );

        // Update di refresh_tokens
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await connection.query(
          "UPDATE refresh_tokens SET token = ?, expires_at = ?, revoked = 0 WHERE admin_id = ?",
          [tokens.refreshToken, expiresAt, admin.id],
        );

        await connection.commit();
        console.log(`✅ New refresh token saved for: ${admin.email}`);
      } catch (transactionError) {
        await connection.rollback();
        console.error(
          "❌ Failed to update refresh token:",
          transactionError.message,
        );
        throw transactionError;
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
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Logout
  static async logout(refreshToken) {
    let connection;
    try {
      console.log("🚪 Logout attempt");

      connection = await db.getConnection();

      // Verifikasi token dulu
      const decoded = TokenService.verifyToken(refreshToken, "refresh");

      // Hapus refresh token dari database dengan transaction
      await connection.beginTransaction();
      try {
        // Update di admins
        await connection.query(
          "UPDATE admins SET refresh_token = NULL, updated_at = NOW() WHERE id = ?",
          [decoded.id],
        );

        // Revoke di refresh_tokens
        await connection.query(
          "UPDATE refresh_tokens SET revoked = 1 WHERE admin_id = ? AND token = ?",
          [decoded.id, refreshToken],
        );

        await connection.commit();
        console.log("✅ Logout successful, refresh token cleared");
      } catch (transactionError) {
        await connection.rollback();
        console.error(
          "❌ Logout transaction failed:",
          transactionError.message,
        );
        throw transactionError;
      }
    } catch (error) {
      console.error("❌ Logout error:", error.message);
      // Jika token invalid, tetap return sukses
      if (
        error.message.includes("invalid token") ||
        error.message.includes("jwt malformed")
      ) {
        console.log("⚠️ Token invalid, but logout considered successful");
        return;
      }
      throw error;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

  // Get current user
  static async getCurrentUser(userId) {
    let connection;
    try {
      console.log(`👤 GetCurrentUser for ID: ${userId}`);

      connection = await db.getConnection();

      const [admins] = await connection.query(
        "SELECT id, email, name, role, created_at, last_login FROM admins WHERE id = ?",
        [userId],
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
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

module.exports = AuthService;
