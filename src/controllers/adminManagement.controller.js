const Admin = require("../models/Admin");
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");

class AdminManagementController {
  // Get all admins (superadmin only)
  static async getAllAdmins(req, res) {
    try {
      const { id: currentAdminId } = req.user;

      const admins = await Admin.findAll({
        where: {
          id: { [Op.ne]: currentAdminId }, // Exclude current admin
        },
        attributes: [
          "id",
          "name",
          "email",
          "role",
          "is_active",
          "last_login",
          "created_at",
        ],
        order: [["created_at", "DESC"]],
      });

      res.json({
        success: true,
        data: admins,
      });
    } catch (error) {
      console.error("Get admins error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Create new admin (superadmin only)
  static async createAdmin(req, res) {
    try {
      const {
        name,
        email,
        password,
        role = "admin",
        is_active = true,
      } = req.body;

      // Validation
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "Name, email and password are required",
        });
      }

      // Check if email exists
      const existingAdmin = await Admin.findOne({ where: { email } });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create admin
      const admin = await Admin.create({
        name,
        email,
        password: hashedPassword,
        role,
        is_active,
      });

      // Remove password from response
      const adminData = admin.toJSON();
      delete adminData.password;

      res.status(201).json({
        success: true,
        message: "Admin created successfully",
        data: adminData,
      });
    } catch (error) {
      console.error("Create admin error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update admin (superadmin only)
  static async updateAdmin(req, res) {
    try {
      const { id } = req.params;
      const { name, email, role, is_active, password } = req.body;

      // Find admin
      const admin = await Admin.findByPk(id);
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      // Check if email is being changed and if it already exists
      if (email && email !== admin.email) {
        const existingAdmin = await Admin.findOne({ where: { email } });
        if (existingAdmin) {
          return res.status(400).json({
            success: false,
            message: "Email already exists",
          });
        }
      }

      // Prepare update data
      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;
      if (role) updateData.role = role;
      if (is_active !== undefined) updateData.is_active = is_active;

      // Update password if provided
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      // Update admin
      await admin.update(updateData);

      // Get updated admin without password
      const updatedAdmin = await Admin.findByPk(id, {
        attributes: { exclude: ["password"] },
      });

      res.json({
        success: true,
        message: "Admin updated successfully",
        data: updatedAdmin,
      });
    } catch (error) {
      console.error("Update admin error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete admin (soft delete - superadmin only)
  static async deleteAdmin(req, res) {
    try {
      const { id } = req.params;
      const { id: currentAdminId } = req.user;

      // Don't allow deleting yourself
      if (parseInt(id) === currentAdminId) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete your own account",
        });
      }

      // Find admin
      const admin = await Admin.findByPk(id);
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      // Soft delete by setting is_active to false
      await admin.update({ is_active: false });

      res.json({
        success: true,
        message: "Admin deleted successfully",
      });
    } catch (error) {
      console.error("Delete admin error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get admin statistics (for dashboard)
  static async getAdminStats(req, res) {
    try {
      console.log(
        "🔄 Getting admin stats for admin ID:",
        req.user.id,
        "Role:",
        req.user.role,
      );

      // Gunakan method getStatistics dari model Admin
      const stats = await Admin.getStatistics(req.user.id, req.user.role);

      // Jika Admin.count tidak ada, gunakan findAll
      let adminCount = 0;
      try {
        if (typeof Admin.count === "function") {
          adminCount = await Admin.count();
        } else {
          const admins = await Admin.findAll();
          adminCount = admins.length;
        }
      } catch (error) {
        console.log("⚠️ Could not get admin count:", error.message);
      }

      res.json({
        success: true,
        data: {
          ...stats,
          adminCount: adminCount,
          // Tambahan stats lainnya jika perlu
        },
      });
    } catch (error) {
      console.error("❌ Error getting admin stats:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Server error",
      });
    }
  }

  // Get admin profile
  static async getProfile(req, res) {
    try {
      console.log("🔄 Getting profile for admin ID:", req.user.id);

      // Gunakan method yang sesuai
      const admin = await Admin.findByPk(req.user.id);

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      res.json({
        success: true,
        data: admin,
      });
    } catch (error) {
      console.error("❌ Error getting profile:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Server error",
      });
    }
  }

  // Update admin profile
  static async updateProfile(req, res) {
    try {
      const { id: adminId } = req.user;
      const { name, email, current_password, new_password } = req.body;

      const admin = await Admin.scope("withPassword").findByPk(adminId);
      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      // Check if email is being changed and if it already exists
      if (email && email !== admin.email) {
        const existingAdmin = await Admin.findOne({ where: { email } });
        if (existingAdmin) {
          return res.status(400).json({
            success: false,
            message: "Email already exists",
          });
        }
      }

      // Update basic info
      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;

      // Update password if provided
      if (current_password && new_password) {
        // Verify current password
        const isValidPassword = await bcrypt.compare(
          current_password,
          admin.password,
        );
        if (!isValidPassword) {
          return res.status(400).json({
            success: false,
            message: "Current password is incorrect",
          });
        }

        // Hash new password
        updateData.password = await bcrypt.hash(new_password, 10);
      }

      await admin.update(updateData);

      // Get updated admin without password
      const updatedAdmin = await Admin.findByPk(adminId, {
        attributes: { exclude: ["password"] },
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: updatedAdmin,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = AdminManagementController;
