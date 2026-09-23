import { ActionIcon } from '@mantine/core';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { AddCombobox } from './AddCombobox.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';

const logger = createAppLogger('health').child('meal-add-row');

const BarcodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 3v12M5 3v12M7.5 3v12M10 3v12M13 3v12M16 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const MealsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M3 4h12M3 9h12M3 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** The add input at the foot of one meal: typing is the default, and the
 * voice / photo / barcode / saved-meal routes sit beside it for that same meal.
 * Voice here only ADDS: it carries no selection, so the parser treats what was
 * said as new food and splits "two eggs, toast and coffee" into its own rows.
 * (The header mic, with foods selected, is the one that edits a meal.) */
export function MealAddRow({ bucket, label, date, focusRequest = 0, busy = false, active = true,
  onAdded, onSentencePending, onVoiceCapture, onPhotoCapture, onOpenBarcode, onOpenTemplates, onManageFoods }) {
  const openBarcode = () => { logger.debug('barcode.open', { bucket }); onOpenBarcode(bucket); };
  const openTemplates = (templateId) => { logger.debug('templates.open', { bucket, templateId }); onOpenTemplates(bucket, templateId); };
  return <div className="health-meal__add-row">
    <AddCombobox inline bucketId={bucket} label={label} date={date} focusRequest={focusRequest}
      onDone={onAdded} onManageFoods={onManageFoods} onSentencePending={onSentencePending}
      onTemplate={entry => openTemplates(entry.id)}
      actions={<span className="health-meal__add-actions">
        {onVoiceCapture ? <VoiceCapture active={active} bucket={bucket} mealLabel={label} labelPrefix="Speak foods"
          busy={busy} className="health-meal__add-action"
          onCapture={(content, target, metadata) => onVoiceCapture(content, target, { date, ...metadata })} /> : null}
        <PhotoCapture bucket={bucket} mealLabel={label} labelPrefix="Photo" busy={busy}
          className="health-meal__add-action" onCapture={onPhotoCapture} />
        <ActionIcon variant="subtle" className="health-meal__add-action" aria-label={`Scan barcode to ${label}`}
          onClick={openBarcode}><BarcodeIcon /></ActionIcon>
        <ActionIcon variant="subtle" className="health-meal__add-action" aria-label={`Saved meals for ${label}`}
          onClick={() => openTemplates(null)}><MealsIcon /></ActionIcon>
      </span>} />
  </div>;
}
export default MealAddRow;
