import * as net from "net";

export class Connection {
  private clientSocket: net.Socket;
  private serverSocket: net.Socket;
  private onClose?: () => void;
  private cleaned: boolean;
  private clientPaused: boolean;
  private serverPaused: boolean;

  constructor(
    clientSocket: net.Socket,
    serverSocket: net.Socket,
    onClose: () => void
  ) {
    this.clientSocket = clientSocket;
    this.serverSocket = serverSocket;
    this.onClose = onClose;

    // State tracking
    this.cleaned = false;
    this.clientPaused = false;
    this.serverPaused = false;

    // Set up all event handlers
    this.setupHandlers();
  }

  setupHandlers() {
    this.clientSocket.on("data", (chunk) => {
      if (this.serverSocket.writable) {
        const canWrite = this.serverSocket.write(chunk);
        if (!canWrite && !this.clientPaused) {
          this.clientPaused = true;
          this.clientSocket.pause();
          this.serverSocket.once("drain", () => {
            this.clientPaused = false;
            this.clientSocket.resume();
          });
        }
      }
    });

    this.serverSocket.on("data", (chunk) => {
      if (this.clientSocket.writable) {
        const canWrite = this.clientSocket.write(chunk);
        if (!canWrite && !this.serverPaused) {
          this.serverPaused = true;
          this.serverSocket.pause();
          this.clientSocket.once("drain", () => {
            this.serverPaused = false;
            this.serverSocket.resume();
          });
        }
      }
    });

    this.clientSocket.on("end", () => {
      if (!this.cleaned) {
        this.serverSocket.end();
      }
    });
    this.serverSocket.on("end", () => {
      if (!this.cleaned) {
        this.clientSocket.end();
      }
    });

    this.clientSocket.on("error", (err) => {
      console.error("Client error:", err.message);
      this.cleanup();
    });

    this.serverSocket.on("error", (err) => {
      console.error(
        `Target ${this.serverSocket.remotePort} error:`,
        err.message
      );
      this.cleanup();
    });

    this.clientSocket.on("close", () => {
      if (!this.cleaned) this.cleanup();
    });
    this.serverSocket.on("close", () => {
      if (!this.cleaned) this.cleanup();
    });
  }

  cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;

    this.clientSocket.destroy();
    this.serverSocket.destroy();
    this.onClose?.();
  }
}
