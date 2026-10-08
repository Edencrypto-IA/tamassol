import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createZolanaClient,ShieldedKeypair,SigningKey,SOL_MINT} from '@heliuslabs/zolana';
import {LocalKeys,atSlot} from '@heliuslabs/zolana/client';
import {transactInstruction} from '@heliuslabs/zolana/interface';
import {AssetRegistry,ConfidentialTransfer,ProofInputUtxo,decryptToBalances} from '@heliuslabs/zolana/transaction';
import {createTransactionMessage,setTransactionMessageFeePayerSigner,setTransactionMessageLifetimeUsingBlockhash,setTransactionMessageConfig,appendTransactionMessageInstructions,signTransactionMessageWithSigners,getSignatureFromTransaction,sendTransactionWithoutConfirmingFactory,compileTransaction} from '@solana/kit';
import {VeilRouter,VeilEngine,ProviderRegistry,StoreBackedReplayGuard,createVeilIntent,verifyPublicReceiptIntegrity} from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';
import {createHeliusProvider,POLICY} from './veil-helius-adapter.mjs';
import {physicalApproval} from './physical-approval.mjs';
import {createProverGuard,withProofBeforeSend} from './prover-safety.mjs';
import {readHeliusReadiness,recordHeliusCheck} from './helius-readiness.mjs';

const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PHYSICAL=process.argv.includes('--physical-approval');
const ROOT=PHYSICAL?'hardware-router-evidence':'router-evidence';
const policy={...POLICY,requireHardwareApproval:PHYSICAL};
const report={version:1,network:'devnet',status:'started',hardware:PHYSICAL,hardwareSignsSolanaTransaction:false,approvalMode:PHYSICAL?'physical-device-p256':'software-test-harness',realProviderCount:1,phases:[]};
let stage='initialization',owned=false;
const stringify=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
async function durable(path,data,exclusive=false){const f=await open(path,exclusive?'wx':'w',0o600);try{await f.writeFile(stringify(data));await f.sync();}finally{await f.close();}}
const save=()=>durable(`${ROOT}/result.json`,report);
async function main(){
 assert(process.argv.includes('--execute-devnet'),'Use --execute-devnet for the one-shot test');
 assert(process.env.HELIUS_API_KEY,'API key missing');
 const prior=JSON.parse(await readFile('transfer-result.json','utf8'));
 assert.equal(prior.status,'passed');assert.equal(prior.network,'devnet');
 const routerPrior=PHYSICAL?JSON.parse(await readFile('router-evidence/result.json','utf8')):null;
 if(PHYSICAL){assert.equal(routerPrior.status,'passed');assert.equal(routerPrior.network,'devnet');}
 const previous=PHYSICAL?{signature:routerPrior.signature,slot:routerPrior.providerEvidence.slot}:prior.phases.find(x=>x.phase==='confidential-transfer');assert(previous);
 const secrets=JSON.parse(await readFile('secrets/devnet-only.json','utf8'));assert.equal(secrets.network,'devnet');
 const wallet=name=>ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(Uint8Array.from(Buffer.from(secrets[name],'hex'))));
 const sender=wallet('sender'),recipient=wallet('recipient'),signer=sender.toSolanaSigner();
 assert.equal(signer.address,prior.sender);assert.equal(recipient.toSolanaSigner().address,prior.recipient);
 const proverGuard=createProverGuard();
 const client=await createZolanaClient({solanaRpcUrl:`https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(process.env.HELIUS_API_KEY.trim())}`,indexerUrl:'https://d2xah7tnhdhcom.cloudfront.net',proverUrl:'https://d21ni15goiip6l.cloudfront.net',fetch:proverGuard.fetch});
 const checkDevnet=async()=>(await client.solanaRpc.getGenesisHash().send())===GENESIS;
 assert(await checkDevnet(),'Wrong network');
 assert(await client.getBalance(signer.address)>100000n,'Insufficient fee funds');
 await mkdir(ROOT,{recursive:true});
 // Durable global lock: never automatically repeat a possibly broadcast spend.
 await durable(`${ROOT}/execution.lock`,{createdAt:new Date().toISOString(),inputSignature:previous.signature},true);owned=true;await save();
 const assets=new AssetRegistry();
 stage='read-existing-private-output';
 const old=await client.getShieldedTransactionsBySignature(previous.signature,atSlot(BigInt(previous.slot)));
 const input=(await decryptToBalances({keypair:sender,registry:assets,transactions:old.transactions.map(x=>x.transaction)})).balance(SOL_MINT);
 assert.equal(input.amount,PHYSICAL?6000000n:7000000n);assert.equal(input.utxos.length,1);
 const physical=PHYSICAL?await physicalApproval(ROOT):null;
 const transport={senderAddress:signer.address,recipientAddress:prior.recipient,inputSignature:previous.signature,checkDevnet,checkReadiness:()=>readHeliusReadiness(previous.signature),
  async execute(intent,plan){
   stage='build-confidential-proof';report.phases.push({phase:'approved-route-dispatched',routePlanHash:plan.routePlanHash});await save();
   assert.equal(intent.recipient.address,prior.recipient);assert.equal(intent.amountBaseUnits,1000000n);
   const transfer=new ConfidentialTransfer(sender.shieldedAddress(),[ProofInputUtxo.fromKeypair(input.utxos[0],sender)],signer.address);
   transfer.send(recipient.shieldedAddress(),SOL_MINT,intent.amountBaseUnits);
   return withProofBeforeSend(async()=>{
    try{return await proverGuard.prove(()=>client.proveTransact(transfer.sign(sender,assets),LocalKeys.fromKeypair(sender,client.proofService),undefined,{signal:proverGuard.signal,timeoutMs:60000}));}
    catch(error){await recordHeliusCheck({errorCode:'PROVER_NOT_READY'});throw error;}
   },async proof=>{
   stage='build-and-check-fee';
   const ix=await transactInstruction({payer:signer,inputTree:client.tree,outputTree:client.tree,data:proof});
   const {value:lifetime}=await client.solanaRpc.getLatestBlockhash().send();
   let message=createTransactionMessage({version:1});
   message=setTransactionMessageFeePayerSigner(signer,message);
   message=setTransactionMessageLifetimeUsingBlockhash(lifetime,message);
   message=setTransactionMessageConfig({computeUnitLimit:450000,loadedAccountsDataSizeLimit:64*1024*1024},message);
   message=appendTransactionMessageInstructions([ix],message);
   const compiled=compileTransaction(message);
   const {value:fee}=await client.solanaRpc.getFeeForMessage(Buffer.from(compiled.messageBytes).toString('base64'),{commitment:'confirmed'}).send();
   assert(fee!==null && fee<=intent.feeCeilingBaseUnits,'Fee ceiling exceeded');
   assert(await checkDevnet(),'Wrong network before signing');
   assert(Date.now()<plan.expiresAtMs,'Route expired before signing');
   if(physical)await physical.recheck();
   const signed=await signTransactionMessageWithSigners(message);
   assert.deepEqual(signed.messageBytes,compiled.messageBytes,'Signed message changed');
   const signature=getSignatureFromTransaction(signed);
   report.signature=signature;report.transactionMessageHash=createHash('sha256').update(signed.messageBytes).digest('hex');report.networkFeeLamports=fee.toString();report.status='signed-not-confirmed';await save();
   stage='broadcast';
   await sendTransactionWithoutConfirmingFactory({rpc:client.solanaRpc})(signed,{commitment:'confirmed'});
   const slot=await client.confirmTransaction(signature);
   report.phases.push({phase:'chain-confirmed',signature,slot:slot.toString()});await save();
   console.log(`CHAIN CONFIRMED: ${signature}`);
   stage='decrypt-transfer-outputs';
   const response=await client.getShieldedTransactionsBySignature(signature,atSlot(slot));
   const txs=response.transactions.map(x=>x.transaction);
   const left=(await decryptToBalances({keypair:sender,registry:assets,transactions:txs})).balance(SOL_MINT);
   const received=(await decryptToBalances({keypair:recipient,registry:assets,transactions:txs})).balance(SOL_MINT);
   assert.equal(left.amount,PHYSICAL?5000000n:6000000n);assert.equal(received.amount,1000000n);
   stage='independent-confirmation';
   const external=await fetch('https://api.devnet.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignatureStatuses',params:[[signature],{searchTransactionHistory:true}]}),signal:AbortSignal.timeout(20000)});
   const status=(await external.json()).result?.value?.[0];assert(status && status.err===null && ['confirmed','finalized'].includes(status.confirmationStatus));
   const evidence={network:'devnet',signature,slot:slot.toString(),confirmation:status.confirmationStatus,verifiedAmountBaseUnits:intent.amountBaseUnits.toString(),senderChangeOutputLamports:left.amount.toString(),recipientNewOutputLamports:received.amount.toString(),inputSignature:previous.signature,networkFeeLamports:fee.toString(),routePlanHash:plan.routePlanHash,transactionMessageHash:report.transactionMessageHash};
   report.providerEvidence=evidence;await save();return evidence;
   });
  }};
 const adapter=createHeliusProvider(transport,physical?{requirePhysicalApproval:true,trustStore:physical.trustStore}:{}),registry=new ProviderRegistry();registry.register(adapter.provider);
 const store={async deleteExpired(){},async getExpiry(n){try{return JSON.parse(await readFile(`${ROOT}/nonce-${n}.json`,'utf8')).expiresAtMs;}catch(e){if(e.code==='ENOENT')return null;throw e;}},async putIfAbsent(n,expiry){assert.match(n,/^[a-f0-9]+$/);try{await durable(`${ROOT}/nonce-${n}.json`,{expiresAtMs:expiry},true);return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}}};
 const engine=new VeilEngine(new VeilRouter(registry,policy),policy,new StoreBackedReplayGuard(store));
 const intent=createVeilIntent({network:'devnet',operation:'private_transfer',asset:{assetId:'SOL',symbol:'SOL',decimals:9},amountBaseUnits:1000000n,recipient:{kind:'solana',address:prior.recipient},privacy:{sender:'irrelevant',recipient:'irrelevant',amount:'required',asset:'required',history:'irrelevant'},feeCeilingBaseUnits:100000n,ttlMs:600000});
 stage='real-route-selection';
 const prepared=await engine.prepare(intent);assert.equal(prepared.plan.selectedProviderId,'helius-confidential-devnet');
 report.intentHash=prepared.intentHash;report.routePlanHash=prepared.plan.routePlanHash;
 await durable(`${ROOT}/prepared-route.json`,prepared);
 if(!physical){await durable(`${ROOT}/software-approval.json`,{mode:'software-test-harness',hardware:false,routePlanHash:prepared.plan.routePlanHash,intentHash:prepared.intentHash,approvedAt:new Date().toISOString()});adapter.approveSoftwareRoute(prepared.plan.routePlanHash);}
 await save();console.log(physical?'ROUTE SELECTED; WAITING FOR DEVICE':'ROUTE SELECTED AND SOFTWARE-APPROVED');
 const outcome=await engine.execute(prepared,physical?{hardware:physical.hardware,trustStore:physical.trustStore}:{});
 assert(await verifyPublicReceiptIntegrity(outcome.receipt));if(physical)assert.equal(outcome.approval.decision,'approved');else assert.equal(outcome.approval,null);
 await durable(`${ROOT}/receipt.json`,outcome.receipt);
 stage='durable-replay-check';
 const restarted=new VeilEngine(new VeilRouter(registry,policy),policy,new StoreBackedReplayGuard(store));
 await assert.rejects(()=>restarted.execute(prepared),/already used/);
 report.replayBlockedAfterEngineRestart=true;report.receiptHash=outcome.receipt.receiptHash;report.status='passed';report.completedAt=new Date().toISOString();await save();
 console.log(`PASS: Veil intent -> real route -> ${report.approvalMode} -> chain -> local decryption -> receipt; durable replay blocked.`);
}
main().catch(async e=>{if(owned){report.status='blocked';report.failedStage=stage;report.errorCode=typeof e.code==='string'?e.code:'TEST_FAILED';if(e.safeDetails)report.proverDiagnostic=e.safeDetails;await save();}console.error(`BLOCKED: ${stage}; ${typeof e.code==='string'?e.code:'TEST_FAILED'}. Inspect journal; never automatically retry a spend.`);process.exitCode=1;});
