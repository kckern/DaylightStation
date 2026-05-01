import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Text,
  Stack,
  Group,
  Switch,
  NumberInput,
  Textarea,
  Button,
  Badge,
} from '@mantine/core';
import { DashboardCard } from '../../Fitness/widgets/_shared/DashboardCard';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import './CoachingComplianceCard.scss';

/**
 * F-001: One-tap daily coaching compliance entry.
 *
 * The single strength movement is hardcoded for v1 to keep the UI a single tap;
 * a movement picker is intentionally deferred (the coaching plan will eventually
 * surface today's prescribed movement, at which point this becomes dynamic).
 */
const STRENGTH_MOVEMENT_V1 = 'pull_up';

const NOTE_MAX_LENGTH = 200;

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CoachingComplianceCard({ username, onSaved }) {
  const logger = useMemo(
    () => getLogger().child({ component: 'coaching-compliance-card' }),
    []
  );

  const [proteinTaken, setProteinTaken] = useState(false);
  const [reps, setReps] = useState(0);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | saved | error
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    logger.info('mounted', { hasUsername: !!username });
  }, [logger, username]);

  const handleSave = useCallback(async () => {
    const date = todayISO();
    const coaching = {
      post_workout_protein: { taken: !!proteinTaken },
      daily_strength_micro: {
        movement: STRENGTH_MOVEMENT_V1,
        reps: Number.isFinite(reps) ? Math.max(0, Math.trunc(reps)) : 0,
      },
    };
    const trimmedNote = (note || '').trim();
    if (trimmedNote) {
      coaching.daily_note = trimmedNote.slice(0, NOTE_MAX_LENGTH);
    }

    setStatus('saving');
    setErrorMsg(null);
    logger.info('save-start', { date, reps: coaching.daily_strength_micro.reps, proteinTaken: !!proteinTaken, hasNote: !!trimmedNote });

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
  }, [proteinTaken, reps, note, username, logger, onSaved]);

  return (
    <DashboardCard title="Coaching" icon="🎯">
      <Stack gap="sm" className="coaching-compliance-card">
        <Group justify="space-between" wrap="nowrap" className="coaching-row">
          <Text size="sm">Post-workout protein</Text>
          <Switch
            data-testid="coaching-protein-toggle"
            checked={proteinTaken}
            onChange={(e) => setProteinTaken(e.currentTarget.checked)}
            aria-label="post-workout protein taken"
          />
        </Group>

        <Group justify="space-between" wrap="nowrap" className="coaching-row">
          <Text size="sm">Pull-ups (reps)</Text>
          <NumberInput
            data-testid="coaching-reps-input"
            value={reps}
            onChange={(v) => setReps(typeof v === 'number' ? v : Number(v) || 0)}
            min={0}
            max={500}
            step={1}
            allowDecimal={false}
            allowNegative={false}
            size="xs"
            w={90}
            aria-label="pull-up reps"
          />
        </Group>

        <Textarea
          data-testid="coaching-note-input"
          placeholder="One-line note (optional)"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          minRows={1}
          maxRows={3}
          autosize
          size="xs"
          maxLength={NOTE_MAX_LENGTH}
          aria-label="daily note"
        />

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
