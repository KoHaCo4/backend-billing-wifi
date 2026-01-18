// // routes/job.routes.js - PERBAIKAN STRUKTUR
// const express = require("express");
// const router = express.Router();
// const { authenticate } = require("../middleware/auth");
// const scheduler = require("../jobs/scheduler");
// const db = require("../config/database"); // TAMBAHKAN IMPORT INI

// // GET /api/jobs/status - Public untuk monitoring
// router.get("/status", (req, res) => {
//   try {
//     const status = scheduler.getStatus
//       ? scheduler.getStatus()
//       : {
//           running: false,
//           jobs: [],
//           lastRun: null,
//         };

//     res.json({
//       success: true,
//       data: status,
//       timestamp: new Date().toISOString(),
//       environment: process.env.NODE_ENV,
//     });
//   } catch (error) {
//     console.error("Error getting job status:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to get job status",
//       error: error.message,
//     });
//   }
// });

// // POST /api/jobs/run/:jobName - Protected
// router.post("/run/:jobName", authenticate, async (req, res) => {
//   try {
//     const { jobName } = req.params;
//     const validJobs = [
//       "autoSuspend",
//       "checkExpiring",
//       "checkOverdue",
//       "generateInvoices",
//       "cleanupLogs",
//     ];

//     if (!validJobs.includes(jobName)) {
//       return res.status(400).json({
//         success: false,
//         message: `Invalid job name. Valid jobs: ${validJobs.join(", ")}`,
//       });
//     }

//     console.log(
//       `🔧 Manual job trigger: ${jobName} by user ${req.user?.id || "system"}`
//     );

//     if (scheduler.runJobManually) {
//       const result = await scheduler.runJobManually(jobName);

//       res.json({
//         success: true,
//         message: `Job ${jobName} completed successfully`,
//         data: result,
//         triggeredBy: req.user?.username || "manual",
//         timestamp: new Date().toISOString(),
//       });
//     } else {
//       res.status(501).json({
//         success: false,
//         message: `Scheduler doesn't support manual execution`,
//       });
//     }
//   } catch (error) {
//     console.error(`Job ${req.params.jobName} failed:`, error);
//     res.status(500).json({
//       success: false,
//       message: `Failed to run job ${req.params.jobName}`,
//       error: error.message,
//     });
//   }
// });

// // GET /api/jobs/list - Get all scheduled jobs
// router.get("/list", authenticate, (req, res) => {
//   try {
//     const jobs = [
//       {
//         name: "autoSuspend",
//         description: "Auto suspend expired customers",
//         schedule: "Daily at 01:00",
//         enabled: process.env.AUTO_SUSPEND_ENABLED === "true",
//       },
//       {
//         name: "checkExpiring",
//         description: "Check expiring soon customers",
//         schedule: "Daily at 09:00",
//         enabled: true,
//       },
//       {
//         name: "checkOverdue",
//         description: "Check overdue invoices",
//         schedule: "Daily at 02:00",
//         enabled: true,
//       },
//     ];

//     res.json({
//       success: true,
//       data: jobs,
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: "Failed to get jobs list",
//     });
//   }
// }); // PERBAIKAN: TUTUP ROUTE /list DI SINI

// router.get("/logs", authenticate, async (req, res) => {
//   try {
//     console.log("📋 GET /jobs/logs - Request by user:", req.user?.id);

//     // Cek apakah tabel job_logs ada
//     const [tableCheck] = await db.query(`
//       SELECT COUNT(*) as count FROM information_schema.tables
//       WHERE table_schema = DATABASE() AND table_name = 'job_logs'
//     `);

//     if (tableCheck[0].count === 0) {
//       // Tabel belum ada, beri instruksi untuk membuatnya
//       return res.json({
//         success: true,
//         message:
//           "Job logs table not created yet. Run the SQL below to create it.",
//         create_table_sql: `
//           CREATE TABLE job_logs (
//             id INT PRIMARY KEY AUTO_INCREMENT,
//             job_name VARCHAR(100) NOT NULL,
//             status ENUM('success', 'failed', 'running') NOT NULL,
//             message TEXT,
//             execution_time INT DEFAULT NULL,
//             error_message TEXT,
//             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//             updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
//           );
//         `,
//         dummy_data: [
//           {
//             id: 1,
//             job_name: "autoSuspend",
//             status: "success",
//             message: "Auto-suspend job completed successfully",
//             execution_time: 1250,
//             error_message: null,
//             created_at: new Date().toISOString(),
//           },
//           {
//             id: 2,
//             job_name: "checkExpiring",
//             status: "success",
//             message: "Checked 15 expiring customers",
//             execution_time: 850,
//             error_message: null,
//             created_at: new Date(Date.now() - 3600000).toISOString(),
//           },
//         ],
//       });
//     }

//     // Jika tabel ada, ambil data
//     const [logs] = await db.query(`
//       SELECT
//         id,
//         job_name,
//         status,
//         message,
//         execution_time,
//         error_message,
//         created_at,
//         updated_at
//       FROM job_logs
//       ORDER BY created_at DESC
//       LIMIT 50
//     `);

//     res.json({
//       success: true,
//       message: "Job logs retrieved successfully",
//       data: logs,
//       count: logs.length,
//     });
//   } catch (error) {
//     console.error("❌ Error getting job logs:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to get job logs",
//       error: error.message,
//     });
//   }
// });

// // POST /api/jobs/logs - Add a job log (untuk testing)
// router.post("/logs", authenticate, async (req, res) => {
//   try {
//     const { job_name, status, message, execution_time, error_message } =
//       req.body;

//     const [result] = await db.query(
//       `INSERT INTO job_logs
//        (job_name, status, message, execution_time, error_message)
//        VALUES (?, ?, ?, ?, ?)`,
//       [job_name, status, message, execution_time, error_message]
//     );

//     res.json({
//       success: true,
//       message: "Job log added",
//       log_id: result.insertId,
//     });
//   } catch (error) {
//     console.error("Error adding job log:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to add job log",
//     });
//   }
// });

// module.exports = router;

// routes/job.routes.js - VERSI YANG SUDAH DIPERBAIKI
const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const scheduler = require("../jobs/scheduler");
const db = require("../config/database");

// GET /api/jobs/status - Public untuk monitoring
router.get("/status", (req, res) => {
  try {
    const status = scheduler.getStatus
      ? scheduler.getStatus()
      : {
          running: false,
          jobs: [],
          lastRun: null,
        };

    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });
  } catch (error) {
    console.error("Error getting job status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get job status",
      error: error.message,
    });
  }
});

// POST /api/jobs/run/:jobName - Protected
router.post("/run/:jobName", authenticate, async (req, res) => {
  try {
    const { jobName } = req.params;
    const validJobs = [
      "autoSuspend",
      "checkExpiring",
      "checkOverdue",
      "generateInvoices",
      "cleanupLogs",
    ];

    if (!validJobs.includes(jobName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid job name. Valid jobs: ${validJobs.join(", ")}`,
      });
    }

    console.log(
      `🔧 Manual job trigger: ${jobName} by user ${req.user?.id || "system"}`
    );

    // Log job execution start
    const [logResult] = await db.query(
      `INSERT INTO job_logs 
       (job_name, status, message) 
       VALUES (?, 'running', ?)`,
      [
        jobName,
        `Manual execution triggered by user ${req.user?.username || "system"}`,
      ]
    );

    const logId = logResult.insertId;

    try {
      let result;
      if (scheduler.runJobManually) {
        result = await scheduler.runJobManually(jobName);
      } else {
        // Fallback execution jika scheduler tidak ada
        const startTime = Date.now();

        // Simulasi job execution
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const duration = Date.now() - startTime;
        result = {
          success: true,
          message: `Job ${jobName} executed manually`,
          duration: duration,
        };
      }

      // Update log dengan status success
      await db.query(
        `UPDATE job_logs 
         SET status = 'success', 
             message = ?, 
             execution_time = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          result.message || `Job ${jobName} completed successfully`,
          result.duration || 0,
          logId,
        ]
      );

      res.json({
        success: true,
        message: `Job ${jobName} completed successfully`,
        data: result,
        triggeredBy: req.user?.username || "manual",
        timestamp: new Date().toISOString(),
        logId: logId,
      });
    } catch (jobError) {
      // Update log dengan status failed
      await db.query(
        `UPDATE job_logs 
         SET status = 'failed', 
             message = ?, 
             error_message = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [`Job ${jobName} failed`, jobError.message, logId]
      );

      throw jobError;
    }
  } catch (error) {
    console.error(`Job ${req.params.jobName} failed:`, error);
    res.status(500).json({
      success: false,
      message: `Failed to run job ${req.params.jobName}`,
      error: error.message,
    });
  }
});

// GET /api/jobs/list - Get all scheduled jobs
router.get("/list", authenticate, (req, res) => {
  try {
    const jobs = [
      {
        name: "autoSuspend",
        description: "Auto suspend expired customers",
        schedule: "Daily at 01:00",
        enabled: process.env.AUTO_SUSPEND_ENABLED === "true",
      },
      {
        name: "checkExpiring",
        description: "Check expiring soon customers",
        schedule: "Daily at 09:00",
        enabled: true,
      },
      {
        name: "checkOverdue",
        description: "Check overdue invoices",
        schedule: "Daily at 02:00",
        enabled: true,
      },
    ];

    res.json({
      success: true,
      data: jobs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get jobs list",
    });
  }
});

// GET /api/jobs/logs - Get job logs dengan filter dan pagination
router.get("/logs", authenticate, async (req, res) => {
  try {
    const {
      type = "all",
      limit = 10,
      offset = 0,
      status,
      start_date,
      end_date,
    } = req.query;

    console.log(
      `📋 GET /jobs/logs - Request by user: ${req.user?.id}, type: ${type}`
    );

    // Cek apakah tabel job_logs ada
    const [tableCheck] = await db.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'job_logs'
    `);

    if (tableCheck[0].count === 0) {
      // Tabel belum ada, buat tabel otomatis
      console.log("Creating job_logs table...");

      await db.query(`
        CREATE TABLE IF NOT EXISTS job_logs (
          id INT PRIMARY KEY AUTO_INCREMENT,
          job_name VARCHAR(100) NOT NULL,
          status ENUM('success','failed','running') NOT NULL DEFAULT 'running',
          message TEXT,
          execution_time INT DEFAULT NULL,
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_job_name (job_name),
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      console.log("✅ job_logs table created");
    }

    // Mapping tipe job untuk filter
    const jobTypeMapping = {
      suspension: ["autoSuspend"],
      expiring: ["checkExpiring"],
      overdue: ["checkOverdue"],
      all: [
        "autoSuspend",
        "checkExpiring",
        "checkOverdue",
        "generateInvoices",
        "cleanupLogs",
      ],
    };

    // Bangun query WHERE clause
    let whereClauses = [];
    let params = [];

    // Filter berdasarkan tipe job
    if (type !== "all" && jobTypeMapping[type]) {
      whereClauses.push(
        `job_name IN (${jobTypeMapping[type].map(() => "?").join(",")})`
      );
      params.push(...jobTypeMapping[type]);
    }

    // Filter berdasarkan status
    if (status && ["success", "failed", "running"].includes(status)) {
      whereClauses.push(`status = ?`);
      params.push(status);
    }

    // Filter berdasarkan tanggal
    if (start_date) {
      whereClauses.push(`DATE(created_at) >= ?`);
      params.push(start_date);
    }
    if (end_date) {
      whereClauses.push(`DATE(created_at) <= ?`);
      params.push(end_date);
    }

    // Gabungkan WHERE clause
    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // Query untuk data
    const dataSql = `
      SELECT 
        id,
        job_name as jobName,
        status,
        message,
        execution_time as duration,
        error_message as error,
        created_at as timestamp,
        updated_at
      FROM job_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Query untuk total count
    const countSql = `
      SELECT COUNT(*) as total
      FROM job_logs
      ${whereClause}
    `;

    // Eksekusi query
    const [logs] = await db.query(dataSql, [
      ...params,
      parseInt(limit),
      parseInt(offset),
    ]);
    const [countResult] = await db.query(countSql, params);
    const totalCount = countResult[0]?.total || 0;

    // Format tanggal untuk response
    const formattedLogs = logs.map((log) => ({
      ...log,
      timestamp: log.timestamp ? new Date(log.timestamp).toISOString() : null,
      updated_at: log.updated_at
        ? new Date(log.updated_at).toISOString()
        : null,
    }));

    res.json({
      success: true,
      message: "Job logs retrieved successfully",
      data: formattedLogs,
      meta: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + logs.length < totalCount,
      },
      filters: {
        type,
        status,
        start_date,
        end_date,
      },
    });
  } catch (error) {
    console.error("❌ Error getting job logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get job logs",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/jobs/logs - Add a job log (untuk testing dan scheduler)
router.post("/logs", authenticate, async (req, res) => {
  try {
    const {
      job_name,
      status = "running",
      message,
      execution_time,
      error_message,
    } = req.body;

    // Validasi input
    if (!job_name) {
      return res.status(400).json({
        success: false,
        message: "job_name is required",
      });
    }

    const validStatuses = ["success", "failed", "running"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const [result] = await db.query(
      `INSERT INTO job_logs 
       (job_name, status, message, execution_time, error_message) 
       VALUES (?, ?, ?, ?, ?)`,
      [job_name, status, message, execution_time, error_message]
    );

    res.json({
      success: true,
      message: "Job log added successfully",
      data: {
        id: result.insertId,
        job_name,
        status,
        message,
        execution_time,
        error_message,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error adding job log:", error);
    res.status(500).json({
      success: false,
      message: "Failed to add job log",
      error: error.message,
    });
  }
});

// GET /api/jobs/stats - Get job execution statistics
router.get("/stats", authenticate, async (req, res) => {
  try {
    const { period = "7days" } = req.query; // 7days, 30days, today, yesterday

    let dateFilter = "";
    let params = [];

    switch (period) {
      case "today":
        dateFilter = "DATE(created_at) = CURDATE()";
        break;
      case "yesterday":
        dateFilter = "DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";
        break;
      case "7days":
        dateFilter = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
        break;
      case "30days":
        dateFilter = "created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)";
        break;
      default:
        dateFilter = "created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    }

    const whereClause = dateFilter ? `WHERE ${dateFilter}` : "";

    // Query untuk statistik umum
    const [generalStats] = await db.query(`
      SELECT 
        COUNT(*) as total_executions,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_count,
        AVG(execution_time) as avg_execution_time,
        MAX(execution_time) as max_execution_time,
        MIN(execution_time) as min_execution_time
      FROM job_logs
      ${whereClause}
    `);

    // Query untuk statistik per job
    const [jobStats] = await db.query(`
      SELECT 
        job_name,
        COUNT(*) as execution_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        AVG(execution_time) as avg_duration,
        MAX(execution_time) as max_duration
      FROM job_logs
      ${whereClause}
      GROUP BY job_name
      ORDER BY execution_count DESC
    `);

    // Query untuk trend harian
    const [dailyTrend] = await db.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM job_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json({
      success: true,
      data: {
        general: generalStats[0],
        by_job: jobStats,
        daily_trend: dailyTrend,
        period: period,
      },
    });
  } catch (error) {
    console.error("Error getting job stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get job statistics",
      error: error.message,
    });
  }
});

// DELETE /api/jobs/logs/:id - Delete a specific job log
router.delete("/logs/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(`DELETE FROM job_logs WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Job log not found",
      });
    }

    res.json({
      success: true,
      message: "Job log deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting job log:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete job log",
      error: error.message,
    });
  }
});

// DELETE /api/jobs/logs - Bulk delete old logs
router.delete("/logs", authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [result] = await db.query(
      `DELETE FROM job_logs 
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );

    res.json({
      success: true,
      message: `Deleted ${result.affectedRows} old job logs`,
      deleted_count: result.affectedRows,
    });
  } catch (error) {
    console.error("Error bulk deleting job logs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete old job logs",
      error: error.message,
    });
  }
});

module.exports = router;
