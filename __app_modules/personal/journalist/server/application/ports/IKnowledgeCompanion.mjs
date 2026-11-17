import {IFollowUpSource} from './IFollowUpSource.mjs';
/** Optional entry and quiz companion; absent implementations preserve legacy behavior. */
export class IKnowledgeCompanion extends IFollowUpSource {
 sourceForEntry(_input){throw new Error('Not implemented');}
 async onEntrySaved(_input){throw new Error('Not implemented');}
 async handleCallback(_input){throw new Error('Not implemented');}
 async nextQuiz(_input){throw new Error('Not implemented');}
 async done(_input){throw new Error('Not implemented');}
}
