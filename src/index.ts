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
        console.log(`[Health] Port ${backend.port} is DOWN`);
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
        console.log(`[Health] Port ${backend.port} is DOWN`);
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

const server = net.createServer((clientSocket) => {
  const backend = selectBackend();

  if (!backend) {
    console.error("No healthy backends available");
    clientSocket.write("Service Unavailable (All backends down)\n");
    clientSocket.end();
    return;
  }

  const { host, port } = backend;
  console.log(`Client connected -> Routing to ${host}:${port}`);

  const serverSocket = net.connect(port, host, () => {
    console.log(`Proxy established connection to target: ${port}`);
  });

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

  const cleanup = () => {
    clientSocket.destroy();
    serverSocket.destroy();
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

  clientSocket.on("close", () => console.log("Client connection closed"));
});

server.listen(PROXY_PORT, () => {
  const ports = backends.map((b) => b.port).join(", ");
  console.log(`TCP Load Balancer running on port ${PROXY_PORT}`);
  console.log(`Monitoring backends: ${ports}\n`);
});
