/** Production writer role plus a pipe-held kernel lease. Reads never call this adapter. */
import path from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import * as FileIO from '#system/utils/FileIO.mjs';
import {createLogger} from '#system/logging/logger.mjs';
import {knowledgeError} from './knowledgeFiles.mjs';
export class KnowledgeWriteAuthority {
  #configuration; #environment; #hostId; #platform; #spawn; #leases=new Map(); #closed=false;#logger;
  constructor({configuration={},environment,hostId,platform=process.platform,spawn=spawnChild,logger=createLogger({source:'backend',app:'lifelog',module:'knowledge'})}={}) {this.#configuration=configuration;this.#environment=environment;this.#hostId=hostId;this.#platform=platform;this.#spawn=spawn;this.#logger=logger;}
  get canWrite() {const c=this.#configuration;return !this.#closed && c.enabled===true && c.write===true && !!c.writer_env && !!c.writer_host && c.writer_env===this.#environment && c.writer_host===this.#hostId && this.#platform==='linux';}
  get leaseLost() {return !this.#closed && [...this.#leases.values()].some(({child})=>child.exitCode!==null || child.signalCode!==null);}
  async assertWriter({root}) {
    if(!this.canWrite)throw knowledgeError('KNOWLEDGE_WRITE_DENIED');
    const found=this.#leases.get(root);
    if(found){if(found.child.exitCode!==null || found.child.signalCode!==null)throw knowledgeError('KNOWLEDGE_LEASE_LOST');return found.promise;}
    FileIO.ensureDir(root);
    const child=this.#spawn('flock',['-n','--',path.join(root,'writer.lock'),'sh','-c','printf "knowledge-writer-ready\\n"; cat >/dev/null'],{stdio:['pipe','pipe','pipe']});
    const lease={child,promise:null};
    lease.promise=new Promise((resolve,reject)=>{
      let ready=false;let received='';
      const fail=()=>{if(!ready){this.#leases.delete(root);reject(knowledgeError('KNOWLEDGE_WRITER_BUSY'));}};
      child.once('error',fail);child.once('exit',fail);
      child.stdout.on('data',data=>{received+=data.toString();if(!ready && received.includes('knowledge-writer-ready\n')){ready=true;this.#logger.info?.('knowledge.writer.acquired',{});resolve(true);}});
      child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    });
    this.#leases.set(root,lease);return lease.promise;
  }
  async close() {
    this.#closed=true;
    await Promise.all([...this.#leases.values()].map(({child})=>new Promise(resolve=>{
      if(child.exitCode!==null || child.signalCode!==null){resolve();return;}
      child.once('exit',resolve);child.stdin.end();
    })));
    this.#leases.clear();this.#logger.info?.('knowledge.writer.closed',{});
  }
}
export default KnowledgeWriteAuthority;
