// Shim — grading moved to Piano/performance/grading.js (assessment service).
// Remove once createPianoChordProvider imports the service directly (Task 6).
export { timingQuality, gradeOrderedPerformance, gradeChordPerformance, gradeBand } from '../../performance/grading.js';
export { default } from '../../performance/grading.js';
