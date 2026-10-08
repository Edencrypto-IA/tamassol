import net from "node:net";

const RPC = "http://127.0.0.1:8899";
const SERVICES = [
  ["photon", 8784],
  ["prover", 3001],
];

async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC_${body.error.code}`);
  return body.result;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2_500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function localnetReadiness() {
  const checks = [];
  try {
    const health = await rpc("getHealth");
    checks.push({ service: "solana-rpc", ok: health === "ok" });
  } catch {
    checks.push({ service: "solana-rpc", ok: false });
  }

  for (const [service, port] of SERVICES) {
    checks.push({ service, ok: await portOpen(port) });
  }

  return {
    health: checks.every((x) => x.ok) ? "HEALTHY" : "UNAVAILABLE",
    proverReady: checks.every((x) => x.ok),
    errorCode: checks.every((x) => x.ok) ? "NONE" : "LOCALNET_SERVICE_UNAVAILABLE",
    checks,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  const result = await localnetReadiness();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.health === "HEALTHY" ? 0 : 1;
}
