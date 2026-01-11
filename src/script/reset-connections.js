require("dotenv").config();
const pool = require("../src/config/database");

async function resetConnections() {
  console.log("🔄 Resetting database connections...");

  try {
    // Close all connections in pool
    await pool.end();
    console.log("✅ Pool connections closed");

    // Wait 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Re-initialize pool
    console.log("🔄 Re-initializing pool...");

    // Re-require the pool (hacky but works)
    delete require.cache[require.resolve("../src/config/database")];
    const newPool = require("../src/config/database");

    // Test connection
    const [rows] = await newPool.query("SELECT 1 as test");
    console.log(`✅ Pool re-initialized successfully: ${rows[0].test}`);

    return true;
  } catch (error) {
    console.error("❌ Failed to reset connections:", error);
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  resetConnections().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = resetConnections;
