const db = require("./database");
const { safeJsonParse } = require("../utils/json");

async function loadSettings() {
  const [rows] = await db.query("SELECT settings_json FROM settings LIMIT 1");

  if (!rows.length) return {};

  return safeJsonParse(rows[0].settings_json);
}

module.exports = loadSettings;
