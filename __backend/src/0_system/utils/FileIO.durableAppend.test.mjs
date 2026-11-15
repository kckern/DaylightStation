// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {appendTextFile,renameFile} from './FileIO.mjs';
const roots=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('durable ledger primitives',()=>{
 it('flushes appended bytes and their parent directory when durable is requested',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'durable-append-'));roots.push(dir);const file=path.join(dir,'ledger.jsonl');const sync=vi.spyOn(fs,'fsyncSync');
  appendTextFile(file,'{"id":1}\n',{durable:true});expect(fs.readFileSync(file,'utf8')).toBe('{"id":1}\n');expect(sync).toHaveBeenCalledTimes(2);
 });
 it('keeps the ordinary append API backwards compatible without extra flushes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plain-append-'));roots.push(dir);const file=path.join(dir,'ledger.jsonl');const sync=vi.spyOn(fs,'fsyncSync');
  appendTextFile(file,'one\n');appendTextFile(file,'two\n');expect(fs.readFileSync(file,'utf8')).toBe('one\ntwo\n');expect(sync).not.toHaveBeenCalled();
 });
 it('flushes both directories for a durable move',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'durable-move-'));roots.push(dir);const a=path.join(dir,'a'),b=path.join(dir,'b');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(a,'object.yml'),'id: sample');const sync=vi.spyOn(fs,'fsyncSync');
  renameFile(path.join(a,'object.yml'),path.join(b,'object.yml'),{durable:true});expect(fs.existsSync(path.join(a,'object.yml'))).toBe(false);expect(fs.readFileSync(path.join(b,'object.yml'),'utf8')).toBe('id: sample');expect(sync).toHaveBeenCalledTimes(2);
 });
});
