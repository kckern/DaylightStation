import { describe, expect, it } from 'vitest';
import { schoolActivityReducer } from './useSchoolActivityState.js';

describe('one active school workspace', () => {
  it('replaces a runner and its authority when a program launches', () => {
    const state = schoolActivityReducer({key:'active',value:{mode:'quiz',bank:{id:'old'}}}, {key:'studyLaunch',value:{learnerId:'child',studyGrant:'new'}});
    expect(state).toEqual({key:'studyLaunch',value:{learnerId:'child',studyGrant:'new'}});
  });
  it('does not let a former program cleanup clear the newly opened program', () => {
    const state = {key:'reelLaunch',value:{learnerId:'child',reelId:'scene'}};
    expect(schoolActivityReducer(state,{key:'studyLaunch',value:null})).toBe(state);
  });
  it('scopes updater callbacks and explicitly clears all authority on exit', () => {
    const state={key:'bookLaunch',value:{learnerId:'child',bookGrant:'grant'}};
    expect(schoolActivityReducer(state,{key:'active',value:current=>current?.mode==='remediation'?null:current})).toBe(state);
    expect(schoolActivityReducer(state,{clear:true})).toBe(null);
  });
});
