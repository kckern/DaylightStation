// @vitest-environment node
import { it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import { FakeSessionRepository } from '../../../../../tests/_lib/school/lifecycleFakes.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';
it('refuses direct first issuance of practice-linked work when readiness is not configured', async () => {
 const sessions = new FakeSessionRepository();
 await sessions.appendEvent('s1', createEvent({ type:'created', sessionId:'s1', learnerId:'test-learner', unitId:'test.01', at:'2026-10-07T12:00:00Z' }).event);
 const unit = { unitId:'test.01', document:'print/test-a@123456789', practice:{deckId:'test'} };
 const issue = new IssueDocument({ curriculum:{getUnit:async()=>unit}, sessions, tokens:{}, renderer:{}, printer:{printPdf:()=>{throw new Error('must not print')}}, formMaps:{}, logger:{warn(){},info(){}} });
 const result = await issue.execute({sessionId:'s1'});
 expect(result).toMatchObject({status:'unavailable', message:expect.stringMatching(/practice|ready/i)});
 expect((await sessions.readEvents('s1')).map((e)=>e.type)).toEqual(['created']);
});
