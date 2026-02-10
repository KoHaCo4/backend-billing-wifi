const PackageService = require("../services/package.service");

class PackageController {
  // List packages with filter (active/all) dengan multi-user
  static async list(req, res) {
    try {
      const { all, page = 1, limit = 20, search } = req.query;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log("📦 Package list request - Query:", {
        all,
        page,
        limit,
        search,
        adminId,
        role,
      });

      // Convert 'all' parameter to boolean
      const showInactive = all === "true";

      // Use service to get packages dengan adminId dan role
      const packages = await PackageService.getAllPackages(
        showInactive,
        adminId,
        role,
      );

      console.log(`✅ Found ${packages.length} packages for admin ${adminId}`);

      res.json({
        success: true,
        data: packages,
        pagination: {
          total: packages.length,
          showing_all: showInactive,
        },
      });
    } catch (error) {
      console.error("❌ Error in packageController.list:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Create package dengan admin_id
  static async create(req, res) {
    try {
      console.log("📦 Create package request:", req.body);
      console.log("👤 Admin:", req.user);

      const adminId = req.user.id;
      const role = req.user.role;

      // Validasi input wajib
      const { name, price, duration_days, selected_routers } = req.body;

      if (!name || !price || !duration_days) {
        return res.status(400).json({
          success: false,
          message: "Nama, harga, dan durasi paket harus diisi",
        });
      }

      // Validasi tipe data
      if (isNaN(parseFloat(price))) {
        return res.status(400).json({
          success: false,
          message: "Harga harus berupa angka",
        });
      }

      if (isNaN(parseInt(duration_days))) {
        return res.status(400).json({
          success: false,
          message: "Durasi harus berupa angka",
        });
      }

      // Siapkan data untuk service
      const packageData = {
        name,
        price: parseFloat(price),
        duration_days: parseInt(duration_days),
        shared_users: req.body.shared_users || 1,
        rate_limit: req.body.rate_limit || "unlimited",
        type: req.body.type || "pppoe",
        is_active: req.body.is_active !== undefined ? req.body.is_active : true,
        profile_name:
          req.body.profile_name ||
          name
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9_]/g, ""),
        selected_routers: selected_routers || [],
        is_shared: req.body.is_shared || false,
        shared_with: req.body.shared_with || [],
      };

      console.log("📦 Data being sent to service:", {
        ...packageData,
        selected_routers: packageData.selected_routers,
        admin_id: adminId,
      });

      // Panggil service untuk membuat package dengan adminId
      const result = await PackageService.createPackage(packageData, adminId);

      res.status(201).json({
        success: true,
        message: "Paket berhasil dibuat",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error creating package:", error);

      let errorMessage = "Gagal membuat paket";
      let statusCode = 500;

      if (error.message.includes("required")) {
        errorMessage = error.message;
        statusCode = 400;
      } else if (error.message.includes("Duplicate entry")) {
        errorMessage = "Nama paket sudah digunakan";
        statusCode = 400;
      } else if (
        error.message.includes("Mikrotik") ||
        error.message.includes("router")
      ) {
        errorMessage = error.message;
        statusCode = 400;
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // Get single package dengan authorization
  static async getById(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log("📦 Get package by ID:", id, "Admin:", adminId);

      const packageData = await PackageService.getPackageById(
        id,
        adminId,
        role,
      );

      if (!packageData) {
        return res.status(404).json({
          success: false,
          message: "Package not found or access denied",
        });
      }

      res.json({
        success: true,
        data: packageData,
      });
    } catch (error) {
      console.error("❌ Error getting package:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update package dengan authorization
  static async update(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log(`✏️ Update package request for ID: ${id}, Admin: ${adminId}`);

      // Cek akses terlebih dahulu
      const canAccess = await PackageService.canAccessPackage(
        id,
        adminId,
        role,
      );
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: "Access denied to update this package",
        });
      }

      const updatedPackage = await PackageService.updatePackage(
        id,
        req.body,
        adminId,
        role,
      );

      res.json({
        success: true,
        message: "Paket berhasil diperbarui",
        data: updatedPackage,
      });
    } catch (error) {
      console.error("Error updating package:", error);

      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Package not found or access denied",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Gagal memperbarui paket",
      });
    }
  }

  // Delete package dengan authorization
  static async delete(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log(
        `🗑️ Delete package request for ID: ${id}, Admin: ${adminId}, Role: ${role}`,
      );

      // Cek akses terlebih dahulu
      const canAccess = await PackageService.canAccessPackage(
        id,
        adminId,
        role,
      );
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: "Access denied to delete this package",
        });
      }

      const result = await PackageService.deletePackage(id, adminId, role);

      if (result.success) {
        res.json({
          success: true,
          message: "Package deleted successfully",
          data: result,
        });
      } else {
        // Jika gagal karena package digunakan
        res.status(400).json({
          success: false,
          message: result.error,
          code: "PACKAGE_IN_USE",
        });
      }
    } catch (error) {
      console.error("❌ Error deleting package:", error);

      let statusCode = 500;
      let errorMessage = "Failed to delete package";

      if (
        error.message.includes("Package not found") ||
        error.message.includes("access denied")
      ) {
        statusCode = 404;
        errorMessage = "Package not found or access denied";
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // Share package dengan admin lain
  static async sharePackage(req, res) {
    try {
      const { id } = req.params;
      const { admin_ids } = req.body;
      const adminId = req.user.id;
      const role = req.user.role;

      if (!Array.isArray(admin_ids)) {
        return res.status(400).json({
          success: false,
          message: "admin_ids harus berupa array",
        });
      }

      // Hanya superadmin atau pemilik package yang bisa share
      if (role !== "superadmin") {
        // Cek apakah package milik admin ini
        const db = require("../config/database");
        const [packages] = await db.query(
          "SELECT admin_id FROM packages WHERE id = ?",
          [id],
        );

        if (packages.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Package not found",
          });
        }

        if (packages[0].admin_id !== adminId) {
          return res.status(403).json({
            success: false,
            message: "You can only share your own packages",
          });
        }
      }

      // Filter out current admin
      const filteredAdminIds = admin_ids.filter(
        (targetId) => targetId !== adminId,
      );

      // Update sharing
      const isShared = filteredAdminIds.length > 0;
      const sharedWithJson = isShared ? JSON.stringify(filteredAdminIds) : null;

      await db.query(
        `UPDATE packages 
         SET is_shared = ?, shared_with = ?, updated_at = NOW() 
         WHERE id = ?`,
        [isShared ? 1 : 0, sharedWithJson, id],
      );

      res.json({
        success: true,
        message: "Package shared successfully",
        data: {
          package_id: id,
          is_shared: isShared,
          shared_with: filteredAdminIds,
        },
      });
    } catch (error) {
      console.error("Share package error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get active packages untuk customer selection dengan filter multi-user
  static async getActivePackages(req, res) {
    try {
      const adminId = req.user.id;
      const role = req.user.role;

      const packages = await PackageService.getActivePackages(adminId, role);

      res.json({
        success: true,
        data: packages,
      });
    } catch (error) {
      console.error("Error getting active packages:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = PackageController;
