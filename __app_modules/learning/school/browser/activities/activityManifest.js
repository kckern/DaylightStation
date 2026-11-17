import { isCardLadderPolicy } from '../Programs/Flashcards/CardLadder/cardLadderMode.js';

const entry = (label, layout = 'workspace', extra = {}) => Object.freeze({label, layout, capabilities: [], available: true, ...extra});
/** Browser presentation/launch metadata. Domain authorization remains server-owned. */
export const SCHOOL_ACTIVITIES = Object.freeze({
  home: entry('School', 'board'), subject: entry('Subject'), library: entry('Library'),
  catalog: entry('Catalog'), progress: entry('My Progress'), practice: entry('Practice'),
  print: entry('Print'), typing: entry('Typing', 'focus', {capabilities:['keyboard']}),
  geography: entry('Geography'), chess: entry('Chess'),
  'geography-drill': entry('Geography practice', 'focus'),
  quiz: entry('Quiz', 'focus'), problems: entry('Practice', 'focus'), flashcard: entry('Flashcards', 'focus'),
  flashcards: entry('Flashcards', 'focus', {programId:'flashcards', required:['deckId']}),
  'card-ladder': entry('Card Ladder', 'focus', {programId:'card-ladder', required:['deckId']}),
  'learning-probe': entry('Learning check', 'focus'), 'learning-reader': entry('Lesson notes'),
  remediation: entry('Tutor', 'focus'), 'lesson-companion': entry('Readalong', 'media'),
  'sentence-ladder': entry('Sentence Ladder', 'focus', {programId:'sentence-ladder', required:['corpusId','studyGrant'], capabilities:['audio']}),
  'language-reels': entry('Language Reels', 'media', {programId:'language-reels', required:['reelId','reelGrant','unitId'], capabilities:['audio','video']}),
  'rubiks-cube': entry('Rubik’s Cube', 'split', {programId:'rubiks-cube', required:['courseId','cubeGrant']}),
  gratitude: entry('Gratitude', 'focus', {programId:'gratitude', required:['gratitudeGrant']}),
  'school-debrief': entry('After-school debrief', 'focus', {programId:'school-debrief', required:['debriefGrant']}),
  'book-log': entry('Reading', 'workspace', {programId:'book-log', required:['bookGrant']}),
  'economy-bank': entry('Bank', 'workspace', {programId:'economy-bank', required:[]}),
  'reading-session': entry('Story time', 'media', {programId:'story-time', capabilities:['audio','video']}),
  'media-lesson': entry('Media lesson', 'media', {capabilities:['audio','video']}),
  agenda: entry('Today', 'board'), rewards: entry('Rewards', 'board'),
  'launch-card': entry('Next activity'), 'launch-preview': entry('Launch card preview'),
  writing: entry('Writing', 'focus', {available:false}),
});
const aliases = Object.freeze({language:'sentence-ladder',quizzes:'quiz',materials:'library',banks:'practice','book-shelf':'book-log',bank:'economy-bank',drill:'geography-drill',flashcard_program:'flashcards',card_ladder:'card-ladder',learning_probe:'learning-probe',learning_reader:'learning-reader',lesson_companion:'lesson-companion','story-time':'reading-session','word-ladder':'card-ladder'});
export function activityFor(id) { return SCHOOL_ACTIVITIES[aliases[id] ?? id] ?? null; }
export function activityIdFor(id) { return SCHOOL_ACTIVITIES[aliases[id] ?? id] ? aliases[id] ?? id : null; }

export function sectionForProgramReport(report) {
  const id=activityIdFor(report?.program), activity=activityFor(id);
  if(!activity?.available) return null;
  if(report.program==='materials') return 'library';
  if(['quiz','flashcards','flashcard'].includes(id)) return 'banks';
  if(activity.programId) {
    if(['sentence-ladder','card-ladder','language-reels','rubiks-cube'].includes(id) && !report.instanceId) return null;
    return `program:${activity.programId}:${encodeURIComponent(report.instanceId ?? '')}`;
  }
  return ({typing:'typing',chess:'chess',geography:'geography',library:'library'})[id] ?? null;
}
export function programRequestForSection(section) {
  if(typeof section!=='string' || !section.startsWith('program:')) return null;
  const match=/^program:([^:]+):(.*)$/.exec(section);
  const activity=match && activityFor(match[1]);
  if(!activity?.available || !activity.programId) return null;
  try { return {programId:activity.programId,instanceId:decodeURIComponent(match[2]) || null}; } catch { return null; }
}
export function validateActivityTarget(target, learnerId=null) {
  if(!target || typeof target!=='object') return {ok:false,reason:'missing-target'};
  if(target.learnerId && learnerId && target.learnerId!==learnerId) return {ok:false,reason:'learner-mismatch'};
  if(target.kind==='bank') return target.bankId ? {ok:true,activityId:'quiz'} : {ok:false,reason:'missing-bank'};
  if(target.kind==='companion') return target.presentation==='readalong' ? {ok:true,activityId:'lesson-companion'} : {ok:false,reason:'unsupported-companion'};
  if(target.kind!=='program') return {ok:false,reason:'unknown-target'};
  const activityId=target.program==='flashcards' && isCardLadderPolicy(target.policy) ? 'card-ladder' : activityIdFor(target.program);
  const activity=activityFor(activityId);
  if(!activity?.programId || !activity.available || !learnerId) return {ok:false,reason:'unknown-program-or-learner'};
  const missing=(activity.required ?? []).find(key=>typeof target[key]!=='string' || !target[key]);
  return missing ? {ok:false,reason:`missing-${missing}`} : {ok:true,activityId};
}
