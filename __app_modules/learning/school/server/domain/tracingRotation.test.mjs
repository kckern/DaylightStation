import { describe, it, expect } from 'vitest';
import { remainingTracingCharacters } from './tracingRotation.mjs';
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const row = (character, i, extra = {}) => ({character, issuedAt: new Date(1000+i).toISOString(), ...extra});
describe('tracing character rotation', () => {
  it('counts legacy duplicate letters once, ignoring case, and includes digits', () => {
    expect(remainingTracingCharacters({characters, history: [row('W',0),row('q',1),row('Q',2)]})).toBe('ABCDEFGHIJKLMNOPRSTUVXYZ0123456789');
  });
  it('uses every character before beginning the next cycle', () => {
    const history = [...characters].map((c,i)=>row(c,i));
    expect(remainingTracingCharacters({characters,history:history.slice(0,-1)})).toBe('9');
    expect(remainingTracingCharacters({characters,history})).toBe(characters);
    expect(remainingTracingCharacters({characters,history:[...history,row('Q',40)]})).toBe(characters.replace('Q',''));
  });
  it('counts replaced printed sheets but ignores failed unprinted reservations', () => {
    expect(remainingTracingCharacters({characters,history:[row('Q',0,{voidedAt:'later',lastPrintedAt:'printed'}),row('W',1,{voidedAt:'later',voidReason:'print-failed'})]})).toBe(characters.replace('Q',''));
  });
  it('refuses unidentified history rather than repeating silently', () => {
    expect(()=>remainingTracingCharacters({characters,history:[row(null,0)]})).toThrow(/character/i);
  });
});

it('retains legacy replaced sheets with no lastPrintedAt receipt',()=>{
  expect(remainingTracingCharacters({characters:'QW',history:[row('Q',0,{voidedAt:'later',voidReason:'replaced'})]})).toBe('W');
});
