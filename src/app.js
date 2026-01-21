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
const testRoutes = require("./routes/test.routes");
const healtRoutes = require("./routes/health.routes");
const settingsRoutes = require("./routes/settings.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const paymentRoutes = require("./routes/payment.routes");

const app = express();

// Security middleware
app.use(helmet());

const allowedOrigins = [
  "https://frontend-billing-wifi.vercel.app", // DOMAIN VERCEL ANDA
  "https://*.vercel.app", // Allow semua subdomain Vercel
  "http://localhost:3000",
  "http://localhost:3001",
  "https://billing.fstnews.my.id",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow all Vercel subdomains
    if (origin.endsWith(".vercel.app")) {
      console.log(`✅ Allowing Vercel domain: ${origin}`);
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log(`✅ Allowing origin: ${origin}`);
      callback(null, true);
    } else {
      console.log("❌ CORS blocked for origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400,
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
// Tambahkan di app.js setelah routes lainnya
app.use("/api/test", testRoutes);

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
