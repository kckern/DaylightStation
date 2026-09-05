import { useState } from 'react';
import { ActionIcon, Select, UnstyledButton } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';
import { BUCKETS, bucketForHour, bucketLabel, localTodayISO } from './mealBuckets.js';

const logger = createAppLogger('health').child('quick-capture-bar');

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

/** Central capture toolbar with an explicit meal selector. Per-meal Add reuses
 * it with a fixed target. Historical days default to breakfast, not the clock. */
const FIRST_BUCKET = 'morning';
export function QuickCaptureBar({ active = true, onVoiceCapture, onPhotoCapture, onOpenBarcode, onAddTo, busy, date = null, bucketOverride = null }) {
  const [selected, setSelected] = useState(null);
  const isToday = !date || date === localTodayISO();
  const bucket = bucketOverride || selected || (isToday ? bucketForHour(new Date().getHours()) : FIRST_BUCKET);
  const label = bucketLabel(bucket);
  // The label carries the day whenever it is not today, so the target of a
  // one-tap capture is visible BEFORE the tap rather than inferred after it.
  const target = isToday ? label : `${label} on ${date}`;

  return (
    <div className="health-quickbar">
      {bucketOverride ? <span className="health-quickbar__target">Add to {target}</span> :
        <Select aria-label="Capture meal" className="health-quickbar__target" value={bucket}
          onChange={setSelected} allowDeselect={false} data={BUCKETS.map(item => ({ value: item.id, label: `Add to ${item.label}` }))} />}
      <UnstyledButton className="health-quickbar__btn" aria-label={`Quick add to ${target}`}
        onClick={() => { logger.info('quickbar.add', { bucket, date: date || undefined }); onAddTo(bucket); }}>
        <PlusIcon />
      </UnstyledButton>
      <VoiceCapture active={active} bucket={bucket} mealLabel={target} labelPrefix="Quick voice log"
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
