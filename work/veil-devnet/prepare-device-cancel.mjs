import {writeFile,mkdir} from 'node:fs/promises';
import {createHeliusProvider,POLICY} from './veil-helius-adapter.mjs';
import {ProviderRegistry,VeilRouter,createVeilIntent,buildApprovalEnvelope} from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';
// Negative device test: transport has no signer, API credentials or broadcast path.
const recipient='J29y21XVkphcaW5mEzWMwz5CWkF6ZLzSfAs7Rip5XEfV';
const a=createHeliusProvider({senderAddress:'8zcPAg2tKBbKhSfpVWixuhcDCgvDnfNHxTZkqoXCWZVH',recipientAddress:recipient,inputSignature:'DEVICE_CANCEL_TEST_NO_SPEND',checkDevnet:async()=>true,execute:async()=>{throw Error('No execution path in cancellation test');}});
const registry=new ProviderRegistry();registry.register(a.provider);
const router=new VeilRouter(registry,{...POLICY,requireHardwareApproval:true});
const prepared=await router.prepare(createVeilIntent({network:'devnet',operation:'private_transfer',asset:{assetId:'SOL',symbol:'SOL',decimals:9},amountBaseUnits:1000000n,recipient:{kind:'solana',address:recipient},privacy:{sender:'irrelevant',recipient:'irrelevant',amount:'required',asset:'required',history:'irrelevant'},feeCeilingBaseUnits:100000n,ttlMs:600000}));
await mkdir('device-evidence',{recursive:true});
const name=process.argv[2]??'cancel';
if(!/^[a-z0-9-]+$/.test(name))throw Error('Invalid evidence name');
await writeFile(`device-evidence/${name}-envelope.json`,JSON.stringify(buildApprovalEnvelope(prepared)),{flag:'wx'});
console.log('Cancellation challenge ready. No transaction can be sent by this test.');
