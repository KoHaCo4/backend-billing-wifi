const db = require("./src/config/database");

async function updateRouterDatabase() {
  console.log("🔧 Updating Router in Database...\n");

  // Data router MikroTik Anda
  const routerData = {
    name: "MikroTik Local",
    ip_address: "192.168.0.111",
    username: "admin",
    password: "admin123", // Password router Anda
    port: 8728,
    api_port: 8728,
    status: "active",
    admin_id: 1,
  };

  try {
    // Cek apakah router sudah ada
    const [existingRouters] = await db.execute(
      "SELECT id, name, ip_address FROM routers WHERE ip_address = ?",
      [routerData.ip_address],
    );

    if (existingRouters.length > 0) {
      console.log("✅ Router already exists:");
      console.log("  ID:", existingRouters[0].id);
      console.log("  Name:", existingRouters[0].name);
      console.log("  IP:", existingRouters[0].ip_address);

      // Update router dengan konfigurasi baru
      await db.execute(
        `UPDATE routers SET 
          name = ?, 
          username = ?, 
          password = ?, 
          api_port = ?,
          status = 'active',
          updated_at = NOW()
         WHERE id = ?`,
        [
          routerData.name,
          routerData.username,
          routerData.password,
          routerData.api_port,
          existingRouters[0].id,
        ],
      );
      console.log("✅ Router updated with new configuration");

      return existingRouters[0].id;
    } else {
      // Insert router baru
      console.log("Creating new router...");
      const [result] = await db.execute(
        `INSERT INTO routers 
          (name, ip_address, username, password, port, api_port, status, admin_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          routerData.name,
          routerData.ip_address,
          routerData.username,
          routerData.password,
          routerData.port,
          routerData.api_port,
          routerData.status,
          routerData.admin_id,
        ],
      );

      console.log("✅ New router created with ID:", result.insertId);
      return result.insertId;
    }
  } catch (error) {
    console.error("❌ Error updating router database:", error);
    throw error;
  }
}

// Jalankan update
updateRouterDatabase()
  .then((routerId) => {
    console.log(`\n🎉 Router database update complete. Router ID: ${routerId}`);
    console.log("\nNow you can test MikroTik integration with:");
    console.log("1. node test-mikrotik-connection.js");
    console.log("2. node test-customer-mikrotik.js");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to update router:", error);
    process.exit(1);
  });
