import { useState } from 'react';
import { LoadingState, ErrorState } from '@/lib/ui';
import { useHealthDay } from './useHealthDay.js';
import { EquationStrip } from './EquationStrip.jsx';
import { MacroFooter } from './MacroFooter.jsx';
import { LogTable } from './LogTable.jsx';
import { AddCombobox } from './AddCombobox.jsx';
import { localTodayISO as todayISO } from './mealBuckets.js';

export function TodayView({ onSetupGoals, onCoachTap }) {
  const [date, setDate] = useState(todayISO());
  const day = useHealthDay(date);
  const [addingTo, setAddingTo] = useState(null);   // bucketId | null — F5 renders the combobox here
  const [editingRow, setEditingRow] = useState(null); // row | null — F6 renders the edit sheet

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
      <MacroFooter items={day.items} coachLine={null} onCoachTap={onCoachTap} />
      {/* F6 mounts the edit sheet on editingRow */}
    </div>
  );
}
export default TodayView;
