import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readHeliusReadiness,recordHeliusCheck} from './helius-readiness.mjs';
test('persisted real stale-root diagnosis blocks Helius offline (no RPC)',async()=>{
 const state=JSON.parse(await readFile('provider-health/helius.json','utf8'));
 assert.equal(state.health,'DEGRADED');assert.equal(state.errorCode,'STALE_ROOT');assert.equal(state.proverReady,false);
});
test('readiness missing, fresh, wrong input, expired and failed remains fail-closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'veil-health-test-'));
 assert.equal((await readHeliusReadiness('input',root,100000)).health,'UNAVAILABLE');
 await recordHeliusCheck({passed:true,inputSignature:'input'},root,100000);
 assert.equal((await readHeliusReadiness('input',root,100001)).health,'HEALTHY');
 assert.equal((await readHeliusReadiness('other-input',root,100001)).health,'DEGRADED');
 assert.equal((await readHeliusReadiness('input',root,131000)).health,'DEGRADED');
 await recordHeliusCheck({errorCode:'INDEXER_UNAVAILABLE'},root,132000);
 const failed=await readHeliusReadiness('input',root,132001);
 assert.equal(failed.health,'DEGRADED');assert.equal(failed.lastSuccessfulCheck,100000);
 const logs=(await readFile(join(root,'checks.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 for(const row of logs)for(const k of ['provider','health','errorCode','timestamp','lastSuccessfulCheck'])assert(k in row);
});
