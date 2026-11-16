import { SCHOOL_ACTIVITIES, activityFor, sectionForProgramReport } from './activities/activityManifest.js';

/** Compatibility facade over the one installed browser activity manifest. */
export const PROGRAMS = Object.freeze({
  ...SCHOOL_ACTIVITIES,
  language: activityFor('sentence-ladder'),
  quizzes: activityFor('quiz'),
  materials: activityFor('library'),
});
export const sectionForReport = sectionForProgramReport;
export function programLabel(id) { return activityFor(id)?.label ?? id; }
export default PROGRAMS;
