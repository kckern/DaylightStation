import { it,expect } from 'vitest';
import { GratitudeTopicExtractor } from './GratitudeTopicExtractor.mjs';
it('extracts a bounded subject through the provider port and refuses malformed output',async()=>{
  const make=value=>new GratitudeTopicExtractor({aiGateway:{chatStructured:async()=>value},config:{model:'cheap',timeoutMs:100},logger:{}});
  expect(await make({subject:'Toys'}).extract({text:"I'm grateful for my toys"})).toMatchObject({subject:'Toys'});
  expect(await make({subject:'a'.repeat(161)}).extract({text:'Toys'})).toBeNull();
  expect(await make({topic:'Toys'}).extract({text:'Toys'})).toBeNull();
});
