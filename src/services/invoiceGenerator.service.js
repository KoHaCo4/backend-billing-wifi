const generateMonthlyInvoices = async () => {
  const today = new Date();
  const currentDay = today.getDate();

  // 1. Cari customers dengan auto_billing = TRUE
  //    dan billing_cycle_day = hari ini
  const customers = await Customer.findAll({
    where: {
      auto_billing: true,
      billing_cycle_day: currentDay,
      status: "active",
    },
    include: [Package],
  });

  for (const customer of customers) {
    try {
      // 2. Cek apakah sudah ada invoice bulan ini
      const existingInvoice = await Invoice.findOne({
        where: {
          customer_id: customer.id,
          status: "pending",
          created_at: {
            [Op.gte]: startOfMonth(today),
            [Op.lte]: endOfMonth(today),
          },
        },
      });

      if (!existingInvoice) {
        // 3. Generate invoice baru
        const invoice = await Invoice.create({
          customer_id: customer.id,
          package_id: customer.package_id,
          amount: customer.Package.price,
          due_date: addDays(today, 7), // Due date 7 hari dari sekarang
          status: "pending",
          invoice_number: generateInvoiceNumber(),
          description: `Tagihan bulanan ${formatMonth(today)}`,
        });

        // 4. Update customer billing dates
        await customer.update({
          last_billed_date: today,
          next_billing_date: addMonths(today, 1),
        });

        // 5. Log activity
        await Log.create({
          admin_id: 0, // System generated
          action: "auto_invoice_generation",
          description: `Auto generated invoice #${invoice.invoice_number} for customer ${customer.name}`,
          ip_address: "system",
        });

        // 6. Send notification (akan diimplementasi nanti)
        // await sendPaymentReminder(customer, invoice);
      }
    } catch (error) {
      console.error(
        `Failed to generate invoice for customer ${customer.id}:`,
        error
      );
      // Log error untuk debugging
    }
  }
};
