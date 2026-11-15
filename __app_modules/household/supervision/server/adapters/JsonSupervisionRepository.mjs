import {ensureDirAsync,readTextFromPathAsync,writeBinaryAtomic} from '#system/utils/FileIO.mjs';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {emptySupervisionState,serialQueue,validateSupervisionState} from '../../shared/contracts.mjs';
/** Atomic Linux single-writer ledger; kernel lock vanishes even after SIGKILL. */
export class JsonSupervisionRepository {
  #path; #queue=serialQueue(); #lock=null; #closed=false;
  constructor({path}) {if(!path)throw new TypeError('Supervision path required');this.#path=path;}
  /** Read-only bootstrap probe; every existing ledger still requires the writer lock. */
  hasPersistedState(){return this.#queue(async()=>{
    if(this.#closed)throw new Error('Supervision repository closed');
    try{await readTextFromPathAsync(this.#path);return true;}
    catch(error){if(error.code==='ENOENT')return false;throw error;}
  });}
  async #acquire() {
    if(this.#closed)throw new Error('Supervision repository closed');
    if(this.#lock)return;
    await ensureDirAsync(dirname(this.#path));
    // Child holds flock until the parent pipe closes. Kernel ownership, rather
    // than PID/file existence, makes both crash recovery and exclusion atomic.
    const child=spawn('flock',['-n',`${this.#path}.lock`,process.execPath,'-e',"process.stdout.write('locked');process.stdin.resume()"],{stdio:['pipe','pipe','pipe']});
    await new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('exit',code=>reject(Object.assign(new Error('Supervision writer lock unavailable'),{code:[1,73].includes(code)?'SUPERVISION_WRITER_CONFLICT':'SUPERVISION_WRITER_LOCK_FAILED'})));
      child.stdout.once('data',()=>resolve());
    });
    this.#lock=child;
    child.once('exit',()=>{this.#closed=true;});
  }
  async #load() {
    try {return validateSupervisionState(JSON.parse(await readTextFromPathAsync(this.#path)));}
    catch(error){if(error.code==='ENOENT')return emptySupervisionState();throw error;}
  }
  read(){return this.#queue(async()=>{await this.#acquire();return structuredClone(await this.#load());});}
  transaction(fn){return this.#queue(async()=>{
    await this.#acquire();const state=structuredClone(await this.#load()),before=JSON.stringify(state);const result=await fn(state);validateSupervisionState(state);
    const after=JSON.stringify(state);if(after!==before)writeBinaryAtomic(this.#path,Buffer.from(after),{durable:true});
    return structuredClone(result);
  });}
  close(){return this.#queue(async()=>{
    if(this.#lock){const child=this.#lock;this.#lock=null;const exited=child.exitCode!==null?Promise.resolve():once(child,'exit');child.stdin.end();await exited;}
    this.#closed=true;
  });}
}
