import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeliusProvider,POLICY} from './veil-helius-adapter.mjs';
import {VeilRouter,VeilEngine,ProviderRegistry,MemoryReplayGuard,createVeilIntent,verifyPublicReceiptIntegrity} from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';
export const RECIPIENT='J29y21XVkphcaW5mEzWMwz5CWkF6ZLzSfAs7Rip5XEfV';
function setup({healthy=true,policy={},adapterOptions={}}={}) {
 let calls=0;
 const t={recipientAddress:RECIPIENT,senderAddress:'8zcPAg2tKBbKhSfpVWixuhcDCgvDnfNHxTZkqoXCWZVH',inputSignature:'LOCAL_TEST_ONLY',checkDevnet:async()=>healthy,execute:async(i)=>{calls++;return {network:'devnet',signature:'LOCAL_MOCK_NOT_CHAIN_EVIDENCE',verifiedAmountBaseUnits:i.amountBaseUnits.toString(),confirmation:'confirmed'};}};
 t.checkReadiness=async()=>({health:'HEALTHY',proverReady:true});
 const a=createHeliusProvider(t,adapterOptions),r=new ProviderRegistry();r.register(a.provider);
 const p={...POLICY,...policy};return {...a,engine:new VeilEngine(new VeilRouter(r,p),p,new MemoryReplayGuard()),calls:()=>calls};
}
function intent(overrides={}) {return {...createVeilIntent({network:'devnet',operation:'private_transfer',asset:{assetId:'SOL',symbol:'SOL',decimals:9},amountBaseUnits:1000000n,recipient:{kind:'solana',address:RECIPIENT},privacy:{sender:'irrelevant',recipient:'irrelevant',asset:'required',amount:'required',history:'irrelevant'},feeCeilingBaseUnits:100000n,ttlMs:600000}),...overrides};}
test('LOCAL ONLY: adapter routes and creates an integrity-checkable receipt',async()=>{const s=setup(),p=await s.engine.prepare(intent());s.approveSoftwareRoute(p.plan.routePlanHash);const r=await s.engine.execute(p);assert(await verifyPublicReceiptIntegrity(r.receipt));assert.equal(s.calls(),1);assert.equal(r.approval,null);r.receipt.chainSignature='tampered';assert.equal(await verifyPublicReceiptIntegrity(r.receipt),false);});
for(const field of ['sender','recipient','history']) test(`required ${field} privacy fails closed`,async()=>{const s=setup(),i=intent();i.privacy[field]='required';await assert.rejects(()=>s.engine.prepare(i),{code:'NO_HEALTHY_PRIVACY_ROUTE'});assert.equal(s.calls(),0);});
for(const [label,mutation] of [
 ['amount',p=>p.intent.amountBaseUnits=999n],
 ['recipient',p=>p.intent.recipient.address='11111111111111111111111111111111'],
 ['provider',p=>p.plan.selectedProviderId='cloak'],
 ['fee',p=>p.selectedQuote.estimatedFeeBaseUnits=0n],
 ['commitment',p=>p.selectedQuote.providerPlanCommitment='0'.repeat(64)],
 ['exposure',p=>p.selectedQuote.exposure.sender='hidden'],
]) test(`tampered ${label} blocked before transport`,async()=>{const s=setup(),p=await s.engine.prepare(intent());s.approveSoftwareRoute(p.plan.routePlanHash);mutation(p);await assert.rejects(()=>s.engine.execute(p));assert.equal(s.calls(),0);});
test('software route approval is mandatory',async()=>{const s=setup(),p=await s.engine.prepare(intent());await assert.rejects(()=>s.engine.execute(p),/Software route approval required/);assert.equal(s.calls(),0);});
test('physical mode rejects software approval without device proof',async()=>{const s=setup({adapterOptions:{requirePhysicalApproval:true}}),p=await s.engine.prepare(intent());s.approveSoftwareRoute(p.plan.routePlanHash);await assert.rejects(()=>s.engine.execute(p),/Physical approval required/);assert.equal(s.calls(),0);});
test('replay blocked',async()=>{const s=setup(),p=await s.engine.prepare(intent());s.approveSoftwareRoute(p.plan.routePlanHash);await s.engine.execute(p);await assert.rejects(()=>s.engine.execute(p),/already used/);assert.equal(s.calls(),1);});
test('unavailable provider has no silent public fallback',async()=>{const s=setup({healthy:false});await assert.rejects(()=>s.engine.prepare(intent()),{code:'NO_HEALTHY_PRIVACY_ROUTE'});assert.equal(s.calls(),0);});
test('mainnet disabled',async()=>{const s=setup();await assert.rejects(()=>s.engine.prepare(intent({network:'mainnet-beta'})),{code:'NO_HEALTHY_PRIVACY_ROUTE'});});
test('fee ceiling enforced',async()=>{const s=setup();await assert.rejects(()=>s.engine.prepare(intent({feeCeilingBaseUnits:1n})),{code:'NO_HEALTHY_PRIVACY_ROUTE'});});
test('expired intent blocked',async()=>{const s=setup();await assert.rejects(()=>s.engine.prepare(intent({expiresAtMs:Date.now()-1})),{code:'INTENT_EXPIRED'});});
test('hardware-isolation policy rejects software adapter',async()=>{const s=setup({policy:{requireHardwareKeyIsolation:'strict'}});await assert.rejects(()=>s.engine.prepare(intent()),{code:'NO_HEALTHY_PRIVACY_ROUTE'});});
