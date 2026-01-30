// const axios = require("axios");
// const logger = require("../utils/logger");

// class FonnteService {
//   constructor() {
//     this.apiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com";
//     this.apiToken = process.env.FONNTE_API_TOKEN;
//   }

//   async sendMessage(to, message, options = {}) {
//     try {
//       if (!this.apiToken) {
//         logger.error("FONNTE_API_TOKEN tidak ditemukan");
//         return {
//           success: false,
//           error: "API token tidak dikonfigurasi",
//         };
//       }

//       // Format nomor telepon - HILANGKAN SEMUA FORMATTING
//       let phoneNumber = to.toString().trim();

//       // Hilangkan semua karakter non-digit
//       phoneNumber = phoneNumber.replace(/\D/g, "");

//       // Jika dimulai dengan 0, hapus
//       if (phoneNumber.startsWith("0")) {
//         phoneNumber = phoneNumber.substring(1);
//       }

//       // Jika dimulai dengan 62, hapus
//       if (phoneNumber.startsWith("62")) {
//         phoneNumber = phoneNumber.substring(2);
//       }

//       // Jika dimulai dengan +62, hapus
//       if (phoneNumber.startsWith("+62")) {
//         phoneNumber = phoneNumber.substring(3);
//       }

//       logger.info(`Mengirim ke: ${phoneNumber}`);

//       // Format payload sesuai dokumentasi Fonnte
//       const payload = {
//         target: phoneNumber, // Hanya angka, tanpa kode negara
//         message: message,
//         delay: "1-5", // Format delay yang benar
//         countryCode: "62", // Selalu tambahkan countryCode
//       };

//       // Tambahkan options lainnya jika ada
//       if (options.url) payload.url = options.url;
//       if (options.filename) payload.filename = options.filename;
//       if (options.schedule) payload.schedule = options.schedule;

//       logger.info("Payload:", JSON.stringify(payload));

//       const response = await axios({
//         method: "post",
//         url: `${this.apiUrl}/send`,
//         data: payload,
//         headers: {
//           Authorization: this.apiToken,
//           "Content-Type": "application/json",
//         },
//         timeout: 30000,
//       });

//       logger.info("Response Fonnte:", JSON.stringify(response.data));

//       // Cek berbagai format response yang mungkin
//       if (
//         response.data.status === true ||
//         response.data.status === "sent" ||
//         response.data.message_id
//       ) {
//         return {
//           success: true,
//           data: response.data,
//           messageId: response.data.message_id,
//         };
//       } else {
//         return {
//           success: false,
//           error: response.data.reason || "Unknown error",
//           data: response.data,
//         };
//       }
//     } catch (error) {
//       logger.error("Fonnte API Error:", {
//         message: error.message,
//         response: error.response?.data,
//         status: error.response?.status,
//         config: {
//           url: error.config?.url,
//           method: error.config?.method,
//           data: error.config?.data,
//         },
//       });

//       return {
//         success: false,
//         error: error.message,
//         response: error.response?.data,
//         statusCode: error.response?.status,
//       };
//     }
//   }

//   async sendSubscriptionReminder(customer) {
//     const message = `Halo ${customer.name},

// Masa aktif paket internet Anda akan berakhir dalam 1 hari (${customer.expiry_date}).

// Segera lakukan pembayaran untuk menghindari pemutusan layanan.

// Detail Paket:
// - Paket: ${customer.package_name}
// - Harga: ${customer.package_price}
// - Expired: ${customer.expiry_date}

// Terima kasih,
// ${process.env.COMPANY_NAME || "Billing WiFi"}`;

//     return await this.sendMessage(customer.phone, message, {
//       delay: "2-10", // Random delay 2-10 detik
//     });
//   }

//   async checkDeviceStatus() {
//     try {
//       if (!this.apiToken) {
//         return {
//           success: false,
//           error: "API token tidak ditemukan",
//         };
//       }

//       logger.info("🔍 Checking Fonnte device status...");

//       // Coba beberapa endpoint yang mungkin
//       const endpoints = [
//         { method: "get", url: `${this.apiUrl}/device` },
//         { method: "post", url: `${this.apiUrl}/device` },
//         { method: "get", url: `${this.apiUrl}/device-info` },
//         { method: "post", url: `${this.apiUrl}/device-info` },
//         { method: "get", url: `${this.apiUrl}/status` },
//       ];

//       let lastError = null;

//       for (const endpoint of endpoints) {
//         try {
//           logger.debug(
//             `Trying ${endpoint.method.toUpperCase()} ${endpoint.url}`,
//           );

//           const response = await axios({
//             method: endpoint.method,
//             url: endpoint.url,
//             headers: {
//               Authorization: this.apiToken,
//               "User-Agent": "BillingWifi-System/1.0",
//             },
//             timeout: 10000,
//           });

//           logger.info("✅ Device status response:", response.data);

//           // Cek response format yang umum
//           const data = response.data;

//           // Format 1: { device: {...}, status: 'connected' }
//           if (data.device_status === "connect" || data.status === true) {
//             return {
//               success: true,
//               data: data,
//               device: data.device,
//               status: data.device_status || data.status,
//               connected: true, // Set ke true karena device_status = 'connect'
//               quota: data.quota,
//               expired: data.expired,
//               package: data.package,
//             };
//           }

//           // Format 2: { success: true, data: {...} }
//           if (data.success !== false) {
//             return {
//               success: true,
//               data: data,
//             };
//           }
//         } catch (err) {
//           lastError = err;
//           logger.debug(`Endpoint ${endpoint.url} failed: ${err.message}`);
//           // Continue ke endpoint berikutnya
//         }
//       }

//       // Jika semua endpoint gagal
//       if (lastError) {
//         throw lastError;
//       }

//       return {
//         success: false,
//         error: "No valid endpoint found",
//         suggestion:
//           "Check Fonnte API documentation for correct device status endpoint",
//       };
//     } catch (error) {
//       logger.error("❌ Device Status Error:", {
//         message: error.message,
//         status: error.response?.status,
//         data: error.response?.data,
//       });

//       // Berdasarkan error 405, mungkin endpoint berbeda
//       // Coba alternative approach: test dengan send message kecil
//       try {
//         logger.info("🔄 Trying alternative device check via test message...");

//         // Kirim test message ke nomor dummy
//         const testResult = await this.sendMessage("000000000000", "test");

//         return {
//           success: testResult.success,
//           alternativeCheck: true,
//           message: testResult.success
//             ? "API is working (test message accepted)"
//             : "API may have issues",
//           sendStatus: testResult.status,
//           error: testResult.error,
//         };
//       } catch (sendError) {
//         return {
//           success: false,
//           error: `Device check failed: ${error.message}`,
//           alternativeCheckError: sendError.message,
//           statusCode: error.response?.status,
//         };
//       }
//     }
//   }

//   // Test endpoint langsung
//   async testDirect() {
//     try {
//       // Cek dulu apakah token valid
//       const deviceCheck = await this.checkDeviceStatus();

//       if (!deviceCheck.success) {
//         return deviceCheck;
//       }

//       // Test send dengan nomor khusus (gunakan nomor admin)
//       const testNumber = process.env.TEST_PHONE_NUMBER || "81325974890";
//       const testMessage =
//         "Test dari Billing WiFi - " + new Date().toLocaleString("id-ID");

//       logger.info(`Testing direct send to: ${testNumber}`);

//       return await this.sendMessage(testNumber, testMessage);
//     } catch (error) {
//       logger.error("Direct test error:", error);
//       return {
//         success: false,
//         error: error.message,
//       };
//     }
//   }
// }

// module.exports = new FonnteService();

const axios = require("axios");
const logger = require("../utils/logger");
const customerReminder = require("../jobs/customerReminder");
const settingsController = require("../controllers/settings.controller");

class FonnteService {
  constructor() {
    this.apiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com";
    this.apiToken = process.env.FONNTE_API_TOKEN;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.settingsCache = new Map();
  }

  // ===== CORE FUNCTIONS =====

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
   * Send payment reminder with payment link
   */
  async sendPaymentReminder(customerData, invoiceData) {
    logger.info(
      `[PAYMENT_REMINDER] Starting for customer: ${customerData.name || customerData.customer?.name}`,
    );

    // Debug customer data
    logger.info(`[PAYMENT_REMINDER] Customer data:`, {
      name: customerData.name || customerData.customer?.name,
      adminId: customerData.admin_id || customerData.customer?.admin_id,
      phone: customerData.phone || customerData.customer?.phone,
    });

    const message = await this.createPaymentReminderMessage(
      customerData,
      invoiceData,
    );

    // Debug message content
    const hasPaymentLink =
      message.includes("payment_link") ||
      message.includes("http://") ||
      message.includes("https://");
    logger.info(
      `[PAYMENT_REMINDER] Message contains payment link: ${hasPaymentLink}`,
    );

    if (hasPaymentLink) {
      logger.info(
        `[PAYMENT_REMINDER] WARNING: Message STILL contains payment link!`,
      );
      logger.info(
        `[PAYMENT_REMINDER] First 200 chars: ${message.substring(0, 200)}`,
      );
    }

    return await this.sendMessage(
      customerData.phone || customerData.customer?.phone,
      message,
      {
        delay: "3-7",
        customData: {
          type: "payment_reminder",
          invoiceId: invoiceData.id,
          customerId: customerData.id || customerData.customer?.id,
        },
      },
    );
  }

  /**
   * Create payment reminder message with payment link
   */
  async createPaymentReminderMessage(customerData, invoiceData) {
    console.log(`🚨 [EMERGENCY FIX] createPaymentReminderMessage called`);

    const customer = customerData.customer || customerData;
    const invoice = invoiceData || customerData.invoice;

    console.log(`🚨 Customer: ${customer.name}`);
    console.log(`🚨 Invoice: ${invoice.invoice_number}`);
    console.log(`🚨 Payment link: ${invoice.payment_link || "NO LINK"}`);

    // HARDCODE: SELALU gunakan payment link jika ada
    if (invoice.payment_link) {
      console.log(
        `🚨 Creating message WITH payment link: ${invoice.payment_link}`,
      );
      return this.createPaymentLinkMessage(customer, invoice, {});
    } else {
      console.log(`🚨 Creating message WITHOUT payment link`);
      return this.createRegularReminderMessage(customer, invoice, {});
    }
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

    return `Halo ${customer.name} 👋

Masa aktif paket internet Anda akan berakhir dalam beberapa hari.

📋 Detail Invoice:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name || "Internet"}
• Harga: ${formattedAmount}
• Due Date: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}

💳 BAYAR SEKARANG:
👉 ${invoice.payment_link}

Silakan klik link di atas untuk melakukan pembayaran online.
Pembayaran otomatis akan mengaktifkan kembali layanan Anda.

Terima kasih 🙏
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

    return `Halo ${customer.name},

Masa aktif paket internet Anda akan berakhir dalam beberapa hari.

📋 Detail Invoice:
• Invoice: ${invoice.invoice_number}
• Paket: ${customer.package_name || "Internet"}
• Harga: ${formattedAmount}
• Due Date: ${new Date(invoice.due_date).toLocaleDateString("id-ID")}

💳 PEMBAYARAN:
Silakan lakukan pembayaran melalui transfer bank atau datang langsung ke kantor kami.

Jika sudah membayar, silakan konfirmasi ke admin.

Terima kasih,
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
