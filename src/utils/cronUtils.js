const logger = require("./logger");

class CronUtils {
  static parseExpression(schedule, options = {}) {
    try {
      // Coba load cron-parser
      const cronParser = require("cron-parser");

      return cronParser.parseExpression(schedule, {
        tz: options.timezone || "Asia/Jakarta",
        currentDate: options.currentDate || new Date(),
        ...options,
      });
    } catch (error) {
      logger.error("Failed to load cron-parser:", error.message);
      throw error;
    }
  }

  static getNextRun(schedule, options = {}) {
    try {
      const interval = this.parseExpression(schedule, options);
      return interval.next().toDate();
    } catch (error) {
      logger.warn("Using manual cron calculation:", error.message);
      return this.calculateNextRunManually(schedule, options.currentDate);
    }
  }

  static calculateNextRunManually(schedule, currentDate = new Date()) {
    const now = currentDate || new Date();
    const next = new Date(now);

    // Parse schedule sederhana
    if (schedule === "*/5 * * * *") {
      // Setiap 5 menit
      const minutes = now.getMinutes();
      next.setMinutes(minutes + 5 - (minutes % 5));
      next.setSeconds(0);
      next.setMilliseconds(0);

      // Jika waktu sudah lewat, tambah 5 menit
      if (next <= now) {
        next.setMinutes(next.getMinutes() + 5);
      }

      return next;
    }

    if (schedule === "0 9 * * *") {
      // Setiap hari jam 09:00
      next.setHours(9, 0, 0, 0);

      // Jika sudah lewat hari ini, set untuk besok
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }

      return next;
    }

    // Default: tidak dikenali, return 1 jam dari sekarang
    next.setHours(next.getHours() + 1);
    return next;
  }

  static getNextRuns(schedule, count = 3, options = {}) {
    const runs = [];

    try {
      // Coba dengan cron-parser
      const interval = this.parseExpression(schedule, options);

      for (let i = 0; i < count; i++) {
        runs.push(interval.next().toDate());
      }

      return runs;
    } catch (error) {
      // Fallback manual
      let currentDate = options.currentDate || new Date();

      for (let i = 0; i < count; i++) {
        const nextRun = this.calculateNextRunManually(schedule, currentDate);
        runs.push(nextRun);
        currentDate = new Date(nextRun.getTime() + 1000); // Tambah 1 detik
      }

      return runs;
    }
  }
}

module.exports = CronUtils;
