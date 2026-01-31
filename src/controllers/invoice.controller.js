const db = require("../config/database"); // Tambahkan ini di atas
const InvoiceService = require("../services/invoice.service");
const InvoiceUtils = require("../utils/invoice");
const messagingService = require("../services/messaging.service");

class InvoiceController {
  // Get all invoices
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

      // Validasi input
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (isNaN(pageNum) || pageNum < 1) {
        throw new AppError("Invalid page number", 400);
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        throw new AppError("Limit must be between 1 and 100", 400);
      }

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
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get invoice by ID - DENGAN ERROR HANDLING YANG LEBIH BAIK
  static async getInvoice(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || isNaN(parseInt(id))) {
        throw new AppError("Invalid invoice ID", 400);
      }

      const invoice = await InvoiceService.getInvoiceById(id);

      if (!invoice) {
        throw new AppError("Invoice not found", 404);
      }

      res.json({
        success: true,
        data: invoice,
      });
    } catch (error) {
      next(error);
    }
  }

  // Create manual invoice
  // Create manual invoice - DENGAN TRANSACTION
  static async createInvoice(req, res, next) {
    const connection = await db.getConnection();

    try {
      logger.info("Creating invoice", {
        userId: req.user?.id,
        customerId: req.body.customer_id,
        data: req.body,
      });

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
      } = req.body;

      // VALIDASI DASAR
      if (!customer_id) {
        throw new AppError("Customer ID is required", 400);
      }

      if (!amount || parseFloat(amount) <= 0) {
        throw new AppError("Valid amount is required", 400);
      }

      // MULAI TRANSACTION
      await connection.beginTransaction();

      // CEK CUSTOMER - GUNAKAN CONNECTION YANG SAMA
      const [customerRows] = await connection.query(
        "SELECT id, name, phone, email FROM customers WHERE id = ? AND status = 'active'",
        [customer_id],
      );

      if (customerRows.length === 0) {
        await connection.rollback();
        throw new AppError(
          `Customer with ID ${customer_id} not found or inactive`,
          404,
        );
      }

      const customer = customerRows[0];
      logger.info(`Customer found: ${customer.name}`, {
        customerId: customer_id,
      });

      // GENERATE INVOICE NUMBER
      const invoice_number = await InvoiceUtils.generateInvoiceNumber();
      logger.info(`Generated invoice number: ${invoice_number}`);

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
          logger.warn("Could not fetch package name", {
            error: packageError.message,
          });
        }
      }

      // CREATE INVOICE DATA
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
        created_by: req.user?.id || customer_id, // Gunakan user yang login jika ada
        is_recurring: is_recurring ? 1 : 0,
        next_billing_date: next_billing_date || null,
      };

      // PANGGIL SERVICE DENGAN TRANSACTION
      const result = await InvoiceService.createManualInvoice(
        invoiceData,
        items,
        connection, // Kirim connection untuk transaction
      );

      // COMMIT TRANSACTION
      await connection.commit();

      logger.info("Invoice created successfully", {
        invoiceId: result.id,
        invoiceNumber: invoice_number,
        customerId: customer_id,
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
        logger.error("Failed to send notification", {
          error: notifError.message,
        });
        // Jangan gagalkan invoice creation karena notifikasi gagal
      }

      res.json({
        success: true,
        message: "Invoice created successfully",
        data: result,
      });
    } catch (error) {
      // ROLLBACK JIKA ADA ERROR
      if (connection) await connection.rollback();

      logger.error("Create invoice error", {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
      });

      next(error);
    } finally {
      // RELEASE CONNECTION
      if (connection) connection.release();
    }
  }

  // Process payment
  static async processPayment(req, res) {
    try {
      const { id } = req.params;
      const { amount, payment_method, reference, notes } = req.body;
      const adminId = req.user.id;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // Panggil service, service akan mengembalikan data saja (tanpa wrapper)
      const result = await InvoiceService.processPayment(
        id,
        {
          amount,
          payment_method,
          reference,
          notes,
        },
        adminId,
      );

      // Kembalikan response yang konsisten
      res.json({
        success: true,
        message: "Payment processed successfully",
        data: result, // result sudah berisi invoice dan payment
      });
    } catch (error) {
      if (error.message === "Invoice not found") {
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

  // Update invoice status
  static async updateInvoiceStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const adminId = req.user.id;

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
      );

      res.json({
        success: true,
        message: "Invoice status updated successfully",
        data: result,
      });
    } catch (error) {
      if (error.message === "Invoice not found") {
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

  // Delete invoice
  // Delete invoice
  static async deleteInvoice(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      console.log(`🗑️ Delete invoice request for ID: ${id}`);

      const result = await InvoiceService.deleteInvoice(id, adminId);

      res.json({
        success: true,
        message: "Invoice deleted successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error deleting invoice:", error);

      let statusCode = 500;
      let errorMessage = error.message;

      if (error.message.includes("Invoice not found")) {
        statusCode = 404;
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

  // Cancel invoice
  static async cancel(req, res) {
    try {
      const { id } = req.params;
      const adminId = req.user.id;

      console.log(`❌ Cancel invoice request for ID: ${id}`);

      const result = await InvoiceService.cancelInvoice(id, adminId);

      res.json({
        success: true,
        message: "Invoice cancelled successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Error cancelling invoice:", error);

      let statusCode = 500;
      let errorMessage = error.message;

      if (error.message.includes("Invoice not found")) {
        statusCode = 404;
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

  // Get invoice statistics
  static async getStatistics(req, res) {
    try {
      const stats = await InvoiceService.getInvoiceStatistics();

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

  // Get customer invoices
  static async getCustomerInvoices(req, res) {
    try {
      const { customer_id } = req.params;

      const invoices = await InvoiceService.getCustomerInvoices(customer_id);

      res.json({
        success: true,
        data: invoices,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = InvoiceController;
