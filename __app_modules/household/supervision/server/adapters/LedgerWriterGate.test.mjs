import {it,expect,describe,afterEach} from 'vitest';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLedgerWriterGate} from './LedgerWriterGate.mjs';
import {JsonSupervisionRepository} from './JsonSupervisionRepository.mjs';

const dirs=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const gate=(writer,runtime)=>createLedgerWriterGate({ledger:'The supervision ledger',writer,...runtime});

describe('unconfigured: only the prod container writes', () => {
  it('allows DAYLIGHT_ENV docker on Linux inside a container, any container hostname', () => {
    expect(gate(undefined,{environment:'docker',hostId:'3f2a9c1b7d4e',platform:'linux',isDocker:true}).allowed).toBe(true);
  });
  it.each([
    ['a laptop dev backend', {environment:'laptop-dev',hostId:'laptop',platform:'darwin',isDocker:false}],
    ['a dev backend on Linux', {environment:'server-dev',hostId:'server',platform:'linux',isDocker:false}],
    ['a Linux backend with DAYLIGHT_ENV unset', {environment:undefined,hostId:'server',platform:'linux',isDocker:false}],
    ['a Linux container with DAYLIGHT_ENV unset', {environment:undefined,hostId:'3f2a9c1b7d4e',platform:'linux',isDocker:true}],
    ['DAYLIGHT_ENV docker on Linux outside a container', {environment:'docker',hostId:'server',platform:'linux',isDocker:false}],
    ['DAYLIGHT_ENV docker on macOS', {environment:'docker',hostId:'laptop',platform:'darwin',isDocker:false}],
  ])('refuses %s', (_name, runtime) => {
    const g=gate(undefined,runtime);
    expect(g.allowed).toBe(false);
    expect(()=>g.assert()).toThrow(expect.objectContaining({code:'SUPERVISION_WRITER_HOST_REFUSED',message:expect.stringMatching(/writer_env=docker on linux in a container/)}));
  });
});

describe('configured writer', () => {
  it('allows exactly the configured env and host, on any platform', () => {
    expect(gate({writer_env:'laptop-dev',writer_host:'laptop'},{environment:'laptop-dev',hostId:'laptop',platform:'darwin'}).allowed).toBe(true);
  });
  it('then refuses the prod container, naming the configured writer', () => {
    const g=gate({writer_env:'laptop-dev',writer_host:'laptop'},{environment:'docker',hostId:'3f2a9c1b7d4e',platform:'linux'});
    expect(()=>g.assert()).toThrow(expect.objectContaining({code:'SUPERVISION_WRITER_HOST_REFUSED',message:expect.stringMatching(/writer_env=laptop-dev writer_host=laptop.*env=docker host=3f2a9c1b7d4e/)}));
  });
  it('does not count an unset DAYLIGHT_ENV as a configured env', () => {
    expect(gate({writer_env:'docker',writer_host:'homeserver'},{environment:undefined,hostId:'homeserver',platform:'linux'}).allowed).toBe(false);
  });
  it('refuses the right env on another host', () => {
    expect(gate({writer_env:'docker',writer_host:'homeserver'},{environment:'docker',hostId:'laptop',platform:'linux'}).allowed).toBe(false);
  });
  it.each([[{writer_env:''}],[{writer_env:7}],['docker'],[{writer_host:''}]])('refuses a malformed writer block %j', (writer) => {
    expect(gate(writer,{environment:'docker',hostId:'x',platform:'linux'}).allowed).toBe(false);
  });
});

it('a non-writer host is refused before any lock is taken or anything written', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supervision-gate-'));dirs.push(dir);
  const path=join(dir,'ledger','current.json');let locks=0;
  const repository=new JsonSupervisionRepository({path,writerGate:gate(undefined,{environment:'laptop-dev',hostId:'laptop',platform:'darwin'}),acquireLock:async()=>{locks++;return {release:async()=>{},onLost(){}};}});
  await expect(repository.read()).rejects.toMatchObject({code:'SUPERVISION_WRITER_HOST_REFUSED'});
  await expect(repository.transaction(state=>{state.epoch=1;})).rejects.toMatchObject({code:'SUPERVISION_WRITER_HOST_REFUSED'});
  expect(locks).toBe(0);
  await expect(access(join(dir,'ledger'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await repository.hasPersistedState()).toBe(false);
  await repository.close();
});

it('the writer host takes the lock and writes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'supervision-gate-'));dirs.push(dir);
  const repository=new JsonSupervisionRepository({path:join(dir,'current.json'),writerGate:gate(undefined,{environment:'docker',hostId:'c0ffee',platform:'linux',isDocker:true}),acquireLock:async()=>({release:async()=>{},onLost(){}})});
  await repository.transaction(state=>{state.epoch=1;});
  expect((await repository.read()).epoch).toBe(1);
  await repository.close();
});
