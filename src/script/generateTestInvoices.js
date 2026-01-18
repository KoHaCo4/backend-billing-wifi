const { pool } = require("../models");

async function generateSimpleInvoices() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log("✅ Database connected");

    // Hapus invoice test lama
    await connection.query(
      `DELETE FROM invoices WHERE invoice_number LIKE 'INV-%'`,
    );
    console.log("🧹 Cleaned old test invoices");

    // Ambil 10 customer aktif
    const [customers] = await connection.query(`
      SELECT id, name, package_id 
      FROM customers 
      WHERE status = 'active' 
      LIMIT 10
    `);

    if (customers.length === 0) {
      console.log("⚠️ No active customers found");
      return;
    }

    console.log(`Found ${customers.length} customers`);

    const invoices = [];
    const now = new Date();
    let invoiceNum = 1000;

    // Cek apakah ada user untuk foreign key
    let hasUsers = false;
    try {
      const [users] = await connection.query(`SELECT id FROM users LIMIT 1`);
      hasUsers = users.length > 0;
    } catch (error) {
      console.log("ℹ️ Users table not accessible");
    }

    customers.forEach((customer) => {
      // Buat 2-3 invoice per customer
      const numInvoices = Math.floor(Math.random() * 3) + 1;

      for (let i = 0; i < numInvoices; i++) {
        invoiceNum++;
        const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${invoiceNum}`;

        // Random amount 100k - 300k
        const amount = Math.floor(Math.random() * 200000) + 100000;

        // Random status
        const rand = Math.random();
        let status = "pending";
        let paidDate = null;
        let paymentMethod = null;

        if (rand < 0.6) {
          status = "paid";
          // Paid within last 30 days
          const daysAgo = Math.floor(Math.random() * 30);
          paidDate = new Date(now);
          paidDate.setDate(paidDate.getDate() - daysAgo);
          paymentMethod = ["cash", "transfer", "qris"][
            Math.floor(Math.random() * 3)
          ];
        } else if (rand < 0.8) {
          status = "pending";
        } else if (rand < 0.95) {
          status = "overdue";
        } else {
          status = "cancelled";
        }

        // Dates
        const issueDate = new Date(now);
        issueDate.setDate(issueDate.getDate() - Math.floor(Math.random() * 60)); // 0-60 days ago
        const dueDate = new Date(issueDate);
        dueDate.setDate(dueDate.getDate() + 30); // 30 days after issue

        // Bangun data invoice - HANYA kolom yang diperlukan
        const invoiceData = {
          invoice_number: invoiceNumber,
          customer_id: customer.id,
          subscription_id: null,
          package_id: customer.package_id,
          package_name: null,
          subtotal: amount,
          tax_amount: 0,
          discount_amount: 0,
          amount: amount,
          description: `Invoice for ${customer.name}`,
          invoice_type: "regular",
          status: status,
          issue_date: issueDate.toISOString().split("T")[0],
          due_date: dueDate.toISOString().split("T")[0],
          paid_date: paidDate ? paidDate.toISOString().split("T")[0] : null,
          payment_method: paymentMethod,
          reference_number: null,
          payment_notes: null,
          // Kolom user diisi hanya jika ada user dan foreign key valid
          created_by: hasUsers ? 1 : null,
          paid_by: status === "paid" && hasUsers ? 1 : null,
          cancelled_by: status === "cancelled" && hasUsers ? 1 : null,
          cancellation_reason: status === "cancelled" ? "Test data" : null,
          is_recurring: 0,
          next_billing_date: null,
          created_at: issueDate,
          updated_at: new Date(),
        };

        invoices.push(invoiceData);
      }
    });

    console.log(`\n📝 Generated ${invoices.length} invoices`);

    // Insert satu per satu untuk debugging
    let inserted = 0;
    let failed = 0;

    for (const invoice of invoices) {
      try {
        // Buat query INSERT tanpa kolom yang mungkin menyebabkan foreign key error
        const safeInvoice = { ...invoice };

        // Jika tidak ada user, hapus kolom user reference
        if (!hasUsers) {
          delete safeInvoice.created_by;
          delete safeInvoice.paid_by;
          delete safeInvoice.cancelled_by;
        }

        const columns = Object.keys(safeInvoice);
        const values = columns.map((col) => safeInvoice[col]);
        const placeholders = columns.map(() => "?").join(", ");

        await connection.query(
          `
          INSERT INTO invoices (${columns.join(", ")}) 
          VALUES (${placeholders})
        `,
          values,
        );

        inserted++;
        if (inserted % 5 === 0) {
          console.log(`✅ Inserted ${inserted} invoices...`);
        }
      } catch (error) {
        failed++;
        console.error(
          `❌ Failed to insert invoice ${invoice.invoice_number}:`,
          error.message,
        );

        // Coba insert dengan kolom minimum
        try {
          const minimalInvoice = {
            invoice_number: invoice.invoice_number,
            customer_id: invoice.customer_id,
            subtotal: invoice.subtotal,
            amount: invoice.amount,
            status: invoice.status,
            issue_date: invoice.issue_date,
            due_date: invoice.due_date,
            created_at: invoice.created_at,
            updated_at: invoice.updated_at,
          };

          await connection.query(
            `
            INSERT INTO invoices SET ?
          `,
            minimalInvoice,
          );

          inserted++;
          failed--;
          console.log(
            `  ✅ Minimal insert successful for ${invoice.invoice_number}`,
          );
        } catch (minimalError) {
          console.error(
            `  ❌ Minimal insert also failed:`,
            minimalError.message,
          );
        }
      }
    }

    console.log(
      `\n📊 Insertion complete: ${inserted} successful, ${failed} failed`,
    );

    // Show stats
    const [stats] = await connection.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(amount) as total_amount
      FROM invoices
    `);

    console.log("\n📊 Summary:");
    console.log(`  Total invoices: ${stats[0].total}`);
    console.log(`  Paid: ${stats[0].paid}`);
    console.log(`  Pending: ${stats[0].pending}`);
    console.log(`  Overdue: ${stats[0].overdue}`);
    console.log(`  Cancelled: ${stats[0].cancelled}`);
    console.log(
      `  Total amount: Rp ${parseFloat(stats[0].total_amount || 0).toLocaleString("id-ID")}`,
    );

    // Hitung monthly revenue untuk testing dashboard
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const [monthlyStats] = await connection.query(
      `
      SELECT 
        SUM(amount) as monthly_revenue,
        COUNT(*) as monthly_count
      FROM invoices
      WHERE status = 'paid'
        AND MONTH(paid_date) = ?
        AND YEAR(paid_date) = ?
    `,
      [currentMonth, currentYear],
    );

    console.log(
      `\n💰 Current month revenue: Rp ${parseFloat(monthlyStats[0].monthly_revenue || 0).toLocaleString("id-ID")} (${monthlyStats[0].monthly_count || 0} invoices)`,
    );
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  } finally {
    if (connection) connection.release();
  }
}

// Jalankan
if (require.main === module) {
  generateSimpleInvoices()
    .then(() => {
      console.log("\n✨ Done!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Failed:", error);
      process.exit(1);
    });
}

module.exports = { generateSimpleInvoices };
