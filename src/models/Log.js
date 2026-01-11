const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Log extends Model {
    static associate(models) {
      // Log dibuat oleh admin
      Log.belongsTo(models.Admin, { foreignKey: "admin_id" });
    }
  }

  Log.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      table_name: {
        type: DataTypes.STRING(50),
      },
      record_id: {
        type: DataTypes.INTEGER,
      },
      old_data: {
        type: DataTypes.TEXT,
      },
      new_data: {
        type: DataTypes.TEXT,
      },
      ip_address: {
        type: DataTypes.STRING(45),
      },
      user_agent: {
        type: DataTypes.TEXT,
      },
    },
    {
      sequelize,
      modelName: "Log",
      tableName: "logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false, // Tidak perlu updated_at untuk log
    }
  );

  return Log;
};
