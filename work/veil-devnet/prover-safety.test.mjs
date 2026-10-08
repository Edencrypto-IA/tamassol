import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProverFailure,createProverGuard,withProofBeforeSend} from './prover-safety.mjs';
const endpoint='https://d21ni15goiip6l.cloudfront.net/prove/transfer_confidential_1_2/indexed';
for(const [expected,error,observed] of [
 ['PROVER_TIMEOUT',{code:'CLIENT_PROVER_TIMEOUT'},{}],
 ['PROVER_NETWORK_ERROR',{}, {kind:'network'}],
 ['PROVER_HTTP_4XX',{}, {status:429}],
 ['PROVER_HTTP_5XX',{}, {status:502}],
 ['PROVER_INVALID_RESPONSE',{code:'CLIENT_PROVER_JSON'},{}],
])test(`${expected}: signing/sendTransaction continuation never called`,async()=>{
 assert.equal(classifyProverFailure(error,observed),expected);
 let sendTransactionCalls=0;
 await assert.rejects(()=>withProofBeforeSend(async()=>{throw Error(expected);},async()=>{sendTransactionCalls++;}));
 assert.equal(sendTransactionCalls,0);
});
test('one success permits exactly one continuation',async()=>{let calls=0;assert.equal(await withProofBeforeSend(async()=>42,async p=>{calls++;return p;}),42);assert.equal(calls,1);});
for(const status of [429,502])test(`HTTP ${status} cannot trigger network retry`,async()=>{
 let calls=0;const g=createProverGuard(async()=>{calls++;return new Response('{}',{status});});
 await g.fetch(endpoint,{method:'POST'});assert(g.signal.aborted);
 await assert.rejects(()=>g.fetch(endpoint,{method:'POST'}));assert.equal(calls,1);
});
test('network failure aborts and never retries',async()=>{let calls=0;const g=createProverGuard(async()=>{calls++;throw new TypeError('network');});await assert.rejects(()=>g.prove(()=>g.fetch(endpoint,{method:'POST'})),{code:'PROVER_NETWORK_ERROR'});await assert.rejects(()=>g.fetch(endpoint,{method:'POST'}));assert.equal(calls,1);});
test('upstream cancellation signal is preserved',async()=>{const c=new AbortController();c.abort();const g=createProverGuard(async(_u,o)=>{assert(o.signal.aborted);throw Error('aborted');});await assert.rejects(()=>g.fetch(endpoint,{method:'POST',signal:c.signal}));});
