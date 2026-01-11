const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Router extends Model {
    static associate(models) {
      // Router bisa punya banyak customers
      Router.hasMany(models.Customer, { foreignKey: "router_id" });
    }
  }

  Router.init(
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
      ip_address: {
        type: DataTypes.STRING(45), // Support IPv6
        allowNull: false,
      },
      api_port: {
        type: DataTypes.INTEGER,
        defaultValue: 8728,
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("mikrotik", "routeros", "other"),
        defaultValue: "mikrotik",
      },
      description: {
        type: DataTypes.TEXT,
      },
      is_online: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      last_checked: {
        type: DataTypes.DATE,
      },
      customer_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: "Router",
      tableName: "routers",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return Router;
};
