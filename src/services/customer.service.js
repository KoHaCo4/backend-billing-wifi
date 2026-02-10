const db = require("../config/database");
const Customer = require("../models/Customer");
const MikrotikService = require("./mikrotik.service");
const logger = require("../utils/logger");
const SuspensionService = require("./suspension.service");

class CustomerService {
  // CREATE CUSTOMER dengan admin_id
  static async createCustomer(data, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log("📝 Create customer with data:", {
        name: data.name,
        username: data.username_pppoe,
        router_id: data.router_id,
        package_id: data.package_id,
        adminId,
        role,
      });

      // 1. Validasi username
      if (!data.username_pppoe) {
        throw new Error("Username PPPoE harus diisi");
      }

      // 2. Cek apakah username sudah terpakai
      const [existingUsers] = await connection.query(
        "SELECT id, name FROM customers WHERE username_pppoe = ?",
        [data.username_pppoe],
      );

      if (existingUsers.length > 0) {
        throw new Error(
          `Username "${data.username_pppoe}" sudah terpakai oleh customer: ${existingUsers[0].name}`,
        );
      }

      // 3. Get router and package info
      const [routers] = await connection.query(
        'SELECT * FROM routers WHERE id = ? AND status = "active"',
        [data.router_id],
      );

      const [packages] = await connection.query(
        "SELECT * FROM packages WHERE id = ? AND is_active = TRUE",
        [data.package_id],
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
        `🔧 Creating customer: ${data.username_pppoe}, expires: ${expiredAtStr}`,
      );

      // 6. Test MikroTik connection
      let mikrotik;
      try {
        mikrotik = new MikrotikService({
          ip_address: router.ip_address,
          username: router.username,
          password: router.password,
          api_port: router.api_port || 8728,
        });

        const testResult = await mikrotik.simpleTestConnection();

        if (!testResult.success) {
          throw new Error(
            `Router ${router.name} (${router.ip_address}): ${testResult.message}`,
          );
        }

        console.log("✅ MikroTik connection test successful");
      } catch (mikrotikError) {
        console.error(
          "❌ MikroTik connection test failed:",
          mikrotikError.message,
        );

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
          ],
        );

        await connection.rollback();
        throw new Error(
          `Gagal terhubung ke router ${router.name} (${router.ip_address}). ` +
            `Error: ${mikrotikError.message}. ` +
            "Pastikan router aktif dan API port terbuka.",
        );
      }

      // 7. Create customer in database WITH ADMIN_ID
      const [customerResult] = await connection.query(
        `INSERT INTO customers 
       (name, phone, address, username_pppoe, password_pppoe, 
        router_id, package_id, expired_at, status, auto_renew,
        admin_id, is_shared, shared_with) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          adminId, // Admin ID dari user yang login
          data.is_shared || 0,
          data.shared_with ? JSON.stringify(data.shared_with) : null,
        ],
      );

      const customerId = customerResult.insertId;

      // 8. Create subscription record
      await connection.query(
        `INSERT INTO subscriptions 
       (customer_id, package_id, start_date, expired_at, status, admin_id) 
       VALUES (?, ?, CURDATE(), ?, 'active', ?)`,
        [customerId, data.package_id, expiredAtStr, adminId],
      );

      // 9. Create PPPoE user di MikroTik
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
          `EXP:${expiredAtStr}`,
        );

        console.log(
          `✅ MikroTik user created successfully for customer ${customerId}`,
        );

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
          ],
        );
      } catch (mikrotikCreateError) {
        console.error(
          `❌ Failed to create PPPoE user: ${mikrotikCreateError.message}`,
        );

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
          ],
        );

        await connection.query(
          `UPDATE customers SET mikrotik_status = 'pending' WHERE id = ?`,
          [customerId],
        );

        console.warn(
          `⚠️ Customer created but MikroTik user pending: ${customerId}`,
        );
      }

      // 10. Create invoice dengan admin_id
      try {
        const invoiceNumber = `INV-${Date.now()}-${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        await connection.query(
          `INSERT INTO invoices 
         (invoice_number, customer_id, amount, description, status, issue_date, due_date, admin_id) 
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
          [
            invoiceNumber,
            customerId,
            pkg.price,
            `Invoice untuk paket ${pkg.name}`,
            "pending",
            expiredAtStr,
            adminId,
          ],
        );

        console.log(`✅ Invoice created for customer ${customerId}`);
      } catch (invoiceError) {
        console.warn(`⚠️ Invoice creation failed: ${invoiceError.message}`);
      }

      // 11. Log activity
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
        ],
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
        admin_id: adminId,
        is_shared: data.is_shared || 0,
        shared_with: data.shared_with || [],
      };
    } catch (error) {
      if (connection && connection.rollback) {
        try {
          await connection.rollback();
          console.log(
            "↩️ Transaction rolled back due to error:",
            error.message,
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

  // Get all customers dengan pagination dan filter multi-user
  static async getCustomers(
    page = 1,
    limit = 20,
    filters = {},
    adminId = null,
    role = null,
  ) {
    try {
      // Gunakan method dari model Customer yang sudah diupdate
      return await Customer.getCustomersWithPagination(
        page,
        limit,
        filters,
        adminId,
        role,
      );
    } catch (error) {
      logger.error("Get customers error:", error);
      throw error;
    }
  }

  // Get customer by ID dengan authorization
  static async getCustomerById(id, adminId = null, role = null) {
    try {
      return await Customer.getCustomerById(id, adminId, role);
    } catch (error) {
      logger.error("Get customer by ID error:", error);
      throw error;
    }
  }

  // Update customer dengan authorization
  static async updateCustomer(id, data, adminId, role) {
    try {
      // Gunakan method dari model Customer
      return await Customer.updateCustomer(id, data, adminId, role);
    } catch (error) {
      logger.error("Update customer error:", error);
      throw error;
    }
  }

  // Delete customer dengan authorization
  static async deleteCustomer(id, adminId, role) {
    try {
      return await Customer.deleteCustomer(id, adminId, role);
    } catch (error) {
      logger.error("Delete customer error:", error);
      throw error;
    }
  }

  // Deactivate customer
  static async deactivateCustomer(
    customerId,
    adminId,
    role,
    reason = "Deactivated by admin",
  ) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🚫 Deactivating customer ID: ${customerId}`);

      // 1. Cek akses terlebih dahulu
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );
      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      // 2. Check if customer has pending invoices
      const [pendingInvoices] = await connection.query(
        "SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND status = 'pending'",
        [customerId],
      );

      if (pendingInvoices[0].count > 0) {
        throw new Error(
          `Cannot deactivate customer. There are ${pendingInvoices[0].count} pending invoice(s). ` +
            "Please process or cancel the invoices first.",
        );
      }

      // 3. Update status to 'inactive'
      await connection.query(
        "UPDATE customers SET status = 'inactive', updated_at = NOW() WHERE id = ?",
        [customerId],
      );

      // 4. Disable PPPoE user in MikroTik
      try {
        const [routers] = await connection.query(
          "SELECT * FROM routers WHERE id = ?",
          [customer.router_id],
        );

        if (routers.length > 0) {
          const router = routers[0];
          const mikrotik = new MikrotikService({
            ip_address: router.ip_address,
            username: router.username,
            password: router.password,
            port: router.port || 8728,
          });

          await mikrotik.disablePPPoEUser(customer.username_pppoe);
          console.log(`✅ PPPoE user disabled on router: ${router.name}`);
        }
      } catch (mikrotikError) {
        console.error(
          `⚠️ Failed to disable PPPoE user:`,
          mikrotikError.message,
        );

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
          ],
        );
      }

      // 5. Update subscription status if exists
      await connection.query(
        "UPDATE subscriptions SET status = 'terminated' WHERE customer_id = ? AND status = 'active'",
        [customerId],
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
        ],
      );

      await connection.commit();

      console.log(
        `✅ Customer deactivated: ${customer.name} (ID: ${customerId})`,
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
        error.message,
      );
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Activate customer
  static async activateCustomer(customerId, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`✅ Activating customer ID: ${customerId}`);

      // 1. Cek akses terlebih dahulu
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );
      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      // 2. Update status to 'active'
      await connection.query(
        "UPDATE customers SET status = 'active', updated_at = NOW() WHERE id = ?",
        [customerId],
      );

      // 3. Enable PPPoE user in MikroTik
      try {
        const [routers] = await connection.query(
          "SELECT * FROM routers WHERE id = ?",
          [customer.router_id],
        );

        if (routers.length > 0) {
          const router = routers[0];
          const mikrotik = new MikrotikService({
            ip_address: router.ip_address,
            username: router.username,
            password: router.password,
            port: router.port || 8728,
          });

          await mikrotik.enablePPPoEUser(customer.username_pppoe);
          console.log(`✅ PPPoE user enabled on router: ${router.name}`);
        }
      } catch (mikrotikError) {
        console.error(`⚠️ Failed to enable PPPoE user:`, mikrotikError.message);

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
          ],
        );
      }

      // 4. Reactivate subscription if needed
      const today = new Date();
      const expiredDate = new Date(customer.expired_at);

      if (expiredDate >= today) {
        await connection.query(
          "UPDATE subscriptions SET status = 'active' WHERE customer_id = ?",
          [customerId],
        );
      } else {
        console.log(
          `⚠️ Customer ${customer.name} has expired, subscription remains terminated`,
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
        ],
      );

      await connection.commit();

      console.log(
        `✅ Customer activated: ${customer.name} (ID: ${customerId})`,
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
        error.message,
      );
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Share customer dengan admin lain
  static async shareCustomer(customerId, adminId, role, targetAdminIds) {
    try {
      // Hanya pemilik yang bisa share
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );

      if (!customer || customer.admin_id !== adminId) {
        throw new Error("You can only share customers that you own");
      }

      // Panggil method dari model Customer
      return await Customer.shareCustomer(customerId, adminId, targetAdminIds);
    } catch (error) {
      logger.error("Share customer error:", error);
      throw error;
    }
  }

  // Get statistics dengan filter multi-user
  static async getStatistics(adminId = null, role = null) {
    try {
      return await Customer.getStatistics(adminId, role);
    } catch (error) {
      logger.error("Get statistics error:", error);
      throw error;
    }
  }

  // Extend customer package
  static async extendCustomer(customerId, days, adminId, role) {
    try {
      // Cek akses terlebih dahulu
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );
      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      if (days && days <= 0) {
        throw new Error("Days must be greater than 0");
      }

      const connection = await db.getConnection();

      try {
        await connection.beginTransaction();

        // Calculate new expiration date
        const currentExpiredAt = new Date(customer.expired_at);
        const newExpiredAt = new Date(currentExpiredAt);
        newExpiredAt.setDate(newExpiredAt.getDate() + days);

        // Update customer
        await connection.query(
          "UPDATE customers SET expired_at = ?, updated_at = NOW() WHERE id = ?",
          [newExpiredAt.toISOString().split("T")[0], customerId],
        );

        // Update subscription
        await connection.query(
          "UPDATE subscriptions SET expired_at = ? WHERE customer_id = ?",
          [newExpiredAt.toISOString().split("T")[0], customerId],
        );

        // Log activity
        await connection.query(
          `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            "extend_customer",
            "customer",
            customerId,
            `Customer extended by ${days} days, new expiry: ${newExpiredAt.toISOString().split("T")[0]}`,
            "admin",
            adminId,
          ],
        );

        await connection.commit();

        return {
          success: true,
          customer_id: customerId,
          old_expired_at: customer.expired_at,
          new_expired_at: newExpiredAt.toISOString().split("T")[0],
          days_added: days,
        };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        if (connection && connection.release) {
          connection.release();
        }
      }
    } catch (error) {
      logger.error("Extend customer error:", error);
      throw error;
    }
  }

  // Suspend customer
  static async suspendCustomer(
    customerId,
    adminId,
    role,
    reason = "Manual suspension",
  ) {
    try {
      // Cek akses terlebih dahulu
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );
      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      return await SuspensionService.suspendCustomer(
        customerId,
        adminId,
        reason,
      );
    } catch (error) {
      logger.error("Suspend customer error:", error);
      throw error;
    }
  }

  // Reactivate customer dari suspension
  static async reactivateCustomer(
    customerId,
    adminId,
    role,
    reason = "Manual activation",
  ) {
    try {
      // Cek akses terlebih dahulu
      const customer = await Customer.getCustomerById(
        customerId,
        adminId,
        role,
      );
      if (!customer) {
        throw new Error("Customer not found or access denied");
      }

      return await SuspensionService.reactivateCustomer(
        customerId,
        adminId,
        reason,
      );
    } catch (error) {
      logger.error("Reactivate customer error:", error);
      throw error;
    }
  }

  // Get recent customers for dashboard
  static async getRecentCustomers(adminId, limit = 10) {
    try {
      return await Customer.getCustomersByAdmin(adminId, limit);
    } catch (error) {
      logger.error("Get recent customers error:", error);
      throw error;
    }
  }
}

module.exports = CustomerService;
