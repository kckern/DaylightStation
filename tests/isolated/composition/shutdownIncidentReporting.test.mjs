import {afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {YamlShutdownDatastore} from '../../../__backend/src/1_adapters/persistence/yaml/YamlShutdownDatastore.mjs';
import {createShutdownIncidentReporting} from '../../../__backend/src/5_composition/modules/supervision.mjs';

const dirs=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function world(){
 const dir=await mkdtemp(join(tmpdir(),'shutdown-incidents-'));dirs.push(dir);
 const logs=[];const logger={info:(event,data)=>logs.push(['info',event,data]),warn:(event,data)=>logs.push(['warn',event,data])};
 return {dir,logs,logger,datastore:new YamlShutdownDatastore({configService:{getHouseholdPath:()=>dir}})};
}

it('a backend that is not the incident writer gets no reporter, one info log, and touches nothing',async()=>{
 const w=await world();
 const result=createShutdownIncidentReporting({datastore:w.datastore,shutdownConfig:{},supervisionEnabled:false,gateOptions:{environment:'laptop-dev',hostId:'laptop',platform:'darwin',isDocker:false},logger:w.logger,notifyIncident:async()=>({accepted:true})});
 expect(result).toMatchObject({repository:null,reporter:null,status:'not-writer'});
 expect(w.logs).toEqual([['info','shutdown.incidents.not_writer',{message:expect.stringMatching(/shutdown incident ledger is written only by writer_env=docker on linux in a container; this backend is env=laptop-dev/)}]]);
 expect(await readdir(w.dir)).toEqual([]);
});

it('the writer gets a reporter on the gated repository',async()=>{
 const w=await world();
 const result=createShutdownIncidentReporting({datastore:w.datastore,shutdownConfig:{writer:{writer_env:'incident-test'}},supervisionEnabled:false,gateOptions:{environment:'incident-test'},logger:w.logger,notifyIncident:async()=>({accepted:true})});
 expect(result.status).toBe('active');
 expect(result.reporter).not.toBeNull();
 await result.reporter.observe({health:[{deviceId:'portal',capability:'portal-keys',commandRevision:1,acknowledged:true,blocked:true,lastContactAt:1000}],nowMs:1000,desiredBlocked:true});
 expect(w.logs).toEqual([]);
 await result.repository.close();
});

it('builds nothing when parental supervision owns enforcement',async()=>{
 const w=await world();
 expect(createShutdownIncidentReporting({datastore:w.datastore,shutdownConfig:{},supervisionEnabled:true,gateOptions:{},logger:w.logger})).toMatchObject({repository:null,reporter:null,status:null});
 expect(w.logs).toEqual([]);
});
