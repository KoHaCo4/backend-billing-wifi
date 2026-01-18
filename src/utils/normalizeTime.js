function normalizeTime(value) {
  if (value === undefined || value === null) return null;

  // sudah HH:mm
  if (typeof value === "string" && value.includes(":")) {
    return value;
  }

  // hanya jam (number / string)
  const hour = parseInt(value, 10);

  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    throw new Error(`Invalid hour value: ${value}`);
  }

  return `${hour.toString().padStart(2, "0")}:00`;
}

module.exports = normalizeTime;
