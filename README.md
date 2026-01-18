# TCP Load Balancer

A TCP load balancer built with Node.js and TypeScript featuring health checks, graceful shutdown, and backpressure handling.

## Features

- **Round-robin load balancing** across multiple backend servers
- **Health monitoring** with automatic failover
- **Graceful shutdown** with connection draining
- **Backpressure handling** to prevent memory exhaustion
- **Environment-based configuration** with Zod validation

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd tcp-load-balancer

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env
```

### Configuration

Edit `.env` to customize settings:

```bash
PROXY_PORT=8080                 # Load balancer port
HEALTH_CHECK_INTERVAL=5000      # Health check frequency (ms)
HEALTH_CHECK_TIMEOUT=3000       # Health check timeout (ms)
SHUTDOWN_TIMEOUT=30000          # Graceful shutdown timeout (ms)
```

Backend servers are configured in `src/config.ts`:

```typescript
backends: [
  { host: "127.0.0.1", port: 9090, healthy: true },
  { host: "127.0.0.1", port: 9091, healthy: true },
  { host: "127.0.0.1", port: 9092, healthy: true },
];
```

### Running

```bash
# Development (with auto-reload)
npm run dev

# Production build
npm run build
npm start
```

### Testing

Start some backend servers:

```bash
# Terminal 1
npx tsx src/backend.ts 9090

# Terminal 2
npx tsx src/backend.ts 9091

# Terminal 3
npx tsx src/backend.ts 9092
```

Test the load balancer:

```bash
# Connect to load balancer
nc localhost 8080
```

## Project Structure

```
src/
├── index.ts          # Entry point
├── config.ts         # Configuration with Zod validation
├── loadBalancer.ts   # Main orchestrator
├── backendPool.ts    # Backend selection logic
├── healthChecker.ts  # Health monitoring
├── connection.ts     # Connection management
└── types/           # TypeScript type definitions
```
