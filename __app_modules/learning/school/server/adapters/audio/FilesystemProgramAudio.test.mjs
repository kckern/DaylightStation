import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FilesystemProgramAudio } from './FilesystemProgramAudio.mjs';
it('keeps simultaneous takes distinct and rejects traversal reads',async()=>{
  const rootDir=mkdtempSync(path.join(tmpdir(),'gratitude-audio-'));
  try {
    const store=new FilesystemProgramAudio({rootDir,clock:()=>1});
    const one=await store.save({learnerId:'child',studyDay:'2026-11-16',buffer:Buffer.from('one'),mimeType:'audio/webm'});
    const two=await store.save({learnerId:'child',studyDay:'2026-11-16',buffer:Buffer.from('two'),mimeType:'audio/webm'});
    expect(one).not.toBe(two);
    expect(store.read('child',one.split('/')[1]).buffer.toString()).toBe('one');
    expect(store.read('other','../'+one)).toBeNull();
  } finally {rmSync(rootDir,{recursive:true,force:true});}
});
