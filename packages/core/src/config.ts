import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Loaded once per process, from the repo root .env regardless of which
// package's working directory actually invoked the process.
loadDotenv({ path: path.resolve(__dirname, "../../../.env") });

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  daytona: {
    apiKey: () => process.env.DAYTONA_API_KEY ?? "",
    apiUrl: () => process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
  },
  nosana: {
    walletPrivateKey: () => process.env.NOSANA_WALLET_PRIVATE_KEY ?? "",
    network: () => optional("NOSANA_NETWORK", "mainnet"),
    rpcUrl: () => process.env.NOSANA_RPC_URL ?? "",
    market: () => process.env.NOSANA_MARKET ?? "",
  },
  tunnel: {
    provider: () => optional("TUNNEL_PROVIDER", "cloudflared") as "cloudflared" | "localtunnel",
  },
  server: {
    port: () => Number(optional("SERVER_PORT", "8787")),
  },
  dataDir: path.resolve(__dirname, "../../../data"),
  reportsDir: path.resolve(__dirname, "../../../reports"),
  // Defense-in-depth: the concrete list of CIDR ranges considered "local" is
  // configurable, but always defaults to the standard private/loopback/link-local
  // ranges so a fresh checkout is safe without any extra setup.
  defaultAllowedCidrs: [
    "127.0.0.0/8",
    "::1/128",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "fc00::/7",
    "fe80::/10",
  ],
};

export { required };
