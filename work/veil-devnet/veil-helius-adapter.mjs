import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DriverBackedVeilProvider, hashIntent, buildApprovalEnvelope, verifyDeviceApprovalProof } from '../veil-core-review/tamassol_veil_router_v3/dist/index.js';

export const EXPOSURE = Object.freeze({sender:'public',recipient:'public',asset:'hidden',amount:'hidden',history:'unknown',note:'Confidential amount and asset only; no sender, recipient or history anonymity claim.'});
export const POLICY = Object.freeze({version:1,enabledProviderIds:['helius-confidential-devnet'],allowedAssetIds:['SOL'],allowDemoProviders:false,allowExperimentalProviders:true,requireSelfCustody:true,requireHardwareKeyIsolation:'off',requireHardwareApproval:false,minPrivacyScore:0,maxQuoteAgeMs:600000,maxIntentAgeMs:600000,maxClockSkewMs:5000,maxFeeByAssetId:{SOL:100000n}});
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// Local Devnet adapter. The transport is trusted code, not a remote route payload.
// No unverified provider is registered; software approval is never called hardware approval.
export function createHeliusProvider(transport, options={}) {
  const issued = new Map();
  const approvals = new Set();
  const manifest = {providerId:'helius-confidential-devnet',providerVersion:'0.1.0-devnet',displayName:'Helius confidential / Devnet',release:'experimental',networks:['devnet'],operations:['private_transfer'],supportedAssetIds:['SOL'],hardwareKeyIsolation:'incompatible',selfCustodial:true,secretStateModel:'wallet_derived',exposureByOperation:{private_transfer:{...EXPOSURE}}};
  const driver = {
    async healthCheck(intent) {
      if(!await transport.checkDevnet())return {health:'UNAVAILABLE',proverReady:false,errorCode:'NETWORK_UNAVAILABLE'};
      if(!transport.checkReadiness)return {health:'DEGRADED',proverReady:false,errorCode:'PROVER_NOT_READY'};
      return transport.checkReadiness(intent);
    },
    async quote(intent) {
      assert.equal(intent.network,'devnet');
      assert.equal(intent.operation,'private_transfer');
      assert.equal(intent.asset.assetId,'SOL');
      assert.equal(intent.asset.decimals,9);
      assert.equal(intent.recipient?.kind,'solana');
      assert.equal(intent.recipient.address,transport.recipientAddress);
      assert(intent.amountBaseUnits>0n && intent.amountBaseUnits<=1000000n,'Devnet test amount cap');
      const intentHash=await hashIntent(intent);
      const quoteId=digest(randomUUID());
      const validUntilMs=Math.min(intent.expiresAtMs,Date.now()+600000);
      const providerPlanCommitment=digest({domain:'TAMASSOL_HELIUS_DEVNET_V1',intentHash,quoteId,validUntilMs,sender:transport.senderAddress,recipient:transport.recipientAddress,inputSignature:transport.inputSignature,sdk:'0.4.0-alpha',exposure:EXPOSURE});
      const quote={quoteId,validUntilMs,exposure:{...EXPOSURE},estimatedFeeBaseUnits:100000n,estimatedLatencyMs:60000,providerPlanCommitment,warnings:['Software signer; test tokens only. Fee is a conservative ceiling, not a measured quote.']};
      issued.set(quoteId,{intentHash,quote:structuredClone(quote)});
      return quote;
    },
    async execute(intent,quote,context) {
      const original=issued.get(quote.quoteId);
      assert(original,'Unknown or consumed quote');
      assert.equal(await hashIntent(intent),original.intentHash,'Intent binding mismatch');
      for(const name of Object.keys(original.quote)) assert.deepEqual(quote[name],original.quote[name],`Quote binding mismatch: ${name}`);
      assert.equal(context.routePlan.intentHash,original.intentHash);
      assert.equal(context.routePlan.selectedProviderPlanCommitment,quote.providerPlanCommitment);
      assert.equal(context.routePlan.selectedProviderId,manifest.providerId);
      if(options.requirePhysicalApproval){
        assert(context.approval && options.trustStore,'Physical approval required');
        const envelope=buildApprovalEnvelope({intent,intentHash:original.intentHash,plan:context.routePlan,selectedQuote:quote});
        assert(await verifyDeviceApprovalProof(envelope,context.approval,options.trustStore),'Physical approval invalid');
      }else assert(approvals.delete(context.routePlan.routePlanHash),'Software route approval required');
      issued.delete(quote.quoteId);
      assert.equal(intent.network,'devnet');
      assert(await transport.checkDevnet(),'Wrong network');
      assert(Date.now()<quote.validUntilMs,'Quote expired');
      const result=await transport.execute(structuredClone(intent),structuredClone(context.routePlan));
      assert.equal(result.network,'devnet');
      assert.equal(result.verifiedAmountBaseUnits,intent.amountBaseUnits.toString());
      assert(['confirmed','finalized'].includes(result.confirmation));
      return {ok:true,completedAtMs:Date.now(),actualExposure:{...EXPOSURE},chainSignature:result.signature,providerEvidence:JSON.stringify(result),secretStateCommitted:true};
    }
  };
  return {provider:new DriverBackedVeilProvider(manifest,driver),approveSoftwareRoute(hash){assert.match(hash,/^[a-f0-9]{64}$/);approvals.add(hash);}};
}
