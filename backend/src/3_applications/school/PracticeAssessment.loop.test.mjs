// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { it, expect } from 'vitest';
import { PracticeAssessmentService } from './PracticeAssessmentService.mjs';
import { IssueDocument } from './usecases/IssueDocument.mjs';
import { OpenRemediation } from './usecases/OpenRemediation.mjs';
import { CloseSessionOutcome } from './usecases/CloseSessionOutcome.mjs';
import { PublishPrintDocument } from './documents/PublishPrintDocument.mjs';
import { RenderPrintDocument } from './documents/RenderPrintDocument.mjs';
import { ResolveCardScan } from './documents/ResolveCardScan.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import { FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, FakeLaserPrinter, fakeClock, sequentialIds, silentLogger, fakeGrownUps } from '../../../../tests/_lib/school/lifecycleFakes.mjs';
const fixture = (name) => yaml.load(fs.readFileSync(new URL(`../../../../tests/_fixtures/school/korean-3-2/${name}.yml`, import.meta.url), 'utf8'));
it('prints 6 → 2 → 1 questions, preserving credits and requiring fresh mapped checks between paper attempts', async () => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'practice-assessment-loop-'));
 try {
 const unit = fixture('korean-3-2.lesson-01');
 const sessions = new FakeSessionRepository(), tokens = new FakeTokenRegistry(), printer = new FakeLaserPrinter();
 const clock = fakeClock('2026-10-07T16:00:00Z');
 const curriculum = { getUnit: async () => unit, listUnits: async () => [unit], listWorks: async () => [], getDocument: async () => null };
 const assignments = { get: async () => ({ courses: [unit.courseId], programs: [{programId:'flashcards',deckId:unit.practice.deckId,linkedUnitId:unit.unitId,policy:{mode:'card-ladder'}}] }) };
 const evidence = {status:{words:Object.fromEntries(unit.practice.requiredCardIds.map(id=>[id,{state:'mastered',recognizedCount:1,matched:true}]))},dayFiles:[]};
 const repository = new YamlPrintDocumentRepository({ directory });
 for(const name of ['lesson-01-a','lesson-01-b']) await new PublishPrintDocument({repository}).execute({source:fixture(name)});
 const allocationStore = new YamlAllocationStore({directory});
 const rendering = new RenderPrintDocument({repository,allocationStore,rendering:createPrintDocumentRendering()});
 const service = new PracticeAssessmentService({curriculum,assignments,sessions,cardLadder:{courseEvidence:async()=>evidence},clock:clock.now,newSessionId:sequentialIds('paper')});
 const issuer = new IssueDocument({curriculum,sessions,tokens,formMaps:new FakeFormMapStore(),renderer:{},printer,printDocuments:repository,renderPrintDocument:rendering,allocationStore,practiceAssessments:service,clock:clock.now,logger:silentLogger});
 const remediation = new OpenRemediation({curriculum,sessions,practiceAssessments:service,clock:clock.now,newSessionId:sequentialIds('retry'),logger:silentLogger});
 service.configurePrinting({issueDocument:issuer,openRemediation:remediation,printDocuments:repository});
 const close = new CloseSessionOutcome({curriculum,sessions,tokens,assignments,grownUps:fakeGrownUps(clock),practiceAssessments:service,clock:clock.now,logger:silentLogger});
 const args={learnerId:'test-learner',unitId:unit.unitId};
 const append=async(sid,type,fields={})=>{const built=createEvent({sessionId:sid,type,at:clock.iso(),...fields});expect(built.errors).toEqual([]);await sessions.appendEvent(sid,built.event);};
 const grade=async(sid,missed)=>{
  const state=reduceSession(await sessions.readEvents(sid)); const ids=state.practiceAssessment.questionIds;
  await append(sid,'submitted',{transport:'paper'});
  clock.advanceMs(1000);
  await append(sid,'graded',{attemptIds:[`attempt-${sid}`],percent:Math.round((ids.length-missed.length)*100/ids.length),passingPercent:100,correctCount:ids.length-missed.length,totalCount:ids.length,missedItemIds:missed});
  return close.execute({sessionId:sid});
 };
 const review=async()=>{
  const progress=await service.get(args);expect(progress.stage).toBe('review');clock.advanceMs(1000);
  evidence.dayFiles.push({items:Object.fromEntries(progress.pendingReviewCardIds.flatMap(card=>['3.1','2.2'].map(task=>[`${card}-${task}`,{source:'course-review',courseUnitId:unit.unitId,wordId:card,task,at:clock.iso(),result:{correct:true}}])))});
  expect((await service.get(args)).stage).toBe('retry_ready');
 };
 const first=await service.print(args);expect(first.status).toBe('issued');
 const firstState=reduceSession(await sessions.readEvents(first.sessionId));expect(firstState.practiceAssessment.questionIds).toHaveLength(6);
 const repeated=await service.print(args);expect(repeated.sessionId).toBe(first.sessionId);expect((await sessions.listForLearner('test-learner'))).toHaveLength(1);
 await grade(first.sessionId,['permission-02','intention-03']);
 expect((await service.get(args)).resolvedQuestionIds).toHaveLength(4);
 await expect(service.print(args)).rejects.toThrow(/review/);
 await review();const second=await service.print(args);expect(second.status).toBe('issued');
 const retry=reduceSession(await sessions.readEvents(second.sessionId));expect(retry.practiceAssessment.questionIds).toEqual(['permission-02','intention-03']);expect(retry.practiceAssessment.document).toBe(unit.assessmentForms[1]);
 // Actual allocation and scan reconstruction use the printed two-question roster.
 const records=(await allocationStore.findByDocument('korean-3-2-lesson-01-b')).filter(r=>r.sessionId===second.sessionId);const record=records[0];expect(record.rowItems.map(row=>row.itemId)).toEqual(['permission-02','intention-03']);
 const resolved=await new ResolveCardScan({repository,allocationStore}).execute({testId:record.cardId,answers:{1:'A',2:'A'}});
 expect(resolved.results.flatMap(r=>r.results).map(r=>r.itemId)).toEqual(['permission-02','intention-03']);
 await grade(second.sessionId,['intention-03']);await review();
 const third=await service.print(args);expect(reduceSession(await sessions.readEvents(third.sessionId)).practiceAssessment.questionIds).toEqual(['intention-03']);
 expect((await grade(third.sessionId,[])).result).toBe('passed');
 expect((await service.get(args))).toMatchObject({stage:'completed',unresolvedQuestionIds:[]});
 evidence.status.words={};expect((await service.get(args)).stage).toBe('completed');
 // A later teacher correction reopens only the now-unresolved question, even
 // though this original attempt already has a finished retry child.
 clock.advanceMs(1000);
 await append(first.sessionId,'grade_adjusted',{adjustmentId:'correction-1',adjustedBy:'parent',reason:'Teacher found one previously credited answer was incorrect.',percent:50,passingPercent:100,correctCount:3,totalCount:6,missedItemIds:['permission-01','permission-02','intention-03']});
 await review();
 const corrected=await service.print(args);expect(corrected.status).toBe('issued');
 expect(reduceSession(await sessions.readEvents(corrected.sessionId)).practiceAssessment.questionIds).toEqual(['permission-01']);
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
