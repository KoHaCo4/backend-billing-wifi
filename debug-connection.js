const net = require("net");
const { RouterOSAPI } = require("node-routeros");

async function debugMikrotikConnection() {
  console.log("🔍 Debugging MikroTik Connection...\n");

  const mikrotikConfig = {
    host: "192.168.0.111",
    user: "admin",
    password: "admin123",
    port: 8728,
    timeout: 5000,
  };

  console.log("Testing connection to:", mikrotikConfig);

  // 1. Test network connectivity
  console.log("\n1. Testing network connectivity...");
  await testPing(mikrotikConfig.host);

  // 2. Test port accessibility
  console.log("\n2. Testing port accessibility...");
  await testPort(mikrotikConfig.host, mikrotikConfig.port);

  // 3. Test API connection
  console.log("\n3. Testing API connection...");
  await testAPI(mikrotikConfig);
}

async function testPing(host) {
  return new Promise((resolve) => {
    const { exec } = require("child_process");

    console.log(`Pinging ${host}...`);
    exec(`ping -c 4 ${host}`, (error, stdout, stderr) => {
      if (error) {
        console.log(`❌ Cannot ping ${host}: ${error.message}`);
        console.log(
          "⚠️  Check if the IP is correct and server is on the same network",
        );
      } else {
        console.log(`✅ Ping successful to ${host}`);
        console.log(stdout);
      }
      resolve();
    });
  });
}

async function testPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 3000;

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      console.log(`✅ Port ${port} is open on ${host}`);
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      console.log(`❌ Connection timeout on port ${port}`);
      socket.destroy();
      resolve(false);
    });

    socket.on("error", (error) => {
      console.log(`❌ Port ${port} is closed or blocked: ${error.message}`);
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function testAPI(config) {
  const startTime = Date.now();

  try {
    console.log(
      `\nAttempting API connection to ${config.host}:${config.port}...`,
    );

    const client = new RouterOSAPI({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port,
      timeout: config.timeout,
    });

    // Event listeners untuk debug
    client.on("timeout", () => {
      console.log("⏱️  API Connection timeout");
    });

    client.on("error", (error) => {
      console.log("🔌 API Connection error:", error.message);
    });

    console.log("Connecting...");
    await client.connect();

    const connectionTime = Date.now() - startTime;
    console.log(`✅ API Connection successful! (${connectionTime}ms)`);

    // Test simple command
    console.log("\nTesting API command...");
    const identity = await client.write("/system/identity/print");
    console.log(`✅ System Identity: ${identity[0].name}`);

    // Test login with credentials
    console.log("\nTesting login with provided credentials...");
    const users = await client.write("/user/print");
    console.log(`✅ Users found: ${users.length}`);

    // Close connection
    client.close();
    console.log("\n🎉 All MikroTik tests passed!");
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.log(
      `❌ API Connection failed after ${errorTime}ms: ${error.message}`,
    );

    // Berikan saran berdasarkan error
    if (error.message.includes("timeout")) {
      console.log("\n🔧 Troubleshooting timeout:");
      console.log("1. Check if MikroTik API service is enabled:");
      console.log("   - Login to MikroTik via WinBox/WebFig");
      console.log("   - Go to IP > Services");
      console.log("   - Make sure API is enabled on port 8728");
      console.log("\n2. Check firewall rules:");
      console.log("   - IP > Firewall > Filter Rules");
      console.log(
        "   - Add rule: chain=input, protocol=tcp, dst-port=8728, action=accept",
      );
    } else if (
      error.message.includes("login") ||
      error.message.includes("password")
    ) {
      console.log("\n🔧 Troubleshooting authentication:");
      console.log("1. Check username/password");
      console.log("2. Check user permissions in MikroTik:");
      console.log("   - System > Users");
      console.log(
        '   - User should be in "full" group or have API write permissions',
      );
    } else if (error.message.includes("connect")) {
      console.log("\n🔧 Troubleshooting connection:");
      console.log("1. Verify IP address is correct");
      console.log("2. Check if server and MikroTik are on same network");
      console.log("3. Try connecting from another device to verify");
    }
  }
}

// Run debug
debugMikrotikConnection();
