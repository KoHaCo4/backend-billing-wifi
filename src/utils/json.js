function safeJsonParse(value) {
  if (!value) return {};

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("❌ Invalid JSON:", value);
    return {};
  }
}

module.exports = {
  safeJsonParse,
};
