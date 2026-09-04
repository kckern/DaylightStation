import { useState } from 'react';
import { Autocomplete, Button, Group, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { SectionCard, StatCard, Sheet, LoadingState, ErrorState, EmptyState } from '@/lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { localTodayISO } from '../today/mealBuckets.js';
import { MEDICAL_METRICS } from '@shared-contracts/health/medicalMetrics.mjs';

const logger = createAppLogger('health').child('medical');

const METRIC_SUGGESTIONS = Object.keys(MEDICAL_METRICS);
const labelFor = (metric) => MEDICAL_METRICS[metric]?.label || metric;
const formatValue = (r) => (r?.value2 != null ? `${r.value}/${r.value2}` : r?.value ?? '—');
const emptyForm = () => ({ metric: '', value: '', value2: '', unit: '', date: localTodayISO(), note: '' });

/** Grouped medical readings (BP, labs, vitals) — manual entry, no interpretation. */
export function MedicalView() {
  const med = useApiResource('api/v1/health/medical', { label: 'medical', logger });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const openAdd = () => { setForm(emptyForm()); setError(null); setOpen(true); };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const isBp = form.metric.trim() === 'bp';
      const body = {
        metric: form.metric.trim(),
        value: Number(form.value),
        value2: isBp && form.value2 !== '' ? Number(form.value2) : null,
        unit: form.unit,
        date: form.date,
        note: form.note,
      };
      await DaylightAPI('api/v1/health/medical', body, 'POST');
      logger.info('reading.added', { metric: body.metric });
      setOpen(false);
      med.reload();
    } catch (err) {
      logger.error('reading.add.failed', { error: err?.message });
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id, metric) => {
    if (!window.confirm('Delete this reading?')) return;
    try {
      await DaylightAPI(`api/v1/health/medical/${id}`, {}, 'DELETE');
      logger.info('reading.removed', { id, metric });
      med.reload();
    } catch (err) {
      logger.error('reading.remove.failed', { id, error: err?.message });
      setError(err);
    }
  };

  const metrics = med.data?.metrics || [];
  const isBp = form.metric.trim() === 'bp';

  return (
    <div className="health-medical">
      <Group justify="flex-end" mb="sm">
        <Button size="xs" onClick={openAdd}>Add reading</Button>
      </Group>

      {med.loading ? <LoadingState label="medical readings" rows={4} /> : null}
      {med.error ? <ErrorState error={med.error} onRetry={med.reload} label="Medical readings" /> : null}
      {!open && error ? <ErrorState error={error} label="Reading could not be deleted" /> : null}
      {!med.loading && !med.error && !metrics.length ? (
        <EmptyState title="No medical readings yet"
          hint="Add a blood pressure, glucose, or lab reading to start tracking."
          action={{ label: 'Add reading', onClick: openAdd }} />
      ) : null}
      {!med.loading && !med.error ? metrics.map((group) => (
        <SectionCard key={group.metric} title={labelFor(group.metric)} className="health-medical__group">
          <StatCard label="Latest" value={formatValue(group.latest)} unit={group.unit} />
          <Stack gap={4} mt="sm">
            {group.readings.map((r) => (
              <div key={r.id} className="health-medical__row">
                <span className="health-medical__date">{r.date}</span>
                <span className="health-medical__value">{formatValue(r)}{r.unit ? ` ${r.unit}` : ''}</span>
                {r.note ? <span className="health-medical__note">{r.note}</span> : null}
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => remove(r.id, group.metric)}>Delete</Button>
              </div>
            ))}
          </Stack>
        </SectionCard>
      )) : null}

      <Sheet open={open} onClose={() => setOpen(false)} title="Add reading">
        <Stack gap="sm">
          {error ? <Text size="sm" c="red">{error.message}</Text> : null}
          <Autocomplete label="Metric" placeholder="e.g. bp, glucose, resting_hr"
            data={METRIC_SUGGESTIONS} value={form.metric}
            onChange={(v) => setForm({ ...form, metric: v, unit: MEDICAL_METRICS[v]?.units[0] || form.unit })} />
          <NumberInput label={isBp ? 'Systolic' : 'Value'} value={form.value}
            onChange={(v) => setForm({ ...form, value: v })} />
          {isBp ? (
            <NumberInput label="Diastolic" value={form.value2}
              onChange={(v) => setForm({ ...form, value2: v })} />
          ) : null}
          <TextInput label="Unit" placeholder="e.g. mmHg, mg/dL, bpm" value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.currentTarget.value })} />
          <TextInput type="date" label="Date" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.currentTarget.value })} />
          <TextInput label="Note" placeholder="optional" value={form.note}
            onChange={(e) => setForm({ ...form, note: e.currentTarget.value })} />
          <Button onClick={save} loading={saving} disabled={!form.metric.trim() || form.value === ''}>
            Save reading
          </Button>
        </Stack>
      </Sheet>
    </div>
  );
}
export default MedicalView;
