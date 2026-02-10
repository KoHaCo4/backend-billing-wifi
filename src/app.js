const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();

// Import routes
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customer.routes");
const routerRoutes = require("./routes/router.routes");
const packageRoutes = require("./routes/package.routes");
const adminRoutes = require("./routes/admin.routes");
const jobRoutes = require("./routes/job.routes");
const invoiceRoutes = require("./routes/invoice.routes");
const statsRoutes = require("./routes/stats.routes");
const suspensionRoutes = require("./routes/suspension.routes");
const healtRoutes = require("./routes/health.routes");
const settingsRoutes = require("./routes/settings.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const paymentRoutes = require("./routes/payment.routes");
const customerReminderRoutes = require("./routes/customerReminder.routes");
const customerReminderJob = require("./jobs/customerReminder");
const notificationRoutes = require("./routes/notification.routes");
const monitoringRoutes = require("./routes/monitoring.routes");
const paymentLinkRoutes = require("./routes/paymentLink.routes");
const adminManagementRoutes = require("./routes/adminManagement.routes");
const trafficRoutes = require("./routes/traffic.routes");
const testRoutes = require("./routes/test.routes");

const app = express();

// Security middleware
app.use(helmet());

const allowedOrigins = [
  "https://frontend-billing-wifi.vercel.app",
  "https://billing.fstnews.my.id",
  "http://localhost:3000",
  "http://localhost:8080",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow no-origin (curl, server-to-server, health check)
    if (!origin) return callback(null, true);

    // Allow all Vercel subdomains
    if (origin.endsWith(".vercel.app")) {
      console.log(`✅ Allowing Vercel domain: ${origin}`);
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      console.log(`✅ Allowing origin: ${origin}`);
      return callback(null, true);
    }

    console.warn("⚠️ CORS blocked (but responded safely):", origin);

    // ⚠️ PENTING: JANGAN ERROR
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Authorization",
    "cache-control",
    "pragma",
    "expires",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Tambahkan logging untuk debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log("Origin:", req.headers.origin);
  console.log("User-Agent:", req.headers["user-agent"]);
  next();
});

// Logging
app.use(morgan("dev"));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/routers", routerRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/suspension", suspensionRoutes);
app.use("/api/health", healtRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/customer-reminder", customerReminderRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/monitoring", monitoringRoutes);
app.use("/api/payment-links", paymentLinkRoutes);
app.use("/api/admin-management", adminManagementRoutes);
app.use("/api/traffic", trafficRoutes);
app.use("/api/test", testRoutes);

if (process.env.NODE_ENV !== "test") {
  customerReminderJob.start();
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Billing WiFi API",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

module.exports = app;
