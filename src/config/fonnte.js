const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  fonnte: {
    apiUrl: process.env.FONNTE_API_URL || "https://api.fonnte.com",
    apiToken: process.env.FONNTE_API_TOKEN,
    deviceId: process.env.FONNTE_DEVICE_ID,
    defaultSender: process.env.FONNTE_DEFAULT_SENDER || "BillingWifi",
    // Template messages
    templates: {
      subscriptionReminder: {
        id: "subscription_reminder_1day",
        message: `Halo {{customer_name}},\n\nMasa aktif paket internet Anda akan berakhir dalam 1 hari ({{expiry_date}}).\n\nSegera lakukan pembayaran untuk menghindari pemutusan layanan.\n\nDetail Paket:\n- Paket: {{package_name}}\n- Harga: {{package_price}}\n- Expired: {{expiry_date}}\n\nTerima kasih,\n{{company_name}}`,
      },
    },
  },
};
