const fonnteService = require("./fonnte.service");
const db = require("../config/database");
const logger = require("../utils/logger");

class MessagingService {
  constructor() {
    this.companyName = process.env.COMPANY_NAME || "VNS NETWORK";
    this.companyAddress =
      process.env.COMPANY_ADDRESS || "Jl. Masjid Kedung panjang 4/5, 59154";
    this.csWhatsapp = process.env.CS_WHATSAPP || "628895461944";
    this.supportWhatsapp = process.env.SUPPORT_WHATSAPP || "6285724733627";
  }

  /**
   * 1. Kirim pesan invoice baru
   */
  async sendNewInvoice(invoiceId) {
    try {
      const [invoices] = await db.query(
        `
        SELECT i.*, 
          c.name as customer_name, 
          c.phone, 
          c.username_pppoe,
          p.name as package_name,
          p.price as package_price
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE i.id = ?
      `,
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const invoice = invoices[0];

      const customerData = {
        id: invoice.customer_id,
        name: invoice.customer_name,
        phone: invoice.phone,
        email: invoice.email || "",
        username_pppoe: invoice.username_pppoe || "",
      };

      const packageInfo = {
        name: invoice.package_name || "Paket Internet",
        price: invoice.package_price || "0",
      };

      logger.info(
        `📤 Sending new invoice notification for ${invoice.invoice_number}`,
      );

      const result = await fonnteService.sendInvoiceCreated(
        customerData,
        invoice,
        packageInfo,
      );

      // Log pengiriman
      await this.logMessage({
        type: "invoice_created",
        customer_id: invoice.customer_id,
        invoice_id: invoiceId,
        phone: invoice.phone,
        status: result.success ? "sent" : "failed",
        message_id: result.messageId,
        error: result.error,
      });

      return result;
    } catch (error) {
      logger.error(`Error sending new invoice notification:`, error);
      throw error;
    }
  }

  /**
   * 2. Kirim pesan reminder
   */
  async sendReminder(invoiceId, daysBefore = 1) {
    try {
      const [invoices] = await db.query(
        `
        SELECT i.*, 
          c.name as customer_name, 
          c.phone, 
          c.username_pppoe,
          c.package_id,
          p.name as package_name,
          p.price as package_price
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        LEFT JOIN packages p ON c.package_id = p.id
        WHERE i.id = ?
        AND i.status = 'pending'
      `,
        [invoiceId],
      );

      if (invoices.length === 0) {
        throw new Error(`Pending invoice ${invoiceId} not found`);
      }

      const invoice = invoices[0];

      const customerData = {
        id: invoice.customer_id,
        name: invoice.customer_name,
        phone: invoice.phone,
        email: invoice.email || "",
        username_pppoe: invoice.username_pppoe || "",
      };

      const packageInfo = {
        name: invoice.package_name || "Paket Internet",
        price: invoice.package_price || "0",
      };

      logger.info(
        `📤 Sending payment reminder for ${invoice.invoice_number} (${daysBefore} day${daysBefore > 1 ? "s" : ""} before)`,
      );

      const result = await fonnteService.sendPaymentReminder(
        customerData,
        invoice,
        packageInfo,
      );

      // Log pengiriman
      await this.logMessage({
        type: "payment_reminder",
        customer_id: invoice.customer_id,
        invoice_id: invoiceId,
        phone: invoice.phone,
        days_before: daysBefore,
        status: result.success ? "sent" : "failed",
        message_id: result.messageId,
        error: result.error,
      });

      return result;
    } catch (error) {
      logger.error(`Error sending payment reminder:`, error);
      throw error;
    }
  }

  /**
   * 3. Kirim pesan konfirmasi pembayaran
   */
  async sendPaymentConfirmation(invoiceId, paymentId) {
    try {
      const [payments] = await db.query(
        `
        SELECT p.*,
          i.invoice_number,
          i.amount,
          i.paid_date,
          c.name as customer_name,
          c.phone,
          c.username_pppoe,
          pk.name as package_name
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        JOIN customers c ON i.customer_id = c.id
        LEFT JOIN packages pk ON c.package_id = pk.id
        WHERE p.id = ?
        AND p.invoice_id = ?
      `,
        [paymentId, invoiceId],
      );

      if (payments.length === 0) {
        throw new Error(
          `Payment ${paymentId} for invoice ${invoiceId} not found`,
        );
      }

      const payment = payments[0];

      const customerData = {
        id: payment.customer_id,
        name: payment.customer_name,
        phone: payment.phone,
        email: payment.email || "",
        username_pppoe: payment.username_pppoe || "",
      };

      const invoiceData = {
        id: payment.invoice_id,
        invoice_number: payment.invoice_number,
        amount: payment.amount,
        paid_date: payment.paid_date,
      };

      const paymentInfo = {
        id: payment.id,
        payment_method: payment.payment_method,
        amount: payment.amount,
        reference: payment.reference,
      };

      const packageInfo = {
        name: payment.package_name || "Paket Internet",
      };

      logger.info(
        `📤 Sending payment confirmation for ${payment.invoice_number}`,
      );

      const result = await fonnteService.sendPaymentConfirmation(
        customerData,
        invoiceData,
        paymentInfo,
        packageInfo,
      );

      // Log pengiriman
      await this.logMessage({
        type: "payment_confirmation",
        customer_id: payment.customer_id,
        invoice_id: invoiceId,
        payment_id: paymentId,
        phone: payment.phone,
        status: result.success ? "sent" : "failed",
        message_id: result.messageId,
        error: result.error,
      });

      return result;
    } catch (error) {
      logger.error(`Error sending payment confirmation:`, error);
      throw error;
    }
  }

  /**
   * Log semua pengiriman pesan
   */
  async logMessage(logData) {
    try {
      await db.query(
        `
        INSERT INTO message_logs 
        (message_type, customer_id, invoice_id, payment_id, phone, status, message_id, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
        [
          logData.type,
          logData.customer_id || null,
          logData.invoice_id || null,
          logData.payment_id || null,
          logData.phone,
          logData.status,
          logData.message_id || null,
          logData.error || null,
        ],
      );
    } catch (error) {
      logger.error(`Error logging message:`, error);
    }
  }

  /**
   * Cek status pengiriman
   */
  async getMessageStatus(messageId) {
    try {
      return await fonnteService.getMessageStatus(messageId);
    } catch (error) {
      logger.error(`Error getting message status:`, error);
      throw error;
    }
  }
}

module.exports = new MessagingService();
