const PackageService = require("../services/package.service");

class PackageController {
  // List packages with filter (active/all)
  static async list(req, res) {
    try {
      const { all, page = 1, limit = 20, search } = req.query;

      console.log("📦 Package list request - Query:", {
        all,
        page,
        limit,
        search,
      });

      // Convert 'all' parameter to boolean
      const showInactive = all === "true";

      // Use service to get packages
      const packages = await PackageService.getAllPackages(showInactive);

      console.log(`✅ Found ${packages.length} packages`);

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

  // Create package
  static async create(req, res) {
    try {
      console.log("📦 Create package request:", req.body);
      console.log("👤 Admin:", req.user);

      const adminId = req.user ? req.user.id : 1; // Fallback jika tidak ada auth

      // Validasi input wajib
      const { name, price, duration_days } = req.body;

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
      };

      // Panggil service untuk membuat package
      const newPackage = await PackageService.createPackage(
        packageData,
        adminId
      );

      res.status(201).json({
        success: true,
        message: "Paket berhasil dibuat",
        data: newPackage,
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
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // Get single package
  static async getById(req, res) {
    try {
      const { id } = req.params;
      console.log("📦 Get package by ID:", id);

      const packageData = await PackageService.getPackageById(id);

      if (!packageData) {
        return res.status(404).json({
          success: false,
          message: "Package not found",
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

  // Update package
  static async update(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user ? req.user.id : 1;

      const updatedPackage = await PackageService.updatePackage(
        id,
        req.body,
        adminId
      );

      res.json({
        success: true,
        message: "Paket berhasil diperbarui",
        data: updatedPackage,
      });
    } catch (error) {
      console.error("Error updating package:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Gagal memperbarui paket",
      });
    }
  }

  // Delete package
  static async delete(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user ? req.user.id : 1;

      console.log(`🗑️ Delete package request for ID: ${id}`);

      const result = await PackageService.deletePackage(id, adminId);

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

      if (error.message.includes("Package not found")) {
        statusCode = 404;
        errorMessage = error.message;
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
}

module.exports = PackageController;
