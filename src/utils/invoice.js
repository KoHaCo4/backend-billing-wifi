const db = require("../config/database");
const crypto = require("crypto");

class InvoiceUtils {
  // Generate invoice number format: INV/YYYYMM/XXXX
  static async generateInvoiceNumber() {
    try {
      console.log("🔢 Generating invoice number...");

      // Coba multiple strategies untuk generate invoice number
      const strategies = [
        // Strategy 1: Format berdasarkan tanggal dan sequence
        async () => {
          const date = new Date();
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");

          // Hitung invoice hari ini
          const [rows] = await db.query(
            "SELECT COUNT(*) as count FROM invoices WHERE DATE(created_at) = CURDATE()",
          );
          const count = (rows[0].count || 0) + 1;

          return `INV-${year}${month}${day}-${String(count).padStart(4, "0")}`;
        },

        // Strategy 2: Format berdasarkan timestamp
        async () => {
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 1000);
          return `INV-${timestamp}-${random}`;
        },

        // Strategy 3: Format simple
        async () => {
          const date = new Date();
          return `INV-${date.getTime()}`;
        },
      ];

      // Coba setiap strategy sampai berhasil
      for (let i = 0; i < strategies.length; i++) {
        try {
          const invoiceNumber = await strategies[i]();
          console.log(`✅ Generated invoice number: ${invoiceNumber}`);
          return invoiceNumber;
        } catch (error) {
          console.warn(`Strategy ${i + 1} failed:`, error.message);
          if (i === strategies.length - 1) throw error;
        }
      }

      // Fallback ke timestamp jika semua gagal
      return `INV-${Date.now()}`;
    } catch (error) {
      console.error("❌ Error generating invoice number:", error);
      // Fallback yang selalu berhasil
      return `INV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }
  }

  static getCompleteInvoiceData(baseData) {
    const subtotal = parseFloat(baseData.amount) || 0;
    const taxAmount = baseData.tax_amount || 0;
    const discountAmount = baseData.discount_amount || 0;
    const amount = subtotal + taxAmount - discountAmount;

    return {
      invoice_number: baseData.invoice_number,
      customer_id: baseData.customer_id,
      subscription_id: baseData.subscription_id || null,
      package_id: baseData.package_id || null,
      package_name: baseData.package_name || null,
      subtotal: subtotal,
      tax_amount: taxAmount,
      discount_amount: discountAmount,
      amount: amount,
      description: baseData.description || "Invoice",
      invoice_type: baseData.invoice_type || "regular",
      status: baseData.status || "pending",
      issue_date: baseData.issue_date,
      due_date: baseData.due_date,
      payment_method: baseData.payment_method || null,
      reference_number: baseData.reference_number || null,
      payment_notes: baseData.payment_notes || null,
      created_by: baseData.created_by || null,
      is_recurring: baseData.is_recurring || 0,
      next_billing_date: baseData.next_billing_date || null,
    };
  }

  // Function untuk insert invoice dengan field lengkap
  static async insertInvoice(invoiceData) {
    try {
      const {
        invoice_number,
        customer_id,
        subscription_id,
        package_id,
        package_name,
        subtotal,
        tax_amount,
        discount_amount,
        amount,
        description,
        invoice_type,
        status,
        issue_date,
        due_date,
        payment_method,
        reference_number,
        payment_notes,
        created_by,
        is_recurring,
        next_billing_date,
      } = invoiceData;

      // Query dengan semua kolom yang dibutuhkan
      const query = `
      INSERT INTO invoices (
        invoice_number, 
        customer_id, 
        subscription_id, 
        package_id, 
        package_name,
        subtotal, 
        tax_amount, 
        discount_amount, 
        amount, 
        description, 
        invoice_type,
        status, 
        issue_date, 
        due_date, 
        payment_method, 
        reference_number,
        payment_notes, 
        created_by, 
        is_recurring, 
        next_billing_date,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

      const params = [
        invoice_number,
        customer_id,
        subscription_id,
        package_id,
        package_name,
        subtotal,
        tax_amount,
        discount_amount,
        amount,
        description,
        invoice_type,
        status,
        issue_date,
        due_date,
        payment_method,
        reference_number,
        payment_notes,
        created_by,
        is_recurring,
        next_billing_date,
      ];

      console.log("📝 Executing SQL...");
      const [result] = await db.query(query, params);
      console.log(`✅ Invoice inserted with ID: ${result.insertId}`);

      return result.insertId;
    } catch (error) {
      console.error("❌ Insert invoice error:", error.message);
      console.error("❌ SQL:", error.sql);
      throw error;
    }
  }

  // Calculate due date (default 7 hari dari issue date)
  static calculateDueDate(issueDate, days = 7) {
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + days);
    return dueDate.toISOString().split("T")[0];
  }

  // Format currency IDR
  static formatCurrency(amount) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  }

  // ... existing functions ...

  // Generate unique payment code
  static generatePaymentCode(invoiceId, customerId) {
    const secret = process.env.PAYMENT_SECRET || "vns-payment-secret-2024";
    const timestamp = Date.now();
    const data = `${invoiceId}:${customerId}:${timestamp}`;

    const hash = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("hex")
      .substring(0, 12)
      .toUpperCase();

    return `VNS${invoiceId.toString().padStart(6, "0")}${hash}`;
  }

  // Generate payment link
  static generatePaymentLink(paymentCode) {
    const baseUrl =
      process.env.FRONTEND_URL || "https://frontend-billing-wifi.vercel.app";
    return `${baseUrl}/pay/${paymentCode}`;
  }

  // Calculate expiry date (default 24 hours)
  static calculateExpiryDate(hours = 24) {
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return date;
  }

  // Update invoice with payment link
  static async updateInvoiceWithPaymentLink(
    invoiceId,
    paymentCode,
    paymentLink,
    expiresAt,
  ) {
    try {
      await db.query(
        "UPDATE invoices SET payment_code = ?, payment_link = ?, expires_at = ? WHERE id = ?",
        [paymentCode, paymentLink, expiresAt, invoiceId],
      );

      console.log(`✅ Updated invoice ${invoiceId} with payment link`);
      return true;
    } catch (error) {
      console.error("Error updating invoice with payment link:", error);
      throw error;
    }
  }

  // Get invoice by payment code
  static async getInvoiceByPaymentCode(paymentCode) {
    try {
      const [invoices] = await db.query(
        `SELECT i.*, c.name as customer_name, c.phone,
                c.address, p.name as package_name, p.duration_days
         FROM invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         LEFT JOIN packages p ON i.package_id = p.id
         WHERE i.payment_code = ?`,
        [paymentCode],
      );

      return invoices[0] || null;
    } catch (error) {
      console.error("Error getting invoice by payment code:", error);
      throw error;
    }
  }

  // Validate payment link
  static async validatePaymentLink(paymentCode) {
    try {
      const invoice = await this.getInvoiceByPaymentCode(paymentCode);

      if (!invoice) {
        return { valid: false, message: "Payment link tidak valid" };
      }

      if (invoice.status !== "pending") {
        return {
          valid: false,
          message: "Invoice sudah dibayar atau dibatalkan",
        };
      }

      if (invoice.expires_at && new Date(invoice.expires_at) < new Date()) {
        return { valid: false, message: "Payment link telah kadaluarsa" };
      }

      return {
        valid: true,
        invoice,
        message: "Payment link valid",
      };
    } catch (error) {
      console.error("Error validating payment link:", error);
      throw error;
    }
  }
}

module.exports = InvoiceUtils;
