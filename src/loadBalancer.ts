import * as net from "net";
import { Config } from "./config";
import { BackendPool } from "./backendPool";
import { HealthChecker } from "./healthChecker";
import { Connection } from "./connection";

export class LoadBalancer {
  private config: Config;
  private server: net.Server | null;
  private backendPool: BackendPool;
  private healthChecker: HealthChecker;
  private connection: Connection | null;
  private activeConnections: Set<{
    clientSocket: net.Socket;
    serverSocket: net.Socket;
  }>;

  constructor(config: Config) {
    this.config = config;
    this.backendPool = new BackendPool(config.backends);
    this.healthChecker = new HealthChecker(
      this.backendPool.getBackends(),
      config.healthCheck
    );
    this.activeConnections = new Set();
    this.server = null;
    this.connection = null;
  }

  start() {
    this.healthChecker.start();
    this.server = net.createServer((clientSocket) =>
      this.handleConnection(clientSocket)
    );
    this.server.listen(this.config.proxyPort);
    this.setupShutdownHandler();
  }

  handleConnection(clientSocket: net.Socket) {
    const backend = this.backendPool.selectBackend();

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
    this.activeConnections.add(connection);
    console.log(`Connection added: ${this.activeConnections.size}`);

    this.connection = new Connection(clientSocket, serverSocket, () => {
      this.activeConnections.delete(connection);
    });
  }

  setupShutdownHandler() {
    process.on("SIGTERM", () => {
      console.log(
        `Received SIGTERM,Active connections: ${this.activeConnections.size}`
      );

      this.server?.close(() => {
        console.log("Server closed. New connections not accepted");
      });

      const checkInterval = setInterval(() => {
        console.log(
          `Waiting for ${this.activeConnections.size} connections to close`
        );

        if (this.activeConnections.size === 0) {
          clearInterval(checkInterval);
          console.log("All connections gracefully closed");
          process.exit(0);
        }
      }, 1000);

      setTimeout(() => {
        console.log(
          `Timeout reached: All ${this.activeConnections.size} connections will be forcefully closed`
        );
        clearInterval(checkInterval);

        this.activeConnections.forEach(({ clientSocket, serverSocket }) => {
          clientSocket.destroy();
          serverSocket.destroy();
        });

        process.exit(1);
      }, this.config.shutdown.timeout);
    });
  }
}
