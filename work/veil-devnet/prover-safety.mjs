// No request payload, witness, keys, or response bodies are logged here.
export function classifyProverFailure(error,observation={}){
 if(observation.kind==='timeout'||error?.code==='CLIENT_PROVER_TIMEOUT')return 'PROVER_TIMEOUT';
 if(observation.kind==='network')return 'PROVER_NETWORK_ERROR';
 const status=observation.status??error?.details?.status;
 if(status>=400&&status<500)return 'PROVER_HTTP_4XX';
 if(status>=500)return 'PROVER_HTTP_5XX';
 if(error?.code==='CLIENT_PROVER_REQUEST')return 'PROVER_NETWORK_ERROR';
 return 'PROVER_INVALID_RESPONSE';
}
export async function withProofBeforeSend(prove,send){
 // Await is intentional: no signing/broadcast continuation on proof failure.
 const proof=await prove();
 return send(proof);
}
export function createProverGuard(fetchImpl=globalThis.fetch,timeoutMs=60000){
 const controller=new AbortController(),seen=new Set();
 let observation={};
 return {
  signal:controller.signal,
  async fetch(url,options={}){
   const u=new URL(url);
   const timeout=AbortSignal.timeout(timeoutMs);
   const signal=AbortSignal.any([timeout,controller.signal,...(options.signal?[options.signal]:[])]);
   const proving=u.hostname==='d21ni15goiip6l.cloudfront.net'&&u.pathname.startsWith('/prove/');
   if(!proving)return fetchImpl(url,{...options,signal});
   const key=`${options.method??'GET'} ${u.pathname}`;
   if(seen.has(key)||controller.signal.aborted){controller.abort();throw Error('PROVER_REPEAT_BLOCKED');}
   seen.add(key);
   try{
    const response=await fetchImpl(url,{...options,signal});
    observation={endpoint:u.origin+u.pathname,status:response.status};
    // Abort SDK retry/fallback/poll logic on first failure; preserve HTTP response.
    if(!response.ok)controller.abort();
    return response;
   }catch(error){
    observation={kind:timeout.aborted?'timeout':'network',causeCode:typeof error?.cause?.code==='string'?error.cause.code:undefined};
    controller.abort();throw error;
   }
  },
  async prove(operation){
   try{return await operation();}catch(error){
    const failure=new Error(classifyProverFailure(error,observation));
    failure.code=classifyProverFailure(error,observation);
    failure.safeDetails={...observation,sdkCode:error?.code};
    throw failure;
   }
  }
 };
}
