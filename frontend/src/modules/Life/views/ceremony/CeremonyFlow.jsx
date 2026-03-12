import { Stack, Paper, Title, Text, Group, Button, Stepper, Loader } from '@mantine/core';
import { IconCheck, IconArrowRight, IconArrowLeft } from '@tabler/icons-react';
import { useCeremony } from '../../hooks/useCeremony.js';
import { UnitIntention } from './UnitIntention.jsx';
import { UnitCapture } from './UnitCapture.jsx';
import { CycleRetro } from './CycleRetro.jsx';
import { PhaseReview } from './PhaseReview.jsx';

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
  const ceremony = useCeremony(type, username);
  const { content, loading, error, step, nextStep, prevStep, submit, submitting, completed } = ceremony;

  const steps = CEREMONY_STEPS[type] || ['Step 1', 'Step 2', 'Confirm'];
  const CeremonyComponent = CEREMONY_COMPONENTS[type];

  if (loading) return <Loader size="sm" />;
  if (error) return <Text c="red">{error}</Text>;

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
          <Text c="dimmed">Ceremony type not yet implemented</Text>
        )}
      </Paper>

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
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={submit}
            loading={submitting}
          >
            Complete
          </Button>
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
