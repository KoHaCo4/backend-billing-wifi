const midtransClient = require("midtrans-client");
const db = require("../config/database");
require("dotenv").config();

// Midtrans Configuration
const MIDTRANS_ENV = process.env.MIDTRANS_ENV || "sandbox";
const IS_PRODUCTION = MIDTRANS_ENV === "production";

const getMidtransKey = () => {
  if (IS_PRODUCTION) {
    return {
      serverKey: process.env.MIDTRANS_SERVER_KEY_PROD,
      clientKey: process.env.MIDTRANS_CLIENT_KEY_PROD,
    };
  }
  return {
    serverKey: process.env.MIDTRANS_SERVER_KEY_SANDBOX,
    clientKey: process.env.MIDTRANS_CLIENT_KEY_SANDBOX,
  };
};

const { serverKey, clientKey } = getMidtransKey();

// Create Snap instance
let snap = null;
let core = null;

if (serverKey) {
  snap = new midtransClient.Snap({
    isProduction: IS_PRODUCTION,
    serverKey,
    clientKey,
  });

  core = new midtransClient.CoreApi({
    isProduction: IS_PRODUCTION,
    serverKey,
    clientKey,
  });
}

class MidtransService {
  // Get Snap configuration
  static getSnapConfig() {
    return {
      clientKey,
      isProduction: IS_PRODUCTION,
    };
  }

  // Create Snap transaction
  static async createSnapTransaction(invoiceData, customerData) {
    try {
      if (!snap) {
        throw new Error(
          "Midtrans is not configured. Please check your environment variables.",
        );
      }

      // Generate unique order ID
      const orderId = `INV-${invoiceData.id}-${Date.now()}`;

      // Prepare transaction parameters
      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: Math.round(invoiceData.amount),
        },
        customer_details: {
          first_name: customerData.name,
          email: customerData.email,
          phone: customerData.phone,
        },
        item_details: [
          {
            id: `ITEM-${invoiceData.id}`,
            price: Math.round(invoiceData.amount),
            quantity: 1,
            name: invoiceData.description || "Internet Service Payment",
          },
        ],
        enabled_payments: [
          "credit_card",
          "bank_transfer",
          "gopay",
          "shopeepay",
          "qris",
          "echannel",
        ],
        callbacks: {
          finish: `${process.env.FRONTEND_URL || "http://localhost:3000"}/payment/finish`,
          error: `${process.env.FRONTEND_URL || "http://localhost:3000"}/payment/error`,
          pending: `${process.env.FRONTEND_URL || "http://localhost:3000"}/payment/pending`,
        },
        expiry: {
          unit: "minutes",
          duration: 1440, // 24 hours
        },
      };

      console.log(
        "Creating Snap transaction with params:",
        JSON.stringify(parameter, null, 2),
      );

      // Create transaction
      const transaction = await snap.createTransaction(parameter);

      return {
        success: true,
        orderId,
        snapToken: transaction.token,
        redirectUrl: transaction.redirect_url,
        transaction,
      };
    } catch (error) {
      console.error("Error creating Snap transaction:", error);
      return {
        success: false,
        error: error.message,
        errorDetails: error.ApiResponse ? error.ApiResponse : null,
      };
    }
  }

  // Handle Midtrans notification
  static async handleNotification(notification) {
    try {
      const {
        order_id,
        transaction_status,
        fraud_status,
        gross_amount,
        payment_type,
      } = notification;

      console.log(
        `Processing notification for order ${order_id}: ${transaction_status}`,
      );

      // Find payment by order_id
      const [payments] = await db.query(
        "SELECT * FROM payments WHERE order_id = ?",
        [order_id],
      );

      if (payments.length === 0) {
        console.error(`Payment not found for order_id: ${order_id}`);
        return { success: false, message: "Payment not found" };
      }

      const payment = payments[0];

      let status = "pending";
      let notes = "";

      // Map Midtrans status to our payment status
      switch (transaction_status) {
        case "capture":
          if (fraud_status === "challenge") {
            status = "pending";
            notes = "Payment challenged by fraud system";
          } else if (fraud_status === "accept") {
            status = "paid";
            notes = "Payment captured successfully";
          }
          break;

        case "settlement":
          status = "paid";
          notes = "Payment settled";
          break;

        case "pending":
          status = "pending";
          notes = "Payment pending";
          break;

        case "deny":
          status = "failed";
          notes = "Payment denied";
          break;

        case "cancel":
        case "expire":
          status = "expired";
          notes = `Payment ${transaction_status}`;
          break;

        case "refund":
        case "partial_refund":
          status = "refunded";
          notes = `Payment ${transaction_status}`;
          break;

        default:
          status = "pending";
          notes = `Unknown status: ${transaction_status}`;
      }

      // Update payment
      const updateQuery = `
        UPDATE payments 
        SET status = ?, 
            payment_method = ?,
            midtrans_response = ?,
            paid_at = ?,
            updated_at = NOW()
        WHERE id = ?
      `;

      const paidAt = status === "paid" ? new Date() : null;

      await db.query(updateQuery, [
        status,
        payment_type,
        JSON.stringify(notification),
        paidAt,
        payment.id,
      ]);

      // If payment is successful, update invoice status
      if (status === "paid") {
        await db.query(
          'UPDATE invoices SET status = "paid", paid_date = NOW() WHERE id = ?',
          [payment.invoice_id],
        );

        // Extend customer subscription if needed
        await this.extendCustomerSubscription(
          payment.customer_id,
          payment.invoice_id,
        );
      }

      return {
        success: true,
        paymentId: payment.id,
        status,
        message: notes,
      };
    } catch (error) {
      console.error("Error handling notification:", error);
      return { success: false, error: error.message };
    }
  }

  // Check transaction status
  static async checkTransactionStatus(orderId) {
    try {
      if (!core) {
        throw new Error("Midtrans Core API is not configured");
      }

      const statusResponse = await core.transaction.status(orderId);
      return {
        success: true,
        status: statusResponse.transaction_status,
        data: statusResponse,
      };
    } catch (error) {
      console.error("Error checking transaction status:", error);
      return { success: false, error: error.message };
    }
  }

  // Extend customer subscription
  static async extendCustomerSubscription(customerId, invoiceId) {
    try {
      // Get invoice details
      const [invoices] = await db.query(
        `SELECT i.*, p.period 
         FROM invoices i 
         LEFT JOIN packages p ON i.package_id = p.id 
         WHERE i.id = ?`,
        [invoiceId],
      );

      if (invoices.length === 0) return;

      const invoice = invoices[0];
      const period = invoice.period || "monthly";

      // Calculate new end date
      let endDate = new Date();
      switch (period) {
        case "daily":
          endDate.setDate(endDate.getDate() + 1);
          break;
        case "weekly":
          endDate.setDate(endDate.getDate() + 7);
          break;
        case "monthly":
          endDate.setMonth(endDate.getMonth() + 1);
          break;
        case "yearly":
          endDate.setFullYear(endDate.getFullYear() + 1);
          break;
        default:
          endDate.setMonth(endDate.getMonth() + 1);
      }

      // Update customer subscription
      await db.query(
        `UPDATE customers 
         SET status = 'active', 
             expired_date = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [endDate, customerId],
      );

      console.log(
        `Extended subscription for customer ${customerId} until ${endDate}`,
      );
    } catch (error) {
      console.error("Error extending subscription:", error);
    }
  }
}

module.exports = MidtransService;
