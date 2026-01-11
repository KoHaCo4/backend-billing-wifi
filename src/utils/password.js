const bcrypt = require("bcryptjs");

class PasswordService {
  // Hash password
  static async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  // Compare password
  static async comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }
}

module.exports = PasswordService;
