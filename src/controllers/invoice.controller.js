const InvoiceService = require("../services/invoice.service");

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
        limit
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
      const { customer_id, subscription_id, amount, description } = req.body;
      const adminId = req.user.id;

      if (!customer_id || !amount) {
        return res.status(400).json({
          success: false,
          message: "customer_id and amount are required",
        });
      }

      const invoice = await InvoiceService.createManualInvoice(
        {
          customer_id,
          subscription_id,
          amount,
          description,
        },
        adminId
      );

      res.status(201).json({
        success: true,
        message: "Invoice created successfully",
        data: invoice,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
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

      const result = await InvoiceService.processPayment(
        id,
        {
          amount,
          payment_method,
          reference,
          notes,
        },
        adminId
      );

      res.json({
        success: true,
        message: "Payment processed successfully",
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
        adminId
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
