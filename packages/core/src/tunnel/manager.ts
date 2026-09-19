import { spawn, ChildProcessByStdio } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import http, { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { URL } from "node:url";

type CloudflaredProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface TunnelCallbackEvent {
  type: string;
  [key: string]: unknown;
}

export interface OpenTunnelOptions {
  /** Local target the scanner/load-generator traffic should ultimately reach. */
  localTargetUrl: string;
  /** Invoked for every POST received on the callback path (used by the Nosana load generator). */
  onCallback?: (event: TunnelCallbackEvent) => void;
  /** Hard time-to-live safety net; the tunnel is force-closed even if nobody calls close(). */
  ttlMs?: number;
}

export interface TunnelHandle {
  /** Public base URL the scanner/load-generator should hit for the target, e.g. https://x.trycloudflare.com/t/<token> */
  targetBaseUrl: string;
  /** Public URL the load-generator should POST live samples/final results to. */
  callbackUrl: string;
  /** Shared-secret token required on every request; guards against a guessed path. */
  token: string;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardToTarget(req: IncomingMessage, res: ServerResponse, targetUrl: string, remainingPath: string) {
  const target = new URL(targetUrl);
  const body = req.method && !["GET", "HEAD"].includes(req.method) ? req : null;

  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      // remainingPath already carries the original query string (it's a
      // slice of req.url, which includes it) — appending it again here would
      // duplicate it.
      path: remainingPath,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Tunnel proxy error: ${err.message}`);
  });
  if (body) {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

/**
 * Opens an ephemeral, authenticated tunnel to `localTargetUrl` using a
 * cloudflared "quick tunnel" (no account/DNS setup required). All exposure is
 * guarded by a random path segment plus a bearer token, and everything is
 * torn down — the cloudflared process, the local proxy server, the TTL timer,
 * and the process-exit hooks themselves — on every exit path: normal close(),
 * an uncaught exception, or a termination signal.
 */
export async function openTunnel(options: OpenTunnelOptions): Promise<TunnelHandle> {
  const token = crypto.randomBytes(24).toString("hex");
  const targetPrefix = `/t/${token}`;
  const callbackPrefix = `/cb/${token}`;

  const localServer = http.createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    if (reqUrl.startsWith(callbackPrefix)) {
      readBody(req)
        .then((buf) => {
          try {
            const event = JSON.parse(buf.toString("utf8") || "{}") as TunnelCallbackEvent;
            options.onCallback?.(event);
          } catch {
            // Malformed callback payloads are dropped rather than crashing the tunnel.
          }
          res.writeHead(204).end();
        })
        .catch(() => {
          res.writeHead(400).end();
        });
      return;
    }
    if (reqUrl.startsWith(targetPrefix)) {
      const remainingPath = reqUrl.slice(targetPrefix.length) || "/";
      forwardToTarget(req, res, options.localTargetUrl, remainingPath);
      return;
    }
    // Any other path (including bare guesses at the token) gets a generic 404 —
    // no hint that a tunnel exists at all.
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  });

  await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  const address = localServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind local tunnel proxy port");
  }
  const localPort = address.port;

  let cloudflared: CloudflaredProcess;
  let publicUrl: string;
  try {
    const result = await startCloudflaredQuickTunnel(localPort);
    cloudflared = result.proc;
    publicUrl = result.url;
  } catch (err) {
    localServer.close();
    throw err;
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(ttlTimer);
    process.off("exit", onProcessExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("uncaughtException", onUncaught);
    try {
      cloudflared.kill("SIGTERM");
    } catch {
      // already dead
    }
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  };

  const onProcessExit = () => {
    try {
      cloudflared.kill("SIGKILL");
    } catch {
      // already dead
    }
  };
  const onSignal = () => {
    void close().finally(() => process.exit(1));
  };
  const onUncaught = (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception — tearing down tunnel before exit:", err);
    void close().finally(() => process.exit(1));
  };

  process.on("exit", onProcessExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("uncaughtException", onUncaught);

  const ttlTimer = setTimeout(() => {
    void close();
  }, options.ttlMs ?? 60 * 60 * 1000);
  // Node shouldn't stay alive purely to fire this safety-net timer.
  ttlTimer.unref?.();

  const targetBaseUrl = `${publicUrl}${targetPrefix}`;

  // cloudflared prints the public URL slightly before Cloudflare's edge has
  // actually finished registering the route, so the very first request can
  // fail even though the tunnel "opened" successfully. Don't hand back a
  // handle until it's actually reachable end-to-end.
  await waitUntilReachable(targetBaseUrl, close);

  return {
    targetBaseUrl,
    callbackUrl: `${publicUrl}${callbackPrefix}`,
    token,
    close,
  };
}

/**
 * Waits for `hostname` to resolve via Cloudflare's own resolver (1.1.1.1),
 * without ever going through the OS resolver. This matters because a quick
 * tunnel's random subdomain genuinely doesn't exist for the first few
 * seconds after cloudflared prints it — and if the *OS* resolver is asked
 * about it that early, macOS/most stub resolvers cache that NXDOMAIN answer
 * for far longer than the propagation delay itself, which would then make
 * every subsequent OS-level lookup fail for a long time even after the
 * record is live. Querying Cloudflare directly first avoids ever poisoning
 * that local cache. Cloudflare's own edge is itself occasionally
 * inconsistent for a few seconds after creation, so this requires a few
 * consecutive successes, not just one, before trusting it.
 */
async function waitForDnsViaCloudflareResolver(hostname: string, maxWaitMs = 60_000): Promise<boolean> {
  const resolver = new dns.Resolver();
  resolver.setServers(["1.1.1.1", "1.0.0.1"]);
  const deadline = Date.now() + maxWaitMs;
  let consecutiveSuccesses = 0;
  while (Date.now() < deadline) {
    try {
      await resolver.resolve4(hostname);
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 3) return true;
    } catch {
      consecutiveSuccesses = 0;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function waitUntilReachable(url: string, onGiveUp: () => Promise<void>, attempts = 30, delayMs = 2000): Promise<void> {
  const hostname = new URL(url).hostname;
  await waitForDnsViaCloudflareResolver(hostname);

  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      // Any HTTP response (even a 4xx/5xx from the local target itself) means
      // the tunnel is routing traffic end-to-end, which is all this checks.
      if (res.status) return;
    } catch (err) {
      lastError = err instanceof Error ? `${err.message}${err.cause ? ` (cause: ${(err.cause as Error).message ?? err.cause})` : ""}` : String(err);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  await onGiveUp();
  throw new Error(`Tunnel did not become reachable at ${url} after ${attempts} attempts (last error: ${lastError})`);
}

function startCloudflaredQuickTunnel(localPort: number): Promise<{ proc: CloudflaredProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error("Timed out waiting for cloudflared to print a public URL"));
      }
    }, 30_000);

    const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(urlPattern);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ proc, url: match[0] });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited early with code ${code}`));
      }
    });
  });
}
