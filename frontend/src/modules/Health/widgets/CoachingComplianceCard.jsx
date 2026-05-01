import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Text,
  Stack,
  Group,
  Switch,
  NumberInput,
  Textarea,
  TextInput,
  Button,
  Badge,
  Loader,
} from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import './CoachingComplianceCard.scss';

/**
 * F-001 / F2-D: One-tap daily coaching compliance entry.
 *
 * The card fetches the user's `coaching_dimensions` schema from
 * `GET /api/v1/health/coaching/schema` on mount and renders one input row
 * per declared dimension. The UI per row is selected by `dimension.type`:
 *   - boolean → toggle for the required boolean field
 *   - numeric → a label + NumberInput (or TextInput if a string field is
 *               also required, e.g. `movement` + `reps`)
 *   - text    → Textarea for the required string field
 *
 * No hardcoded dimension names, no hardcoded movements. When the schema is
 * empty (no playbook / no `coaching_dimensions`), the card shows an
 * empty-state message and disables save.
 */

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildInitialState(dimensionsSchema) {
  const state = {};
  for (const dim of dimensionsSchema) {
    if (!dim?.key) continue;
    if (dim.type === 'boolean') {
      const fieldName = findRequiredFieldName(dim, 'boolean') || 'taken';
      state[dim.key] = { [fieldName]: false };
    } else if (dim.type === 'numeric') {
      const obj = {};
      for (const [fieldName, decl] of Object.entries(dim.fields || {})) {
        if (!decl) continue;
        if (decl.type === 'integer' || decl.type === 'number') obj[fieldName] = 0;
        else if (decl.type === 'string') obj[fieldName] = '';
      }
      state[dim.key] = obj;
    } else if (dim.type === 'text') {
      state[dim.key] = '';
    }
  }
  return state;
}

function findRequiredFieldName(dim, type) {
  for (const [name, decl] of Object.entries(dim?.fields || {})) {
    if (decl?.required && decl?.type === type) return name;
  }
  return null;
}

function buildPostBody(dimensionsSchema, state) {
  const body = {};
  for (const dim of dimensionsSchema) {
    if (!dim?.key) continue;
    const value = state[dim.key];
    if (value === undefined || value === null) continue;

    if (dim.type === 'boolean') {
      // Always emit the row so an explicit "not taken" can be recorded.
      body[dim.key] = { ...value };
    } else if (dim.type === 'numeric') {
      // Emit when at least one numeric field has a non-zero value OR a
      // string field is non-empty. Otherwise omit (empty form rows
      // shouldn't write a `0 reps + ""` entry every day).
      const hasContent = Object.entries(dim.fields || {}).some(([fieldName, decl]) => {
        const v = value[fieldName];
        if (decl?.type === 'integer' || decl?.type === 'number') return typeof v === 'number' && v !== 0;
        if (decl?.type === 'string') return typeof v === 'string' && v.trim().length > 0;
        return false;
      });
      if (hasContent) {
        const payload = {};
        for (const [fieldName, decl] of Object.entries(dim.fields || {})) {
          const v = value[fieldName];
          if (decl?.type === 'integer') {
            payload[fieldName] = Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
          } else if (decl?.type === 'number') {
            payload[fieldName] = Number.isFinite(v) ? v : 0;
          } else if (decl?.type === 'string') {
            payload[fieldName] = typeof v === 'string' ? v : '';
          }
        }
        body[dim.key] = payload;
      }
    } else if (dim.type === 'text') {
      const trimmed = (typeof value === 'string' ? value : '').trim();
      if (trimmed.length > 0) {
        const maxLen = findFieldMaxLength(dim);
        body[dim.key] = maxLen ? trimmed.slice(0, maxLen) : trimmed;
      }
    }
  }
  return body;
}

function findFieldMaxLength(dim) {
  for (const decl of Object.values(dim?.fields || {})) {
    if (decl?.type === 'string' && typeof decl?.max_length === 'number') return decl.max_length;
  }
  return null;
}

function renderBooleanRow({ dim, value, setValue, fieldName }) {
  return (
    <Group justify="space-between" wrap="nowrap" className="coaching-row" key={dim.key}>
      <Text size="sm">{dim.label || dim.key}</Text>
      <Switch
        data-testid={`coaching-${dim.key}-toggle`}
        checked={!!value?.[fieldName]}
        onChange={(e) => setValue({ ...value, [fieldName]: e.currentTarget.checked })}
        aria-label={dim.label || dim.key}
      />
    </Group>
  );
}

function renderNumericRow({ dim, value, setValue }) {
  const fieldEntries = Object.entries(dim.fields || {});
  return (
    <Group justify="space-between" wrap="nowrap" className="coaching-row" key={dim.key}>
      <Text size="sm">{dim.label || dim.key}</Text>
      <Group gap="xs" wrap="nowrap">
        {fieldEntries.map(([fieldName, decl]) => {
          if (decl?.type === 'string') {
            return (
              <TextInput
                key={fieldName}
                data-testid={`coaching-${dim.key}-${fieldName}-input`}
                value={typeof value?.[fieldName] === 'string' ? value[fieldName] : ''}
                onChange={(e) => setValue({ ...value, [fieldName]: e.currentTarget.value })}
                size="xs"
                w={120}
                placeholder={fieldName}
                aria-label={`${dim.key} ${fieldName}`}
              />
            );
          }
          if (decl?.type === 'integer' || decl?.type === 'number') {
            return (
              <NumberInput
                key={fieldName}
                data-testid={`coaching-${dim.key}-${fieldName}-input`}
                value={typeof value?.[fieldName] === 'number' ? value[fieldName] : 0}
                onChange={(v) => {
                  const num = typeof v === 'number' ? v : Number(v) || 0;
                  setValue({ ...value, [fieldName]: num });
                }}
                min={typeof decl.min === 'number' ? decl.min : 0}
                max={typeof decl.max === 'number' ? decl.max : 500}
                step={1}
                allowDecimal={decl?.type === 'number'}
                allowNegative={typeof decl.min === 'number' && decl.min < 0}
                size="xs"
                w={90}
                aria-label={`${dim.key} ${fieldName}`}
              />
            );
          }
          return null;
        })}
      </Group>
    </Group>
  );
}

function renderTextRow({ dim, value, setValue }) {
  const maxLen = findFieldMaxLength(dim) || 200;
  return (
    <Textarea
      key={dim.key}
      data-testid={`coaching-${dim.key}-input`}
      placeholder={dim.label || `${dim.key} (optional)`}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => setValue(e.currentTarget.value)}
      minRows={1}
      maxRows={3}
      autosize
      size="xs"
      maxLength={maxLen}
      aria-label={dim.label || dim.key}
    />
  );
}

export default function CoachingComplianceCard({ username, onSaved }) {
  const logger = useMemo(
    () => getLogger().child({ component: 'coaching-compliance-card' }),
    []
  );

  const [schemaState, setSchemaState] = useState({ status: 'loading', dimensions: [] });
  const [formState, setFormState] = useState({});
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [errorMsg, setErrorMsg] = useState(null);

  // Load schema on mount.
  useEffect(() => {
    let cancelled = false;
    const path = username
      ? `/api/v1/health/coaching/schema?username=${encodeURIComponent(username)}`
      : `/api/v1/health/coaching/schema`;
    logger.info('schema-fetch-start', { hasUsername: !!username });
    DaylightAPI(path)
      .then((res) => {
        if (cancelled) return;
        const dims = Array.isArray(res?.coaching_dimensions) ? res.coaching_dimensions : [];
        logger.info('schema-fetch-success', { dimensionCount: dims.length });
        setSchemaState({ status: 'ready', dimensions: dims });
        setFormState(buildInitialState(dims));
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('schema-fetch-fail', { error: err?.message });
        setSchemaState({ status: 'error', dimensions: [], error: err?.message });
      });
    return () => { cancelled = true; };
  }, [logger, username]);

  useEffect(() => {
    logger.info('mounted', { hasUsername: !!username });
  }, [logger, username]);

  const handleSave = useCallback(async () => {
    const date = todayISO();
    const coaching = buildPostBody(schemaState.dimensions, formState);

    setStatus('saving');
    setErrorMsg(null);
    logger.info('save-start', { date, dimensionKeys: Object.keys(coaching) });

    try {
      const path = username
        ? `/api/v1/health/coaching/${date}?username=${encodeURIComponent(username)}`
        : `/api/v1/health/coaching/${date}`;
      const res = await DaylightAPI(path, coaching, 'POST');
      logger.info('save-success', { date, response: res });
      setStatus('saved');
      onSaved?.({ date, coaching });
    } catch (err) {
      logger.error('save-fail', { error: err?.message });
      setErrorMsg(err?.message || 'Save failed');
      setStatus('error');
    }
  }, [schemaState.dimensions, formState, username, logger, onSaved]);

  if (schemaState.status === 'loading') {
    return (
      <DashboardCard title="Coaching" icon="🎯">
        <Stack gap="sm" className="coaching-compliance-card" align="center">
          <Loader size="sm" />
        </Stack>
      </DashboardCard>
    );
  }

  if (schemaState.status === 'error' || schemaState.dimensions.length === 0) {
    return (
      <DashboardCard title="Coaching" icon="🎯">
        <Stack gap="sm" className="coaching-compliance-card">
          <Text size="xs" c="dimmed" data-testid="coaching-empty-state">
            No compliance dimensions configured. Add `coaching_dimensions` to
            your playbook to enable daily compliance entry.
          </Text>
          <Button
            data-testid="coaching-save-button"
            size="xs"
            disabled
            onClick={() => {}}
          >
            Save
          </Button>
        </Stack>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Coaching" icon="🎯">
      <Stack gap="sm" className="coaching-compliance-card">
        {schemaState.dimensions.map((dim) => {
          if (!dim?.key || !dim?.type) return null;
          const value = formState[dim.key];
          const setValue = (next) => setFormState((prev) => ({ ...prev, [dim.key]: next }));
          if (dim.type === 'boolean') {
            const fieldName = findRequiredFieldName(dim, 'boolean') || 'taken';
            return renderBooleanRow({ dim, value, setValue, fieldName });
          }
          if (dim.type === 'numeric') {
            return renderNumericRow({ dim, value, setValue });
          }
          if (dim.type === 'text') {
            return renderTextRow({ dim, value, setValue });
          }
          return null;
        })}

        <Group justify="space-between" align="center" className="coaching-row">
          <Button
            data-testid="coaching-save-button"
            size="xs"
            onClick={handleSave}
            loading={status === 'saving'}
            disabled={status === 'saving'}
          >
            Save
          </Button>
          {status === 'saved' && (
            <Badge color="green" variant="light" size="sm" data-testid="coaching-status-saved">
              Saved
            </Badge>
          )}
          {status === 'error' && (
            <Badge color="red" variant="light" size="sm" data-testid="coaching-status-error" title={errorMsg || ''}>
              Error
            </Badge>
          )}
        </Group>
      </Stack>
    </DashboardCard>
  );
}
