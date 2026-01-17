import * as net from "net";

const PROXY_PORT = 8080;

const backends = [
  { host: "127.0.0.1", port: 9090, healthy: true },
  { host: "127.0.0.1", port: 9091, healthy: true },
  { host: "127.0.0.1", port: 9092, healthy: true },
];

let currentIndex = 0;

function checkHealth() {
  backends.forEach((backend) => {
    const socket = net.connect(backend.port, backend.host);

    const timeout = setTimeout(() => {
      if (backend.healthy) {
        console.log(`Health Port ${backend.port} is DOWN`);
      }
      backend.healthy = false;
      socket.destroy();
    }, 3000);

    socket.on("connect", () => {
      clearTimeout(timeout);
      if (!backend.healthy) {
        console.log(`[Health] Port ${backend.port} is back UP`);
      }
      backend.healthy = true;
      socket.destroy();
    });

    socket.on("error", () => {
      clearTimeout(timeout);
      if (backend.healthy) {
        console.log(`Health Port ${backend.port} is DOWN`);
      }
      backend.healthy = false;
      socket.destroy();
    });
  });
}

checkHealth();
setInterval(checkHealth, 5000);

function selectBackend() {
  const healthyBackends = backends.filter((b) => b.healthy);
  if (healthyBackends.length === 0) return null;

  for (let i = 0; i < backends.length; i++) {
    const backend = backends[currentIndex];
    currentIndex = (currentIndex + 1) % backends.length;

    if (backend.healthy) {
      return backend;
    }
  }

  return null;
}

const activeConnections: Set<{
  clientSocket: net.Socket;
  serverSocket: net.Socket;
}> = new Set();

const server = net.createServer((clientSocket) => {
  const backend = selectBackend();

  if (!backend) {
    console.error("No healthy backends available");
    clientSocket.write("Service Unavailable (All backends down)\n");
    clientSocket.end();
    return;
  }

  const { host, port } = backend;
  console.log(`Client connected: Routing to ${host}:${port}`);

  const serverSocket = net.connect(port, host, () => {
    console.log(`Proxy established connection to target: ${port}`);
  });

  const connection = { clientSocket, serverSocket };
  activeConnections.add(connection);
  console.log(`Connection added: ${activeConnections.size}`);

  let clientPaused = false;
  let serverPaused = false;

  clientSocket.on("data", (chunk) => {
    if (serverSocket.writable) {
      const canWrite = serverSocket.write(chunk);
      if (!canWrite && !clientPaused) {
        clientPaused = true;
        clientSocket.pause();
        serverSocket.once("drain", () => {
          clientPaused = false;
          clientSocket.resume();
        });
      }
    }
  });

  serverSocket.on("data", (chunk) => {
    if (clientSocket.writable) {
      const canWrite = clientSocket.write(chunk);
      if (!canWrite && !serverPaused) {
        serverPaused = true;
        serverSocket.pause();
        clientSocket.once("drain", () => {
          serverPaused = false;
          serverSocket.resume();
        });
      }
    }
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    clientSocket.destroy();
    serverSocket.destroy();

    // Remove from tracking
    activeConnections.delete(connection);
    console.log(`Connection removed. Active: ${activeConnections.size}`);
  };

  clientSocket.on("end", () => serverSocket.end());
  serverSocket.on("end", () => clientSocket.end());

  clientSocket.on("error", (err) => {
    console.error("Client error:", err.message);
    cleanup();
  });

  serverSocket.on("error", (err) => {
    console.error(`Target ${port} error:`, err.message);
    cleanup();
  });

  clientSocket.on("close", () => {
    if (!cleaned) cleanup();
  });
  serverSocket.on("close", () => {
    if (!cleaned) cleanup();
  });
});

server.listen(PROXY_PORT, () => {
  const ports = backends.map((b) => b.port).join(", ");
  console.log(`TCP Load Balancer running on port ${PROXY_PORT}`);
  console.log(`Monitoring backends: ${ports}\n`);
});

process.on("SIGTERM", () => {
  console.log(`Received SIGTERM,Active connections: ${activeConnections.size}`);

  server.close(() => {
    console.log("Server closed. New connections not accepted");
  });

  const checkInterval = setInterval(() => {
    console.log(`Waiting for ${activeConnections.size} connections to close`);

    if (activeConnections.size === 0) {
      clearInterval(checkInterval);
      console.log("All connections gracefully closed");
      process.exit(0);
    }
  }, 1000);

  setTimeout(() => {
    console.log(
      `Timeout reached: All ${activeConnections.size} connections will be forcefully closed`
    );
    clearInterval(checkInterval);

    activeConnections.forEach(({ clientSocket, serverSocket }) => {
      clientSocket.destroy();
      serverSocket.destroy();
    });

    process.exit(1);
  }, 30000);
});
