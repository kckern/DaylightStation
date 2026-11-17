import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {pathToFileURL,fileURLToPath} from 'node:url';
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
    const script=`import {acquireExclusiveFileLock} from ${JSON.stringify(moduleUrl)};await acquireExclusiveFileLock(${JSON.stringify(path)});process.stdout.write('held');setInterval(()=>{},10000);`;
    const child=spawn(process.execPath,['--input-type=module','-e',script]);
    cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
    await once(child.stdout,'data');
    await expect(acquireExclusiveFileLock(path)).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
    child.kill('SIGKILL');await once(child,'exit');
    await new Promise(resolve=>setTimeout(resolve,100));
    const next=await acquireExclusiveFileLock(path);cleanup.push(()=>next.release());
  });
});

describe('exclusive file lock platform paths', () => {
  it('names flock(1) when a Linux host lacks it, instead of a bare spawn ENOENT', async () => {
    const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin={end(){}};queueMicrotask(()=>child.emit('error',Object.assign(new Error('spawn flock ENOENT'),{code:'ENOENT'})));return child;};
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'linux',spawnProcess})).rejects.toMatchObject({code:'FILE_LOCK_FAILED',message:expect.stringMatching(/flock\(1\)/)});
  });

  it('maps a held flock(1) lock on Linux to FILE_LOCK_HELD', async () => {
    const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin={end(){}};queueMicrotask(()=>child.emit('exit',1));return child;};
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'linux',spawnProcess})).rejects.toMatchObject({code:'FILE_LOCK_HELD'});
  });

  it('refuses a platform with no supported kernel lock rather than writing unlocked', async () => {
    await expect(acquireExclusiveFileLock('/nowhere/writer.lock',{platform:'win32'})).rejects.toMatchObject({code:'FILE_LOCK_FAILED',message:expect.stringMatching(/win32/)});
  });
});
