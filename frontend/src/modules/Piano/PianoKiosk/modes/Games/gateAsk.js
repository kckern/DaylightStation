/**
 * Re-export shim. `gateAsk` moved to `Piano/ask/gateAsk.js` (task 3 of the
 * ask-platform SP1 plan): requirement-building, ask copy and framing are the
 * ASK's business, not one host's, and `AskSession` is now their caller.
 *
 * Kept so the imports that already point here — `GameGate.jsx`, and three test
 * files across Games and Exercises — need not move in the same commit as the
 * extraction. Every one of them migrates as its host does (tasks 4-5), and this
 * file goes with the last of them.
 */
export { requirementForLevel, askForMaterial, framingFor } from '../../../ask/gateAsk.js';
