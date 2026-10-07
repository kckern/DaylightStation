import { it, expect } from 'vitest';
import { selectAssessmentQuestions } from './assessmentSelection.mjs';
it('selects precisely the unresolved questions and keeps instructional blocks', () => {
 const document = { blocks: [{type:'rich_text', md:'Instructions'}, { type:'group', blocks:[{type:'question', itemId:'q1', blocks:[]}, {type:'question',itemId:'q2',blocks:[]}] }] };
 const selected = selectAssessmentQuestions(document, ['q2']);
 expect(selected.blocks[1].blocks.map((b) => b.itemId)).toEqual(['q2']);
 expect(selected.blocks[0].md).toBe('Instructions');
 expect(document.blocks[1].blocks).toHaveLength(2);
 expect(() => selectAssessmentQuestions(document, ['ghost'])).toThrow(/ghost/);
});
