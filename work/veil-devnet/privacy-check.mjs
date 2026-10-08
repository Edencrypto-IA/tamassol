import { createZolanaClient, ShieldedKeypair, SigningKey } from '@heliuslabs/zolana';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const key = process.env.HELIUS_API_KEY?.trim();
if (!key) throw new Error('HELIUS_API_KEY missing');
const endpoint = `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
const report = { network: 'devnet', mode: 'read-only-privacy-preflight', checks: [] };
const timedFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
function safeCode(error) { return typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'SERVICE_UNAVAILABLE'; }
async function run(name, fn) {
  try { const detail = await fn(); report.checks.push({ name, ok: true, detail }); console.log(`PASS ${name}: ${JSON.stringify(detail)}`); }
  catch (error) { const code = safeCode(error); report.checks.push({ name, ok: false, code }); console.log(`FAIL ${name}: ${code}`); }
}
try {
  // Separate HTTPS endpoints used by the official zolana-examples repository.
  const separate = process.argv.includes('--official-separate-endpoints');
  report.endpoints = separate ? 'official-example-separate' : 'unified-helius';
  const client = await createZolanaClient({ solanaRpcUrl: endpoint, fetch: timedFetch,
    ...(separate ? { indexerUrl: 'https://d2xah7tnhdhcom.cloudfront.net', proverUrl: 'https://d21ni15goiip6l.cloudfront.net' } : {}),
  });
  const genesis = await client.solanaRpc.getGenesisHash().send();
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Wrong network');
  await mkdir('secrets', { recursive: true });
  let seeds;
  try { seeds = JSON.parse(await readFile('secrets/devnet-only.json', 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    seeds = { network: 'devnet', sender: randomBytes(32).toString('hex'), recipient: randomBytes(32).toString('hex') };
    await writeFile('secrets/devnet-only.json', JSON.stringify(seeds), { flag: 'wx', mode: 0o600 });
  }
  if (seeds.network !== 'devnet') throw new Error('Wrong wallet scope');
  const sender = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(Uint8Array.from(Buffer.from(seeds.sender, 'hex'))));
  report.sender = sender.toSolanaSigner().address;
  console.log(`TEST WALLET: ${report.sender}`);
  await run('public-balance', async () => String(await client.getBalance(report.sender)));
  await run('privacy-indexer', async () => {
    const r = await client.getShieldedTransactionsByTags({ tags: [sender.shieldedAddress().confidentialViewTag()] });
    return { transactions: r.transactions.length };
  });
  await run('privacy-prover', async () => {
    const r = await client.proverHealth(); return { status: r.status, circuits: r.circuits };
  });
  report.completedAt = new Date().toISOString();
  await writeFile(`privacy-preflight-${report.endpoints}.json`, JSON.stringify(report, null, 2));
  if (report.checks.some(c => !c.ok)) process.exitCode = 2;
} catch(error) { console.error(`BLOCKED ${safeCode(error)}; no transaction submitted.`); process.exitCode = 1; }
