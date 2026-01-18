const db = require("../config/database");
const InvoiceUtils = require("../utils/invoice");
const logger = require("../utils/logger");
const SuspensionService = require("./suspension.service");

let ActivityLogService;
try {
  ActivityLogService = require("./activity-log.service");
} catch (error) {
  console.warn("⚠️ ActivityLogService not found, logging will be skipped");
  ActivityLogService = null;
}

class InvoiceService {
  // Create invoice untuk customer extension
  static async createInvoiceForExtension(
    customerId,
    subscriptionId,
    amount,
    adminId = 0,
  ) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Get customer info
      const [customers] = await connection.query(
        `SELECT c.*, p.name as package_name, p.duration_days 
       FROM customers c 
       JOIN packages p ON c.package_id = p.id 
       WHERE c.id = ?`,
        [customerId],
      );

      if (customers.length === 0) throw new Error("Customer not found");

      const customer = customers[0];

      // Generate invoice number
      const invoiceNumber = await InvoiceUtils.generateInvoiceNumber();
      const issueDate = new Date().toISOString().split("T")[0];
      const dueDate = InvoiceUtils.calculateDueDate(issueDate, 7);

      // PERBAIKAN: Tambahkan subtotal, tax_amount, discount_amount
      const subtotal = parseFloat(amount) || 0;
      const taxAmount = 0;
      const discountAmount = 0;

      // Create invoice dengan field lengkap
      const [invoiceResult] = await connection.query(
        `INSERT INTO invoices 
       (invoice_number, customer_id, subscription_id, subtotal, tax_amount, discount_amount,
        amount, description, status, issue_date, due_date, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), NOW())`,
        [
          invoiceNumber,
          customerId,
          subscriptionId,
          subtotal, // subtotal
          taxAmount, // tax_amount
          discountAmount, // discount_amount
          amount,
          `Pembayaran paket ${customer.package_name} (${customer.duration_days} hari)`,
          issueDate,
          dueDate,
        ],
      );

      const invoiceId = invoiceResult.insertId;

      // Update subscription dengan invoice_id
      if (subscriptionId) {
        await connection.query(
          "UPDATE subscriptions SET invoice_id = ? WHERE id = ?",
          [invoiceId, subscriptionId],
        );
      }

      // Log activity
      const source = adminId === 0 ? "system" : "admin";
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, invoice_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "create_invoice",
          "invoice",
          invoiceId,
          invoiceId,
          `Invoice ${invoiceNumber} created for customer ${customer.name}`,
          source,
          adminId === 0 ? null : adminId,
        ],
      );

      await connection.commit();

      return {
        id: invoiceId,
        invoice_number: invoiceNumber,
        customer_id: customerId,
        subscription_id: subscriptionId,
        amount: amount,
        description: `Pembayaran paket ${customer.package_name}`,
        issue_date: issueDate,
        due_date: dueDate,
        status: "pending",
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Create invoice error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Create manual invoice
  static async createManualInvoice(invoiceData, items = []) {
    try {
      console.log("📦 Creating invoice with data:", invoiceData);

      // Double check customer exists
      const [customerRows] = await db.query(
        "SELECT id, name, phone FROM customers WHERE id = ?",
        [invoiceData.customer_id],
      );

      if (customerRows.length === 0) {
        throw new Error(
          `Customer with ID ${invoiceData.customer_id} not found`,
        );
      }

      console.log(`✅ Confirmed customer: ${customerRows[0].name}`);

      // Insert invoice
      const invoiceId = await InvoiceUtils.insertInvoice(invoiceData);

      // Log activity
      await ActivityLogService.logActivity({
        action: "create",
        entity: "invoice",
        entity_id: invoiceId,
        invoice_id: invoiceId,
        description: `Created invoice ${invoiceData.invoice_number} for ${customerRows[0].name}`,
        source: "system",
      });

      // Jika ada items, simpan ke invoice_items (jika diperlukan)
      if (items && items.length > 0) {
        await this.saveInvoiceItems(invoiceId, items);
      }

      return {
        id: invoiceId,
        invoice_number: invoiceData.invoice_number,
        customer_id: invoiceData.customer_id,
        created_by: invoiceData.created_by,
        amount: invoiceData.amount,
        message: "Invoice created successfully",
      };
    } catch (error) {
      console.error("Create manual invoice error:", error);
      throw error;
    }
  }

  static async saveInvoiceItems(invoiceId, items) {
    try {
      for (const item of items) {
        await db.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, created_at) 
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            invoiceId,
            item.description,
            item.quantity || 1,
            item.unit_price,
            item.amount || item.unit_price * (item.quantity || 1),
          ],
        );
      }
      console.log(`✅ Saved ${items.length} invoice items`);
    } catch (error) {
      console.error("Save invoice items error:", error);
      // Jangan throw error agar invoice tetap tersimpan
    }
  }

  // Get all invoices dengan filter
  static async getInvoices(filters = {}, page = 1, limit = 20) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params = [];

      if (filters.customer_id) {
        whereClause += " AND i.customer_id = ?";
        params.push(filters.customer_id);
      }

      if (filters.status) {
        whereClause += " AND i.status = ?";
        params.push(filters.status);
      }

      if (filters.date_from) {
        whereClause += " AND i.issue_date >= ?";
        params.push(filters.date_from);
      }

      if (filters.date_to) {
        whereClause += " AND i.issue_date <= ?";
        params.push(filters.date_to);
      }

      if (filters.search) {
        whereClause += " AND (i.invoice_number LIKE ? OR c.name LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
      }

      // Get invoices
      const [invoices] = await db.query(
        `SELECT 
          i.*,
          c.name as customer_name,
          c.username_pppoe,
          c.phone as customer_phone,
          DATEDIFF(i.due_date, CURDATE()) as days_until_due,
          IF(i.due_date < CURDATE() AND i.status = 'pending', 'overdue', i.status) as display_status
         FROM invoices i
         JOIN customers c ON i.customer_id = c.id
         ${whereClause}
         ORDER BY i.issue_date DESC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), parseInt(offset)],
      );

      // Get total count
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM invoices i ${whereClause}`,
        params,
      );

      return {
        data: invoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Get invoices error:", error);
      throw error;
    }
  }

  // Get invoice by ID
  static async getInvoiceById(id) {
    try {
      const [invoices] = await db.query(
        `SELECT 
          i.*,
          c.name as customer_name,
          c.phone as customer_phone,
          c.address as customer_address,
          c.username_pppoe,
          s.start_date as subscription_start,
          s.expired_at as subscription_expired
         FROM invoices i
         JOIN customers c ON i.customer_id = c.id
         LEFT JOIN subscriptions s ON i.subscription_id = s.id
         WHERE i.id = ?`,
        [id],
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // Get payments for this invoice
      const [payments] = await db.query(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC",
        [id],
      );

      invoice.payments = payments;
      invoice.paid_amount = payments.reduce(
        (sum, payment) => sum + parseFloat(payment.amount),
        0,
      );
      invoice.balance = invoice.amount - invoice.paid_amount;
      invoice.is_paid = invoice.paid_amount >= invoice.amount;
      invoice.formatted_amount = InvoiceUtils.formatCurrency(invoice.amount);
      invoice.formatted_paid = InvoiceUtils.formatCurrency(invoice.paid_amount);
      invoice.formatted_balance = InvoiceUtils.formatCurrency(invoice.balance);

      return invoice;
    } catch (error) {
      logger.error("Get invoice by ID error:", error);
      throw error;
    }
  }

  // Process payment
  static async processPayment(invoiceId, paymentData, adminId) {
    let connection;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      console.log(`💳 Processing payment for invoice ID: ${invoiceId}`);

      // 1. Get invoice
      const [invoices] = await connection.query(
        `SELECT i.*, c.id as customer_id, c.name as customer_name, c.expired_at as customer_expired,
              c.package_id, p.duration_days
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       LEFT JOIN packages p ON c.package_id = p.id
       WHERE i.id = ?`,
        [invoiceId],
      );

      if (invoices.length === 0) throw new Error("Invoice not found");
      const invoice = invoices[0];

      // Validasi
      if (invoice.status === "paid") throw new Error("Invoice already paid");
      if (invoice.status === "cancelled")
        throw new Error("Invoice is cancelled");

      const paymentAmount = parseFloat(paymentData.amount);
      const invoiceAmount = parseFloat(invoice.amount);

      if (paymentAmount <= 0)
        throw new Error("Payment amount must be greater than 0");
      if (paymentAmount > invoiceAmount)
        throw new Error("Payment amount exceeds invoice amount");

      // 2. Buat payment record (tanpa customer_id)
      const paymentRef =
        paymentData.reference ||
        `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const [paymentResult] = await connection.query(
        `INSERT INTO payments (invoice_id, amount, payment_method, reference, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          invoiceId,
          paymentAmount,
          paymentData.payment_method,
          paymentRef,
          paymentData.notes || "Payment via dashboard",
        ],
      );

      // 3. Update invoice status - HINDARI mengisi paid_by jika ada constraint error
      try {
        await connection.query(
          `UPDATE invoices SET
          status = 'paid',
          paid_date = NOW(),
          payment_method = ?,
          reference_number = ?,
          payment_notes = ?,
          updated_at = NOW()
         WHERE id = ?`,
          [
            paymentData.payment_method,
            paymentRef,
            paymentData.notes || "Payment via dashboard",
            invoiceId,
          ],
        );
      } catch (updateError) {
        // Jika error karena foreign key constraint, coba tanpa paid_by
        if (
          updateError.code === "ER_NO_REFERENCED_ROW_2" ||
          updateError.errno === 1452
        ) {
          console.warn(
            `⚠️ Foreign key constraint error, updating invoice without paid_by`,
          );
          await connection.query(
            `UPDATE invoices SET
            status = 'paid',
            paid_date = NOW(),
            payment_method = ?,
            reference_number = ?,
            payment_notes = ?,
            updated_at = NOW()
           WHERE id = ?`,
            [
              paymentData.payment_method,
              paymentRef,
              paymentData.notes || "Payment via dashboard",
              invoiceId,
            ],
          );
        } else {
          throw updateError;
        }
      }

      console.log(`✅ Invoice marked as paid`);

      // 4. Update customer subscription jika ada package
      if (invoice.package_id && invoice.duration_days) {
        const today = new Date();
        let newExpiryDate = invoice.customer_expired
          ? new Date(invoice.customer_expired)
          : new Date(today);

        // Jika sudah expired, mulai dari hari ini
        if (newExpiryDate <= today) {
          newExpiryDate = new Date(today);
        }

        newExpiryDate.setDate(
          newExpiryDate.getDate() + parseInt(invoice.duration_days),
        );
        const newExpiryStr = newExpiryDate.toISOString().split("T")[0];

        await connection.query(
          `UPDATE customers SET
          expired_at = ?,
          status = 'active',
          updated_at = NOW()
         WHERE id = ?`,
          [newExpiryStr, invoice.customer_id],
        );

        console.log(
          `✅ Customer ${invoice.customer_name} extended to ${newExpiryStr}`,
        );
      }

      // 5. Log activity (jika tabel logs ada)
      try {
        const [logTables] = await connection.query("SHOW TABLES LIKE 'logs'");
        if (logTables.length > 0) {
          await connection.query(
            `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
              "invoice_paid",
              "invoice",
              invoiceId,
              `Invoice ${invoice.invoice_number} paid via ${paymentData.payment_method}. Amount: ${paymentAmount}`,
              "admin",
              adminId,
            ],
          );
        }
      } catch (logError) {
        console.warn(`⚠️ Failed to log activity:`, logError.message);
      }

      await connection.commit();

      // 6. Return success response
      const [updatedInvoices] = await connection.query(
        `SELECT i.*, c.name as customer_name, c.expired_at as customer_expired
       FROM invoices i JOIN customers c ON i.customer_id = c.id
       WHERE i.id = ?`,
        [invoiceId],
      );

      const updatedInvoice = updatedInvoices[0];

      // PERBAIKAN: Hanya return data, tanpa wrapper success/message
      return {
        invoice: updatedInvoice,
        payment: {
          id: paymentResult.insertId,
          amount: paymentAmount,
          payment_method: paymentData.payment_method,
          reference: paymentRef,
        },
      };
    } catch (error) {
      console.error("❌ Error in processPayment:", error.message);
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  // static async processPayment(req, res) {
  //   try {
  //     const { id } = req.params;
  //     const { amount, payment_method, reference, notes } = req.body;
  //     const adminId = req.user.id;

  //     console.log(`💳 Processing payment request:`, {
  //       invoiceId: id,
  //       amount,
  //       payment_method,
  //       reference,
  //       notes,
  //       adminId,
  //     });

  //     // Validasi
  //     if (!amount || amount <= 0) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Valid amount is required",
  //       });
  //     }

  //     if (!payment_method) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Payment method is required",
  //       });
  //     }

  //     // Convert amount to number jika perlu
  //     const paymentAmount = parseFloat(amount);

  //     if (isNaN(paymentAmount)) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Invalid amount format",
  //       });
  //     }

  //     console.log(`🔧 Calling InvoiceService.processPayment`);

  //     // Panggil service
  //     const result = await InvoiceService.processPayment(
  //       id,
  //       {
  //         amount: paymentAmount,
  //         payment_method,
  //         reference,
  //         notes,
  //       },
  //       adminId,
  //     );

  //     console.log(`✅ Payment processed successfully:`, result);

  //     // Kembalikan response yang konsisten
  //     res.json({
  //       success: true,
  //       message: "Payment processed successfully",
  //       data: result,
  //     });
  //   } catch (error) {
  //     console.error("❌ Error in processPayment controller:", {
  //       message: error.message,
  //       stack: error.stack,
  //       code: error.code,
  //       sqlMessage: error.sqlMessage,
  //     });

  //     let statusCode = 500;
  //     let errorMessage = error.message;

  //     if (error.message === "Invoice not found") {
  //       statusCode = 404;
  //     } else if (error.message.includes("already paid")) {
  //       statusCode = 400;
  //     } else if (error.message.includes("cancelled")) {
  //       statusCode = 400;
  //     } else if (error.message.includes("exceeds invoice amount")) {
  //       statusCode = 400;
  //     }

  //     res.status(statusCode).json({
  //       success: false,
  //       message: errorMessage,
  //       error:
  //         process.env.NODE_ENV === "development"
  //           ? {
  //               message: error.message,
  //               stack: error.stack,
  //               code: error.code,
  //             }
  //           : undefined,
  //     });
  //   }
  // }

  // Update invoice status
  static async updateInvoiceStatus(invoiceId, status, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [invoices] = await connection.query(
        "SELECT * FROM invoices WHERE id = ?",
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      await connection.query(
        "UPDATE invoices SET status = ?, updated_at = NOW() WHERE id = ?",
        [status, invoiceId],
      );

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, invoice_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "update_invoice_status",
          "invoice",
          invoiceId,
          invoiceId,
          `Invoice status updated to ${status}`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      return { success: true, invoice_id: invoiceId, new_status: status };
    } catch (error) {
      await connection.rollback();
      logger.error("Update invoice status error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Delete invoice
  static async deleteInvoice(invoiceId, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🗑️ Attempting to delete invoice ID: ${invoiceId}`);

      // 1. Cek apakah invoice ada
      const [invoices] = await connection.query(
        "SELECT * FROM invoices WHERE id = ?",
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // 2. Cek jika invoice sudah ada pembayaran
      const [payments] = await connection.query(
        "SELECT COUNT(*) as count FROM payments WHERE invoice_id = ?",
        [invoiceId],
      );

      const paymentCount = payments[0].count;

      if (paymentCount > 0) {
        // OPTION 1: Throw error dengan informasi detail
        const [paymentDetails] = await connection.query(
          `SELECT p.id, p.amount, p.payment_method, p.created_at 
         FROM payments p 
         WHERE p.invoice_id = ? 
         LIMIT 3`,
          [invoiceId],
        );

        throw new Error(
          `Cannot delete invoice. It has ${paymentCount} payment record(s). ` +
            `Amount: ${paymentDetails
              .map((p) => `Rp ${parseFloat(p.amount).toLocaleString("id-ID")}`)
              .join(", ")}`,
        );
      }

      // 3. Cek apakah invoice digunakan di subscriptions
      const [subscriptions] = await connection.query(
        "SELECT COUNT(*) as count FROM subscriptions WHERE invoice_id = ?",
        [invoiceId],
      );

      const subscriptionCount = subscriptions[0].count;

      if (subscriptionCount > 0) {
        // Update subscription untuk set invoice_id menjadi NULL
        await connection.query(
          "UPDATE subscriptions SET invoice_id = NULL WHERE invoice_id = ?",
          [invoiceId],
        );
        console.log(
          `⚠️ Updated ${subscriptionCount} subscription(s) to remove invoice reference`,
        );
      }

      // 4. Delete invoice
      const [result] = await connection.query(
        "DELETE FROM invoices WHERE id = ?",
        [invoiceId],
      );

      if (result.affectedRows === 0) {
        throw new Error("Failed to delete invoice");
      }

      // 5. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "delete_invoice",
          "invoice",
          invoiceId,
          `Invoice deleted: ${invoice.invoice_number}`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      console.log(`✅ Invoice deleted successfully: ${invoice.invoice_number}`);

      return {
        success: true,
        invoice_number: invoice.invoice_number,
        deleted: true,
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error in InvoiceService.deleteInvoice:", error.message);

      // Tentukan pesan error yang lebih spesifik
      let errorMessage = error.message;

      // Handle MySQL foreign key constraint error
      if (error.code === "ER_ROW_IS_REFERENCED_2" || error.errno === 1451) {
        errorMessage =
          "Cannot delete invoice because it is referenced by payment records. Delete payments first or cancel the invoice instead.";
      } else if (
        error.code === "ER_NO_REFERENCED_ROW_2" ||
        error.errno === 1452
      ) {
        errorMessage = "Invoice not found or already deleted";
      }

      throw new Error(errorMessage);
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Cancel invoice (soft delete alternative)
  static async cancelInvoice(invoiceId, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`❌ Canceling invoice ID: ${invoiceId}`);

      // 1. Cek apakah invoice ada
      const [invoices] = await connection.query(
        "SELECT * FROM invoices WHERE id = ?",
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // 2. Cek jika invoice sudah dibayar
      if (invoice.status === "paid") {
        throw new Error(
          "Cannot cancel a paid invoice. Please refund the payment first.",
        );
      }

      // 3. Update status menjadi cancelled
      await connection.query(
        "UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [invoiceId],
      );

      // 4. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "cancel_invoice",
          "invoice",
          invoiceId,
          `Invoice cancelled: ${invoice.invoice_number}`,
          "admin",
          adminId,
        ],
      );

      await connection.commit();

      console.log(`✅ Invoice cancelled: ${invoice.invoice_number}`);

      return {
        success: true,
        invoice_number: invoice.invoice_number,
        status: "cancelled",
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error in InvoiceService.cancelInvoice:", error.message);
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Get invoice statistics
  static async getInvoiceStatistics() {
    try {
      const [stats] = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM invoices) as total_invoices,
          (SELECT COUNT(*) FROM invoices WHERE status = 'pending') as pending_invoices,
          (SELECT COUNT(*) FROM invoices WHERE status = 'paid') as paid_invoices,
          (SELECT COUNT(*) FROM invoices WHERE status = 'overdue') as overdue_invoices,
          (SELECT SUM(amount) FROM invoices WHERE status = 'paid' AND DATE(paid_date) = CURDATE()) as today_revenue,
          (SELECT SUM(amount) FROM invoices WHERE status = 'paid' AND MONTH(paid_date) = MONTH(CURDATE())) as monthly_revenue,
          (SELECT SUM(amount) FROM invoices WHERE status = 'paid' AND YEAR(paid_date) = YEAR(CURDATE())) as yearly_revenue,
          (SELECT SUM(amount) FROM invoices WHERE status = 'pending' AND due_date < CURDATE()) as overdue_amount
      `);

      return stats[0];
    } catch (error) {
      logger.error("Get invoice statistics error:", error);
      throw error;
    }
  }

  // Get customer invoices
  static async getCustomerInvoices(customerId) {
    try {
      const [invoices] = await db.query(
        `SELECT 
          i.*,
          DATEDIFF(i.due_date, CURDATE()) as days_until_due
         FROM invoices i
         WHERE i.customer_id = ?
         ORDER BY i.issue_date DESC`,
        [customerId],
      );

      return invoices;
    } catch (error) {
      logger.error("Get customer invoices error:", error);
      throw error;
    }
  }

  // Create automatic invoice untuk customer baru atau perpanjangan
  static async createAutoInvoice(customerId, adminId = 1) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`🤖 Creating auto invoice for customer ID: ${customerId}`);

      // 1. Get customer with package details
      const [customers] = await connection.query(
        `SELECT c.*, p.price, p.duration_days, p.name as package_name
       FROM customers c
       JOIN packages p ON c.package_id = p.id
       WHERE c.id = ?`,
        [customerId],
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // 2. Generate invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.floor(
        Math.random() * 1000,
      )}`;

      // 3. Hitung tanggal due date (misal 7 hari dari sekarang)
      const issueDate = new Date();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);

      // 4. Buat invoice
      const [invoiceResult] = await connection.query(
        `INSERT INTO invoices (invoice_number, customer_id, amount, issue_date, due_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
        [
          invoiceNumber,
          customerId,
          customer.price,
          issueDate.toISOString().split("T")[0],
          dueDate.toISOString().split("T")[0],
        ],
      );

      const invoiceId = invoiceResult.insertId;

      // 5. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "create_auto_invoice",
          "invoice",
          invoiceId,
          `Auto invoice created for ${customer.name} - ${customer.package_name}`,
          "system",
          adminId,
        ],
      );

      await connection.commit();

      return {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        customer_name: customer.name,
        amount: customer.price,
        due_date: dueDate.toISOString().split("T")[0],
      };
    } catch (error) {
      await connection.rollback();
      console.error("❌ Error creating auto invoice:", error);
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }
  static async markOverdueInvoices() {
    const connection = await pool.getConnection();

    try {
      // Update pending invoices yang sudah lewat due date menjadi overdue
      const [result] = await connection.query(
        `UPDATE invoices 
         SET status = 'overdue'
         WHERE status = 'pending'
         AND due_date < CURDATE()`,
      );

      console.log(`✅ Marked ${result.affectedRows} invoices as overdue`);
      return result.affectedRows;
    } catch (error) {
      console.error("❌ Failed to mark overdue invoices:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  static async autoGenerateMonthlyInvoices() {
    const connection = await pool.getConnection();

    try {
      // 1. Cari customer aktif yang akan expired dalam 7 hari
      const [customers] = await connection.query(`
        SELECT 
          c.id,
          c.name,
          c.package_id,
          p.price,
          p.name as package_name,
          c.expired_at
        FROM customers c
        JOIN packages p ON c.package_id = p.id
        WHERE c.status = 'active'
        AND c.expired_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND NOT EXISTS (
          SELECT 1 FROM invoices i 
          WHERE i.customer_id = c.id 
          AND i.status IN ('pending', 'overdue')
          AND i.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        )
      `);

      let generated = 0;

      for (const customer of customers) {
        // Generate invoice
        const invoiceNumber = `INV-${Date.now()}-${customer.id}`;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7); // Due 7 hari dari sekarang

        await connection.query(
          `INSERT INTO invoices 
           (invoice_number, customer_id, amount, description, status, issue_date, due_date, created_at)
           VALUES (?, ?, ?, ?, 'pending', CURDATE(), ?, NOW())`,
          [
            invoiceNumber,
            customer.id,
            customer.price,
            `Pembayaran paket ${customer.package_name}`,
            dueDate,
          ],
        );

        generated++;
        console.log(`✅ Generated invoice for ${customer.name}`);
      }

      console.log(`📊 Generated ${generated} invoices`);
      return generated;
    } catch (error) {
      console.error("❌ Failed to generate invoices:", error);
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = InvoiceService;
