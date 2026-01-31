const axios = require("axios");
const logger = require("../utils/logger");
const db = require("../config/database");

class FonnteService {
  constructor() {
    this.apiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com";
    this.apiToken = process.env.FONNTE_API_TOKEN;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.settingsCache = new Map();
  }

  // ===== CORE FUNCTIONS =====

  // ✅ FIX: Tambahkan method yang hilang
  async checkDeviceStatus() {
    try {
      // Cache status untuk 1 menit
      if (
        this.deviceStatus &&
        this.lastChecked &&
        Date.now() - this.lastChecked < 60000
      ) {
        return this.deviceStatus;
      }

      const response = await axios.get(`${this.apiUrl}/device-status`, {
        headers: {
          Authorization: this.apiToken,
        },
        timeout: 5000,
      });

      this.deviceStatus = response.data;
      this.lastChecked = Date.now();

      logger.info("Fonnte device status checked", {
        status: this.deviceStatus,
      });
      return this.deviceStatus;
    } catch (error) {
      logger.error("Failed to check Fonnte device status", {
        error: error.message,
      });
      this.deviceStatus = { connected: false, error: error.message };
      return this.deviceStatus;
    }
  }

  /**
   * Send WhatsApp message with improved error handling and retry logic
   */
  async sendMessage(to, message, options = {}) {
    const startTime = Date.now();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      if (!this.apiToken) {
        logger.error(`[${requestId}] FONNTE_API_TOKEN tidak ditemukan`);
        return {
          success: false,
          error: "API token tidak dikonfigurasi",
          requestId,
        };
      }

      // Validate and normalize phone number
      const phoneNumber = this.normalizePhoneNumber(to);
      if (!phoneNumber) {
        return {
          success: false,
          error: "Format nomor telepon tidak valid",
          originalNumber: to,
          requestId,
        };
      }

      logger.info(`[${requestId}] 📤 Sending to: ${phoneNumber}`);

      // Prepare payload
      const payload = {
        target: phoneNumber,
        message: message,
        countryCode: "62",
        delay: options.delay || "2-5",
        customData: {
          requestId,
          timestamp: new Date().toISOString(),
          system: "vns-billing",
        },
      };

      // Add optional parameters
      if (options.url) payload.url = options.url;
      if (options.filename) payload.filename = options.filename;
      if (options.schedule) payload.schedule = options.schedule;

      // Send request with retry logic
      const response = await this.makeRequestWithRetry(requestId, payload);
      const duration = Date.now() - startTime;

      // Handle response
      const result = this.parseResponse(response.data, requestId);

      logger.info(
        `[${requestId}] ✅ Sent in ${duration}ms - Status: ${result.success ? "SUCCESS" : "FAILED"}`,
      );

      return {
        ...result,
        requestId,
        duration,
        phone: phoneNumber,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[${requestId}] ❌ Failed after ${duration}ms:`, {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      return {
        success: false,
        error: error.message,
        requestId,
        duration,
        statusCode: error.response?.status,
        response: error.response?.data,
      };
    }
  }

  /**
   * Make request with exponential backoff retry
   */
  async makeRequestWithRetry(requestId, payload, retry = 0) {
    try {
      const response = await axios({
        method: "post",
        url: `${this.apiUrl}/send`,
        data: payload,
        headers: {
          Authorization: this.apiToken,
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
        },
        timeout: 30000,
      });

      this.retryCount = 0;
      return response;
    } catch (error) {
      const retryableErrors = [
        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        429,
        502,
        503,
        504,
      ];

      const shouldRetry =
        retryableErrors.includes(error.code) ||
        retryableErrors.includes(error.response?.status);

      if (shouldRetry && retry < this.maxRetries) {
        const delay = Math.pow(2, retry) * 1000;
        logger.warn(
          `[${requestId}] Retry ${retry + 1}/${this.maxRetries} after ${delay}ms`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.makeRequestWithRetry(requestId, payload, retry + 1);
      }

      throw error;
    }
  }

  parseResponse(data, requestId) {
    if (data.status === true || data.status === "sent") {
      return {
        success: true,
        data: data,
        messageId: data.id || data.message_id || requestId,
        status: "sent",
      };
    } else if (data.status === "pending") {
      return {
        success: true,
        data: data,
        messageId: data.id || requestId,
        status: "pending",
      };
    } else if (data.error) {
      return {
        success: false,
        error: data.error,
        data: data,
        status: "failed",
      };
    } else {
      logger.warn(`[${requestId}] Unknown response format:`, data);
      return {
        success: false,
        error: "Unknown response format",
        data: data,
        status: "unknown",
      };
    }
  }

  /**
   * Parse Fonnte response
   */
  parseResponse(data, requestId) {
    // Handle various Fonnte response formats
    if (data.status === true || data.status === "sent") {
      return {
        success: true,
        data: data,
        messageId: data.id || data.message_id || requestId,
        status: "sent",
      };
    } else if (data.status === "pending") {
      return {
        success: true,
        data: data,
        messageId: data.id || requestId,
        status: "pending",
      };
    } else if (data.error) {
      return {
        success: false,
        error: data.error,
        data: data,
        status: "failed",
      };
    } else {
      logger.warn(`[${requestId}] Unknown response format:`, data);
      return {
        success: false,
        error: "Unknown response format",
        data: data,
        status: "unknown",
      };
    }
  }

  // ===== HELPER FUNCTIONS =====

  /**
   * Normalize phone number for Fonnte
   */
  normalizePhoneNumber(phone) {
    if (!phone) return null;

    let normalized = phone.toString().trim();
    normalized = normalized.replace(/\D/g, "");

    if (normalized.startsWith("0")) {
      normalized = normalized.substring(1);
    }

    if (normalized.startsWith("62")) {
      normalized = normalized.substring(2);
    }

    if (normalized.startsWith("+62")) {
      normalized = normalized.substring(3);
    }

    if (normalized.length < 9 || normalized.length > 13) {
      logger.warn(
        `Invalid phone length: ${normalized} (${normalized.length} digits)`,
      );
      return null;
    }

    const validPrefixes = [
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89",
    ];
    const prefix = normalized.substring(0, 2);

    if (!validPrefixes.includes(prefix)) {
      logger.warn(
        `Invalid Indonesian mobile prefix: ${prefix} for number ${normalized}`,
      );
    }

    return normalized;
  }

  /**
   * GET SETTINGS FROM DATABASE
   */
  async getWhatsAppSettings(adminId) {
    try {
      const cacheKey = `whatsapp_settings_${adminId}`;
      const cached = this.settingsCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < 300000) {
        // 5 minutes cache
        return cached.data;
      }

      const [settings] = await db.query(
        `SELECT settings_json FROM settings WHERE admin_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [adminId],
      );

      if (settings.length === 0) {
        return {
          enablePaymentLinks: false,
          companyName: "Billing WiFi",
          companyPhone: "",
          daysBefore: [3, 1],
        };
      }

      const settingsData =
        typeof settings[0].settings_json === "string"
          ? JSON.parse(settings[0].settings_json)
          : settings[0].settings_json;

      const whatsappSettings = settingsData.whatsapp || {};

      // DEBUG LOG
      logger.info(`[SETTINGS] Loaded WhatsApp settings for admin ${adminId}:`, {
        enablePaymentLinks: whatsappSettings.enablePaymentLinks,
        companyName: whatsappSettings.companyName,
        companyPhone: whatsappSettings.companyPhone,
      });

      this.settingsCache.set(cacheKey, {
        data: whatsappSettings,
        timestamp: Date.now(),
      });

      return whatsappSettings;
    } catch (error) {
      logger.error(
        `Error getting WhatsApp settings for admin ${adminId}:`,
        error,
      );
      return {
        enablePaymentLinks: false,
        companyName: "Billing WiFi",
        companyPhone: "",
        daysBefore: [3, 1],
      };
    }
  }

  /**
   * 1. PESAN PEMBUATAN INVOICE BARU
   */
  async sendInvoiceCreated(customer, invoice, packageInfo) {
    const message = this.createInvoiceCreatedMessage(
      customer,
      invoice,
      packageInfo,
    );

    console.log(
      `[INVOICE_CREATED] Sending to ${customer.name}, Invoice: ${invoice.invoice_number}`,
    );
    return await this.sendMessage(customer.phone, message, {
      delay: "2-5",
      customData: {
        type: "invoice_created",
        invoiceId: invoice.id,
        customerId: customer.id,
      },
    });
  }

  /**
   * 2. PESAN REMINDER JATUH TEMPO
   */
  async sendPaymentReminder(customer, invoice, packageInfo) {
    const message = this.createPaymentReminderMessage(
      customer,
      invoice,
      packageInfo,
    );

    console.log(
      `[PAYMENT_REMINDER] Sending to ${customer.name}, Invoice: ${invoice.invoice_number}`,
    );
    return await this.sendMessage(customer.phone, message, {
      delay: "2-5",
      customData: {
        type: "payment_reminder",
        invoiceId: invoice.id,
        customerId: customer.id,
        daysBefore: invoice.days_left || 1,
      },
    });
  }

  /**
   * 3. PESAN KONFIRMASI PEMBAYARAN
   */
  async sendPaymentConfirmation(customer, invoice, paymentInfo, packageInfo) {
    const message = this.createPaymentConfirmationMessage(
      customer,
      invoice,
      paymentInfo,
      packageInfo,
    );

    console.log(
      `[PAYMENT_CONFIRMATION] Sending to ${customer.name}, Invoice: ${invoice.invoice_number}`,
    );
    return await this.sendMessage(customer.phone, message, {
      delay: "2-5",
      customData: {
        type: "payment_confirmation",
        invoiceId: invoice.id,
        customerId: customer.id,
        paymentId: paymentInfo.id,
      },
    });
  }

  /**
   * Buat pesan invoice baru
   */
  createInvoiceCreatedMessage(customer, invoice, packageInfo) {
    const companyName = process.env.COMPANY_NAME || "VNS NETWORK";
    const companyAddress =
      process.env.COMPANY_ADDRESS || "Jl. Masjid Kedung panjang 4/5, 59154";
    const csWhatsapp = process.env.CS_WHATSAPP || "628895461944";
    const supportWhatsapp = process.env.SUPPORT_WHATSAPP || "6285724733627";

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    const dueDate = new Date(invoice.due_date).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    // Hitung periode
    const startDate = new Date(invoice.issue_date);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const period = `${startDate.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })} - ${endDate.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })}`;

    return `Salam ${customer.name}

Kami informasikan Invoice anda telah terbit dan dapat dibayarkan, berikut rinciannya :

ID Pelanggan: ${customer.id}${new Date().getFullYear()}${String(customer.id).padStart(4, "0")}
Nomor Invoice: ${invoice.invoice_number}
Amount: ${formattedAmount}
PPN: 0
Discount: 0
Total: ${formattedAmount}
Item: ${packageInfo.name || "Internet"} ${customer.username_pppoe || customer.email || ""} - ${packageInfo.name}
Jatuh tempo: ${dueDate}
Period: ${period}

Mohon segera lakukan pembayaran sebelum jatuh tempo, Agar Internet anda tidak terisolir

*Metode Pembayaran Otomatis*
Bank Virtual Account, OVO, DANA, LinkAja, ShopeePay, Alfamart, QRIS
Klik => ${invoice.payment_link}

Atau datang ke kantor di jam kerja Hari Senin - Sabtu jam 08:00 sampai 16:00 , Tanggal merah Libur

Untuk informasi lainnya silahkan hubungi nomor Whatsapp

https://wa.me/${csWhatsapp} untuk Customer Service
https://wa.me/${supportWhatsapp} untuk Support Gangguan


Salam Hormat
${companyName} By PT. MEGA DATA PERKASA 
connect your future
#juaranyawifi
${companyAddress}

_Ini adalah pesan otomatis - mohon untuk tidak membalas langsung ke pesan ini_

Terima kasih.`;
  }

  /**
   * Buat pesan reminder jatuh tempo
   */
  createPaymentReminderMessage(customer, invoice, packageInfo) {
    const companyName = process.env.COMPANY_NAME || "VNS NETWORK";
    const companyAddress =
      process.env.COMPANY_ADDRESS || "Jl. Masjid Kedung panjang 4/5, 59154";
    const csWhatsapp = process.env.CS_WHATSAPP || "628895461944";
    const supportWhatsapp = process.env.SUPPORT_WHATSAPP || "6285724733627";

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    return `Salam ${customer.name}

Kami informasikan tagihan anda senilai ${formattedAmount} belum di bayar, Mohon Segera lakukan pembayaran sebelum Account anda terisolir.
Abaikan pesan ini bila sudah membayar.

*Metode Pembayaran Otomatis*
Bank Virtual Account, OVO, DANA, LinkAja, ShopeePay, Alfamart, QRIS
Klik => ${invoice.payment_link}

Untuk informasi lainnya silahkan hubungi nomor Whatsapp

https://wa.me/${csWhatsapp} untuk Customer Service
https://wa.me/${supportWhatsapp} untuk Support Gangguan



Salam Hormat

${companyName} By PT. MEGA DATA PERKASA 
connect your future
#juaranyawifi
${companyAddress}

_Ini adalah pesan otomatis - mohon untuk tidak membalas langsung ke pesan ini_
Terima kasih.`;
  }

  /**
   * Buat pesan konfirmasi pembayaran
   */
  createPaymentConfirmationMessage(
    customer,
    invoice,
    paymentInfo,
    packageInfo,
  ) {
    const companyName = process.env.COMPANY_NAME || "VNS NETWORK";
    const companyAddress =
      process.env.COMPANY_ADDRESS || "Jl. Masjid Kedung panjang 4/5, 59154";
    const csWhatsapp = process.env.CS_WHATSAPP || "628895461944";
    const supportWhatsapp = process.env.SUPPORT_WHATSAPP || "6285724733627";

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    // Hitung periode baru
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const period = `${startDate.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })} - ${endDate.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })}`;

    return `Kepada Yth.  ${customer.name}

Terimakasih atas pembayaran Tagihan anda, berikut rinciannya :

ID Pelanggan: ${customer.id}${new Date().getFullYear()}${String(customer.id).padStart(4, "0")}
Nomor Invoice: ${invoice.invoice_number}
Total: ${formattedAmount}
Item: ${packageInfo.name || "Internet"} ${customer.username_pppoe || customer.email || ""} - ${packageInfo.name}
Period: ${period}
Status: Paid
Payment Method: ${paymentInfo.payment_method || "Bank Transfer"}

Untuk informasi lainnya silahkan hubungi nomor Whatsapp

https://wa.me/${csWhatsapp} untuk Customer Service
https://wa.me/${supportWhatsapp} untuk Support Gangguan


Salam Hormat
${companyName} By PT. MEGA DATA PERKASA 
connect your future
#juaranyawifi
${companyAddress}


_Ini adalah pesan otomatis - mohon untuk tidak membalas langsung ke pesan ini_`;
  }

  /**
   * Create payment link message
   */
  createPaymentLinkMessage(customer, invoice, whatsappSettings = {}) {
    const companyName =
      whatsappSettings.companyName ||
      process.env.COMPANY_NAME ||
      "Billing WiFi";
    const companyPhone =
      whatsappSettings.companyPhone || process.env.COMPANY_PHONE || "";

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    return `Salam ${customer.name} 👋

Kami informasikan Invoice anda telah terbit dan dapat segera dilakukan pembayaran, berikut rinciannya:

📋 Detail Invoice:
• ID Pelanggan: ${invoice.customer_id}
• Invoice Number: ${invoice.invoice_number}
• Harga: ${formattedAmount}
• PPN: 0%
• Discount: 0%
• Total Tagihan: ${formattedAmount}
• Item: Internet ${customer.package_name} - ${customer.package_name}
• Jatuh Tempo: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}
• Periode: ${new Date(invoice.period_start).toLocaleDateString("id-ID")} - ${new Date(
      invoice.period_end,
    ).toLocaleDateString("id-ID")}

    Mohon untuk melakukan pembayaran sebelum tanggal jatuh tempo agar layanan Anda tidak terisolir.

💳 Metode Pembayaran Otomatis:
👉 ${invoice.payment_link}

Atau datang ke kantor di jam kerja hari Senin - Sabtu jam 08:00 - 16:00 WIB. Tanggal merah libur.

Untuk informasi lainnya silahkan hubungi nomor WhatsApp berikut.

https://wa.me/628895461944
Untuk Customer Service kami.
https://wa.me/628895461944
Untuk Support Gangguan

Salam hormat,
VNS NETWORK By PT. MEGA DATA PERKASA
connect your future
#juaranyawifi
Jl. Masjid Kedung Panjang 4/5, 59154

Terima kasih 🙏


Ini adalah pesan otomatis, harap tidak membalas pesan ini.
${companyName}${companyPhone ? `\n📞 ${companyPhone}` : ""}`;
  }

  /**
   * Create regular reminder message WITHOUT payment link
   */
  createRegularReminderMessage(customer, invoice, whatsappSettings = {}) {
    const companyName =
      whatsappSettings.companyName ||
      process.env.COMPANY_NAME ||
      "Billing WiFi";
    const companyPhone =
      whatsappSettings.companyPhone || process.env.COMPANY_PHONE || "";

    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(invoice.amount || 0);

    return `Salam ${customer.name} 👋

Kami informasikan Invoice anda telah terbit dan dapat segera dilakukan pembayaran, berikut rinciannya:

📋 Detail Invoice:
• ID Pelanggan: ${invoice.customer_id}
• Invoice Number: ${invoice.invoice_number}
• Harga: ${formattedAmount}
• PPN: 0%
• Discount: 0%
• Total Tagihan: ${formattedAmount}
• Item: Internet ${customer.package_name} - ${customer.package_name}
• Jatuh Tempo: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}
• Periode: ${new Date(invoice.period_start).toLocaleDateString("id-ID")} - ${new Date(
      invoice.period_end,
    ).toLocaleDateString("id-ID")}

    Mohon untuk melakukan pembayaran sebelum tanggal jatuh tempo agar layanan Anda tidak terisolir.

💳 Metode Pembayaran:
Mohon Maaf , Untuk saat ini metode pembayaran otomatis belum tersedia.
Silakan datang ke kantor di jam kerja hari Senin - Sabtu jam 08:00 - 16:00 WIB. Tanggal merah libur.

Untuk informasi lainnya silahkan hubungi nomor WhatsApp berikut.

https://wa.me/628895461944
Untuk Customer Service kami.
https://wa.me/628895461944
Untuk Support Gangguan

Salam hormat,
VNS NETWORK By PT. MEGA DATA PERKASA
connect your future
#juaranyawifi
Jl. Masjid Kedung Panjang 4/5, 59154

Terima kasih 🙏


Ini adalah pesan otomatis, harap tidak membalas pesan ini.
${companyName}${companyPhone ? `\n📞 ${companyPhone}` : ""}`;
  }

  /**
   * Send payment success notification
   */
  async sendPaymentSuccess(customer, invoice) {
    const message = `✅ PEMBAYARAN BERHASIL

Halo ${customer.name},

Terima kasih, pembayaran Anda telah kami terima.

📋 Detail:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name || "Internet"}
• Jumlah: Rp ${Number(invoice.amount || 0).toLocaleString("id-ID")}
• Status: ✅ LUNAS

Layanan internet Anda telah aktif kembali 🙏

${process.env.COMPANY_NAME || "VnsNetwork"}
📞 ${process.env.COMPANY_PHONE || "081234567890"}`;

    return await this.sendMessage(customer.phone, message, {
      delay: "1-3",
      customData: { type: "payment_success" },
    });
  }

  /**
   * Send payment failed notification
   */
  async sendPaymentFailed(customer, invoice) {
    const message = `❌ PEMBAYARAN GAGAL

Halo ${customer.name},

Pembayaran untuk invoice ${invoice.invoice_number} belum berhasil.

Silakan coba lagi melalui link:
👉 ${invoice.payment_link}

Atau hubungi admin kami untuk bantuan.

${process.env.COMPANY_NAME || "VnsNetwork"}
📞 ${process.env.COMPANY_PHONE || "081234567890"}`;

    return await this.sendMessage(customer.phone, message, {
      delay: "1-3",
      customData: { type: "payment_failed" },
    });
  }

  // ===== DEVICE & HEALTH CHECKS =====

  /**
   * Check device status with improved error handling
   */
  async checkDeviceStatus() {
    const checkId = `check_${Date.now()}`;

    try {
      logger.info(`[${checkId}] 🔍 Checking Fonnte device status...`);

      // Try multiple possible endpoints
      const endpoints = [
        { method: "get", url: `${this.apiUrl}/device`, name: "device" },
        { method: "post", url: `${this.apiUrl}/device`, name: "device_post" },
        {
          method: "get",
          url: `${this.apiUrl}/device-info`,
          name: "device_info",
        },
        {
          method: "post",
          url: `${this.apiUrl}/device-info`,
          name: "device_info_post",
        },
        { method: "get", url: `${this.apiUrl}/status`, name: "status" },
        { method: "get", url: `${this.apiUrl}/me`, name: "me" },
      ];

      for (const endpoint of endpoints) {
        try {
          const response = await axios({
            method: endpoint.method,
            url: endpoint.url,
            headers: {
              Authorization: this.apiToken,
              "User-Agent": "VnsBilling/1.0",
              "X-Check-ID": checkId,
            },
            timeout: 8000,
          });

          const data = response.data;

          // Check common response patterns
          if (data.status === true || data.device_status === "connect") {
            return {
              success: true,
              endpoint: endpoint.name,
              connected: true,
              data: data,
              quota: data.quota,
              expired: data.expired,
              package: data.package,
              device: data.device,
            };
          }

          if (data.success !== false) {
            return {
              success: true,
              endpoint: endpoint.name,
              connected: true,
              data: data,
            };
          }
        } catch (err) {
          // Continue to next endpoint
          continue;
        }
      }

      // If all endpoints failed, try test message
      return await this.testWithMessage(checkId);
    } catch (error) {
      logger.error(`[${checkId}] ❌ Device check failed:`, error.message);

      return {
        success: false,
        error: error.message,
        checkId,
        statusCode: error.response?.status,
        suggestion: "Check API token and internet connection",
      };
    }
  }

  /**
   * Test API by sending a test message
   */
  async testWithMessage(checkId) {
    try {
      const testNumber = process.env.TEST_PHONE_NUMBER || "81325974890";
      const testMessage = `Test connection from VNS Billing - ${checkId}`;

      logger.info(`[${checkId}] 🔄 Testing via test message...`);

      const result = await this.sendMessage(testNumber, testMessage, {
        delay: "0",
        customData: { test: true, checkId },
      });

      return {
        success: result.success,
        alternativeCheck: true,
        message: result.success
          ? "API is responding (test message accepted)"
          : "API may have issues",
        sendResult: result,
      };
    } catch (error) {
      return {
        success: false,
        error: `Test message failed: ${error.message}`,
        alternativeCheck: true,
      };
    }
  }

  /**
   * Get delivery status of a message
   */
  async getMessageStatus(messageId) {
    try {
      const response = await axios({
        method: "post",
        url: `${this.apiUrl}/status`,
        data: { id: messageId },
        headers: {
          Authorization: this.apiToken,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      return {
        success: true,
        data: response.data,
        status: response.data.status || "unknown",
      };
    } catch (error) {
      logger.error("Get message status error:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Bulk send messages with rate limiting
   */
  async sendBulkMessages(messages, options = {}) {
    const results = [];
    const batchSize = options.batchSize || 10;
    const delayBetweenBatches = options.delayBetweenBatches || 2000;

    logger.info(
      `📦 Sending ${messages.length} messages in batches of ${batchSize}`,
    );

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      logger.info(
        `📤 Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} messages`,
      );

      const batchPromises = batch.map(async (msg, index) => {
        // Stagger sends within batch
        await new Promise((resolve) => setTimeout(resolve, index * 100));
        return this.sendMessage(msg.to, msg.message, msg.options);
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Delay between batches
      if (i + batchSize < messages.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenBatches),
        );
      }
    }

    return {
      total: results.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}

// Export singleton instance
const fonnteService = new FonnteService();
module.exports = fonnteService;
