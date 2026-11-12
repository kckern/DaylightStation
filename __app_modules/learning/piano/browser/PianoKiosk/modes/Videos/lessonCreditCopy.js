/**
 * Child-facing copy for lesson credit (owner-approved wording, 2026-11-12).
 * The good-faith score itself is never shown — only these words.
 */
export const DRILL_TITLE = "Let's warm up those fingers before this lesson counts";
export const drillSubtitle = (reps) => `${reps} quick scales — then it counts.`;
/** Preschool courses get finger games, not scales. */
export const gentleSubtitle = (rounds) => (rounds === 1 ? 'One quick finger game — then it counts.' : `${rounds} quick finger games — then it counts.`);
export const DRILL_DONE = 'That counts! Lesson done.';
export const DRILL_START = 'Start';
export const DRILL_NOT_NOW = 'Not now';
export const DRILL_UNAVAILABLE = "The warm-up can't load right now. Try again later.";

export const NOT_COUNTED_CHIP = 'Not counted yet';
export const NOT_COUNTED_HINT = 'Play along, or do the warm-up to count it.';

export const REOPEN_TITLE = 'Almost there';
export const REOPEN_BODY = "This lesson doesn't count yet. Do a quick warm-up to count it, or watch it again and play along.";
export const REOPEN_WARMUP = 'Warm up';
export const REOPEN_REWATCH = 'Watch again';

export const GENTLE_CLIMB = 'Play 5 notes going up';
export const GENTLE_ECHO = 'Copy these 3 notes';

export const CHECKIN_NOTE = 'Are you still there? Play this note to keep going:';
export const CHECKIN_ONE_SCALE = 'Welcome back! One quick scale, then the lesson carries on.';
export const CHECKIN_TWO_SCALES = "Let's wake those fingers up — two quick scales, then back to the lesson.";
