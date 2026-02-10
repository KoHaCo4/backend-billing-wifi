const axios = require("axios");

const API_BASE = "http://localhost:5555/api";

async function testRouterAPI() {
  console.log("🧪 Testing Router API Endpoints...\n");

  try {
    // 1. Login
    console.log("1. Login...");
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: "superadmin@test.com",
      password: "superadmin123",
    });

    const token = loginRes.data.data.tokens.accessToken;
    console.log("✅ Login successful");

    // 2. Test router endpoints
    const routerEndpoints = [
      { name: "Get All Routers", method: "GET", path: "/routers" },
      { name: "Test Router Connection", method: "POST", path: "/routers/test" },
      { name: "Test All Routers", method: "POST", path: "/routers/test-all" },
    ];

    console.log("\n2. Testing Router Endpoints...");

    for (const endpoint of routerEndpoints) {
      console.log(`\n📋 ${endpoint.name} (${endpoint.path})`);

      try {
        let response;

        if (endpoint.method === "POST") {
          // Untuk test connection, kita perlu data router
          if (endpoint.path === "/routers/test") {
            // Pertama get router untuk mendapatkan ID
            const routersRes = await axios.get(`${API_BASE}/routers`, {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            });

            if (routersRes.data.data.length > 0) {
              const routerId = routersRes.data.data[0].id;
              response = await axios.post(
                `${API_BASE}/routers/test`,
                { router_id: routerId },
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                },
              );
            } else {
              console.log("⚠️ No routers available for testing");
              continue;
            }
          } else {
            response = await axios.post(
              `${API_BASE}${endpoint.path}`,
              {},
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              },
            );
          }
        } else {
          response = await axios.get(`${API_BASE}${endpoint.path}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });
        }

        console.log(`✅ Status: ${response.status}`);
        console.log(`   Success: ${response.data.success}`);

        if (response.data.data) {
          if (Array.isArray(response.data.data)) {
            console.log(`   Count: ${response.data.data.length}`);
          } else if (typeof response.data.data === "object") {
            console.log(`   Type: Object response`);
            if (response.data.data.message) {
              console.log(`   Message: ${response.data.data.message}`);
            }
          }
        }
      } catch (error) {
        console.log(`❌ Failed: ${error.response?.status || "No response"}`);
        console.log(
          `   Error: ${error.response?.data?.message || error.message}`,
        );
      }
    }

    console.log("\n🎉 Router API tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

testRouterAPI();
