const InvoiceService = require("../services/invoice.service");
const MidtransService = require("../services/midtrans.service");
const PaymentService = require("../services/payment.service");
const logger = require("../utils/logger");
const db = require("../config/database");

class PaymentLinkController {
  // Get payment page data
  static async getPaymentPage(req, res) {
    try {
      const { payment_code } = req.params;

      // Validate payment link
      const validation = await InvoiceService.validatePaymentLink(payment_code);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
          redirect_url: "/payment/expired",
        });
      }

      const invoice = validation.invoice;

      // Get customer details
      const [customers] = await db.query(
        "SELECT name, phone FROM customers WHERE id = ?",
        [invoice.customer_id],
      );

      const customer = customers[0] || {};

      res.json({
        success: true,
        data: {
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            amount: parseFloat(invoice.amount) || 0,
            description: invoice.description,
            due_date: invoice.due_date,
            expires_at: invoice.expires_at,
            package_name: invoice.package_name,
          },
          customer: {
            name: customer.name || `Customer ${invoice.customer_id}`,
            phone: customer.phone || "",
            // email: customer.email || "",
          },
          payment_code,
          is_expired: new Date(invoice.expires_at) < new Date(),
        },
      });
    } catch (error) {
      logger.error("Get payment page error:", error);
      res.status(500).json({
        success: false,
        message: "Error loading payment page",
        error: error.message,
        sqlError: error.sqlMessage,
      });
    }
  }

  // Create Snap transaction from payment code
  static async createSnapFromPaymentCode(req, res) {
    try {
      const { payment_code } = req.params;

      // Validate payment link
      const validation = await InvoiceService.validatePaymentLink(payment_code);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
          code: "PAYMENT_LINK_EXPIRED",
        });
      }

      const invoice = validation.invoice;

      // Get customer details
      const [customers] = await db.query(
        "SELECT name, phone, email FROM customers WHERE id = ?",
        [invoice.customer_id],
      );

      const customer = customers[0] || {};

      // Prepare data for Midtrans
      const invoiceData = {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: parseFloat(invoice.amount) || 0,
        description:
          invoice.description || `Pembayaran ${invoice.package_name}`,
        package_id: invoice.package_id,
      };

      const customerData = {
        id: invoice.customer_id,
        name: customer.name || `Customer ${invoice.customer_id}`,
        email: customer.email || `${invoice.customer_id}@customer.com`,
        phone: customer.phone || "081234567890",
        address: customer.address || "",
      };

      // Create Snap transaction
      const transaction = await MidtransService.createSnapTransaction(
        invoiceData,
        customerData,
      );

      if (!transaction.success) {
        logger.error("Midtrans transaction failed:", transaction.error);
        return res.status(500).json({
          success: false,
          message: "Gagal membuat transaksi pembayaran",
          error: transaction.error,
        });
      }

      // Check for existing pending payment
      const existingPayment = await PaymentService.getPendingPaymentByInvoiceId(
        invoice.id,
      );

      let payment;
      if (existingPayment) {
        // Update existing payment
        payment = await PaymentService.updatePayment(existingPayment.id, {
          order_id: transaction.orderId,
          payment_token: transaction.snapToken,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
          status: "pending",
        });
      } else {
        // Create new payment record
        payment = await PaymentService.createPayment({
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          amount: invoice.amount,
          payment_method: "midtrans",
          status: "pending",
          order_id: transaction.orderId,
          payment_token: transaction.snapToken,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
        });
      }

      // Extend expiry date by 24 hours
      await InvoiceService.updateInvoiceExpiry(invoice.id, 24);

      res.json({
        success: true,
        message: "Transaksi pembayaran berhasil dibuat",
        data: {
          snapToken: transaction.snapToken,
          orderId: transaction.orderId,
          paymentId: payment.id,
          amount: payment.amount,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            amount: invoice.amount,
            description: invoice.description,
          },
        },
        config: MidtransService.getSnapConfig(),
      });
    } catch (error) {
      logger.error("Create Snap from payment code error:", error);
      res.status(500).json({
        success: false,
        message: "Error creating payment transaction",
        error: error.message,
      });
    }
  }

  // Verify payment without authentication (for payment link)
  static async verifyPaymentByCode(req, res) {
    try {
      const { payment_code } = req.params;

      // Get invoice by payment code
      const invoice =
        await InvoiceService.getInvoiceByPaymentCode(payment_code);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Payment link tidak valid",
        });
      }

      // Get payment
      const [payments] = await db.query(
        `SELECT p.*, i.invoice_number, i.status as invoice_status
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         WHERE p.invoice_id = ?
         ORDER BY p.created_at DESC
         LIMIT 1`,
        [invoice.id],
      );

      let payment = payments[0];

      // If payment has order_id, check status with Midtrans
      if (payment && payment.order_id) {
        const statusCheck = await MidtransService.checkTransactionStatus(
          payment.order_id,
        );

        if (statusCheck.success && statusCheck.status !== payment.status) {
          // Update based on status
          const notification = {
            order_id: payment.order_id,
            transaction_status: statusCheck.status,
            transaction_id: statusCheck.data.transaction_id,
            payment_type: payment.payment_method,
            gross_amount: payment.amount.toString(),
            fraud_status: statusCheck.data.fraud_status || "accept",
          };

          await MidtransService.handleNotification(notification);

          // Refresh payment data
          const [updatedPayments] = await db.query(
            "SELECT * FROM payments WHERE id = ?",
            [payment.id],
          );

          payment = updatedPayments[0];
        }
      }

      res.json({
        success: true,
        data: {
          payment: payment || null,
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            status: invoice.status,
            amount: invoice.amount,
            description: invoice.description,
          },
          is_paid:
            invoice.status === "paid" ||
            (payment && payment.status === "completed"),
        },
      });
    } catch (error) {
      logger.error("Verify payment by code error:", error);
      res.status(500).json({
        success: false,
        message: "Error verifying payment",
        error: error.message,
      });
    }
  }

  // Generate WhatsApp message with payment link
  static async generateWhatsAppMessage(req, res) {
    try {
      const { invoice_id } = req.params;
      const { type = "reminder" } = req.query;

      const result = await InvoiceService.generateWhatsAppMessage(
        invoice_id,
        type,
      );

      res.json(result);
    } catch (error) {
      logger.error("Generate WhatsApp message error:", error);
      res.status(500).json({
        success: false,
        message: "Error generating WhatsApp message",
        error: error.message,
      });
    }
  }

  // Check if payment link is valid
  static async checkPaymentLink(req, res) {
    try {
      const { payment_code } = req.params;

      const validation = await InvoiceService.validatePaymentLink(payment_code);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          valid: false,
          message: validation.message,
        });
      }

      res.json({
        success: true,
        valid: true,
        data: {
          invoice: validation.invoice,
          expires_at: validation.invoice.expires_at,
          is_expired: new Date(validation.invoice.expires_at) < new Date(),
        },
      });
    } catch (error) {
      logger.error("Check payment link error:", error);
      res.status(500).json({
        success: false,
        message: "Error checking payment link",
        error: error.message,
      });
    }
  }

  // Extend payment link expiry
  static async extendPaymentLink(req, res) {
    try {
      const { payment_code } = req.params;
      const { hours = 24 } = req.body;

      const validation = await InvoiceService.validatePaymentLink(payment_code);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message,
        });
      }

      const invoice = validation.invoice;
      const newExpiry = await InvoiceService.updateInvoiceExpiry(
        invoice.id,
        hours,
      );

      res.json({
        success: true,
        message: `Payment link diperpanjang hingga ${newExpiry.toLocaleString("id-ID")}`,
        data: {
          expires_at: newExpiry,
        },
      });
    } catch (error) {
      logger.error("Extend payment link error:", error);
      res.status(500).json({
        success: false,
        message: "Error extending payment link",
        error: error.message,
      });
    }
  }

  // Generate payment link for existing invoice
  static async generatePaymentLink(req, res) {
    try {
      const { invoice_id } = req.params;

      const result =
        await InvoiceService.generatePaymentLinkForInvoice(invoice_id);

      res.json({
        success: true,
        message: "Payment link generated successfully",
        data: result,
      });
    } catch (error) {
      logger.error("Generate payment link error:", error);
      res.status(500).json({
        success: false,
        message: "Error generating payment link",
        error: error.message,
      });
    }
  }
}

module.exports = PaymentLinkController;
