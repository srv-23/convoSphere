import { ENV } from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import { configureDns } from "./lib/dns.js";
import { server } from "./lib/socket.js";

configureDns();

const start = async () => {
  // Connect before accepting traffic: previously the server started
  // listening first, so early requests hit a disconnected database.
  await connectDB();

  server.listen(ENV.PORT, () => {
    console.log(`Server running on port: ${ENV.PORT} (${ENV.NODE_ENV})`);
  });
};

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
