// test-payment-link-flow.js
const db = require("./src/config/database");
const InvoiceService = require("./src/services/invoice.service");

async function testPaymentLinkFlow() {
  console.log("=== TEST PAYMENT LINK FLOW ===");

  try {
    // 1. Cek setting
    const [settings] = await db.query(
      `SELECT settings_json FROM settings WHERE admin_id = 3`,
    );

    if (settings.length > 0) {
      const settingsData =
        typeof settings[0].settings_json === "string"
          ? JSON.parse(settings[0].settings_json)
          : settings[0].settings_json;

      console.log("\n1. SETTINGS CHECK:");
      console.log(
        `   enablePaymentLinks: ${settingsData.whatsapp?.enablePaymentLinks}`,
      );
      console.log(
        `   Type: ${typeof settingsData.whatsapp?.enablePaymentLinks}`,
      );
      console.log(
        `   === true: ${settingsData.whatsapp?.enablePaymentLinks === true}`,
      );
    }

    // 2. Cek customer dengan invoice pending
    const [customers] = await db.query(`
      SELECT c.*, i.id as invoice_id, i.invoice_number, i.payment_link
      FROM customers c
      LEFT JOIN invoices i ON c.id = i.customer_id AND i.status = 'pending'
      WHERE c.admin_id = 3
      AND c.status = 'active'
      LIMIT 5
    `);

    console.log("\n2. CUSTOMERS WITH PENDING INVOICES:");
    customers.forEach((c) => {
      console.log(
        `   - ${c.name}: Invoice ${c.invoice_number || "N/A"}, Payment Link: ${c.payment_link || "NO LINK"}`,
      );
    });

    // 3. Test generate payment link
    console.log("\n3. TEST GENERATE PAYMENT LINK:");
    if (customers[0]?.invoice_id) {
      console.log(`   Testing with invoice ${customers[0].invoice_number}...`);

      const result = await InvoiceService.generatePaymentLinkForInvoice(
        customers[0].invoice_id,
      );

      console.log(`   ✅ Generated: ${result.payment_link}`);

      // Verify
      const [updated] = await db.query(
        `SELECT payment_link FROM invoices WHERE id = ?`,
        [customers[0].invoice_id],
      );

      console.log(`   🔍 Database now has: ${updated[0].payment_link}`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await db.end();
  }
}

testPaymentLinkFlow();
