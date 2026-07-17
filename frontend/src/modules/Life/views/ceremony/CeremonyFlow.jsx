import { useMemo, useEffect } from 'react';
import { Stack, Paper, Title, Text, Group, Button, Stepper, Alert, Anchor } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconCheck, IconArrowRight, IconArrowLeft, IconAlertCircle } from '@tabler/icons-react';
import { useCeremony } from '../../hooks/useCeremony.js';
import { UnitIntention } from './UnitIntention.jsx';
import { UnitCapture } from './UnitCapture.jsx';
import { CycleRetro } from './CycleRetro.jsx';
import { PhaseReview } from './PhaseReview.jsx';
import { LoadingState } from '../../components/index.js';
import getLogger from '../../../../lib/logging/Logger.js';

const CEREMONY_STEPS = {
  unit_intention: ['Context', 'Intentions', 'Confirm'],
  unit_capture: ['Review', 'Observations', 'Confirm'],
  cycle_retro: ['Progress', 'Reflection', 'Next Cycle'],
  phase_review: ['Overview', 'Deep Review', 'Adjustments'],
  season_alignment: ['Values', 'Drift Analysis', 'Realignment'],
  era_vision: ['Purpose', 'Direction', 'Vision'],
};

const CEREMONY_COMPONENTS = {
  unit_intention: UnitIntention,
  unit_capture: UnitCapture,
  cycle_retro: CycleRetro,
  phase_review: PhaseReview,
};

export function CeremonyFlow({ type, username, onComplete }) {
  const logger = useMemo(() => getLogger().child({ component: 'ceremony-flow' }), []);
  const navigate = useNavigate();
  const ceremony = useCeremony(type, username);
  const { content, loading, error, submitError, step, nextStep, prevStep, submit, submitting, completed } = ceremony;

  const steps = CEREMONY_STEPS[type] || ['Step 1', 'Step 2', 'Confirm'];
  const implemented = type in CEREMONY_COMPONENTS;
  const CeremonyComponent = CEREMONY_COMPONENTS[type];

  useEffect(() => {
    logger.info('life.ceremony.started', { type, username });
    return () => logger.info('life.ceremony.exited', { type, completed });
  }, [type, username, logger]);

  useEffect(() => {
    logger.info('life.ceremony.step', { type, step, stepLabel: steps[step] });
  }, [step, type, logger]);

  useEffect(() => {
    if (completed) {
      logger.info('life.ceremony.completed', { type, periodId: content?.periodId });
    }
  }, [completed, type, content, logger]);

  if (loading) return <LoadingState />;
  if (error) {
    logger.warn('life.ceremony.error', { type, status: error.status, code: error.code, message: error.message });
    if (error.code === 'NO_PLAN') {
      return (
        <Paper p="xl" withBorder>
          <Stack align="center" gap="md">
            <Title order={4}>You don't have a life plan yet</Title>
            <Text c="dimmed">Ceremonies work against your plan — create one first.</Text>
            <Button onClick={() => navigate('/life/coach')}>Talk to your coach</Button>
            <Anchor size="sm" c="dimmed" onClick={() => navigate('/life/plan')}>
              See the plan page
            </Anchor>
          </Stack>
        </Paper>
      );
    }
    return (
      <Alert color="red" title="Ceremony unavailable" icon={<IconAlertCircle size={16} />}>
        {error.message || 'Something went wrong loading this ceremony.'}
      </Alert>
    );
  }

  if (completed) {
    return (
      <Paper p="xl" withBorder>
        <Stack align="center" gap="md">
          <IconCheck size={48} color="green" />
          <Title order={4}>Ceremony Complete</Title>
          <Text c="dimmed">
            {type.replace(/_/g, ' ')} recorded for period {content?.periodId}
          </Text>
          {onComplete && (
            <Button onClick={onComplete}>Return to Dashboard</Button>
          )}
        </Stack>
      </Paper>
    );
  }

  const isLastStep = step >= steps.length - 1;

  return (
    <Stack gap="md">
      <Title order={4} tt="capitalize">{type.replace(/_/g, ' ')}</Title>

      <Stepper active={step} size="sm">
        {steps.map((label, i) => (
          <Stepper.Step key={i} label={label} />
        ))}
      </Stepper>

      <Paper p="md" withBorder>
        {CeremonyComponent ? (
          <CeremonyComponent
            step={step}
            content={content}
            responses={ceremony.responses}
            setResponse={ceremony.setResponse}
          />
        ) : (
          <Text c="dimmed">
            This ceremony is coming soon — completing it is disabled so it stays on your schedule.
          </Text>
        )}
      </Paper>

      {/* Submit failures stay inline so the form (and the user's typed
          responses) remain mounted and Complete can simply be retried. */}
      {submitError && (
        <Alert color="red" title="Couldn't save your responses — try again." icon={<IconAlertCircle size={16} />}>
          {submitError.message}
        </Alert>
      )}

      <Group justify="space-between">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={prevStep}
          disabled={step === 0}
        >
          Back
        </Button>

        {isLastStep ? (
          // Unimplemented ceremony types must not be completable: posting empty
          // responses would record the ceremony and clear its nudge for the
          // whole period (audit A-4.2).
          implemented && (
            <Button
              leftSection={<IconCheck size={16} />}
              onClick={submit}
              loading={submitting}
            >
              Complete
            </Button>
          )
        ) : (
          <Button
            rightSection={<IconArrowRight size={16} />}
            onClick={nextStep}
          >
            Next
          </Button>
        )}
      </Group>
    </Stack>
  );
}
