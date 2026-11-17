import {it,expect,afterEach} from 'vitest';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JsonSupervisionRepository} from './JsonSupervisionRepository.mjs';

const dirs=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function ledgerPath(){const dir=await mkdtemp(join(tmpdir(),'supervision-repo-'));dirs.push(dir);return join(dir,'current.json');}

it('fails closed with SUPERVISION_WRITER_LOCK_FAILED when no kernel lock can be taken, and writes nothing',async()=>{
 const path=await ledgerPath();
 const acquireLock=async()=>{throw Object.assign(new Error('flock(1) is not installed'),{code:'FILE_LOCK_FAILED'});};
 const repository=new JsonSupervisionRepository({path,acquireLock});
 await expect(repository.read()).rejects.toMatchObject({code:'SUPERVISION_WRITER_LOCK_FAILED',cause:{message:'flock(1) is not installed'}});
 await expect(repository.transaction(state=>{state.epoch=1;})).rejects.toMatchObject({code:'SUPERVISION_WRITER_LOCK_FAILED'});
 await expect(access(path)).rejects.toMatchObject({code:'ENOENT'});
 await repository.close();
});

it('maps a lock held elsewhere to SUPERVISION_WRITER_CONFLICT',async()=>{
 const path=await ledgerPath();
 const first=new JsonSupervisionRepository({path});
 try{
  await first.read();
  const second=new JsonSupervisionRepository({path});
  await expect(second.read()).rejects.toMatchObject({code:'SUPERVISION_WRITER_CONFLICT'});
  await second.close();
 }finally{await first.close();}
});

it('closes the repository when the lock is lost after it was taken',async()=>{
 const path=await ledgerPath();let lose;
 const acquireLock=async()=>({release:async()=>{},onLost:callback=>{lose=callback;}});
 const repository=new JsonSupervisionRepository({path,acquireLock});
 await repository.read();
 lose();
 await expect(repository.read()).rejects.toThrow('Supervision repository closed');
});
