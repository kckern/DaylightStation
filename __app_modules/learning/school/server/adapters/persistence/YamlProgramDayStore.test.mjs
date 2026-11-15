import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlProgramDayStore } from './YamlProgramDayStore.mjs';
const roots=[];
afterEach(()=>{ for(const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
describe('program day evidence store',()=>{
  it('serializes appends and refuses to turn corrupt evidence into an empty history',async()=>{
    const rootDir=mkdtempSync(path.join(tmpdir(),'gratitude-store-')); roots.push(rootDir);
    const store=new YamlProgramDayStore({rootDir});
    await Promise.all([store.append('child','2026-11-16',{type:'opened'}),store.append('child','2026-11-16',{type:'submitted',attemptId:'a'})]);
    expect((await store.read('child','2026-11-16')).events).toHaveLength(2);
    writeFileSync(path.join(rootDir,'child/2026-11-16.yml'),'events: [broken');
    expect((await store.read('child','2026-11-16')).status).toBe('corrupt');
    await expect(store.append('child','2026-11-16',{type:'opened'})).rejects.toThrow(/corrupt/);
    expect(readFileSync(path.join(rootDir,'child/2026-11-16.yml'),'utf8')).toBe('events: [broken');
    expect(readdirSync(path.join(rootDir,'child')).some(n=>n.includes('corrupt-'))).toBe(true);
  });
  it('rejects unsafe learner names and invalid calendar dates',async()=>{
    const store=new YamlProgramDayStore({rootDir:tmpdir()});
    await expect(store.read('../child','2026-11-16')).rejects.toThrow();
    await expect(store.read('child','2026-99-99')).rejects.toThrow();
  });
});
