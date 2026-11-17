import { it, expect } from 'vitest';
import { createKnowledgeCallbackTokens } from './KnowledgeCallbackTokens.mjs';
it('mints opaque128bit nonces and keeps every callback under64 UTF8 bytes',()=>{
 const codec=createKnowledgeCallbackTokens(),seen=new Set();
 for(let i=0;i<50;i++){
  const nonce=codec.mint();expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);expect(seen.has(nonce)).toBe(false);seen.add(nonce);
  for(const action of ['yes','not_yet','drop','skip','looks_right','confirm','reject','done']){
   const raw=codec.encode({nonce,action});expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64);expect(codec.decode(raw)).toEqual({nonce,action});
  }
 }
});
it('rejects unknown formats, actions, oversized input and malformed entropy',()=>{
 const codec=createKnowledgeCallbackTokens();
 for(const raw of ['', 'kb1:bad:y','debrief:ask','kb1:'+'x'.repeat(100)+':y','kb1:'+'A'.repeat(22)+':z'])expect(codec.decode(raw)).toBeNull();
 expect(()=>codec.encode({nonce:codec.mint(),action:'merge'})).toThrow();
 expect(()=>createKnowledgeCallbackTokens({randomBytes:()=>Buffer.alloc(2)}).mint()).toThrow();
});
