class MikrotikSafe {
  static async executeWithSafety(
    operation,
    config,
    username,
    operationType = "disable"
  ) {
    const MikrotikService = require("../services/mikrotik.service");
    const mikrotik = new MikrotikService(config);

    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 15000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(
          `🔄 MikroTik ${operationType} attempt ${attempt}/${MAX_RETRIES} for ${username}`
        );

        const operationPromise =
          operation === "disable"
            ? mikrotik.disablePPPoEUser(username)
            : mikrotik.enablePPPoEUser(username);

        // Add timeout
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                success: false,
                message: `Operation timeout after ${TIMEOUT_MS / 1000}s`,
              }),
            TIMEOUT_MS
          );
        });

        const result = await Promise.race([operationPromise, timeoutPromise]);

        if (result.success) {
          console.log(
            `✅ MikroTik ${operationType} successful for ${username}`
          );
          return result;
        }

        if (attempt === MAX_RETRIES) {
          console.warn(
            `⚠️ MikroTik ${operationType} failed after ${MAX_RETRIES} attempts for ${username}`
          );
          return result;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.warn(
          `⚠️ MikroTik ${operationType} error on attempt ${attempt}:`,
          error.message
        );

        if (attempt === MAX_RETRIES) {
          return {
            success: false,
            message: `Failed after ${MAX_RETRIES} attempts: ${error.message}`,
          };
        }
      }
    }

    return {
      success: false,
      message: "All attempts failed",
    };
  }
}

module.exports = MikrotikSafe;
