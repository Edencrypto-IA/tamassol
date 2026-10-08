import {readFile,appendFile,mkdir,writeFile} from 'node:fs/promises';
// A successful HTTP /health ping is not a readiness proof. This local circuit
// breaker is cleared only by a fresh, successful isolated proving check.
export async function readHeliusReadiness(inputSignature,root='provider-health',now=Date.now()){
 await mkdir(root,{recursive:true});
 let state;try{state=JSON.parse(await readFile(`${root}/helius.json`,'utf8'));}catch{}
 let health='UNAVAILABLE',errorCode='PROVER_NOT_READY';
 if(state?.health==='DEGRADED'){health='DEGRADED';errorCode=['STALE_ROOT','INDEXER_UNAVAILABLE'].includes(state.errorCode)?state.errorCode:'PROVER_NOT_READY';}
 else if(state?.health==='HEALTHY'){
  const fresh=Number.isSafeInteger(state.lastSuccessfulCheck)&&state.lastSuccessfulCheck<=now&&now-state.lastSuccessfulCheck<=30000;
  if(fresh&&state.proverReady===true&&state.inputSignature===inputSignature&&state.network==='devnet'){health='HEALTHY';errorCode='NONE';}
  else{health='DEGRADED';errorCode='READINESS_EXPIRED';}
 }
 const record={provider:'helius-confidential-devnet',health,errorCode,proverReady:health==='HEALTHY',timestamp:now,lastSuccessfulCheck:Number.isSafeInteger(state?.lastSuccessfulCheck)?state.lastSuccessfulCheck:null};
 await appendFile(`${root}/checks.jsonl`,JSON.stringify(record)+'\n');
 return record;
}

export async function recordHeliusCheck({passed=false,inputSignature,errorCode='PROVER_NOT_READY'},root='provider-health',now=Date.now()){
 await mkdir(root,{recursive:true});
 let previous;try{previous=JSON.parse(await readFile(`${root}/helius.json`,'utf8'));}catch{}
 const safeCode=['STALE_ROOT','INDEXER_UNAVAILABLE','PROVER_NOT_READY'].includes(errorCode)?errorCode:'PROVER_NOT_READY';
 const record={provider:'helius-confidential-devnet',network:'devnet',health:passed?'HEALTHY':'DEGRADED',proverReady:passed,errorCode:passed?'NONE':safeCode,timestamp:now,lastSuccessfulCheck:passed?now:previous?.lastSuccessfulCheck??null,...(passed?{inputSignature}:{})};
 await writeFile(`${root}/helius.json`,JSON.stringify(record,null,2));
 await appendFile(`${root}/checks.jsonl`,JSON.stringify(record)+'\n');
}
