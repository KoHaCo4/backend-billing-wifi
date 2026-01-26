const axios = require("axios");
const logger = require("../utils/logger");

class FonnteService {
  constructor() {
    this.apiUrl = process.env.FONNTE_API_URL || "https://api.fonnte.com";
    this.apiToken = process.env.FONNTE_API_TOKEN;
  }

  async sendMessage(to, message, options = {}) {
    try {
      if (!this.apiToken) {
        logger.error("FONNTE_API_TOKEN tidak ditemukan");
        return {
          success: false,
          error: "API token tidak dikonfigurasi",
        };
      }

      // Format nomor telepon - HILANGKAN SEMUA FORMATTING
      let phoneNumber = to.toString().trim();

      // Hilangkan semua karakter non-digit
      phoneNumber = phoneNumber.replace(/\D/g, "");

      // Jika dimulai dengan 0, hapus
      if (phoneNumber.startsWith("0")) {
        phoneNumber = phoneNumber.substring(1);
      }

      // Jika dimulai dengan 62, hapus
      if (phoneNumber.startsWith("62")) {
        phoneNumber = phoneNumber.substring(2);
      }

      // Jika dimulai dengan +62, hapus
      if (phoneNumber.startsWith("+62")) {
        phoneNumber = phoneNumber.substring(3);
      }

      logger.info(`Mengirim ke: ${phoneNumber}`);

      // Format payload sesuai dokumentasi Fonnte
      const payload = {
        target: phoneNumber, // Hanya angka, tanpa kode negara
        message: message,
        delay: "1-5", // Format delay yang benar
        countryCode: "62", // Selalu tambahkan countryCode
      };

      // Tambahkan options lainnya jika ada
      if (options.url) payload.url = options.url;
      if (options.filename) payload.filename = options.filename;
      if (options.schedule) payload.schedule = options.schedule;

      logger.info("Payload:", JSON.stringify(payload));

      const response = await axios({
        method: "post",
        url: `${this.apiUrl}/send`,
        data: payload,
        headers: {
          Authorization: this.apiToken,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      logger.info("Response Fonnte:", JSON.stringify(response.data));

      // Cek berbagai format response yang mungkin
      if (
        response.data.status === true ||
        response.data.status === "sent" ||
        response.data.message_id
      ) {
        return {
          success: true,
          data: response.data,
          messageId: response.data.message_id,
        };
      } else {
        return {
          success: false,
          error: response.data.reason || "Unknown error",
          data: response.data,
        };
      }
    } catch (error) {
      logger.error("Fonnte API Error:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          data: error.config?.data,
        },
      });

      return {
        success: false,
        error: error.message,
        response: error.response?.data,
        statusCode: error.response?.status,
      };
    }
  }

  async sendSubscriptionReminder(customer) {
    const message = `Halo ${customer.name},

Masa aktif paket internet Anda akan berakhir dalam 1 hari (${customer.expiry_date}).

Segera lakukan pembayaran untuk menghindari pemutusan layanan.

Detail Paket:
- Paket: ${customer.package_name}
- Harga: ${customer.package_price}
- Expired: ${customer.expiry_date}

Terima kasih,
${process.env.COMPANY_NAME || "Billing WiFi"}`;

    return await this.sendMessage(customer.phone, message, {
      delay: "2-10", // Random delay 2-10 detik
    });
  }

  async checkDeviceStatus() {
    try {
      if (!this.apiToken) {
        return {
          success: false,
          error: "API token tidak ditemukan",
        };
      }

      logger.info("🔍 Checking Fonnte device status...");

      // Coba beberapa endpoint yang mungkin
      const endpoints = [
        { method: "get", url: `${this.apiUrl}/device` },
        { method: "post", url: `${this.apiUrl}/device` },
        { method: "get", url: `${this.apiUrl}/device-info` },
        { method: "post", url: `${this.apiUrl}/device-info` },
        { method: "get", url: `${this.apiUrl}/status` },
      ];

      let lastError = null;

      for (const endpoint of endpoints) {
        try {
          logger.debug(
            `Trying ${endpoint.method.toUpperCase()} ${endpoint.url}`,
          );

          const response = await axios({
            method: endpoint.method,
            url: endpoint.url,
            headers: {
              Authorization: this.apiToken,
              "User-Agent": "BillingWifi-System/1.0",
            },
            timeout: 10000,
          });

          logger.info("✅ Device status response:", response.data);

          // Cek response format yang umum
          const data = response.data;

          // Format 1: { device: {...}, status: 'connected' }
          if (data.device_status === "connect" || data.status === true) {
            return {
              success: true,
              data: data,
              device: data.device,
              status: data.device_status || data.status,
              connected: true, // Set ke true karena device_status = 'connect'
              quota: data.quota,
              expired: data.expired,
              package: data.package,
            };
          }

          // Format 2: { success: true, data: {...} }
          if (data.success !== false) {
            return {
              success: true,
              data: data,
            };
          }
        } catch (err) {
          lastError = err;
          logger.debug(`Endpoint ${endpoint.url} failed: ${err.message}`);
          // Continue ke endpoint berikutnya
        }
      }

      // Jika semua endpoint gagal
      if (lastError) {
        throw lastError;
      }

      return {
        success: false,
        error: "No valid endpoint found",
        suggestion:
          "Check Fonnte API documentation for correct device status endpoint",
      };
    } catch (error) {
      logger.error("❌ Device Status Error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });

      // Berdasarkan error 405, mungkin endpoint berbeda
      // Coba alternative approach: test dengan send message kecil
      try {
        logger.info("🔄 Trying alternative device check via test message...");

        // Kirim test message ke nomor dummy
        const testResult = await this.sendMessage("000000000000", "test");

        return {
          success: testResult.success,
          alternativeCheck: true,
          message: testResult.success
            ? "API is working (test message accepted)"
            : "API may have issues",
          sendStatus: testResult.status,
          error: testResult.error,
        };
      } catch (sendError) {
        return {
          success: false,
          error: `Device check failed: ${error.message}`,
          alternativeCheckError: sendError.message,
          statusCode: error.response?.status,
        };
      }
    }
  }

  // Test endpoint langsung
  async testDirect() {
    try {
      // Cek dulu apakah token valid
      const deviceCheck = await this.checkDeviceStatus();

      if (!deviceCheck.success) {
        return deviceCheck;
      }

      // Test send dengan nomor khusus (gunakan nomor admin)
      const testNumber = process.env.TEST_PHONE_NUMBER || "81325974890";
      const testMessage =
        "Test dari Billing WiFi - " + new Date().toLocaleString("id-ID");

      logger.info(`Testing direct send to: ${testNumber}`);

      return await this.sendMessage(testNumber, testMessage);
    } catch (error) {
      logger.error("Direct test error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new FonnteService();
