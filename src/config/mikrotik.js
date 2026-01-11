const { RouterOSAPI } = require("node-routeros");
require("dotenv").config();

class MikrotikConnection {
  constructor(routerConfig) {
    this.config = {
      host: process.env.MIKROTIK_HOST || routerConfig.host,
      user: process.env.MIKROTIK_USER || routerConfig.username,
      password: process.env.MIKROTIK_PASS || routerConfig.password,
      port: process.env.MIKROTIK_PORT || routerConfig.api_port || 8728,
      timeout: 10000,
    };
  }

  async connect() {
    try {
      this.client = new RouterOSAPI(this.config);
      await this.client.connect();
      console.log("✅ Mikrotik connected successfully");
      return this.client;
    } catch (error) {
      console.error("Mikrotik connection failed:", error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      this.client.close();
    }
  }
}

module.exports = MikrotikConnection;
