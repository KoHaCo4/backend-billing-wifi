const logger = require("./logger");

class PhoneUtils {
  /**
   * Normalize Indonesian phone number to Fonnte format
   * @param {string} phone - Raw phone number
   * @returns {string} - Normalized phone number (85123456789)
   */
  static normalizeToFonnte(phone) {
    try {
      if (!phone) return null;

      let normalized = phone.toString().trim();
      logger.debug(`📱 Normalizing phone: ${normalized}`);

      // Step 1: Remove all non-digit except +
      normalized = normalized.replace(/[^\d+]/g, "");
      logger.debug(`📱 After removing special chars: ${normalized}`);

      // Step 2: Convert +62 to 0
      if (normalized.startsWith("+62")) {
        normalized = "0" + normalized.substring(3);
        logger.debug(`📱 +62 to 0: ${normalized}`);
      }

      // Step 3: Convert 62 to 0
      if (normalized.startsWith("62")) {
        normalized = "0" + normalized.substring(2);
        logger.debug(`📱 62 to 0: ${normalized}`);
      }

      // Step 4: Remove all non-digit
      normalized = normalized.replace(/\D/g, "");
      logger.debug(`📱 Digits only: ${normalized}`);

      // Step 5: Remove leading 0 for Fonnte
      if (normalized.startsWith("0")) {
        normalized = normalized.substring(1);
        logger.debug(`📱 Remove leading 0: ${normalized}`);
      }

      // Step 6: Validate
      if (this.isValidIndonesianNumber(normalized)) {
        logger.debug(`✅ Valid normalized number: ${normalized}`);
        return normalized;
      } else {
        logger.warn(
          `⚠️ Invalid number after normalization: ${normalized} (from: ${phone})`,
        );
        return null;
      }
    } catch (error) {
      logger.error(`❌ Error normalizing phone ${phone}:`, error);
      return null;
    }
  }

  /**
   * Check if number is valid Indonesian mobile number
   * @param {string} phone - Phone number (without 0)
   * @returns {boolean}
   */
  static isValidIndonesianNumber(phone) {
    if (!phone || typeof phone !== "string") return false;

    // Clean the number
    const clean = phone.replace(/\D/g, "");

    // Check length
    if (clean.length < 10 || clean.length > 13) {
      logger.debug(`❌ Invalid length: ${clean.length}`);
      return false;
    }

    // Check if starts with 8 or 9 (mobile)
    if (!clean.match(/^[89]/)) {
      logger.debug(`❌ Doesn't start with 8 or 9: ${clean}`);
      return false;
    }

    // Common Indonesian mobile prefixes
    const prefixes = [
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89", // Telkomsel
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89", // Indosat
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89", // XL
      "81",
      "82",
      "83",
      "84",
      "85",
      "86",
      "87",
      "88",
      "89", // Tri/3
    ];

    const firstTwo = clean.substring(0, 2);
    if (!prefixes.includes(firstTwo)) {
      logger.debug(`❌ Unrecognized prefix: ${firstTwo}`);
      // Still return true because new prefixes might emerge
    }

    return true;
  }

  /**
   * Format phone number for display
   * @param {string} phone - Raw phone number
   * @returns {string} - Formatted number (0812-3456-7890)
   */
  static formatForDisplay(phone) {
    try {
      if (!phone) return "";

      let formatted = phone.toString().trim().replace(/\D/g, "");

      if (formatted.length === 11) {
        return `${formatted.substring(0, 4)}-${formatted.substring(4, 8)}-${formatted.substring(8)}`;
      } else if (formatted.length === 12) {
        return `${formatted.substring(0, 4)}-${formatted.substring(4, 8)}-${formatted.substring(8)}`;
      } else if (formatted.length === 13) {
        return `${formatted.substring(0, 4)}-${formatted.substring(4, 9)}-${formatted.substring(9)}`;
      }

      return formatted;
    } catch (error) {
      return phone;
    }
  }

  /**
   * Test multiple phone formats
   * @param {string} phone - Phone number to test
   */
  static testPhoneFormats(phone) {
    console.log(`\n🧪 Testing phone: ${phone}`);

    const formats = [
      phone,
      phone.replace(/\D/g, ""),
      phone.replace(/\D/g, "").replace(/^0/, ""),
      phone.replace(/\D/g, "").replace(/^62/, "").replace(/^0/, ""),
      "62" + phone.replace(/\D/g, "").replace(/^62/, "").replace(/^0/, ""),
      "+62" + phone.replace(/\D/g, "").replace(/^62/, "").replace(/^0/, ""),
    ];

    formats.forEach((format, i) => {
      const normalized = this.normalizeToFonnte(format);
      const isValid = this.isValidIndonesianNumber(normalized);
      console.log(
        `${i + 1}. ${format} -> ${normalized} (${isValid ? "✅" : "❌"})`,
      );
    });
  }
}

module.exports = PhoneUtils;
