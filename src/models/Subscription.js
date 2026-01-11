const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Subscription extends Model {
    static associate(models) {
      // Subscription punya satu customer
      Subscription.belongsTo(models.Customer, { foreignKey: "customer_id" });
      // Subscription punya satu package
      Subscription.belongsTo(models.Package, { foreignKey: "package_id" });
      // Subscription bisa punya banyak invoices
      Subscription.hasMany(models.Invoice, { foreignKey: "subscription_id" });
    }
  }

  Subscription.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      start_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("active", "expired", "cancelled"),
        defaultValue: "active",
      },
      notes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Subscription",
      tableName: "subscriptions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Subscription;
};
