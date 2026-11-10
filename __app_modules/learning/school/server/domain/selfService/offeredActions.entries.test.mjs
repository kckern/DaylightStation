// A program's launch-card entries (owner 2026-11-06: dictation and review one
// tap from the card) ride the one work action; the action stays unique by kind.
import { describe, expect, it } from 'vitest';
import { offeredActions } from "./offeredActions.mjs";
import { projectProgramEntry } from "../../application/assignedProgramPlan.mjs";

const ENTRIES = [
  { id: 'dictation', label: 'Practise dictation', role: 'primary' },
  { id: 'review', label: 'Review flashcards', role: 'secondary' },
  { id: 'today', label: "Today's cards", role: 'secondary' },
];

describe('launch-card entries', () => {
  it('projectProgramEntry carries the program status entries onto the entry', () => {
    const entry = projectProgramEntry({ program: 'flashcards', title: 'Korean' }, { context: { lesson: { title: 'Dictation: 10 words' } }, entries: ENTRIES });
    expect(entry.entries).toEqual(ENTRIES);
  });
  it('the program work action carries the entries; still one work action, then exit', () => {
    const actions = offeredActions({ kind: 'program', programId: 'flashcards', unit: { title: 'Dictation: 10 words', entries: ENTRIES } });
    expect(actions.filter((a) => a.kind === 'program')).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'program', target: 'flashcards', entries: ENTRIES });
    expect(actions.at(-1).kind).toBe('exit');
  });
  it('a program with no entries is unchanged', () => {
    const [work] = offeredActions({ kind: 'program', programId: 'rubiks-cube', unit: { title: 'Cube' } });
    expect(work).not.toHaveProperty('entries');
  });
});
