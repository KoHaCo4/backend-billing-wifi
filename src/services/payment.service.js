const db = require("../config/database");
const logger = require("../utils/logger");

class PaymentService {
  // Get all payments dengan JOIN ke invoices dan customers
  // services/payment.service.js - Perbaiki query
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

      // PERBAIKAN: Gunakan query yang lebih sederhana dulu untuk test
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
          c.code as customer_code,
          c.name as customer_name,
          c.phone as customer_phone,
          c.email as customer_email,
          c.address as customer_address,
          c.pic_name,
          c.pic_phone
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
        customer_email: payment.customer_email,
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
}

module.exports = PaymentService;
