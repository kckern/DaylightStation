/**
 * The prefix oracle for COPY MODE, and nothing else.
 *
 * Copy mode is a beginner's scaffold: the target sentence is on screen and the
 * child traces it. Tracing means a stroke does not count until it is formed, so
 * a keystroke that makes the syllable in flight stop being a viable prefix of
 * the syllable being traced simply does not land — refused on the FIRST jamo,
 * not after the whole block.
 *
 * ⚠ THIS IS COPY MODE ONLY. In listen mode the program also knows the target,
 * and applying any of this there would silently correct a learner who misheard
 * 오늘 as 온... into the right answer — the record would then say they heard it
 * correctly. That is measurement corruption: a system that looks like it is
 * working perfectly while measuring nothing. Listen mode keeps the plain
 * automaton. Nothing here is reachable without an explicit oracle being handed
 * to `FieldComposer.handleKey`, and there is deliberately no default one.
 *
 * It is also NOT grading. The ladder grades nothing — `accuracy` is recorded,
 * never gating (docs/reference/school/sentence-ladder.md). This is an input
 * constraint, like a worksheet with a shape printed on it to trace.
 */
import { decompose } from './hangul.js';

/**
 * Is `candidate` — the automaton's in-flight `{ cho, jung, jong }`, any of
 * which may be null for "not reached yet" — still on the way to `target`?
 *
 * FAIL OPEN. A target this cannot decompose (a bare jamo like ㄱ, Latin,
 * punctuation, null) permits everything. A gate that refuses what it cannot
 * understand is worse than no gate: it produces a dead keyboard, with nothing
 * on screen to explain why the child's typing stopped working.
 */
export function isViablePrefix(candidate, target) {
  const want = decompose(target);
  if (!want) return true;
  const { cho = null, jung = null, jong = null } = candidate ?? {};
  // Field by field, skipping what has not been reached. Nothing in flight at
  // all is a prefix of every syllable — that is the state each one starts in.
  if (cho !== null && cho !== want.cho) return false;
  if (jung !== null && jung !== want.jung) return false;
  if (jong !== null && jong !== want.jong) return false;
  return true;
}

/**
 * Whether the gate may hold an opinion about this target at all.
 *
 * The viability check above fails open on its own, but the composer's gate has
 * a second half — "this key committed text, so it abandoned the syllable" —
 * which has no meaning against a target that is not one precomposed syllable.
 * Both halves are switched off together by this.
 */
export function isTraceableTarget(target) {
  return decompose(target) !== null;
}
