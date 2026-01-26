const PaymentService = require("../services/payment.service");
const MidtransService = require("../services/midtrans.service"); // Tambahkan ini
const { Invoice, Customer, Package } = require("../models"); // Import model

class PaymentController {
  // Get all payments
  static async getPayments(req, res) {
    console.log("🔍 PaymentController.getPayments called");
    console.log("📦 Query params:", req.query);

    try {
      const {
        page = 1,
        limit = 50,
        status,
        payment_method,
        customer_id,
        invoice_id,
        date_from,
        date_to,
        search,
      } = req.query;

      // Jika tidak ada status, kita ambil semua (completed, pending, failed)
      const statusFilter = status || undefined;

      console.log(`📊 Fetching payments with params:`, {
        page,
        limit,
        status: statusFilter,
        payment_method,
        customer_id,
        invoice_id,
        date_from,
        date_to,
        search,
      });

      const result = await PaymentService.getPayments(
        {
          status: statusFilter,
          payment_method,
          customer_id,
          invoice_id,
          date_from,
          date_to,
          search,
        },
        page,
        limit,
      );

      console.log(
        `✅ PaymentService returned ${result.data?.length || 0} payments`,
      );

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error("❌ Error in PaymentController.getPayments:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
        sqlMessage: error.sqlMessage,
      });

      // Return empty data rather than error for frontend
      res.json({
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          pages: 1,
        },
      });
    }
  }

  // Get payment by ID
  static async getPayment(req, res) {
    try {
      const { id } = req.params;

      const payment = await PaymentService.getPaymentById(id);

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      if (error.message === "Payment not found") {
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

  // Get payment statistics
  static async getStatistics(req, res) {
    try {
      const stats = await PaymentService.getPaymentStatistics();

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

  // Test endpoint
  static async testPayments(req, res) {
    try {
      console.log("🧪 Testing payments endpoint...");

      // Test 1: Query sederhana
      const [simpleResult] = await db.query(
        "SELECT COUNT(*) as count FROM payments",
      );
      console.log(`📊 Total payments in table: ${simpleResult[0].count}`);

      // Test 2: Cek struktur tabel
      const [columns] = await db.query("DESCRIBE payments");
      console.log(
        "📋 Payments table structure:",
        columns.map((c) => c.Field),
      );

      // Test 3: Ambil beberapa data
      const [sampleData] = await db.query("SELECT * FROM payments LIMIT 3");
      console.log("📄 Sample payments data:", sampleData);

      res.json({
        success: true,
        data: {
          totalPayments: simpleResult[0].count,
          tableStructure: columns.map((c) => c.Field),
          sampleData,
        },
      });
    } catch (error) {
      console.error("❌ Test error:", error);
      res.status(500).json({
        success: false,
        message: error.message,
        error: error,
      });
    }
  }

  // Mark invoice as paid manually
  static async markAsPaid(req, res) {
    try {
      const { invoiceId } = req.params;
      const { payment_method, reference, notes } = req.body;

      // Gunakan customer_id sebagai paid_by (atau NULL jika tidak ada user)
      const paid_by = req.user?.id || null;

      // Atau gunakan customer_id dari invoice
      const [invoice] = await db.query(
        "SELECT customer_id FROM invoices WHERE id = ?",
        [invoiceId],
      );

      const paid_by_customer = invoice[0]?.customer_id || null;

      const query = `
      UPDATE invoices 
      SET status = 'paid',
          paid_date = CURDATE(),
          payment_method = ?,
          reference_number = ?,
          payment_notes = ?,
          paid_by = ?
      WHERE id = ?
    `;

      const [result] = await db.query(query, [
        payment_method,
        reference,
        notes,
        paid_by_customer,
        invoiceId,
      ]);

      res.json({ success: true, message: "Invoice marked as paid" });
    } catch (error) {
      console.error("Mark as paid error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ============ MIDTRANS SNAP POPUP INTEGRATION ============

  // Create Snap transaction for popup
  static async createSnapTransaction(req, res) {
    try {
      const { invoice_id } = req.body;

      console.log("💳 Creating Snap transaction for invoice:", invoice_id);

      if (!invoice_id) {
        return res.status(400).json({
          success: false,
          message: "Invoice ID is required",
        });
      }

      // Find invoice with customer data
      const invoice = await Invoice.findByPk(invoice_id, {
        include: [
          {
            model: Customer,
            as: "customer",
            attributes: ["id", "name", "email", "phone", "address"],
          },
          {
            model: Package,
            as: "package",
            attributes: ["name", "price", "period"],
          },
        ],
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Invoice not found",
        });
      }

      // Check if invoice is already paid
      if (invoice.status === "paid") {
        return res.status(400).json({
          success: false,
          message: "Invoice already paid",
        });
      }

      // Check if there's a pending payment for this invoice
      const existingPayment =
        await PaymentService.getPendingPaymentByInvoiceId(invoice_id);

      if (existingPayment) {
        // Check if payment is still valid (created within last 24 hours)
        const hoursDiff =
          (new Date() - new Date(existingPayment.created_at)) /
          (1000 * 60 * 60);
        if (hoursDiff < 24) {
          return res.json({
            success: true,
            message: "Existing payment found",
            data: {
              snapToken: existingPayment.payment_token,
              orderId: existingPayment.order_id,
              paymentId: existingPayment.id,
              amount: existingPayment.amount,
              invoice: {
                id: invoice.id,
                invoice_number: invoice.invoice_number,
                amount: invoice.amount,
                description: invoice.description,
              },
            },
            config: MidtransService.getSnapConfig(),
          });
        }
      }

      // Prepare invoice data for Midtrans
      const invoiceData = {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: parseFloat(invoice.amount),
        description:
          invoice.description ||
          `Paket ${invoice.package?.name || "WiFi"} - ${invoice.package?.period || "Bulanan"}`,
        package_id: invoice.package_id,
      };

      // Prepare customer data
      const customerData = {
        id: invoice.customer.id,
        name: invoice.customer.name || `Customer ${invoice.customer.username}`,
        email:
          invoice.customer.email || `${invoice.customer.username}@wifi.local`,
        phone: invoice.customer.phone || "081234567890",
        address: invoice.customer.address || "",
      };

      // Create Snap transaction
      const transaction = await MidtransService.createSnapTransaction(
        invoiceData,
        customerData,
      );

      if (!transaction.success) {
        console.error(
          "Midtrans error:",
          transaction.errorDetails || transaction.error,
        );
        return res.status(500).json({
          success: false,
          message: "Failed to create payment transaction",
          error: transaction.error,
          details: transaction.errorDetails,
        });
      }

      // Create or update payment record
      let payment;
      if (existingPayment) {
        payment = await PaymentService.updatePayment(existingPayment.id, {
          payment_token: transaction.snapToken,
          order_id: transaction.orderId,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
          status: "pending",
        });
      } else {
        // Create new payment record
        payment = await PaymentService.createPayment({
          invoice_id: invoice.id,
          customer_id: invoice.customer.id,
          amount: invoice.amount,
          payment_method: "midtrans",
          status: "pending",
          order_id: transaction.orderId,
          payment_token: transaction.snapToken,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
        });
      }

      res.json({
        success: true,
        message: "Snap transaction created successfully",
        data: {
          snapToken: transaction.snapToken,
          orderId: transaction.orderId,
          paymentId: payment.id,
          amount: payment.amount,
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
      console.error("Error creating Snap transaction:", error);
      res.status(500).json({
        success: false,
        message: "Error creating payment transaction",
        error: error.message,
      });
    }
  }

  // Midtrans webhook/callback handler
  static async midtransWebhook(req, res) {
    try {
      console.log("📩 Midtrans webhook received:", req.body);

      // Handle notification
      const result = await MidtransService.handleNotification(req.body);

      if (result.success) {
        console.log(
          `✅ Payment ${result.paymentId} updated to status: ${result.status}`,
        );
        res.status(200).json({
          success: true,
          message: "Notification processed successfully",
          data: result,
        });
      } else {
        res.status(400).json({
          success: false,
          message: "Failed to process notification",
          error: result.error,
        });
      }
    } catch (error) {
      console.error("❌ Error processing webhook:", error);
      res.status(500).json({
        success: false,
        message: "Error processing webhook",
        error: error.message,
      });
    }
  }

  // Check payment status
  static async checkPaymentStatus(req, res) {
    try {
      const { order_id } = req.params;

      if (!order_id) {
        return res.status(400).json({
          success: false,
          message: "Order ID is required",
        });
      }

      // Find payment
      const payment = await PaymentService.getPaymentByOrderId(order_id);

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment not found",
        });
      }

      // Check with Midtrans for latest status
      const statusCheck =
        await MidtransService.checkTransactionStatus(order_id);

      if (statusCheck.success && statusCheck.status !== payment.status) {
        // Status changed, update payment via notification
        const notification = {
          order_id,
          transaction_status: statusCheck.status,
          transaction_id: statusCheck.data.transaction_id,
          payment_type: payment.payment_method,
          gross_amount: payment.amount.toString(),
          fraud_status: statusCheck.data.fraud_status || "accept",
        };

        await MidtransService.handleNotification(notification);

        // Refresh payment data
        payment = await PaymentService.getPaymentByOrderId(order_id);
      }

      res.json({
        success: true,
        data: {
          paymentId: payment.id,
          orderId: payment.order_id,
          status: payment.status,
          amount: payment.amount,
          paidAt: payment.paid_at,
        },
        midtrans_status: statusCheck.data,
      });
    } catch (error) {
      console.error("❌ Error checking payment status:", error);
      res.status(500).json({
        success: false,
        message: "Error checking payment status",
        error: error.message,
      });
    }
  }

  // Get Snap configuration
  static async getSnapConfig(req, res) {
    try {
      const config = MidtransService.getSnapConfig();
      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      console.error("❌ Error getting Snap config:", error);
      res.status(500).json({
        success: false,
        message: "Error getting payment configuration",
        error: error.message,
      });
    }
  }

  // Get customer payments
  static async getCustomerPayments(req, res) {
    try {
      const { customer_id } = req.params;
      const { limit = 50, page = 1 } = req.query;

      const payments = await PaymentService.getCustomerPayments(
        customer_id,
        page,
        limit,
      );

      res.json({
        success: true,
        data: payments.data,
        total: payments.total,
        page: parseInt(page),
        totalPages: Math.ceil(payments.total / limit),
      });
    } catch (error) {
      console.error("❌ Error fetching customer payments:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching payments",
        error: error.message,
      });
    }
  }

  // Manual verify payment (for testing/admin)
  static async manualVerifyPayment(req, res) {
    try {
      const { payment_id } = req.params;

      const payment = await PaymentService.getPaymentById(payment_id);
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment not found",
        });
      }

      if (!payment.order_id) {
        return res.status(400).json({
          success: false,
          message: "Order ID not found",
        });
      }

      // Check status with Midtrans
      const statusCheck = await MidtransService.checkTransactionStatus(
        payment.order_id,
      );

      if (statusCheck.success) {
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

        // Refresh payment
        const updatedPayment = await PaymentService.getPaymentById(payment_id);

        res.json({
          success: true,
          message: "Payment verified",
          data: {
            payment: updatedPayment,
            midtrans_status: statusCheck.data,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Failed to verify payment",
          error: statusCheck.error,
        });
      }
    } catch (error) {
      console.error("❌ Error verifying payment:", error);
      res.status(500).json({
        success: false,
        message: "Error verifying payment",
        error: error.message,
      });
    }
  }

  // Create manual payment (for cash, transfer, etc.)
  static async createManualPayment(req, res) {
    try {
      const {
        invoice_id,
        customer_id,
        amount,
        payment_method,
        reference,
        notes,
      } = req.body;

      if (!invoice_id || !customer_id || !amount || !payment_method) {
        return res.status(400).json({
          success: false,
          message:
            "Invoice ID, customer ID, amount, and payment method are required",
        });
      }

      const paymentData = {
        invoice_id,
        customer_id,
        amount,
        payment_method,
        reference,
        notes,
        status: "paid",
        paid_at: new Date(),
      };

      const payment = await PaymentService.createPayment(paymentData);

      // Update invoice status
      await PaymentService.updateInvoiceStatus(invoice_id, "paid");

      res.json({
        success: true,
        message: "Manual payment created successfully",
        data: payment,
      });
    } catch (error) {
      console.error("❌ Error creating manual payment:", error);
      res.status(500).json({
        success: false,
        message: "Error creating payment",
        error: error.message,
      });
    }
  }

  // Get payment methods
  static async getPaymentMethods(req, res) {
    try {
      const methods = [
        {
          id: "midtrans",
          name: "Online Payment (Midtrans)",
          description: "Bayar via berbagai metode online",
          icon: "💳",
        },
        {
          id: "cash",
          name: "Tunai",
          description: "Bayar langsung di loket",
          icon: "💰",
        },
        {
          id: "transfer",
          name: "Transfer Bank",
          description: "Transfer ke rekening bank",
          icon: "🏦",
        },
        {
          id: "qris",
          name: "QRIS",
          description: "Scan QR code untuk pembayaran",
          icon: "📱",
        },
        {
          id: "gopay",
          name: "GoPay",
          description: "Bayar via GoPay",
          icon: "🟢",
        },
        { id: "ovo", name: "OVO", description: "Bayar via OVO", icon: "🟣" },
        { id: "dana", name: "DANA", description: "Bayar via DANA", icon: "🔵" },
      ];

      res.json({
        success: true,
        data: methods,
      });
    } catch (error) {
      console.error("❌ Error getting payment methods:", error);
      res.status(500).json({
        success: false,
        message: "Error getting payment methods",
        error: error.message,
      });
    }
  }
}

module.exports = PaymentController;
