import { useState } from 'react';
import { Autocomplete, Button, Group, NumberInput, Stack, TextInput } from '@mantine/core';
import { SubmitButton, SectionCard, StatCard, Sheet, LoadingState, ErrorState, EmptyState, StateMessage, useRetryRegion, useSheetSubmission } from '@/lib/ui';
import { invalidateApiResources, useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { unavailableError } from "../healthResources.js";
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { createAppLogger } from "../../../../../frontend/src/lib/ui/createAppLogger.js";
import { localTodayISO } from "../today/mealBuckets.js";
import { MEDICAL_METRICS } from "../../portable/contracts/health/medicalMetrics.mjs";
import { isISODate } from "../../portable/contracts/health/isoDate.mjs";

const logger = createAppLogger('health').child('medical');

const medicalPath = 'api/v1/health/medical';
const METRIC_SUGGESTIONS = Object.keys(MEDICAL_METRICS);
const labelFor = (metric) => MEDICAL_METRICS[metric]?.label || metric;
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const formatValue = (r) => (r?.value2 != null ? `${r.value}/${r.value2}` : r?.value ?? '—');
const readingDescription = (metric, reading) => {
  const unit = reading.unit ? ` ${reading.unit}` : '';
  return `${labelFor(metric)} on ${reading.date}, ${formatValue(reading)}${unit}`;
};
const emptyForm = () => ({ metric: '', value: '', value2: '', unit: '', date: localTodayISO(), note: '' });

/** Grouped medical readings (BP, labs, vitals) — manual entry, no interpretation. */
export function MedicalView() {
  const med = useApiResource(medicalPath, { label: 'medical', logger });
  const { regionProps, retry } = useRetryRegion(med.reload, med.loading);
  const [open, setOpen] = useState(false);
  const [removeError, setRemoveError] = useState(null);

  const openAdd = () => { setRemoveError(null); setOpen(true); };

  const remove = async (id, metric, description) => {
    if (!window.confirm(`Delete ${description}?`)) return;
    try {
      await DaylightAPI(`${medicalPath}/${id}`, {}, 'DELETE');
      logger.info('reading.removed', { id, metric });
      invalidateApiResources(path => path === medicalPath);
    } catch (err) {
      logger.error('reading.remove.failed', { id, error: err?.message });
      setRemoveError(err);
    }
  };

  const metrics = med.data?.metrics || [];

  return (
    <section className="health-medical" aria-label="Medical readings" {...regionProps}>
      {metrics.length ? <Group justify="flex-end" mb="sm">
        <Button size="xs" onClick={openAdd}>Add reading</Button>
      </Group> : null}

      {med.loading ? <LoadingState label="medical readings" rows={4} /> : null}
      {unavailableError(med) ? <ErrorState error={med.error} onRetry={retry} label="Medical readings" /> : null}
      {!open && removeError ? (
        <StateMessage state="error" role="alert" title="Reading could not be deleted" detail={removeError.message || 'Unknown error'}>
          <Button density="compact" variant="secondary" onClick={() => { setRemoveError(null); retry(); }}>Refresh readings</Button>
        </StateMessage>
      ) : null}
      {!med.loading && !unavailableError(med) && !metrics.length ? (
        <EmptyState title="No medical readings yet"
          hint="Add a blood pressure, glucose, or lab reading to start tracking."
          action={{ label: 'Add reading', onClick: openAdd }} />
      ) : null}
      {!med.loading && !unavailableError(med) ? metrics.map((group) => (
        <SectionCard key={group.metric} title={labelFor(group.metric)} className="health-medical__group">
          <StatCard label="Latest" value={formatValue(group.latest)} unit={group.unit} />
          <Stack gap={4} mt="sm">
            {group.readings.map((r) => {
              const description = readingDescription(group.metric, r);
              return (
                <div key={r.id} className="health-medical__row">
                  <span className="health-medical__date">{r.date}</span>
                  <span className="health-medical__value">{formatValue(r)}{r.unit ? ` ${r.unit}` : ''}</span>
                  {r.note ? <span className="health-medical__note">{r.note}</span> : null}
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${description}`}
                    onClick={() => remove(r.id, group.metric, description)}
                  >Delete</Button>
                </div>
              );
            })}
          </Stack>
        </SectionCard>
      )) : null}

      {open && <MedicalReadingSheet onClose={() => setOpen(false)} />}
    </section>
  );
}

function MedicalReadingSheet({ onClose }) {
  const [form, setForm] = useState(emptyForm);
  const { submit, saving, failure } = useSheetSubmission(onClose, error => {
    logger.error('reading.add.failed', { error: error?.message });
  });
  const metric = form.metric.trim();
  const paired = MEDICAL_METRICS[metric]?.paired === true;
  const isBp = metric === 'bp';
  const valid = Boolean(metric) && isFiniteNumber(form.value) && Boolean(form.unit.trim())
    && (!paired || isFiniteNumber(form.value2)) && isISODate(form.date);

  const save = async () => {
    const body = {
      metric,
      value: Number(form.value),
      value2: paired ? Number(form.value2) : null,
      unit: form.unit,
      date: form.date,
      note: form.note,
    };
    await DaylightAPI(medicalPath, body, 'POST');
    logger.info('reading.added', { metric });
    invalidateApiResources(path => path === medicalPath);
  };

  return (
    <Sheet open onClose={onClose} title="Add reading">
      <Stack component="form" gap="sm" onSubmit={event => submit(event, save, valid)} aria-label="Add reading">
        {failure && <StateMessage state="error" role="alert" title="Could not save reading" detail={failure.message} />}
        <Autocomplete label="Metric" placeholder="e.g. bp, glucose, resting_hr"
          data={METRIC_SUGGESTIONS} value={form.metric} disabled={saving}
          onChange={(v) => setForm(previous => ({
            ...previous,
            metric: v,
            unit: MEDICAL_METRICS[v]?.units[0] || (MEDICAL_METRICS[previous.metric] ? '' : previous.unit),
          }))} />
        <NumberInput label={isBp ? 'Systolic' : 'Value'} value={form.value} disabled={saving}
          onChange={(v) => setForm({ ...form, value: v })} />
        {paired ? (
          <NumberInput label={isBp ? 'Diastolic' : 'Second value'} withAsterisk value={form.value2} disabled={saving}
            onChange={(v) => setForm({ ...form, value2: v })} />
        ) : null}
        <TextInput label="Unit" placeholder="e.g. mmHg, mg/dL, bpm" value={form.unit} disabled={saving}
          onChange={(e) => setForm({ ...form, unit: e.currentTarget.value })} />
        <TextInput type="date" label="Date" withAsterisk required value={form.date} disabled={saving}
          onChange={(e) => setForm({ ...form, date: e.currentTarget.value })} />
        <TextInput label="Note" placeholder="optional" value={form.note} disabled={saving}
          onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
        <SubmitButton density="compact" disabled={!valid} pending={saving} aria-label="Save reading">
          {saving ? 'Saving reading…' : 'Save reading'}
        </SubmitButton>
      </Stack>
    </Sheet>
  );
}
export default MedicalView;
