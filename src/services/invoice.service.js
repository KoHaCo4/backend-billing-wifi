const db = require("../config/database");
const InvoiceUtils = require("../utils/invoice");
const logger = require("../utils/logger");
const SuspensionService = require("./suspension.service");

class InvoiceService {
  // Create invoice untuk customer extension
  static async createInvoiceForExtension(
    customerId,
    subscriptionId,
    amount,
    adminId = 0
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
        [customerId]
      );

      if (customers.length === 0) throw new Error("Customer not found");

      const customer = customers[0];

      // Generate invoice number
      const invoiceNumber = await InvoiceUtils.generateInvoiceNumber();
      const issueDate = new Date().toISOString().split("T")[0];
      const dueDate = InvoiceUtils.calculateDueDate(issueDate, 7);

      // Create invoice
      const [invoiceResult] = await connection.query(
        `INSERT INTO invoices 
         (invoice_number, customer_id, subscription_id, amount, description, status, issue_date, due_date) 
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          invoiceNumber,
          customerId,
          subscriptionId,
          amount,
          `Pembayaran paket ${customer.package_name} (${customer.duration_days} hari)`,
          issueDate,
          dueDate,
        ]
      );

      const invoiceId = invoiceResult.insertId;

      // Update subscription dengan invoice_id
      if (subscriptionId) {
        await connection.query(
          "UPDATE subscriptions SET invoice_id = ? WHERE id = ?",
          [invoiceId, subscriptionId]
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
        ]
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
  static async createManualInvoice(data, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Generate invoice number
      const invoiceNumber = await InvoiceUtils.generateInvoiceNumber();
      const issueDate = new Date().toISOString().split("T")[0];
      const dueDate = InvoiceUtils.calculateDueDate(issueDate, 7);

      // Create invoice
      const [invoiceResult] = await connection.query(
        `INSERT INTO invoices 
         (invoice_number, customer_id, subscription_id, amount, description, status, issue_date, due_date) 
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          invoiceNumber,
          data.customer_id,
          data.subscription_id || null,
          data.amount,
          data.description || "Manual invoice",
          issueDate,
          dueDate,
        ]
      );

      const invoiceId = invoiceResult.insertId;

      // Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, invoice_id, description, source, admin_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "create_invoice",
          "invoice",
          invoiceId,
          invoiceId,
          `Manual invoice ${invoiceNumber} created`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      return {
        id: invoiceId,
        invoice_number: invoiceNumber,
        ...data,
        issue_date: issueDate,
        due_date: dueDate,
        status: "pending",
      };
    } catch (error) {
      await connection.rollback();
      logger.error("Create manual invoice error:", error);
      throw error;
    } finally {
      connection.release();
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
        [...params, parseInt(limit), parseInt(offset)]
      );

      // Get total count
      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) as total FROM invoices i ${whereClause}`,
        params
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
        [id]
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // Get payments for this invoice
      const [payments] = await db.query(
        "SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC",
        [id]
      );

      invoice.payments = payments;
      invoice.paid_amount = payments.reduce(
        (sum, payment) => sum + parseFloat(payment.amount),
        0
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
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      console.log(`💳 Processing payment for invoice ID: ${invoiceId}`);

      // 1. Get invoice with ALL necessary data
      const [invoices] = await connection.query(
        `SELECT i.*, 
              c.id as customer_id, 
              c.expired_at as current_customer_expired, 
              c.package_id as customer_package_id,
              c.status as customer_status,
              c.auto_renew,
              p.id as package_id, 
              p.duration_days, 
              p.name as package_name,
              p.price as package_price
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       JOIN packages p ON c.package_id = p.id
       WHERE i.id = ?`,
        [invoiceId]
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];
      const customerId = invoice.customer_id;
      const packageId = invoice.customer_package_id || invoice.package_id;
      const durationDays = invoice.duration_days;

      console.log("📋 Invoice debug data:", {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        customer_id: customerId,
        package_id: packageId,
        duration_days: durationDays,
        current_expired: invoice.current_customer_expired,
        invoice_amount: invoice.amount,
        package_price: invoice.package_price,
      });

      // 2. Check if invoice is already paid
      if (invoice.status === "paid") {
        throw new Error("Invoice is already paid");
      }

      // 3. Check payment amount
      const invoiceAmount = parseFloat(invoice.amount);
      const paymentAmount = parseFloat(paymentData.amount);

      if (paymentAmount <= 0) {
        throw new Error("Payment amount must be greater than 0");
      }

      if (paymentAmount > invoiceAmount) {
        throw new Error("Payment amount exceeds invoice amount");
      }

      // 4. Insert payment record
      const [paymentResult] = await connection.query(
        `INSERT INTO payments (invoice_id, amount, payment_method, reference, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          invoiceId,
          paymentAmount,
          paymentData.payment_method,
          paymentData.reference || null,
          paymentData.notes || null,
        ]
      );

      // 5. Update invoice status
      await connection.query(
        `UPDATE invoices SET status = 'paid', paid_date = NOW() WHERE id = ?`,
        [invoiceId]
      );

      // ============================================
      // 6. EXTEND CUSTOMER EXPIRED DATE
      // ============================================
      if (packageId && durationDays) {
        console.log(`🔄 Extending customer ${customerId} subscription...`);

        // Dapatkan tanggal expired saat ini
        const [customerData] = await connection.query(
          `SELECT expired_at FROM customers WHERE id = ?`,
          [customerId]
        );

        const currentExpired = customerData[0]?.expired_at
          ? new Date(customerData[0].expired_at)
          : new Date(); // Jika null, gunakan hari ini

        const today = new Date();

        console.log(`📅 Dates debug:`, {
          today: today.toISOString().split("T")[0],
          current_expired: currentExpired.toISOString().split("T")[0],
          duration_days: durationDays,
        });

        // Tentukan tanggal expired baru
        let newExpiredDate;

        // Jika sudah expired atau expired hari ini, mulai dari hari ini
        if (currentExpired <= today) {
          newExpiredDate = new Date(today);
          console.log(
            `📅 Customer expired or expiring today, starting from today`
          );
        } else {
          // Jika masih aktif, tambah dari tanggal expired yang lama
          newExpiredDate = new Date(currentExpired);
          console.log(
            `📅 Customer still active, extending from current expired date`
          );
        }

        // Cek jika customer dalam status suspended
        if (customer.status === "suspended") {
          console.log(`🔄 Reactivating suspended customer ${customerId}`);

          // Reactivate customer (enable PPPoE)
          await SuspensionService.reactivateCustomer(
            customerId,
            adminId,
            "Reactivated: Invoice paid"
          );
        }

        // Tambahkan durasi package
        newExpiredDate.setDate(newExpiredDate.getDate() + durationDays);

        const newExpiredDateStr = newExpiredDate.toISOString().split("T")[0];
        console.log(`📅 New expired date: ${newExpiredDateStr}`);

        // Update expired_at di customer
        await connection.query(
          `UPDATE customers SET expired_at = ?, status = 'active' WHERE id = ?`,
          [newExpiredDateStr, customerId]
        );

        // 7. Buat/update subscription record
        // Cek apakah sudah ada subscription aktif untuk customer ini
        const [existingSubscriptions] = await connection.query(
          `SELECT id FROM subscriptions 
         WHERE customer_id = ? AND status = 'active'
         ORDER BY expired_at DESC LIMIT 1`,
          [customerId]
        );

        //  Check if customer was suspended and reactivate
        if (customer.customer_status === "suspended") {
          console.log(
            `🔄 Customer was suspended, reactivating after payment...`
          );

          try {
            const SuspensionService = require("./suspension.service");
            await SuspensionService.reactivateCustomer(
              customerId,
              adminId,
              "Reactivated: Invoice paid"
            );
            console.log(`✅ Customer ${customerId} reactivated after payment`);
          } catch (reactivateError) {
            console.warn(
              `⚠️ Failed to reactivate customer ${customerId} after payment:`,
              reactivateError.message
            );
          }
        }

        if (existingSubscriptions.length > 0) {
          // Update existing subscription - PERBAIKAN DI SINI
          await connection.query(
            `UPDATE subscriptions 
           SET expired_at = ?, status = 'active'
           WHERE id = ?`,
            [newExpiredDateStr, existingSubscriptions[0].id]
          );
          console.log(`✅ Updated existing subscription`);
        } else {
          // Buat subscription baru
          await connection.query(
            `INSERT INTO subscriptions (customer_id, package_id, start_date, expired_at, status, invoice_id, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, NOW())`,
            [
              customerId,
              packageId,
              today.toISOString().split("T")[0],
              newExpiredDateStr,
              invoiceId,
            ]
          );
          console.log(`✅ Created new subscription record`);
        }

        console.log(
          `✅ Customer ${customerId} extended to: ${newExpiredDateStr}`
        );
      } else {
        console.log(
          `⚠️ No package found for invoice ${invoiceId}, skipping extension`
        );
      }

      // 8. Log activity
      await connection.query(
        `INSERT INTO logs (action, entity, entity_id, description, source, admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "process_payment",
          "invoice",
          invoiceId,
          `Payment processed for invoice ${invoice.invoice_number}. Amount: ${paymentAmount}, Method: ${paymentData.payment_method}`,
          "admin",
          adminId,
        ]
      );

      await connection.commit();

      // 9. Return updated data
      const [updatedInvoice] = await connection.query(
        `SELECT i.*, c.name as customer_name, c.expired_at as customer_expired
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       WHERE i.id = ?`,
        [invoiceId]
      );

      return {
        success: true,
        message: "Payment processed successfully",
        data: {
          invoice: updatedInvoice[0],
          payment_id: paymentResult.insertId,
          amount_paid: paymentAmount,
          customer_extended: packageId ? true : false,
        },
      };
    } catch (error) {
      await connection.rollback();
      console.error(
        "❌ Error in InvoiceService.processPayment:",
        error.message
      );
      throw error;
    } finally {
      if (connection && connection.release) {
        connection.release();
      }
    }
  }

  // Update invoice status
  static async updateInvoiceStatus(invoiceId, status, adminId) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [invoices] = await connection.query(
        "SELECT * FROM invoices WHERE id = ?",
        [invoiceId]
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      await connection.query(
        "UPDATE invoices SET status = ?, updated_at = NOW() WHERE id = ?",
        [status, invoiceId]
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
        ]
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
        [invoiceId]
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // 2. Cek jika invoice sudah ada pembayaran
      const [payments] = await connection.query(
        "SELECT COUNT(*) as count FROM payments WHERE invoice_id = ?",
        [invoiceId]
      );

      const paymentCount = payments[0].count;

      if (paymentCount > 0) {
        // OPTION 1: Throw error dengan informasi detail
        const [paymentDetails] = await connection.query(
          `SELECT p.id, p.amount, p.payment_method, p.created_at 
         FROM payments p 
         WHERE p.invoice_id = ? 
         LIMIT 3`,
          [invoiceId]
        );

        throw new Error(
          `Cannot delete invoice. It has ${paymentCount} payment record(s). ` +
            `Amount: ${paymentDetails
              .map((p) => `Rp ${parseFloat(p.amount).toLocaleString("id-ID")}`)
              .join(", ")}`
        );
      }

      // 3. Cek apakah invoice digunakan di subscriptions
      const [subscriptions] = await connection.query(
        "SELECT COUNT(*) as count FROM subscriptions WHERE invoice_id = ?",
        [invoiceId]
      );

      const subscriptionCount = subscriptions[0].count;

      if (subscriptionCount > 0) {
        // Update subscription untuk set invoice_id menjadi NULL
        await connection.query(
          "UPDATE subscriptions SET invoice_id = NULL WHERE invoice_id = ?",
          [invoiceId]
        );
        console.log(
          `⚠️ Updated ${subscriptionCount} subscription(s) to remove invoice reference`
        );
      }

      // 4. Delete invoice
      const [result] = await connection.query(
        "DELETE FROM invoices WHERE id = ?",
        [invoiceId]
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
        ]
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
        [invoiceId]
      );

      if (invoices.length === 0) {
        throw new Error("Invoice not found");
      }

      const invoice = invoices[0];

      // 2. Cek jika invoice sudah dibayar
      if (invoice.status === "paid") {
        throw new Error(
          "Cannot cancel a paid invoice. Please refund the payment first."
        );
      }

      // 3. Update status menjadi cancelled
      await connection.query(
        "UPDATE invoices SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [invoiceId]
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
        ]
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
        [customerId]
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
        [customerId]
      );

      if (customers.length === 0) {
        throw new Error("Customer not found");
      }

      const customer = customers[0];

      // 2. Generate invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.floor(
        Math.random() * 1000
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
        ]
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
        ]
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
         AND due_date < CURDATE()`
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
          ]
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
