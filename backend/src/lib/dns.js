import dns from "node:dns";
import { ENV } from "./env.js";

/**
 * Optional DNS override for networks where the system resolver cannot
 * resolve Atlas SRV records.
 *
 * Previously this was hardcoded in server.js and always applied, which broke
 * any network that blocks public resolvers. It is now opt-in through
 * DNS_SERVERS (comma separated), and documented in .env.example.
 */
export function configureDns() {
  const servers = (ENV.DNS_SERVERS ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length === 0) return;

  dns.setServers(servers);
  console.log("DNS servers override:", servers.join(", "));
}
