const db = require("../config/database");

class StatsController {
  // Get all dashboard statistics
  static async getDashboardStats(req, res) {
    try {
      console.log("📊 Fetching dashboard statistics...");
      console.log("🔥 getDashboardStats called - START");
      console.log("📅 Request from:", req.user ? req.user.id : "unknown");
      console.log("🔗 Request URL:", req.originalUrl);

      // Get current date for calculations
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const sevenDaysFromNow = new Date(today);
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
      const sevenDaysStr = sevenDaysFromNow.toISOString().split("T")[0];

      // Format bulan untuk query
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); // 6 bulan termasuk bulan ini
      const sixMonthsAgoStr = sixMonthsAgo.toISOString().split("T")[0];

      console.log("📅 Date params:", {
        today: todayStr,
        sevenDaysFromNow: sevenDaysStr,
        sixMonthsAgo: sixMonthsAgoStr,
      });

      // 1. Basic Counts - disederhanakan dulu
      let totalCustomersResult,
        activeCustomersResult,
        pendingInvoicesResult,
        overdueInvoicesResult,
        expiringSoonResult,
        monthlyRevenueResult;

      try {
        // Query satu per satu untuk debugging
        console.log("🔄 Running basic count queries...");

        totalCustomersResult = await db.query(
          "SELECT COUNT(*) as count FROM customers"
        );
        console.log("✅ Total customers:", totalCustomersResult[0][0]?.count);

        activeCustomersResult = await db.query(
          "SELECT COUNT(*) as count FROM customers WHERE status = 'active'"
        );
        console.log("✅ Active customers:", activeCustomersResult[0][0]?.count);

        pendingInvoicesResult = await db.query(
          "SELECT COUNT(*) as count FROM invoices WHERE status = 'pending'"
        );
        console.log("✅ Pending invoices:", pendingInvoicesResult[0][0]?.count);

        overdueInvoicesResult = await db.query(
          "SELECT COUNT(*) as count FROM invoices WHERE status = 'overdue'"
        );
        console.log("✅ Overdue invoices:", overdueInvoicesResult[0][0]?.count);

        // Fix parameter untuk expiring soon
        expiringSoonResult = await db.query(
          "SELECT COUNT(*) as count FROM customers WHERE expired_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND status = 'active'"
        );
        console.log("✅ Expiring soon:", expiringSoonResult[0][0]?.count);

        monthlyRevenueResult = await db.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM payments 
           WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
           AND YEAR(created_at) = YEAR(CURRENT_DATE())`
        );
        console.log("✅ Monthly revenue:", monthlyRevenueResult[0][0]?.total);
      } catch (basicError) {
        console.error("❌ Error in basic queries:", basicError);
        throw basicError;
      }

      // 2. Revenue by month (last 6 months) - disederhanakan
      let revenueByMonth = [];
      try {
        console.log("🔄 Running revenue by month query...");
        revenueByMonth = await db.query(
          `SELECT 
            DATE_FORMAT(created_at, '%Y-%m') as month,
            COALESCE(SUM(amount), 0) as revenue,
            COUNT(*) as transaction_count
           FROM payments 
           WHERE created_at >= ?
           GROUP BY DATE_FORMAT(created_at, '%Y-%m')
           ORDER BY month ASC`,
          [sixMonthsAgoStr]
        );
        console.log(
          "✅ Revenue by month rows:",
          revenueByMonth[0]?.length || 0
        );
      } catch (revenueError) {
        console.error("❌ Error in revenue by month:", revenueError);
        revenueByMonth = [[], []];
      }

      // 3. Customer growth (last 6 months) - VERSI DISEDERHANAKAN
      let customerGrowth = [];
      try {
        console.log("🔄 Running customer growth query...");
        // Query yang lebih sederhana dan aman
        customerGrowth = await db.query(
          `SELECT 
            DATE_FORMAT(created_at, '%Y-%m') as month,
            COUNT(*) as new_customers
           FROM customers 
           WHERE created_at >= ?
           GROUP BY DATE_FORMAT(created_at, '%Y-%m')
           ORDER BY month ASC`,
          [sixMonthsAgoStr]
        );

        // Hitung total kumulatif secara manual di JavaScript
        if (customerGrowth[0] && customerGrowth[0].length > 0) {
          let runningTotal = 0;
          const totalCustomers = totalCustomersResult[0][0]?.count || 0;

          // Get count of customers before 6 months ago
          const beforeCountResult = await db.query(
            "SELECT COUNT(*) as count FROM customers WHERE created_at < ?",
            [sixMonthsAgoStr]
          );
          const beforeCount = beforeCountResult[0][0]?.count || 0;
          runningTotal = beforeCount;

          // Add new customers for each month
          const processedGrowth = customerGrowth[0].map((row) => {
            runningTotal += row.new_customers;
            return {
              month: row.month,
              new_customers: row.new_customers,
              total_customers: runningTotal,
            };
          });

          customerGrowth[0] = processedGrowth;
        }
        console.log("✅ Customer growth rows:", customerGrowth[0]?.length || 0);
      } catch (growthError) {
        console.error("❌ Error in customer growth:", growthError);
        customerGrowth = [[], []];
      }

      // 4. Customer status distribution
      let customerStatus = [];
      try {
        customerStatus = await db.query(
          "SELECT status, COUNT(*) as count FROM customers GROUP BY status"
        );
      } catch (error) {
        console.error("Error in customer status:", error);
        customerStatus = [[], []];
      }

      // 5. Invoice status distribution
      let invoiceStatus = [];
      try {
        invoiceStatus = await db.query(
          `SELECT 
            status,
            COUNT(*) as count,
            COALESCE(SUM(amount), 0) as total_amount
           FROM invoices 
           GROUP BY status`
        );
      } catch (error) {
        console.error("Error in invoice status:", error);
        invoiceStatus = [[], []];
      }

      // 6. Recent activities - dibatasi query yang lebih sederhana
      let recentActivities = [];
      try {
        recentActivities = await db.query(
          `SELECT 
            l.*,
            a.name as admin_name,
            c.name as customer_name
           FROM logs l
           LEFT JOIN admins a ON l.admin_id = a.id
           LEFT JOIN customers c ON l.entity_id = c.id AND l.entity = 'customer'
           ORDER BY l.created_at DESC 
           LIMIT 10`
        );
      } catch (error) {
        console.error("Error in recent activities:", error);
        recentActivities = [[], []];
      }

      // 7. Expiring soon details
      let expiringSoonDetails = [];
      try {
        expiringSoonDetails = await db.query(
          `SELECT 
            c.id,
            c.name,
            c.username_pppoe,
            c.expired_at,
            DATEDIFF(c.expired_at, CURDATE()) as days_left,
            p.name as package_name
           FROM customers c
           LEFT JOIN packages p ON c.package_id = p.id
           WHERE c.expired_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) 
           AND c.status = 'active'
           ORDER BY c.expired_at ASC
           LIMIT 10`
        );
      } catch (error) {
        console.error("Error in expiring soon:", error);
        expiringSoonDetails = [[], []];
      }

      // 8. Overdue invoices details
      let overdueInvoicesDetails = [];
      try {
        overdueInvoicesDetails = await db.query(
          `SELECT 
            i.*,
            c.name as customer_name,
            c.username_pppoe,
            DATEDIFF(CURDATE(), i.due_date) as days_overdue
           FROM invoices i
           JOIN customers c ON i.customer_id = c.id
           WHERE i.status = 'overdue'
           ORDER BY i.due_date ASC
           LIMIT 10`
        );
      } catch (error) {
        console.error("Error in overdue invoices:", error);
        overdueInvoicesDetails = [[], []];
      }

      // 9. Top packages
      let topPackages = [];
      try {
        topPackages = await db.query(
          `SELECT 
            p.name,
            p.price,
            COUNT(c.id) as customer_count
           FROM packages p
           LEFT JOIN customers c ON p.id = c.package_id AND c.status = 'active'
           WHERE p.is_active = 1
           GROUP BY p.id, p.name, p.price
           ORDER BY customer_count DESC
           LIMIT 5`
        );
      } catch (error) {
        console.error("Error in top packages:", error);
        topPackages = [[], []];
      }

      // 10. Payment methods
      let paymentMethods = [];
      try {
        paymentMethods = await db.query(
          `SELECT 
            payment_method,
            COUNT(*) as count,
            COALESCE(SUM(amount), 0) as total_amount
           FROM payments 
           GROUP BY payment_method`
        );
      } catch (error) {
        console.error("Error in payment methods:", error);
        paymentMethods = [[], []];
      }

      // Format the response
      const stats = {
        summary: {
          total_customers: totalCustomersResult[0][0]?.count || 0,
          active_customers: activeCustomersResult[0][0]?.count || 0,
          pending_invoices: pendingInvoicesResult[0][0]?.count || 0,
          overdue_invoices: overdueInvoicesResult[0][0]?.count || 0,
          monthly_revenue: monthlyRevenueResult[0][0]?.total || 0,
          expiring_soon: expiringSoonResult[0][0]?.count || 0,
        },
        charts: {
          revenue_by_month: revenueByMonth[0] || [],
          customer_growth: customerGrowth[0] || [],
          customer_status: customerStatus[0] || [],
          invoice_status: invoiceStatus[0] || [],
          payment_methods: paymentMethods[0] || [],
        },
        details: {
          recent_activities: recentActivities[0] || [],
          expiring_soon: expiringSoonDetails[0] || [],
          overdue_invoices: overdueInvoicesDetails[0] || [],
          top_packages: topPackages[0] || [],
        },
        updated_at: new Date().toISOString(),
      };

      console.log("✅ Dashboard statistics fetched successfully");

      res.json({
        success: true,
        message: "Dashboard statistics retrieved successfully",
        data: stats,
      });
    } catch (error) {
      console.error("❌ Error fetching dashboard stats:", error);
      console.error("Error stack:", error.stack);

      res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard statistics",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  // Get quick stats (for sidebar or widgets)
  static async getQuickStats(req, res) {
    try {
      const [
        totalCustomersResult,
        activeCustomersResult,
        pendingInvoicesResult,
        monthlyRevenueResult,
      ] = await Promise.all([
        db.query("SELECT COUNT(*) as count FROM customers"),
        db.query(
          "SELECT COUNT(*) as count FROM customers WHERE status = 'active'"
        ),
        db.query(
          "SELECT COUNT(*) as count FROM invoices WHERE status = 'pending'"
        ),
        db.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM payments 
           WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) 
           AND YEAR(created_at) = YEAR(CURRENT_DATE())`
        ),
      ]);

      res.json({
        success: true,
        data: {
          total_customers: totalCustomersResult[0][0]?.count || 0,
          active_customers: activeCustomersResult[0][0]?.count || 0,
          pending_invoices: pendingInvoicesResult[0][0]?.count || 0,
          monthly_revenue: monthlyRevenueResult[0][0]?.total || 0,
        },
      });
    } catch (error) {
      console.error("Error fetching quick stats:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quick stats",
        error: error.message,
      });
    }
  }
}

module.exports = StatsController;
