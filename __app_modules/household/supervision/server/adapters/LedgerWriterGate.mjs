import {hostname} from 'node:os';
/**
 * Which backend may write a supervision ledger (the supervision ledger and the
 * shutdown incident ledger).
 *
 * The data tree is shared between machines (Dropbox), and the writer lock is a
 * flock(2) lock, which only excludes processes on one kernel. A laptop backend
 * and the prod container would each hold "the" lock and both write. So only one
 * configured writer may open these ledgers at all, checked before any lock or
 * write, the same shape the lifelog and work writer authorities use:
 *
 *   writer: { writer_env: <DAYLIGHT_ENV>, writer_host: <hostname, optional> }
 *
 * Unconfigured, the writer is the prod container: DAYLIGHT_ENV unset or
 * `docker` (the same fallback app.mjs uses), on Linux. Any hostname is accepted
 * there because a container's hostname is its id and changes with each deploy.
 * A configured writer may run on any platform; everyone else is refused.
 */
export const DEFAULT_WRITER_ENV='docker';

const nonEmpty=value=>typeof value==='string' && value.length>0;

export function createLedgerWriterGate({ledger='The supervision ledger',writer,environment=process.env.DAYLIGHT_ENV||DEFAULT_WRITER_ENV,hostId=hostname(),platform=process.platform}={}){
  const configured=writer!=null;
  const valid=!configured || (typeof writer==='object' && !Array.isArray(writer)
    && (writer.writer_env===undefined || nonEmpty(writer.writer_env))
    && (writer.writer_host===undefined || nonEmpty(writer.writer_host)));
  const writerEnv=valid && configured && writer.writer_env!==undefined?writer.writer_env:DEFAULT_WRITER_ENV;
  const writerHost=valid && configured?writer.writer_host??null:null;
  const explicitEnv=valid && configured && writer.writer_env!==undefined;
  const allowed=valid && environment===writerEnv && (!writerHost || writerHost===hostId) && (explicitEnv || platform==='linux');
  const expected=valid
    ?`writer_env=${writerEnv}${writerHost?` writer_host=${writerHost}`:''}${explicitEnv?'':' on linux'}`
    :'a valid writer block (writer_env and writer_host must be non-empty strings)';
  return {
    allowed,
    assert(){
      if(allowed)return;
      throw Object.assign(new Error(`${ledger} is written only by ${expected}; this backend is env=${environment} host=${hostId} platform=${platform}`),{code:'SUPERVISION_WRITER_HOST_REFUSED'});
    },
  };
}
