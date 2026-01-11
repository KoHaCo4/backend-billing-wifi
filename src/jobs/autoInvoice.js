const cron = require("node-cron");
const InvoiceService = require("../services/invoice.service");
const db = require("../config/database");

async function generateAutoInvoices() {
  console.log("🔄 Running auto invoice generation...");

  const connection = await db.getConnection();

  try {
    // Cari customer yang akan expired dalam 3 hari dan auto_renew = 1
    const [customers] = await connection.query(
      `SELECT c.id, c.name, c.expired_at, c.auto_renew, p.price, p.name as package_name
       FROM customers c
       JOIN packages p ON c.package_id = p.id
       WHERE c.status = 'active'
         AND c.auto_renew = 1
         AND DATEDIFF(c.expired_at, CURDATE()) <= 3
         AND DATEDIFF(c.expired_at, CURDATE()) > 0
         AND NOT EXISTS (
           SELECT 1 FROM invoices i 
           WHERE i.customer_id = c.id 
           AND i.status = 'pending'
           AND i.due_date > CURDATE()
         )`
    );

    console.log(`📊 Found ${customers.length} customers for auto invoice`);

    for (const customer of customers) {
      try {
        // Buat invoice otomatis
        const result = await InvoiceService.createAutoInvoice(customer.id, 1);

        console.log(
          `✅ Auto invoice created for ${customer.name}: ${result.invoice_number}`
        );
      } catch (error) {
        console.error(
          `❌ Failed to create invoice for customer ${customer.name}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in auto invoice job:", error);
  } finally {
    if (connection && connection.release) {
      connection.release();
    }
  }
}

// Jadwalkan job untuk berjalan setiap hari jam 00:00
cron.schedule("0 0 * * *", generateAutoInvoices);

module.exports = generateAutoInvoices;
