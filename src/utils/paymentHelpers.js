/**
 * Utility functions for payment processing
 */

class PaymentHelpers {
  // Format amount for display
  static formatCurrency(amount) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  }

  // Generate payment reference
  static generateReference(prefix = "PAY") {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${prefix}-${timestamp}-${random}`;
  }

  // Generate order ID for Midtrans
  static generateOrderId(invoiceId) {
    const timestamp = Date.now();
    return `INV-${invoiceId}-${timestamp}`;
  }

  // Parse payment method name
  static getPaymentMethodName(method) {
    const methods = {
      cash: "Tunai",
      transfer: "Transfer Bank",
      qris: "QRIS",
      midtrans: "Pembayaran Online",
      gopay: "GoPay",
      shopeepay: "ShopeePay",
      credit_card: "Kartu Kredit",
      bank_transfer: "Transfer Bank",
      other: "Lainnya",
    };

    return methods[method] || method;
  }

  // Get payment method icon
  static getPaymentMethodIcon(method) {
    const icons = {
      cash: "💰",
      transfer: "🏦",
      qris: "📱",
      midtrans: "💳",
      gopay: "🟢",
      shopeepay: "🛍️",
      credit_card: "💳",
      bank_transfer: "🏦",
      other: "💸",
    };

    return icons[method] || "💸";
  }

  // Validate payment data
  static validatePaymentData(data) {
    const errors = [];

    if (!data.invoice_id) {
      errors.push("Invoice ID is required");
    }

    if (!data.customer_id) {
      errors.push("Customer ID is required");
    }

    if (!data.amount || data.amount <= 0) {
      errors.push("Valid amount is required");
    }

    if (!data.payment_method) {
      errors.push("Payment method is required");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Calculate payment expiry date
  static getPaymentExpiryDate(hours = 24) {
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return date;
  }

  // Format payment status for display
  static getStatusDisplay(status) {
    const statusMap = {
      pending: { text: "Menunggu", color: "warning", icon: "⏳" },
      completed: { text: "Berhasil", color: "success", icon: "✅" },
      paid: { text: "Dibayar", color: "success", icon: "✅" },
      failed: { text: "Gagal", color: "danger", icon: "❌" },
      expired: { text: "Kadaluarsa", color: "secondary", icon: "⏰" },
      refunded: { text: "Dikembalikan", color: "info", icon: "↩️" },
    };

    return (
      statusMap[status] || { text: status, color: "secondary", icon: "❓" }
    );
  }
}

module.exports = PaymentHelpers;
