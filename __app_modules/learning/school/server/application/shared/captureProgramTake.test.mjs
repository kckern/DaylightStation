import { it,expect } from 'vitest';
import { captureProgramTake } from './captureProgramTake.mjs';
it('preserves audio before attempting transcription and survives a transcriber failure',async()=>{
  const order=[];
  const result=await captureProgramTake({learnerId:'child',studyDay:'2026-11-16',buffer:Buffer.alloc(1001),saveAudio:async()=>{order.push('saved');return 'child/take.webm';},transcribe:async()=>{order.push('transcribed');throw new Error('down');},logger:{warn(){}}});
  expect(order).toEqual(['saved','transcribed']);
  expect(result).toEqual({audioRef:'child/take.webm',text:null});
});
