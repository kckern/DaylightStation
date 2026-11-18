import {AccessDenied} from '../shared/contracts.mjs';
import {createRefusedSupervisionRouter} from './api/supervision.mjs';
/**
 * Supervision on a backend that may not write the ledger (LedgerWriterGate).
 *
 * The ledger may hold a Stop, and this backend cannot read or keep it, so it
 * behaves as supervision that is on and denies everything: callers still see
 * `enabled: true`, every guarded action is refused, status reads as stopped,
 * nothing is reconciled and no actuator, approval producer or Home Assistant
 * call runs. The ledger and its lock are never touched. Booting this way keeps
 * every other household feature up instead of exiting the process.
 */
const CODE='SUPERVISION_WRITER_HOST_REFUSED';

export function createRefusedSupervisionRuntime({writerGate,configuration,logger}){
  const message=writerGate.message;
  const refuse=()=>new AccessDenied(CODE);
  logger?.error?.('supervision.writer.refused',{message,configuredWriter:writerGate.writer,host:writerGate.host});
  const known={
    // Reads answer fail-closed; nothing reports a released device.
    status:async()=>({active:true,epoch:null,refused:true,reason:CODE}),
    decideActivity:async()=>({allowed:false,reason:CODE}),
    reconcile:async()=>{},
  };
  // Any other service call (stop, release, approval work) is a write this host may not make.
  const service=new Proxy(known,{get:(target,key)=>{
    if(key in target)return target[key];
    if(key==='then' || typeof key==='symbol')return undefined;
    return async()=>{throw refuse();};
  }});
  const guard={
    authorize:async()=>{throw refuse();},
    runAuthorized:async()=>{throw refuse();},
  };
  const safeConfiguration=configuration && typeof configuration==='object' && !Array.isArray(configuration)?configuration:{};
  return {
    enabled:true,
    refused:true,
    configuration:{...safeConfiguration,enabled:true},
    service,
    guard,
    router:createRefusedSupervisionRouter({message,code:CODE}),
    resolveContext:async()=>{throw refuse();},
    verifyScan:()=>false,
    health:async()=>({writer:'refused',message,configuredWriter:writerGate.writer,host:writerGate.host,activationAllowed:false,errors:[CODE],consumers:[],incidents:[]}),
    dispose(){},
  };
}
