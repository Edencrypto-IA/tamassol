import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createZolanaClient, ShieldedKeypair, SigningKey, SOL_MINT } from '@heliuslabs/zolana';
import { LocalKeys, atSlot } from '@heliuslabs/zolana/client';
import { depositInstruction, DepositAsset, transactInstruction } from '@heliuslabs/zolana/interface';
import { AssetRegistry, ConfidentialTransfer, ProofInputUtxo, decryptToBalances } from '@heliuslabs/zolana/transaction';
import {
  createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, setTransactionMessageConfig,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners,
  assertIsTransactionWithBlockhashLifetime, getSignatureFromTransaction,
  sendTransactionWithoutConfirmingFactory,
} from '@solana/kit';

// Isolated provider integration test, NOT a Veil router or hardware end-to-end test.
const DEPOSIT = 10000000n, TRANSFER = 3000000n;
const report = { network: 'devnet', scope: 'Helius confidential provider integration only',
  hardware: false, veilRouter: false, status: 'started', phases: [],
  privacy: { sender: 'public', recipient: 'public', asset: 'encrypted', amount: 'encrypted' } };
let stage = 'initialization';
const save = () => writeFile('transfer-result.json', JSON.stringify(report, (_,v)=>typeof v==='bigint'?v.toString():v, 2));
async function main() {
  const key = process.env.HELIUS_API_KEY?.trim();
  assert(key, 'API key missing');
  const seeds = JSON.parse(await readFile('secrets/devnet-only.json','utf8'));
  assert.equal(seeds.network,'devnet');
  const client = await createZolanaClient({
    solanaRpcUrl: `https://devnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`,
    indexerUrl: 'https://d2xah7tnhdhcom.cloudfront.net',
    proverUrl: 'https://d21ni15goiip6l.cloudfront.net',
    fetch: (url,options={})=>fetch(url,{...options,signal:AbortSignal.timeout(60000)}),
  });
  assert.equal(await client.solanaRpc.getGenesisHash().send(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  const wallet = name => ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(Uint8Array.from(Buffer.from(seeds[name],'hex'))));
  const sender=wallet('sender'), recipient=wallet('recipient'), signer=sender.toSolanaSigner();
  report.sender=signer.address;report.recipient=recipient.toSolanaSigner().address;
  assert(await client.getBalance(signer.address)>=20000000n,'Insufficient test SOL');
  // Never silently repeat a broadcast after a crash or timeout.
  let previousDeposit;
  if(process.argv.includes('--resume-proof')) {
    const previous=JSON.parse(await readFile('transfer-result.json','utf8'));
    assert.equal(previous.sender,report.sender);assert.equal(previous.recipient,report.recipient);
    assert.equal(previous.network,'devnet');assert.equal(previous.failedStage,'transfer-proof');
    assert.equal(previous.phases.length,1);assert.equal(previous.phases[0].status,'confirmed');
    assert.equal(previous.phases[0].phase,'deposit');
    previousDeposit={signature:previous.phases[0].signature,slot:BigInt(previous.phases[0].slot)};
    report.phases=previous.phases;
  } else await writeFile('transfer-started.lock',new Date().toISOString(),{flag:'wx'});
  await save();
  const assets = new AssetRegistry();
  async function send(instructions,phase) {
    stage=phase;
    assert.equal(await client.solanaRpc.getGenesisHash().send(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    const {value:lifetime}=await client.solanaRpc.getLatestBlockhash().send();
    let message=createTransactionMessage({version:1});
    message=setTransactionMessageFeePayerSigner(signer,message);
    message=setTransactionMessageLifetimeUsingBlockhash(lifetime,message);
    message=setTransactionMessageConfig({computeUnitLimit:450000,loadedAccountsDataSizeLimit:64*1024*1024},message);
    message=appendTransactionMessageInstructions(instructions,message);
    const signed=await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(signed);
    const signature=getSignatureFromTransaction(signed);
    const entry={phase,signature,status:'signed-not-yet-confirmed'};
    report.phases.push(entry);await save();
    await sendTransactionWithoutConfirmingFactory({rpc:client.solanaRpc})(signed,{commitment:'confirmed'});
    const slot=await client.confirmTransaction(signature);
    entry.slot=slot;entry.status='confirmed';await save();
    console.log(`${phase} CONFIRMED: ${signature}`);
    return {signature,slot};
  }
  stage='deposit-build';
  const depositIx=await depositInstruction({tree:client.tree,depositor:signer,deposits:[{
    asset:DepositAsset.sol(),viewTag:sender.shieldedAddress().confidentialViewTag(),
    recipientOwnerHash:sender.shieldedAddress().ownerHash(),amount:DEPOSIT,
  }]});
  const depositTx=previousDeposit ?? await send([depositIx],'deposit');
  stage='deposit-index-and-decrypt';
  const depositResponse=await client.getShieldedTransactionsBySignature(depositTx.signature,atSlot(depositTx.slot));
  const deposited=await decryptToBalances({keypair:sender,registry:assets,transactions:depositResponse.transactions.map(x=>x.transaction)});
  const input=deposited.balance(SOL_MINT);
  assert.equal(input.amount,DEPOSIT);assert.equal(input.utxos.length,1);
  console.log('DEPOSIT BALANCE VERIFIED');
  stage='transfer-proof';
  const transfer=new ConfidentialTransfer(sender.shieldedAddress(),[ProofInputUtxo.fromKeypair(input.utxos[0],sender)],signer.address);
  transfer.send(recipient.shieldedAddress(),SOL_MINT,TRANSFER);
  const proof=await client.proveTransact(transfer.sign(sender,assets),LocalKeys.fromKeypair(sender,client.proofService));
  console.log('CONFIDENTIAL PROOF GENERATED');
  const instruction=await transactInstruction({payer:signer,inputTree:client.tree,outputTree:client.tree,data:proof});
  const tx=await send([instruction],'confidential-transfer');
  stage='transfer-index-and-decrypt';
  const response=await client.getShieldedTransactionsBySignature(tx.signature,atSlot(tx.slot));
  const transactions=response.transactions.map(x=>x.transaction);
  const left=(await decryptToBalances({keypair:sender,registry:assets,transactions})).balance(SOL_MINT);
  const received=(await decryptToBalances({keypair:recipient,registry:assets,transactions})).balance(SOL_MINT);
  assert.equal(left.amount,DEPOSIT-TRANSFER);assert.equal(received.amount,TRANSFER);
  report.checkedBalances={senderPrivateLamports:left.amount,recipientPrivateLamports:received.amount};
  // Independently check settlement through public Devnet RPC (not indexer).
  stage='independent-settlement-verification';
  const external=await fetch('https://api.devnet.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignatureStatuses',params:[[tx.signature],{searchTransactionHistory:true}]}),signal:AbortSignal.timeout(20000)});
  const status=(await external.json()).result?.value?.[0];
  assert(status && status.err===null && ['confirmed','finalized'].includes(status.confirmationStatus));
  report.independentConfirmation=status.confirmationStatus;
  report.status='passed';report.completedAt=new Date().toISOString();await save();
  console.log('PASS: confirmed transfer; sender 7000000 and recipient 3000000 private lamports verified locally.');
}
main().catch(async error=>{
  const code=typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'TEST_FAILED';
  // No raw error payload/stack/URL: SDK failures can carry credential URLs.
  report.status='blocked';report.failedStage=stage;report.errorCode=code;
  if(error.details) {
    report.httpStatus=error.details.status;
    const reason=String(error.details.reason ?? error.details.message ?? '').replaceAll(process.env.HELIUS_API_KEY ?? 'NEVER_MATCH','[redacted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,400);
    report.safeReason=reason;
    console.error(JSON.stringify({status:report.httpStatus,reason}));
  }
  if(code!=='EEXIST')await save();
  console.error(`BLOCKED at ${stage}: ${code}. Check saved journal before any retry.`);
  process.exitCode=1;
});
