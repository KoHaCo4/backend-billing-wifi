const db = require("../config/database");
const MikrotikService = require("./mikrotik.service");
const logger = require("../utils/logger");
const SuspensionService = require("./suspension.service");

class CustomerService {
  // CREATE CUSTOMER
  static async createCustomer(data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log("📝 Create customer with data:", {
        name: data.name,
        username: data.username_pppoe,
        router_id: data.router_id,
        package_id: data.package_id,
        adminId,
      });

      // 1. Validasi username
      if (!data.username_pppoe) {
        throw new Error("Username PPPoE harus diisi");
      }

      // 2. Cek apakah username sudah terpakai
      const [existingUsers] = await connection.query(
        "SELECT id, name FROM customers WHERE username_pppoe = ?",
        [data.username_pppoe]
      );

      if (existingUsers.length > 0) {
        throw new Error(
          `Username "${data.username_pppoe}" sudah terpakai oleh customer: ${existingUsers[0].name}`
        );
      }

      // 3. Get router and package info
      const [routers] = await connection.query(
        'SELECT * FROM routers WHERE id = ? AND status = "active"',
        [data.router_id]
      );

      const [packages] = await connection.query(
        "SELECT * FROM packages WHERE id = ? AND is_active = TRUE",
        [data.package_id]
      );

      if (routers.length === 0) throw new Error("Router tidak ditemukan");
      if (packages.length === 0) throw new Error("Paket tidak ditemukan");

      const router = routers[0];
      const pkg = packages[0];

      // 4. Validasi password
      if (!data.password_pppoe) {
        throw new Error("Password PPPoE harus diisi");
      }

      // 5. Calculate expiration date
      let expiredAt;
      if (data.expired_at) {
        expiredAt = new Date(data.expired_at);
      } else {
        expiredAt = new Date();
        expiredAt.setDate(expiredAt.getDate() + pkg.duration_days);
      }
      const expiredAtStr = expiredAt.toISOString().split("T")[0];

      console.log(
        `🔧 Creating customer: ${data.username_pppoe}, expires: ${expiredAtStr}`
      );

      // ✅ PERBAIKAN: TEST MIKROTIK CONNECTION DENGAN SIMPLE METHOD
      let mikrotik;
      try {
        mikrotik = new MikrotikService({
          ip_address: router.ip_address,
          username: router.username,
          password: router.password,
          api_port: router.api_port || 8728,
        });

        // Gunakan simple test untuk UI
        const testResult = await mikrotik.simpleTestConnection();

        if (!testResult.success) {
          throw new Error(
            `Router ${router.name} (${router.ip_address}): ${testResult.message}`
          );
        }

        console.log("✅ MikroTik connection test successful");
      } catch (mikrotikError) {
        console.error(
          "❌ MikroTik connection test failed:",
          mikrotikError.message
        );

        // Log error
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "mikrotik_connection_error",
            "router",
            router.id,
            `MikroTik connection failed: ${mikrotikError.message}`,
            "system",
            adminId,
          ]
        );

        await connection.rollback();
        throw new Error(
          `Gagal terhubung ke router ${router.name} (${router.ip_address}). ` +
            `Error: ${mikrotikError.message}. ` +
            "Pastikan router aktif dan API port terbuka."
        );
      }

      // 6. Create customer in database FIRST
      const [customerResult] = await connection.query(
        `INSERT INTO customers 
       (name, phone, address, username_pppoe, password_pppoe, router_id, package_id, expired_at, status, auto_renew) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.phone || null,
          data.address || null,
          data.username_pppoe,
          data.password_pppoe,
          data.router_id,
          data.package_id,
          expiredAtStr,
          data.status || "active",
          data.auto_renew !== undefined ? data.auto_renew : 1,
        ]
      );

      const customerId = customerResult.insertId;

      // 7. Create subscription record
      await connection.query(
        `INSERT INTO subscriptions 
       (customer_id, package_id, start_date, expired_at, status) 
       VALUES (?, ?, CURDATE(), ?, 'active')`,
        [customerId, data.package_id, expiredAtStr]
      );

      // 8. ✅ CREATE PPPOE USER DI MIKROTIK (setelah database commit)
      try {
        const profileName =
          pkg.profile_name || pkg.name.toLowerCase().replace(/\s+/g, "_");

        // Create PPPoE profile if needed
        await mikrotik.createPPPoEProfile(profileName, pkg.rate_limit);

        // Create PPPoE user
        await mikrotik.createPPPoEUser(
          data.username_pppoe,
          data.password_pppoe,
          profileName,
          `EXP:${expiredAtStr}`
        );

        console.log(
          `✅ MikroTik user created successfully for customer ${customerId}`
        );

        // Log success
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "mikrotik_user_created",
            "customer",
            customerId,
            `PPPoE user ${data.username_pppoe} created on router ${router.name}`,
            "system",
            adminId,
          ]
        );
      } catch (mikrotikCreateError) {
        console.error(
          `❌ Failed to create PPPoE user: ${mikrotikCreateError.message}`
        );

        // Log error but DON'T rollback - customer sudah dibuat di database
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "mikrotik_creation_error",
            "customer",
            customerId,
            `Failed to create PPPoE user: ${mikrotikCreateError.message}`,
            "system",
            adminId,
          ]
        );

        // Set flag bahwa user perlu dibuat manual di MikroTik
        await connection.query(
          `UPDATE customers SET mikrotik_status = 'pending' WHERE id = ?`,
          [customerId]
        );

        console.warn(
          `⚠️ Customer created but MikroTik user pending: ${customerId}`
        );
      }

      // 9. Create invoice
      try {
        const invoiceNumber = `INV-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        await connection.query(
          `INSERT INTO invoices 
         (invoice_number, customer_id, amount, description, status, issue_date, due_date) 
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
          [
            invoiceNumber,
            customerId,
            pkg.price,
            `Invoice untuk paket ${pkg.name}`,
            "pending",
            expiredAtStr,
          ]
        );

        console.log(`✅ Invoice created for customer ${customerId}`);
      } catch (invoiceError) {
        console.warn(`⚠️ Invoice creation failed: ${invoiceError.message}`);
        // Jangan gagal keseluruhan jika invoice gagal
      }

      // 10. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "create_customer",
          "customer",
          customerId,
          `Customer created: ${data.name} (${data.username_pppoe})`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      console.log(`🎉 Customer created successfully: ${customerId}`);

      return {
        id: customerId,
        name: data.name,
        username_pppoe: data.username_pppoe,
        expired_at: expiredAtStr,
        package: pkg.name,
        router: router.name,
        auto_renew: data.auto_renew !== undefined ? data.auto_renew : 1,
        mikrotik_status: "created",
      };
    } catch (error) {
      // Rollback jika ada error SEBELUM customer dibuat
      if (connection && connection.rollback) {
        try {
          await connection.rollback();
          console.log(
            "↩️ Transaction rolled back due to error:",
            error.message
          );
        } catch (rollbackError) {
          console.error("❌ Failed to rollback transaction:", rollbackError);
        }
      }

      console.error("Create customer error:", error);
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Get all customers with pagination - TETAP SAMA
  static async getCustomers(page = 1, limit = 20, filters = {}) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params = [];

      if (filters.status) {
        whereClause += " AND c.status = ?";
        params.push(filters.status);
      }

      if (filters.router_id) {
        whereClause += " AND c.router_id = ?";
        params.push(filters.router_id);
      }

      if (filters.search) {
        whereClause +=
          " AND (c.name LIKE ? OR c.username_pppoe LIKE ? OR c.phone LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      // Get customers
      const [customers] = await db.query(
        `SELECT 
        c.*,
        r.name as router_name,
        p.name as package_name,
        p.duration_days,
        p.price,
        DATE_FORMAT(c.expired_at, '%Y-%m-%d') as expired_at,
        DATEDIFF(c.expired_at, CURDATE()) as days_remaining
       FROM customers c
       JOIN routers r ON c.router_id = r.id
       JOIN packages p ON c.package_id = p.id
       ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), parseInt(offset)]
      );

      // Get total count
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM customers c ${whereClause}`,
        params
      );

      return {
        data: customers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Get customers error:", error);
      throw error;
    }
  }

  // Update customer - TAMBAH VALIDASI UNIQUENESS USERNAME
  static async updateCustomer(id, data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🔍 Updating customer ID: ${id}`, data);

      // Check if customer exists
      const [customers] = await connection.query(
        `SELECT c.*, r.* FROM customers c 
       JOIN routers r ON c.router_id = r.id 
       WHERE c.id = ?`,
        [id]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // Validasi: Cek apakah username baru sudah digunakan oleh customer lain
      if (
        data.username_pppoe &&
        data.username_pppoe !== customer.username_pppoe
      ) {
        const [existing] = await connection.query(
          "SELECT id FROM customers WHERE username_pppoe = ? AND id != ?",
          [data.username_pppoe, id]
        );

        if (existing.length > 0) {
          throw new Error(
            `Username "${data.username_pppoe}" sudah digunakan oleh customer lain`
          );
        }
      }

      // Build update fields
      const updateFields = [];
      const updateValues = [];

      // Field yang selalu diupdate
      const fieldsToUpdate = [
        { name: "name", value: data.name },
        { name: "phone", value: data.phone },
        { name: "address", value: data.address },
        { name: "router_id", value: data.router_id },
        { name: "package_id", value: data.package_id },
        { name: "auto_renew", value: data.auto_renew },
        { name: "status", value: data.status },
      ];

      fieldsToUpdate.forEach((field) => {
        if (data[field.name] !== undefined) {
          updateFields.push(`${field.name} = ?`);
          updateValues.push(
            field.name === "phone" && data[field.name] === null
              ? null
              : field.value
          );
        }
      });

      // Handle expired_at
      if (data.expired_at !== undefined) {
        let expiredDate = data.expired_at;
        if (typeof expiredDate === "string" && expiredDate.includes("T")) {
          expiredDate = expiredDate.split("T")[0];
        }
        updateFields.push("expired_at = ?");
        updateValues.push(expiredDate);
      }

      // Handle username_pppoe jika berbeda
      if (
        data.username_pppoe &&
        data.username_pppoe !== customer.username_pppoe
      ) {
        updateFields.push("username_pppoe = ?");
        updateValues.push(data.username_pppoe);

        // Update username di MikroTik jika ada perubahan
        try {
          const mikrotik = new MikrotikService(customer);
          await mikrotik.updatePPPoEUsername(
            customer.username_pppoe,
            data.username_pppoe
          );
          console.log(
            `✅ MikroTik username updated: ${customer.username_pppoe} -> ${data.username_pppoe}`
          );
        } catch (mikrotikError) {
          console.error(
            `❌ MikroTik username update failed:`,
            mikrotikError.message
          );
          await connection.query(
            `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
           VALUES (?, ?, ?, ?, ?, ?)`,
            [
              "mikrotik_error",
              "customer",
              id,
              `MikroTik username update failed: ${mikrotikError.message}`,
              "system",
              adminId,
            ]
          );
        }
      }

      // Handle password_pppoe jika diberikan
      if (data.password_pppoe && data.password_pppoe.trim() !== "") {
        updateFields.push("password_pppoe = ?");
        updateValues.push(data.password_pppoe);

        // Update password di MikroTik
        try {
          const mikrotik = new MikrotikService(customer);
          const usernameToUpdate =
            data.username_pppoe || customer.username_pppoe;
          await mikrotik.updatePPPoEPassword(
            usernameToUpdate,
            data.password_pppoe
          );
          console.log(
            `✅ MikroTik password updated for user: ${usernameToUpdate}`
          );
        } catch (mikrotikError) {
          console.error(
            `❌ MikroTik password update failed:`,
            mikrotikError.message
          );
          await connection.query(
            `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
           VALUES (?, ?, ?, ?, ?, ?)`,
            [
              "mikrotik_error",
              "customer",
              id,
              `MikroTik password update failed: ${mikrotikError.message}`,
              "system",
              adminId,
            ]
          );
        }
      }

      // Tambah updated_at
      updateFields.push("updated_at = NOW()");

      // Eksekusi update jika ada perubahan
      if (updateFields.length > 0) {
        updateValues.push(id);

        const updateQuery = `UPDATE customers SET ${updateFields.join(
          ", "
        )} WHERE id = ?`;
        await connection.query(updateQuery, updateValues);
      }

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "update_customer",
          "customer",
          id,
          `Customer updated: ${data.name} (${
            data.username_pppoe || customer.username_pppoe
          })`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      // Return updated customer data
      const [updatedCustomers] = await connection.query(
        `SELECT 
        c.*,
        r.name as router_name,
        p.name as package_name
       FROM customers c
       JOIN routers r ON c.router_id = r.id
       JOIN packages p ON c.package_id = p.id
       WHERE c.id = ?`,
        [id]
      );

      return updatedCustomers[0];
    } catch (error) {
      await connection.rollback();
      console.error(`❌ Update customer error:`, error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Get statistics - TAMBAH STATISTIK UNTUK DEBUG
  static async getStatistics() {
    try {
      const [stats] = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM customers) as total_customers,
          (SELECT COUNT(*) FROM customers WHERE status = 'active') as active_customers,
          (SELECT COUNT(*) FROM customers WHERE status = 'expired') as expired_customers,
          (SELECT COUNT(*) FROM customers WHERE status = 'suspended') as suspended_customers,
          (SELECT COUNT(*) FROM customers WHERE DATEDIFF(expired_at, CURDATE()) <= 3 AND status = 'active') as expiring_soon,
          (SELECT COUNT(*) FROM customers WHERE username_pppoe LIKE 'CUST%') as auto_generated_users,
          (SELECT COUNT(*) FROM customers WHERE username_pppoe NOT LIKE 'CUST%') as manual_users,
          (SELECT SUM(price) FROM packages p JOIN customers c ON p.id = c.package_id WHERE c.status = 'active') as monthly_revenue
      `);

      return stats[0];
    } catch (error) {
      logger.error("Get statistics error:", error);
      throw error;
    }
  }

  // Delete customer - FUNGSI INI HILANG, TAMBAHKAN KEMBALI
  // Delete customer - ONLY FOR DEVELOPMENT/TESTING
  static async deleteCustomer(id, adminId) {
    // Production safety check
    const isProduction = process.env.NODE_ENV === "production";
    const userRole = adminId.role || "admin"; // Assume adminId contains role info

    if (isProduction && userRole !== "superadmin") {
      throw new Error(
        "Customer deletion is not allowed in production environment"
      );
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(
        `🔍 Attempting to delete customer ID: ${id} - ENV: ${process.env.NODE_ENV}`
      );

      // 1. Get customer data
      const [customers] = await connection.query(
        `SELECT c.*, r.* FROM customers c 
       LEFT JOIN routers r ON c.router_id = r.id 
       WHERE c.id = ?`,
        [id]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // 2. STRICT VALIDATION for production
      if (isProduction) {
        // Check if customer has any payments
        const [payments] = await connection.query(
          `SELECT COUNT(p.id) as payment_count 
         FROM invoices i 
         LEFT JOIN payments p ON i.id = p.invoice_id 
         WHERE i.customer_id = ?`,
          [id]
        );

        if (payments[0].payment_count > 0) {
          throw new Error(
            `Cannot delete customer with payment history. ` +
              `Customer has ${payments[0].payment_count} payment record(s). ` +
              `Use deactivate instead.`
          );
        }

        // Check if customer is recent (less than 24 hours old)
        const [customerAge] = await connection.query(
          `SELECT TIMESTAMPDIFF(HOUR, created_at, NOW()) as hours_old 
         FROM customers WHERE id = ?`,
          [id]
        );

        if (customerAge[0].hours_old > 24) {
          throw new Error(
            `Cannot delete customer older than 24 hours in production. ` +
              `Customer is ${customerAge[0].hours_old} hours old. ` +
              `Use deactivate instead.`
          );
        }
      }

      // 3. Check for existing invoices
      const [invoices] = await connection.query(
        "SELECT id FROM invoices WHERE customer_id = ?",
        [id]
      );

      const invoiceIds = invoices.map((inv) => inv.id);

      if (invoiceIds.length > 0) {
        console.log(`📄 Found ${invoiceIds.length} invoices for this customer`);

        // Delete payments related to these invoices
        if (invoiceIds.length > 0) {
          await connection.query(
            "DELETE FROM payments WHERE invoice_id IN (?)",
            [invoiceIds]
          );
          console.log(`✅ Deleted payments for ${invoiceIds.length} invoices`);
        }

        // Delete invoices
        await connection.query("DELETE FROM invoices WHERE customer_id = ?", [
          id,
        ]);
        console.log(`✅ Deleted ${invoiceIds.length} invoices`);
      }

      // 4. Delete subscriptions
      await connection.query(
        "DELETE FROM subscriptions WHERE customer_id = ?",
        [id]
      );
      console.log(`✅ Subscriptions deleted`);

      // 5. Remove from MikroTik (optional - only if exists)
      if (customer.ip_address && customer.username_pppoe) {
        try {
          const mikrotik = new MikrotikService({
            ip_address: customer.ip_address,
            username: customer.username,
            password: customer.password,
            port: customer.port || 8728,
          });

          // Check if user exists before removing
          const userExists = await mikrotik.checkPPPoEUserExists(
            customer.username_pppoe
          );
          if (userExists) {
            await mikrotik.removePPPoEUser(customer.username_pppoe);
            console.log(`✅ MikroTik user removed: ${customer.username_pppoe}`);
          } else {
            console.log(`ℹ️ MikroTik user not found, skipping removal`);
          }
        } catch (mikrotikError) {
          console.warn(`⚠️ MikroTik removal failed: ${mikrotikError.message}`);
          // Don't fail if MikroTik fails
        }
      }

      // 6. Delete customer from database
      await connection.query("DELETE FROM customers WHERE id = ?", [id]);
      console.log(`✅ Customer deleted from database`);

      // 7. Log activity with environment info
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "delete_customer",
          "customer",
          id,
          `Customer PERMANENTLY deleted: ${customer.name} (${customer.username_pppoe}) - ENV: ${process.env.NODE_ENV}`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();
      console.log(`🎉 Customer delete transaction committed`);

      return {
        success: true,
        message: "Customer deleted successfully",
        warning: isProduction
          ? "Production environment - audit trail preserved"
          : "Development environment",
        deleted_customer: {
          id: id,
          name: customer.name,
          username: customer.username_pppoe,
          environment: process.env.NODE_ENV,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error(`❌ Delete customer error:`, error);
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Deactivate customer (set status to 'inactive' and disable PPPoE)
  static async deactivateCustomer(
    customerId,
    adminId,
    reason = "Deactivated by admin"
  ) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🚫 Deactivating customer ID: ${customerId}`);

      // 1. Check if customer exists
      const [customers] = await connection.query(
        "SELECT c.*, r.* FROM customers c JOIN routers r ON c.router_id = r.id WHERE c.id = ?",
        [customerId]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // 2. Check if customer has pending invoices
      const [pendingInvoices] = await connection.query(
        "SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND status = 'pending'",
        [customerId]
      );

      if (pendingInvoices[0].count > 0) {
        throw new Error(
          `Cannot deactivate customer. There are ${pendingInvoices[0].count} pending invoice(s). ` +
            "Please process or cancel the invoices first."
        );
      }

      // 3. Update status to 'inactive' (need to update ENUM first)
      await connection.query(
        "UPDATE customers SET status = 'inactive', updated_at = NOW() WHERE id = ?",
        [customerId]
      );

      // 4. Disable PPPoE user in MikroTik
      try {
        const mikrotik = new MikrotikService({
          ip_address: customer.ip_address,
          username: customer.username,
          password: customer.password,
          port: customer.port || 8728,
        });

        await mikrotik.disablePPPoEUser(customer.username_pppoe);
        console.log(`✅ PPPoE user disabled on router: ${customer.name}`);
      } catch (mikrotikError) {
        console.error(
          `⚠️ Failed to disable PPPoE user:`,
          mikrotikError.message
        );

        // Log error but don't fail the whole operation
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            "mikrotik_error",
            "customer",
            customerId,
            `Failed to disable PPPoE user: ${mikrotikError.message}`,
            "system",
            adminId,
          ]
        );
      }

      // 5. Update subscription status if exists
      await connection.query(
        "UPDATE subscriptions SET status = 'terminated' WHERE customer_id = ? AND status = 'active'",
        [customerId]
      );

      // 6. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "deactivate_customer",
          "customer",
          customerId,
          `Customer deactivated: ${customer.name} (${customer.username_pppoe}) - Reason: ${reason}`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      console.log(
        `✅ Customer deactivated: ${customer.name} (ID: ${customerId})`
      );

      return {
        success: true,
        message: "Customer deactivated successfully",
        data: {
          customer_id: customerId,
          customer_name: customer.name,
          status: "inactive",
          pppoe_disabled: true,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error(
        "❌ Error in CustomerService.deactivateCustomer:",
        error.message
      );
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Activate customer (set status to 'active' and enable PPPoE)
  static async activateCustomer(customerId, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`✅ Activating customer ID: ${customerId}`);

      // 1. Check if customer exists
      const [customers] = await connection.query(
        "SELECT c.*, r.* FROM customers c JOIN routers r ON c.router_id = r.id WHERE c.id = ?",
        [customerId]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // 2. Update status to 'active'
      await connection.query(
        "UPDATE customers SET status = 'active', updated_at = NOW() WHERE id = ?",
        [customerId]
      );

      // 3. Enable PPPoE user in MikroTik
      try {
        const mikrotik = new MikrotikService({
          ip_address: customer.ip_address,
          username: customer.username,
          password: customer.password,
          port: customer.port || 8728,
        });

        await mikrotik.enablePPPoEUser(customer.username_pppoe);
        console.log(`✅ PPPoE user enabled on router: ${customer.name}`);
      } catch (mikrotikError) {
        console.error(`⚠️ Failed to enable PPPoE user:`, mikrotikError.message);

        // Log error but don't fail the whole operation
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            "mikrotik_error",
            "customer",
            customerId,
            `Failed to enable PPPoE user: ${mikrotikError.message}`,
            "system",
            adminId,
          ]
        );
      }

      // 4. Reactivate subscription if needed
      const today = new Date();
      const expiredDate = new Date(customer.expired_at);

      if (expiredDate >= today) {
        await connection.query(
          "UPDATE subscriptions SET status = 'active' WHERE customer_id = ?",
          [customerId]
        );
      } else {
        console.log(
          `⚠️ Customer ${customer.name} has expired, subscription remains terminated`
        );
      }

      // 5. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "activate_customer",
          "customer",
          customerId,
          `Customer activated: ${customer.name} (${customer.username_pppoe})`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      console.log(
        `✅ Customer activated: ${customer.name} (ID: ${customerId})`
      );

      return {
        success: true,
        message: "Customer activated successfully",
        data: {
          customer_id: customerId,
          customer_name: customer.name,
          status: "active",
          pppoe_enabled: true,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error(
        "❌ Error in CustomerService.activateCustomer:",
        error.message
      );
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Suspend customer (integrated with MikroTik)
  static async suspendCustomer(
    customerId,
    adminId,
    reason = "Manual suspension"
  ) {
    return await SuspensionService.suspendCustomer(customerId, adminId, reason);
  }

  // // Activate/reactivate customer (integrated with MikroTik)
  // static async activateCustomer(
  //   customerId,
  //   adminId,
  //   reason = "Manual activation"
  // ) {
  //   return await SuspensionService.reactivateCustomer(
  //     customerId,
  //     adminId,
  //     reason
  //   );
  // }

  // Update customer expired_at dan status jika expired
  static async updateCustomerExpiry(customerId, expiredAt) {
    const customer = await Customer.findByPk(customerId);

    if (!customer) {
      throw new Error("Customer not found");
    }

    const today = new Date();
    const newExpiredDate = new Date(expiredAt);

    // Update expired_at
    await customer.update({ expired_at: newExpiredDate });

    // Jika expired_at sudah lewat, update status ke expired
    if (newExpiredDate < today && customer.status === "active") {
      await customer.update({ status: "expired" });
    }

    return customer;
  }
}

module.exports = CustomerService;
