const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Invoice extends Model {
    static associate(models) {
      // Invoice punya satu customer
      Invoice.belongsTo(models.Customer, { foreignKey: "customer_id" });
      // Invoice punya satu subscription (optional)
      Invoice.belongsTo(models.Subscription, { foreignKey: "subscription_id" });
      // Invoice punya banyak payments
      Invoice.hasMany(models.Payment, { foreignKey: "invoice_id" });
    }
  }

  Invoice.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      invoice_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "paid", "overdue", "cancelled"),
        defaultValue: "pending",
      },
      due_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      paid_date: {
        type: DataTypes.DATE,
      },
      payment_method: {
        type: DataTypes.ENUM("cash", "transfer", "qris", "other"),
      },
      notes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Invoice",
      tableName: "invoices",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["invoice_number"] },
        { fields: ["status"] },
        { fields: ["due_date"] },
      ],
    }
  );

  return Invoice;
};
