// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assembleKoreanCourse } from '../../../cli/lib/korean-course.mjs';
import fs from 'node:fs';
import yaml from 'js-yaml';
const fixture = new URL('../../_fixtures/school/korean-3-2/', import.meta.url);
const baseLexicon = yaml.load(fs.readFileSync(new URL('lexicon.yml', fixture), 'utf8'));
const baseUnit = yaml.load(fs.readFileSync(new URL('korean-3-2.lesson-01.yml', fixture), 'utf8'));
const makeLesson = (lesson) => ({ lesson, title: `Lesson ${lesson}`, kind: lesson === 16 ? 'final' : [3,6,9,12,15].includes(lesson) ? 'review' : 'new', textbookPages: [24,33], workbookPages: [10,15], objectives: ['Use the pattern.'], vocabulary: [{id:'book',term:'책',gloss:'book',source:{book:'textbook',page:27}}], patterns: [{ id: 'reading', label: '-다', explanation: 'Plain style.', source:{book:'textbook',page:28}, models: [{ id: 'read', term:'책을 읽었다.',gloss:'I read a book.',pronunciation:'chaegeul ilgeotda',source:{book:'textbook',page:28}}], questions: [{id:'reading-01',modelId:'read',explanation:'Past plain style.',formA:{prompt:'Past diary: 책을 ___.',choices:['읽었다','읽는다','읽을 거다','읽을까'],answer:'읽었다'},formB:{prompt:'Past diary: 편지를 ___.',choices:['읽었다','읽는다','읽을 거다','읽을까'],answer:'읽었다'}}] }] });
describe('Korean course assembly', () => {
  it('preserves Lesson 1 and canonical cards across later review decks', () => {
    const input = structuredClone(baseLexicon);
    const result = assembleKoreanCourse({ baseLexicon: input, baseUnit, lessons: [makeLesson(2), makeLesson(3)], requireComplete: false });
    expect(result.lexicon.entries.slice(0,19)).toEqual(baseLexicon.entries);
    expect(input).toEqual(baseLexicon);
    expect(result.units[0]).toEqual(baseUnit);
    expect(result.decks[1].words).toEqual(result.decks[2].words);
    expect(result.units[1].practice.requiredCardIds).toEqual(result.decks[1].words);
    expect(result.units[1].practice.questionCards['reading-01'].cardIds).toEqual(['l02-read']);
    expect(result.units[2].assessmentForms).toHaveLength(2);
    expect(result.documents).toHaveLength(4);
  });
  it('uses earlier expression cards in the final without introducing new cards', () => {
    const first=makeLesson(2), final=makeLesson(16); final.vocabulary=[]; final.patterns[0].models[0].term='편지를 읽었다.';
    const result=assembleKoreanCourse({baseLexicon,baseUnit,lessons:[first,final],requireComplete:false});
    expect(result.lexicon.entries).toHaveLength(21);
    expect(result.units[2].practice.questionCards['reading-01'].cardIds).toEqual(['l02-read']);
    expect(result.decks[2].words).toEqual([...new Set(result.decks.slice(0,2).flatMap(d=>d.words))]);
  });
  it('rejects incomplete course coverage, duplicated or ambiguous answer identities, and orphan mappings', () => {
    expect(() => assembleKoreanCourse({baseLexicon,baseUnit,lessons:[makeLesson(2)]})).toThrow(/2.*16/);
    const bad = makeLesson(2);bad.patterns[0].questions[0].formA.choices[1]='읽었다';
    expect(() => assembleKoreanCourse({baseLexicon,baseUnit,lessons:[bad],requireComplete:false})).toThrow(/unique/);
    const orphan=makeLesson(2);orphan.patterns[0].questions[0].modelId='missing';
    expect(() => assembleKoreanCourse({baseLexicon,baseUnit,lessons:[orphan],requireComplete:false})).toThrow(/model/);
  });
});

it('authors every source unit and all twenty final grammar targets without changing the pilot', () => {
  const dir=new URL('full-course/lessons/',fixture);
  const lessons=fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>JSON.parse(fs.readFileSync(new URL(name,dir),'utf8')));
  const result=assembleKoreanCourse({baseLexicon,baseUnit,lessons});
  expect(result.units.map(unit=>unit.sequence)).toEqual(Array.from({length:16},(_,i)=>i+1));
  expect(result.documents).toHaveLength(30);
  expect(result.units.reduce((sum,unit)=>sum+Object.keys(unit.practice.questionCards).length,0)).toBe(120);
  expect(result.lexicon.entries).toHaveLength(284);
  expect(result.units.at(-1).practice.requiredCardIds).toHaveLength(284);
  expect(result.inventory.at(-1).patterns).toHaveLength(20);
  expect(result.lexicon.entries.slice(0,19)).toEqual(baseLexicon.entries);
  for(const unit of result.units){
    const deck=result.decks.find(deck=>deck.id===unit.practice.deckId);
    expect(deck.words).toEqual(unit.practice.requiredCardIds);
    for(const link of Object.values(unit.practice.questionCards))expect(link.cardIds.every(id=>deck.words.includes(id))).toBe(true);
  }
  expect(result.lexicon.entries.some(entry=>entry.group==='lesson-16')).toBe(false);
});

it('publishes balanced, noncyclic distinct keys deterministically and can rebuild a completed lexicon', () => {
 const dir=new URL('full-course/lessons/',fixture);
 const lessons=fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(new URL(n,dir),'utf8')));
 const inputs={baseLexicon,baseUnit,lessons},result=assembleKoreanCourse(inputs);
 const keys=result.published.map(p=>p.bank.items.map(q=>q.choices.indexOf(q.answer)));
 for(const key of keys){
  const counts=[0,1,2,3].map(k=>key.filter(v=>v===k).length);
  expect(Math.max(...counts)-Math.min(...counts)).toBeLessThanOrEqual(1);
  for(let period=1;period<=4;period++)for(let start=0;start+3*period<=key.length;start++){
   const block=key.slice(start,start+period);
   expect(key.slice(start+period,start+3*period)).not.toEqual([...block,...block]);
  }
 }
 for(let i=0;i<keys.length;i+=2)expect(keys[i].filter((k,j)=>k!==keys[i+1][j]).length).toBeGreaterThanOrEqual(Math.ceil(keys[i].length/2));
 expect(assembleKoreanCourse(inputs)).toEqual(result);
 const rebuilt=assembleKoreanCourse({...inputs,baseLexicon:result.lexicon});
 expect(rebuilt).toEqual(result);
});
