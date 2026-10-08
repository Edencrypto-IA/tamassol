import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createZolanaClient,ShieldedKeypair,SigningKey,SOL_MINT} from '@heliuslabs/zolana';
import {LocalKeys,atSlot} from '@heliuslabs/zolana/client';
import {AssetRegistry,ConfidentialTransfer,ProofInputUtxo,decryptToBalances} from '@heliuslabs/zolana/transaction';
import {recordHeliusCheck} from './helius-readiness.mjs';

// Isolated proving only. No hardware, transaction signer, or broadcaster imports.
const trace=[],controller=new AbortController(),seen=new Set();
const proofDataSource=process.argv.includes('--client-proof-data')?'client':'prover';
const report={scope:'isolated proof generation; no transaction signing or sending',proofDataSource,trace,status:'FAIL'};
const clean=x=>String(x).slice(0,350).replace(/https?:\/\/\S+/g,'[URL]').replace(/[A-Za-z0-9+/=_-]{28,}/g,'[REDACTED]').replace(/\b\d{8,}\b/g,'[NUMBER]');
const shape=(v,depth=0)=>depth>2?'[redacted]':Array.isArray(v)?{type:'array',length:v.length,item:v.length?shape(v[0],depth+1):null}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shape(x,depth+1)])):typeof v;
async function guardedFetch(url,options={}){
 const u=new URL(url),method=options.method??'GET',isProver=u.hostname==='d21ni15goiip6l.cloudfront.net';
 const body=options.body?JSON.parse(options.body):null;
 const rpcCalls=Array.isArray(body)?body:[body];
 assert(!rpcCalls.some(x=>x?.method==='sendTransaction'),'Broadcast prohibited in diagnostic');
 if(!isProver){
  const response=await fetch(url,{...options,signal:AbortSignal.any([controller.signal,...(options.signal?[options.signal]:[]),AbortSignal.timeout(60000)])});
  if(u.hostname==='d2xah7tnhdhcom.cloudfront.net'){
   const json=await response.clone().json();
   if(json.error){const entry={endpoint:u.origin+u.pathname,method,rpcMethod:body?.method,status:response.status,responseBody:{code:json.error.code,message:clean(json.error.message)}};trace.push(entry);console.log(JSON.stringify(entry));}
  }
  return response;
 }
 if(process.argv.includes('--indexer-check'))throw Error('PROVING_DISABLED_FOR_INDEXER_CHECK');
 const id=`${method} ${u.pathname}`;
 // At most one request per endpoint; no SDK transport retry or async polling loop.
 if(seen.has(id)){controller.abort();throw Error('PROVER_REPEAT_BLOCKED');}seen.add(id);
 const entry={endpoint:u.origin+u.pathname,method,headers:Object.fromEntries(new Headers(options.headers)),payload:shape(body),timeoutMs:60000};trace.push(entry);
 const timeout=AbortSignal.timeout(60000);
 try{
  const response=await fetch(url,{...options,signal:AbortSignal.any([controller.signal,timeout,...(options.signal?[options.signal]:[])])});
  entry.status=response.status;entry.contentType=response.headers.get('content-type');
  if(!response.ok){
   const text=await response.clone().text();let parsed;try{parsed=JSON.parse(text);}catch{}
   entry.responseBody=parsed?{keys:Object.keys(parsed),code:parsed.code?clean(parsed.code):null,message:parsed.message?clean(parsed.message):null}:clean(text);
   report.error=response.status>=500?'PROVER_HTTP_5XX':'PROVER_HTTP_4XX';controller.abort();
  }
  console.log(JSON.stringify(entry));return response;
 }catch(e){entry.cause={name:clean(e.name),code:clean(e.cause?.code??''),message:clean(e.message)};report.error??=timeout.aborted?'PROVER_TIMEOUT':'PROVER_NETWORK_ERROR';controller.abort();throw e;}
}
try{
 const secrets=JSON.parse(await readFile('secrets/devnet-only.json','utf8'));assert.equal(secrets.network,'devnet');
 const wallet=name=>ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(Uint8Array.from(Buffer.from(secrets[name],'hex'))));
 const sender=wallet('sender'),recipient=wallet('recipient');
 const client=await createZolanaClient({solanaRpcUrl:`https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY.trim())}`,indexerUrl:'https://d2xah7tnhdhcom.cloudfront.net',proverUrl:'https://d21ni15goiip6l.cloudfront.net',proofDataSource,fetch:guardedFetch});
 assert.equal(await client.solanaRpc.getGenesisHash().send(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
 const prior=JSON.parse(await readFile('router-evidence/result.json','utf8'));assert.equal(prior.status,'passed');report.inputSignature=prior.signature;
 const assets=new AssetRegistry(),old=await client.getShieldedTransactionsBySignature(prior.signature,atSlot(BigInt(prior.providerEvidence.slot)));
 const input=(await decryptToBalances({keypair:sender,registry:assets,transactions:old.transactions.map(x=>x.transaction)})).balance(SOL_MINT);
 assert.equal(input.amount,6000000n);assert.equal(input.utxos.length,1);
 const transfer=new ConfidentialTransfer(sender.shieldedAddress(),[ProofInputUtxo.fromKeypair(input.utxos[0],sender)],sender.toSolanaSigner().address);
 transfer.send(recipient.shieldedAddress(),SOL_MINT,1000000n);
 await client.proveTransact(transfer.sign(sender,assets),LocalKeys.fromKeypair(sender,client.proofService),undefined,{signal:controller.signal,timeoutMs:65000});
 report.status='PASS';
}catch(e){report.error??=e.code==='CLIENT_PROVER_TIMEOUT'?'PROVER_TIMEOUT':'PROVER_INVALID_RESPONSE';report.sdkError={code:clean(e.code??e.name),method:clean(e.details?.method??''),status:e.details?.status??null,cause:e.cause?{name:clean(e.cause.name),code:clean(e.cause.code??'')}:null};}
report.finishedAt=new Date().toISOString();
const stale=trace.some(x=>x.responseBody?.message?.includes('Stale Root'));
const unavailable=trace.some(x=>x.responseBody?.code==='indexer_unavailable');
await recordHeliusCheck({passed:report.status==='PASS',inputSignature:report.inputSignature,errorCode:stale?'STALE_ROOT':unavailable?'INDEXER_UNAVAILABLE':'PROVER_NOT_READY'});
await writeFile(`prover-diagnostic-${Date.now()}.json`,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({status:report.status,error:report.error,sdkError:report.sdkError}));
process.exitCode=report.status==='PASS'?0:1;
