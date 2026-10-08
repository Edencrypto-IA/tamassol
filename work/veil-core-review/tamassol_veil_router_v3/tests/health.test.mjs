import test from 'node:test';
import assert from 'node:assert/strict';
import {VeilRouter,VeilEngine,ProviderRegistry,MemoryReplayGuard,DeterministicDemoProvider,createVeilIntent} from '../dist/index.js';
// All providers in this file are explicit mocks, NOT live Cloak/Helius integrations.
const exposure={sender:'public',recipient:'public',amount:'hidden',asset:'hidden',history:'unknown'};
const policy={version:1,enabledProviderIds:'all',allowedAssetIds:['SOL'],allowDemoProviders:true,allowExperimentalProviders:false,requireSelfCustody:true,requireHardwareKeyIsolation:'off',requireHardwareApproval:true,minPrivacyScore:0,maxQuoteAgeMs:600000,maxIntentAgeMs:600000,maxClockSkewMs:5000,maxFeeByAssetId:{SOL:100000n}};
const intent=()=>createVeilIntent({network:'devnet',operation:'private_transfer',asset:{assetId:'SOL',symbol:'SOL',decimals:9},amountBaseUnits:1000000n,recipient:{kind:'solana',address:'J29y21XVkphcaW5mEzWMwz5CWkF6ZLzSfAs7Rip5XEfV'},privacy:{sender:'irrelevant',recipient:'irrelevant',amount:'required',asset:'required',history:'irrelevant'},feeCeilingBaseUnits:100000n,ttlMs:120000});
function provider(id,health='HEALTHY',e=exposure){const p=new DeterministicDemoProvider({providerId:id,exposure:e,feeBaseUnits:1000n,latencyMs:1});p.healthCheck=async()=>({health,proverReady:health==='HEALTHY',...(health==='DEGRADED'?{errorCode:'STALE_ROOT'}:{})});return p;}
function setup(...providers){const registry=new ProviderRegistry();providers.forEach(p=>registry.register(p));const router=new VeilRouter(registry,policy);return {router,engine:new VeilEngine(router,policy,new MemoryReplayGuard())};}
const unavailable={code:'NO_HEALTHY_PRIVACY_ROUTE',message:'This privacy route is temporarily unavailable.'};
test('Helius healthy and ready is selected',async()=>{const {router}=setup(provider('helius'));assert.equal((await router.prepare(intent())).plan.selectedProviderId,'helius');});
test('Helius stale root excluded and safe health record retained',async()=>{const {router}=setup(provider('helius','DEGRADED'));await assert.rejects(()=>router.prepare(intent()),unavailable);const [r]=router.getProviderHealth();assert.equal(r.health,'DEGRADED');assert.equal(r.errorCode,'STALE_ROOT');assert.equal(r.lastSuccessfulCheck,null);assert(Number.isSafeInteger(r.timestamp));});
test('degraded Helius selects compatible MOCK Cloak without modifying intent',async()=>{const {router}=setup(provider('helius','DEGRADED'),provider('cloak-mock'));const i=intent(),p=await router.prepare(i);assert.equal(p.plan.selectedProviderId,'cloak-mock');assert.deepEqual(p.intent,i);});
test('privacy-reducing fallback forbidden before health/quote',async()=>{const weak=provider('cloak-mock','HEALTHY',{...exposure,amount:'public'});let calls=0;weak.healthCheck=async()=>{calls++;return {health:'HEALTHY',proverReady:true};};const {router}=setup(provider('helius','DEGRADED'),weak);await assert.rejects(()=>router.prepare(intent()),unavailable);assert.equal(calls,0);});
test('no healthy provider blocks operation',async()=>{const {router}=setup(provider('helius','DEGRADED'),provider('cloak-mock','UNAVAILABLE'));await assert.rejects(()=>router.prepare(intent()),unavailable);});
test('provider degrading after prepare never calls hardware',async()=>{const p=provider('helius'),{engine}=setup(p),prepared=await engine.prepare(intent());p.healthCheck=async()=>({health:'DEGRADED',proverReady:false,errorCode:'INDEXER_UNAVAILABLE'});let calls=0;await assert.rejects(()=>engine.execute(prepared,{hardware:{isConnected:async()=>{calls++;return true;},requestApproval:async()=>{calls++;}},trustStore:{}}),unavailable);assert.equal(calls,0);});
test('healthy but prover not ready never creates RoutePlan',async()=>{const p=provider('helius');p.healthCheck=async()=>({health:'HEALTHY',proverReady:false});await assert.rejects(()=>setup(p).router.prepare(intent()),unavailable);});
test('stale root exception sanitized and classified degraded',async()=>{const p=provider('helius');p.healthCheck=async()=>{throw Error('Stale Root private-internal-message');};const {router}=setup(p);await assert.rejects(()=>router.prepare(intent()),unavailable);assert.equal(router.getProviderHealth()[0].health,'DEGRADED');assert(!JSON.stringify(router.getProviderHealth()).includes('private-internal-message'));});
test('last successful check retained across degradation',async()=>{const p=provider('helius'),{router}=setup(p);await router.prepare(intent());const t=router.getProviderHealth()[0].lastSuccessfulCheck;p.healthCheck=async()=>({health:'DEGRADED',proverReady:false});await assert.rejects(()=>router.prepare(intent()));assert.equal(router.getProviderHealth()[0].lastSuccessfulCheck,t);});
test('legacy ping-only health fails closed',async()=>{const p=provider('helius');p.healthCheck=async()=>({ok:true});await assert.rejects(()=>setup(p).router.prepare(intent()),unavailable);});
test('degradation during quote excludes provider before RoutePlan creation',async()=>{
 const p=provider('helius');const quote=p.quote.bind(p);
 p.quote=async i=>{const q=await quote(i);p.healthCheck=async()=>({health:'DEGRADED',proverReady:false,errorCode:'STALE_ROOT'});return q;};
 await assert.rejects(()=>setup(p).router.prepare(intent()),unavailable);
});
test('indexer_unavailable cannot be mislabeled HEALTHY',async()=>{
 const p=provider('helius');p.healthCheck=async()=>({health:'HEALTHY',proverReady:true,errorCode:'indexer_unavailable'});
 const {router}=setup(p);await assert.rejects(()=>router.prepare(intent()),unavailable);
 assert.equal(router.getProviderHealth()[0].health,'DEGRADED');
});
