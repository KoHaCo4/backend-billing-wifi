const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Admin extends Model {
    static associate(models) {
      // Admin bisa punya banyak logs
      Admin.hasMany(models.Log, { foreignKey: "admin_id" });
    }
  }

  Admin.init(
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
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM("admin", "superadmin"),
        defaultValue: "admin",
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      last_login: {
        type: DataTypes.DATE,
      },
    },
    {
      sequelize,
      modelName: "Admin",
      tableName: "admins",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      defaultScope: {
        attributes: { exclude: ["password"] }, // Jangan tampilkan password
      },
    }
  );

  return Admin;
};
