const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Package extends Model {
    static associate(models) {
      // Package bisa punya banyak customers
      Package.hasMany(models.Customer, { foreignKey: "package_id" });
      // Package bisa punya banyak subscriptions
      Package.hasMany(models.Subscription, { foreignKey: "package_id" });
    }
  }

  Package.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(50),
        unique: true,
      },
      duration_days: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
        validate: {
          min: 1,
        },
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0,
        },
      },
      shared_users: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
          min: 1,
        },
      },
      rate_limit: {
        type: DataTypes.STRING(50),
        defaultValue: "unlimited",
      },
      type: {
        type: DataTypes.ENUM("pppoe", "hotspot"),
        defaultValue: "pppoe",
      },
      profile_name: {
        type: DataTypes.STRING(100),
        defaultValue: "default",
      },
      description: {
        type: DataTypes.TEXT,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: "Package",
      tableName: "packages",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      // HAPUS defaultScope atau buat custom scopes
      scopes: {
        active: {
          where: { is_active: true },
        },
        inactive: {
          where: { is_active: false },
        },
      },
    }
  );

  return Package;
};
