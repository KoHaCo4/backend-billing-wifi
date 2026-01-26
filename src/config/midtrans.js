const midtransClient = require("midtrans-client");

// Environment: 'sandbox' atau 'production'
const MIDTRANS_ENV = process.env.MIDTRANS_ENV || "sandbox";
const IS_PRODUCTION = MIDTRANS_ENV === "production";

// Get Midtrans keys from environment
const getMidtransKey = () => {
  if (IS_PRODUCTION) {
    return {
      serverKey: process.env.MIDTRANS_SERVER_KEY_PROD,
      clientKey: process.env.MIDTRANS_CLIENT_KEY_PROD,
    };
  }
  return {
    serverKey: process.env.MIDTRANS_SERVER_KEY_SANDBOX,
    clientKey: process.env.MIDTRANS_CLIENT_KEY_SANDBOX,
  };
};

const { serverKey, clientKey } = getMidtransKey();

// Validate keys
if (!serverKey || !clientKey) {
  console.warn(
    "⚠️  Midtrans API keys not configured! Payment gateway will not work.",
  );
  console.warn(
    "   Set MIDTRANS_SERVER_KEY_SANDBOX and MIDTRANS_CLIENT_KEY_SANDBOX in .env",
  );
}

// Create Snap instance
const snap = serverKey
  ? new midtransClient.Snap({
      isProduction: IS_PRODUCTION,
      serverKey,
      clientKey,
    })
  : null;

module.exports = {
  snap,
  isProduction: IS_PRODUCTION,
  clientKey,
  serverKey,
};
