const db = require("../config/database");
const MidtransService = require("./midtrans.service");
const InvoiceService = require("./invoice.service");
const PaymentService = require("./payment.service");
const logger = require("../utils/logger");

class PaymentLinkService {
  /**
   * Generate unique payment link URL
   */
  static generatePaymentLinkUrl(invoiceNumber) {
    const env = process.env.NODE_ENV || "development";

    let baseUrl;
    if (env === "production") {
      baseUrl =
        process.env.FRONTEND_URL || "https://frontend-billing-wifi.vercel.app";
    } else {
      baseUrl = "http://localhost:3000"; // Hardcode untuk development
    }

    console.log(
      `🔗 Generating payment link: ${baseUrl}/payment/${invoiceNumber} (${env})`,
    );
    return `${baseUrl}/payment/${invoiceNumber}`;
  }

  // Atau lebih fleksibel:
  static generatePaymentLinkUrl(invoiceNumber) {
    // Gunakan FRONTEND_URL dari env, fallback ke localhost untuk dev
    const baseUrl =
      process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://frontend-billing-wifi.vercel.app"
        : "http://localhost:3000");

    return `${baseUrl}/payment/${invoiceNumber}`;
  }

  /**
   * Generate WhatsApp message dengan payment link yang auto-pay
   */
  static async generateWhatsAppMessageWithAutoPay(
    invoiceId,
    type = "reminder",
  ) {
    try {
      // Get invoice details
      const invoice = await InvoiceService.getInvoiceById(invoiceId);

      if (!invoice) {
        throw new Error("Invoice tidak ditemukan");
      }

      // Get customer details
      const [customers] = await db.query(
        "SELECT name, phone FROM customers WHERE id = ?",
        [invoice.customer_id],
      );

      const customer = customers[0];

      if (!customer) {
        throw new Error("Customer tidak ditemukan");
      }

      // Generate payment link dengan auto-pay parameter
      const paymentLink = `${this.generatePaymentLinkUrl(invoice.invoice_number)}?auto=1`;

      // Format amount
      const amount = parseFloat(invoice.amount).toLocaleString("id-ID");

      let message = "";

      switch (type) {
        case "reminder":
          message = `Salam ${customer.name}

Kami informasikan tagihan anda senilai Rp ${amount} belum di bayar, Mohon Segera lakukan pembayaran sebelum Account anda terisolir.
Abaikan pesan ini bila sudah membayar.

*Metode Pembayaran Otomatis*
Bank Virtual Account, OVO, DANA, LinkAja, ShopeePay, Alfamart, QRIS
Klik => ${paymentLink}

Untuk informasi lainnya silahkan hubungi nomor Whatsapp

https://wa.me/628895461944 untuk Customer Service
https://wa.me/6285724733627 untuk Support Gangguan



Salam Hormat

VnsNetwork By PT. MEGA DATA PERKASA 
connect your future
#juaranyawifi
Jl. Masjid Kedung panjang 4/5, 59154

_Ini adalah pesan otomatis - mohon untuk tidak membalas langsung ke pesan ini_
Terima kasih.`;
          break;

        case "warning":
          message = `*Peringatan!* Tagihan ${invoice.invoice_number} sebesar Rp ${amount} akan jatuh tempo.
Segera bayar melalui: ${paymentLink}`;
          break;

        case "suspension":
          message = `*AKUN AKAN DIISOLIR!*
Tagihan ${invoice.invoice_number} sebesar Rp ${amount} belum dibayar.
Bayar sekarang: ${paymentLink}
Abaikan jika sudah membayar.`;
          break;

        default:
          message = `Tagihan anda sebesar Rp ${amount} menunggu pembayaran.
Klik: ${paymentLink}`;
      }

      return {
        success: true,
        data: {
          message,
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            amount: invoice.amount,
          },
          customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
          },
          payment_link: paymentLink,
          short_link: paymentLink, // Untuk API fonnte
        },
      };
    } catch (error) {
      logger.error("Generate WhatsApp message error:", error);
      throw error;
    }
  }

  /**
   * Create Snap token untuk pembayaran langsung (public access)
   */
  static async createDirectSnapPayment(paymentCode) {
    try {
      // Validate payment link
      const validation = await InvoiceService.validatePaymentLink(paymentCode);

      if (!validation.valid) {
        throw new Error(validation.message || "Payment link tidak valid");
      }

      const invoice = validation.invoice;

      // Get customer details
      const [customers] = await db.query(
        "SELECT name, phone, email FROM customers WHERE id = ?",
        [invoice.customer_id],
      );

      const customer = customers[0] || {};

      // Prepare invoice data
      const invoiceData = {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: parseFloat(invoice.amount) || 0,
        description: invoice.description || `Tagihan WiFi - ${customer.name}`,
        package_id: invoice.package_id,
        package_name: invoice.package_name,
      };

      // Prepare customer data
      const customerData = {
        id: invoice.customer_id,
        name: customer.name || `Customer ${invoice.customer_id}`,
        email: customer.email || `${invoice.customer_id}@customer.com`,
        phone: customer.phone || "081234567890",
      };

      // Create Snap transaction
      const transaction = await MidtransService.createSnapTransaction(
        invoiceData,
        customerData,
        {
          callbacks: {
            finish: `${process.env.FRONTEND_URL}/payment/success`,
            error: `${process.env.FRONTEND_URL}/payment/error`,
            pending: `${process.env.FRONTEND_URL}/payment/pending`,
          },
          enabled_payments: [
            "credit_card",
            "bca_va",
            "bni_va",
            "bri_va",
            "other_va",
            "gopay",
            "shopeepay",
            "qris",
            "alfamart",
            "indomaret",
          ],
          expiry: {
            unit: "hours",
            duration: 24,
          },
        },
      );

      if (!transaction.success) {
        throw new Error(
          transaction.error || "Gagal membuat transaksi Midtrans",
        );
      }

      // Save payment record
      let payment;
      const existingPayment = await PaymentService.getPendingPaymentByInvoiceId(
        invoice.id,
      );

      if (existingPayment) {
        payment = await PaymentService.updatePayment(existingPayment.id, {
          order_id: transaction.orderId,
          payment_token: transaction.snapToken,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
          status: "pending",
          updated_at: new Date(),
        });
      } else {
        payment = await PaymentService.createPayment({
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          amount: invoice.amount,
          payment_method: "midtrans",
          status: "pending",
          order_id: transaction.orderId,
          payment_token: transaction.snapToken,
          payment_url: transaction.redirectUrl,
          midtrans_response: JSON.stringify(transaction.transaction),
          metadata: JSON.stringify({
            source: "payment_link",
            auto_pay: true,
            access_time: new Date(),
          }),
        });
      }

      // Extend invoice expiry
      await InvoiceService.updateInvoiceExpiry(invoice.id, 24);

      return {
        success: true,
        snap_token: transaction.snapToken,
        redirect_url: transaction.redirectUrl,
        order_id: transaction.orderId,
        payment_id: payment.id,
        invoice: {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          amount: invoice.amount,
        },
        customer: {
          id: customer.id,
          name: customer.name,
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 jam
      };
    } catch (error) {
      logger.error("Create direct Snap payment error:", error);
      throw error;
    }
  }

  /**
   * Get public payment data untuk frontend
   */
  static async getPublicPaymentData(paymentCode) {
    try {
      // Validate payment link
      const validation = await InvoiceService.validatePaymentLink(paymentCode);

      if (!validation.valid) {
        return {
          success: false,
          error: validation.message || "Payment link tidak valid",
          redirect: "/payment/expired",
        };
      }

      const invoice = validation.invoice;

      // Get customer details
      const [customers] = await db.query(
        "SELECT name, phone, email FROM customers WHERE id = ?",
        [invoice.customer_id],
      );

      const customer = customers[0] || {};

      // Get package details jika ada
      let packageInfo = {};
      if (invoice.package_id) {
        const [packages] = await db.query(
          "SELECT name, speed, price FROM packages WHERE id = ?",
          [invoice.package_id],
        );
        packageInfo = packages[0] || {};
      }

      // Check if there's already a pending payment
      const [pendingPayments] = await db.query(
        `SELECT id, order_id, status, created_at 
         FROM payments 
         WHERE invoice_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
        [invoice.id],
      );

      const pendingPayment = pendingPayments[0];

      return {
        success: true,
        data: {
          invoice: {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            amount: parseFloat(invoice.amount),
            description: invoice.description,
            due_date: invoice.due_date,
            expires_at: invoice.expires_at,
            status: invoice.status,
            package_id: invoice.package_id,
            package_name: invoice.package_name || packageInfo.name,
            package_speed: packageInfo.speed,
            created_at: invoice.created_at,
          },
          customer: {
            id: invoice.customer_id,
            name: customer.name || `Customer ${invoice.customer_id}`,
            phone: customer.phone || "",
            email: customer.email || "",
          },
          payment: pendingPayment
            ? {
                id: pendingPayment.id,
                order_id: pendingPayment.order_id,
                status: pendingPayment.status,
                created_at: pendingPayment.created_at,
              }
            : null,
          payment_code,
          is_expired: new Date(invoice.expires_at) < new Date(),
          company: {
            name: process.env.COMPANY_NAME || "VnsNetwork",
            address: "Jl. Masjid Kedung panjang 4/5, 59154",
            cs_whatsapp: "628895461944",
            support_whatsapp: "6285724733627",
          },
        },
      };
    } catch (error) {
      logger.error("Get public payment data error:", error);
      throw error;
    }
  }

  /**
   * Batch generate payment links for multiple invoices
   */
  static async batchGeneratePaymentLinks(invoiceIds) {
    try {
      const results = [];

      for (const invoiceId of invoiceIds) {
        try {
          const invoice = await InvoiceService.getInvoiceById(invoiceId);

          if (!invoice) {
            results.push({
              invoice_id: invoiceId,
              success: false,
              error: "Invoice not found",
            });
            continue;
          }

          // Generate payment link
          const paymentLink = this.generatePaymentLinkUrl(
            invoice.invoice_number,
          );

          // Generate WhatsApp message
          const messageData =
            await this.generateWhatsAppMessageWithAutoPay(invoiceId);

          results.push({
            invoice_id: invoiceId,
            invoice_number: invoice.invoice_number,
            success: true,
            payment_link: paymentLink,
            whatsapp_message: messageData.data.message,
            customer_name: messageData.data.customer.name,
            customer_phone: messageData.data.customer.phone,
          });
        } catch (error) {
          results.push({
            invoice_id: invoiceId,
            success: false,
            error: error.message,
          });
        }
      }

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      logger.error("Batch generate payment links error:", error);
      throw error;
    }
  }
}

module.exports = PaymentLinkService;
