const axios = require("axios");
const db = require("./src/config/database");

const API_BASE = "http://localhost:5555/api";

async function testCustomerWithMikrotik() {
  console.log("🧪 Testing Customer Creation with MikroTik...\n");

  try {
    // 1. Login ke API
    console.log("1. Logging in...");
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: "superadmin@test.com",
      password: "superadmin123",
    });

    const token = loginRes.data.data.tokens.accessToken;
    console.log("✅ Login successful");
    console.log("  User:", loginRes.data.data.user.name);

    // 2. Get available router dan package
    console.log("\n2. Getting available router and package...");
    const [routers] = await db.execute(
      "SELECT id, name, ip_address, status FROM routers WHERE status = 'active' LIMIT 1",
    );
    const [packages] = await db.execute(
      "SELECT id, name FROM packages LIMIT 1",
    );

    if (routers.length === 0) {
      console.log("❌ No active routers found in database");

      // Try to find any router
      const [allRouters] = await db.execute("SELECT * FROM routers LIMIT 1");
      if (allRouters.length > 0) {
        console.log("Found inactive router:", allRouters[0].name);
        console.log("Status:", allRouters[0].status);
      }
      return;
    }

    if (packages.length === 0) {
      console.log("❌ No packages found in database");
      return;
    }

    const router = routers[0];
    const package = packages[0];

    console.log("✅ Found router:", router.name, `(${router.ip_address})`);
    console.log("✅ Found package:", package.name);

    // 3. Test koneksi router terlebih dahulu
    console.log("\n3. Testing router connection before customer creation...");
    const MikrotikService = require("./src/services/mikrotik.service");

    const mikrotik = new MikrotikService({
      ip_address: router.ip_address,
      username: "admin",
      password: "", // Password router
      api_port: 8728,
    });

    try {
      const testResult = await mikrotik.simpleTestConnection();
      console.log("Router test result:", testResult);

      if (!testResult.success) {
        console.log(
          "⚠️ Router connection test failed. Customer creation may fail.",
        );
      } else {
        console.log("✅ Router connection successful!");
      }
    } catch (error) {
      console.log("⚠️ Router test error:", error.message);
    }

    // 4. Create customer dengan username unik
    const timestamp = Date.now();
    const customerData = {
      name: `MikroTik Test Customer ${timestamp}`,
      phone: "089999999999",
      address: "Test Address for MikroTik Integration",
      username_pppoe: `mikrotiktest${timestamp}`, // Pastikan unique
      password_pppoe: "mikrotikpass123",
      router_id: router.id,
      package_id: package.id,
      expired_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      status: "active",
      auto_renew: 1,
      skip_mikrotik: false, // Jangan skip - kita ingin test dengan MikroTik
    };

    console.log("\n4. Creating customer with MikroTik sync...");
    console.log("Customer data:", JSON.stringify(customerData, null, 2));

    try {
      const createRes = await axios.post(
        `${API_BASE}/customers`,
        customerData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 30000, // Timeout lebih panjang untuk MikroTik sync
        },
      );

      console.log("✅ Customer created successfully!");
      console.log("Response:", createRes.data);

      const customerId = createRes.data.data.id;

      // 5. Verify customer in database
      console.log("\n5. Verifying customer in database...");
      const [dbCustomer] = await db.execute(
        "SELECT id, name, username_pppoe, mikrotik_status, router_id FROM customers WHERE id = ?",
        [customerId],
      );

      if (dbCustomer.length > 0) {
        const customer = dbCustomer[0];
        console.log("Database record:");
        console.log("  ID:", customer.id);
        console.log("  Name:", customer.name);
        console.log("  Username:", customer.username_pppoe);
        console.log("  MikroTik Status:", customer.mikrotik_status);
        console.log("  Router ID:", customer.router_id);
      }

      // 6. Verify in MikroTik
      console.log("\n6. Verifying customer in MikroTik...");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Tunggu 2 detik

      try {
        const userExists = await mikrotik.checkPPPoEUserExists(
          customerData.username_pppoe,
        );
        console.log(
          "User exists in MikroTik:",
          userExists ? "✅ Yes" : "❌ No",
        );

        if (userExists) {
          const userDetails = await mikrotik.getPPPoEUserDetails(
            customerData.username_pppoe,
          );
          console.log("User details:", JSON.stringify(userDetails, null, 2));
        }
      } catch (error) {
        console.log("❌ Failed to verify in MikroTik:", error.message);
      }

      // 7. Cleanup - Delete customer
      console.log("\n7. Cleaning up test customer...");

      // Tunggu sebentar sebelum delete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await axios.delete(`${API_BASE}/customers/${customerId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      console.log("✅ Test customer deleted from database");

      // Tunggu dan hapus dari MikroTik juga
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        await mikrotik.removePPPoEUser(customerData.username_pppoe);
        console.log("✅ Test customer removed from MikroTik");
      } catch (error) {
        console.log("⚠️ Failed to remove from MikroTik:", error.message);
      }
    } catch (error) {
      console.log(
        "❌ Customer creation failed:",
        error.response?.data?.message || error.message,
      );

      if (error.response?.data) {
        console.log(
          "Full error:",
          JSON.stringify(error.response.data, null, 2),
        );
      }

      // Check if it's MikroTik error
      if (
        error.message.includes("MikroTik") ||
        error.message.includes("router")
      ) {
        console.log("\n🔧 MikroTik Error Troubleshooting:");
        console.log("1. Check router connectivity: ping 192.168.0.111");
        console.log("2. Check API port: telnet 192.168.0.111 8728");
        console.log("3. Verify username/password in router");
        console.log("4. Check if API is enabled in MikroTik");
        console.log("5. Try with skip_mikrotik: true flag");
      }
    }

    console.log("\n🎉 Test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testCustomerWithMikrotik();
