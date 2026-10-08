// Read-only checks: no wallets loaded, no signing, no transactions submitted.
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC_${body.error.code}`);
  return body.result;
}
async function main() {
  const genesis = await rpc('https://api.devnet.solana.com', 'getGenesisHash');
  if (genesis !== DEVNET_GENESIS) throw new Error('WRONG_NETWORK');
  console.log('PASS: public Solana RPC is Devnet (genesis verified).');
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key || key === 'YOUR_KEY') {
    console.log('BLOCKED: HELIUS_API_KEY missing. No private transfer attempted.');
    process.exitCode = 2;
    return;
  }
  const endpoint = `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
  const heliusGenesis = await rpc(endpoint, 'getGenesisHash');
  if (heliusGenesis !== DEVNET_GENESIS) throw new Error('WRONG_NETWORK');
  console.log('PASS: Helius RPC credentials accepted on Devnet.');
  console.log('NEXT: validate Privacy indexer/prover and isolated test wallets. RPC access alone does not prove Privacy access.');
}
main().catch(error => {
  // Never dump SDK/network exceptions: URLs can include credentials.
  const code = /^(HTTP_\d+|RPC_-?\d+|WRONG_NETWORK)$/.test(error.message) ? error.message : 'NETWORK_CHECK_FAILED';
  console.error(`BLOCKED: ${code}. No transaction submitted.`);
  process.exitCode = 1;
});
