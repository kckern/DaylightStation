// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { SetAssignments } from './SetAssignments.mjs';
import { validateFlashcardEnrollment } from '#domains/school/flashcards/index.mjs';
const unit={unitId:'course.01',courseId:'course',practice:{deckId:'language/test/one'}};
const program={programId:'flashcards',deckId:unit.practice.deckId,linkedUnitId:unit.unitId,policy:{mode:'card-ladder'}};
it('requires the assigned course and matching published practice deck before storing a linkage', async()=>{
 const put=vi.fn(async row=>row);
 const useCase=new SetAssignments({assignments:{put},grownUps:{assert(){}},curriculum:{listUnits:async()=>[unit]},programValidators:new Map([['flashcards',validateFlashcardEnrollment]])});
 await expect(useCase.execute({learnerId:'kid',programs:[program]})).rejects.toThrow(/Assign the linked/);
 await expect(useCase.execute({learnerId:'kid',courses:['course'],programs:[{...program,deckId:'language/test/wrong'}]})).rejects.toThrow(/linkage/);
 expect(put).not.toHaveBeenCalled();
 await useCase.execute({learnerId:'kid',courses:['course'],programs:[program]});
 expect(put).toHaveBeenCalledWith(expect.objectContaining({programs:[expect.objectContaining({linkedUnitId:unit.unitId,deckId:unit.practice.deckId})]}));
});
