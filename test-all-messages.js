// test-all-messages.js
const fonnteService = require("./src/services/fonnte.service");

async function testAllMessages() {
  console.log("=== TEST 3 JENIS PESAN ===");

  const testCustomer = {
    id: 13,
    name: "misbah tes 6",
    phone: "085117801239",
    email: "test@example.com",
    username_pppoe: "testuser",
    admin_id: 3,
  };

  const testInvoice = {
    id: 24,
    invoice_number: "INV-1769774744425-ka9phcq32",
    amount: "100000",
    payment_link:
      "https://frontend-billing-wifi.vercel.app/pay/VNS00002428F9CCEFF915",
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    issue_date: new Date(),
  };

  const testPackage = {
    id: 1,
    name: "Paket_100K",
    price: "100000",
    duration_days: 30,
  };

  const testPayment = {
    id: 1,
    payment_method: "Bank Transfer",
    amount: "100000",
  };

  console.log("\n1. TEST PESAN INVOICE BARU:");
  const invoiceMessage = fonnteService.createInvoiceCreatedMessage(
    testCustomer,
    testInvoice,
    testPackage,
  );
  console.log(`Panjang: ${invoiceMessage.length} karakter`);
  console.log(`Preview:\n${invoiceMessage.substring(0, 200)}...`);
  console.log(
    `Mengandung payment link: ${invoiceMessage.includes(testInvoice.payment_link)}`,
  );

  console.log("\n2. TEST PESAN REMINDER:");
  const reminderMessage = fonnteService.createPaymentReminderMessage(
    testCustomer,
    testInvoice,
    testPackage,
  );
  console.log(`Panjang: ${reminderMessage.length} karakter`);
  console.log(`Preview:\n${reminderMessage.substring(0, 150)}...`);
  console.log(
    `Mengandung payment link: ${reminderMessage.includes(testInvoice.payment_link)}`,
  );

  console.log("\n3. TEST PESAN KONFIRMASI:");
  const confirmationMessage = fonnteService.createPaymentConfirmationMessage(
    testCustomer,
    testInvoice,
    testPayment,
    testPackage,
  );
  console.log(`Panjang: ${confirmationMessage.length} karakter`);
  console.log(`Preview:\n${confirmationMessage.substring(0, 150)}...`);
  console.log(
    `Mengandung payment link: ${confirmationMessage.includes(testInvoice.payment_link)}`,
  );

  console.log("\n=== SUMMARY ===");
  console.log(
    "1. Invoice Created: ",
    invoiceMessage.length > 500 ? "OK" : "TOO SHORT",
  );
  console.log(
    "2. Payment Reminder: ",
    reminderMessage.length > 400 ? "OK" : "TOO SHORT",
  );
  console.log(
    "3. Payment Confirmation: ",
    confirmationMessage.length > 300 ? "OK" : "TOO SHORT",
  );

  // Test send real message (optional)
  console.log("\n=== SEND TEST MESSAGE (reminder) ===");
  const result = await fonnteService.sendPaymentReminder(
    testCustomer,
    testInvoice,
    testPackage,
  );

  console.log("Send result:", result.success ? "SUCCESS" : "FAILED");
  if (result.success) {
    console.log("Message ID:", result.messageId);
  } else {
    console.log("Error:", result.error);
  }
}

testAllMessages().catch(console.error);
