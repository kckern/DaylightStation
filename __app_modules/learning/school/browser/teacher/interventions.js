/**
 * The one index of "something went wrong — what do I use?" (UX audit IA4).
 *
 * The repair tools were spread across four pages under five different words —
 * exceptions, overrides, attestations, corrections, repair — with no page
 * anywhere saying which one matches which situation. Each entry names the
 * tool in the family's language and states the situation it is for; the id
 * and the internal vocabulary stay out of the label.
 */
import { TEACHER_BASE } from "./teacherUrl.js";

// One Fix page (owner ruling 2026-10-29): a child's repairs open on it with
// that child picked; the child's own page carries the same forms in its Fix fold.
const learnerOps = (learnerId) => `${TEACHER_BASE}/operations?${new URLSearchParams({ learner: learnerId })}`;
const schoolOps = () => `${TEACHER_BASE}/operations`;

export const INTERVENTIONS = [
  {
    id: 'grade-correction', scope: 'session', label: 'Fix a marked answer',
    useWhen: 'The machine marked a right answer wrong, or a wrong answer right.',
    where: 'Open the lesson from the day record, then “Fix a marked answer”.',
    href: null,
  },
  {
    id: 'retake', scope: 'session', label: 'Offer another try',
    useWhen: 'They should attempt the same lesson again.',
    where: 'Open the lesson from the day record. Offered when a lesson needs review.',
    href: null,
  },
  {
    id: 'completion-credit', scope: 'learner', label: 'Give credit for work you saw',
    useWhen: 'They did the work but the tech lost it — no scan, no session, a dead printer.',
    where: 'Fix, with the child picked (or the child’s page → Fix something).',
    href: learnerOps,
  },
  {
    id: 'program-day-bypass', scope: 'learner', label: 'Excuse today’s piano lesson',
    useWhen: 'Today’s piano lesson shouldn’t be required — recital, illness, travel.',
    where: 'Fix, with the child picked (or the child’s page → Fix something).',
    href: learnerOps,
  },
  {
    id: 'reassign', scope: 'learner', label: 'Move work to the right child',
    useWhen: 'The wrong child’s name ended up on a lesson.',
    where: 'Fix, with the child picked (or the child’s page → Fix something).',
    href: learnerOps,
  },
  {
    id: 'curriculum-change', scope: 'school', label: 'Excuse, postpone, swap, or stop a lesson',
    useWhen: 'The lesson itself is the problem — broken, missing, garbled, or not right for now.',
    where: 'Fix, below the child picker.',
    href: schoolOps,
  },
  {
    id: 'stuck-session', scope: 'school', label: 'Clear a lesson that never finished',
    useWhen: 'A lesson is stuck open and blocking new work.',
    where: 'Fix, below the child picker.',
    href: schoolOps,
  },
  {
    id: 'active-changes', scope: 'school', label: 'See what is already changed',
    useWhen: 'You want to know which rules are currently overridden, and by whom.',
    where: 'Fix, below the child picker.',
    href: schoolOps,
  },
  {
    id: 'bulk-regrade', scope: 'school', label: 'Re-mark a whole batch',
    useWhen: 'A grading rule was wrong for many attempts at once.',
    where: 'Fix, below the child picker.',
    href: schoolOps,
  },
];

export const interventionsFor = (scope) => INTERVENTIONS.filter((item) => item.scope === scope);

export default INTERVENTIONS;
