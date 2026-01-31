const db = require("../config/database");
const logger = require("../utils/logger");
const { Invoice, Customer, Package } = require("../models"); // Import model jika perlu

class PaymentService {
  // Get all payments dengan JOIN ke invoices dan customers
  static async getPayments(filters = {}, page = 1, limit = 50) {
    try {
      console.log(
        "🔧 PaymentService.getPayments called with filters:",
        filters,
      );

      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params = [];

      // Status filter - default completed
      if (filters.status) {
        whereClause += " AND p.status = ?";
        params.push(filters.status);
      } else {
        whereClause += " AND p.status = 'completed'";
      }

      // Filter lainnya
      if (filters.payment_method) {
        whereClause += " AND p.payment_method = ?";
        params.push(filters.payment_method);
      }

      if (filters.customer_id) {
        whereClause += " AND p.customer_id = ?";
        params.push(filters.customer_id);
      }

      if (filters.invoice_id) {
        whereClause += " AND p.invoice_id = ?";
        params.push(filters.invoice_id);
      }

      if (filters.date_from) {
        whereClause += " AND DATE(p.created_at) >= ?";
        params.push(filters.date_from);
      }

      if (filters.date_to) {
        whereClause += " AND DATE(p.created_at) <= ?";
        params.push(filters.date_to);
      }

      if (filters.search) {
        whereClause +=
          " AND (i.invoice_number LIKE ? OR c.name LIKE ? OR p.reference LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      console.log(`📝 SQL WHERE clause: ${whereClause}`);
      console.log(`📝 SQL params:`, params);

      const [payments] = await db.query(
        `SELECT 
        p.*,
        i.invoice_number,
        i.paid_date,
        i.payment_method as invoice_payment_method,
        i.reference_number as invoice_reference,
        c.name as customer_name,
        c.phone as customer_phone
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON p.customer_id = c.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), parseInt(offset)],
      );

      console.log(`📄 Query executed, found ${payments.length} payments`);

      // Get total count
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total 
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON p.customer_id = c.id
       ${whereClause}`,
        params,
      );

      console.log(`📊 Total payments in database: ${total}`);

      // Format response
      const formattedPayments = payments.map((payment) => {
        const result = {
          id: payment.id,
          payment_id: payment.id,
          invoice_id: payment.invoice_id,
          invoice_number: payment.invoice_number || `INV-${payment.invoice_id}`,
          customer_id: payment.customer_id,
          customer_name:
            payment.customer_name || `Customer ${payment.customer_id}`,
          customer_phone: payment.customer_phone || "",
          amount: parseFloat(payment.amount) || 0,
          status: payment.status || "completed",
          payment_method: payment.payment_method || "cash",
          reference: payment.reference || `REF-${payment.id}`,
          notes: payment.notes || "Payment processed",
          created_at: payment.created_at,
          paid_at: payment.paid_date || payment.created_at,
          description: "Payment transaction",
          source: "payments_table",
        };

        console.log(`📦 Formatted payment ${payment.id}:`, result);
        return result;
      });

      return {
        data: formattedPayments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(total),
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("❌ Error in PaymentService.getPayments:", {
        message: error.message,
        code: error.code,
        errno: error.errno,
        sqlMessage: error.sqlMessage,
        sqlState: error.sqlState,
        sql: error.sql,
        stack: error.stack,
      });
      throw error;
    }
  }

  // Get payment by ID
  static async getPaymentById(id) {
    try {
      const [payments] = await db.query(
        `SELECT 
          p.*,
          i.invoice_number,
          i.amount as invoice_amount,
          i.description as invoice_description,
          i.paid_date,
          i.payment_method as invoice_payment_method,
          i.reference_number as invoice_reference,
          i.payment_notes,
          c.id as customer_id,
          c.name as customer_name,
          c.phone as customer_phone,
          c.address as customer_address
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         LEFT JOIN customers c ON p.customer_id = c.id
         WHERE p.id = ?`,
        [id],
      );

      if (payments.length === 0) {
        throw new Error("Payment not found");
      }

      const payment = payments[0];
      return {
        id: payment.id,
        payment_id: payment.id,
        invoice_id: payment.invoice_id,
        invoice_number: payment.invoice_number,
        customer_id: payment.customer_id,
        customer_name:
          payment.customer_name || `Customer ${payment.customer_id}`,
        customer_phone: payment.customer_phone,
        amount: parseFloat(payment.amount) || 0,
        status: payment.status,
        payment_method: payment.payment_method,
        reference: payment.reference,
        notes: payment.notes,
        created_at: payment.created_at,
        paid_at: payment.paid_date || payment.created_at,
        description: payment.invoice_description || "Payment transaction",
        invoice: {
          paid_date: payment.paid_date,
          payment_method: payment.invoice_payment_method,
          reference_number: payment.invoice_reference,
          payment_notes: payment.payment_notes,
        },
      };
    } catch (error) {
      logger.error("Get payment by ID error:", error);
      throw error;
    }
  }

  // Get payment statistics
  static async getPaymentStatistics() {
    try {
      const [stats] = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM payments WHERE status = 'completed') as total_payments,
          (SELECT COUNT(*) FROM payments WHERE status = 'pending') as pending_payments,
          (SELECT COUNT(*) FROM payments WHERE status = 'failed') as failed_payments,
          (SELECT SUM(amount) FROM payments WHERE status = 'completed') as total_amount,
          (SELECT SUM(amount) FROM payments WHERE status = 'completed' AND DATE(created_at) = CURDATE()) as today_amount,
          (SELECT SUM(amount) FROM payments WHERE status = 'completed' AND MONTH(created_at) = MONTH(CURDATE())) as monthly_amount,
          (SELECT SUM(amount) FROM payments WHERE status = 'completed' AND YEAR(created_at) = YEAR(CURDATE())) as yearly_amount,
          (SELECT COUNT(DISTINCT customer_id) FROM payments WHERE status = 'completed') as unique_customers
      `);

      // Payment method breakdown
      const [methods] = await db.query(`
        SELECT 
          payment_method,
          COUNT(*) as count,
          SUM(amount) as total_amount
        FROM payments 
        WHERE status = 'completed'
        GROUP BY payment_method
        ORDER BY total_amount DESC
      `);

      // Daily revenue for last 7 days
      const [dailyRevenue] = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as transaction_count,
          SUM(amount) as total_amount
        FROM payments 
        WHERE status = 'completed' 
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return {
        ...stats[0],
        payment_methods: methods,
        daily_revenue: dailyRevenue,
      };
    } catch (error) {
      logger.error("Get payment statistics error:", error);
      throw error;
    }
  }

  // ============ MIDTRANS SUPPORT METHODS ============

  // Get payment by order ID (for Midtrans)
  static async getPaymentByOrderId(orderId) {
    try {
      const [payments] = await db.query(
        `SELECT p.*, i.invoice_number, i.status as invoice_status
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         WHERE p.reference = ? OR p.order_id = ?`,
        [orderId, orderId],
      );

      if (payments.length === 0) {
        throw new Error("Payment not found");
      }

      return payments[0];
    } catch (error) {
      logger.error("Get payment by order ID error:", error);
      throw error;
    }
  }

  // Get pending payment by invoice ID
  static async getPendingPaymentByInvoiceId(invoiceId) {
    try {
      const [payments] = await db.query(
        `SELECT * FROM payments 
         WHERE invoice_id = ? AND status = 'pending'
         ORDER BY created_at DESC 
         LIMIT 1`,
        [invoiceId],
      );

      return payments[0] || null;
    } catch (error) {
      logger.error("Get pending payment error:", error);
      throw error;
    }
  }

  // Create new payment
  static async createPayment(paymentData) {
    try {
      const {
        invoice_id,
        customer_id,
        amount,
        payment_method = "midtrans",
        status = "pending",
        reference,
        notes,
        order_id,
        payment_token,
        payment_url,
        midtrans_response,
        created_by,
        paid_at,
      } = paymentData;

      // First, check if invoice exists
      const [invoice] = await db.query(
        "SELECT id, invoice_number FROM invoices WHERE id = ?",
        [invoice_id],
      );

      if (invoice.length === 0) {
        throw new Error("Invoice not found");
      }

      const query = `
        INSERT INTO payments (
          invoice_id, customer_id, amount, payment_method, status,
          reference, notes, order_id, payment_token, payment_url,
          midtrans_response, created_by, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      const [result] = await db.query(query, [
        invoice_id,
        customer_id,
        amount,
        payment_method,
        status,
        reference,
        notes,
        order_id,
        payment_token,
        payment_url,
        midtrans_response ? JSON.stringify(midtrans_response) : null,
        created_by,
        paid_at,
      ]);

      console.log(`✅ Payment created with ID: ${result.insertId}`);

      // Return the created payment
      return await this.getPaymentById(result.insertId);
    } catch (error) {
      logger.error("Create payment error:", error);
      throw error;
    }
  }

  // Update payment
  static async updatePayment(id, updateData) {
    try {
      const fields = [];
      const values = [];

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined) {
          // Handle JSON fields
          if (key === "midtrans_response") {
            fields.push(`${key} = ?`);
            values.push(JSON.stringify(updateData[key]));
          } else {
            fields.push(`${key} = ?`);
            values.push(updateData[key]);
          }
        }
      });

      if (fields.length === 0) {
        return await this.getPaymentById(id);
      }

      const query = `
        UPDATE payments 
        SET ${fields.join(", ")}
        WHERE id = ?
      `;

      values.push(id);

      await db.query(query, values);

      console.log(`✅ Payment ${id} updated`);

      return await this.getPaymentById(id);
    } catch (error) {
      logger.error("Update payment error:", error);
      throw error;
    }
  }

  // Update invoice status when payment is successful
  static async updateInvoiceStatus(invoiceId, status) {
    try {
      const query = `
        UPDATE invoices 
        SET status = ?, 
            paid_date = CASE WHEN ? = 'paid' THEN CURDATE() ELSE paid_date END,
            updated_at = NOW()
        WHERE id = ?
      `;

      await db.query(query, [status, status, invoiceId]);

      console.log(`✅ Invoice ${invoiceId} status updated to ${status}`);

      return true;
    } catch (error) {
      logger.error("Update invoice status error:", error);
      throw error;
    }
  }

  // Get customer payments
  static async getCustomerPayments(customerId, page = 1, limit = 50) {
    try {
      const offset = (page - 1) * limit;

      const [payments] = await db.query(
        `SELECT 
          p.*,
          i.invoice_number,
          i.description as invoice_description,
          i.due_date,
          i.status as invoice_status
         FROM payments p
         LEFT JOIN invoices i ON p.invoice_id = i.id
         WHERE p.customer_id = ?
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
        [customerId, parseInt(limit), parseInt(offset)],
      );

      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM payments WHERE customer_id = ?`,
        [customerId],
      );

      const formattedPayments = payments.map((payment) => ({
        id: payment.id,
        invoice_id: payment.invoice_id,
        invoice_number: payment.invoice_number,
        invoice_description: payment.invoice_description,
        due_date: payment.due_date,
        invoice_status: payment.invoice_status,
        amount: parseFloat(payment.amount) || 0,
        status: payment.status,
        payment_method: payment.payment_method,
        reference: payment.reference,
        order_id: payment.order_id,
        created_at: payment.created_at,
        paid_at: payment.paid_at,
      }));

      return {
        data: formattedPayments,
        total: total || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Get customer payments error:", error);
      throw error;
    }
  }

  // Mark invoice as paid manually
  static async markInvoiceAsPaid(invoiceId, paymentData) {
    try {
      const {
        payment_method = "cash",
        reference = "",
        notes = "",
        created_by = null,
      } = paymentData;

      // Get invoice details
      const [invoices] = await db.query(
        `SELECT i.*, c.id as customer_id 
         FROM invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.id = ?`,
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // Create payment record
      const payment = await this.createPayment({
        invoice_id: invoiceId,
        customer_id: invoice.customer_id,
        amount: invoice.amount,
        payment_method,
        status: "completed",
        reference,
        notes,
        created_by,
        paid_at: new Date(),
      });

      // Update invoice status
      await this.updateInvoiceStatus(invoiceId, "paid");

      console.log(`✅ Invoice ${invoiceId} marked as paid`);

      return payment;
    } catch (error) {
      logger.error("Mark invoice as paid error:", error);
      throw error;
    }
  }

  // Get payment methods statistics
  static async getPaymentMethodsStats() {
    try {
      const [methods] = await db.query(`
        SELECT 
          payment_method,
          COUNT(*) as total_count,
          SUM(amount) as total_amount,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
        FROM payments 
        GROUP BY payment_method
        ORDER BY total_amount DESC
      `);

      return methods;
    } catch (error) {
      logger.error("Get payment methods stats error:", error);
      throw error;
    }
  }

  // Cleanup expired payments (cron job)
  static async cleanupExpiredPayments() {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [result] = await db.query(
        `UPDATE payments 
         SET status = 'failed', notes = CONCAT(IFNULL(notes, ''), ' - Payment expired')
         WHERE status = 'pending' 
         AND created_at < ?`,
        [twentyFourHoursAgo],
      );

      console.log(`🧹 Cleaned up ${result.affectedRows} expired payments`);

      return result.affectedRows;
    } catch (error) {
      logger.error("Cleanup expired payments error:", error);
      throw error;
    }
  }
}

module.exports = PaymentService;
