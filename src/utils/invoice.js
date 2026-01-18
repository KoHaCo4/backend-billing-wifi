const db = require("../config/database");

class InvoiceUtils {
  // Generate invoice number format: INV/YYYYMM/XXXX
  static async generateInvoiceNumber() {
    const db = require("../config/database");
    const date = new Date();
    const yearMonth =
      date.getFullYear().toString() +
      (date.getMonth() + 1).toString().padStart(2, "0");

    // Hitung jumlah invoice bulan ini
    const [result] = await db.query(
      `SELECT COUNT(*) as count FROM invoices 
       WHERE invoice_number LIKE ?`,
      [`INV/${yearMonth}/%`],
    );

    const count = result[0].count;
    const seq = (count + 1).toString().padStart(4, "0");

    return `INV/${yearMonth}/${seq}`;
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
}

module.exports = InvoiceUtils;
