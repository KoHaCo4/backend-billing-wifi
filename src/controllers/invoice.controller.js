const db = require("../config/database"); // Tambahkan ini di atas
const InvoiceService = require("../services/invoice.service");
const InvoiceUtils = require("../utils/invoice");

class InvoiceController {
  // Get all invoices
  static async getInvoices(req, res) {
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

      const result = await InvoiceService.getInvoices(
        {
          customer_id,
          status,
          date_from,
          date_to,
          search,
        },
        page,
        limit,
      );

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

  // Get invoice by ID
  static async getInvoice(req, res) {
    try {
      const { id } = req.params;

      const invoice = await InvoiceService.getInvoiceById(id);

      res.json({
        success: true,
        data: invoice,
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

  // Create manual invoice
  static async createInvoice(req, res) {
    try {
      console.log("📝 Creating invoice with data:", req.body);

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

      // VALIDASI: Pastikan customer_id ada
      if (!customer_id) {
        return res.status(400).json({
          success: false,
          message: "Customer ID is required",
        });
      }

      // Cek apakah customer exists di database - PERBAIKAN DI SINI
      console.log(`🔍 Checking customer with ID: ${customer_id}`);
      const [customerRows] = await db.query(
        "SELECT id, name, phone FROM customers WHERE id = ?", // HAPUS 'code'
        [customer_id],
      );

      if (customerRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Customer with ID ${customer_id} not found`,
        });
      }

      console.log(
        `✅ Customer found: ${customerRows[0].name} (Phone: ${customerRows[0].phone})`,
      );

      // Validate amount
      if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // Generate invoice number
      const invoice_number = await InvoiceUtils.generateInvoiceNumber();
      console.log(`📄 Generated invoice number: ${invoice_number}`);

      // Get current date for issue_date if not provided
      const today = new Date().toISOString().split("T")[0];

      // Calculate due date if not provided (default 7 days)
      let finalDueDate = due_date;
      if (!finalDueDate) {
        const dueDateObj = new Date();
        dueDateObj.setDate(dueDateObj.getDate() + 7);
        finalDueDate = dueDateObj.toISOString().split("T")[0];
      }

      // Get package name if not provided
      let finalPackageName = package_name;
      if (!finalPackageName && package_id) {
        try {
          const [packageRows] = await db.query(
            "SELECT name FROM packages WHERE id = ?",
            [package_id],
          );
          if (packageRows.length > 0) {
            finalPackageName = packageRows[0].name;
          }
        } catch (packageError) {
          console.warn(
            "⚠️ Could not fetch package name:",
            packageError.message,
          );
        }
      }

      // Create invoice data
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
        created_by: parseInt(customer_id), // Set created_by ke customer_id
        is_recurring: is_recurring ? 1 : 0,
        next_billing_date: next_billing_date || null,
      };

      console.log("📦 Invoice data prepared:", invoiceData);

      // Call service to create invoice
      const result = await InvoiceService.createManualInvoice(
        invoiceData,
        items,
      );

      res.json({
        success: true,
        message: "Invoice created successfully",
        data: result,
      });
    } catch (error) {
      console.error("❌ Create invoice error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to create invoice",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
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
