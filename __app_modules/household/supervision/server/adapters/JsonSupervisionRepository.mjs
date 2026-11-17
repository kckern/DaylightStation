import {ensureDirAsync,readTextFromPathAsync,writeBinaryAtomic} from '#system/utils/FileIO.mjs';
import {dirname} from 'node:path';
import {acquireExclusiveFileLock} from '#system/utils/exclusiveFileLock.mjs';
import {emptySupervisionState,serialQueue,validateSupervisionState} from '../../shared/contracts.mjs';
/** Atomic single-writer ledger; the kernel lock vanishes even after SIGKILL. */
export class JsonSupervisionRepository {
  #path; #acquireLock; #queue=serialQueue(); #lock=null; #closed=false;
  constructor({path,acquireLock=acquireExclusiveFileLock}) {if(!path)throw new TypeError('Supervision path required');this.#path=path;this.#acquireLock=acquireLock;}
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
    // Kernel ownership, rather than PID/file existence, makes both crash
    // recovery and exclusion atomic (see exclusiveFileLock.mjs per platform).
    let lock;
    try{lock=await this.#acquireLock(`${this.#path}.lock`);}
    catch(error){throw Object.assign(new Error('Supervision writer lock unavailable',{cause:error}),{code:error.code==='FILE_LOCK_HELD'?'SUPERVISION_WRITER_CONFLICT':'SUPERVISION_WRITER_LOCK_FAILED'});}
    this.#lock=lock;
    lock.onLost(()=>{this.#closed=true;});
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
    if(this.#lock){const lock=this.#lock;this.#lock=null;await lock.release();}
    this.#closed=true;
  });}
}
