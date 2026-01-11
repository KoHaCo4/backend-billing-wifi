const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Payment extends Model {
    static associate(models) {
      // Payment punya satu invoice
      Payment.belongsTo(models.Invoice, { foreignKey: "invoice_id" });
    }
  }

  Payment.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      method: {
        type: DataTypes.ENUM("cash", "transfer", "qris", "other"),
        allowNull: false,
      },
      reference: {
        type: DataTypes.STRING(100), // No referensi pembayaran
      },
      confirmed_by: {
        type: DataTypes.INTEGER, // admin_id yang mengkonfirmasi
      },
      notes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Payment",
      tableName: "payments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Payment;
};
