const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Customer extends Model {
    static associate(models) {
      // Customer punya satu package
      Customer.belongsTo(models.Package, { foreignKey: "package_id" });
      // Customer punya satu router
      Customer.belongsTo(models.Router, { foreignKey: "router_id" });
      // Customer punya banyak invoices
      Customer.hasMany(models.Invoice, { foreignKey: "customer_id" });
      // Customer punya banyak subscriptions
      Customer.hasMany(models.Subscription, { foreignKey: "customer_id" });
    }
  }

  Customer.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username_pppoe: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        field: "username_pppoe", // Mapping ke kolom database
      },
      password_pppoe: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "password_pppoe",
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(100),
        validate: {
          isEmail: true,
        },
      },
      phone: {
        type: DataTypes.STRING(20),
      },
      address: {
        type: DataTypes.TEXT,
      },
      status: {
        type: DataTypes.ENUM("active", "expired", "suspended"),
        defaultValue: "active",
      },
      expired_at: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "expired_at",
      },
      auto_renew: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      mikrotik_id: {
        type: DataTypes.STRING(50), // ID user di MikroTik
      },
      notes: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Customer",
      tableName: "customers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        { fields: ["username"] },
        { fields: ["status"] },
        { fields: ["expiration_date"] },
      ],
    }
  );

  return Customer;
};
