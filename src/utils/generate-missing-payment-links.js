// generate-missing-payment-links.js
const db = require("../config/database");
const InvoiceService = require("../services/invoice.service");

async function generateMissingPaymentLinks() {
  console.log("=== GENERATING MISSING PAYMENT LINKS ===");

  try {
    // 1. Get all pending invoices without payment links
    const [invoices] = await db.query(
      `SELECT i.*, c.name as customer_name, c.admin_id 
       FROM invoices i 
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.status = 'pending' 
       AND (i.payment_link IS NULL OR i.payment_link = '')
       ORDER BY i.created_at DESC`,
    );

    console.log(`Found ${invoices.length} invoices without payment links`);

    // 2. Get settings untuk setiap admin_id
    const adminSettings = {};

    for (const invoice of invoices) {
      try {
        console.log(
          `\n--- Processing invoice ${invoice.invoice_number} (Customer: ${invoice.customer_name}) ---`,
        );

        // Check if admin has settings
        const adminId = invoice.admin_id || 3;

        if (!adminSettings[adminId]) {
          const [settings] = await db.query(
            `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
            [adminId],
          );

          if (settings.length > 0) {
            const settingsData =
              typeof settings[0].settings_json === "string"
                ? JSON.parse(settings[0].settings_json)
                : settings[0].settings_json;
            adminSettings[adminId] = settingsData.whatsapp || {};
          } else {
            adminSettings[adminId] = { enablePaymentLinks: true }; // Default true
          }
        }

        const enablePaymentLinks =
          adminSettings[adminId]?.enablePaymentLinks === true;

        if (enablePaymentLinks) {
          console.log(
            `✅ Payment links enabled for admin ${adminId}, generating payment link...`,
          );

          const result = await InvoiceService.generatePaymentLinkForInvoice(
            invoice.id,
          );

          console.log(`✅ Generated payment link: ${result.payment_link}`);

          // Verify
          const [updatedInvoice] = await db.query(
            `SELECT payment_link FROM invoices WHERE id = ?`,
            [invoice.id],
          );

          console.log(
            `🔍 Verification: ${updatedInvoice[0].payment_link ? "SUCCESS" : "FAILED"}`,
          );
        } else {
          console.log(
            `⚠️ Payment links disabled for admin ${adminId}, skipping...`,
          );
        }

        // Delay untuk menghindari rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(
          `❌ Error processing invoice ${invoice.id}:`,
          error.message,
        );
      }
    }

    // 3. Final verification
    console.log("\n=== FINAL VERIFICATION ===");
    const [remaining] = await db.query(
      `SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND (payment_link IS NULL OR payment_link = '')`,
    );

    console.log(`Invoices still without payment links: ${remaining[0].count}`);

    if (remaining[0].count === 0) {
      console.log("✅ ALL invoices now have payment links!");
    } else {
      console.log("⚠️ Some invoices still missing payment links");
    }
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await db.end();
  }
}

generateMissingPaymentLinks();
