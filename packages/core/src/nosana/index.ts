import { config } from "../config.js";
import { NosanaLoadTestClient } from "./nosanaLoadTestClient.js";
import { NosanaApiLoadTestClient } from "./nosanaApiClient.js";
import { LocalLoadTestClient } from "./localLoadTestClient.js";
import type { LoadTestClient } from "./types.js";

export function createLoadTestClient(): LoadTestClient {
  const credential = config.nosana.walletPrivateKey();
  // A Nosana API key (from deploy.nosana.com / dashboard.nosana.com) spends
  // hosted Nosana Credits over api.nosana.com — no separate market
  // selection or funded Solana wallet needed, so it doesn't require
  // NOSANA_MARKET the way the raw on-chain CLI path does.
  if (credential.startsWith("nos_")) {
    return new NosanaApiLoadTestClient();
  }
  if (credential && config.nosana.market()) {
    return new NosanaLoadTestClient();
  }
  return new LocalLoadTestClient();
}

export * from "./types.js";
