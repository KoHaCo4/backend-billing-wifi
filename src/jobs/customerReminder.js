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
    this.whatsappSettings = null;
    this.adminId = null;
  }
  setAdminId(adminId) {
    this.adminId = adminId;
    logger.info(`👤 CustomerReminderJob set to admin_id: ${adminId}`);
  }

  // Tambahkan method untuk load settings dari database
  async loadWhatsAppSettings() {
    try {
      // Jika adminId belum di-set, coba cari dari settings terbaru
      if (!this.adminId) {
        // Ambil settings terbaru dari database (tanpa filter admin_id)
        const [settings] = await db.query(
          `SELECT admin_id, settings_json FROM settings ORDER BY updated_at DESC LIMIT 1`,
        );

        if (settings.length > 0) {
          this.adminId = settings[0].admin_id;
          logger.info(`🔍 Auto-detected admin_id: ${this.adminId}`);
        } else {
          // Fallback ke admin_id = 1 jika tidak ada settings
          this.adminId = 1;
          logger.warn("⚠️ No settings found, using admin_id = 1 as fallback");
        }
      }

      const [settings] = await db.query(
        `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [this.adminId],
      );

      if (settings.length > 0 && settings[0].settings_json) {
        let settingsData = settings[0].settings_json;

        // Parse jika string
        if (typeof settingsData === "string") {
          settingsData = JSON.parse(settingsData);
        }

        // Ambil WhatsApp settings
        this.whatsappSettings = settingsData.whatsapp || {
          enableReminder: true,
          reminderSchedule: "0 9,15 * * *",
          daysBefore: [3, 1],
          enablePaymentLinks: true,
          companyName: process.env.COMPANY_NAME || "Billing WiFi",
          companyPhone: process.env.COMPANY_PHONE || "",
          paymentLinkExpiryHours: 24,
        };

        // Update daysBefore dari settings
        if (
          this.whatsappSettings.daysBefore &&
          Array.isArray(this.whatsappSettings.daysBefore)
        ) {
          this.daysBefore = this.whatsappSettings.daysBefore;
        }

        logger.info("✅ WhatsApp settings loaded from database");
      } else {
        // Fallback ke default
        this.whatsappSettings = {
          enableReminder: true,
          reminderSchedule: "0 9,15 * * *",
          daysBefore: [3, 1],
          enablePaymentLinks: true,
          companyName: process.env.COMPANY_NAME || "Billing WiFi",
          companyPhone: process.env.COMPANY_PHONE || "",
          paymentLinkExpiryHours: 24,
        };
        logger.warn("⚠️ No settings found, using default WhatsApp settings");
      }
    } catch (error) {
      logger.error("❌ Error loading WhatsApp settings:", error);
      // Fallback ke default
      this.whatsappSettings = {
        enableReminder: true,
        reminderSchedule: "0 9,15 * * *",
        daysBefore: [3, 1],
        enablePaymentLinks: true,
        companyName: process.env.COMPANY_NAME || "Billing WiFi",
        companyPhone: process.env.COMPANY_PHONE || "",
        paymentLinkExpiryHours: 24,
      };
    }
  }

  // ===== JOB MANAGEMENT =====

  start() {
    try {
      // Load settings dulu
      this.loadWhatsAppSettings()
        .then(() => {
          // Cek apakah reminder diaktifkan
          if (!this.whatsappSettings.enableReminder) {
            logger.info("⏸️ WhatsApp reminder is disabled in settings");
            return;
          }

          // Gunakan schedule dari settings
          const schedule =
            this.whatsappSettings.reminderSchedule ||
            (process.env.NODE_ENV === "production"
              ? "0 9,15 * * *"
              : "*/2 * * * *");

          logger.info(`⏰ Scheduling customer reminder job: ${schedule}`);
          logger.info(`🌍 Timezone: Asia/Jakarta`);
          logger.info(
            `🕒 Current time: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
          );

          // Hentikan job yang ada jika ada
          if (this.job) {
            this.job.stop();
            logger.info("🛑 Stopped previous job");
          }

          // PASTIKAN: Gunakan node-cron dengan benar
          this.job = cron.schedule(
            schedule,
            () => {
              const now = new Date();
              logger.info(
                `⏰ ===== CRON TRIGGERED at ${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} =====`,
              );
              logger.info(
                "🚀 Running customer reminder job from cron schedule...",
              );

              // Jalankan job async tanpa blocking
              this.run().catch((error) => {
                logger.error("❌ Error in cron execution:", error);
              });
            },
            {
              scheduled: true,
              timezone: "Asia/Jakarta",
            },
          );

          this.startTime = new Date();
          logger.info(
            `✅ Customer reminder job started at ${this.startTime.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
          );

          // Log next run time
          try {
            const cronParser = require("cron-parser");
            const interval = cronParser.parseExpression(schedule, {
              currentDate: new Date(),
              tz: "Asia/Jakarta",
            });
            const nextRun = interval.next().toDate();
            logger.info(
              `⏭️ Next scheduled run: ${nextRun.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
            );
          } catch (parseError) {
            logger.warn(
              "⚠️ Could not parse next run time:",
              parseError.message,
            );
          }

          // TEST: Jalankan job sekali untuk memastikan berjalan
          setTimeout(() => {
            logger.info(
              "🧪 Test: Job should run in 10 seconds for verification...",
            );
          }, 10000);
        })
        .catch((error) => {
          logger.error("❌ Failed to load WhatsApp settings:", error);
        });
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

  // async run() {
  //   this.isRunning = true;
  //   const jobStartTime = Date.now();

  //   try {
  //     logger.info("🔧 ===== SYSTEM PREPARATION =====");

  //     // 1. Check Fonnte connectivity
  //     const fonnteStatus = await fonnteService.checkDeviceStatus();
  //     if (!fonnteStatus.success) {
  //       logger.error("❌ Fonnte service unavailable, aborting job");
  //       this.isRunning = false;
  //       return;
  //     }
  //     logger.info(
  //       `✅ Fonnte status: ${fonnteStatus.connected ? "CONNECTED" : "DISCONNECTED"}`,
  //     );

  //     // 2. Reset reminder flags for expired invoices
  //     const resetCount = await this.resetExpiredReminders();
  //     logger.info(`🔄 Reset ${resetCount} expired reminder flags`);

  //     // 3. Send reminders for each configured day
  //     for (const days of this.daysBefore) {
  //       await this.processDayReminders(days);
  //     }

  //     // 4. Process expired payments
  //     await this.processExpiredPayments();

  //     const duration = Date.now() - jobStartTime;
  //     logger.info(`✅ ===== JOB COMPLETED IN ${duration}ms =====`);
  //   } catch (error) {
  //     logger.error("❌ Critical job error:", error.stack);

  //     // Log error to database
  //     await db.query(
  //       `INSERT INTO system_errors
  //        (module, error_type, error_message, stack_trace, created_at)
  //        VALUES ('customer_reminder', 'job_error', ?, ?, NOW())`,
  //       [error.message, error.stack],
  //     );
  //   } finally {
  //     this.isRunning = false;
  //   }
  // }
  async run() {
    this.isRunning = true;
    const jobStartTime = Date.now();

    try {
      logger.info("🔧 ===== SYSTEM PREPARATION =====");

      // ✅ FIX: Validasi jika fonnteService tidak memiliki checkDeviceStatus
      if (
        !fonnteService ||
        typeof fonnteService.checkDeviceStatus !== "function"
      ) {
        logger.error(
          "❌ fonnteService tidak memiliki checkDeviceStatus method",
        );
        logger.info("⚠️ Melanjutkan tanpa pengecekan device status...");

        // Lanjutkan job tanpa pengecekan status
        await this.processJobWithoutFonnteCheck();
        return;
      }

      // 1. Check Fonnte connectivity
      let fonnteStatus;
      try {
        fonnteStatus = await fonnteService.checkDeviceStatus();

        if (!fonnteStatus || fonnteStatus.error) {
          logger.error("❌ Fonnte service error:", fonnteStatus?.error);
          // Lanjutkan job tanpa fonnte (fallback mode)
          await this.runInFallbackMode();
          return;
        }

        logger.info(
          `✅ Fonnte status: ${fonnteStatus.connected ? "CONNECTED" : "DISCONNECTED"}`,
        );
      } catch (fonnteError) {
        logger.error("❌ Error checking Fonnte status:", fonnteError.message);
        // Lanjutkan job tanpa fonnte (fallback mode)
        await this.runInFallbackMode();
        return;
      }

      // 2. Tahap 1: Kirim invoice baru untuk yang butuh
      await this.sendNewInvoices();

      // 3. Tahap 2: Kirim reminder H-3 dan H-1
      for (const days of this.daysBefore) {
        await this.processDayReminders(days);
      }

      // 4. Tahap 3: Kirim reminder overdue
      await this.sendOverdueReminders();

      // 5. Process expired payments
      await this.processExpiredPayments();

      const duration = Date.now() - jobStartTime;
      logger.info(`✅ ===== JOB COMPLETED IN ${duration}ms =====`);
    } catch (error) {
      logger.error("❌ Critical job error:", error);
      logger.error("Stack trace:", error.stack);

      // Log error ke database untuk debugging
      try {
        await db.query(
          `INSERT INTO system_errors 
         (module, error_type, error_message, stack_trace, created_at) 
         VALUES ('customer_reminder', 'job_error', ?, ?, NOW())`,
          [error.message, error.stack?.substring(0, 2000)],
        );
      } catch (dbError) {
        logger.error("Failed to log error to database:", dbError);
      }
    } finally {
      this.isRunning = false;
    }
  }

  // ✅ FIX: Tambahkan method untuk fallback mode
  async runInFallbackMode() {
    logger.info("⚠️ Running job in FALLBACK MODE (without Fonnte)");

    try {
      // Lakukan proses yang tidak membutuhkan Fonnte
      await this.resetExpiredReminders();
      await this.resetReminderFlags();
      await this.autoDisableExpiredCustomers();

      logger.info("✅ Fallback mode completed");
    } catch (error) {
      logger.error("❌ Error in fallback mode:", error);
    }
  }

  // ✅ FIX: Tambahkan method tanpa fonnte check
  async processJobWithoutFonnteCheck() {
    logger.info("🔄 Processing job without Fonnte connectivity check");

    try {
      // Reset flags
      await this.resetExpiredReminders();
      await this.resetReminderFlags();

      // Proses expired customers
      await this.autoDisableExpiredCustomers();

      // Process expired payments (tanpa notifikasi)
      await this.processExpiredPaymentsWithoutNotification();

      logger.info("✅ Job processed without Fonnte");
    } catch (error) {
      logger.error("❌ Error in process without Fonnte:", error);
    }
  }

  async processExpiredPaymentsWithoutNotification() {
    try {
      logger.info("🕒 Checking for expired payments (without notification)...");

      // Ambil invoice yang expired
      const [expiredInvoices] = await db.query(
        `SELECT * FROM invoices 
       WHERE status = 'pending' 
       AND expires_at < NOW() 
       AND expires_at IS NOT NULL`,
      );

      // Update status tanpa kirim notifikasi
      for (const invoice of expiredInvoices) {
        await db.query(`UPDATE invoices SET status = 'expired' WHERE id = ?`, [
          invoice.id,
        ]);
      }

      logger.info(`✅ Updated ${expiredInvoices.length} expired invoices`);
    } catch (error) {
      logger.error("Error processing expired payments:", error);
    }
  }

  async saveNotificationLog(logData) {
    try {
      // Pastikan message ada sebelum substring
      const message = logData.message
        ? String(logData.message).substring(0, 500)
        : "";

      await db.execute(
        `INSERT INTO notification_logs 
       (customer_id, invoice_id, phone, message_type, message, status, message_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          logData.customer_id || null,
          logData.invoice_id || null,
          logData.phone,
          logData.message_type,
          message,
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

  // ===== CORE PROCESSING =====

  /**
   * Tahap 1: Kirim invoice baru
   */
  async sendNewInvoices() {
    try {
      console.log("📨 ===== TAHAP 1: KIRIM INVOICE BARU =====");

      // Cari customer yang butuh invoice baru (7 hari sebelum expired)
      const [customers] = await db.query(`
        SELECT c.*, p.name as package_name, p.price as package_price
        FROM customers c
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE c.status = 'active'
        AND c.expired_at IS NOT NULL
        AND DATEDIFF(c.expired_at, CURDATE()) = 7
        AND NOT EXISTS (
          SELECT 1 FROM invoices i 
          WHERE i.customer_id = c.id 
          AND i.status = 'pending'
          AND i.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        )
        LIMIT 10
      `);

      console.log(
        `📊 Found ${customers.length} customers needing new invoices`,
      );

      for (const customer of customers) {
        try {
          await this.createInvoiceForCustomer(customer);
        } catch (error) {
          console.error(`❌ Error for ${customer.name}:`, error.message);
        }
      }
    } catch (error) {
      console.error("❌ Error in sendNewInvoices:", error);
    }
  }

  /**
   * Tahap 3: Kirim reminder overdue
   */
  async sendOverdueReminders() {
    try {
      console.log("⏰ ===== TAHAP 3: KIRIM REMINDER OVERDUE =====");

      // PERBAIKAN: Query tanpa menggunakan invoice_id di subquery
      const [invoices] = await db.query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.amount,
        i.due_date,
        i.status,
        i.payment_link,
        i.expires_at,
        i.customer_id,
        c.name as customer_name,
        c.phone,
        c.username_pppoe,
        c.package_id,
        p.name as package_name,
        p.price as package_price
      FROM invoices i
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN packages p ON c.package_id = p.id
      WHERE i.status = 'pending'
      AND i.due_date < CURDATE()
      AND c.phone IS NOT NULL
      AND c.phone != ''
      AND NOT EXISTS (
        SELECT 1 FROM notification_logs nl
        WHERE nl.customer_id = i.customer_id
        AND nl.message_type = 'overdue_reminder'
        AND DATE(nl.created_at) = CURDATE()
      )
      LIMIT 10
    `);

      console.log(`📊 Found ${invoices.length} overdue invoices`);

      for (const invoice of invoices) {
        try {
          const customerData = {
            id: invoice.customer_id,
            name: invoice.customer_name,
            phone: invoice.phone,
            email: invoice.email || "",
            username_pppoe: invoice.username_pppoe || "",
            package_id: invoice.package_id,
            package_name: invoice.package_name,
            package_price: invoice.package_price,
          };

          const packageInfo = {
            name: invoice.package_name,
            price: invoice.package_price,
          };

          console.log(
            `📤 Sending overdue reminder for ${invoice.invoice_number}`,
          );

          // Kirim reminder
          const sendResult = await fonnteService.sendPaymentReminder(
            customerData,
            invoice,
            packageInfo,
          );

          // Log pengiriman - TANPA invoice_id
          await this.saveNotificationLog({
            customer_id: invoice.customer_id,
            phone: customerData.phone,
            message_type: "overdue_reminder",
            message: `Overdue reminder for invoice ${invoice.invoice_number} (${invoice.amount})`,
            status: sendResult.success ? "sent" : "failed",
            message_id: sendResult.messageId,
            error_message: sendResult.error,
          });

          console.log(`✅ Overdue reminder sent for ${invoice.invoice_number}`);
        } catch (error) {
          console.error(
            `❌ Error for invoice ${invoice.invoice_number}:`,
            error.message,
          );

          // Log error - TANPA invoice_id
          await this.saveNotificationLog({
            customer_id: invoice.customer_id,
            phone: invoice.phone,
            message_type: "overdue_reminder",
            message: `Failed to send overdue reminder: ${error.message}`,
            status: "failed",
            error_message: error.message,
          });
        }
      }
    } catch (error) {
      console.error("❌ Error in sendOverdueReminders:", error);
    }
  }

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
      if (!customer.phone || customer.phone.trim() === "") {
        return { status: "skipped", reason: "no_phone" };
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
        `[${requestId}] Invoice payment link: ${invoice.payment_link || "NO LINK"}`,
      );

      // 4. Get package info
      const [packageRows] = await db.query(
        "SELECT * FROM packages WHERE id = ?",
        [customer.package_id],
      );

      const packageInfo = packageRows[0] || {
        name: customer.package_name || "Paket Internet",
        price: customer.package_price || "0",
      };

      // 5. Prepare customer data
      const customerData = {
        id: customer.id,
        name: customer.name,
        phone: phoneNumber,
        email: customer.email || "",
        username_pppoe: customer.username_pppoe || "",
        admin_id: customer.admin_id || 3,
      };

      // 6. Kirim pesan reminder (INI SATU-SATUNYA PENGIRIMAN)
      console.log(`[${requestId}] Sending payment reminder...`);

      const sendResult = await fonnteService.sendPaymentReminder(
        customerData,
        invoice,
        packageInfo,
      );

      // 7. Update customer reminder status jika berhasil
      if (sendResult.success) {
        console.log(
          `[${requestId}] ✅ WhatsApp sent successfully to ${customer.name}`,
        );

        // Update reminder status
        await db.query(
          `UPDATE customers SET reminder_sent = 1, last_reminder_date = NOW() WHERE id = ?`,
          [customer.id],
        );

        // Log pengiriman
        await this.saveNotificationLog({
          customer_id: customer.id,
          invoice_id: invoice.id,
          phone: phoneNumber,
          message_type: `reminder_${daysBefore}day`,
          message: "Payment reminder sent",
          status: "sent",
          message_id: sendResult.messageId,
        });

        return {
          status: "success",
          invoiceId: invoice.id,
          messageId: sendResult.messageId,
        };
      } else {
        console.error(`[${requestId}] ❌ WhatsApp failed: ${sendResult.error}`);

        // Log error
        await this.saveNotificationLog({
          customer_id: customer.id,
          invoice_id: invoice.id,
          phone: phoneNumber,
          message_type: `reminder_${daysBefore}day`,
          message: "Payment reminder failed",
          status: "failed",
          error_message: sendResult.error,
        });

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

  createSimpleReminderMessage(customer, invoice) {
    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    return `Halo ${customer.name},

Masa aktif paket internet Anda akan berakhir dalam beberapa hari.

Detail:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name}
• Harga: ${formattedAmount}
• Due Date: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}

Silakan lakukan pembayaran melalui transfer bank.

Terima kasih`;
  }

  async saveNotificationLog(logData) {
    try {
      // Pastikan message ada sebelum substring
      const message = logData.message
        ? String(logData.message).substring(0, 500)
        : "";

      // Sesuaikan dengan struktur tabel yang ada
      // Tabel memiliki: customer_id, subscription_id, phone, message_type, message, status, message_id, response_data, error_message
      await db.execute(
        `INSERT INTO notification_logs 
       (customer_id, phone, message_type, message, status, message_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          logData.customer_id || null,
          logData.phone,
          logData.message_type,
          message,
          logData.status,
          logData.message_id || null,
          logData.error_message || null,
        ],
      );
      return true;
    } catch (error) {
      console.error("❌ Error saving notification log:", error);

      // Fallback: coba dengan lebih sedikit kolom
      try {
        await db.execute(
          `INSERT INTO notification_logs 
         (customer_id, phone, message_type, status, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
          [
            logData.customer_id || null,
            logData.phone,
            logData.message_type,
            logData.status || "failed",
          ],
        );
        console.warn("⚠️ Saved log with minimal data");
        return true;
      } catch (fallbackError) {
        console.error("❌ Even fallback save failed:", fallbackError);
        return false;
      }
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

      let invoice;

      if (existingInvoices.length > 0) {
        invoice = existingInvoices[0];
        console.log(
          `[${requestId}] Menggunakan invoice yang sudah ada: ${invoice.invoice_number}`,
        );

        // Generate payment link jika belum ada
        if (
          !invoice.payment_link ||
          invoice.payment_link === "" ||
          invoice.payment_link === null
        ) {
          console.log(
            `[${requestId}] ⚠️ Invoice has NO payment link! Generating...`,
          );

          try {
            const InvoiceService = require("../services/invoice.service");
            const paymentLinkResult =
              await InvoiceService.generatePaymentLinkForInvoice(invoice.id);
            invoice.payment_link = paymentLinkResult.payment_link;
            invoice.expires_at = paymentLinkResult.expires_at;

            console.log(
              `[${requestId}] ✅ Generated payment link: ${invoice.payment_link}`,
            );

            // Update database
            await db.query(
              `UPDATE invoices SET payment_link = ?, expires_at = ? WHERE id = ?`,
              [invoice.payment_link, invoice.expires_at, invoice.id],
            );
          } catch (generateError) {
            console.error(
              `[${requestId}] ❌ Failed to generate payment link:`,
              generateError,
            );
          }
        }
      } else {
        console.log(
          `[${requestId}] Membuat invoice baru untuk ${customer.name}`,
        );

        const invoiceData = {
          customer_id: customer.id,
          amount: customer.package_price || 0,
          description: `Pembayaran paket ${customer.package_name} - Reminder ${daysBefore} hari`,
          package_id: customer.package_id,
        };

        // Buat invoice baru dengan payment link
        const InvoiceService = require("../services/invoice.service");
        invoice = await InvoiceService.createManualInvoice(invoiceData);

        console.log(`[${requestId}] Invoice dibuat: ${invoice.invoice_number}`);
        console.log(
          `[${requestId}] Payment link: ${invoice.payment_link || "NO LINK"}`,
        );

        // KIRIM PESAN INVOICE BARU (Pesan ke-1)
        try {
          const fonnteService = require("../services/fonnte.service");

          const customerData = {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email || "",
            username_pppoe: customer.username_pppoe || "",
            admin_id: customer.admin_id || 3,
          };

          const packageInfo = {
            name: customer.package_name || "Paket Internet",
            price: customer.package_price || "0",
          };

          console.log(`[${requestId}] Sending new invoice notification...`);

          await fonnteService.sendInvoiceCreated(
            customerData,
            invoice,
            packageInfo,
          );

          console.log(`[${requestId}] ✅ New invoice notification sent`);
        } catch (invoiceError) {
          console.error(
            `[${requestId}] ❌ Failed to send new invoice notification:`,
            invoiceError.message,
          );
        }
      }

      return { success: true, invoice };
    } catch (error) {
      console.error(`[${requestId}] Error membuat invoice:`, error);
      return { success: false, error: error.message };
    }
  }

  // ===== MESSAGE CREATION =====

  // Modifikasi createPaymentLinkMessage untuk pakai settings
  createPaymentLinkMessage(data) {
    const { customer, invoice } = data;

    // TAMBAHKAN INI - Format amount
    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    const companyName =
      this.whatsappSettings?.companyName ||
      process.env.COMPANY_NAME ||
      "VnsNetwork";

    const companyPhone =
      this.whatsappSettings?.companyPhone ||
      process.env.COMPANY_PHONE ||
      "081234567890";

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
${companyName}
📞 ${companyPhone}`;
  }

  // Modifikasi createRegularReminderMessage juga
  createRegularReminderMessage(data) {
    const { customer, invoice } = data;

    // TAMBAHKAN INI - Format amount
    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    const companyName =
      this.whatsappSettings?.companyName ||
      process.env.COMPANY_NAME ||
      "Billing WiFi";

    const companyPhone =
      this.whatsappSettings?.companyPhone ||
      process.env.COMPANY_PHONE ||
      "081234567890";

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
${companyName}
📞 ${companyPhone}`;
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

  // Tambahkan method untuk restart job dengan settings baru
  async restartWithSettings(newSettings) {
    logger.info("🔄 Restarting job with new WhatsApp settings");

    // Stop job yang ada
    if (this.job) {
      this.job.stop();
    }

    // Update settings
    if (newSettings) {
      this.whatsappSettings = {
        ...this.whatsappSettings,
        ...newSettings,
      };

      // Update daysBefore jika ada
      if (newSettings.daysBefore && Array.isArray(newSettings.daysBefore)) {
        this.daysBefore = newSettings.daysBefore;
      }
    }

    // Start ulang job
    this.start();

    logger.info("✅ Job restarted with new settings");
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
