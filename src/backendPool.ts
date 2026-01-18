import { Backend } from "./types";

export class BackendPool {
  constructor(backends: Backend[]) {
    this.backends = backends.map((b) => ({ ...b, healthy: true }));
    this.currentIndex = 0;
  }

  private backends: Backend[];
  private currentIndex: number;

  selectBackend() {
    // Round-robin logic
    const healthyBackends = this.backends.filter((b) => b.healthy);
    if (healthyBackends.length === 0) return null;

    for (let i = 0; i < this.backends.length; i++) {
      const backend = this.backends[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.backends.length;

      if (backend.healthy) {
        return backend;
      }
    }

    return null;
  }

  markBackendHealth(backend: Backend, healthy: boolean) {
    backend.healthy = healthy;
  }

  getBackends() {
    return this.backends;
  }
}
