// src/routes/test.routes.js
const express = require("express");
const router = express.Router();
const db = require("../config/database");

// Route untuk test grace period
router.get("/grace-period-test", async (req, res) => {
  try {
    const gracePeriod = parseInt(process.env.GRACE_PERIOD_DAYS) || 3;

    console.log("Testing grace period logic...");
    console.log("Grace period days:", gracePeriod);

    // Query yang lebih aman dengan error handling
    let customers;
    try {
      [customers] = await db.query(
        `
        SELECT 
          c.id,
          c.name,
          c.username_pppoe,
          c.expired_at,
          c.status,
          DATEDIFF(CURDATE(), DATE(c.expired_at)) as days_since_expired,
          CASE 
            WHEN DATEDIFF(CURDATE(), DATE(c.expired_at)) >= ? THEN 'READY_FOR_SUSPEND'
            ELSE 'IN_GRACE_PERIOD'
          END as suspension_status,
          (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status IN ('pending', 'overdue')) as pending_invoices
        FROM customers c
        WHERE c.status = 'active'
          AND DATE(c.expired_at) <= CURDATE()
        ORDER BY c.expired_at ASC
      `,
        [gracePeriod]
      );
    } catch (queryError) {
      console.error("Database query error:", queryError);
      return res.status(500).json({
        success: false,
        message: `Database error: ${queryError.message}`,
        sqlMessage: queryError.sqlMessage,
      });
    }

    // Kategorikan
    const readyForSuspend = customers.filter(
      (c) => c.days_since_expired >= gracePeriod && c.pending_invoices === 0
    );
    const inGracePeriod = customers.filter(
      (c) => c.days_since_expired < gracePeriod
    );
    const hasPendingInvoices = customers.filter((c) => c.pending_invoices > 0);

    // Format response
    const response = {
      success: true,
      data: {
        grace_period_days: gracePeriod,
        current_date: new Date().toISOString().split("T")[0],
        summary: {
          total_expired_active: customers.length,
          ready_for_suspend: readyForSuspend.length,
          in_grace_period: inGracePeriod.length,
          has_pending_invoices: hasPendingInvoices.length,
        },
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          expired_at: c.expired_at,
          status: c.status,
          days_since_expired: c.days_since_expired,
          suspension_status: c.suspension_status,
          pending_invoices: c.pending_invoices,
        })),
      },
    };

    console.log("Grace period test completed");
    console.log("Results:", JSON.stringify(response.data.summary, null, 2));

    res.json(response);
  } catch (error) {
    console.error("Error in grace-period-test:", error);
    res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Simple test endpoint
router.get("/ping", (req, res) => {
  res.json({
    success: true,
    message: "Test route is working",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
