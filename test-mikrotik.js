const MikrotikService = require("./src/services/mikrotik.service");

async function testMikrotikConnection() {
  console.log("🔧 Testing MikroTik Connection...\n");

  // Konfigurasi router lokal Anda
  const routerConfig = {
    ip_address: "192.168.0.111", // IP router Anda
    username: "admin", // Username router
    password: "admin123", // Password router (kosong jika tidak ada)
    api_port: 8728, // Port API MikroTik
    timeout: 8000,
  };

  console.log("Router Configuration:");
  console.log("  IP:", routerConfig.ip_address);
  console.log("  Username:", routerConfig.username);
  console.log("  Password:", routerConfig.password ? "****" : "(empty)");
  console.log("  API Port:", routerConfig.api_port);
  console.log("  Timeout:", routerConfig.timeout, "ms\n");

  const mikrotik = new MikrotikService(routerConfig);

  try {
    // 1. Test koneksi sederhana
    console.log("1. Testing basic connection...");
    const simpleTest = await mikrotik.simpleTestConnection();
    console.log("Result:", simpleTest);

    if (simpleTest.success) {
      console.log("✅ Router reachable and API working\n");
    } else {
      console.log("❌ Router connection failed:", simpleTest.message);

      // Cek apakah ini masalah koneksi jaringan
      console.log("\n⚠️ Possible issues:");
      console.log("- Router tidak aktif di 192.168.0.111");
      console.log("- Port 8728 tidak terbuka di router");
      console.log("- Username/password salah");
      console.log("- API tidak diaktifkan di router");
      return;
    }

    // 2. Test mendapatkan informasi sistem
    console.log("2. Testing system info...");
    try {
      const systemInfo = await mikrotik.getSystemInfo();
      console.log("System Info:", JSON.stringify(systemInfo, null, 2));
    } catch (error) {
      console.log("❌ Failed to get system info:", error.message);
    }

    // 3. Test koneksi lengkap
    console.log("\n3. Testing full connection...");
    const testResult = await mikrotik.testConnection();
    console.log("Full Test Result:", JSON.stringify(testResult, null, 2));

    // 4. Test mendapatkan resource sistem
    console.log("\n4. Testing system resource...");
    try {
      const resource = await mikrotik.getSystemResource();
      console.log("System Resource:");
      console.log("  Board:", resource.board_name);
      console.log("  Version:", resource.version);
      console.log("  Uptime:", resource.uptime);
      console.log("  CPU Load:", resource.cpu_load);
      console.log(
        "  Memory:",
        resource.free_memory_mb +
          "MB free / " +
          resource.total_memory_mb +
          "MB total",
      );
      console.log("  Identity:", resource.identity);
    } catch (error) {
      console.log("❌ Failed to get system resource:", error.message);
    }

    // 5. Test PPPoE operations
    console.log("\n5. Testing PPPoE operations...");

    // Test profile creation
    console.log("5.1 Testing PPPoE profile creation...");
    try {
      const profileResult = await mikrotik.createPPPoEProfile(
        "test-profile",
        "10M/10M",
      );
      console.log("Profile Creation:", profileResult);

      if (profileResult.success) {
        console.log("✅ PPPoE profile test successful");
      }
    } catch (error) {
      console.log("❌ PPPoE profile creation failed:", error.message);
    }

    // Test user creation
    console.log("\n5.2 Testing PPPoE user creation...");
    try {
      const userResult = await mikrotik.createPPPoEUser(
        "testuser123",
        "testpass123",
        "test-profile",
        "Test user from API",
      );
      console.log("User Creation:", userResult);

      if (userResult.success) {
        console.log("✅ PPPoE user creation successful");
      }
    } catch (error) {
      console.log("❌ PPPoE user creation failed:", error.message);
    }

    // Test get active sessions
    console.log("\n5.3 Testing get active PPPoE sessions...");
    try {
      const activeSessions = await mikrotik.getActivePPPoESessions();
      console.log(`Found ${activeSessions.length} active PPPoE sessions`);
      if (activeSessions.length > 0) {
        console.log("First session:", activeSessions[0]);
      }
    } catch (error) {
      console.log("❌ Failed to get active sessions:", error.message);
    }

    // Test get all PPPoE users
    console.log("\n5.4 Testing get all PPPoE users...");
    try {
      const allUsers = await mikrotik.getAllPPPoEUsers();
      console.log(`Found ${allUsers.length} PPPoE users`);
      if (allUsers.length > 0) {
        console.log("First user:", allUsers[0]);
      }
    } catch (error) {
      console.log("❌ Failed to get all users:", error.message);
    }

    // 6. Cleanup test data
    console.log("\n6. Cleaning up test data...");
    try {
      await mikrotik.removePPPoEUser("testuser123");
      console.log("✅ Test user removed");
    } catch (error) {
      console.log("⚠️ Failed to remove test user:", error.message);
    }

    try {
      await mikrotik.deletePPPoEProfile("test-profile");
      console.log("✅ Test profile removed");
    } catch (error) {
      console.log("⚠️ Failed to remove test profile:", error.message);
    }

    console.log("\n🎉 All MikroTik tests completed successfully!");
  } catch (error) {
    console.error("❌ MikroTik test failed:", error.message);
    console.error("Stack:", error.stack);
  }
}

testMikrotikConnection();
