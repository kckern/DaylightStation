import {it,expect} from 'vitest';
import {previewKnowledge} from './KnowledgePreview.mjs';
import {evidence,proposal,TZ,AS_OF} from '../../domain/knowledge/fixtures.testHelpers.mjs';
it('selects only evidence available at the explicit historical ask instant and exposes no commit path',()=>{
 const quote='I will contact Sample 2026-11-02',source=evidence({content:quote}),p=proposal({quote,fields:{title:'Contact Sample',due:'2026-11-02'}});
 const result=previewKnowledge({username:'sample',proposals:[p],evidence:[source],askDate:'2026-11-03',activationDate:'2026-11-03',asOf:AS_OF,timezone:TZ});
 expect(result.previewOnly).toBe(true);expect(result.selection.mode).toBe('knowledge');expect(result.selection.questions).toHaveLength(1);expect(result.rejected).toEqual([]);
 const before=previewKnowledge({username:'sample',proposals:[p],evidence:[source],askDate:'2026-11-01',activationDate:'2026-11-01',asOf:Date.parse('2026-11-01T15:00Z'),timezone:TZ});expect(before.selection.questions).toEqual([]);
});
