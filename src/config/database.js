const mysql = require("mysql2/promise");
require("dotenv").config();

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "billing_wifi",
  port: process.env.DB_PORT || 3306,

  // ✅ OPTIMAL POOL SETTINGS UNTUK PRODUCTION
  waitForConnections: true,
  connectionLimit: 50, // Maksimal 50 connections
  queueLimit: 100, // Maksimal 100 queries dalam queue
  maxIdle: 20, // Maksimal 20 idle connections
  idleTimeout: 60000, // Close idle connections setelah 60 detik
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // Timeout settings
  connectTimeout: 10000, // 10 detik timeout untuk connect
  acquireTimeout: 10000, // 10 detik timeout untuk acquire connection
  timeout: 60000, // 60 detik timeout untuk query
});

// Event listeners untuk monitoring
pool.on("acquire", (connection) => {
  console.log(`🔗 Connection ${connection.threadId} acquired`);
});

pool.on("release", (connection) => {
  console.log(`🔓 Connection ${connection.threadId} released`);
});

pool.on("enqueue", () => {
  console.log("⏳ Query waiting for available connection...");
});

// Test connection on startup
pool
  .getConnection()
  .then((connection) => {
    console.log("✅ Database connected successfully");
    connection.release();
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
  });

module.exports = pool;
