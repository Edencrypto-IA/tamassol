import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import {MemoryDeviceTrustStore,verifyDeviceApprovalProof} from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';
const PIN='0459fdab922f70aea47741c1bbd88c3507a051e4c6de0c55377df9a55c0ef792c174c32300aa4a2645c2b85b7d1eb6637eb326ba5d63ae848d6f5ae9cbf5b14dd5';
export async function physicalApproval(root){
 const fingerprint=createHash('sha256').update(Buffer.from(PIN,'hex')).digest('hex').slice(0,16);
 const key=await webcrypto.subtle.importKey('raw',Buffer.from(PIN,'hex'),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
 const publicKeySpkiBase64=Buffer.from(await webcrypto.subtle.exportKey('spki',key)).toString('base64');
 const trustStore=new MemoryDeviceTrustStore([{deviceId:fingerprint,algorithm:'ECDSA_P256_SHA256',publicKeySpkiBase64,enabled:true}]);
 let approvedEnvelope,approvedProof;
 const hardware={async isConnected(){return true;},async requestApproval(envelope){
  await writeFile(`${root}/device-envelope.json`,JSON.stringify(envelope),{flag:'wx'});
  await new Promise((resolve,reject)=>{
   const child=spawn('../voice-env/Scripts/python.exe',['device-approval-bridge.py','--port','COM3','--request',`${root}/device-envelope.json`,'--out',`${root}/device-response.json`],{windowsHide:true,timeout:115000,stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',chunk=>{if(chunk.toString().includes('@VEIL PENDING'))console.log('DEVICE PENDING: check DEVNET, 0.001 SOL and recipient; hold BOOT then release to approve.');});
   child.stderr.on('data',()=>{});
   child.on('error',()=>reject(Error('DEVICE_BRIDGE_FAILED')));
   child.on('exit',code=>code===0?resolve():reject(Error('DEVICE_BRIDGE_FAILED')));
  });
  const response=JSON.parse(await readFile(`${root}/device-response.json`,'utf8'));
  assert.equal(response.statusLine.split(' ')[4],PIN,'Device identity changed');
  const fields=response.response.split(' ');
  assert.equal(fields[1],'APPROVED','Device did not approve');assert.equal(fields[2],envelope.nonce);assert.equal(fields[3],envelope.routePlanHash);assert.equal(fields[4],fingerprint);assert.match(fields[5],/^[a-f0-9]{128}$/);
  const proof={version:3,deviceId:fingerprint,requestId:envelope.requestId,nonce:envelope.nonce,routePlanHash:envelope.routePlanHash,intentHash:envelope.intentHash,decision:'approved',approvedAtMs:response.receivedAtMs,algorithm:'ECDSA_P256_SHA256',signatureBase64:Buffer.from(fields[5],'hex').toString('base64')};
  assert(await verifyDeviceApprovalProof(envelope,proof,trustStore),'Physical signature invalid or expired');
  await writeFile(`${root}/device-proof.json`,JSON.stringify(proof,null,2),{flag:'wx'});
  approvedEnvelope=structuredClone(envelope);approvedProof=structuredClone(proof);
  console.log('PHYSICAL APPROVAL SIGNATURE VERIFIED');return proof;
 }};
 return {hardware,trustStore,async recheck(){assert(approvedEnvelope && approvedProof);assert(await verifyDeviceApprovalProof(approvedEnvelope,approvedProof,trustStore));assert(Date.now()<approvedEnvelope.expiresAtMs,'Approval expired');}};
}
