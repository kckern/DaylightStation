// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { FlashcardProgramLauncher } from './FlashcardProgramLauncher.mjs';
import { StoryTimeProgramLauncher } from './StoryTimeProgramLauncher.mjs';
import { BookLogProgramLauncher } from './BookLogProgramLauncher.mjs';
import { PrintedActivityProgramLauncher } from './PrintedActivityProgramLauncher.mjs';
import { PianoCourseProgramLauncher } from './PianoCourseProgramLauncher.mjs';
import { SurfaceProgramLauncher } from './SurfaceProgramLauncher.mjs';
import { SchoolDebriefProgramLauncher } from './SchoolDebriefProgramLauncher.mjs';
import { IProgramLauncher } from './ports/IProgramLauncher.mjs';

// The getter is a constant; reading it off the prototype needs no dependencies.
const flag = (Launcher) => Reflect.get(Launcher.prototype, 'saturdayCatchUp') === true;

describe('Saturday catch-up opt-in: only programs whose Saturday work is credited', () => {
  it('the port defaults to no', () => {
    expect(new IProgramLauncher().saturdayCatchUp).toBe(false);
  });
  it.each([
    ['flashcards (card-ladder day file counts toward card-goal any day)', FlashcardProgramLauncher],
    ['story time (a read counts toward story-read any day)', StoryTimeProgramLauncher],
    ['book log (the shelf is a dated log; a finish is a milestone any day)', BookLogProgramLauncher],
    ['printed activity (a scanned sheet is completed on its own study day)', PrintedActivityProgramLauncher],
  ])('%s opts in', (_name, Launcher) => {
    expect(flag(Launcher)).toBe(true);
  });
  it.each([
    ['school debrief (writes Saturday\'s debrief, which nothing owes or pays)', SchoolDebriefProgramLauncher],
    ['piano course (a lesson is not a passed challenge; nothing counts a Saturday lesson)', PianoCourseProgramLauncher],
    ['surface (the evidence is a dispatch, not the work)', SurfaceProgramLauncher],
  ])('%s does not', (_name, Launcher) => {
    expect(flag(Launcher)).toBe(false);
  });
});
