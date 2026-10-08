import { readFile, writeFile } from 'node:fs/promises';
const result=JSON.parse(await readFile('privacy-preflight-official-example-separate.json','utf8'));
if(result.network!=='devnet'||result.checks.some(x=>!x.ok)) throw Error('Preflight required');
const endpoint=process.argv.includes('--helius')
 ? `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY ?? '')}`
 : 'https://api.devnet.solana.com';
async function rpc(method,params=[]) {
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});
 if(!r.ok) throw Error(`HTTP_${r.status}`);
 const d=await r.json();if(d.error) throw Error(`RPC_${d.error.code}`);return d.result;
}
try {
 if(await rpc('getGenesisHash')!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('WRONG_NETWORK');
 const balance=(await rpc('getBalance',[result.sender])).value;
 if(balance>=20000000){console.log(`FUNDED: ${balance} lamports`);}
 else {
 const signature=await rpc('requestAirdrop',[result.sender,100000000]);
 await writeFile('airdrop-result.json',JSON.stringify({network:'devnet',sender:result.sender,signature},null,2));
 console.log(`AIRDROP REQUESTED: ${signature}`);
 }
}catch(e){console.error(/^HTTP_|^RPC_|^WRONG_NETWORK$/.test(e.message)?e.message:'AIRDROP_UNAVAILABLE');process.exitCode=1;}
