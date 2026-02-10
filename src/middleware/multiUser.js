const db = require("../config/database");

const multiUserMiddleware = {
  // Middleware untuk memeriksa apakah admin bisa mengakses data
  checkDataAccess: (tableName, idField = "id") => {
    return async (req, res, next) => {
      try {
        const { id, role } = req.admin; // Dari middleware auth

        if (role === "superadmin") {
          return next(); // Superadmin bisa akses semua
        }

        const dataId = req.params[idField];

        // Cek apakah data milik admin atau dishare
        const query = `
          SELECT admin_id, is_shared, shared_with 
          FROM ${tableName} 
          WHERE id = ?
        `;

        db.query(query, [dataId], (error, results) => {
          if (error) {
            return res.status(500).json({ error: "Database error" });
          }

          if (results.length === 0) {
            return res.status(404).json({ error: "Data not found" });
          }

          const data = results[0];

          // Cek apakah data milik admin
          if (data.admin_id === id) {
            return next();
          }

          // Cek apakah data dishare ke admin ini
          if (data.is_shared && data.shared_with) {
            const sharedWith = JSON.parse(data.shared_with);
            if (sharedWith.includes(id)) {
              return next();
            }
          }

          return res.status(403).json({ error: "Access denied" });
        });
      } catch (error) {
        console.error("Multi-user middleware error:", error);
        res.status(500).json({ error: "Server error" });
      }
    };
  },

  // Middleware untuk filtering query berdasarkan user role
  filterByUser: (req, res, next) => {
    const { id, role } = req.admin;

    if (role === "superadmin") {
      req.userFilter = ""; // No filter for superadmin
      req.filterParams = [];
    } else {
      // Regular admin can only see their own data + shared data
      req.userFilter = `
        WHERE (admin_id = ? OR (is_shared = 1 AND JSON_CONTAINS(shared_with, CAST(? AS JSON))))
      `;
      req.filterParams = [id, JSON.stringify([id])];
    }

    next();
  },

  // Middleware untuk memastikan hanya superadmin yang bisa akses
  requireSuperAdmin: (req, res, next) => {
    if (req.admin.role !== "superadmin") {
      return res.status(403).json({ error: "Superadmin access required" });
    }
    next();
  },
};

module.exports = multiUserMiddleware;
