import { useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { LoadingState, ErrorState } from '@/lib/ui';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { EntryEditSheet } from './EntryEditSheet.jsx';
import { localTodayISO as todayISO } from './mealBuckets.js';
import { useNutritionInput } from '../capture/useNutritionInput.js';
import { BarcodeCapture } from '../capture/BarcodeCapture.jsx';
import { PhotoCapture } from '../capture/PhotoCapture.jsx';
import { VoiceCapture } from '../capture/VoiceCapture.jsx';
import { CustomFoodSheet } from '../capture/CustomFoodSheet.jsx';

const BarcodeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 3v12M5 3v12M7.5 3v12M10 3v12M13 3v12M16 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Opens the barcode-scan sheet — camera decode with a manual-UPC fallback. */
function BarcodeButton({ onClick }) {
  return (
    <ActionIcon aria-label="Scan barcode" onClick={onClick}>
      <BarcodeIcon />
    </ActionIcon>
  );
}

export function TodayView({ onSetupGoals, onCoachTap }) {
  const [date, setDate] = useState(todayISO());
  const day = useHealthDay(date);
  const [addingTo, setAddingTo] = useState(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet
  const [captureMode, setCaptureMode] = useState(null); // 'barcode' | null
  const [unknownUpc, setUnknownUpc] = useState(null);
  const nutrition = useNutritionInput();

  return (
    <div className="health-today">
      <EquationStrip budget={day.budget} budgetError={day.budgetError}
        date={date} today={todayISO()} onDateChange={setDate} onSetupGoals={onSetupGoals} />
      {day.loading ? <LoadingState label="food log" rows={6} /> : null}
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {!day.loading && !day.error ? (
        <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
          onAddTo={setAddingTo} onRowTap={setEditingRow} addingTo={addingTo}
          addSlot={addingTo ? (
            <AddCombobox bucketId={addingTo}
              onDone={() => { setAddingTo(null); day.reload(); }}
              onCancel={() => setAddingTo(null)} />
          ) : null} />
      ) : null}
      <MacroFooter items={day.items} coachLine={null} onCoachTap={onCoachTap}>
        <PhotoCapture busy={nutrition.busy}
          onCapture={async (dataUrl) => { await nutrition.submit('image', dataUrl); day.reload(); }} />
        <BarcodeButton onClick={() => setCaptureMode('barcode')} />
        <VoiceCapture busy={nutrition.busy}
          onCapture={async (dataUrl) => { await nutrition.submit('voice', dataUrl); day.reload(); }} />
      </MacroFooter>
      <BarcodeCapture open={captureMode === 'barcode'} busy={nutrition.busy}
        onClose={() => setCaptureMode(null)}
        onDecode={async (upc) => {
          const result = await nutrition.submit('barcode', upc);
          if (result?.unknownUpc) { setCaptureMode(null); setUnknownUpc(result.upc); }
          else { setCaptureMode(null); day.reload(); }
        }} />
      <CustomFoodSheet upc={unknownUpc} open={Boolean(unknownUpc)}
        onClose={() => setUnknownUpc(null)}
        onCreated={() => { setUnknownUpc(null); day.reload(); }} />
      <EntryEditSheet row={editingRow} open={Boolean(editingRow)}
        onClose={() => setEditingRow(null)} onChanged={day.reload} />
    </div>
  );
}
export default TodayView;
