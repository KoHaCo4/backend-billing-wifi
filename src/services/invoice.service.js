const db = require("../config/database");
const InvoiceUtils = require("../utils/invoice");
const logger = require("../utils/logger");
const SuspensionService = require("./suspension.service");

class InvoiceService {
  // Get all invoices dengan filter multi-user
  static async getInvoices(
    filters = {},
    page = 1,
    limit = 20,
    adminId = null,
    role = null,
  ) {
    try {
      const offset = (page - 1) * limit;

      let whereClause = "WHERE 1=1";
      const params = [];
      const countParams = [];

      // Filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        whereClause += `
          AND (
            i.admin_id = ? 
            OR (i.is_shared = 1 AND JSON_CONTAINS(i.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
        countParams.push(adminId, JSON.stringify([adminId]));
      }

      if (filters.customer_id) {
        whereClause += " AND i.customer_id = ?";
        params.push(filters.customer_id);
        countParams.push(filters.customer_id);
      }

      if (filters.status) {
        whereClause += " AND i.status = ?";
        params.push(filters.status);
        countParams.push(filters.status);
      }

      if (filters.date_from) {
        whereClause += " AND i.issue_date >= ?";
        params.push(filters.date_from);
        countParams.push(filters.date_from);
      }

      if (filters.date_to) {
        whereClause += " AND i.issue_date <= ?";
        params.push(filters.date_to);
        countParams.push(filters.date_to);
      }

      if (filters.search) {
        whereClause += " AND (i.invoice_number LIKE ? OR c.name LIKE ?)";
        const searchTerm = `%${filters.search}%`;
        params.push(searchTerm, searchTerm);
        countParams.push(searchTerm, searchTerm);
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
        countParams,
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

  // Get invoice by ID dengan authorization
  static async getInvoiceById(id, adminId = null, role = null) {
    try {
      let query = `
        SELECT 
          i.*,
          c.name as customer_name,
          c.phone as customer_phone,
          c.address as customer_address,
          c.username_pppoe,
          c.admin_id as customer_admin_id,
          s.start_date as subscription_start,
          s.expired_at as subscription_expired,
          a.name as admin_name,
          a.email as admin_email
         FROM invoices i
         JOIN customers c ON i.customer_id = c.id
         LEFT JOIN subscriptions s ON i.subscription_id = s.id
         LEFT JOIN admins a ON i.admin_id = a.id
         WHERE i.id = ?
      `;

      const params = [id];

      // Tambahkan filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            i.admin_id = ? 
            OR (i.is_shared = 1 AND JSON_CONTAINS(i.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [invoices] = await db.query(query, params);

      if (invoices.length === 0) {
        return null; // Return null jika tidak ditemukan atau tidak ada akses
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

  // Create manual invoice dengan admin_id
  static async createManualInvoice(invoiceData, items = [], connection = null) {
    let useExternalConnection = false;

    if (!connection) {
      connection = await db.getConnection();
      await connection.beginTransaction();
    } else {
      useExternalConnection = true;
    }

    try {
      console.log("📦 Creating invoice with data:", invoiceData);

      // Double check customer exists and admin has access
      let customerQuery = "SELECT id, name, phone FROM customers WHERE id = ?";
      const customerParams = [invoiceData.customer_id];

      if (invoiceData.admin_id) {
        customerQuery += " AND admin_id = ?";
        customerParams.push(invoiceData.admin_id);
      }

      const [customerRows] = await connection.query(
        customerQuery,
        customerParams,
      );

      if (customerRows.length === 0) {
        throw new Error(
          `Customer with ID ${invoiceData.customer_id} not found or access denied`,
        );
      }

      console.log(`✅ Confirmed customer: ${customerRows[0].name}`);

      // Generate invoice number
      const invoiceNumber = await InvoiceUtils.generateInvoiceNumber();

      if (!invoiceNumber || invoiceNumber.trim() === "") {
        throw new Error("Failed to generate invoice number");
      }

      console.log(`✅ Generated invoice number: ${invoiceNumber}`);

      // Prepare dates
      const issueDate =
        invoiceData.issue_date || new Date().toISOString().split("T")[0];
      const dueDate =
        invoiceData.due_date ||
        (() => {
          const date = new Date();
          date.setDate(date.getDate() + 7);
          return date.toISOString().split("T")[0];
        })();

      console.log(`📝 Invoice prepared:`, {
        invoice_number: invoiceNumber,
        customer_id: invoiceData.customer_id,
        admin_id: invoiceData.admin_id,
        amount: invoiceData.amount,
        issue_date: issueDate,
        due_date: dueDate,
      });

      // Query INSERT dengan admin_id
      const query = `
      INSERT INTO invoices (
        invoice_number, 
        customer_id, 
        admin_id,
        amount, 
        subtotal,
        tax_amount,
        discount_amount,
        description,
        package_id,
        invoice_type,
        status, 
        issue_date, 
        due_date, 
        created_by,
        is_shared,
        shared_with,
        created_at, 
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

      const values = [
        invoiceNumber,
        invoiceData.customer_id,
        invoiceData.admin_id, // Tambahkan admin_id
        invoiceData.amount,
        invoiceData.subtotal || invoiceData.amount,
        invoiceData.tax_amount || 0.0,
        invoiceData.discount_amount || 0.0,
        invoiceData.description,
        invoiceData.package_id || null,
        invoiceData.invoice_type || "regular",
        invoiceData.status || "pending",
        issueDate,
        dueDate,
        invoiceData.created_by || invoiceData.admin_id,
        invoiceData.is_shared || 0,
        invoiceData.shared_with || null,
      ];

      console.log("🔍 Executing query:", query.replace(/\s+/g, " "));

      const [invoiceResult] = await connection.query(query, values);
      const invoiceId = invoiceResult.insertId;
      console.log(`✅ Invoice inserted with ID: ${invoiceId}`);

      // Generate payment link
      const paymentCode = InvoiceUtils.generatePaymentCode(
        invoiceId,
        invoiceData.customer_id,
      );
      const paymentLink = InvoiceUtils.generatePaymentLink(paymentCode);
      const expiresAt = InvoiceUtils.calculateExpiryDate(24);

      console.log(`🔗 Payment link generated: ${paymentLink}`);

      await connection.query(
        "UPDATE invoices SET payment_code = ?, payment_link = ?, expires_at = ? WHERE id = ?",
        [paymentCode, paymentLink, expiresAt, invoiceId],
      );

      // Get complete invoice data
      const [invoices] = await connection.query(
        "SELECT * FROM invoices WHERE id = ?",
        [invoiceId],
      );

      const invoice = invoices[0];

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "create_invoice",
          "invoice",
          invoiceId,
          `Invoice ${invoiceNumber} created for customer ${customerRows[0].name}`,
          "admin",
          invoiceData.admin_id,
        ],
      );

      if (!useExternalConnection) {
        await connection.commit();
      }

      return {
        id: invoiceId,
        invoice_number: invoiceNumber,
        customer_id: invoiceData.customer_id,
        admin_id: invoiceData.admin_id,
        created_by: invoiceData.created_by,
        amount: invoiceData.amount,
        payment_code: paymentCode,
        payment_link: paymentLink,
        expires_at: expiresAt,
        issue_date: issueDate,
        due_date: dueDate,
        status: invoiceData.status || "pending",
        message: "Invoice created successfully with payment link",
      };
    } catch (error) {
      if (!useExternalConnection && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }
      console.error("❌ Create manual invoice error:", error);
      throw error;
    } finally {
      if (!useExternalConnection && connection) {
        try {
          connection.release();
        } catch (releaseError) {
          console.error("Connection release error:", releaseError);
        }
      }
    }
  }

  // Process payment dengan authorization
  static async processPayment(invoiceId, paymentData, adminId, role) {
    let connection;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      console.log(
        `💳 Processing payment for invoice ID: ${invoiceId}, Admin: ${adminId}, Role: ${role}`,
      );

      // 1. Get invoice dengan authorization
      let query = `
        SELECT i.*, 
        c.id as customer_id, 
        c.name as customer_name, 
        c.phone as customer_phone,
        c.username_pppoe,
        c.expired_at as customer_expired,
        c.package_id, 
        p.duration_days,
        p.name as package_name,
        p.price as package_price
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE i.id = ?
      `;

      const params = [invoiceId];

      // Tambahkan filter authorization jika bukan superadmin
      if (role !== "superadmin") {
        query += `
          AND (
            i.admin_id = ? 
            OR (i.is_shared = 1 AND JSON_CONTAINS(i.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [invoices] = await connection.query(query, params);

      if (invoices.length === 0) {
        throw new Error("Invoice not found or access denied");
      }

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

      // 2. Buat payment record dengan admin_id
      const paymentRef =
        paymentData.reference ||
        `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const [paymentResult] = await connection.query(
        `INSERT INTO payments (invoice_id, admin_id, amount, payment_method, reference, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          invoiceId,
          adminId, // Tambahkan admin_id
          paymentAmount,
          paymentData.payment_method,
          paymentRef,
          paymentData.notes || "Payment via dashboard",
        ],
      );

      // 3. Update invoice status
      await connection.query(
        `UPDATE invoices SET
        status = 'paid',
        paid_date = NOW(),
        payment_method = ?,
        reference_number = ?,
        payment_notes = ?,
        paid_by = ?,
        updated_at = NOW()
        WHERE id = ?`,
        [
          paymentData.payment_method,
          paymentRef,
          paymentData.notes || "Payment via dashboard",
          adminId,
          invoiceId,
        ],
      );

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

      // 5. Log activity
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

      await connection.commit();

      // 6. Return success response
      const [updatedInvoices] = await connection.query(
        `SELECT i.*, c.name as customer_name, c.expired_at as customer_expired
        FROM invoices i JOIN customers c ON i.customer_id = c.id
        WHERE i.id = ?`,
        [invoiceId],
      );

      const updatedInvoice = updatedInvoices[0];

      // 7. Kirim pesan konfirmasi pembayaran via WhatsApp
      try {
        const fonnteService = require("./fonnte.service");

        const customerData = {
          id: invoice.customer_id,
          name: invoice.customer_name,
          phone: invoice.customer_phone,
          username_pppoe: invoice.username_pppoe || "",
        };

        const paymentInfo = {
          id: paymentResult.insertId,
          payment_method: paymentData.payment_method,
          amount: paymentAmount,
          reference: paymentRef,
        };

        const packageInfo = {
          name: invoice.package_name || "Paket Internet",
          price: invoice.package_price || "0",
        };

        console.log(
          `📤 Sending payment confirmation to ${customerData.name}...`,
        );

        const messageResult = await fonnteService.sendPaymentConfirmation(
          customerData,
          updatedInvoice,
          paymentInfo,
          packageInfo,
        );

        if (messageResult.success) {
          console.log(`✅ Payment confirmation sent successfully`);
        } else {
          console.error(
            `❌ Failed to send payment confirmation:`,
            messageResult.error,
          );
        }
      } catch (whatsappError) {
        console.error(
          `❌ Error sending WhatsApp confirmation:`,
          whatsappError.message,
        );
      }

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

  // Update invoice status dengan authorization
  static async updateInvoiceStatus(invoiceId, status, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Cek akses terlebih dahulu
      let query = "SELECT * FROM invoices WHERE id = ?";
      const params = [invoiceId];

      if (role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [invoices] = await connection.query(query, params);

      if (invoices.length === 0) {
        throw new Error("Invoice not found or access denied");
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

  // Delete invoice dengan authorization
  static async deleteInvoice(invoiceId, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(
        `🗑️ Attempting to delete invoice ID: ${invoiceId}, Admin: ${adminId}, Role: ${role}`,
      );

      // 1. Cek akses terlebih dahulu
      let query = "SELECT * FROM invoices WHERE id = ?";
      const params = [invoiceId];

      if (role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [invoices] = await connection.query(query, params);

      if (invoices.length === 0) {
        throw new Error("Invoice not found or access denied");
      }

      const invoice = invoices[0];

      // 2. Cek jika invoice sudah ada pembayaran
      const [payments] = await connection.query(
        "SELECT COUNT(*) as count FROM payments WHERE invoice_id = ?",
        [invoiceId],
      );

      const paymentCount = payments[0].count;

      if (paymentCount > 0) {
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

      let errorMessage = error.message;

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

  // Cancel invoice (soft delete alternative) dengan authorization
  static async cancelInvoice(invoiceId, adminId, role) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(
        `❌ Canceling invoice ID: ${invoiceId}, Admin: ${adminId}, Role: ${role}`,
      );

      // 1. Cek akses terlebih dahulu
      let query = "SELECT * FROM invoices WHERE id = ?";
      const params = [invoiceId];

      if (role !== "superadmin") {
        query += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [invoices] = await connection.query(query, params);

      if (invoices.length === 0) {
        throw new Error("Invoice not found or access denied");
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

  // Get invoice statistics per admin
  static async getInvoiceStatistics(adminId = null, role = null) {
    try {
      let whereClause = "WHERE 1=1";
      const params = [];

      // Filter berdasarkan admin jika bukan superadmin
      if (adminId && role !== "superadmin") {
        whereClause += `
          AND (
            admin_id = ? 
            OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      const [stats] = await db.query(
        `
        SELECT 
          (SELECT COUNT(*) FROM invoices ${whereClause}) as total_invoices,
          (SELECT COUNT(*) FROM invoices ${whereClause} AND status = 'pending') as pending_invoices,
          (SELECT COUNT(*) FROM invoices ${whereClause} AND status = 'paid') as paid_invoices,
          (SELECT COUNT(*) FROM invoices ${whereClause} AND status = 'overdue') as overdue_invoices,
          (SELECT SUM(amount) FROM invoices ${whereClause} AND status = 'paid' AND DATE(paid_date) = CURDATE()) as today_revenue,
          (SELECT SUM(amount) FROM invoices ${whereClause} AND status = 'paid' AND MONTH(paid_date) = MONTH(CURDATE())) as monthly_revenue,
          (SELECT SUM(amount) FROM invoices ${whereClause} AND status = 'paid' AND YEAR(paid_date) = YEAR(CURDATE())) as yearly_revenue,
          (SELECT SUM(amount) FROM invoices ${whereClause} AND status = 'pending' AND due_date < CURDATE()) as overdue_amount
      `,
        params,
      );

      return stats[0];
    } catch (error) {
      logger.error("Get invoice statistics error:", error);
      throw error;
    }
  }

  // Get customer invoices dengan authorization
  static async getCustomerInvoices(customerId, adminId = null, role = null) {
    try {
      let query = `
        SELECT 
          i.*,
          DATEDIFF(i.due_date, CURDATE()) as days_until_due
         FROM invoices i
         WHERE i.customer_id = ?
      `;

      const params = [customerId];

      // Tambahkan filter authorization jika bukan superadmin
      if (adminId && role !== "superadmin") {
        query += `
          AND (
            i.admin_id = ? 
            OR (i.is_shared = 1 AND JSON_CONTAINS(i.shared_with, CAST(? AS JSON)))
          )
        `;
        params.push(adminId, JSON.stringify([adminId]));
      }

      query += " ORDER BY i.issue_date DESC";

      const [invoices] = await db.query(query, params);
      return invoices;
    } catch (error) {
      logger.error("Get customer invoices error:", error);
      throw error;
    }
  }

  // Check if admin can access invoice
  static async canAccessInvoice(invoiceId, adminId, role) {
    try {
      if (role === "superadmin") {
        return true;
      }

      const [invoices] = await db.query(
        `SELECT id FROM invoices 
         WHERE id = ? 
         AND (
           admin_id = ? 
           OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON)))
         )`,
        [invoiceId, adminId, JSON.stringify([adminId])],
      );

      return invoices.length > 0;
    } catch (error) {
      logger.error("Check invoice access error:", error);
      return false;
    }
  }
}

module.exports = InvoiceService;
