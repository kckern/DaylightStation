import { useMemo, useState } from 'react';
import { ActionIcon, Button } from '@mantine/core';
import { LoadingState, ErrorState } from '@/lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { EntryEditSheet } from './EntryEditSheet.jsx';
import { SavedMealsSheet } from './SavedMealsSheet.jsx';
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
  const [savedMealsFor, setSavedMealsFor] = useState(null); // bucketId | null — F8's saved-meals picker
  const nutrition = useNutritionInput();
  const dash = useApiResource('api/v1/health/dashboard', { label: 'dashboard' });
  // dashboard.today.coaching is an array of {type, text, timestamp} — text is
  // multi-line HTML-flavored copy (a full "morning brief"), not a one-liner.
  // Take the first line of the most recent entry and strip markup for the
  // footer's single-line affordance; real payload only, nothing fabricated.
  const coachLine = useMemo(() => {
    const text = dash.data?.today?.coaching?.[0]?.text;
    if (!text) return null;
    const firstLine = text.split('\n')[0].replace(/<[^>]+>/g, '').trim();
    return firstLine || null;
  }, [dash.data]);

  // Past-day bucket → today, via a saved-meal template used purely as
  // transport (created, immediately logged to today, then discarded).
  const copyMealToToday = async (rows, bucketId, label) => {
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    const { meal } = await DaylightAPI('api/v1/health/nutrition/meals', { name: `Copied ${label}`, items }, 'POST');
    await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}/log`, { date: todayISO(), mealTime: bucketId }, 'POST');
    await DaylightAPI(`api/v1/health/nutrition/meals/${meal.id}`, {}, 'DELETE');
    day.reload();
  };

  // Today's bucket → a named, kept saved meal (US-2.2).
  const saveBucketAsMeal = async (rows, label) => {
    const name = window.prompt('Name this meal:', `My ${label.toLowerCase()}`);
    if (!name) return;
    const items = rows.map((r) => ({ name: r.name || r.item, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, color: r.color }));
    await DaylightAPI('api/v1/health/nutrition/meals', { name, items }, 'POST');
  };

  const bucketHeaderAction = (bucketId, rows, label) => {
    if (!rows.length) return null;
    if (date !== todayISO()) {
      return <Button size="compact-xs" variant="subtle" onClick={() => copyMealToToday(rows, bucketId, label)}>Copy to today</Button>;
    }
    return <Button size="compact-xs" variant="subtle" onClick={() => saveBucketAsMeal(rows, label)}>Save as meal</Button>;
  };

  return (
    <div className="health-today">
      <EquationStrip budget={day.budget} budgetError={day.budgetError}
        date={date} today={todayISO()} onDateChange={setDate} onSetupGoals={onSetupGoals} />
      {day.loading ? <LoadingState label="food log" rows={6} /> : null}
      {day.error ? <ErrorState error={day.error} onRetry={day.reload} label="Food log" /> : null}
      {!day.loading && !day.error ? (
        <LogTable byBucket={day.byBucket} sessions={day.budget?.sessions || []}
          onAddTo={setAddingTo} onRowTap={setEditingRow} addingTo={addingTo}
          bucketHeaderAction={bucketHeaderAction}
          addSlot={addingTo ? (
            <AddCombobox bucketId={addingTo}
              onDone={() => { setAddingTo(null); day.reload(); }}
              onCancel={() => setAddingTo(null)}
              onSavedMeals={() => setSavedMealsFor(addingTo)} />
          ) : null} />
      ) : null}
      <MacroFooter items={day.items} coachLine={coachLine} onCoachTap={onCoachTap}>
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
      <SavedMealsSheet open={Boolean(savedMealsFor)} bucketId={savedMealsFor}
        onLogged={() => { setSavedMealsFor(null); setAddingTo(null); day.reload(); }}
        onClose={() => setSavedMealsFor(null)} />
    </div>
  );
}
export default TodayView;
