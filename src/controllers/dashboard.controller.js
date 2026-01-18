const { pool } = require("../models");

class DashboardController {
  static async getDashboardStats(req, res) {
    let connection;
    try {
      connection = await pool.getConnection();

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      // Hitung tanggal awal dan akhir bulan ini
      const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
      const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

      // Hitung tanggal awal dan akhir bulan sebelumnya
      const startOfLastMonth = new Date(currentYear, currentMonth - 2, 1);
      const endOfLastMonth = new Date(
        currentYear,
        currentMonth - 1,
        0,
        23,
        59,
        59,
      );

      console.log("📊 Calculating dashboard statistics...");

      // 1. Hitung statistik customer
      const [customerRows] = await connection.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
          SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive
        FROM customers
      `);

      const customerCounts = customerRows[0];
      const totalCustomers = parseInt(customerCounts.total) || 0;
      const activeCustomers = parseInt(customerCounts.active) || 0;
      const expiredCustomers = parseInt(customerCounts.expired) || 0;
      const suspendedCustomers = parseInt(customerCounts.suspended) || 0;
      const inactiveCustomers = parseInt(customerCounts.inactive) || 0;

      console.log("👥 Customer stats calculated");

      // 2. Hitung monthly revenue dari invoice yang PAID bulan ini
      const [monthlyRevenueRows] = await connection.query(
        `
        SELECT SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
          AND paid_date IS NOT NULL
          AND paid_date BETWEEN ? AND ?
      `,
        [startOfMonth, endOfMonth],
      );

      const monthlyRevenueResult = monthlyRevenueRows[0];
      let monthlyRevenue = monthlyRevenueResult.total
        ? parseFloat(monthlyRevenueResult.total)
        : 0;

      console.log(`💰 Monthly revenue (current month): ${monthlyRevenue}`);

      // 3. Jika tidak ada revenue dari paid_date, coba hitung berdasarkan created_at (issue_date)
      if (monthlyRevenue === 0) {
        console.log("⚡ No paid_date data, calculating based on created_at...");

        const [monthlyRevenueAltRows] = await connection.query(
          `
          SELECT SUM(amount) as total
          FROM invoices
          WHERE status = 'paid'
            AND created_at BETWEEN ? AND ?
        `,
          [startOfMonth, endOfMonth],
        );

        const monthlyRevenueAltResult = monthlyRevenueAltRows[0];
        monthlyRevenue = monthlyRevenueAltResult.total
          ? parseFloat(monthlyRevenueAltResult.total)
          : 0;

        console.log(`💰 Monthly revenue (alt method): ${monthlyRevenue}`);
      }

      // 4. Hitung revenue bulan sebelumnya untuk comparison
      const [lastMonthRevenueRows] = await connection.query(
        `
        SELECT SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
          AND paid_date IS NOT NULL
          AND paid_date BETWEEN ? AND ?
      `,
        [startOfLastMonth, endOfLastMonth],
      );

      const lastMonthRevenueResult = lastMonthRevenueRows[0];
      let lastMonthRevenue = lastMonthRevenueResult.total
        ? parseFloat(lastMonthRevenueResult.total)
        : 0;

      // Jika tidak ada data paid_date bulan lalu, coba berdasarkan created_at
      if (lastMonthRevenue === 0) {
        const [lastMonthRevenueAltRows] = await connection.query(
          `
          SELECT SUM(amount) as total
          FROM invoices
          WHERE status = 'paid'
            AND created_at BETWEEN ? AND ?
        `,
          [startOfLastMonth, endOfLastMonth],
        );

        const lastMonthRevenueAltResult = lastMonthRevenueAltRows[0];
        lastMonthRevenue = lastMonthRevenueAltResult.total
          ? parseFloat(lastMonthRevenueAltResult.total)
          : 0;
      }

      // Hitung persentase perubahan
      let revenueChangePercentage = 0;
      if (lastMonthRevenue > 0) {
        revenueChangePercentage =
          ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
      } else if (monthlyRevenue > 0) {
        revenueChangePercentage = 100; // Jika bulan sebelumnya 0 dan bulan ini ada revenue
      }

      console.log(
        `📈 Last month revenue: ${lastMonthRevenue}, Change: ${revenueChangePercentage.toFixed(1)}%`,
      );

      // 5. Hitung invoice statistics
      const [invoiceStatRows] = await connection.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM invoices
      `);

      const invoiceStats = invoiceStatRows[0];
      const totalInvoices = parseInt(invoiceStats.total) || 0;
      const pendingInvoices = parseInt(invoiceStats.pending) || 0;
      const paidInvoices = parseInt(invoiceStats.paid) || 0;
      const overdueInvoices = parseInt(invoiceStats.overdue) || 0;
      const cancelledInvoices = parseInt(invoiceStats.cancelled) || 0;

      console.log(
        `📄 Invoice stats: Pending: ${pendingInvoices}, Overdue: ${overdueInvoices}, Paid: ${paidInvoices}, Cancelled: ${cancelledInvoices}`,
      );

      // 6. Dapatkan recent invoices sebagai recent activities
      const [recentInvoiceRows] = await connection.query(`
        SELECT i.*, c.name as customer_name, c.username_pppoe
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        ORDER BY i.updated_at DESC
        LIMIT 5
      `);

      const recentActivities = recentInvoiceRows.map((invoice) => {
        let action = "";
        let type = "billing";

        switch (invoice.status) {
          case "paid":
            action = `Invoice ${invoice.invoice_number} dibayar oleh ${invoice.customer_name}`;
            break;
          case "pending":
            action = `Invoice ${invoice.invoice_number} dibuat untuk ${invoice.customer_name}`;
            break;
          case "overdue":
            action = `Invoice ${invoice.invoice_number} jatuh tempo untuk ${invoice.customer_name}`;
            break;
          case "cancelled":
            action = `Invoice ${invoice.invoice_number} dibatalkan untuk ${invoice.customer_name}`;
            break;
          default:
            action = `Invoice ${invoice.invoice_number} diupdate`;
        }

        return {
          action,
          time: getTimeAgo(invoice.updated_at),
          type,
          customerName: invoice.customer_name,
          amount: invoice.amount,
        };
      });

      // 7. Jika tidak ada recent invoices, ambil dari customer updates
      if (recentActivities.length === 0) {
        const [recentCustomerRows] = await connection.query(`
          SELECT * FROM customers
          ORDER BY updated_at DESC
          LIMIT 5
        `);

        recentCustomerRows.forEach((customer) => {
          recentActivities.push({
            action: `Customer ${customer.name} ${getCustomerStatusAction(customer.status)}`,
            time: getTimeAgo(customer.updated_at),
            type: "billing",
            customerName: customer.name,
          });
        });
      }

      // 8. Hitung average invoice amount
      const [avgInvoiceRows] = await connection.query(`
        SELECT AVG(amount) as average
        FROM invoices
        WHERE status = 'paid'
      `);

      const avgInvoiceResult = avgInvoiceRows[0];
      const avgInvoiceAmount = avgInvoiceResult.average
        ? parseFloat(avgInvoiceResult.average)
        : 0;

      // 9. Hitung collection rate (percentage of invoices paid)
      const collectionRate =
        totalInvoices > 0 ? (paidInvoices / totalInvoices) * 100 : 0;

      // PERBAIKAN DI SINI: Gunakan DashboardController.getRevenueTrends daripada this.getRevenueTrends
      // 10. Hitung revenue trend (last 6 months)
      const revenueTrends = await DashboardController.getRevenueTrends(
        connection,
        6,
      );

      // 11. Hitung total revenue semua waktu
      const [totalRevenueRows] = await connection.query(`
        SELECT SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
      `);
      const totalRevenueResult = totalRevenueRows[0];
      const totalRevenue = totalRevenueResult.total
        ? parseFloat(totalRevenueResult.total)
        : 0;

      // 12. Hitung payment method breakdown
      const [paymentMethodRows] = await connection.query(`
        SELECT 
          payment_method,
          COUNT(*) as count,
          SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
          AND payment_method IS NOT NULL
        GROUP BY payment_method
        ORDER BY total DESC
      `);

      const paymentMethodBreakdown = paymentMethodRows.map((row) => ({
        method: row.payment_method,
        count: parseInt(row.count) || 0,
        total: parseFloat(row.total) || 0,
      }));

      res.json({
        success: true,
        data: {
          billing: {
            total_customers: totalCustomers,
            active_customers: activeCustomers,
            expired_customers: expiredCustomers,
            suspended_customers: suspendedCustomers,
            inactive_customers: inactiveCustomers,
            monthly_revenue: monthlyRevenue,
            last_month_revenue: lastMonthRevenue,
            revenue_change_percentage: revenueChangePercentage.toFixed(1),
            pending_invoices: pendingInvoices,
            overdue_invoices: overdueInvoices,
            paid_invoices: paidInvoices,
            cancelled_invoices: cancelledInvoices,
            total_invoices: totalInvoices,
            avg_invoice_amount: avgInvoiceAmount,
            collection_rate: collectionRate.toFixed(1),
            total_revenue: totalRevenue,
          },
          payment_method_breakdown: paymentMethodBreakdown,
          recent_activities: recentActivities,
          revenue_trends: revenueTrends,
          period: {
            month: currentMonth,
            year: currentYear,
            start_date: startOfMonth,
            end_date: endOfMonth,
          },
        },
      });
    } catch (error) {
      console.error("❌ Error getting dashboard stats:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get dashboard statistics",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      if (connection) connection.release();
    }
  }

  static async getRevenueTrends(connection, months = 6) {
    try {
      const trends = [];
      const currentDate = new Date();

      for (let i = months - 1; i >= 0; i--) {
        const targetDate = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() - i,
          1,
        );
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;

        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);

        // Coba berdasarkan paid_date dulu
        const [revenueRows] = await connection.query(
          `
          SELECT 
            SUM(amount) as total,
            COUNT(id) as invoice_count
          FROM invoices
          WHERE status = 'paid'
            AND paid_date IS NOT NULL
            AND paid_date BETWEEN ? AND ?
        `,
          [startOfMonth, endOfMonth],
        );

        let revenueResult = revenueRows[0];
        let revenue = revenueResult.total ? parseFloat(revenueResult.total) : 0;
        let invoiceCount = revenueResult.invoice_count
          ? parseInt(revenueResult.invoice_count)
          : 0;

        // Jika tidak ada data paid_date, coba berdasarkan created_at
        if (revenue === 0) {
          const [revenueAltRows] = await connection.query(
            `
            SELECT 
              SUM(amount) as total,
              COUNT(id) as invoice_count
            FROM invoices
            WHERE status = 'paid'
              AND created_at BETWEEN ? AND ?
          `,
            [startOfMonth, endOfMonth],
          );

          revenueResult = revenueAltRows[0];
          revenue = revenueResult.total ? parseFloat(revenueResult.total) : 0;
          invoiceCount = revenueResult.invoice_count
            ? parseInt(revenueResult.invoice_count)
            : 0;
        }

        trends.push({
          month: startOfMonth.toLocaleString("id-ID", {
            month: "short",
            year: "numeric",
          }),
          revenue: revenue,
          invoice_count: invoiceCount,
          avg_amount: invoiceCount > 0 ? revenue / invoiceCount : 0,
        });
      }

      return trends;
    } catch (error) {
      console.error("❌ Error calculating revenue trends:", error);
      return [];
    }
  }

  static async getMonthlyRevenue(req, res) {
    let connection;
    try {
      connection = await pool.getConnection();

      const { year, month } = req.query;
      const targetYear = year ? parseInt(year) : new Date().getFullYear();
      const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

      const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
      const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59);

      console.log(
        `📊 Getting monthly revenue for ${targetMonth}/${targetYear}`,
      );

      // 1. Total revenue dari invoice yang dibayar bulan ini
      const [paidInvoiceRows] = await connection.query(
        `
        SELECT *
        FROM invoices
        WHERE status = 'paid'
          AND paid_date BETWEEN ? AND ?
        ORDER BY paid_date ASC
      `,
        [startOfMonth, endOfMonth],
      );

      // Jika tidak ada data paid_date, coba berdasarkan created_at
      let paidInvoices = paidInvoiceRows;
      if (paidInvoiceRows.length === 0) {
        const [paidInvoiceAltRows] = await connection.query(
          `
          SELECT *
          FROM invoices
          WHERE status = 'paid'
            AND created_at BETWEEN ? AND ?
          ORDER BY created_at ASC
        `,
          [startOfMonth, endOfMonth],
        );

        paidInvoices = paidInvoiceAltRows;
      }

      const totalRevenue = paidInvoices.reduce(
        (sum, invoice) => sum + parseFloat(invoice.amount),
        0,
      );

      // 2. Breakdown per payment method
      const [paymentMethodRows] = await connection.query(
        `
        SELECT 
          payment_method,
          COUNT(id) as count,
          SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
          AND paid_date BETWEEN ? AND ?
        GROUP BY payment_method
      `,
        [startOfMonth, endOfMonth],
      );

      // 3. Top customers by spending
      const [topCustomerRows] = await connection.query(
        `
        SELECT 
          i.customer_id,
          COUNT(i.id) as invoice_count,
          SUM(i.amount) as total_spent,
          c.name as customer_name,
          c.username_pppoe
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.status = 'paid'
          AND i.paid_date BETWEEN ? AND ?
        GROUP BY i.customer_id
        ORDER BY total_spent DESC
        LIMIT 10
      `,
        [startOfMonth, endOfMonth],
      );

      // 4. Revenue per day breakdown
      const [revenuePerDayRows] = await connection.query(
        `
        SELECT 
          DATE(paid_date) as date,
          COUNT(id) as count,
          SUM(amount) as total
        FROM invoices
        WHERE status = 'paid'
          AND paid_date BETWEEN ? AND ?
        GROUP BY DATE(paid_date)
        ORDER BY date ASC
      `,
        [startOfMonth, endOfMonth],
      );

      res.json({
        success: true,
        data: {
          month: targetMonth,
          year: targetYear,
          total_revenue: totalRevenue,
          invoice_count: paidInvoices.length,
          payment_method_breakdown: paymentMethodRows,
          top_customers: topCustomerRows.map((c) => ({
            customer_id: c.customer_id,
            customer_name: c.customer_name || "Unknown",
            username: c.username_pppoe || "",
            invoice_count: c.invoice_count,
            total_spent: parseFloat(c.total_spent),
          })),
          revenue_per_day: revenuePerDayRows.map((day) => ({
            date: day.date,
            count: parseInt(day.count),
            total: parseFloat(day.total),
          })),
          start_date: startOfMonth,
          end_date: endOfMonth,
        },
      });
    } catch (error) {
      console.error("❌ Error getting monthly revenue:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get monthly revenue",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      if (connection) connection.release();
    }
  }
}

// Helper function untuk format waktu
function getTimeAgo(date) {
  if (!date) return "Baru saja";

  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Baru saja";
  if (diffMins < 60) return `${diffMins} menit lalu`;
  if (diffHours < 24) return `${diffHours} jam lalu`;
  if (diffDays === 1) return "Kemarin";
  if (diffDays < 7) return `${diffDays} hari lalu`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} minggu lalu`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} bulan lalu`;
  return `${Math.floor(diffDays / 365)} tahun lalu`;
}

// Helper function untuk aksi status customer
function getCustomerStatusAction(status) {
  switch (status) {
    case "active":
      return "diaktifkan";
    case "expired":
      return "kadaluarsa";
    case "suspended":
      return "ditangguhkan";
    case "inactive":
      return "dinonaktifkan";
    default:
      return "diperbarui";
  }
}

module.exports = DashboardController;
