const db = require("../config/database");
const logger = require("../utils/logger");
const CustomerService = require("../services/customer.service");

class AutoExtendJob {
  async run() {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // Find active customers whose package should auto-extend
      const [customers] = await connection.query(
        `SELECT c.*, p.duration_days, r.* 
         FROM customers c
         JOIN packages p ON c.package_id = p.id
         JOIN routers r ON c.router_id = r.id
         WHERE c.status = 'active'
         AND c.auto_renew = TRUE
         AND DATEDIFF(c.expired_at, CURDATE()) <= 1`
      );

      let extendedCount = 0;

      for (const customer of customers) {
        try {
          // Extend customer
          await CustomerService.extendCustomer(
            customer.id,
            customer.duration_days
          );
          extendedCount++;

          logger.info(
            `Auto-extended customer: ${customer.name} (${customer.username_pppoe})`
          );
        } catch (error) {
          logger.error(`Failed to auto-extend customer ${customer.id}:`, error);
          // Continue with other customers
        }
      }

      await connection.commit();

      logger.info(
        `Auto-extend completed: ${extendedCount} customer(s) extended`
      );
      return { extended: extendedCount, total: customers.length };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = new AutoExtendJob();
