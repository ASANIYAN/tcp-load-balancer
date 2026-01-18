# Load Balancer - Design Decisions and Trade-offs

## Architecture: Separation of Concerns

We split the load balancer into five modules: `config.ts` (configuration), `BackendPool.ts` (backend state and selection), `HealthChecker.ts` (health monitoring), `Connection.ts` (connection management), and `LoadBalancer.ts` (orchestration).

**Why?** The initial single-file implementation lacked separation of concerns, making it hard to test and scale. This structure ensures each component can be unit-tested independently and integration-tested as a system. Each module has a single, well-defined responsibility.

**Alternative:** A single-file approach was rejected because it creates tight coupling, makes testing difficult, and becomes harder to reason about as complexity grows.

## State Management

### Backend State: Encapsulation

`BackendPool` encapsulates backend list, health status, and `currentIndex` for round-robin selection.

**Why?** During refactoring, it made sense to keep `currentIndex` with the backends it operates on. The LoadBalancer only needs to know which backends are healthy, not implementation details. This provides a single source of truth and allows swapping selection strategies without touching LoadBalancer.

**Alternative:** Passing backends array and index as function parameters fails because primitives like `currentIndex` are passed by value, creating inconsistent state. We'd need to return the new index from every function, making the API clunky.

### Connection Tracking: Set

We use `Set<{ clientSocket, serverSocket }>` for tracking active connections.

**Why?** Set provides O(1) addition and deletion. Arrays require O(n) search on removal, which becomes costly with 1000+ connections. Maps require generating unique IDs, adding memory overhead. Sets are optimal when you only need to track and delete connections without fetching by ID.

## Failure Handling

### Health Checks

We check backends every 5 seconds with a 3-second timeout, retrying continuously.

**Why 5 seconds?** Balanced - not so frequent as to overwhelm backends, not so slow that failures take too long to detect. **Why continuous retry?** Backends can recover after being down. Continuous checking ensures we route traffic back quickly when they return.

### Backpressure

We track `clientPaused` and `serverPaused` states to implement pause/resume.

**Why?** Without backpressure, if a backend is slow but the client keeps sending data, Node.js buffers it in memory unbounded. With thousands of slow connections, this causes memory exhaustion and crashes. Backpressure pauses the fast side when the slow side's buffer fills, keeping memory usage bounded.

### Graceful Shutdown

We wait 30 seconds for connections to close naturally before forcing termination.

**Why 30 seconds?** Balances letting legitimate operations complete versus not waiting forever for hung connections. In production, this depends on your use case (fast APIs: 10-15s, file transfers: 60s+).

## Performance Considerations

### Round-Robin Over Original Array

We iterate the original `backends` array, skipping unhealthy ones, rather than filtering first.

**Why?** Filtering creates a new array with different indices. When backends recover/fail, the filtered array size changes, causing `currentIndex` to lose meaning and breaking consistent distribution. Iterating the original array keeps `currentIndex` stable.

### Health Check Socket Cleanup

We immediately `destroy()` health check sockets after `connect` or `error` events.

**Why critical?** Without cleanup, every health check leaks a socket. With 3 backends checked every 5 seconds, that's 36 leaked sockets per minute, 2,160 per hour. Eventually, you hit OS limits and the system fails.

## Production Improvements

**Metrics:** Track requests/sec, error rates, latency (p50/p95/p99), and backend health changes for observability and alerting.

**Connection Pooling:** Reuse backend connections instead of creating new ones per client. Eliminates TCP/TLS handshake overhead (~1-100ms), reducing latency and backend load.

**Advanced Load Balancing:** Least-connections routes to the backend with fewest active connections, naturally balancing based on capacity. Weighted backends allow sending more traffic to larger instances. Combined: route based on `activeConnections / weight` ratio.

**Circuit Breaker:** After N consecutive failures, "open" the circuit - stop sending requests for M seconds to give the backend recovery time. After timeout, test with one request. If successful, "close" the circuit and resume. If failed, stay open longer with exponential backoff. Prevents overwhelming recovering backends and provides faster failure detection.

## Key Learnings

**Reliability is emergent** - it's the interplay of health checking, error handling, graceful degradation, and resource management, not one feature.

**Testing is essential** - edge cases (backpressure, socket leaks, cleanup sequencing) only appear under chaos testing: killing backends, simulating slow networks, creating load.

**Good architecture** isn't clever code - it's making the system easy to reason about, test, and change through encapsulation, separation of concerns, and idempotency.

This project solidified my understanding of TCP (three-way handshake, four-way close), backpressure, and distributed systems patterns that apply directly to production systems.
