const CustomerService = require("../services/customer.service");

class CustomerController {
  // Create customer
  static async createCustomer(req, res) {
    try {
      console.log("📥 CREATE CUSTOMER REQUEST BODY:", req.body);

      const {
        name,
        phone,
        address,
        router_id,
        package_id,
        auto_renew,
        username_pppoe,
        password_pppoe,
        expired_at,
        status,
      } = req.body;

      const adminId = req.user ? req.user.id : 1;

      // Validasi field wajib
      if (!name || !router_id || !package_id) {
        return res.status(400).json({
          success: false,
          message: "Nama, router, dan paket harus diisi",
        });
      }

      if (!username_pppoe) {
        return res.status(400).json({
          success: false,
          message: "Username PPPoE harus diisi",
        });
      }

      if (!password_pppoe) {
        return res.status(400).json({
          success: false,
          message: "Password PPPoE harus diisi",
        });
      }

      // Validasi format username
      const usernameRegex = /^[a-zA-Z0-9._-]+$/;
      if (!usernameRegex.test(username_pppoe)) {
        return res.status(400).json({
          success: false,
          message:
            "Username hanya boleh mengandung huruf, angka, titik, underscore, dan dash",
        });
      }

      const customer = await CustomerService.createCustomer(
        {
          name,
          phone: phone || null,
          address: address || null,
          router_id,
          package_id,
          auto_renew: auto_renew === undefined ? 1 : auto_renew ? 1 : 0,
          username_pppoe,
          password_pppoe,
          expired_at,
          status: status || "active",
        },
        adminId,
      );

      console.log("✅ Customer created successfully:", customer.id);

      res.status(201).json({
        success: true,
        message: "Customer berhasil dibuat",
        data: customer,
      });
    } catch (error) {
      console.error("❌ Create customer error:", error.message);

      // Handle specific MikroTik errors
      let errorMessage = error.message;
      let statusCode = 500;

      if (
        error.message.includes("MikroTik") ||
        error.message.includes("router")
      ) {
        errorMessage = `Gagal terhubung ke router: ${error.message}`;
        statusCode = 503; // Service Unavailable
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // Get all customers
  static async getCustomers(req, res) {
    try {
      const { page = 1, limit = 20, status, router_id, search } = req.query;

      const result = await CustomerService.getCustomers(page, limit, {
        status,
        router_id,
        search,
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get customer by ID
  static async getCustomer(req, res) {
    try {
      const { id } = req.params;

      const customer = await CustomerService.getCustomerById(id);

      res.json({
        success: true,
        data: customer,
      });
    } catch (error) {
      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update customer
  static async updateCustomer(req, res) {
    try {
      const { id } = req.params;
      const {
        name,
        phone,
        address,
        router_id,
        package_id,
        auto_renew,
        username_pppoe,
        password_pppoe,
        expired_at,
        status,
      } = req.body;

      const adminId = req.user.id;

      // DEBUG: Log semua data yang diterima
      console.log("🔄 UPDATE CUSTOMER REQUEST:", {
        id,
        name,
        phone,
        address,
        router_id,
        package_id,
        auto_renew,
        username_pppoe,
        password_pppoe: password_pppoe
          ? "***" + password_pppoe.slice(-3)
          : "undefined/empty",
        expired_at,
        status,
        adminId,
      });

      // Validasi data yang diperlukan
      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Name is required",
        });
      }

      if (!router_id) {
        return res.status(400).json({
          success: false,
          message: "Router is required",
        });
      }

      if (!package_id) {
        return res.status(400).json({
          success: false,
          message: "Package is required",
        });
      }

      // Handle phone jika undefined/null
      const phoneToUpdate = phone === undefined ? null : phone;

      const customer = await CustomerService.updateCustomer(
        id,
        {
          name,
          phone: phoneToUpdate,
          address: address || "",
          router_id,
          package_id,
          auto_renew: auto_renew === undefined ? 1 : auto_renew ? 1 : 0,
          username_pppoe,
          password_pppoe: password_pppoe || undefined,
          expired_at,
          status: status || "active",
        },
        adminId,
      );

      console.log("✅ UPDATE CUSTOMER SUCCESS:", { id });

      res.json({
        success: true,
        message: "Customer updated successfully",
        data: customer,
      });
    } catch (error) {
      console.error("❌ UPDATE CUSTOMER ERROR:", error);
      console.error("❌ Error stack:", error.stack);

      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error during update",
        error:
          process.env.NODE_ENV === "development"
            ? {
                message: error.message,
                stack: error.stack,
              }
            : undefined,
      });
    }
  }

  // Delete customer
  static async deleteCustomer(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      console.log(
        `🔍 Attempting to delete customer ID: ${id}, adminId: ${adminId}`,
      );

      const result = await CustomerService.deleteCustomer(id, adminId);

      console.log(`✅ Delete successful for customer ID: ${id}`);

      res.json({
        success: true,
        message: "Customer deleted successfully",
        data: result,
      });
    } catch (error) {
      console.error(`❌ Delete customer error:`, error);
      console.error(`❌ Error stack:`, error.stack);

      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error during delete",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // Deactivate customer
  static async deactivateCustomer(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.user.id;

      console.log(
        `🚫 Deactivate customer request for ID: ${id}, Reason: ${reason}`,
      );

      const result = await CustomerService.deactivateCustomer(
        id,
        adminId,
        reason,
      );

      res.json({
        success: true,
        message: "Customer deactivated successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error deactivating customer:", error);

      let statusCode = 500;
      let errorMessage = error.message;

      if (error.message.includes("Customer not found")) {
        statusCode = 404;
      } else if (error.message.includes("Cannot deactivate customer")) {
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

  // Extend customer package
  static async extendCustomer(req, res) {
    try {
      const { id } = req.params;
      const { days } = req.body;
      const adminId = req.user.id;

      if (days && days <= 0) {
        return res.status(400).json({
          success: false,
          message: "Days must be greater than 0",
        });
      }

      const result = await CustomerService.extendCustomer(id, days, adminId);

      res.json({
        success: true,
        message: "Customer extended successfully",
        data: result,
      });
    } catch (error) {
      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Suspend customer - UPDATE
  static async suspendCustomer(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const adminId = req.user.id;

      console.log(
        `🚫 Suspend customer ${id}, reason: ${reason || "Not specified"}`,
      );

      const result = await SuspensionService.suspendCustomer(
        id,
        adminId,
        reason || "Suspended by admin",
      );

      res.json({
        success: true,
        message: "Customer suspended successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Suspend customer error:", error);

      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === "Customer already suspended") {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Activate customer - UPDATE
  static async activateCustomer(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const adminId = req.user.id;

      console.log(
        `🔄 Activate customer ${id}, reason: ${reason || "Not specified"}`,
      );

      const result = await SuspensionService.reactivateCustomer(
        id,
        adminId,
        reason || "Activated by admin",
      );

      res.json({
        success: true,
        message: "Customer activated successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Activate customer error:", error);

      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message === "Customer is not suspended") {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Activate customer
  static async activateCustomer(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      const result = await CustomerService.activateCustomer(id, adminId);

      res.json({
        success: true,
        message: "Customer activated successfully",
        data: result,
      });
    } catch (error) {
      if (error.message === "Customer not found") {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get statistics
  static async getStatistics(req, res) {
    try {
      const stats = await CustomerService.getStatistics();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = CustomerController;
