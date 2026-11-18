import {hostname} from 'node:os';
import {fileExists} from '#system/utils/FileIO.mjs';
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
 * Unconfigured, the writer is the prod container, and all three must hold:
 * DAYLIGHT_ENV is exactly `docker` (docker/entrypoint.sh exports it; unset does
 * NOT count, or any Linux backend started without a .env would qualify), the
 * platform is Linux, and /.dockerenv exists (the marker app.mjs already uses to
 * tell the prod container apart). Any hostname is accepted there because a
 * container's hostname is its id and changes with each deploy. A configured
 * writer may run on any platform; everyone else is refused.
 */
export const DEFAULT_WRITER_ENV='docker';

const nonEmpty=value=>typeof value==='string' && value.length>0;

// Read raw: an explicit `undefined` means "DAYLIGHT_ENV is unset", never a default.
const option=(options,key,fallback)=>(key in options?options[key]:fallback());

export function createLedgerWriterGate(options={}){
  const ledger=options.ledger??'The supervision ledger',writer=options.writer;
  const environment=option(options,'environment',()=>process.env.DAYLIGHT_ENV);
  const hostId=option(options,'hostId',()=>hostname());
  const platform=option(options,'platform',()=>process.platform);
  const isDocker=option(options,'isDocker',()=>fileExists('/.dockerenv'));
  const configured=writer!=null;
  const valid=!configured || (typeof writer==='object' && !Array.isArray(writer)
    && (writer.writer_env===undefined || nonEmpty(writer.writer_env))
    && (writer.writer_host===undefined || nonEmpty(writer.writer_host)));
  const writerEnv=valid && configured && writer.writer_env!==undefined?writer.writer_env:DEFAULT_WRITER_ENV;
  const writerHost=valid && configured?writer.writer_host??null:null;
  const explicitEnv=valid && configured && writer.writer_env!==undefined;
  const allowed=valid && typeof environment==='string' && environment===writerEnv && (!writerHost || writerHost===hostId) && (explicitEnv || (platform==='linux' && isDocker===true));
  const expected=valid
    ?`writer_env=${writerEnv}${writerHost?` writer_host=${writerHost}`:''}${explicitEnv?'':' on linux in a container'}`
    :'a valid writer block (writer_env and writer_host must be non-empty strings)';
  const message=allowed?null:`${ledger} is written only by ${expected}; this backend is env=${environment??'(unset)'} host=${hostId} platform=${platform}${explicitEnv?'':` container=${isDocker===true}`}`;
  return {
    allowed,
    message,
    // What health reports name: the writer this host is not, and this host.
    writer:{writer_env:valid?writerEnv:null,writer_host:valid?writerHost:null,valid},
    host:{environment:environment??null,hostId,platform,isDocker:isDocker===true},
    assert(){
      if(allowed)return;
      throw Object.assign(new Error(message),{code:'SUPERVISION_WRITER_HOST_REFUSED'});
    },
  };
}
