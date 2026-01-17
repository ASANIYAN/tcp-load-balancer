import * as net from "net";

const port = process.argv[2] || 9090;

const server = net.createServer((socket) => {
  console.log(`[Backend ${port}] Client connected`);

  socket.on("data", (data) => {
    console.log(`[Backend ${port}] Received: ${data.toString().trim()}`);
    // Echo back with a tag so you know which backend responded
    socket.write(`[Backend ${port}] ${data}`);
  });

  socket.on("end", () => {
    console.log(`[Backend ${port}] Client disconnected (graceful)`);
  });

  socket.on("error", (err) => {
    console.log(`[Backend ${port}] Error: ${err.message}`);
  });
});

server.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
