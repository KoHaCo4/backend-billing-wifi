const db = require("../config/database");
const logger = require("../utils/logger");
const MikrotikService = require("./mikrotik.service");

class PackageService {
  // Get all packages (with optional filter)
  static async getAllPackages(showInactive = false) {
    try {
      let query = "SELECT * FROM packages";

      if (!showInactive) {
        query += " WHERE is_active = 1";
      }

      query += " ORDER BY created_at DESC";

      const [packages] = await db.query(query);
      return packages;
    } catch (error) {
      console.error("Error in PackageService.getAllPackages:", error);
      throw error;
    }
  }

  // Create package
  // package.service.js - Update createPackage
  static async createPackage(data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log("📦 Creating package with data:", data);

      // Validasi
      const requiredFields = ["name", "price", "duration_days"];
      for (const field of requiredFields) {
        if (!data[field]) {
          throw new Error(`Field ${field} is required`);
        }
      }

      // Generate profile name
      const profileName =
        data.profile_name ||
        data.name
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "");

      // ============================================
      // 1. VALIDASI ROUTER YANG DIPILIH
      // ============================================
      let selectedRouters = [];
      if (data.selected_routers && data.selected_routers.length > 0) {
        // Ambil data router yang dipilih
        const routerIds = Array.isArray(data.selected_routers)
          ? data.selected_routers
          : [data.selected_routers];

        const [routers] = await connection.query(
          'SELECT * FROM routers WHERE id IN (?) AND status = "active"',
          [routerIds],
        );

        if (routers.length !== routerIds.length) {
          throw new Error("Beberapa router tidak ditemukan atau tidak aktif");
        }

        selectedRouters = routers;
        console.log(
          `🎯 Selected routers for profile creation: ${selectedRouters.length}`,
        );
      }

      // ============================================
      // 2. BUAT PACKAGE DI DATABASE
      // ============================================
      const query = `
      INSERT INTO packages (
        name, duration_days, price, shared_users, 
        rate_limit, type, is_active, profile_name, 
        mikrotik_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

      // Default mikrotik_status berdasarkan apakah ada router yang dipilih
      const mikrotikStatus =
        selectedRouters.length > 0 ? "pending" : "not_required";

      const values = [
        data.name,
        parseInt(data.duration_days),
        parseFloat(data.price),
        data.shared_users || 1,
        data.rate_limit || "unlimited",
        data.type || "pppoe",
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        profileName,
        mikrotikStatus,
      ];

      const [result] = await connection.query(query, values);
      const packageId = result.insertId;

      console.log(`✅ Package created in DB: ${packageId}`);

      // ============================================
      // 3. BUAT PROFIL DI MIKROTIK (SYNC - ATOMIC)
      // ============================================
      const mikrotikResults = [];
      const errors = [];

      if (selectedRouters.length > 0) {
        console.log("🔄 Creating PPPoE profiles on selected routers...");

        for (const router of selectedRouters) {
          let mikrotik = null;
          try {
            console.log(
              `🔧 Creating profile on router: ${router.name} (${router.ip_address})`,
            );

            mikrotik = new MikrotikService({
              ip_address: router.ip_address,
              username: router.username,
              password: router.password,
              port: router.port || 8728,
              api_port: router.api_port || 8728,
            });

            // Gunakan timeout lebih pendek per router
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Router timeout (10s)")),
                10000,
              ),
            );

            // Create PPPoE profile
            const profileResult = await Promise.race([
              mikrotik.createPPPoEProfile(
                profileName,
                data.rate_limit || "unlimited",
              ),
              timeoutPromise,
            ]);

            mikrotikResults.push({
              router_id: router.id,
              router_name: router.name,
              ip_address: router.ip_address,
              success: true,
              message: profileResult.message,
            });

            console.log(`✅ Profile created on ${router.name}`);
          } catch (mikrotikError) {
            console.error(
              `❌ Failed on router ${router.name}:`,
              mikrotikError.message,
            );
            errors.push({
              router_id: router.id,
              router_name: router.name,
              error: mikrotikError.message,
            });

            // JANGAN LANJUTKAN - ROLLBACK SEMUA
            throw new Error(
              `Gagal membuat profil pada router ${router.name} (${router.ip_address}): ` +
                `${mikrotikError.message}. Transaksi dibatalkan.`,
            );
          } finally {
            if (mikrotik) {
              try {
                await mikrotik.disconnect();
              } catch (e) {
                console.warn("Failed to disconnect from Mikrotik:", e.message);
              }
            }
          }
        }

        // Update mikrotik_status jika semua berhasil
        await connection.query(
          "UPDATE packages SET mikrotik_status = ? WHERE id = ?",
          ["created", packageId],
        );
      }

      // ============================================
      // 4. SIMPAN LOG DAN COMMIT
      // ============================================
      // Log package creation
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "create_package",
          "package",
          packageId,
          `Package created: ${data.name} (${profileName})`,
          "admin",
          adminId,
        ],
      );

      // Log Mikrotik results jika ada
      if (mikrotikResults.length > 0) {
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "mikrotik_profile_created",
            "package",
            packageId,
            `PPPoE profile "${profileName}" created on ${mikrotikResults.length} router(s)`,
            "system",
            adminId,
          ],
        );
      }

      await connection.commit();

      // ============================================
      // 5. RETURN RESULT
      // ============================================
      const [packages] = await connection.query(
        "SELECT * FROM packages WHERE id = ?",
        [packageId],
      );

      const newPackage = packages[0];

      console.log(`🎉 Package creation COMPLETED: ${newPackage.name}`);

      return {
        success: true,
        data: {
          id: newPackage.id,
          name: newPackage.name,
          price: newPackage.price,
          duration_days: newPackage.duration_days,
          profile_name: newPackage.profile_name,
          mikrotik_status: newPackage.mikrotik_status,
          mikrotik_results: mikrotikResults,
          routers_count: mikrotikResults.length,
        },
        message:
          selectedRouters.length > 0
            ? `Package berhasil dibuat dengan ${mikrotikResults.length} profil MikroTik`
            : "Package berhasil dibuat (tanpa profil MikroTik)",
      };
    } catch (error) {
      console.error("❌ Package creation failed - ROLLING BACK:", error);

      if (connection) {
        try {
          await connection.rollback();
          console.log("↩️ Transaction rolled back");
        } catch (rollbackError) {
          console.error("❌ Failed to rollback:", rollbackError);
        }
      }

      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Update package
  static async updatePackage(id, data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`✏️ Updating package ${id} with data:`, data);

      // Get current package data
      const [currentPackages] = await connection.query(
        "SELECT * FROM packages WHERE id = ?",
        [id],
      );

      if (currentPackages.length === 0) {
        throw new Error("Package not found");
      }

      const currentPackage = currentPackages[0];

      // Siapkan field untuk update
      const updateFields = [];
      const updateValues = [];

      if (data.name !== undefined) {
        updateFields.push("name = ?");
        updateValues.push(data.name);
      }

      if (data.price !== undefined) {
        updateFields.push("price = ?");
        updateValues.push(parseFloat(data.price));
      }

      if (data.duration_days !== undefined) {
        updateFields.push("duration_days = ?");
        updateValues.push(parseInt(data.duration_days));
      }

      if (data.shared_users !== undefined) {
        updateFields.push("shared_users = ?");
        updateValues.push(parseInt(data.shared_users));
      }

      if (data.rate_limit !== undefined) {
        updateFields.push("rate_limit = ?");
        updateValues.push(data.rate_limit);
      }

      if (data.type !== undefined) {
        updateFields.push("type = ?");
        updateValues.push(data.type);
      }

      if (data.is_active !== undefined) {
        updateFields.push("is_active = ?");
        updateValues.push(data.is_active ? 1 : 0);
      }

      if (data.profile_name !== undefined) {
        updateFields.push("profile_name = ?");
        updateValues.push(data.profile_name);
      }

      // Tambah updated_at
      updateFields.push("updated_at = NOW()");

      if (updateFields.length === 0) {
        throw new Error("No fields to update");
      }

      // Eksekusi update
      const query = `UPDATE packages SET ${updateFields.join(
        ", ",
      )} WHERE id = ?`;
      updateValues.push(id);

      await connection.query(query, updateValues);

      // ============================================
      // UPDATE MIKROTIK PROFILE (jika rate_limit berubah)
      // ============================================
      if (data.rate_limit && data.rate_limit !== currentPackage.rate_limit) {
        console.log("🔄 Rate limit changed, updating MikroTik profiles...");

        // Get active routers
        const [routers] = await connection.query(
          'SELECT * FROM routers WHERE status = "active"',
        );

        const profileName = data.profile_name || currentPackage.profile_name;

        for (const router of routers) {
          try {
            const mikrotik = new MikrotikService({
              ip_address: router.ip_address,
              username: router.username,
              password: router.password,
              port: router.port || 8728,
              api_port: router.api_port || 8728,
            });

            // Update PPPoE profile
            await mikrotik.updatePPPoEProfile(profileName, data.rate_limit);

            console.log(`✅ PPPoE profile updated on ${router.name}`);
          } catch (mikrotikError) {
            console.error(
              `❌ Failed to update profile on ${router.name}:`,
              mikrotikError.message,
            );
            // Log error but don't fail the whole operation
          }
        }
      }

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "update_package",
          "package",
          id,
          `Package updated: ${data.name || currentPackage.name}`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      // Get updated package
      const [updatedPackages] = await connection.query(
        "SELECT * FROM packages WHERE id = ?",
        [id],
      );

      return updatedPackages[0];
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error in PackageService.updatePackage:", error);
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Delete package dengan validasi
  static async deletePackage(id, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🗑️ Attempting to delete package ID: ${id}`);

      // 1. Cek apakah package ada
      const [packages] = await connection.query(
        "SELECT * FROM packages WHERE id = ?",
        [id],
      );

      if (packages.length === 0) {
        throw new Error("Package not found");
      }

      const packageData = packages[0];

      // 2. Cek apakah package sedang digunakan oleh customer
      const [customers] = await connection.query(
        "SELECT COUNT(*) as count FROM customers WHERE package_id = ?",
        [id],
      );

      const customerCount = customers[0].count;

      if (customerCount > 0) {
        // Tampilkan detail customer yang menggunakan package ini
        const [customerDetails] = await connection.query(
          `SELECT c.id, c.name, c.username_pppoe 
         FROM customers c 
         WHERE c.package_id = ? 
         LIMIT 5`,
          [id],
        );

        const customerNames = customerDetails.map((c) => c.name).join(", ");

        throw new Error(
          `Cannot delete package. It is being used by ${customerCount} customer(s). ` +
            (customerNames ? `Examples: ${customerNames}` : ""),
        );
      }

      // 3. Cek apakah package digunakan di subscriptions
      const [subscriptions] = await connection.query(
        "SELECT COUNT(*) as count FROM subscriptions WHERE package_id = ?",
        [id],
      );

      const subscriptionCount = subscriptions[0].count;

      if (subscriptionCount > 0) {
        throw new Error(
          `Cannot delete package. It is referenced in ${subscriptionCount} subscription(s).`,
        );
      }

      // 4. Jika tidak digunakan, baru hapus package dari database
      const [deleteResult] = await connection.query(
        "DELETE FROM packages WHERE id = ?",
        [id],
      );

      // 5. Hapus profil PPPoE dari semua router yang aktif
      console.log(
        `🔄 Starting MikroTik profile deletion for: ${packageData.profile_name}`,
      );

      const [routers] = await connection.query(
        'SELECT * FROM routers WHERE status = "active"',
      );

      const mikrotikResults = [];
      const errors = [];

      for (const router of routers) {
        try {
          const mikrotik = new MikrotikService({
            ip_address: router.ip_address,
            username: router.username,
            password: router.password,
            port: router.port || 8728,
            api_port: router.api_port || 8728,
          });

          // Hapus PPPoE profile dari MikroTik
          const result = await mikrotik.deletePPPoEProfile(
            packageData.profile_name,
          );

          mikrotikResults.push({
            router_id: router.id,
            router_name: router.name,
            success: true,
            message: result.message,
          });

          console.log(
            `✅ PPPoE profile deleted from ${router.name}: ${packageData.profile_name}`,
          );
        } catch (mikrotikError) {
          console.error(
            `❌ Failed to delete profile on router ${router.name}:`,
            mikrotikError.message,
          );
          errors.push({
            router_id: router.id,
            router_name: router.name,
            error: mikrotikError.message,
          });

          // Log error ke database
          await connection.query(
            `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
           VALUES (?, ?, ?, ?, ?, ?)`,
            [
              "mikrotik_profile_delete_error",
              "package",
              id,
              `Failed to delete PPPoE profile on router ${router.name}: ${mikrotikError.message}`,
              "system",
              adminId,
            ],
          );
        }
      }

      // 6. Log activity untuk penghapusan package
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "delete_package",
          "package",
          id,
          `Package deleted: ${packageData.name} (${packageData.profile_name})`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      console.log(
        `✅ Package deleted successfully: ${packageData.name} (ID: ${id})`,
      );

      return {
        success: true,
        id,
        name: packageData.name,
        profile_name: packageData.profile_name,
        deleted: true,
        mikrotik_deletion: {
          total_routers: routers.length,
          success_count: mikrotikResults.length,
          failed_count: errors.length,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error in PackageService.deletePackage:", error.message);

      // Return error tanpa throw, agar controller bisa memberikan response yang sesuai
      return {
        success: false,
        error: error.message,
        package_id: id,
      };
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Get package by ID
  static async getPackageById(id) {
    try {
      const [packages] = await db.query("SELECT * FROM packages WHERE id = ?", [
        id,
      ]);
      return packages[0] || null;
    } catch (error) {
      console.error("Error in PackageService.getPackageById:", error);
      throw error;
    }
  }

  // Get active packages for customer selection
  static async getActivePackages() {
    try {
      const [packages] = await db.query(
        "SELECT * FROM packages WHERE is_active = 1 ORDER BY price ASC",
      );
      return packages;
    } catch (error) {
      console.error("Error in PackageService.getActivePackages:", error);
      throw error;
    }
  }

  // Toggle package active status
  static async togglePackageStatus(id, currentStatus) {
    try {
      const newStatus = currentStatus ? 0 : 1;
      const [result] = await db.query(
        "UPDATE packages SET is_active = ?, updated_at = NOW() WHERE id = ?",
        [newStatus, id],
      );
      return result.affectedRows > 0;
    } catch (error) {
      console.error("Error in PackageService.togglePackageStatus:", error);
      throw error;
    }
  }
}

module.exports = PackageService;
