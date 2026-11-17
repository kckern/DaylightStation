/** Revision-checked YAML transactions; only acknowledged ledger images are replayed. */
import path from 'node:path';
import * as FileIO from '#system/utils/FileIO.mjs';
import {createLogger} from '#system/logging/logger.mjs';
import {IKnowledgeStore} from '../../application/knowledge/ports/IKnowledgeStore.mjs';
import {emptySnapshot,validateKnowledgeObject} from '../../domain/knowledge/contracts.mjs';
import {assertUsername,knowledgeError,same,safeFile,fileHash} from './knowledgeFiles.mjs';
import {observeSnapshot,prepareFileImages,readFileImages,isObjectFile} from './knowledgeSnapshots.mjs';
export class YamlKnowledgeStore extends IKnowledgeStore {
  #rootForUser;#ledger;#authority;#clock;#io;#chains=new Map();#logger;
  constructor({rootForUser,ledger,authority,clock,io=FileIO,logger=createLogger({source:'backend',app:'lifelog',module:'knowledge'})}) {super();if(typeof rootForUser!=='function'||!ledger?.prepare||!authority?.assertWriter||typeof clock!=='function')throw new TypeError('Invalid knowledge store dependencies');this.#rootForUser=rootForUser;this.#ledger=ledger;this.#authority=authority;this.#clock=clock;this.#io=io;this.#logger=logger;}
  #root(username){assertUsername(username);return this.#rootForUser(username);}
  #serialize(username,task){const run=(this.#chains.get(username)??Promise.resolve()).then(task);const tail=run.catch(()=>{});this.#chains.set(username,tail);void tail.finally(()=>{if(this.#chains.get(username)===tail)this.#chains.delete(username);});return run;}
  async #observe(username){return observeSnapshot({root:this.#root(username),io:this.#io,history:await this.#ledger.read({username}),asOf:this.#clock()});}
  async read({username}) {
    this.#root(username);
    try{const snapshot=(await this.#observe(username)).snapshot;if(this.#authority.leaseLost)snapshot.health={...snapshot.health,available:false,reason:'writer_lease_lost'};return snapshot;}
    catch(error){this.#logger.warn?.('knowledge.store.unavailable',{code:error.code??'KNOWLEDGE_CORRUPT'});const snapshot=emptySnapshot();snapshot.revision='unavailable';snapshot.health={...snapshot.health,available:false,conflicted:true,reason:error.code??'KNOWLEDGE_CORRUPT'};return snapshot;}
  }
  async commit({username,expectedRevision,runId,batch}) {
    if(batch?.previewOnly)throw knowledgeError('KNOWLEDGE_PREVIEW_ONLY');
    if(typeof runId!=='string'||!runId||runId.length>240||!batch||!Array.isArray(batch.upserts))throw knowledgeError('INVALID_KNOWLEDGE_BATCH');
    for(const object of batch.upserts)validateKnowledgeObject(object);
    const root=this.#root(username);
    return this.#serialize(username,async()=>{
      await this.#authority.assertWriter({root});
      const history=await this.#ledger.read({username});const existing=history.transactions.find(t=>t.runId===runId);
      if(existing?.complete)return {revision:existing.complete.revision,applied:false};
      const observed=await this.#observe(username);
      if(!observed.snapshot.health.available)throw knowledgeError('KNOWLEDGE_UNAVAILABLE');
      if(expectedRevision!==observed.snapshot.revision)throw knowledgeError('STALE_KNOWLEDGE_REVISION');
      const eventId='run.prepare:'+runId;const images=prepareFileImages({observed,batch,eventId});
      const payload=structuredClone(batch);payload.events=[...(payload.events??[]),...images.edits.map((edit,i)=>({id:runId+':user-edit:'+i,type:'user_edit',...edit}))];
      const asOf=this.#clock();
      await this.#ledger.prepare({username,runId,expectedRevision,batch:payload,before:images.before,after:images.after,asOf});
      await this.#writeImages(root,images.before.files,images.after.files);
      const revision=images.after.files['state.yml'].revision+':'+fileHash(images.after.files);
      await this.#ledger.complete({username,runId,revision,asOf});this.#logger.info?.('knowledge.store.committed',{objects:batch.upserts.length,events:payload.events.length});return {revision,applied:true};
    });
  }
  async #writeImages(root,before,after) {
    for(const [relative,value] of Object.entries(after).filter(([rel])=>rel!=='state.yml')) {
      const destination=safeFile(root,relative);const current=this.#io.fileExists(destination)?readFileImages({root,io:this.#io}).files[relative]:undefined;
      if(same(current,value))continue;
      if(isObjectFile(relative)) {
        const old=Object.entries(before).find(([rel,doc])=>isObjectFile(rel)&&doc.id===value.id&&rel!==relative);
        if(old&&this.#io.fileExists(safeFile(root,old[0]))&&!this.#io.fileExists(destination)) {
          this.#io.ensureDir(path.dirname(destination));this.#io.renameFile(safeFile(root,old[0]),destination,{durable:true});
        }
      }
      this.#io.saveYamlToPathAtomic(destination,value,{durable:true});
    }
    const stateFile=safeFile(root,'state.yml');const current=this.#io.fileExists(stateFile)?readFileImages({root,io:this.#io}).files['state.yml']:undefined;
    if(!same(current,after['state.yml']))this.#io.saveYamlToPathAtomic(stateFile,after['state.yml'],{durable:true});
  }
  async recover({username}) {
    const root=this.#root(username);
    return this.#serialize(username,async()=>{
      await this.#authority.assertWriter({root});await this.#ledger.repair({username});
      const history=await this.#ledger.read({username});let applied=0;
      for(const transaction of history.transactions.filter(t=>!t.complete)) {
        const {before,after,at}=transaction.prepare;const {files,conflicted}=readFileImages({root,io:this.#io});
        if(conflicted)throw knowledgeError('KNOWLEDGE_RECOVERY_CONFLICT');
        for(const relative of new Set([...Object.keys(before.files),...Object.keys(after.files),...Object.keys(files)])) {
          safeFile(root,relative);const actual=files[relative];
          const movedBefore=isObjectFile(relative)&&actual&&Object.entries(before.files).some(([rel,value])=>isObjectFile(rel)&&value.id===actual.id&&same(value,actual));
          if(!same(actual,before.files[relative])&&!same(actual,after.files[relative])&&!movedBefore)throw knowledgeError('KNOWLEDGE_RECOVERY_CONFLICT');
        }
        await this.#writeImages(root,before.files,after.files);
        const revision=after.files['state.yml'].revision+':'+fileHash(after.files);
        await this.#ledger.complete({username,runId:transaction.runId,revision,asOf:at});applied++;
      }
      this.#logger.info?.('knowledge.store.recovered',{applied});return {applied};
    });
  }
  async close(){await this.#authority.close();}
}
export default YamlKnowledgeStore;
