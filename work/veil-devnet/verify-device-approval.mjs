import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {MemoryDeviceTrustStore,verifyDeviceApprovalProof} from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';
const name=process.argv[2];assert.match(name??'',/^[a-z0-9-]+$/);
const root=`device-evidence/${name}`;
const envelope=JSON.parse(await readFile(`${root}-envelope.json`,'utf8'));
const response=JSON.parse(await readFile(`${root}-response.json`,'utf8'));
// Pin the public key observed before this challenge. This is local USB TOFU,
// not secure-element certification or independently authenticated enrollment.
const pinned='0459fdab922f70aea47741c1bbd88c3507a051e4c6de0c55377df9a55c0ef792c174c32300aa4a2645c2b85b7d1eb6637eb326ba5d63ae848d6f5ae9cbf5b14dd5';
const status=response.statusLine.split(' ');assert.equal(status[4],pinned);
const fingerprint=createHash('sha256').update(Buffer.from(pinned,'hex')).digest('hex').slice(0,16);
const fields=response.response.split(' ');assert.equal(fields[1],'APPROVED');assert.equal(fields[2],envelope.nonce);assert.equal(fields[3],envelope.routePlanHash);assert.equal(fields[4],fingerprint);assert.match(fields[5],/^[a-f0-9]{128}$/);
const key=await webcrypto.subtle.importKey('raw',Buffer.from(pinned,'hex'),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
const publicKeySpkiBase64=Buffer.from(await webcrypto.subtle.exportKey('spki',key)).toString('base64');
const trust=new MemoryDeviceTrustStore([{deviceId:fingerprint,algorithm:'ECDSA_P256_SHA256',publicKeySpkiBase64,enabled:true}]);
const proof={version:3,deviceId:fingerprint,requestId:envelope.requestId,nonce:envelope.nonce,routePlanHash:envelope.routePlanHash,intentHash:envelope.intentHash,decision:'approved',approvedAtMs:response.receivedAtMs,algorithm:'ECDSA_P256_SHA256',signatureBase64:Buffer.from(fields[5],'hex').toString('base64')};
assert(await verifyDeviceApprovalProof(envelope,proof,trust,response.receivedAtMs),'Device signature did not match displayed envelope');
const rejected=[];
for(const [field,value] of [['amountBaseUnits','2000000'],['recipientBinding','solana:11111111111111111111111111111111'],['routePlanHash','0'.repeat(64)],['selectedProviderId','other-provider'],['feeBaseUnits','999999'],['network','mainnet-beta'],['nonce','0'.repeat(48)]]){
 assert.equal(await verifyDeviceApprovalProof({...envelope,[field]:value},proof,trust,response.receivedAtMs),false,`Tampered ${field} accepted`);rejected.push(field);
}
const altered=structuredClone(envelope);altered.selectedExposure.amount='public';assert.equal(await verifyDeviceApprovalProof(altered,proof,trust,response.receivedAtMs),false);rejected.push('selectedExposure.amount');
const result={status:'passed',scope:'physical approval signature only; no blockchain execution',fingerprint,signatureValid:true,tamperedFieldsRejected:rejected,solanaTransactionSent:false,trustModel:'Local USB first-observed public key pinned',timestampSource:'Host receipt time, not an authenticated device clock',checkedAt:new Date().toISOString()};
await writeFile(`${root}-verification.json`,JSON.stringify({result,proof},null,2),{flag:'wx'});console.log(JSON.stringify(result,null,2));
