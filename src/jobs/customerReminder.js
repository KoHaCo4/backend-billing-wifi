const cron = require("node-cron");
const Customer = require("../models/Customer");
const NotificationLog = require("../models/NotificationLog");
const fonnteService = require("../services/fonnte.service");
const logger = require("../utils/logger");
const PhoneUtils = require("../utils/phoneutils");

class CustomerReminderJob {
  constructor() {
    this.job = null;
    this.isRunning = false;
    this.daysBefore = [3, 1];
    this.startTime = null;
  }

  start() {
    try {
      // Untuk DEVELOPMENT: jalankan setiap 5 menit
      // Untuk PRODUCTION: ganti dengan '0 9 * * *' (setiap hari jam 09:00)
      const schedule =
        process.env.NODE_ENV === "production" ? "0 9 * * *" : "*/5 * * * *";

      logger.info(
        `⏰ Scheduling customer reminder job: ${schedule} (${process.env.NODE_ENV})`,
      );

      this.job = cron.schedule(
        schedule,
        async () => {
          logger.info("🚀 ===== MEMULAI JOB REMINDER PELANGGAN =====");
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
      logger.info(`⏰ Next runs: ${schedule} (Timezone: Asia/Jakarta)`);

      // Hitung waktu berikutnya
      try {
        const cronParser = require("cron-parser");
        const interval = cronParser.parseExpression(schedule, {
          tz: "Asia/Jakarta",
          currentDate: new Date(),
        });

        const nextRun = interval.next().toDate();
        logger.info(
          `⏰ Next scheduled run: ${nextRun.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
        );

        const secondNextRun = interval.next().toDate();
        logger.info(
          `⏰ Following run: ${secondNextRun.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
        );
      } catch (error) {
        logger.warn("Could not calculate next run times:", error.message);
      }

      // Jalankan sekali saat startup untuk debugging
      setTimeout(() => {
        logger.info("🔍 Running initial debug check...");
        this.debugCustomers();
      }, 3000);
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

  async run() {
    if (this.isRunning) {
      logger.warn("⚠️ Job sudah berjalan, skip...");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info("🔍 ===== PHASE 1: RESET REMINDER FLAGS =====");
      const resetCount = await Customer.resetReminderFlags();
      logger.info(`✅ Reset ${resetCount} reminder flags`);

      logger.info(
        "🔍 ===== PHASE 2: MENCARI PELANGGAN YANG AKAN EXPIRED =====",
      );

      // Kirim reminder untuk setiap hari yang dikonfigurasi
      for (const days of this.daysBefore) {
        await this.sendRemindersForDays(days);
      }

      const duration = Date.now() - startTime;
      logger.info(`✅ ===== JOB SELESAI ===== (${duration}ms)`);
    } catch (error) {
      logger.error("❌ Error dalam job reminder:", error.stack);
    } finally {
      this.isRunning = false;
    }
  }

  async sendRemindersForDays(daysBefore) {
    try {
      logger.info(
        `📨 ===== MENGIRIM REMINDER ${daysBefore} HARI SEBELUM EXPIRED =====`,
      );

      // Cari pelanggan yang akan expired dalam X hari
      const customers = await Customer.findExpiringInDays(daysBefore);

      logger.info(
        `📊 Ditemukan ${customers.length} pelanggan untuk reminder ${daysBefore} hari`,
      );

      if (customers.length === 0) {
        logger.info("ℹ️ Tidak ada pelanggan yang perlu dikirim reminder");
        return;
      }

      // Kirim notifikasi untuk setiap pelanggan
      let successCount = 0;
      let failCount = 0;

      for (const customer of customers) {
        const result = await this.sendReminder(customer, daysBefore);

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }

        // Delay 3 detik antar pengiriman untuk menghindari rate limit
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      logger.info(`📈 HASIL: ${successCount} berhasil, ${failCount} gagal`);
    } catch (error) {
      logger.error(
        `❌ Error sending reminders for ${daysBefore} days:`,
        error.stack,
      );
    }
  }

  async sendReminder(customer, daysBefore) {
    let logId = null;

    try {
      // Validasi nomor telepon
      if (!customer.phone || customer.phone.trim() === "") {
        logger.warn(`⚠️ ${customer.name} tidak memiliki nomor WhatsApp`);
        return { success: false, error: "No phone number" };
      }

      // Normalize phone number menggunakan PhoneUtils
      const phoneNumber = PhoneUtils.normalizeToFonnte(customer.phone);

      if (!phoneNumber) {
        logger.error(`❌ Tidak bisa menormalisasi nomor: ${customer.phone}`);
        return {
          success: false,
          error: "Invalid phone number format",
          details:
            "Format nomor tidak dikenali. Harap periksa format: 081234567890, 81234567890, +6281234567890",
        };
      }

      logger.info(
        `✅ Nomor ${customer.phone} -> ${phoneNumber} (Fonnte format)`,
      );
      // Format data pelanggan
      const customerData = {
        name: customer.name || "Pelanggan",
        phone: phoneNumber,
        expiry_date: this.formatDate(customer.expired_at),
        package_name: customer.package_name || "Paket Internet",
        package_price: customer.package_price
          ? `Rp ${Number(customer.package_price).toLocaleString("id-ID")}`
          : "Rp 0",
        days_left: daysBefore,
      };

      // Buat pesan reminder
      const message = this.createReminderMessage(customerData, daysBefore);

      logger.info(
        `📤 Mengirim ke: ${customerData.name} (${customerData.phone})`,
      );
      logger.info(`📅 Expired: ${customerData.expiry_date}`);

      // Simpan log notifikasi
      logId = await NotificationLog.create({
        customer_id: customer.id,
        phone: customerData.phone,
        message_type: `reminder_${daysBefore}day`,
        message: message,
        status: "queued",
      });

      // Kirim via Fonnte
      const result = await fonnteService.sendMessage(
        customerData.phone,
        message,
        {
          delay: "2-5",
        },
      );

      // Update log berdasarkan hasil
      if (result.success) {
        await NotificationLog.updateStatus(logId, "sent", {
          message_id: result.messageId || result.data?.id?.[0],
          response_data: result.data,
        });

        await Customer.markReminderSent(customer.id);

        logger.info(
          `✅ BERHASIL: ${customerData.name} - Message ID: ${result.messageId}`,
        );
        return { success: true, data: result };
      } else {
        await NotificationLog.updateStatus(logId, "failed", {
          error_message: result.error,
          response_data: result.response,
        });

        logger.error(`❌ GAGAL: ${customerData.name} - ${result.error}`);
        return { success: false, error: result.error };
      }
    } catch (error) {
      logger.error(`🔥 ERROR: ${customer.name} - ${error.message}`);
      logger.error(`🔥 STACK: ${error.stack}`);

      if (logId) {
        await NotificationLog.updateStatus(logId, "failed", {
          error_message: error.message,
        });
      }

      return { success: false, error: error.message };
    }
  }

  createReminderMessage(customerData, daysBefore) {
    const daysText = daysBefore === 1 ? "1 hari" : `${daysBefore} hari`;

    return `Halo ${customerData.name},

Masa aktif paket internet Anda akan berakhir dalam ${daysText} (${customerData.expiry_date}).

Segera lakukan pembayaran untuk menghindari pemutusan layanan.

📋 Detail Paket:
• Paket: ${customerData.package_name}
• Harga: ${customerData.package_price}
• Expired: ${customerData.expiry_date}

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

  formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      return new Date().toLocaleDateString("id-ID");
    }
  }

  // Manual trigger untuk testing
  async triggerManual(options = {}) {
    const { phone, days = 1, testData = null } = options;

    if (phone) {
      // Test untuk nomor tertentu
      const testCustomer = testData || {
        id: 999,
        name: "Test Pelanggan",
        phone: phone,
        expired_at: new Date(Date.now() + days * 86400000)
          .toISOString()
          .split("T")[0],
        package_name: "Paket Internet Premium 100 Mbps",
        package_price: "350000",
        days_left: days,
      };

      const message = this.createReminderMessage(
        {
          name: testCustomer.name,
          phone: testCustomer.phone,
          expiry_date: this.formatDate(testCustomer.expired_at),
          package_name: testCustomer.package_name,
          package_price: `Rp ${Number(testCustomer.package_price).toLocaleString("id-ID")}`,
          days_left: days,
        },
        days,
      );

      logger.info(`📤 Manual test ke ${phone}`);

      const result = await fonnteService.sendMessage(phone, message);
      return result;
    } else {
      // Jalankan job biasa
      return await this.run();
    }
  }

  // Cek pelanggan yang akan expired
  async getExpiringCustomers() {
    try {
      const expiringTomorrow = await Customer.findExpiringInDays(1);
      const expiringIn3Days = await Customer.findExpiringInDays(3);

      return {
        tomorrow: expiringTomorrow,
        in_3_days: expiringIn3Days,
        total_tomorrow: expiringTomorrow.length,
        total_3_days: expiringIn3Days.length,
      };
    } catch (error) {
      logger.error("Error getting expiring customers:", error);
      return {
        tomorrow: [],
        in_3_days: [],
        total_tomorrow: 0,
        total_3_days: 0,
      };
    }
  }

  // Debug method
  async debugCustomers() {
    try {
      logger.info("🔍 Debugging customer data...");

      // 1. Cek data pelanggan aktif
      const activeCustomers = await Customer.getAllActiveWithPhone();
      logger.info(
        `📊 Total pelanggan aktif dengan nomor: ${activeCustomers.length}`,
      );

      // 2. Cek yang akan expired besok
      const expiringTomorrow = await Customer.findExpiringInDays(1);
      logger.info(`📊 Yang akan expired besok: ${expiringTomorrow.length}`);

      // 3. Cek yang akan expired dalam 3 hari
      const expiringIn3Days = await Customer.findExpiringInDays(3);
      logger.info(
        `📊 Yang akan expired dalam 3 hari: ${expiringIn3Days.length}`,
      );

      // 4. Tampilkan sample data
      if (activeCustomers.length > 0) {
        logger.info("📋 Sample data pelanggan:");
        activeCustomers.slice(0, 3).forEach((cust, idx) => {
          logger.info(
            `${idx + 1}. ${cust.name} - ${cust.phone} - Expired: ${cust.expired_at} - Days left: ${cust.days_remaining}`,
          );
        });
      }

      return {
        total_active: activeCustomers.length,
        expiring_tomorrow: expiringTomorrow.length,
        expiring_3_days: expiringIn3Days.length,
      };
    } catch (error) {
      logger.error("Debug error:", error);
      return { error: error.message };
    }
  }
}

module.exports = new CustomerReminderJob();
