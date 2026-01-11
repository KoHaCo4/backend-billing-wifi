// jobs/invoiceGenerator.js
const cron = require("node-cron");
const {
  generateMonthlyInvoices,
} = require("../services/invoiceGenerator.service");

// Jalankan setiap hari jam 00:00
cron.schedule("0 0 * * *", async () => {
  console.log("🚀 Running auto invoice generation...");
  try {
    await generateMonthlyInvoices();
    console.log("✅ Auto invoice generation completed");
  } catch (error) {
    console.error("❌ Auto invoice generation failed:", error);
  }
});

// Jalankan setiap jam untuk cek invoice yang akan expired
cron.schedule("0 * * * *", async () => {
  await checkUpcomingExpirations();
});
