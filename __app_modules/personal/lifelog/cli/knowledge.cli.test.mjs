import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runKnowledgeCli } from './knowledge.cli.mjs';
import { YamlKnowledgeStore } from '../server/adapters/knowledge/YamlKnowledgeStore.mjs';
import { JsonlKnowledgeLedger } from '../server/adapters/knowledge/JsonlKnowledgeLedger.mjs';
import { createAiUsageLedger } from '#adapters/ai/AiUsageLedger.mjs';
import { evidence, proposal, TZ, AS_OF } from '../server/domain/knowledge/fixtures.testHelpers.mjs';
let root,data,usage,config,store,authority;
const logger={warn(){},info(){}};
const snapshotBytes=dir=>Object.fromEntries(fs.readdirSync(dir,{recursive:true,withFileTypes:true}).filter(p=>p.isFile()).map(p=>{const f=path.join(p.parentPath,p.name);return [path.relative(dir,f),fs.readFileSync(f,'utf8')];}));
beforeEach(()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-cli-'));data=path.join(root,'data');usage=path.join(root,'receipts');fs.mkdirSync(data);fs.mkdirSync(usage);
 config={getDataDir:()=>data,getUserDir:u=>path.join(data,'users',u),getUserTimezone:()=>TZ};
 const rootForUser=u=>path.join(config.getUserDir(u),'lifelog/knowledge');
 authority={assertWriter:vi.fn(()=>{throw Error('CLI must never acquire a writer');}),leaseLost:false};
 const ledger=new JsonlKnowledgeLedger({rootForUser,authority,hostId:'readonly-cli',logger});
 store=new YamlKnowledgeStore({rootForUser,authority,ledger,clock:()=>AS_OF,logger});
 fs.mkdirSync(path.join(data,'users/sample/lifelog/journalist'),{recursive:true});
 fs.writeFileSync(path.join(data,'users/sample/lifelog/journalist/messages.yml'),'messages: []\n');
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const args=()=>['extract','--dry-run','--username','sample','--since','2026-11-01','--until','2026-11-03','--as-of','2026-11-03T15:00:00Z','--usage-dir',usage];
function deps(extra={}) {
 const output=[];
 return {configService:config,store,evidence:{readUserMessages:vi.fn(async()=>({messages:[evidence()],cursor:{seen:['source-1']}}))},
 extractorFactory:vi.fn(async({usageLedger})=>({extract:async()=>{await usageLedger.record({provider:'sample',model:'sample-v1',app:'lifelog',feature:'knowledge-extract',status:'ok'});return {proposals:[proposal()],modelVersion:'sample-v1'};}})),
 usageLedgerFactory:vi.fn(createAiUsageLedger),clock:()=>AS_OF,logger,stdout:{write:text=>output.push(text)},output,...extra};
}
describe('read-only knowledge CLI',()=>{
 it('previews deterministic proposals and writes receipts only outside the data tree',async()=>{
  const d=deps(),before=snapshotBytes(data);
  expect(await runKnowledgeCli({argv:args(),...d})).toBe(0);
  const result=JSON.parse(d.output.join(''));
  expect(result).toMatchObject({dryRun:true,accepted:1,rejected:[],reviewNeeded:0});
  expect(snapshotBytes(data)).toEqual(before);
  expect(authority.assertWriter).not.toHaveBeenCalled();
  expect(d.usageLedgerFactory).toHaveBeenCalledWith(expect.objectContaining({dir:fs.realpathSync(usage),source:'cli'}));
  expect(fs.readdirSync(usage).some(f=>f.includes('knowledge-budget'))).toBe(true);
 });
 it.each(['--apply','--write','--send','--rebuild'])('refuses mutating flags before any model or data action',async flag=>{
  const d=deps();await expect(runKnowledgeCli({argv:[...args(),flag],...d})).rejects.toThrow();expect(d.extractorFactory).not.toHaveBeenCalled();
 });
 it('requires explicit dry-run, range and as-of',async()=>{
  for(const flag of ['--dry-run','--since','--until','--as-of']){
   const argv=args();const i=argv.indexOf(flag);argv.splice(i,flag==='--dry-run'?1:2);
   await expect(runKnowledgeCli({argv,...deps()})).rejects.toThrow();
  }
 });
 it('rejects data-contained usage paths including symlinks',async()=>{
  const nested=path.join(data,'receipts');fs.mkdirSync(nested);
  const link=path.join(root,'linked-receipts');fs.symlinkSync(nested,link);
  for(const dir of [data,nested,link]){
   const argv=args();argv[argv.indexOf('--usage-dir')+1]=dir;const d=deps();
   await expect(runKnowledgeCli({argv,...d})).rejects.toThrow(/outside/i);expect(d.extractorFactory).not.toHaveBeenCalled();
  }
 });
 it('charges failed previews against four calls per user-local day',async()=>{
  const d=deps({extractorFactory:vi.fn(async()=>({extract:async()=>{throw Error('model unavailable');}}))});
  for(let i=0;i<4;i++)await expect(runKnowledgeCli({argv:args(),...d})).rejects.toThrow('model unavailable');
  await expect(runKnowledgeCli({argv:args(),...d})).rejects.toThrow(/budget/i);
  expect(d.extractorFactory).toHaveBeenCalledTimes(4);
 });
 it('show/questions never create data, budget receipts, locks or a gateway',async()=>{
  const before=snapshotBytes(data),d=deps();
  await runKnowledgeCli({argv:['show','--username','sample'],...d});
  await runKnowledgeCli({argv:['questions','--username','sample','--ask-date','2026-11-03','--as-of','2026-11-03T15:00:00Z'],...d});
  expect(snapshotBytes(data)).toEqual(before);expect(fs.readdirSync(usage)).toEqual([]);
  expect(d.extractorFactory).not.toHaveBeenCalled();expect(authority.assertWriter).not.toHaveBeenCalled();
 });
 it('does not spend a model call or create receipts for an empty journal selection',async()=>{
  const d=deps({evidence:{readUserMessages:async()=>({messages:[],cursor:{seen:[]}})}});
  await runKnowledgeCli({argv:args(),...d});
  expect(d.extractorFactory).not.toHaveBeenCalled();expect(d.usageLedgerFactory).not.toHaveBeenCalled();expect(fs.readdirSync(usage)).toEqual([]);
 });
});
