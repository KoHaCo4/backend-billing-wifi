const axios = require("axios");
const db = require("../config/database");
const logger = require("../utils/logger");

class MikrotikTrafficService {
  constructor(router) {
    this.router = router;
    this.baseURL = `http://${router.ip_address}`;
    this.auth = {
      username: router.username,
      password: router.password,
    };

    // Store previous data untuk kalkulasi rate
    this.previousData = new Map(); // key: interfaceName, value: {rx, tx, timestamp}

    // Store customer traffic mapping
    this.customerMapping = new Map(); // key: username, value: customerId
  }

  // ====================== CORE METHODS (Dari ESP32) ======================

  async getInterfacesTraffic() {
    try {
      const response = await axios.post(
        `${this.baseURL}/rest/interface/print`,
        {
          ".proplist": ".id,name,rx-byte,tx-byte,running",
        },
        {
          auth: this.auth,
          timeout: 5000,
        },
      );

      const interfaces = response.data;
      const results = [];

      for (const iface of interfaces) {
        const interfaceName = iface.name;
        const currentRx = parseInt(iface["rx-byte"]) || 0;
        const currentTx = parseInt(iface["tx-byte"]) || 0;
        const now = Date.now();

        // Ambil data sebelumnya
        const prevKey = `${this.router.id}_${interfaceName}`;
        const prevData = this.previousData.get(prevKey);

        let rxRate = 0;
        let txRate = 0;

        if (prevData) {
          const timeDiff = (now - prevData.timestamp) / 1000; // Dalam detik

          if (timeDiff > 0) {
            rxRate = (currentRx - prevData.rx) / timeDiff; // Bytes per second
            txRate = (currentTx - prevData.tx) / timeDiff;
          }
        }

        // Simpan data sekarang untuk perhitungan berikutnya
        this.previousData.set(prevKey, {
          rx: currentRx,
          tx: currentTx,
          timestamp: now,
        });

        results.push({
          router_id: this.router.id,
          interface_name: interfaceName,
          rx_bytes: currentRx,
          tx_bytes: currentTx,
          rx_rate: Math.max(0, rxRate),
          tx_rate: Math.max(0, txRate),
          running: iface.running === "true",
          timestamp: new Date(),
        });
      }

      return results;
    } catch (error) {
      logger.error(
        `MikroTik Traffic Error (${this.router.ip_address}):`,
        error.message,
      );
      throw error;
    }
  }

  // ====================== CUSTOMER MONITORING ======================

  async getPPPoEActiveSessions() {
    try {
      const response = await axios.post(
        `${this.baseURL}/rest/ppp/active/print`,
        {
          ".proplist": ".id,name,address,caller-id,uptime,service",
        },
        {
          auth: this.auth,
          timeout: 5000,
        },
      );

      const sessions = response.data.filter((s) => s.service === "pppoe");

      // Get detailed traffic untuk setiap session
      const detailedSessions = [];

      for (const session of sessions) {
        try {
          // Dapatkan statistik lebih detail
          const monitorResponse = await axios.post(
            `${this.baseURL}/rest/interface/monitor-traffic`,
            {
              interface: session.name,
              once: "",
            },
            { auth: this.auth, timeout: 3000 },
          );

          const traffic = monitorResponse.data[0] || {};

          detailedSessions.push({
            username: session.name,
            ip_address: session.address,
            caller_id: session["caller-id"],
            uptime: session.uptime,
            rx_bytes: parseInt(traffic["rx-byte"]) || 0,
            tx_bytes: parseInt(traffic["tx-byte"]) || 0,
            rx_rate: parseInt(traffic["rx-rate"]) || 0,
            tx_rate: parseInt(traffic["tx-rate"]) || 0,
            session_id: session[".id"],
          });
        } catch (e) {
          // Skip jika error, tapi tetap simpan basic info
          detailedSessions.push({
            username: session.name,
            ip_address: session.address,
            caller_id: session["caller-id"],
            uptime: session.uptime,
            rx_bytes: 0,
            tx_bytes: 0,
            rx_rate: 0,
            tx_rate: 0,
          });
        }
      }

      return detailedSessions;
    } catch (error) {
      logger.error(`PPPoE Sessions Error:`, error.message);
      return [];
    }
  }

  // ====================== BANDWIDTH CONTROL ======================

  async updateQueueForCustomer(customerUsername, packageData) {
    try {
      const queueName = `queue-${customerUsername}`;

      // Cek apakah queue sudah ada
      const checkResponse = await axios.post(
        `${this.baseURL}/rest/queue/simple/print`,
        { "?.id": queueName },
        { auth: this.auth },
      );

      if (checkResponse.data.length > 0) {
        // Update existing queue
        await axios.post(
          `${this.baseURL}/rest/queue/simple/set`,
          {
            ".id": queueName,
            "max-limit": packageData.speed_limit || "10M/10M",
            "limit-at": packageData.speed_limit || "10M/10M",
          },
          { auth: this.auth },
        );
      } else {
        // Create new queue
        await axios.post(
          `${this.baseURL}/rest/queue/simple/add`,
          {
            name: queueName,
            target: customerUsername,
            "max-limit": packageData.speed_limit || "10M/10M",
            "limit-at": packageData.speed_limit || "10M/10M",
            parent: "global",
            comment: `Auto-generated for customer: ${customerUsername}`,
          },
          { auth: this.auth },
        );
      }

      logger.info(
        `Queue updated for ${customerUsername}: ${packageData.speed_limit}`,
      );
      return true;
    } catch (error) {
      logger.error(
        `Queue update error for ${customerUsername}:`,
        error.message,
      );
      return false;
    }
  }

  async disableCustomerQueue(customerUsername) {
    try {
      const queueName = `queue-${customerUsername}`;

      await axios.post(
        `${this.baseURL}/rest/queue/simple/disable`,
        { ".id": queueName },
        { auth: this.auth },
      );

      logger.info(`Queue disabled for ${customerUsername}`);
      return true;
    } catch (error) {
      logger.warn(`Queue disable failed (may not exist): ${customerUsername}`);
      return false;
    }
  }
}

module.exports = MikrotikTrafficService;
