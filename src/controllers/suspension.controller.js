const SuspensionService = require("../services/suspension.service");

class SuspensionController {
  // Get suspension statistics
  static async getStats(req, res) {
    try {
      const stats = await SuspensionService.getSuspensionStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Get expiring soon customers
  static async getExpiringSoon(req, res) {
    try {
      const { days = 3 } = req.query;

      const result = await SuspensionService.getExpiringSoonCustomers(
        parseInt(days)
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Manual trigger auto-suspend (untuk testing)
  static async triggerAutoSuspend(req, res) {
    try {
      const adminId = req.user.id;

      console.log(`🔧 Manual trigger auto-suspend by admin ${adminId}`);

      const result = await SuspensionService.autoSuspendExpiredCustomers();

      res.json({
        success: true,
        message: "Auto-suspend triggered successfully",
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = SuspensionController;
