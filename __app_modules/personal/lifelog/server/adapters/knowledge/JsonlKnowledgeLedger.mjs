/** Durable, per-host prepare/complete journal. A reader never repairs its tail. */
import path from 'node:path';
import * as FileIO from '#system/utils/FileIO.mjs';
import {createLogger} from '#system/logging/logger.mjs';
import {IKnowledgeLedger} from '../../application/knowledge/ports/IKnowledgeLedger.mjs';
import {assertUsername,knowledgeError,same} from './knowledgeFiles.mjs';
export class JsonlKnowledgeLedger extends IKnowledgeLedger {
  #rootForUser;#hostId;#authority;#io;#logger;
  constructor({rootForUser,hostId,authority,io=FileIO,logger=createLogger({source:'backend',app:'lifelog',module:'knowledge'})}) {super();if(typeof rootForUser!=='function'||!authority?.assertWriter||!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(hostId??''))throw new TypeError('Invalid knowledge ledger dependencies');this.#rootForUser=rootForUser;this.#hostId=hostId;this.#authority=authority;this.#io=io;this.#logger=logger;}
  #root(username){assertUsername(username);return this.#rootForUser(username);}
  async read({username}) {
    const root=this.#root(username),dir=path.join(root,'ledger');const events=[];const transactions=new Map();const tailRepairs=[];
    for(const name of this.#io.listEntries(dir).filter(n=>/^\d{4}-\d{2}\.[a-z0-9._-]+\.jsonl$/i.test(n)).sort()) {
      const file=path.join(dir,name);const text=this.#io.readTextFromPath(file);const last=text.lastIndexOf('\n');
      const complete=last<0?'':text.slice(0,last+1);const tail=text.slice(last+1);
      if(tail)tailRepairs.push({file,length:Buffer.byteLength(complete),bytes:Buffer.byteLength(tail)});
      for(const line of complete.split('\n').filter(Boolean)) {
        let event;try{event=JSON.parse(line);}catch{throw knowledgeError('KNOWLEDGE_LEDGER_CORRUPT');}
        if(event.schema!=='lifelog-knowledge-ledger/v1'||!['run.prepare','run.complete'].includes(event.type)||typeof event.runId!=='string'||!event.runId)throw knowledgeError('KNOWLEDGE_LEDGER_CORRUPT');
        const duplicate=events.find(e=>e.id===event.id);if(duplicate){if(!same(duplicate,event))throw knowledgeError('KNOWLEDGE_LEDGER_CONFLICT');continue;}
        const txn=transactions.get(event.runId)??{runId:event.runId,prepare:null,complete:null};
        if(event.type==='run.prepare')txn.prepare=event;else txn.complete=event;
        events.push(event);transactions.set(event.runId,txn);
      }
    }
    if([...transactions.values()].some(t=>!t.prepare))throw knowledgeError('KNOWLEDGE_LEDGER_CORRUPT');
    return {events,transactions:[...transactions.values()],tailRepairBytes:tailRepairs.reduce((n,r)=>n+r.bytes,0),tailRepairs};
  }
  async #append(username,event,asOf) {
    const root=this.#root(username);await this.#authority.assertWriter({root});
    if(!Number.isFinite(asOf))throw knowledgeError('INVALID_KNOWLEDGE_TIME');
    const month=new Date(asOf).toISOString().slice(0,7);
    this.#io.appendTextFile(path.join(root,'ledger',month+'.'+this.#hostId+'.jsonl'),JSON.stringify({schema:'lifelog-knowledge-ledger/v1',...event})+'\n',{durable:true});
  }
  async prepare({username,runId,expectedRevision,batch,before,after,asOf}) {
    const existing=(await this.read({username})).transactions.find(t=>t.runId===runId);
    if(existing){if(!same(existing.prepare.batch,batch)||!same(existing.prepare.before,before)||!same(existing.prepare.after,after))throw knowledgeError('KNOWLEDGE_RUN_CONFLICT');return {eventId:existing.prepare.id};}
    const id='run.prepare:'+runId;
    await this.#append(username,{id,type:'run.prepare',runId,expectedRevision,batch,before,after,at:asOf},asOf);
    return {eventId:id};
  }
  async complete({username,runId,revision,asOf}) {
    const existing=(await this.read({username})).transactions.find(t=>t.runId===runId);
    if(!existing)throw knowledgeError('KNOWLEDGE_PREPARE_REQUIRED');
    if(existing.complete)return {applied:false};
    await this.#append(username,{id:'run.complete:'+runId,type:'run.complete',runId,revision,at:asOf},asOf);return {applied:true};
  }
  async repair({username}) {
    const root=this.#root(username);await this.#authority.assertWriter({root});const read=await this.read({username});
    for(const item of read.tailRepairs){this.#io.truncateFile(item.file,item.length);this.#io.appendTextFile(item.file,'',{durable:true});}
    if(read.tailRepairBytes)this.#logger.warn?.('knowledge.ledger.tail-repaired',{bytes:read.tailRepairBytes});return {repairedBytes:read.tailRepairBytes};
  }
}
export default JsonlKnowledgeLedger;
