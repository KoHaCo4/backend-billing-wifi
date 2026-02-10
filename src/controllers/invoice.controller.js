const db = require("../config/database");
const InvoiceService = require("../services/invoice.service");
const InvoiceUtils = require("../utils/invoice");
const messagingService = require("../services/messaging.service");

class InvoiceController {
  // Get all invoices dengan filter multi-user
  static async getInvoices(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        customer_id,
        status,
        date_from,
        date_to,
        search,
      } = req.query;

      const adminId = req.user.id;
      const role = req.user.role;

      // Validasi input
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid page number",
        });
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be between 1 and 100",
        });
      }

      // Panggil service dengan adminId dan role
      const result = await InvoiceService.getInvoices(
        {
          customer_id,
          status,
          date_from,
          date_to,
          search,
        },
        pageNum,
        limitNum,
        adminId,
        role,
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get invoice by ID dengan authorization multi-user
  static async getInvoice(req, res, next) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          success: false,
          message: "Invalid invoice ID",
        });
      }

      // Panggil service dengan adminId dan role untuk authorization
      const invoice = await InvoiceService.getInvoiceById(id, adminId, role);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found or access denied",
        });
      }

      res.json({
        success: true,
        data: invoice,
      });
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Create manual invoice dengan admin_id
  static async createInvoice(req, res, next) {
    const connection = await db.getConnection();

    try {
      console.log(
        "Creating invoice for admin:",
        req.user.id,
        "Role:",
        req.user.role,
      );

      const {
        customer_id,
        subscription_id,
        package_id,
        package_name,
        subtotal,
        tax_amount = 0,
        discount_amount = 0,
        amount,
        description,
        invoice_type = "regular",
        status = "pending",
        issue_date,
        due_date,
        payment_method,
        reference_number,
        payment_notes,
        is_recurring = 0,
        next_billing_date,
        items = [],
        is_shared = false,
        shared_with = [],
      } = req.body;

      const adminId = req.user.id;

      // VALIDASI DASAR
      if (!customer_id) {
        return res.status(400).json({
          success: false,
          message: "Customer ID is required",
        });
      }

      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // MULAI TRANSACTION
      await connection.beginTransaction();

      // CEK CUSTOMER DAN AKSES
      const [customerRows] = await connection.query(
        `SELECT c.*, a.role as customer_admin_role 
         FROM customers c 
         LEFT JOIN admins a ON c.admin_id = a.id 
         WHERE c.id = ? AND c.status = 'active'`,
        [customer_id],
      );

      if (customerRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Customer with ID ${customer_id} not found or inactive`,
        });
      }

      const customer = customerRows[0];

      // Cek apakah admin bisa mengakses customer ini
      if (req.user.role !== "superadmin" && customer.admin_id !== adminId) {
        const canAccess = await this.canAccessCustomer(
          customer_id,
          adminId,
          req.user.role,
          connection,
        );
        if (!canAccess) {
          await connection.rollback();
          return res.status(403).json({
            success: false,
            message: "Access denied to this customer",
          });
        }
      }

      console.log(`Customer found: ${customer.name}`);

      // GENERATE INVOICE NUMBER
      const invoice_number = await InvoiceUtils.generateInvoiceNumber();
      console.log(`Generated invoice number: ${invoice_number}`);

      // TANGGAL
      const today = new Date().toISOString().split("T")[0];

      let finalDueDate = due_date;
      if (!finalDueDate) {
        const dueDateObj = new Date();
        dueDateObj.setDate(dueDateObj.getDate() + 7);
        finalDueDate = dueDateObj.toISOString().split("T")[0];
      }

      // PACKAGE NAME
      let finalPackageName = package_name;
      if (!finalPackageName && package_id) {
        try {
          const [packageRows] = await connection.query(
            "SELECT name FROM packages WHERE id = ? AND status = 'active'",
            [package_id],
          );
          if (packageRows.length > 0) {
            finalPackageName = packageRows[0].name;
          }
        } catch (packageError) {
          console.log("Could not fetch package name:", packageError.message);
        }
      }

      // CREATE INVOICE DATA dengan admin_id
      const invoiceData = {
        invoice_number,
        customer_id: parseInt(customer_id),
        subscription_id: subscription_id ? parseInt(subscription_id) : null,
        package_id: package_id ? parseInt(package_id) : null,
        package_name: finalPackageName || null,
        subtotal: parseFloat(subtotal || amount),
        tax_amount: parseFloat(tax_amount),
        discount_amount: parseFloat(discount_amount),
        amount: parseFloat(amount),
        description: description || "Invoice",
        invoice_type,
        status,
        issue_date: issue_date || today,
        due_date: finalDueDate,
        payment_method: payment_method || null,
        reference_number: reference_number || null,
        payment_notes: payment_notes || null,
        created_by: adminId,
        is_recurring: is_recurring ? 1 : 0,
        next_billing_date: next_billing_date || null,
        admin_id: adminId, // Tambahkan admin_id
        is_shared: is_shared ? 1 : 0,
        shared_with: shared_with ? JSON.stringify(shared_with) : null,
      };

      // PANGGIL SERVICE DENGAN TRANSACTION
      const result = await InvoiceService.createManualInvoice(
        invoiceData,
        items,
        connection,
      );

      // COMMIT TRANSACTION
      await connection.commit();

      console.log("Invoice created successfully", {
        invoiceId: result.id,
        invoiceNumber: invoice_number,
        customerId: customer_id,
        adminId: adminId,
      });

      // KIRIM NOTIFIKASI (ASINKRON)
      try {
        await messagingService.sendInvoiceNotification({
          customerId: customer_id,
          invoiceId: result.id,
          invoiceNumber: invoice_number,
          amount: amount,
          dueDate: finalDueDate,
        });
      } catch (notifError) {
        console.error("Failed to send notification:", notifError.message);
      }

      res.json({
        success: true,
        message: "Invoice created successfully",
        data: result,
      });
    } catch (error) {
      // ROLLBACK JIKA ADA ERROR
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      console.error("Create invoice error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    } finally {
      // RELEASE CONNECTION
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          console.error("Connection release error:", releaseError);
        }
      }
    }
  }

  // Helper method untuk cek akses customer
  static async canAccessCustomer(customerId, adminId, role, connection) {
    try {
      if (role === "superadmin") {
        return true;
      }

      const [result] = await connection.query(
        `SELECT id FROM customers 
         WHERE id = ? 
         AND (
           admin_id = ? 
           OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
         )`,
        [customerId, adminId, JSON.stringify([adminId])],
      );

      return result.length > 0;
    } catch (error) {
      console.error("Check customer access error:", error);
      return false;
    }
  }

  // Process payment dengan authorization multi-user
  static async processPayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, payment_method, reference, notes } = req.body;
      const adminId = req.user.id;
      const role = req.user.role;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // Panggil service dengan adminId dan role untuk authorization
      const result = await InvoiceService.processPayment(
        id,
        {
          amount,
          payment_method,
          reference,
          notes,
        },
        adminId,
        role,
      );

      res.json({
        success: true,
        message: "Payment processed successfully",
        data: result,
      });
    } catch (error) {
      console.error("Process payment error:", error);

      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found or access denied",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Update invoice status dengan authorization multi-user
  static async updateInvoiceStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const adminId = req.user.id;
      const role = req.user.role;

      const validStatuses = ["pending", "paid", "overdue", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      const result = await InvoiceService.updateInvoiceStatus(
        id,
        status,
        adminId,
        role,
      );

      res.json({
        success: true,
        message: "Invoice status updated successfully",
        data: result,
      });
    } catch (error) {
      console.error("Update invoice status error:", error);

      if (
        error.message.includes("not found") ||
        error.message.includes("access denied")
      ) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found or access denied",
        });
      }

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Delete invoice dengan authorization multi-user
  static async deleteInvoice(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log(
        `🗑️ Delete invoice request for ID: ${id}, Admin: ${adminId}, Role: ${role}`,
      );

      const result = await InvoiceService.deleteInvoice(id, adminId, role);

      res.json({
        success: true,
        message: "Invoice deleted successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error deleting invoice:", error);

      let statusCode = 500;
      let errorMessage = error.message;

      if (
        error.message.includes("Invoice not found") ||
        error.message.includes("access denied")
      ) {
        statusCode = 404;
        errorMessage = "Invoice not found or access denied";
      } else if (
        error.message.includes("Cannot delete invoice") ||
        error.message.includes("has payment record")
      ) {
        statusCode = 400;
      } else if (error.message.includes("foreign key constraint")) {
        statusCode = 400;
      }

      res.status(statusCode).json({
        success: false,
        message: errorMessage,
        code: error.message.includes("payment record")
          ? "HAS_PAYMENTS"
          : "DELETE_ERROR",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  // Cancel invoice dengan authorization multi-user
  static async cancel(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      console.log(`❌ Cancel invoice request for ID: ${id}, Admin: ${adminId}`);

      const result = await InvoiceService.cancelInvoice(id, adminId, role);

      res.json({
        success: true,
        message: "Invoice cancelled successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error cancelling invoice:", error);

      let statusCode = 500;
      let errorMessage = error.message;

      if (
        error.message.includes("Invoice not found") ||
        error.message.includes("access denied")
      ) {
        statusCode = 404;
        errorMessage = "Invoice not found or access denied";
      } else if (error.message.includes("Cannot cancel")) {
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

  // Get invoice statistics per admin
  static async getStatistics(req, res) {
    try {
      const adminId = req.user.id;
      const role = req.user.role;

      const stats = await InvoiceService.getInvoiceStatistics(adminId, role);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("Get invoice statistics error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get customer invoices dengan filter multi-user
  static async getCustomerInvoices(req, res) {
    try {
      const { customer_id } = req.params;
      const adminId = req.user.id;
      const role = req.user.role;

      // Cek akses ke customer terlebih dahulu
      const connection = await db.getConnection();
      try {
        const canAccess = await this.canAccessCustomer(
          customer_id,
          adminId,
          role,
          connection,
        );
        if (!canAccess) {
          return res.status(403).json({
            success: false,
            message: "Access denied to this customer's invoices",
          });
        }

        const invoices = await InvoiceService.getCustomerInvoices(
          customer_id,
          adminId,
          role,
        );

        res.json({
          success: true,
          data: invoices,
        });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Get customer invoices error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Share invoice dengan admin lain
  static async shareInvoice(req, res) {
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

      // Hanya superadmin atau pemilik invoice yang bisa share
      if (role !== "superadmin") {
        // Cek apakah invoice milik admin ini
        const [invoices] = await db.query(
          "SELECT admin_id FROM invoices WHERE id = ?",
          [id],
        );

        if (invoices.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Invoice not found",
          });
        }

        if (invoices[0].admin_id !== adminId) {
          return res.status(403).json({
            success: false,
            message: "You can only share your own invoices",
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
        `UPDATE invoices 
         SET is_shared = ?, shared_with = ?, updated_at = NOW() 
         WHERE id = ?`,
        [isShared ? 1 : 0, sharedWithJson, id],
      );

      res.json({
        success: true,
        message: "Invoice shared successfully",
        data: {
          invoice_id: id,
          is_shared: isShared,
          shared_with: filteredAdminIds,
        },
      });
    } catch (error) {
      console.error("Share invoice error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get admin's recent invoices (untuk dashboard)
  static async getRecentInvoices(req, res) {
    try {
      const adminId = req.user.id;
      const role = req.user.role;
      const { limit = 10 } = req.query;

      let query = `
        SELECT 
          i.*,
          c.name as customer_name,
          c.phone as customer_phone
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE 1=1
      `;

      const params = [];

      // Filter berdasarkan role
      if (role !== "superadmin") {
        query += `
          AND (
            i.admin_id = ? 
            OR (i.is_shared = 1 AND JSON_CONTAINS(i.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      query += ` ORDER BY i.created_at DESC LIMIT ?`;
      params.push(parseInt(limit));

      const [invoices] = await db.query(query, params);

      res.json({
        success: true,
        data: invoices,
      });
    } catch (error) {
      console.error("Get recent invoices error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = InvoiceController;
