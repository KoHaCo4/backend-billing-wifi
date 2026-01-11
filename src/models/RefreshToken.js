const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class RefreshToken extends Model {
    static associate(models) {
      // Refresh token dimiliki oleh admin
      RefreshToken.belongsTo(models.Admin, { foreignKey: "admin_id" });
    }
  }

  RefreshToken.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      is_revoked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "RefreshToken",
      tableName: "refresh_tokens",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["token"] }, { fields: ["expires_at"] }],
    }
  );

  return RefreshToken;
};
