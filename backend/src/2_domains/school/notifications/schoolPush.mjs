/**
 * The phone's copy of a school event (design:
 * docs/_wip/plans/2026-09-22-household-push-notifications-design.md §1).
 *
 * Title: `{emoji} {Child} — {Course}: {Lesson}`. Body: one plain line, no
 * percentages, no ids, no trailing period. Returns null when the phone
 * should hear nothing. The room siren is decided elsewhere (the HA script
 * branches on `result`), so a null here never silences the room.
 */
import { formatStudyDay, pushData } from '#domains/notification/push/pushText.mjs';
import { rowList } from '../documents/scanNotices.mjs';

const LANES = {
  progress: { channel: 'School progress', importance: 'low' },
  needsYou: { channel: 'School needs you', importance: 'high' },
};

const CODE_TEXT = {
  CARD_ID_UNREADABLE: "The card number couldn't be read — rescan the card",
  OMR_COLUMN_COUNT: "The reader couldn't line up the card — rescan it",
  unknown_card: "This card isn't one School printed — check it's the right card",
  dead_card: 'This card was already retired — print a fresh one',
  ALLOCATION_ROW_MAPPING_DRIFT: "The card's rows didn't match its worksheet — check the School teacher view",
  SCAN_ROW_PLAN_INVALID: "The card's rows didn't match its worksheet — check the School teacher view",
};
const CODE_FALLBACK = "Card couldn't be graded — check the School teacher view";

const REVIEW_REASON = {
  'key-alignment-suspected': 'answers may be on the wrong rows',
  ambiguous: 'two answers filled in',
  free_response: 'written answers to grade',
};

const isCount = (value) => Number.isInteger(value) && value >= 0;
const scoreText = (earned, total) => (isCount(earned) && isCount(total) && total > 0
  ? `${earned} of ${total} correct`
  : null);

function lateSuffix({ studyDay, today }) {
  if (!studyDay || !today || studyDay >= today) return '';
  const day = formatStudyDay(studyDay);
  return day ? ` · from ${day}` : '';
}

function titleOf(emoji, { child, course, lesson }, unknownChild) {
  const subject = [course, lesson].filter(Boolean).join(': ') || 'School card';
  const who = child ?? (unknownChild ? 'Unknown card' : null);
  return who ? `${emoji} ${who} — ${subject}` : `${emoji} ${subject}`;
}

function metadata(event, lane, key) {
  return pushData({
    ...LANES[lane],
    tag: event.learnerId ? `school-${event.learnerId}-${key}` : `school-card-${key}`,
    group: event.learnerId ? `school-${event.learnerId}` : 'school',
  });
}

function push(emoji, event, message, lane, { unknownChild = false } = {}) {
  const key = event.sessionId ?? event.testId ?? 'unknown';
  return { title: titleOf(emoji, event, unknownChild), message, data: metadata(event, lane, key) };
}

export function composeSchoolPush(event = {}) {
  switch (event.kind) {
    case 'graded': {
      const score = scoreText(event.earned, event.total);
      const late = lateSuffix(event);
      if (event.result === 'needs_remediation') {
        return push('🔁', event, `${score ?? 'Not passed yet'} — retake is on the receipt${late}`, 'needsYou');
      }
      const body = event.retake ? `Retake: ${score ?? 'passed'}` : (score ?? 'Passed');
      return push('✅', event, `${body}${late}`, 'progress');
    }
    case 'review': {
      const count = isCount(event.pendingReview) && event.pendingReview > 0 ? event.pendingReview : null;
      const what = count === 1 ? "1 answer needs a grown-up's check"
        : count ? `${count} answers need a grown-up's check`
          : "Answers need a grown-up's check";
      const reason = (Array.isArray(event.reasons) ? event.reasons : [])
        .map((code) => REVIEW_REASON[code]).find(Boolean);
      return push('👀', event, reason ? `${what} — ${reason}` : what, 'needsYou');
    }
    case 'partial': {
      const blanks = rowList(event.blankRows);
      const doubles = rowList(event.ambiguousRows);
      const parts = [];
      if (blanks) parts.push(`${blanks} blank`);
      if (doubles) parts.push(`${doubles} ${doubles.startsWith('Rows') ? 'have' : 'has'} two marks`);
      const body = parts.length ? `${parts.join(', ')} — fill in and rescan` : 'Not finished — fill in and rescan';
      return push('⚠️', event, body, 'needsYou', { unknownChild: true });
    }
    case 'unmarked': {
      if (event.otherWorkGraded) return null;
      const ranges = (Array.isArray(event.rowRanges) ? event.rowRanges : [])
        .filter((range) => isCount(range?.start) && isCount(range?.end))
        .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`));
      const where = ranges.length ? ` (rows ${ranges.join(', ')})` : '';
      return push('⚠️', event, `Nothing new was marked on this card${where} — fill in today's rows and rescan`,
        'needsYou', { unknownChild: true });
    }
    case 'unresolved':
    case 'refused':
      return push('⚠️', event, CODE_TEXT[event.code] ?? CODE_FALLBACK, 'needsYou', { unknownChild: true });
    case 'piano': {
      const unit = event.unitProgress;
      const where = unit && isCount(unit.completed) && isCount(unit.total) && unit.total > 0
        ? `${unit.label ? `${unit.label}: ` : ''}${unit.completed} of ${unit.total} lessons`
        : null;
      const lesson = event.lesson ?? 'Piano lesson';
      return {
        title: event.child ? `🎹 ${event.child} — ${lesson}` : `🎹 ${lesson}`,
        message: ['Piano lesson done', where].filter(Boolean).join(' · '),
        data: metadata(event, 'progress', `piano-${event.studyDay ?? 'today'}`),
      };
    }
    default:
      return null;
  }
}

export default composeSchoolPush;
