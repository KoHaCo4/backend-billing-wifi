const mysql = require("mysql2/promise");
require("dotenv").config();

async function fixNotificationLogs() {
  console.log("🔧 Fixing notification_logs table...\n");

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "billing_wifi",
  });

  try {
    // 1. Cek apakah tabel ada
    const [tables] = await connection.execute(`
      SHOW TABLES LIKE 'notification_logs'
    `);

    if (tables.length === 0) {
      console.log("📝 Creating notification_logs table...");

      await connection.execute(`
        CREATE TABLE notification_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          customer_id INT,
          phone VARCHAR(20),
          message_type VARCHAR(50),
          message TEXT,
          status VARCHAR(20) DEFAULT 'queued',
          message_id VARCHAR(100),
          response_data JSON,
          error_message TEXT,
          sent_at DATETIME,
          delivered_at DATETIME,
          read_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_customer_id (customer_id),
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        )
      `);

      console.log("✅ Tabel notification_logs created");
    } else {
      console.log("✅ Tabel notification_logs already exists");
    }

    // 2. Cek kolom yang ada
    console.log("\n📊 Checking columns...");
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'notification_logs' 
      AND TABLE_SCHEMA = DATABASE()
      ORDER BY ORDINAL_POSITION
    `);

    console.table(columns);

    // 3. Tambahkan kolom yang kurang
    const requiredColumns = [
      { name: "message_type", type: "VARCHAR(50)", after: "phone" },
      { name: "message_id", type: "VARCHAR(100)", after: "status" },
      { name: "response_data", type: "JSON", after: "message_id" },
      { name: "error_message", type: "TEXT", after: "response_data" },
      { name: "sent_at", type: "DATETIME", after: "error_message" },
      { name: "delivered_at", type: "DATETIME", after: "sent_at" },
      { name: "read_at", type: "DATETIME", after: "delivered_at" },
    ];

    const existingColumnNames = columns.map((col) => col.COLUMN_NAME);

    for (const reqCol of requiredColumns) {
      if (!existingColumnNames.includes(reqCol.name)) {
        console.log(`\n➕ Adding column ${reqCol.name}...`);

        try {
          await connection.execute(`
            ALTER TABLE notification_logs 
            ADD COLUMN ${reqCol.name} ${reqCol.type} NULL AFTER ${reqCol.after}
          `);
          console.log(`   ✅ Added ${reqCol.name}`);
        } catch (error) {
          console.log(`   ⚠️ Error adding ${reqCol.name}:`, error.message);
        }
      } else {
        console.log(`   ✅ ${reqCol.name} already exists`);
      }
    }

    // 4. Cek data yang sudah ada
    console.log("\n📊 Checking existing data...");
    const [logs] = await connection.execute(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN message_type IS NULL THEN 1 ELSE 0 END) as missing_type,
             SUM(CASE WHEN message_id IS NULL THEN 1 ELSE 0 END) as missing_id
      FROM notification_logs
    `);

    console.log(`   Total logs: ${logs[0].total}`);
    console.log(`   Missing message_type: ${logs[0].missing_type}`);
    console.log(`   Missing message_id: ${logs[0].missing_id}`);

    // 5. Update data yang NULL
    if (logs[0].missing_type > 0) {
      console.log('\n🔄 Updating NULL message_type to "unknown"...');
      await connection.execute(`
        UPDATE notification_logs 
        SET message_type = 'unknown'
        WHERE message_type IS NULL
      `);
    }

    // 6. Tampilkan sample data
    console.log("\n📋 Sample data:");
    const [sample] = await connection.execute(`
      SELECT 
        id,
        customer_id,
        phone,
        message_type,
        status,
        message_id,
        DATE(created_at) as created_date
      FROM notification_logs 
      ORDER BY created_at DESC
      LIMIT 5
    `);

    console.table(sample);

    console.log("\n🎉 Fix completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await connection.end();
  }
}

fixNotificationLogs();
