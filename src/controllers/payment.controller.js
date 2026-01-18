const PaymentService = require("../services/payment.service");

class PaymentController {
  // Get all payments
  // controllers/payment.controller.js
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

      // Jika tidak ada data, coba query langsung dari database
      if (!result.data || result.data.length === 0) {
        console.log("🔄 No data from service, querying directly...");

        const [directData] = await db.query(`
        SELECT 
          p.*,
          i.invoice_number,
          i.customer_id as invoice_customer_id,
          i.amount as invoice_amount,
          c.name as customer_name,
          c.phone as customer_phone
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        LEFT JOIN customers c ON p.customer_id = c.id
        ORDER BY p.created_at DESC
        LIMIT 20
      `);

        if (directData.length > 0) {
          console.log(`📊 Direct query found ${directData.length} payments`);

          const formatted = directData.map((payment) => ({
            id: payment.id,
            payment_id: payment.id,
            invoice_id: payment.invoice_id,
            invoice_number:
              payment.invoice_number || `INV-${payment.invoice_id}`,
            customer_id: payment.customer_id || payment.invoice_customer_id,
            customer_name:
              payment.customer_name || `Customer ${payment.customer_id}`,
            customer_phone: payment.customer_phone || "",
            amount: parseFloat(payment.amount || payment.invoice_amount || 0),
            status: payment.status || "completed",
            payment_method: payment.payment_method || "cash",
            reference: payment.reference || `REF-${payment.id}`,
            notes: payment.notes || "Payment processed",
            created_at: payment.created_at,
            paid_at: payment.paid_date || payment.created_at,
            description: "Payment transaction",
            source: "payments_table",
          }));

          return res.json({
            success: true,
            data: formatted,
            pagination: {
              page: 1,
              limit: 20,
              total: directData.length,
              pages: 1,
            },
          });
        }
      }

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

  // controllers/payment.controller.js - Tambahkan method test
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

  // Di payment.controller.js atau invoice.controller.js saat marking as paid
  static async markAsPaid(req, res) {
    try {
      const { invoiceId } = req.params;
      const { payment_method, reference, notes } = req.body;

      // Gunakan customer_id sebagai paid_by (atau NULL jika tidak ada user)
      const paid_by = req.user?.id || null; // Jika ada auth

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
          paid_by = ?  -- Gunakan customer_id atau NULL
      WHERE id = ?
    `;

      const [result] = await db.query(query, [
        payment_method,
        reference,
        notes,
        paid_by_customer, // atau paid_by
        invoiceId,
      ]);

      res.json({ success: true, message: "Invoice marked as paid" });
    } catch (error) {
      console.error("Mark as paid error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = PaymentController;
