const cron = require("node-cron");
const Customer = require("../models/Customer");
const NotificationLog = require("../models/NotificationLog");
const InvoiceService = require("../services/invoice.service");
const fonnteService = require("../services/fonnte.service");
const logger = require("../utils/logger");
const PhoneUtils = require("../utils/phoneutils");
const db = require("../config/database");

class CustomerReminderJob {
  constructor() {
    this.job = null;
    this.isRunning = false;
    this.daysBefore = [3, 1]; // H-3 dan H-1
    this.startTime = null;
    this.enablePaymentLinks = process.env.ENABLE_PAYMENT_LINKS === "true";
  }

  // ===== JOB MANAGEMENT =====

  start() {
    try {
      const schedule =
        process.env.NODE_ENV === "production"
          ? "0 9,15 * * *" // Production: jam 09:00 dan 15:00
          : "*/2 * * * *"; // Development: setiap 10 menit

      logger.info(`⏰ Scheduling customer reminder job: ${schedule}`);

      this.job = cron.schedule(
        schedule,
        async () => {
          if (this.isRunning) {
            logger.warn("⚠️ Job already running, skipping...");
            return;
          }
          logger.info("🚀 ===== STARTING CUSTOMER REMINDER JOB =====");
          await this.run();
        },
        {
          scheduled: true,
          timezone: "Asia/Jakarta",
        },
      );

      this.startTime = new Date();
      logger.info(
        `✅ Customer reminder job started at ${this.startTime.toLocaleString("id-ID")}`,
      );

      // Initial debug check
      setTimeout(() => {
        logger.info("🔍 Running initial system check...");
        this.checkSystemHealth();
      }, 5000);
    } catch (error) {
      logger.error("❌ Failed to start customer reminder job:", error);
      throw error;
    }
  }

  stop() {
    if (this.job) {
      this.job.stop();
      logger.info("🛑 Customer reminder job stopped");
    }
  }

  // ===== MAIN JOB EXECUTION =====

  async run() {
    this.isRunning = true;
    const jobStartTime = Date.now();

    try {
      logger.info("🔧 ===== SYSTEM PREPARATION =====");

      // 1. Check Fonnte connectivity
      const fonnteStatus = await fonnteService.checkDeviceStatus();
      if (!fonnteStatus.success) {
        logger.error("❌ Fonnte service unavailable, aborting job");
        this.isRunning = false;
        return;
      }
      logger.info(
        `✅ Fonnte status: ${fonnteStatus.connected ? "CONNECTED" : "DISCONNECTED"}`,
      );

      // 2. Reset reminder flags for expired invoices
      const resetCount = await this.resetExpiredReminders();
      logger.info(`🔄 Reset ${resetCount} expired reminder flags`);

      // 3. Send reminders for each configured day
      for (const days of this.daysBefore) {
        await this.processDayReminders(days);
      }

      // 4. Process expired payments
      await this.processExpiredPayments();

      const duration = Date.now() - jobStartTime;
      logger.info(`✅ ===== JOB COMPLETED IN ${duration}ms =====`);
    } catch (error) {
      logger.error("❌ Critical job error:", error.stack);

      // Log error to database
      await db.query(
        `INSERT INTO system_errors 
         (module, error_type, error_message, stack_trace, created_at)
         VALUES ('customer_reminder', 'job_error', ?, ?, NOW())`,
        [error.message, error.stack],
      );
    } finally {
      this.isRunning = false;
    }
  }

  // ===== CORE PROCESSING =====

  async processDayReminders(daysBefore) {
    try {
      console.log(`📨 ===== PROCESSING ${daysBefore}-DAY REMINDERS =====`);

      const customers = await Customer.findExpiringInDays(daysBefore);

      console.log(
        `📊 Found ${customers.length} customers for ${daysBefore}-day reminder`,
      );

      // Debug: Tampilkan detail setiap customer
      customers.forEach((cust, idx) => {
        console.log(
          `${idx + 1}. ${cust.name} - Phone: ${cust.phone} - Expired: ${cust.expired_at} - Days left: ${cust.days_left}`,
        );
      });

      if (customers.length === 0) {
        console.log(
          `ℹ️ Tidak ada customer yang perlu reminder ${daysBefore} hari`,
        );
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const customer of customers) {
        console.log(`\n--- Processing ${customer.name} ---`);

        // ⚠️ PERUBAHAN PENTING: Gunakan processCustomerReminder bukan sendReminder
        const result = await this.processCustomerReminder(customer, daysBefore);

        // Perhatikan bahwa processCustomerReminder mengembalikan {status, ...}
        // sedangkan sendReminder mengembalikan {success, ...}
        if (result.status === "success") {
          successCount++;

          // ⚠️ PERUBAHAN: Tandai sudah dikirim reminder
          await Customer.markReminderSent(customer.id);

          console.log(`✅ Berhasil mengirim reminder ke ${customer.name}`);
        } else {
          failCount++;
          console.log(
            `❌ Gagal mengirim ke ${customer.name}: ${result.error || result.reason}`,
          );
        }

        // Delay antar pengiriman untuk menghindari rate limit
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      console.log(
        `\n📈 HASIL ${daysBefore}-DAY: ${successCount} berhasil, ${failCount} gagal`,
      );
    } catch (error) {
      console.error(`❌ Error in ${daysBefore}-day processing:`, error);
    }
  }

  async processCustomerReminder(customer, daysBefore) {
    const requestId = `cust_${customer.id}_${Date.now()}`;

    try {
      console.log(`[${requestId}] Processing ${customer.name}...`);

      // 1. Validate customer data
      const validation = this.validateCustomer(customer);
      if (!validation.valid) {
        console.warn(`[${requestId}] Skipped: ${validation.reason}`);
        return { status: "skipped", reason: validation.reason };
      }

      // 2. Normalize phone number
      const phoneNumber = PhoneUtils.normalizeToFonnte(customer.phone);
      if (!phoneNumber) {
        console.error(`[${requestId}] Invalid phone format: ${customer.phone}`);
        return { status: "skipped", reason: "invalid_phone" };
      }

      // 3. Get or create invoice with payment link
      console.log(`[${requestId}] Getting or creating invoice...`);
      const invoiceResult = await this.getOrCreateInvoice(
        customer,
        daysBefore,
        requestId,
      );

      if (!invoiceResult.success) {
        console.error(`[${requestId}] Invoice error: ${invoiceResult.error}`);
        return {
          status: "failed",
          reason: "invoice_error",
          error: invoiceResult.error,
        };
      }

      const invoice = invoiceResult.invoice;
      console.log(
        `[${requestId}] Invoice: ${invoice.invoice_number}, Payment Link: ${invoice.payment_link || "NO LINK"}`,
      );

      // 4. Create WhatsApp message
      const messageData = {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: phoneNumber,
          package_name: customer.package_name,
          days_left: daysBefore,
        },
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          amount: invoice.amount,
          payment_link: invoice.payment_link,
          expires_at: invoice.expires_at,
          due_date: invoice.due_date,
        },
      };

      // ⚠️ PERBAIKAN: Check if payment links are enabled
      const message =
        this.enablePaymentLinks && invoice.payment_link
          ? this.createPaymentLinkMessage(messageData)
          : this.createRegularReminderMessage(messageData);

      console.log(
        `[${requestId}] Message type: ${this.enablePaymentLinks && invoice.payment_link ? "WITH PAYMENT LINK" : "REGULAR REMINDER"}`,
      );
      console.log(
        `[${requestId}] Message preview: ${message.substring(0, 100)}...`,
      );

      // 5. Send WhatsApp message
      console.log(`[${requestId}] Sending WhatsApp...`);
      const sendResult = await fonnteService.sendMessage(phoneNumber, message, {
        delay: "2-5",
        customData: {
          requestId,
          customerId: customer.id,
          invoiceId: invoice.id,
          type: `reminder_${daysBefore}day`,
        },
      });

      // 6. Update customer reminder status
      if (sendResult.success) {
        console.log(
          `[${requestId}] ✅ WhatsApp sent successfully to ${customer.name}`,
        );
        return {
          status: "success",
          invoiceId: invoice.id,
          messageId: sendResult.messageId,
        };
      } else {
        console.error(`[${requestId}] ❌ WhatsApp failed: ${sendResult.error}`);
        return {
          status: "failed",
          reason: "send_failed",
          error: sendResult.error,
        };
      }
    } catch (error) {
      console.error(`[${requestId}] 🔥 Processing error:`, error);
      return {
        status: "failed",
        reason: "processing_error",
        error: error.message,
      };
    }
  }

  async sendReminder(customer, daysBefore) {
    try {
      console.log(
        `📤 Mengirim reminder ${daysBefore} hari untuk ${customer.name}`,
      );

      // Normalize phone number
      const phoneNumber = PhoneUtils.normalizeToFonnte(customer.phone);
      if (!phoneNumber) {
        console.error(`❌ Nomor tidak valid: ${customer.phone}`);
        return { success: false, error: "Invalid phone number" };
      }

      // Create message
      const message = this.createReminderMessage(customer, daysBefore);

      console.log(`📱 Mengirim ke: ${phoneNumber}`);
      console.log(
        `📝 Pesan (${message.length} chars):\n${message.substring(0, 100)}...`,
      );

      // Send via Fonnte
      const result = await fonnteService.sendMessage(phoneNumber, message, {
        delay: "2-5",
      });

      if (result.success) {
        // Simpan log notifikasi
        await this.saveNotificationLog({
          customer_id: customer.id,
          phone: phoneNumber,
          message_type: `reminder_${daysBefore}day`,
          message: message,
          status: "sent",
          message_id: result.messageId || result.data?.id?.[0],
        });

        return { success: true, messageId: result.messageId };
      } else {
        // Simpan log error
        await this.saveNotificationLog({
          customer_id: customer.id,
          phone: phoneNumber,
          message_type: `reminder_${daysBefore}day`,
          message: message,
          status: "failed",
          error_message: result.error,
        });

        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error(`🔥 Error sending reminder to ${customer.name}:`, error);
      return { success: false, error: error.message };
    }
  }

  createReminderMessage(customer, daysBefore) {
    const daysText = daysBefore === 1 ? "1 hari" : `${daysBefore} hari`;
    const expiryDate = new Date(customer.expired_at).toLocaleDateString(
      "id-ID",
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );

    const price = customer.package_price
      ? `Rp ${Number(customer.package_price).toLocaleString("id-ID")}`
      : "Rp 0";

    return `Halo ${customer.name},

Masa aktif paket internet Anda akan berakhir dalam ${daysText} (${expiryDate}).

Segera lakukan pembayaran untuk menghindari pemutusan layanan.

📋 Detail Paket:
• Paket: ${customer.package_name || "Internet"}
• Harga: ${price}
• Expired: ${expiryDate}

💳 Pembayaran:
Silakan lakukan pembayaran melalui:
1. Transfer Bank
2. E-Wallet
3. Bayar langsung di tempat

Jika sudah membayar, silakan konfirmasi ke admin.

Terima kasih,
${process.env.COMPANY_NAME || "Billing WiFi"}
📞 ${process.env.COMPANY_PHONE || "081234567890"}`;
  }

  async saveNotificationLog(logData) {
    try {
      await db.execute(
        `INSERT INTO notification_logs 
       (customer_id, phone, message_type, message, status, message_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          logData.customer_id,
          logData.phone,
          logData.message_type,
          logData.message.substring(0, 500), // Limit length
          logData.status,
          logData.message_id || null,
          logData.error_message || null,
        ],
      );
      return true;
    } catch (error) {
      console.error("❌ Error saving notification log:", error);
      return false;
    }
  }

  // ===== INVOICE MANAGEMENT =====

  async getOrCreateInvoice(customer, daysBefore, requestId) {
    try {
      // Check for existing pending invoice
      const [existingInvoices] = await db.query(
        `SELECT i.* 
       FROM invoices i
       WHERE i.customer_id = ?
       AND i.status IN ('pending', 'overdue')
       AND i.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY i.created_at DESC
       LIMIT 1`,
        [customer.id],
      );

      if (existingInvoices.length > 0) {
        const invoice = existingInvoices[0];
        console.log(
          `[${requestId}] Menggunakan invoice yang sudah ada: ${invoice.invoice_number}`,
        );

        // ⚠️ PERBAIKAN: Pastikan invoice memiliki payment link
        if (this.enablePaymentLinks && !invoice.payment_link) {
          console.log(
            `[${requestId}] Generating payment link for existing invoice...`,
          );
          const paymentLinkResult =
            await InvoiceService.generatePaymentLinkForInvoice(invoice.id);
          invoice.payment_link = paymentLinkResult.payment_link;
          invoice.expires_at = paymentLinkResult.expires_at;
        }

        return { success: true, invoice };
      }

      // Create new invoice
      console.log(`[${requestId}] Membuat invoice baru untuk ${customer.name}`);

      const invoiceData = {
        customer_id: customer.id,
        amount: customer.package_price || 0,
        description: `Pembayaran paket ${customer.package_name} - Reminder ${daysBefore} hari`,
        package_id: customer.package_id,
        created_by: 0, // System
      };

      // ⚠️ PERBAIKAN: Gunakan createManualInvoice yang sudah include payment link
      const invoice = await InvoiceService.createManualInvoice(invoiceData);

      console.log(`[${requestId}] Invoice dibuat: ${invoice.invoice_number}`);
      return { success: true, invoice };
    } catch (error) {
      console.error(`[${requestId}] Error membuat invoice:`, error);
      return { success: false, error: error.message };
    }
  }

  // ===== MESSAGE CREATION =====

  createPaymentLinkMessage(data) {
    const { customer, invoice } = data;

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    // Jika payment link tidak ada, gunakan pesan regular
    if (!invoice.payment_link) {
      console.warn(
        `⚠️ Invoice ${invoice.invoice_number} tidak memiliki payment link`,
      );
      return this.createRegularReminderMessage(data);
    }

    const expiryDate = invoice.expires_at
      ? new Date(invoice.expires_at).toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "24 jam";

    return `Halo ${customer.name} 👋

Masa aktif paket internet Anda akan berakhir dalam *${customer.days_left} hari*.

📋 Detail Invoice:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name}
• Harga: ${formattedAmount}
• Expired: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}

💳 BAYAR SEKARANG:
👉 ${invoice.payment_link}

Silakan klik link di atas untuk melakukan pembayaran online.
Link akan kadaluarsa pada: ${expiryDate}

Pembayaran otomatis akan mengaktifkan kembali layanan Anda.

Terima kasih 🙏
${process.env.COMPANY_NAME || "VnsNetwork"}
📞 ${process.env.COMPANY_PHONE || "081234567890"}`;
  }

  createRegularReminderMessage(data) {
    const { customer, invoice } = data;

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    return `Halo ${customer.name},

Masa aktif paket internet Anda akan berakhir dalam ${customer.days_left} hari.

📋 Detail Invoice:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name}
• Harga: ${formattedAmount}
• Expired: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}

💳 Pembayaran:
Silakan lakukan pembayaran melalui:
1. Transfer Bank
2. E-Wallet
3. Bayar langsung di tempat

Jika sudah membayar, silakan konfirmasi ke admin.

Terima kasih,
${process.env.COMPANY_NAME || "Billing WiFi"}
📞 ${process.env.COMPANY_PHONE || "081234567890"}`;
  }

  // ===== HELPER FUNCTIONS =====

  validateCustomer(customer) {
    if (!customer.phone || customer.phone.trim() === "") {
      return { valid: false, reason: "no_phone" };
    }

    if (!customer.package_price || customer.package_price <= 0) {
      return { valid: false, reason: "invalid_price" };
    }

    if (customer.is_suspended == 1) {
      return { valid: false, reason: "suspended" };
    }

    return { valid: true };
  }

  async saveNotificationLog(customerId, invoiceId, phone, message, status) {
    try {
      const [result] = await db.query(
        `INSERT INTO notification_logs 
         (customer_id, invoice_id, phone, message_type, message, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          customerId,
          invoiceId,
          phone,
          "payment_reminder",
          message.substring(0, 500), // Limit message length
          status,
        ],
      );

      return result.insertId;
    } catch (error) {
      logger.error("Error saving notification log:", error);
      return null;
    }
  }

  async updateNotificationLog(logId, status, metadata = {}) {
    try {
      await db.query(
        `UPDATE notification_logs 
         SET status = ?, metadata = ?, updated_at = NOW()
         WHERE id = ?`,
        [status, JSON.stringify(metadata), logId],
      );
    } catch (error) {
      logger.error("Error updating notification log:", error);
    }
  }

  async resetExpiredReminders() {
    try {
      const [result] = await db.query(
        `UPDATE customers 
         SET reminder_sent = 0 
         WHERE reminder_sent = 1 
         AND DATE(expired_at) < CURDATE()`,
      );

      return result.affectedRows || 0;
    } catch (error) {
      logger.error("Error resetting reminders:", error);
      return 0;
    }
  }

  // Reset reminder flags untuk customer yang akan expired di masa depan
  async resetReminderFlags() {
    try {
      console.log(
        "🔄 Reset reminder flags untuk customer yang expired BESOK...",
      );

      // Reset untuk customer yang akan expired BESOK (H+1) dan SUDAH pernah dikirim reminder
      // Ini memungkinkan kita mengirim reminder lagi besok
      const [result] = await db.execute(
        `UPDATE customers 
       SET reminder_sent = 0,
           last_reminder_date = NULL
       WHERE status = 'active'
       AND DATE(expired_at) = DATE(DATE_ADD(CURDATE(), INTERVAL 1 DAY))
       AND reminder_sent = 1`,
      );

      console.log(`✅ Reset ${result.affectedRows} reminder flags untuk besok`);
      return result.affectedRows;
    } catch (error) {
      console.error("❌ Error resetting reminder flags:", error);
      return 0;
    }
  }

  // Auto-disable customers yang sudah expired
  async autoDisableExpiredCustomers() {
    try {
      console.log("🔧 Cek customer yang sudah expired...");

      const [expiredCustomers] = await db.execute(
        `SELECT id, name, phone, expired_at
       FROM customers 
       WHERE status = 'active'
       AND DATE(expired_at) < CURDATE()`,
      );

      console.log(
        `📊 Ditemukan ${expiredCustomers.length} customer yang sudah expired`,
      );

      for (const customer of expiredCustomers) {
        try {
          // Update status menjadi inactive
          await db.execute(
            `UPDATE customers 
           SET status = 'inactive',
               suspension_reason = 'Masa aktif telah habis',
               suspended_at = NOW(),
               updated_at = NOW()
           WHERE id = ?`,
            [customer.id],
          );

          // Kirim notifikasi ke admin (opsional)
          const adminMessage = `Customer ${customer.name} (${customer.phone}) telah dinonaktifkan karena masa aktif habis pada ${customer.expired_at}`;

          // Kirim ke nomor admin jika ada
          if (process.env.ADMIN_PHONE) {
            await fonnteService.sendMessage(
              process.env.ADMIN_PHONE,
              adminMessage,
              {
                delay: "1-3",
              },
            );
          }

          console.log(`⛔ Nonaktifkan customer: ${customer.name}`);
        } catch (custError) {
          console.error(
            `Error menonaktifkan customer ${customer.id}:`,
            custError,
          );
        }
      }

      return expiredCustomers.length;
    } catch (error) {
      console.error("❌ Error auto-disabling customers:", error);
      return 0;
    }
  }

  async processExpiredPayments() {
    try {
      logger.info("🕒 Checking for expired payments...");

      const expiredInvoices = await InvoiceService.getExpiredInvoices();

      for (const invoice of expiredInvoices) {
        try {
          await InvoiceService.markInvoiceAsExpired(invoice.id);

          // Send expired notification
          const [customer] = await db.query(
            "SELECT * FROM customers WHERE id = ?",
            [invoice.customer_id],
          );

          if (customer.length > 0) {
            const message = `❌ INVOICE EXPIRED

Invoice ${invoice.invoice_number} telah kadaluarsa.

Silakan hubungi admin untuk membuat invoice baru.

${process.env.COMPANY_NAME || "VnsNetwork"}`;

            await fonnteService.sendMessage(customer[0].phone, message, {
              delay: "1-3",
            });
          }
        } catch (invoiceError) {
          logger.error(
            `Error processing expired invoice ${invoice.id}:`,
            invoiceError,
          );
        }
      }

      logger.info(`✅ Processed ${expiredInvoices.length} expired invoices`);
    } catch (error) {
      logger.error("Error processing expired payments:", error);
    }
  }

  async logStatistics(daysBefore, stats) {
    try {
      await db.query(
        `INSERT INTO job_statistics 
         (job_name, days_before, total_processed, success_count, failed_count, skipped_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [
          "customer_reminder",
          daysBefore,
          stats.total,
          stats.success,
          stats.failed,
          stats.skipped,
        ],
      );
    } catch (error) {
      logger.error("Error logging statistics:", error);
    }
  }

  async checkSystemHealth() {
    try {
      logger.info("🏥 System Health Check...");

      // Check Fonnte
      const fonnteStatus = await fonnteService.checkDeviceStatus();

      // Check database
      const [dbCheck] = await db.query("SELECT 1 as ok");

      // Check pending invoices
      const [pendingCount] = await db.query(
        'SELECT COUNT(*) as count FROM invoices WHERE status = "pending"',
      );

      // Check expiring customers
      const [expiringCount] = await db.query(
        `SELECT COUNT(*) as count FROM customers 
         WHERE status = 'active' 
         AND DATE(expired_at) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`,
      );

      logger.info("📊 Health Check Results:", {
        fonnte: fonnteStatus.success ? "OK" : "FAILED",
        database: dbCheck[0].ok === 1 ? "OK" : "FAILED",
        pending_invoices: pendingCount[0].count,
        expiring_customers: expiringCount[0].count,
      });
    } catch (error) {
      logger.error("Health check error:", error);
    }
  }

  // ===== MANUAL TRIGGERS =====

  async triggerManual(options = {}) {
    const { phone, days = 1, customerId, testMode = false } = options;

    if (phone) {
      // Test to specific number
      const testCustomer = {
        id: customerId || 999,
        name: options.name || "Test Pelanggan",
        phone: phone,
        package_name: options.package_name || "Paket Internet Premium",
        package_price: options.amount || "350000",
        package_id: options.package_id || 1,
      };

      return await this.processCustomerReminder(testCustomer, days);
    } else {
      // Run full job
      return await this.run();
    }
  }

  async getJobStatus() {
    const [latestStats] = await db.query(
      `SELECT * FROM job_statistics 
       ORDER BY created_at DESC 
       LIMIT 5`,
    );

    const [nextReminders] = await db.query(
      `SELECT c.name, c.phone, c.expired_at, 
              DATEDIFF(c.expired_at, CURDATE()) as days_left
       FROM customers c
       WHERE c.status = 'active'
       AND c.expired_at > CURDATE()
       ORDER BY c.expired_at ASC
       LIMIT 10`,
    );

    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      latestStats: latestStats,
      nextReminders: nextReminders,
    };
  }
}

// Export singleton instance
const customerReminderJob = new CustomerReminderJob();
module.exports = customerReminderJob;
