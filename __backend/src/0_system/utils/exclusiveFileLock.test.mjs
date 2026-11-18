import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {acquireExclusiveFileLock} from './exclusiveFileLock.mjs';

const cleanup=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()();});
async function lockPath(){const dir=await mkdtemp(join(tmpdir(),'file-lock-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));return join(dir,'writer.lock');}

describe('exclusive file lock on this platform', () => {
  it('refuses a second holder until the first releases', async () => {
    const path=await lockPath();
    const first=await acquireExclusiveFileLock(path);
    await expect(acquireExclusiveFileLock(path)).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
    await first.release();
    const second=await acquireExclusiveFileLock(path);cleanup.push(()=>second.release());
  });

  it('is freed by the kernel when the holding process is killed', async () => {
    const path=await lockPath();
    const moduleUrl=pathToFileURL(fileURLToPath(new URL('./exclusiveFileLock.mjs',import.meta.url))).href;
    const script=`import {acquireExclusiveFileLock} from ${JSON.stringify(moduleUrl)};globalThis.lock=await acquireExclusiveFileLock(${JSON.stringify(path)});process.stdout.write('held');setInterval(()=>{},10000);`;
    const child=spawn(process.execPath,['--input-type=module','-e',script]);
    cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
    await once(child.stdout,'data');
    await expect(acquireExclusiveFileLock(path)).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
    child.kill('SIGKILL');await once(child,'exit');
    await new Promise(resolve=>setTimeout(resolve,100));
    const next=await acquireExclusiveFileLock(path);cleanup.push(()=>next.release());
  });

  // A child forked by another thread while we close the descriptor shares the
  // open file description until it execs, so the flock(2) lock can outlive
  // close() by microseconds. Vitest itself runs workers on threads.
  it.runIf(process.platform==='darwin')('reacquires right after release while another thread forks children', async () => {
    const worker=new Worker(`const {parentPort}=require('node:worker_threads');const {execFile}=require('node:child_process');let stop=false;parentPort.on('message',()=>{stop=true;});const chain=()=>execFile('/usr/bin/true',()=>{if(!stop)chain();});for(let i=0;i<4;i++)chain();parentPort.postMessage('started');`,{eval:true});
    await once(worker,'message');
    const path=await lockPath();let failures=0;
    try{
      for(let i=0;i<1500;i++){
        const lock=await acquireExclusiveFileLock(path).catch(()=>{failures++;return null;});
        await lock?.release();
      }
    }finally{worker.postMessage('stop');await worker.terminate();}
    expect(failures).toBe(0);
  }, 60000);

  it('still refuses a holder that keeps the lock, after its retries', async () => {
    const path=await lockPath();
    const first=await acquireExclusiveFileLock(path);cleanup.push(()=>first.release());
    const started=Date.now();
    await expect(acquireExclusiveFileLock(path)).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
    expect(Date.now()-started).toBeLessThan(1000);
  });
});

describe('exclusive file lock platform paths', () => {
  it('names flock(1) when a Linux host lacks it, instead of a bare spawn ENOENT', async () => {
    const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin={end(){}};queueMicrotask(()=>child.emit('error',Object.assign(new Error('spawn flock ENOENT'),{code:'ENOENT'})));return child;};
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'linux',spawnProcess})).rejects.toMatchObject({code:'FILE_LOCK_FAILED',message:expect.stringMatching(/flock\(1\)/)});
  });

  const exiting=code=>()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin={end(){}};queueMicrotask(()=>child.emit('exit',code));return child;};
  it('maps a held flock(1) lock (exit 1) on Linux to FILE_LOCK_HELD', async () => {
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'linux',spawnProcess:exiting(1)})).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
  });
  it('maps any other flock(1) exit, such as 73 (EX_CANTCREAT), to FILE_LOCK_FAILED', async () => {
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'linux',spawnProcess:exiting(73)})).rejects.toMatchObject({code:'FILE_LOCK_FAILED'});
  });

  it('refuses a platform with no supported kernel lock rather than writing unlocked', async () => {
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'win32'})).rejects.toMatchObject({code:'FILE_LOCK_FAILED',message:expect.stringMatching(/win32/)});
  });
});
