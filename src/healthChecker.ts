import * as net from "net";
import { Backend } from "./types";
import { HealthCheckConfig } from "./config";

export class HealthChecker {
  private backends: Backend[];
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly interval: number;
  private readonly timeout: number;

  constructor(backends: Backend[], config: HealthCheckConfig) {
    this.backends = backends;
    this.interval = config.interval;
    this.timeout = config.timeout;
  }

  start(): void {
    this.checkHealth();
    this.checkInterval = setInterval(() => this.checkHealth(), this.interval);
    console.log(`[HealthChecker] Started with ${this.interval}ms interval`);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log("[HealthChecker] Stopped");
    }
  }

  getHealthyBackends(): Backend[] {
    return this.backends.filter((b) => b.healthy);
  }

  private checkHealth(): void {
    this.backends.forEach((backend) => {
      const socket = net.connect(backend.port, backend.host);

      const timeout = setTimeout(() => {
        if (backend.healthy) {
          console.log(`[Health] ${backend.host}:${backend.port} is DOWN`);
        }
        backend.healthy = false;
        socket.destroy();
      }, this.timeout);

      socket.on("connect", () => {
        clearTimeout(timeout);
        if (!backend.healthy) {
          console.log(`[Health] ${backend.host}:${backend.port} is back UP`);
        }
        backend.healthy = true;
        socket.destroy();
      });

      socket.on("error", () => {
        clearTimeout(timeout);
        if (backend.healthy) {
          console.log(`[Health] ${backend.host}:${backend.port} is DOWN`);
        }
        backend.healthy = false;
        socket.destroy();
      });
    });
  }
}
