# Load Balancer - Design Decisions and Trade-offs

## Architecture Overview

Split the load balancer into five modules: **config.ts** (configuration), **BackendPool.ts** (backend selection), **HealthChecker.ts** (health monitoring), **Connection.ts** (connection management), and **LoadBalancer.ts** (orchestration).

**Why this structure?** Each module has a single responsibility, making the system testable, maintainable, and extensible. Alternative single-file approach was rejected due to tight coupling and testing difficulties.

---

## State Management

### Backend State

Encapsulated backend state in a `BackendPool` class managing backends list, health status, and round-robin index.

**Why encapsulation?**

For values like `currentIndex`, during refactoring it made sense to encapsulate the index and track it in the `BackendPool` class instead of the `LoadBalancer` class. The LoadBalancer needs to know which backends are working; it doesn't need to understand implementation details.

**Trade-offs:**

- **Pros:** Single source of truth for backend state, easier to test selection logic in isolation, can swap selection strategies without touching LoadBalancer
- **Cons:** Slightly more code (class instead of simple functions), requires understanding OOP patterns

**Alternative considered:**

Passing the backends array and index around as function parameters. This is ineffective because while arrays are passed by reference (updates are visible everywhere), primitives like `currentIndex` are passed by value. This creates inconsistent state across different parts of the code. We'd need to return the new index from every function call, making the API clunky.

---

### Connection Tracking

Chose `Set<{clientSocket, serverSocket}>` for O(1) add/remove operations. Arrays require O(n) removal, Maps need unique IDs adding complexity.

---

## Failure Handling

### Health Check Strategy

**Configuration:**

- Check interval: 5 seconds
- Connection timeout: 3 seconds
- Retry behavior: Continuous (never give up on dead backends)

**Why 5 seconds?**

This is a balanced interval - not so frequent as to overwhelm backends with health checks, and not so infrequent that we take too long to detect failures. In production, you'd tune this based on SLA requirements, backend capacity, and network reliability.

**Why continuous retry?**

Servers could be dead one moment and alive another. Continuous retry ensures we detect recovery quickly and automatically route traffic back when backends come back online. Backends might be restarted, network issues might resolve, or temporary overload might clear.

**Fast failure detection:**

When a Connection encounters a backend error during active proxying, we log the error but rely on the periodic health check to mark the backend as unhealthy. This prevents a single transient error from unnecessarily removing a backend from rotation, while still detecting persistent failures within 5 seconds.

---

### Connection Error Handling

Separated error handling responsibilities:

- **LoadBalancer** handles backend connection establishment errors (before Connection is created)
- **Connection** handles errors during active proxying (after connection is established)

**Why this separation?**

This aids easy identification of what caused the error. If we can't connect to a backend, that's a routing problem LoadBalancer should handle (try a different backend or return error to client). If a connection dies mid-stream, that's a proxying problem Connection should handle (clean up both sockets).

**Alternative considered:**

Making Connection responsible for creating the backend socket via an async `Connection.create()` factory method. This is more self-contained but adds complexity: constructors can't be async in JavaScript/TypeScript, connection establishment errors are now split between LoadBalancer and Connection, and testing becomes harder since Connection now requires network calls.

---

### Backpressure Handling

Implemented pause/resume with per-socket state tracking (`clientPaused`, `serverPaused`).

**Why track pause state?**

Without tracking the paused state, the result would be potential data loss. A client can send requests to the server despite the server's buffer being filled with unprocessed requests, and vice versa.

The flags serve as a control mechanism for data transmission, ensuring both ends have processed existing buffered requests before the buffer is drained and can accommodate new requests. They also prevent calling `pause()` multiple times on the same socket, which while safe, wastes event listener registrations.

**What would break without backpressure?**

Memory exhaustion. If the backend is slow to process requests but the client keeps sending data, Node.js buffers that data in memory. Without backpressure handling, the buffer grows unbounded. With thousands of slow connections, you'd quickly exhaust available memory and crash.

Example: A client uploading a 1GB file to a slow backend. Without backpressure, the load balancer would read all 1GB into memory while the backend slowly consumes it. With backpressure, the load balancer pauses reading from the client when the backend's buffer fills, keeping memory usage bounded.

---

## Graceful Shutdown

30-second timeout balances completing legitimate operations vs operational needs. Process: stop accepting connections, poll for empty connection count, force-destroy after timeout.

---

## Performance Considerations

### Round-Robin Over Original Array

Loops over the original `backends` array and skip unhealthy ones, rather than filtering to a `healthyBackends` array first.

**Why?**

Filtering creates a new array with different indices. If `currentIndex` points to position 2 in the original array but the filtered array only has 2 elements, `currentIndex % filtered.length` produces inconsistent distribution. When backends recover or fail, the filtered array changes size, causing `currentIndex` to lose meaning.

By iterating over the original array and skipping unhealthy backends, `currentIndex` always refers to the same logical position, ensuring consistent round-robin distribution even as backend health changes.

**Performance impact:**

- Worst case: O(n) where n = total backends
- Best case: O(1) if next backend is healthy
- Average case: O(healthy_count / 2)

For typical deployments (3-20 backends), the overhead is negligible. At scale with many unhealthy backends (e.g., 900 out of 1000), you'd want a different data structure like maintaining a separate list of healthy backend indices.

---

### Health Check Socket Cleanup

We immediately `destroy()` health check sockets after `connect` or `error` events.

**Why critical?**

Without cleanup, every health check leaks a socket. With 3 backends checked every 5 seconds:

- After 1 minute: 36 leaked sockets
- After 1 hour: 2,160 leaked sockets
- Eventually: OS connection limit reached, system fails

Each socket consumes file descriptors (a limited OS resource) and memory. The leak would cause the load balancer to fail after a few hours.

---

## What I'd Do Differently in Production

### 1. Metrics

Track requests/second, active connections, health changes, error rates, latency distribution. Store in time-series database for monitoring and capacity planning.

### 2. Connection Pooling

Reuse backend connections instead of creating new ones per client. Reduces latency (no handshake overhead) and backend load, but adds state management complexity.

### 3. Advanced Load Balancing

- **Least-connections:** Route to backend with fewest active connections
- **Weighted backends:** Distribute traffic based on backend capacity
- **Combined:** Weighted least-connections for optimal distribution

### 4. Circuit Breaker Pattern

**Problem:** When a backend starts failing, health checks continue trying it every 5 seconds. If it's overloaded, this makes recovery harder. If it's intermittently failing, we keep routing traffic to it, causing poor user experience.

**Circuit breaker solution:**

The circuit breaker acts like an electrical circuit breaker - it "opens" to stop the flow of requests when failures occur.

**States:**

- **Closed (normal):** Requests flow through normally
- **Open:** After N consecutive failures, stop sending requests for M seconds (dedicated timeout period before retrying)
- **Half-open:** After timeout, try one request to test if backend recovered
- **Success → Close:** If test succeeds, resume normal operation
- **Failure → Open:** If test fails, open circuit for longer (exponential backoff)

This gives failing backends breathing room to recover and prevents the thundering herd problem where all clients retry simultaneously, potentially overwhelming a recovering backend.

**Benefits:**

- Faster failure detection (fail fast instead of waiting for timeout)
- Reduced load on failing backends (helps recovery)
- Better user experience (immediate error instead of slow timeout)

---

## Key Learnings

### Technical Insights

The most surprising aspect was how many edge cases exist in a simple TCP proxying. Backpressure, half-close, socket states, cleanup sequencing. Each has subtle gotchas that only appear under load or failure conditions. Testing isn't optional; it's the only way to verify the system handles these cases correctly.

### Debugging Strategies

**Chaos testing** proved invaluable: intentionally killing backends, simulating slow networks, creating load. Without deliberately breaking things, you don't discover bugs like socket leaks or index inconsistencies.

**Logging at state transitions** (connection open, close, health changes) made debugging easy to deal with.

### Design Patterns

Key patterns that emerged:

- **Encapsulation** - keeping related state together (currentIndex with backends)
- **Separation of concerns** - each class has one job
- **Idempotency** - cleanup can be called multiple times safely
- **Callback-based notification** - Connection tells LoadBalancer when it's done
