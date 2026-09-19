import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../");
const localTargetEntry = path.join(repoRoot, "packages/local-target/src/index.ts");
const PORT = 4000;

let child: ChildProcess | null = null;

export function getLocalTargetUrl(): string {
  return `http://localhost:${PORT}`;
}

export async function isLocalTargetUp(): Promise<boolean> {
  try {
    const res = await fetch(`${getLocalTargetUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startLocalTarget(): Promise<{ started: boolean; url: string }> {
  if (await isLocalTargetUp()) {
    return { started: false, url: getLocalTargetUrl() };
  }
  if (!child) {
    child = spawn("npx", ["tsx", localTargetEntry], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
      detached: false,
    });
    child.on("exit", () => {
      child = null;
    });
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isLocalTargetUp()) return { started: true, url: getLocalTargetUrl() };
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Local sample target did not become healthy within 15s");
}

export function stopLocalTarget(): void {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
}
