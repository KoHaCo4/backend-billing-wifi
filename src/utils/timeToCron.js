function timeToCron(time) {
  if (!time || !time.includes(":")) return null;

  const [hour, minute] = time.split(":").map(Number);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("Invalid time format, expected HH:mm");
  }

  // cron format: minute hour day month weekday
  return `${minute} ${hour} * * *`;
}

module.exports = { timeToCron };
