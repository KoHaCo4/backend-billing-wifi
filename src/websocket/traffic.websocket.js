const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const db = require("../config/database");
const MikrotikTrafficService = require("../services/mikrotik-traffic.service");

// Hybrid WebSocket Server - Menggabungkan port yang sama dengan HTTP
const wss = new WebSocket.Server({
  noServer: true, // Akan diattach ke HTTP server
  path: "/ws/traffic",
});

// Store untuk data real-time
const trafficData = {
  interfaces: [],
  activeSessions: [],
  systemStats: {},
};

// Store active connections dengan metadata
const activeConnections = new Map();

// Helper: Generate token
function generateAccessToken(payload) {
  return jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET || "access-secret",
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || "12h" }, // Lebih lama untuk WebSocket
  );
}

// Helper: Validate token
function validateToken(token, type = "access") {
  try {
    const secret =
      type === "access"
        ? process.env.JWT_ACCESS_SECRET || "access-secret"
        : process.env.JWT_REFRESH_SECRET || "refresh-secret";

    return jwt.verify(token, secret);
  } catch (error) {
    return null;
  }
}

// Helper: Check if token expired
function isTokenExpired(token) {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) return true;

    const now = Math.floor(Date.now() / 1000);
    return decoded.exp < now;
  } catch (error) {
    return true;
  }
}

// Refresh token mechanism
async function refreshAccessToken(refreshToken, userId) {
  try {
    console.log("🔄 Attempting token refresh...");

    // 1. Validate refresh token
    const decodedRefresh = validateToken(refreshToken, "refresh");
    if (!decodedRefresh) {
      throw new Error("Invalid refresh token");
    }

    // 2. Check in database
    const [tokens] = await db.query(
      `SELECT * FROM refresh_tokens 
       WHERE token = ? AND admin_id = ? AND revoked = 0 AND expires_at > NOW()`,
      [refreshToken, userId],
    );

    if (tokens.length === 0) {
      throw new Error("Refresh token not found or revoked");
    }

    // 3. Get user data
    const [users] = await db.query(
      "SELECT id, email, name, role FROM admins WHERE id = ? AND status = 'active'",
      [userId],
    );

    if (users.length === 0) {
      throw new Error("User not found");
    }

    const user = users[0];

    // 4. Generate new access token
    const newAccessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    console.log(`✅ Token refreshed for user: ${user.email}`);

    return {
      success: true,
      accessToken: newAccessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    };
  } catch (error) {
    console.error("❌ Token refresh failed:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Kirim data ke semua connected clients
function broadcastToAll(data) {
  activeConnections.forEach((connection) => {
    if (
      connection.ws.readyState === WebSocket.OPEN &&
      connection.authenticated
    ) {
      connection.ws.send(JSON.stringify(data));
    }
  });
}

// Function untuk update traffic data secara berkala
async function updateTrafficData() {
  try {
    console.log("📡 Updating traffic data for WebSocket...");

    // 1. Ambil data dari router aktif
    const [routers] = await db.query(
      "SELECT * FROM routers WHERE status = 'active' LIMIT 1",
    );

    if (routers.length > 0) {
      const router = routers[0];
      const trafficService = new MikrotikTrafficService(router);

      // 2. Ambil data interfaces
      try {
        const interfaces = await trafficService.getInterfacesTraffic();
        trafficData.interfaces = interfaces;
      } catch (interfaceError) {
        console.warn("❌ Failed to get interfaces:", interfaceError.message);
        // Fallback: dummy data
        trafficData.interfaces = [
          {
            interface_name: "ether1",
            rx_rate: 1250000 + Math.random() * 500000,
            tx_rate: 625000 + Math.random() * 250000,
            rx_bytes: 45000000000,
            tx_bytes: 22500000000,
            running: true,
          },
        ];
      }

      // 3. Ambil active sessions
      try {
        const sessions = await trafficService.getPPPoEActiveSessions();
        trafficData.activeSessions = sessions;
      } catch (sessionError) {
        console.warn("❌ Failed to get sessions:", sessionError.message);
        trafficData.activeSessions = [];
      }
    }

    // 4. Ambil system stats dari database
    const [stats] = await db.query(`
      SELECT 
        COUNT(DISTINCT c.id) as active_customers,
        COUNT(DISTINCT r.id) as active_routers,
        COALESCE(SUM(c.current_usage), 0) as total_usage
      FROM customers c
      LEFT JOIN routers r ON c.router_id = r.id
      WHERE c.status = 'active'
    `);

    trafficData.systemStats = stats[0] || {};

    // 5. Broadcast ke semua authenticated clients
    broadcastToAll({
      type: "traffic_update",
      data: {
        timestamp: new Date().toISOString(),
        interfaces: trafficData.interfaces,
        activeSessions: trafficData.activeSessions,
        systemStats: trafficData.systemStats,
      },
    });

    console.log("✅ Traffic data updated and broadcasted");
  } catch (error) {
    console.error("❌ Error updating traffic data:", error.message);
  }
}

// Setup interval untuk update data (setiap 3 detik)
setInterval(updateTrafficData, 3000);

// Initial data load
updateTrafficData();

// WebSocket connection handler
wss.on("connection", async (ws, req) => {
  console.log("🔌 New WebSocket connection attempt");

  try {
    // Parse URL untuk mendapatkan tokens
    const url = new URL(`ws://${req.headers.host}${req.url}`);
    const accessToken = url.searchParams.get("token");
    const refreshToken = url.searchParams.get("refreshToken");

    console.log("📨 Token params:", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
    });

    let userData = null;
    let newAccessToken = null;
    let authenticationMethod = "access_token";

    // Case 1: Valid access token
    if (accessToken) {
      const decoded = validateToken(accessToken, "access");
      if (decoded) {
        userData = decoded;
        console.log(`✅ Access token valid for user: ${userData.email}`);
      } else if (refreshToken) {
        // Case 2: Access token invalid/expired, try refresh token
        console.log("🔄 Access token invalid, trying refresh token...");

        const refreshResult = await refreshAccessToken(
          refreshToken,
          userData?.id,
        );

        if (refreshResult.success) {
          userData = refreshResult.user;
          newAccessToken = refreshResult.accessToken;
          authenticationMethod = "refresh_token";
          console.log(`✅ Token refreshed for user: ${userData.email}`);
        } else {
          throw new Error(`Refresh failed: ${refreshResult.error}`);
        }
      } else {
        throw new Error("Invalid access token and no refresh token provided");
      }
    } else if (refreshToken) {
      // Case 3: Only refresh token provided
      console.log("🔄 Only refresh token provided, attempting refresh...");

      // Need user ID from refresh token first
      const decodedRefresh = validateToken(refreshToken, "refresh");
      if (!decodedRefresh) {
        throw new Error("Invalid refresh token");
      }

      const refreshResult = await refreshAccessToken(
        refreshToken,
        decodedRefresh.id,
      );

      if (refreshResult.success) {
        userData = refreshResult.user;
        newAccessToken = refreshResult.accessToken;
        authenticationMethod = "refresh_token_only";
        console.log(
          `✅ Token created from refresh for user: ${userData.email}`,
        );
      } else {
        throw new Error(`Refresh failed: ${refreshResult.error}`);
      }
    } else {
      throw new Error("No authentication tokens provided");
    }

    // Authentication successful
    const connectionId = `${userData.id}-${Date.now()}`;

    // Store connection
    activeConnections.set(connectionId, {
      ws,
      userId: userData.id,
      userEmail: userData.email,
      userRole: userData.role,
      authenticated: true,
      connectedAt: new Date(),
      lastActivity: new Date(),
      isAlive: true,
    });

    // Attach metadata to WebSocket object
    ws.connectionId = connectionId;
    ws.userId = userData.id;
    ws.userEmail = userData.email;
    ws.userRole = userData.role;
    ws.isAlive = true;

    console.log(
      `✅ WebSocket authenticated: ${userData.email} (${userData.role}) via ${authenticationMethod}`,
    );

    // Send welcome message with token info
    ws.send(
      JSON.stringify({
        type: "connection_established",
        message: "WebSocket connected successfully",
        timestamp: new Date().toISOString(),
        user: {
          id: userData.id,
          email: userData.email,
          role: userData.role,
          name: userData.name,
        },
        authenticationMethod,
        ...(newAccessToken && { newAccessToken }), // Kirim new token jika ada
      }),
    );

    // Send initial data
    ws.send(
      JSON.stringify({
        type: "initial_data",
        data: trafficData,
        timestamp: new Date().toISOString(),
      }),
    );

    // Heartbeat mechanism
    ws.on("pong", () => {
      ws.isAlive = true;
      const connection = activeConnections.get(connectionId);
      if (connection) {
        connection.lastActivity = new Date();
        connection.isAlive = true;
      }
    });

    // Handle incoming messages
    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message);
        console.log("📨 Message from client:", data.type);

        const connection = activeConnections.get(connectionId);
        if (connection) {
          connection.lastActivity = new Date();
        }

        switch (data.type) {
          case "ping":
            ws.send(
              JSON.stringify({
                type: "pong",
                timestamp: new Date().toISOString(),
              }),
            );
            break;

          case "request_update":
            ws.send(
              JSON.stringify({
                type: "traffic_update",
                data: {
                  timestamp: new Date().toISOString(),
                  interfaces: trafficData.interfaces,
                  activeSessions: trafficData.activeSessions,
                  systemStats: trafficData.systemStats,
                },
              }),
            );
            break;

          case "refresh_token":
            // Client requesting manual refresh
            if (data.refreshToken) {
              const refreshResult = await refreshAccessToken(
                data.refreshToken,
                userData.id,
              );

              if (refreshResult.success) {
                ws.send(
                  JSON.stringify({
                    type: "token_refreshed",
                    accessToken: refreshResult.accessToken,
                    timestamp: new Date().toISOString(),
                  }),
                );
              } else {
                ws.send(
                  JSON.stringify({
                    type: "token_refresh_failed",
                    message: refreshResult.error,
                    timestamp: new Date().toISOString(),
                  }),
                );
              }
            }
            break;

          case "subscribe":
            // Handle subscription to specific channels
            if (data.channel) {
              connection.subscribedChannels =
                connection.subscribedChannels || [];
              if (!connection.subscribedChannels.includes(data.channel)) {
                connection.subscribedChannels.push(data.channel);
              }
              ws.send(
                JSON.stringify({
                  type: "subscribed",
                  channel: data.channel,
                  timestamp: new Date().toISOString(),
                }),
              );
            }
            break;

          case "unsubscribe":
            if (data.channel && connection.subscribedChannels) {
              connection.subscribedChannels =
                connection.subscribedChannels.filter(
                  (ch) => ch !== data.channel,
                );
            }
            break;
        }
      } catch (parseError) {
        console.error("Failed to parse message:", parseError);
      }
    });

    // Handle connection close
    ws.on("close", (code, reason) => {
      console.log(
        `🔌 WebSocket disconnected: ${userData.email} (${code}: ${reason})`,
      );
      activeConnections.delete(connectionId);
    });

    // Handle errors
    ws.on("error", (error) => {
      console.error(`WebSocket error for ${userData.email}:`, error);
      activeConnections.delete(connectionId);
    });
  } catch (error) {
    console.error("❌ WebSocket connection error:", error.message);

    // Send error message to client before closing
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "connection_error",
          error: error.message,
          timestamp: new Date().toISOString(),
          requiresReconnect:
            error.message.includes("expired") ||
            error.message.includes("Invalid"),
        }),
      );
    }

    // Close connection with appropriate code
    const closeCode = error.message.includes("expired") ? 1008 : 1011;
    ws.close(closeCode, error.message);
  }
});

// Heartbeat interval - check every 30 seconds
const heartbeatInterval = setInterval(() => {
  console.log(
    `💓 Heartbeat check: ${activeConnections.size} active connections`,
  );

  activeConnections.forEach((connection, connectionId) => {
    if (!connection.isAlive) {
      console.log(`💀 Terminating dead connection: ${connection.userEmail}`);
      connection.ws.terminate();
      activeConnections.delete(connectionId);
      return;
    }

    connection.isAlive = false;
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.ping();
    }
  });
}, 30000);

// Cleanup function
function cleanup() {
  clearInterval(heartbeatInterval);
  console.log("🧹 WebSocket server cleanup completed");
}

// Handle server shutdown
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

console.log("🚀 WebSocket traffic server ready (hybrid approach)");

module.exports = {
  wss,
  broadcastToAll,
  updateTrafficData,
  activeConnections,
  cleanup,
};
