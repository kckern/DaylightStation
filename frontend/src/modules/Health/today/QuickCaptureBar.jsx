import { ActionIcon, UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';
import { bucketForHour, bucketLabel, localTodayISO } from './mealBuckets.js';

const logger = createAppLogger('health').child('quick-capture-bar');

// Same inline-SVG-per-file pattern as LogTable.jsx's own BarcodeIcon
// (duplicated rather than shared, to avoid import coupling between two
// otherwise-independent leaf components — see LogTable.jsx's comment).
const BarcodeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 3v12M5 3v12M7.5 3v12M10 3v12M13 3v12M16 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * The ONE always-reachable capture surface on Today (Task 4.3) — text/mic/
 * camera/barcode, fixed bottom-right, reachable from anywhere on the page
 * without scrolling. Replaces the old per-page footer icons (MacroFooter no
 * longer renders any capture controls — see MacroFooter.jsx) so there is
 * exactly one capture surface, not two; the per-meal header trio LogTable
 * renders (Task 4.2) is the other legitimate way to log, targeted at a
 * SPECIFIC meal rather than "whichever one the clock guesses".
 *
 * Bucket target is derived fresh on every render from the local hour via
 * `bucketForHour` (mealBuckets.js) — no memoization, so it stays correct
 * across a meal-boundary hour tick without needing a timer. This is only
 * ever a DEFAULT/best-effort guess (same caveat as `currentMealBucketId`):
 * if the content itself names a different meal, the backend's own
 * resolution (explicit-in-utterance > bucket > clock) still wins, and
 * TodayView's "Moved to X" cue covers that case.
 *
 * ON A DAY THAT IS NOT TODAY THE CLOCK IS SILENT (decision 2.24). A day that
 * has already ended has no "current hour", so `bucketForHour(now)` describes
 * no meal on it; the bar targets that day's FIRST meal instead, and says so in
 * its labels rather than guessing invisibly. Every per-meal header in LogTable
 * still offers an exact target, and a row is one tap to move.
 */
const FIRST_BUCKET = 'morning';
export function QuickCaptureBar({ onVoiceCapture, onPhotoCapture, onOpenBarcode, onAddTo, busy, date = null }) {
  const isToday = !date || date === localTodayISO();
  const bucket = isToday ? bucketForHour(new Date().getHours()) : FIRST_BUCKET;
  const label = bucketLabel(bucket);
  // The label carries the day whenever it is not today, so the target of a
  // one-tap capture is visible BEFORE the tap rather than inferred after it.
  const target = isToday ? label : `${label} on ${date}`;

  return (
    <div className="health-quickbar">
      <UnstyledButton className="health-quickbar__btn" aria-label={`Quick add to ${target}`}
        onClick={() => { logger.info('quickbar.add', { bucket, date: date || undefined }); onAddTo(bucket); }}>
        <PlusIcon />
      </UnstyledButton>
      <VoiceCapture bucket={bucket} mealLabel={target} labelPrefix="Quick voice log"
        busy={busy} className="health-quickbar__btn" onCapture={onVoiceCapture} />
      <PhotoCapture bucket={bucket} mealLabel={target} labelPrefix="Quick photo log"
        busy={busy} className="health-quickbar__btn" onCapture={onPhotoCapture} />
      <ActionIcon aria-label={`Quick scan barcode to ${target}`} className="health-quickbar__btn"
        onClick={() => { logger.info('quickbar.barcode', { bucket, date: date || undefined }); onOpenBarcode(bucket); }}>
        <BarcodeIcon />
      </ActionIcon>
    </div>
  );
}
export default QuickCaptureBar;
