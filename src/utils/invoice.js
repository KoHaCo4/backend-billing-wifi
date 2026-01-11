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
      [`INV/${yearMonth}/%`]
    );

    const count = result[0].count;
    const seq = (count + 1).toString().padStart(4, "0");

    return `INV/${yearMonth}/${seq}`;
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
