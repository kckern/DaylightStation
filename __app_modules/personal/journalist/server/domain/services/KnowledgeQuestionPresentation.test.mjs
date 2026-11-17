import {describe,it,expect} from 'vitest';
import {presentKnowledgeQuestions,knowledgeQuestionPrompt} from './KnowledgeQuestionPresentation.mjs';
const selection={mode:'knowledge',questions:[{id:'loop.reply:status',text:'Did you finish: Sample reply?'}]};
const present=(summary,extra={})=>presentKnowledgeQuestions({summary,headline:'A meeting day.',selection,fallbackFacts:'You had one calendar event.',grounding:'Meeting with Sample',...extra});
describe('knowledge-only debrief questions',()=>{
 it('removes the model question block and appends only deterministic selected questions',()=>{
  const output=present('Meeting with Sample.\nKB_QUESTIONS_BEGIN\nInvented question?\nKB_QUESTIONS_END');
  expect(output.summary).toBe('Meeting with Sample.\n\n• Did you finish: Sample reply?');expect(output.headline).toBe('A meeting day.');
 });
 it.each(['No markers.','KB_QUESTIONS_BEGIN\nKB_QUESTIONS_END\nWhy did you feel sad?','KB_QUESTIONS_BEGIN\nKB_QUESTIONS_END\nKB_QUESTIONS_BEGIN\nKB_QUESTIONS_END','Met FabricatedName.\nKB_QUESTIONS_BEGIN\nKB_QUESTIONS_END'])('falls back to facts on malformed or invented output: %s',raw=>{
  expect(present(raw).summary).toBe('You had one calendar event.\n\n• Did you finish: Sample reply?');
 });
 it('allows a healthy empty selection without filling question slots or a question hook',()=>{
  const output=present('Meeting with Sample.\nKB_QUESTIONS_BEGIN\nKB_QUESTIONS_END',{selection:{mode:'knowledge',questions:[]},headline:'Did you enjoy it?'});
  expect(output.summary).toBe('Meeting with Sample.');expect(output.headline).toBeNull();
 });
 it('leaves legacy output unchanged and instructs the model to use one bounded block on KB days',()=>{
  expect(present('Why?',{selection:{mode:'legacy'}}).summary).toBe('Why?');
  const prompt=knowledgeQuestionPrompt(selection);expect(prompt).toContain('KB_QUESTIONS_BEGIN');expect(prompt).toContain('Did you finish: Sample reply?');
 });
});
